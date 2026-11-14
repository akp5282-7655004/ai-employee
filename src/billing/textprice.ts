/**
 * Retail price for text work. OpenRouter cost comes from the cogs table.
 * The charge is that cost marked up to TARGET_MARGIN (75%), so retail is
 * four times the serve cost and $100 of credits costs about $25 to serve.
 *
 * Sub-cent prices stay at 6 decimals. Rounding to cents would make a skill
 * run free and the cap would never bind.
 */
import { MODELLED_TOKENS, TARGET_MARGIN, tokenCostUsd } from './cogs.js';

export const TEXT_MODEL = 'openai/gpt-4o-mini';

const EXTRA_TOKENS: Record<string, { input: number; output: number }> = {
  text: { input: 800, output: 400 },
  chat: { input: 800, output: 400 },
  audit: { input: 2000, output: 800 },
  agent_design: { input: 1500, output: 800 },
  agent_run: { input: 1200, output: 600 },
};

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export interface TextQuote {
  item: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  serveUsd: number;
  retailUsd: number;
}

export function retailFromServe(serveUsd: number): number {
  const serve = Math.max(0, Number(serveUsd) || 0);
  if (!(serve > 0) || TARGET_MARGIN >= 1) return 0;
  return round6(serve / (1 - TARGET_MARGIN));
}

export function textQuote(
  item: string,
  usage?: { model?: string; inputTokens?: number; outputTokens?: number; serveUsd?: number },
): TextQuote | null {
  const modelled = EXTRA_TOKENS[item] ?? MODELLED_TOKENS[item];
  const passedServe = usage?.serveUsd;
  const hasTokens = usage && (usage.inputTokens != null || usage.outputTokens != null);
  if (!modelled && !hasTokens && !(passedServe && passedServe > 0)) return null;
  const model = usage?.model || TEXT_MODEL;
  const inputTokens = hasTokens ? Math.max(0, Number(usage?.inputTokens) || 0) : (modelled?.input ?? 0);
  const outputTokens = hasTokens ? Math.max(0, Number(usage?.outputTokens) || 0) : (modelled?.output ?? 0);
  const serveUsd = passedServe && passedServe > 0 ? round6(passedServe) : tokenCostUsd(model, inputTokens, outputTokens);
  return { item, model, inputTokens, outputTokens, serveUsd, retailUsd: retailFromServe(serveUsd) };
}
