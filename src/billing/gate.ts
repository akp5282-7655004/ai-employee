import { billingEnforced, creditState } from './credits.js';
import { billingState } from './subscription.js';

/**
 * Creating or enabling ads spends money. Reads do not.
 * The launch offer is an active $0 plan for the first 100 accounts, with $100 of credits.
 * Starter is $149, Growth is $397, Scale is $797.
 */
export function adSpendAllowed(data: Record<string, unknown>): { ok: boolean; reason?: string } {
  if (!billingEnforced()) return { ok: true };
  const credits = creditState(data);
  const billing = billingState(data);
  const launch = billing.band === 'launch' && billing.status === 'active' && credits.launchOffer !== false;
  const paid = billing.status === 'active' && (billing.band === 'starter' || billing.band === 'growth' || billing.band === 'scale');
  if (!launch && !paid) {
    return {
      ok: false,
      reason: 'No active plan. The launch offer is the first 100 accounts at $0 a month with $100 in media credits. After that, Starter is $149, Growth is $397, and Scale is $797. Creating ads stays off until there is a plan. Reads stay available.',
    };
  }
  return { ok: true };
}
