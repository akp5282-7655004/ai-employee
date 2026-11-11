/**
 * One chat completion. OpenRouter is preferred and is the only path that
 * can return tool calls. No key, or a failed call, returns null so the
 * caller can answer from the account snapshot directly.
 */
import { recordCost } from '../billing/costsink.js';
import { tokenCostUsd } from '../billing/cogs.js';
import type { ChatToolSpec } from './tools.js';

export interface ChatToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ChatWireMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: ChatToolCall[];
}

export interface ChatTurnRequest {
  system: string;
  messages: ChatWireMessage[];
  tools: ChatToolSpec[];
  maxTokens: number;
}

export interface ChatTurnResult {
  text: string | null;
  toolCalls: ChatToolCall[];
}

export type ChatModel = (req: ChatTurnRequest) => Promise<ChatTurnResult | null>;

export async function defaultChatModel(req: ChatTurnRequest): Promise<ChatTurnResult | null> {
  if (process.env.OPENROUTER_API_KEY) return openRouterChat(req);
  if (process.env.ANTHROPIC_API_KEY) return anthropicChat(req);
  return null;
}

async function openRouterChat(req: ChatTurnRequest): Promise<ChatTurnResult | null> {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'content-type': 'application/json',
        'HTTP-Referer': 'https://miles.ai',
        'X-Title': 'Miles',
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini',
        max_tokens: req.maxTokens,
        usage: { include: true },
        tools: req.tools.map((tool) => ({ type: 'function', function: tool })),
        messages: [
          { role: 'system', content: req.system },
          ...req.messages.map((message) => {
            if (message.role === 'tool') return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
            if (message.toolCalls?.length) {
              return {
                role: 'assistant',
                content: message.content || null,
                tool_calls: message.toolCalls.map((call) => ({
                  id: call.id,
                  type: 'function',
                  function: { name: call.name, arguments: call.arguments || '{}' },
                })),
              };
            }
            return { role: message.role, content: message.content };
          }),
        ],
      }),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const model = String(data?.model ?? process.env.OPENROUTER_MODEL ?? 'openai/gpt-4o-mini');
    const inTok = Number(data?.usage?.prompt_tokens) || 0;
    const outTok = Number(data?.usage?.completion_tokens) || 0;
    const reported = Number(data?.usage?.cost);
    const providerReported = Number.isFinite(reported) && reported > 0;
    recordCost({
      model,
      inputTokens: inTok,
      outputTokens: outTok,
      providerReported,
      costUsd: providerReported ? reported : tokenCostUsd(model, inTok, outTok),
    });
    const message = data?.choices?.[0]?.message;
    const text = typeof message?.content === 'string' ? message.content.trim() : '';
    const toolCalls: ChatToolCall[] = Array.isArray(message?.tool_calls)
      ? message.tool_calls.map((call: any, index: number) => ({
          id: String(call?.id || `call_${index}`),
          name: String(call?.function?.name || ''),
          arguments: typeof call?.function?.arguments === 'string' ? call.function.arguments : '{}',
        })).filter((call: ChatToolCall) => call.name)
      : [];
    if (!text && !toolCalls.length) return null;
    return { text: text || null, toolCalls };
  } catch {
    return null;
  }
}

async function anthropicChat(req: ChatTurnRequest): Promise<ChatTurnResult | null> {
  try {
    const importDynamic = new Function('m', 'return import(m)') as (m: string) => Promise<any>;
    const mod = await importDynamic('@anthropic-ai/sdk');
    const Anthropic = mod.default ?? mod.Anthropic ?? mod;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const user = req.messages.filter((message) => message.role !== 'tool').map((message) => `${message.role === 'user' ? 'Owner' : 'Miles'}: ${message.content}`).join('\n\n');
    const res = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
      max_tokens: req.maxTokens,
      system: req.system,
      messages: [{ role: 'user', content: user || 'The owner just opened the chat.' }],
    });
    const model = String(res.model ?? process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5-20251001');
    const inTok = Number(res.usage?.input_tokens) || 0;
    const outTok = Number(res.usage?.output_tokens) || 0;
    recordCost({ model, inputTokens: inTok, outputTokens: outTok, providerReported: false, costUsd: tokenCostUsd(model, inTok, outTok) });
    const text = (res.content ?? []).filter((block: any) => block.type === 'text').map((block: any) => block.text).join('').trim();
    return text ? { text, toolCalls: [] } : null;
  } catch {
    return null;
  }
}
