/**
 * The $100 launch credit unlocks once, after three real sources are connected,
 * and only once per business (same website domain, phone, or business name)
 * and once per email address, even across a deleted account.
 */
import { LAUNCH_GRANT, creditState, writeCredits } from './credits.js';
import { businessIdentity, sameBusiness, type BusinessIdentity } from '../identity/fields.js';

export const LAUNCH_WAIT = 'Connect 3 tools to unlock $100 in credits. Google Ads, your Google Business Profile, Facebook, GoHighLevel, or your website all count.';

export function launchCreditStatus(data: Record<string, unknown>): 'pending' | 'granted' | 'duplicate' {
  const flag = (data.launchCredit as { status?: string } | undefined)?.status;
  if (flag === 'granted' || flag === 'duplicate') return flag;
  return 'pending';
}

export function maybeGrantLaunchCredit(data: Record<string, unknown>, ready: boolean, others: BusinessIdentity[]): { status: 'pending' | 'granted' | 'duplicate'; grantedNow: boolean } {
  const current = launchCreditStatus(data);
  if (current === 'granted' || current === 'duplicate') return { status: current, grantedNow: false };
  if (!ready) {
    data.launchCredit = { status: 'pending' };
    if (!data.credits) writeCredits(data, { granted: 0, spent: 0, launchOffer: true });
    return { status: 'pending', grantedNow: false };
  }
  const mine = businessIdentity((data.profile ?? {}) as { website?: unknown; phone?: unknown; businessName?: unknown });
  if (others.some((other) => sameBusiness(mine, other))) {
    data.launchCredit = { status: 'duplicate', at: new Date().toISOString() };
    if (!data.credits) writeCredits(data, { granted: 0, spent: 0, launchOffer: true });
    return { status: 'duplicate', grantedNow: false };
  }
  const state = creditState(data);
  writeCredits(data, { granted: (state.granted || 0) + LAUNCH_GRANT, spent: state.spent || 0, launchOffer: true });
  data.launchCredit = { status: 'granted', at: new Date().toISOString(), identity: mine };
  return { status: 'granted', grantedNow: true };
}

export function grantedIdentity(data: Record<string, unknown>): BusinessIdentity | null {
  const id = (data.launchCredit as { identity?: BusinessIdentity; status?: string } | undefined);
  if (id?.status !== 'granted' || !id.identity) return null;
  return id.identity;
}

/**
 * One email, one launch credit. Lower-cased and trimmed; a "+tag" is dropped,
 * and Gmail's ignored dots are removed, so an alias of the same inbox is the
 * same email.
 */
export function launchEmailKey(email: string): string {
  const clean = String(email || '').trim().toLowerCase();
  const at = clean.lastIndexOf('@');
  if (at <= 0) return clean;
  let local = clean.slice(0, at).split('+')[0] || '';
  let domain = clean.slice(at + 1);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  return `${local}@${domain}`;
}

/**
 * The grant, gated on the email as well as the business. `claimEmail` records
 * this account's email in a store that outlives account deletion and returns
 * false when another account already took the credit with it. It is called
 * only when the credit would otherwise be granted now, so a blank or changed
 * profile cannot earn a second $100.
 */
export async function grantLaunchCreditOnce(
  data: Record<string, unknown>,
  ready: boolean,
  others: BusinessIdentity[],
  claimEmail: () => Promise<boolean>,
): Promise<{ status: 'pending' | 'granted' | 'duplicate'; grantedNow: boolean }> {
  const mine = businessIdentity((data.profile ?? {}) as { website?: unknown; phone?: unknown; businessName?: unknown });
  if (launchCreditStatus(data) !== 'pending' || !ready || others.some((other) => sameBusiness(mine, other))) {
    return maybeGrantLaunchCredit(data, ready, others);
  }
  if (!(await claimEmail())) {
    data.launchCredit = { status: 'duplicate', at: new Date().toISOString(), reason: 'email' };
    if (!data.credits) writeCredits(data, { granted: 0, spent: 0, launchOffer: true });
    return { status: 'duplicate', grantedNow: false };
  }
  const result = maybeGrantLaunchCredit(data, ready, others);
  if (result.grantedNow) data.launchCredit = { ...(data.launchCredit as Record<string, unknown>), emailClaimed: true };
  return result;
}

/** True when a granted credit has not yet been recorded against its email (granted before that record existed). */
export function needsEmailRecord(data: Record<string, unknown>): boolean {
  const lc = data.launchCredit as { status?: string; emailClaimed?: boolean } | undefined;
  return lc?.status === 'granted' && lc.emailClaimed !== true;
}
