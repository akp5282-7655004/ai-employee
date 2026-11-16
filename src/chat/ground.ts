/**
 * A chat answer may only use numbers that came back from tools this turn,
 * simple forms of those numbers, or numbers the owner already typed.
 */

export interface NumberToken {
  raw: string;
  value: number;
  start: number;
  end: number;
}

const TOKEN = /\$?\d{1,3}(?:,\d{3})+(?:\.\d+)?%?|\$?\d+(?:\.\d+)?(?:\s*[kKmM]\b|%)?/g;

function roundTo(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function close(a: number, b: number): boolean {
  return Math.abs(a - b) <= 0.001;
}

function blank(match: string): string {
  return ' '.repeat(match.length);
}

function maskIgnored(text: string): string {
  return text
    .replace(/\b\d{4}-\d{2}-\d{2}(?:[tT ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:z|Z)?)?\b/g, blank)
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, blank)
    .replace(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:,?\s+\d{4})?\b/gi, blank)
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?\b/gi, blank)
    .replace(/\b(?:19|20)\d{2}\b/g, blank)
    .replace(/\b\d+(?:st|nd|rd|th)\b/gi, blank)
    .replace(/\bstep\s+\d+\b/gi, blank)
    .replace(/(^|\n)(\s*)(\d+)([.)]\s+)/g, (_all, lead: string, space: string, num: string, tail: string) => lead + space + ' '.repeat(num.length) + tail);
}

export function parseNumberToken(raw: string): { value: number; percent: boolean } | null {
  const percent = raw.trim().endsWith('%');
  let body = raw.trim().replace(/[$,%\s]/g, '');
  let scale = 1;
  const suffix = body.slice(-1).toLowerCase();
  if (suffix === 'k' || suffix === 'm') {
    scale = suffix === 'k' ? 1_000 : 1_000_000;
    body = body.slice(0, -1);
  }
  if (!body || !/^\d+(?:\.\d+)?$/.test(body)) return null;
  const value = Number(body) * scale;
  return Number.isFinite(value) ? { value, percent } : null;
}

export function numberTokens(text: string): NumberToken[] {
  const masked = maskIgnored(text);
  const found: NumberToken[] = [];
  for (const match of masked.matchAll(TOKEN)) {
    const raw = match[0];
    const parsed = parseNumberToken(raw);
    if (!parsed || match.index == null) continue;
    found.push({ raw, value: parsed.value, start: match.index, end: match.index + raw.length });
  }
  return found;
}

function walk(value: unknown, out: number[]): void {
  if (typeof value === 'number' && Number.isFinite(value)) {
    out.push(value);
    return;
  }
  if (typeof value === 'string') {
    numberTokens(value).forEach((token) => out.push(token.value));
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => walk(item, out));
    return;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => walk(item, out));
  }
}

export function numbersFromToolResults(payloads: string[]): number[] {
  const out: number[] = [];
  for (const payload of payloads) {
    try {
      walk(JSON.parse(payload), out);
    } catch {
      numberTokens(payload).forEach((token) => out.push(token.value));
    }
  }
  return out;
}

function unique(values: number[]): number[] {
  const seen = new Set<string>();
  const out: number[] = [];
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    const key = String(roundTo(value, 6));
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= 40) break;
  }
  return out;
}

function expand(values: number[], pairs: boolean): number[] {
  const base = unique(values);
  const allowed: number[] = [];
  const add = (value: number) => {
    if (!Number.isFinite(value)) return;
    allowed.push(value, roundTo(value, 0), roundTo(value, 1), roundTo(value, 2));
    if (value > 0 && value <= 1) allowed.push(roundTo(value * 100, 2));
    if (value > 1 && value <= 100) allowed.push(value / 100);
  };
  base.forEach(add);
  if (!pairs) return allowed;
  for (let i = 0; i < base.length; i++) {
    for (let j = i + 1; j < base.length; j++) {
      add(base[i]! + base[j]!);
      add(base[i]! - base[j]!);
      add(base[j]! - base[i]!);
    }
  }
  return allowed;
}

function allowedValues(toolPayloads: string[], ownerTexts: string[]): number[] {
  const tool = numbersFromToolResults(toolPayloads);
  const owner = ownerTexts.flatMap((text) => numberTokens(text).map((token) => token.value));
  return [...expand(tool, true), ...expand(owner, false)];
}

function isAllowed(token: NumberToken, allowed: number[], raw: string): boolean {
  const percent = raw.trim().endsWith('%');
  const forms = [token.value];
  if (percent) forms.push(token.value / 100);
  else if (token.value > 0 && token.value <= 1) forms.push(token.value * 100);
  else if (token.value > 1 && token.value <= 100) forms.push(token.value / 100);
  return forms.some((form) => allowed.some((value) => close(form, value)));
}

export function unsupportedNumberTokens(answer: string, toolPayloads: string[], ownerTexts: string[]): NumberToken[] {
  const allowed = allowedValues(toolPayloads, ownerTexts);
  return numberTokens(answer).filter((token) => !isAllowed(token, allowed, token.raw));
}

export function redactNumbers(answer: string, tokens: NumberToken[]): string {
  const spans = [...tokens].sort((a, b) => b.start - a.start);
  let text = answer;
  for (const token of spans) text = `${text.slice(0, token.start)}not tracked yet${text.slice(token.end)}`;
  return text.replace(/[ \t]{2,}/g, ' ').trim();
}

export function logUngrounded(tenantId: string, values: string[]): void {
  console.warn(JSON.stringify({ event: 'ungrounded_chat_number', tenantId, values }));
}
