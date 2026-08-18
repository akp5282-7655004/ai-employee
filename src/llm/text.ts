/**
 * General text generation — the same vendor-agnostic backend as the interpreter,
 * exposed for content (ad copy, emails, docs). Prefers OpenRouter (one key, every
 * vendor) via plain fetch, falls back to the Anthropic SDK, and returns null when
 * neither key is set or the call fails — callers then use a deterministic template.
 */
import { recordCost } from '../billing/costsink.js';
import { tokenCostUsd } from '../billing/cogs.js';

export function textLlmReady(): boolean {
  return !!(process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY);
}

export interface TextRequest {
  system: string;
  user: string;
  maxTokens?: number;
}

export async function generateText(req: TextRequest): Promise<string | null> {
  const maxTokens = req.maxTokens ?? 700;
  if (process.env.OPENROUTER_API_KEY) return viaOpenRouter(req, maxTokens);
  if (process.env.ANTHROPIC_API_KEY) return viaAnthropic(req, maxTokens);
  return null;
}

async function viaOpenRouter(req: TextRequest, maxTokens: number): Promise<string | null> {
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
        max_tokens: maxTokens,
        // Ask OpenRouter to price the call. A provider-reported cost beats
        // anything we can model from a price table that goes stale.
        usage: { include: true },
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
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
      model, inputTokens: inTok, outputTokens: outTok, providerReported,
      costUsd: providerReported ? reported : tokenCostUsd(model, inTok, outTok),
    });
    const text = data?.choices?.[0]?.message?.content;
    return typeof text === 'string' && text.trim() ? text.trim() : null;
  } catch {
    return null;
  }
}

async function viaAnthropic(req: TextRequest, maxTokens: number): Promise<string | null> {
  try {
    const importDynamic = new Function('m', 'return import(m)') as (m: string) => Promise<any>;
    const mod = await importDynamic('@anthropic-ai/sdk');
    const Anthropic = mod.default ?? mod.Anthropic ?? mod;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const res = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      system: req.system,
      messages: [{ role: 'user', content: req.user }],
    });
    const model = String(res.model ?? process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5-20251001');
    const inTok = Number(res.usage?.input_tokens) || 0;
    const outTok = Number(res.usage?.output_tokens) || 0;
    recordCost({ model, inputTokens: inTok, outputTokens: outTok, providerReported: false, costUsd: tokenCostUsd(model, inTok, outTok) });
    const text = (res.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    return text.trim() || null;
  } catch {
    return null;
  }
}
