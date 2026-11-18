/**
 * Connect stays a button. A Pipedream connect link, or any URL that carries
 * a connect token, never goes into the model text or the saved chat.
 */

export interface ChatConnectAction {
  kind: 'connect';
  app: string;
  label: string;
}

const APPS: Record<string, { app: string; label: string }> = {
  google_ads: { app: 'google_ads', label: 'Connect Google Ads' },
  googleads: { app: 'google_ads', label: 'Connect Google Ads' },
  google_analytics: { app: 'google_analytics', label: 'Connect Google Analytics' },
  googleanalytics: { app: 'google_analytics', label: 'Connect Google Analytics' },
  ga4: { app: 'google_analytics', label: 'Connect Google Analytics' },
  google_my_business: { app: 'google_my_business', label: 'Connect Google Business Profile' },
  google_business_profile: { app: 'google_my_business', label: 'Connect Google Business Profile' },
  gmb: { app: 'google_my_business', label: 'Connect Google Business Profile' },
  gbp: { app: 'google_my_business', label: 'Connect Google Business Profile' },
  gohighlevel: { app: 'gohighlevel', label: 'Connect GoHighLevel' },
  highlevel: { app: 'gohighlevel', label: 'Connect GoHighLevel' },
  highlevel_oauth: { app: 'gohighlevel', label: 'Connect GoHighLevel' },
  ghl: { app: 'gohighlevel', label: 'Connect GoHighLevel' },
  gmail: { app: 'gmail', label: 'Connect Gmail' },
  facebook_pages: { app: 'facebook_pages', label: 'Connect Facebook Pages' },
  facebook: { app: 'facebook_pages', label: 'Connect Facebook Pages' },
  meta: { app: 'facebook_pages', label: 'Connect Facebook Pages' },
};

const NAMED: { re: RegExp; app: string }[] = [
  { re: /google[_\s-]*analytics|\bga4\b|\banalytics\b/i, app: 'google_analytics' },
  { re: /google[_\s-]*my[_\s-]*business|business profile|\bgmb\b|\bgbp\b/i, app: 'google_my_business' },
  { re: /google[_\s-]*ads/i, app: 'google_ads' },
  { re: /gohighlevel|\bhighlevel\b|\bghl\b/i, app: 'gohighlevel' },
  { re: /\bgmail\b/i, app: 'gmail' },
  { re: /facebook[_\s-]*pages|\bfacebook\b|\bmeta\b/i, app: 'facebook_pages' },
];

const SECRET_URL = /(?:https?:\/\/)?(?:[\w.-]+\.)?pipedream\.com\/[^\s<>"'`)\\\]]+|https?:\/\/[^\s<>"'`)\\\]]+/gi;
const BARE_TOKEN = /\bctok_[A-Za-z0-9._~-]*/gi;
const LINK_WORD = /\bconnect_link_url\b|\bconnectLinkUrl\b|\bconnect_link\b/g;
const REMOVED = '[connect link removed]';

export function canonConnectApp(input: string): { app: string; label: string } | null {
  const key = input.trim().toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '');
  return APPS[key] ?? null;
}

export function sanitizeConnectAction(value: unknown): ChatConnectAction | null {
  if (!value || typeof value !== 'object') return null;
  const rec = value as Record<string, unknown>;
  if (rec.kind !== 'connect' || typeof rec.app !== 'string') return null;
  const known = canonConnectApp(rec.app);
  if (!known) return null;
  return { kind: 'connect', app: known.app, label: known.label };
}

export function parseConnectAsk(text: string): ChatConnectAction | null {
  const raw = text.trim();
  if (!/\b(connect|hook up|hookup|link)\b/i.test(raw)) return null;
  if (/\b(which|what|already|status)\b/i.test(raw) && !/\b(connect|hook up|link)\s+(my\s+|the\s+)?(google|meta|facebook|gmail|analytics|ga4|gohighlevel|ghl)\b/i.test(raw)) {
    return null;
  }
  let best: { index: number; app: string } | null = null;
  for (const row of NAMED) {
    const match = row.re.exec(raw);
    if (!match || match.index == null) continue;
    if (!best || match.index < best.index) best = { index: match.index, app: row.app };
  }
  if (!best) return null;
  const known = canonConnectApp(best.app);
  if (!known) return null;
  return { kind: 'connect', app: known.app, label: known.label };
}

export function connectReply(action: ChatConnectAction): string {
  return `Click ${action.label} to open the secure connect window. Nothing is connected until you finish that window.`;
}

export function blockedConnectMessage(label: string): string {
  return `Your browser blocked the connect window. Click ${label} to try again.`;
}

function looksLikeConnectSecret(url: string): boolean {
  let decoded = url;
  try { decoded = decodeURIComponent(url); } catch { /* keep the raw url */ }
  const blob = `${url} ${decoded}`.toLowerCase();
  if (blob.includes('ctok_')) return true;
  if (blob.includes('connect_link') || blob.includes('connectlink')) return true;
  if (/[?&#]token=/.test(blob)) return true;
  if (/pipedream\.com/.test(blob) && /connect/.test(blob)) return true;
  return false;
}

export function hasConnectSecret(text: string): boolean {
  if (/ctok_|connect_link|connectLinkUrl/i.test(text)) return true;
  const matches = text.match(/https?:\/\/[^\s<>"'`)\\\]]+/gi) || [];
  return matches.some(looksLikeConnectSecret);
}

/** Drop tokenized connect links. Other URLs stay. */
export function scrubConnectSecrets(text: string): string {
  return text
    .replace(SECRET_URL, (url) => (looksLikeConnectSecret(url) ? REMOVED : url))
    .replace(BARE_TOKEN, REMOVED)
    .replace(LINK_WORD, REMOVED);
}

export function scrubAssistantText(text: string): string {
  const secret = hasConnectSecret(text);
  const clean = scrubConnectSecrets(text)
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([.,!?])/g, '$1')
    .replace(/(?:\[connect link removed\]\s*){2,}/g, `${REMOVED} `)
    .trim();
  if (secret && !clean.replace(/\[connect link removed\]/g, '').trim()) {
    return 'Click the connect button. The connect link stays out of chat.';
  }
  return clean;
}

export function readConnectAction(raw: string): ChatConnectAction | null {
  try {
    const parsed = JSON.parse(raw) as { action?: unknown };
    return sanitizeConnectAction(parsed?.action);
  } catch {
    return null;
  }
}

export interface StoredChatMessage {
  role: string;
  text: string;
  action?: ChatConnectAction;
}

/** Clean saved turns. Drops token fields and rewrites the text. */
export function scrubStoredMessages(input: unknown): { messages: StoredChatMessage[]; changed: boolean } {
  if (!Array.isArray(input)) return { messages: [], changed: false };
  let changed = false;
  const messages: StoredChatMessage[] = [];
  for (const row of input) {
    if (!row || typeof row !== 'object') { changed = true; continue; }
    const rec = row as Record<string, unknown>;
    const role = typeof rec.role === 'string' && rec.role.trim() ? rec.role : 'emp';
    const original = typeof rec.text === 'string' ? rec.text : '';
    const text = scrubAssistantText(original);
    const action = sanitizeConnectAction(rec.action);
    const extra = Object.keys(rec).some((key) => key !== 'role' && key !== 'text' && key !== 'action');
    if (role !== rec.role || text !== original || extra || (rec.action && !action) || (action && JSON.stringify(action) !== JSON.stringify(rec.action))) changed = true;
    if (!text && !action) { changed = true; continue; }
    const next: StoredChatMessage = { role, text };
    if (action) next.action = action;
    const prev = messages[messages.length - 1];
    if (prev && prev.role === next.role && prev.text === next.text) { changed = true; continue; }
    messages.push(next);
  }
  const capped = messages.slice(-200);
  if (capped.length !== messages.length) changed = true;
  return { messages: capped, changed };
}

/** True when every incoming row is already the start of the stored thread. */
export function isStoredPrefix(incoming: StoredChatMessage[], stored: StoredChatMessage[]): boolean {
  if (incoming.length === 0 || incoming.length >= stored.length) return false;
  return incoming.every((row, i) => {
    const prev = stored[i];
    return !!prev && prev.role === row.role && prev.text === row.text;
  });
}
