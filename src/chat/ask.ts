/**
 * One owner chat turn. The model always receives this tenant's snapshot.
 * Tool calls stay on the read-only list. A missing model still answers
 * from the snapshot, so chat does not fall back to a generic assistant.
 */
import type { AccountSnapshot } from './snapshot.js';
import { acceptReply, asksMode, asksSpendOrLeads, fallbackAnswer, milesSystemPrompt, modeAnswer, spendLeadAnswer, type LiveSpendRead } from './prompt.js';
import type { ChatModel, ChatWireMessage } from './model.js';
import { CHAT_TOOLS, runChatTool, type ChatReaders } from './tools.js';

const TOKENS: Record<string, number> = {
  easy: 320,
  medium: 420,
  high: 560,
  research: 700,
};

export async function answerChat(args: {
  snapshot: AccountSnapshot;
  messages: Array<{ role?: string; text?: string }>;
  mode?: string;
  model: ChatModel;
  readers: ChatReaders;
}): Promise<{ text: string; live: boolean; mode: string }> {
  const mode = TOKENS[args.mode ?? ''] ? args.mode! : 'medium';
  const history = (args.messages ?? [])
    .filter((message) => message && typeof message.text === 'string' && message.text.trim())
    .slice(-12)
    .map((message): ChatWireMessage => ({
      role: message.role === 'user' ? 'user' : 'assistant',
      content: message.text!.trim().slice(0, 4000),
    }));
  const question = [...history].reverse().find((message) => message.role === 'user')?.content || '';
  if (asksMode(question)) return { text: modeAnswer(args.snapshot), live: false, mode };
  if (asksSpendOrLeads(question) && args.readers.liveSpend) {
    let read: LiveSpendRead | null = null;
    try { read = await args.readers.liveSpend(); } catch { read = null; }
    if (read && read.connected && !read.sample) return { text: spendLeadAnswer(read), live: false, mode };
  }
  const system = milesSystemPrompt(args.snapshot);
  let modelRan = false;
  const wire = history.length ? history : [{ role: 'user' as const, content: 'The owner just opened the chat.' }];

  for (let round = 0; round < 3; round++) {
    let turn: Awaited<ReturnType<ChatModel>>;
    try {
      turn = await args.model({ system, messages: wire, tools: CHAT_TOOLS, maxTokens: TOKENS[mode]! });
    } catch {
      turn = null;
    }
    if (!turn) break;
    modelRan = true;
    if (turn.toolCalls.length && round < 2) {
      wire.push({ role: 'assistant', content: turn.text || '', toolCalls: turn.toolCalls });
      for (const call of turn.toolCalls) {
        wire.push({ role: 'tool', content: await runChatTool(call.name, args.readers), toolCallId: call.id });
      }
      continue;
    }
    const accepted = acceptReply(args.snapshot, question, turn.text);
    return { text: accepted.text, live: accepted.fromModel, mode };
  }

  return { text: fallbackAnswer(args.snapshot, question), live: false, mode };
}
