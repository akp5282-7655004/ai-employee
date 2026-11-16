/**
 * The $100 launch credit unlocks once, after three real sources are connected,
 * and only once per business (same website domain, phone, or business name).
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
