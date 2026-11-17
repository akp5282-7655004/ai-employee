/**
 * Whether paid work may run, from the billing state alone.
 *
 * Terms 4.5: a failed payment gets a 7-day grace period, then the account
 * moves to read-only monitoring until the payment goes through.
 * Terms 4.6 and 4.7: a cancellation takes effect at the end of the billing
 * period. After that, unused credits (included and purchased top-ups alike)
 * cannot be used, and the account is monitoring only.
 *
 * Monitoring (reads, dashboards, alerts) is never gated here. This only
 * answers "may a work item that spends credits run?".
 *
 * Reads `data.billing` as plain fields so credits.ts can use it without an
 * import cycle through subscription.ts.
 */

export const GRACE_DAYS = 7;
const DAY_MS = 86_400_000;

export type WorkAccessState = 'ok' | 'grace' | 'paused_payment' | 'canceling' | 'ended';

export interface WorkAccess {
  state: WorkAccessState;
  /** True when work items that spend credits are paused. Monitoring keeps running. */
  paused: boolean;
  /** Failed payment: when the grace period ends. */
  graceEndsAt?: string;
  /** Cancellation: when the plan stops (or stopped) working. */
  accessEndsAt?: string;
  /** Plain sentence for the owner. Absent when there is nothing to say. */
  message?: string;
}

interface RawBilling {
  status?: string;
  pastDueSince?: string;
  canceledAt?: string;
  accessEndsAt?: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd?: boolean;
  updatedAt?: string;
}

const day = (iso: string) => iso.slice(0, 10);
const valid = (iso: string | undefined): iso is string => typeof iso === 'string' && Number.isFinite(Date.parse(iso));

export function workAccess(data: Record<string, unknown>, now = new Date()): WorkAccess {
  const b = (data.billing ?? {}) as RawBilling;
  const t = now.getTime();

  if (b.status === 'past_due') {
    // No recorded start (an older record): count the grace from the last update,
    // or from now. Starting late only ever gives the owner more time.
    const since = valid(b.pastDueSince) ? b.pastDueSince : valid(b.updatedAt) ? b.updatedAt : now.toISOString();
    const graceEndsAt = new Date(Date.parse(since) + GRACE_DAYS * DAY_MS).toISOString();
    if (t < Date.parse(graceEndsAt)) {
      return {
        state: 'grace',
        paused: false,
        graceEndsAt,
        message: `Your last payment did not go through. Work keeps running until ${day(graceEndsAt)} (a ${GRACE_DAYS}-day grace period). After that, paid work pauses until the payment goes through. Monitoring keeps running. Update your card on Plan & Credits.`,
      };
    }
    return {
      state: 'paused_payment',
      paused: true,
      graceEndsAt,
      message: `Your payment has not gone through and the ${GRACE_DAYS}-day grace period ended on ${day(graceEndsAt)}. Paid work (campaign builds, skill runs, media, chat) is paused until the payment goes through. Monitoring, reports, and alerts keep running. Update your card on Plan & Credits.`,
    };
  }

  const ended = b.status === 'canceled';
  const scheduled = !ended && b.cancelAtPeriodEnd === true && valid(b.currentPeriodEnd);
  if (ended || scheduled) {
    const end = valid(b.accessEndsAt) ? b.accessEndsAt : valid(b.currentPeriodEnd) ? b.currentPeriodEnd : valid(b.canceledAt) ? b.canceledAt : undefined;
    if (end && t < Date.parse(end)) {
      return {
        state: 'canceling',
        paused: false,
        accessEndsAt: end,
        message: `Your plan is canceled. It keeps working until ${day(end)}. After that, credits stop working and the account moves to monitoring only.`,
      };
    }
    if (ended || end) {
      return {
        state: 'ended',
        paused: true,
        accessEndsAt: end,
        message: `Your plan ended${end ? ` on ${day(end)}` : ''}. Unused credits, including top-ups, cannot be used after the plan ends (Terms 4.7). The account is monitoring only: reports and alerts keep running, and paid work is off. Pick a plan on Plan & Credits to turn work back on.`,
      };
    }
  }

  return { state: 'ok', paused: false };
}

/** Below this many dollars, or this share of the grant, the balance is low. */
export const LOW_CREDIT_USD = 10;
export const LOW_CREDIT_SHARE = 0.1;

export interface LowCredit {
  low: boolean;
  /** Nothing left. */
  out: boolean;
  /** Whole percent of the grant left, 0 to 100. */
  pctLeft: number;
  message?: string;
}

/** A plain warning before the balance runs out, not after. */
export function lowCredit(credits: { granted: number; remaining: number }): LowCredit {
  const granted = Math.max(0, credits.granted || 0);
  const remaining = Math.max(0, credits.remaining || 0);
  const pctLeft = granted > 0 ? Math.max(0, Math.min(100, Math.round((remaining / granted) * 100))) : 0;
  if (granted <= 0 && remaining <= 0) return { low: false, out: false, pctLeft };
  if (remaining <= 0) {
    return { low: true, out: true, pctLeft: 0, message: 'You are out of credits. Paid work is paused. Monitoring, reports, and alerts keep running.' };
  }
  const low = remaining < LOW_CREDIT_USD || (granted > 0 && remaining < granted * LOW_CREDIT_SHARE);
  if (!low) return { low: false, out: false, pctLeft };
  return {
    low: true,
    out: false,
    pctLeft,
    message: `Credits are running low (about ${pctLeft}% left). When they run out, paid work pauses. Monitoring keeps running.`,
  };
}
