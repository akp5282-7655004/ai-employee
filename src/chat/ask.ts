/**
 * One owner chat turn. The model always receives this tenant's snapshot.
 * Tool calls stay on the read-only list. A missing model still answers
 * from the snapshot, so chat does not fall back to a generic assistant.
 */
import type { AccountSnapshot } from './snapshot.js';
import { acceptReply, asksMode, asksSpendOrLeads, fallbackAnswer, milesSystemPrompt, modeAnswer, spendLeadAnswer, type LiveSpendRead } from './prompt.js';
import type { ChatModel, ChatTurnResult, ChatUsage, ChatWireMessage } from './model.js';
import { intentReply, parseActionIntent, type AgentIntent } from './intent.js';
import { CHAT_TOOLS, runChatTool, toolStepLabel, type ChatReaders } from './tools.js';

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
  usage: ChatUsage;
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
      content: message.text!.trim().slice(0, 4000),
    }));
  const question = [...history].reverse().find((message) => message.role === 'user')?.content || '';
  const emptyUsage: ChatUsage = { model: '', inputTokens: 0, outputTokens: 0, serveUsd: 0 };
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
    return { text: said.text, live: false, mode, steps: [], plan, intent: said.ready ? intent : null, usage: emptyUsage };
  }
  if (asksMode(question)) return { text: modeAnswer(args.snapshot), live: false, mode, steps: [], plan: null, intent: null, usage: emptyUsage };
  if (asksSpendOrLeads(question) && args.readers.liveSpend) {
    let read: LiveSpendRead | null = null;
    try { read = await args.readers.liveSpend(); } catch { read = null; }
    if (read && read.connected && !read.sample) return { text: spendLeadAnswer(read), live: false, mode, steps: ['Checking the numbers...'], plan: null, intent: null, usage: emptyUsage };
  }
  const system = milesSystemPrompt(args.snapshot);
  let modelRan = false;
  let usage = emptyUsage;
  const steps: string[] = [];
  const wire = history.length ? history : [{ role: 'user' as const, content: 'The owner just opened the chat.' }];

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
      wire.push({ role: 'assistant', content: turn.text || '', toolCalls: turn.toolCalls });
      for (const call of turn.toolCalls.slice(0, 4)) {
        steps.push(toolStepLabel(call.name));
        let content = '';
        try {
          content = await withTimeout(runChatTool(call.name, args.readers, call.arguments), TOOL_TIMEOUT_MS);
        } catch {
          content = JSON.stringify({ ok: false, error: 'That read took too long. Nothing was changed.' });
        }
        wire.push({ role: 'tool', content, toolCallId: call.id });
      }
      continue;
    }
    const accepted = acceptReply(args.snapshot, question, turn.text);
    return { text: accepted.text, live: accepted.fromModel, mode, steps, plan: null, intent: null, usage };
  }

  return { text: modelRan ? 'I could not finish that read. Nothing was changed.' : fallbackAnswer(args.snapshot, question), live: false, mode, steps, plan: null, intent: null, usage };
}
