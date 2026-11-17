/**
 * Pure checks for the launch rows that do not need a live account.
 * Times use an offset in minutes from UTC. Quiet hours are 8pm to 8am local.
 */

export function isOptOutMessage(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[.!\s]+$/g, '');
  return /^(stop|stopall|unsubscribe|cancel|end|quit)$/.test(t);
}

export interface QueuedMessage {
  id?: string;
  phone?: string;
  eventId?: string;
  status?: string;
}

export function cancelQueued(rows: QueuedMessage[], phone: string): QueuedMessage[] {
  const key = phone.replace(/\D/g, '').slice(-10);
  if (!key) return rows;
  return rows.filter((row) => (row.phone || '').replace(/\D/g, '').slice(-10) !== key);
}

const AREA_ZONE: Record<string, string> = {
  '215': 'America/New_York', '267': 'America/New_York', '212': 'America/New_York',
  '312': 'America/Chicago', '713': 'America/Chicago', '214': 'America/Chicago',
  '303': 'America/Denver', '505': 'America/Denver',
  '415': 'America/Los_Angeles', '213': 'America/Los_Angeles', '206': 'America/Los_Angeles',
};

const ZIP_ZONE: Record<string, string> = {
  '191': 'America/New_York', '100': 'America/New_York', '021': 'America/New_York',
  '606': 'America/Chicago', '770': 'America/Chicago', '752': 'America/Chicago',
  '802': 'America/Denver', '871': 'America/Denver',
  '941': 'America/Los_Angeles', '900': 'America/Los_Angeles', '981': 'America/Los_Angeles',
};

export function zoneForLead(phone?: string, zip?: string): string | null {
  const digits = (phone || '').replace(/\D/g, '');
  const area = digits.length === 11 && digits.startsWith('1') ? digits.slice(1, 4) : digits.slice(0, 3);
  if (AREA_ZONE[area]) return AREA_ZONE[area];
  const prefix = (zip || '').replace(/\D/g, '').slice(0, 3);
  return ZIP_ZONE[prefix] || null;
}

export function offsetMinutes(zone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(at);
  const name = parts.find((part) => part.type === 'timeZoneName')?.value || 'GMT';
  const match = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3] || 0));
}

export function leadOffset(at: Date, phone?: string, zip?: string, ownerOffset = 0): number {
  const zone = zoneForLead(phone, zip);
  return zone ? offsetMinutes(zone, at) : ownerOffset;
}

export function isQuietHour(at: Date, offset: number): boolean {
  const local = new Date(at.getTime() + offset * 60_000);
  const hour = local.getUTCHours();
  return hour < 8 || hour >= 20;
}

export function claimOnce(seen: string[], key: string): { first: boolean; seen: string[] } {
  if (!key) return { first: true, seen };
  if (seen.includes(key)) return { first: false, seen };
  return { first: true, seen: [key, ...seen].slice(0, 500) };
}

export function createFingerprint(input: { name?: string; dailyBudget?: number; locations?: string[] } | null | undefined): string {
  const name = (input?.name || '').trim().toLowerCase();
  const budget = Number(input?.dailyBudget) || 0;
  const places = (input?.locations || []).map((place) => place.trim().toLowerCase()).sort().join('|');
  return `${name}|${budget}|${places}`;
}

export function sameCreate(previousKey: string | undefined, previousAt: string | undefined, key: string, now: number, windowMs = 120_000): boolean {
  if (!previousKey || previousKey !== key) return false;
  const then = Date.parse(previousAt || '');
  return Number.isFinite(then) && now - then < windowMs;
}

const SECRET = /(sk_live|sk_test|rk_live|rk_test)_[A-Za-z0-9]+|Bearer\s+[A-Za-z0-9._\-]{8,}|api[_-]?key[=:]\s*\S+|xox[baprs]-[A-Za-z0-9-]+|AKIA[0-9A-Z]{16}/gi;

export function scrubSecrets(text: string): string {
  return String(text || '').replace(SECRET, '[redacted]');
}

export function hideDismissed(currentWhy: string, saved?: string): boolean {
  if (!saved) return false;
  return saved === currentWhy;
}

export function contradictoryAsk(text: string): string | null {
  const amounts = [...text.matchAll(/\$(\d+(?:\.\d+)?)/g)].map((match) => Number(match[1]));
  const unique = [...new Set(amounts)];
  if (unique.length >= 2) return `I heard two budgets, $${unique[0]} and $${unique[1]}. Which one should I use?`;
  if (/\b(google|search)\b/i.test(text) && /\b(meta|facebook)\b/i.test(text) && /\bonly\b/i.test(text)) {
    return 'I heard both Google and Meta, and also the word only. Which channel should I use?';
  }
  return null;
}

const CLAIM = /fake review|guaranteed|#\s*1|\bnumber[- ]one\b/i;

export function blockedClaim(text: string): string | null {
  const hit = text.match(CLAIM);
  if (!hit) return null;
  return `Miles will not write "${hit[0]}". That claim was not on the profile.`;
}

export function localDates(start: Date, end: Date, zone: string): string[] {
  const out: string[] = [];
  const cursor = new Date(start);
  cursor.setUTCHours(12, 0, 0, 0);
  const last = new Date(end);
  last.setUTCHours(12, 0, 0, 0);
  while (cursor.getTime() <= last.getTime() && out.length < 400) {
    const label = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(cursor);
    if (out[out.length - 1] !== label) out.push(label);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

export function marketingFooter(base: string): string {
  const origin = base.replace(/\/$/, '');
  return `\n\nUnsubscribe: ${origin}/email/unsubscribe`;
}

export const HELP_SITE = 'https://sites.pathhackers.com/home/site/de09bf3e';
