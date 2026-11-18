/**
 * One owner chat turn. The model always receives this tenant's snapshot.
 * Tool calls stay on the read-only list. A missing model still answers
 * from the snapshot, so chat does not fall back to a generic assistant.
 */
import type { AccountSnapshot } from './snapshot.js';
import { acceptReply, adsPerformanceAnswer, asksAdsPerformance, asksMode, asksSpendOrLeads, fallbackAnswer, milesSystemPrompt, modeAnswer, spendLeadAnswer, type ChatNext, type LiveSpendRead } from './prompt.js';
import type { ChatModel, ChatTurnResult, ChatUsage, ChatWireMessage } from './model.js';
import { intentReply, parseActionIntent, type AgentIntent } from './intent.js';
import { CHAT_TOOLS, runChatTool, toolStepLabel, type ChatReaders } from './tools.js';
import { logUngrounded, redactNumbers, unsupportedNumberTokens } from './ground.js';
import { contradictoryAsk } from '../qa/ownerrows.js';
import { connectReply, parseConnectAsk, readConnectAction, scrubAssistantText, scrubConnectSecrets, type ChatConnectAction } from './connect.js';

const TOKENS: Record<string, number> = {
  easy: 320,
  medium: 420,
  high: 560,
  research: 700,
};

const MAX_STEPS = 8;
const MODEL_TIMEOUT_MS = 12_000;
const TOOL_TIMEOUT_MS = 8_000;

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    work.then((value) => { clearTimeout(timer); resolve(value); }, (err) => { clearTimeout(timer); reject(err); });
  });
}

function addUsage(total: ChatUsage, next?: ChatUsage): ChatUsage {
  if (!next) return total;
  return {
    model: next.model || total.model,
    inputTokens: total.inputTokens + (next.inputTokens || 0),
    outputTokens: total.outputTokens + (next.outputTokens || 0),
    serveUsd: Math.round((total.serveUsd + (next.serveUsd || 0)) * 1e6) / 1e6,
  };
}

export interface ChatAnswer {
  text: string;
  live: boolean;
  mode: string;
  steps: string[];
  plan: { title: string; channel: string; locations: string[]; dailyBudget: number | null; services: string[]; note: string } | null;
  intent: AgentIntent | null;
  next: ChatNext | null;
  usage: ChatUsage;
  action: ChatConnectAction | null;
}

export async function answerChat(args: {
  snapshot: AccountSnapshot;
  messages: Array<{ role?: string; text?: string }>;
  mode?: string;
  model: ChatModel;
  readers: ChatReaders;
}): Promise<ChatAnswer> {
  const mode = TOKENS[args.mode ?? ''] ? args.mode! : 'medium';
  const history = (args.messages ?? [])
    .filter((message) => message && typeof message.text === 'string' && message.text.trim())
    .slice(-12)
    .map((message): ChatWireMessage => ({
      role: message.role === 'user' ? 'user' : 'assistant',
      content: scrubConnectSecrets(message.text!.trim().slice(0, 4000)),
    }))
    .filter((message) => message.content.replace(/\[connect link removed\]/g, '').trim());
  const question = [...history].reverse().find((message) => message.role === 'user')?.content || '';
  const ownerTexts = history.filter((message) => message.role === 'user').map((message) => message.content);
  const toolTexts: string[] = [];
  const emptyUsage: ChatUsage = { model: '', inputTokens: 0, outputTokens: 0, serveUsd: 0 };
  const system = milesSystemPrompt(args.snapshot);
  let usage = emptyUsage;
  const steps: string[] = [];
  const wire: ChatWireMessage[] = history.length ? [...history] : [{ role: 'user', content: 'The owner just opened the chat.' }];
  let connectAction: ChatConnectAction | null = parseConnectAsk(question);
  const pack = (text: string, extra: Omit<ChatAnswer, 'text' | 'action'>): ChatAnswer => ({
    ...extra,
    text: scrubAssistantText(text),
    action: connectAction,
  });
  const ground = async (text: string, canRetry: boolean): Promise<string> => {
    const bad = unsupportedNumberTokens(text, toolTexts, ownerTexts);
    if (!bad.length) return text;
    const values = [...new Set(bad.map((token) => token.raw))];
    logUngrounded(args.snapshot.tenantId, values);
    if (canRetry) {
      wire.push({ role: 'user', content: `Your last answer used numbers that are not in the tool results: ${values.join(', ')}. Use only numbers from the tool data, or say the data is not tracked. Do not invent figures.` });
      try {
        const retry = await withTimeout(args.model({ system, messages: wire, tools: CHAT_TOOLS, maxTokens: TOKENS[mode]! }), MODEL_TIMEOUT_MS);
        if (retry?.text) {
          usage = addUsage(usage, retry.usage);
          const cleaned = acceptReply(args.snapshot, question, retry.text).text;
          const again = unsupportedNumberTokens(cleaned, toolTexts, ownerTexts);
          if (!again.length) return cleaned;
          logUngrounded(args.snapshot.tenantId, [...new Set(again.map((token) => token.raw))]);
          return redactNumbers(cleaned, again);
        }
      } catch { /* the first answer is redacted below */ }
    }
    return redactNumbers(text, bad);
  };
  const contradiction = contradictoryAsk(question);
  if (contradiction) return pack(contradiction, { live: false, mode, steps: [], plan: null, intent: null, next: null, usage: emptyUsage });
  if (connectAction) return pack(connectReply(connectAction), { live: false, mode, steps: [], plan: null, intent: null, next: null, usage: emptyUsage });
  const intent = parseActionIntent(question);
  if (intent) {
    const said = intentReply(intent, args.snapshot.business.name);
    const plan = said.ready ? {
      title: intent.channel === 'meta' ? 'Meta plan' : 'Google Ads plan',
      channel: intent.channel === 'meta' ? 'Meta' : 'Google Ads',
      locations: intent.locations,
      dailyBudget: intent.dailyBudget,
      services: intent.services,
      note: 'Building actions arrives in the next update. Nothing was created or spent.',
    } : null;
    return pack(await ground(said.text, false), { live: false, mode, steps: [], plan, intent: said.ready ? intent : null, next: null, usage: emptyUsage });
  }
  if (asksMode(question)) return pack(await ground(modeAnswer(args.snapshot), false), { live: false, mode, steps: [], plan: null, intent: null, next: null, usage: emptyUsage });
  const adsQuestion = asksAdsPerformance(question);
  if (asksSpendOrLeads(question) && args.readers.liveSpend) {
    let read: LiveSpendRead | null = null;
    try { read = await args.readers.liveSpend(); } catch { read = null; }
    if (read && read.connected && !read.sample) {
      toolTexts.push(JSON.stringify(read));
      return pack(await ground(spendLeadAnswer(read), false), { live: false, mode, steps: ['Checking the numbers...'], plan: null, intent: null, next: null, usage: emptyUsage });
    }
  }
  let modelRan = false;

  for (let round = 0; round < MAX_STEPS; round++) {
    let turn: ChatTurnResult | null = null;
    try {
      turn = await withTimeout(args.model({ system, messages: wire, tools: CHAT_TOOLS, maxTokens: TOKENS[mode]! }), MODEL_TIMEOUT_MS);
    } catch {
      turn = null;
    }
    if (!turn) break;
    modelRan = true;
    usage = addUsage(usage, turn.usage);
    if (turn.toolCalls.length && round < MAX_STEPS - 1) {
      wire.push({ role: 'assistant', content: scrubConnectSecrets(turn.text || ''), toolCalls: turn.toolCalls });
      for (const call of turn.toolCalls.slice(0, 4)) {
        steps.push(toolStepLabel(call.name));
        let content = '';
        try {
          content = await withTimeout(runChatTool(call.name, args.readers, call.arguments), TOOL_TIMEOUT_MS);
        } catch {
          content = JSON.stringify({ ok: false, error: 'That read took too long. Nothing was changed.' });
        }
        content = scrubConnectSecrets(content);
        const found = readConnectAction(content);
        if (found) connectAction = found;
        toolTexts.push(content);
        wire.push({ role: 'tool', content, toolCallId: call.id });
      }
      continue;
    }
    if (adsQuestion && !steps.some((step) => /campaign/i.test(step))) steps.unshift('Checking campaigns...');
    const accepted = acceptReply(args.snapshot, question, turn.text);
    const next = accepted.fromModel ? null : (adsQuestion ? adsPerformanceAnswer(args.snapshot).next : null);
    const raw = accepted.fromModel ? accepted.text : (adsQuestion ? adsPerformanceAnswer(args.snapshot).text : accepted.text);
    const text = await ground(scrubAssistantText(raw), accepted.fromModel);
    return pack(text, { live: accepted.fromModel, mode, steps, plan: null, intent: null, next, usage });
  }

  if (!modelRan && adsQuestion) {
    const ads = adsPerformanceAnswer(args.snapshot);
    return pack(await ground(ads.text, false), { live: false, mode, steps: ['Checking campaigns...'], plan: null, intent: null, next: ads.next, usage });
  }
  const fallback = modelRan ? 'I could not finish that read. Nothing was changed.' : fallbackAnswer(args.snapshot, question);
  return pack(await ground(fallback, false), { live: false, mode, steps, plan: null, intent: null, next: null, usage });
}
