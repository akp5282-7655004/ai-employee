import { workAccess } from './access.js';
import { billingEnforced, creditState, pausedReason } from './credits.js';
import { billingState } from './subscription.js';

/**
 * Creating or enabling ads spends money. Reads do not.
 * The launch offer is an active $0 plan for the first 100 accounts, with $100 of credits.
 * Starter is $149, Growth is $397, Scale is $797.
 */
export function adSpendAllowed(data: Record<string, unknown>): { ok: boolean; reason?: string } {
  if (!billingEnforced()) return { ok: true };
  // Past the failed-payment grace period, or after the plan ended: no new ads.
  // Existing campaigns are not touched. Reads stay available.
  const access = workAccess(data);
  if (access.paused) return { ok: false, reason: pausedReason(access) };
  const credits = creditState(data);
  const billing = billingState(data);
  const launch = billing.band === 'launch' && billing.status === 'active' && credits.launchOffer !== false;
  const paid = billing.status === 'active' && (billing.band === 'starter' || billing.band === 'growth' || billing.band === 'scale');
  // A free account with credits left is not locked behind a card.
  if (credits.remaining > 0) return { ok: true };
  if (!launch && !paid) {
    return {
      ok: false,
      reason: 'Your free credits are used up. Starter is $149, Growth is $397, and Scale is $797. Creating ads stays off until there is a plan or credits remain. Reads stay available. No card is required to sign up.',
    };
  }
  return { ok: true };
}
