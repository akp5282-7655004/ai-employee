/** Shared field checks. Budgets stay non-negative. Phones become E.164. */

export function trimText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Reject negative numbers and values that are not a real budget. Zero is allowed only when allowZero is set. */
export function parseBudget(value: unknown, opts?: { allowZero?: boolean; max?: number }): { ok: true; value: number } | { ok: false; error: string } {
  if (value === '' || value == null) return { ok: true, value: 0 };
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n)) return { ok: false, error: 'Enter a number.' };
  const max = opts?.max ?? 1_000_000;
  if (n < 0) return { ok: false, error: 'Budget cannot be negative.' };
  if (n === 0 && !opts?.allowZero) return { ok: false, error: 'Budget must be greater than zero.' };
  if (n > max) return { ok: false, error: `Budget cannot be more than ${max.toLocaleString('en-US')}.` };
  return { ok: true, value: Math.round(n * 100) / 100 };
}

/** US-leaning E.164. 10 digits become +1. Already-international numbers keep their country code. */
export function toE164(value: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const raw = trimText(value);
  if (!raw) return { ok: true, value: '' };
  const digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+') && digits.length >= 8 && digits.length <= 15) return { ok: true, value: `+${digits}` };
  if (digits.length === 10) return { ok: true, value: `+1${digits}` };
  if (digits.length === 11 && digits.startsWith('1')) return { ok: true, value: `+${digits}` };
  return { ok: false, error: 'Enter a phone number with area code, like (215) 555-0148.' };
}

export function websiteDomain(value: unknown): string {
  const raw = trimText(value).toLowerCase();
  if (!raw) return '';
  try {
    const withScheme = /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
    const host = new URL(withScheme).hostname.replace(/^www\./, '');
    return host;
  } catch {
    return raw.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] || '';
  }
}

export function businessNameKey(value: unknown): string {
  return trimText(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export interface BusinessIdentity {
  domain: string;
  phone: string;
  name: string;
}

export function businessIdentity(profile: { website?: unknown; phone?: unknown; businessName?: unknown }): BusinessIdentity {
  const phone = toE164(profile.phone);
  return {
    domain: websiteDomain(profile.website),
    phone: phone.ok ? phone.value : '',
    name: businessNameKey(profile.businessName),
  };
}

/** True when two accounts look like the same business. Empty fields never match. */
export function sameBusiness(a: BusinessIdentity, b: BusinessIdentity): boolean {
  if (a.domain && b.domain && a.domain === b.domain) return true;
  if (a.phone && b.phone && a.phone === b.phone) return true;
  if (a.name && b.name && a.name === b.name && a.name.length > 2) return true;
  return false;
}
