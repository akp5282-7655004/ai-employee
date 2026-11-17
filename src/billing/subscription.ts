/**
 * Subscription state — the pure logic connecting a Stripe subscription to a
 * Miles account. No Stripe SDK here on purpose: this module takes plain data
 * (a customer id, a period, a band) and returns what changed, so it can be
 * tested without a network call and without a Stripe account. The SDK
 * wrapper (`stripe.ts`) and the webhook route in server.ts are the only
 * places that touch the network; everything they decide routes through here.
 *
 * Stored on the account as `data.billing`. Grants land on `data.credits` via
 * the same `granted` field the launch offer already uses (billing/credits.ts)
 * — a renewal is simply another grant, so `remaining = granted - spent` stays
 * correct without touching how spending is tracked.
 */
import { BANDS, creditState, writeCredits, type Band } from './credits.js';
import { workAccess } from './access.js';

export type SubStatus = 'none' | 'trialing' | 'active' | 'past_due' | 'canceled';

export interface BillingState {
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  band?: Band['key'];
  status: SubStatus;
  currentPeriodEnd?: string; // ISO
  /** Dollars Stripe actually charged for the latest paid invoice. Not a plan list price. */
  mrr?: number;
  lastPayment?: { amount: number; at: string; invoiceId: string };
  /** Paid invoices Stripe reported, newest last. Used for period revenue. */
  payments?: { invoiceId: string; amount: number; at: string }[];
  refunds?: { id: string; amount: number; at: string }[];
  cancelAtPeriodEnd?: boolean;
  /** When the current run of failed payments started. Starts the 7-day grace (Terms 4.5). */
  pastDueSince?: string;
  /** When Stripe reported the subscription deleted. */
  canceledAt?: string;
  /** When a canceled plan stops working: the paid period's end (Terms 4.6), or now. */
  accessEndsAt?: string;
  /** Stripe invoice ids already granted for — a webhook can arrive more than
   *  once for the same invoice, and this is what stops a double grant. */
  grantedInvoices: string[];
  /** Invoice and payment ids that have granted money. Kept longer than the display list. */
  grantKeys?: string[];
  /** Dollars granted per invoice or payment id, so a replay cannot be added twice. */
  grantAmounts?: Record<string, number>;
  /** Invoice ids present when this in-memory edit started. Not stored. */
  baseInvoices?: string[];
  updatedAt?: string;
}

const MAX_GRANTED_INVOICES = 50;

export function emptyBilling(): BillingState {
  return { status: 'none', grantedInvoices: [] };
}

/** Read `data.billing` back, dropping anything malformed rather than trusting it. */
export function billingState(data: Record<string, unknown>): BillingState {
  const raw = (data.billing ?? {}) as Partial<BillingState>;
  const status: SubStatus = ['none', 'trialing', 'active', 'past_due', 'canceled'].includes(raw.status as string)
    ? (raw.status as SubStatus) : 'none';
  const band = raw.band === 'launch' || BANDS.some((b) => b.key === raw.band) ? (raw.band as Band['key']) : undefined;
  return {
    stripeCustomerId: typeof raw.stripeCustomerId === 'string' ? raw.stripeCustomerId : undefined,
    stripeSubscriptionId: typeof raw.stripeSubscriptionId === 'string' ? raw.stripeSubscriptionId : undefined,
    band,
    status,
    currentPeriodEnd: typeof raw.currentPeriodEnd === 'string' ? raw.currentPeriodEnd : undefined,
    mrr: typeof raw.mrr === 'number' && Number.isFinite(raw.mrr) ? raw.mrr : undefined,
    lastPayment: raw.lastPayment && typeof raw.lastPayment === 'object' && typeof raw.lastPayment.amount === 'number' && typeof raw.lastPayment.at === 'string' && typeof raw.lastPayment.invoiceId === 'string'
      ? { amount: raw.lastPayment.amount, at: raw.lastPayment.at, invoiceId: raw.lastPayment.invoiceId }
      : undefined,
    payments: readPayments(raw.payments),
    refunds: readRefunds(raw.refunds),
    cancelAtPeriodEnd: raw.cancelAtPeriodEnd === true,
    pastDueSince: isoOrUndefined(raw.pastDueSince),
    canceledAt: isoOrUndefined(raw.canceledAt),
    accessEndsAt: isoOrUndefined(raw.accessEndsAt),
    grantedInvoices: Array.isArray(raw.grantedInvoices) ? raw.grantedInvoices.filter((x) => typeof x === 'string').slice(-MAX_GRANTED_INVOICES) : [],
    grantKeys: Array.isArray(raw.grantKeys) ? raw.grantKeys.filter((x) => typeof x === 'string').slice(-5000) : undefined,
    grantAmounts: raw.grantAmounts && typeof raw.grantAmounts === 'object' ? raw.grantAmounts : undefined,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : undefined,
  };
}

function isoOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : undefined;
}

/** A paid, live subscription again: clear the failed-payment and cancel markers. */
function clearLapse(b: BillingState): void {
  b.pastDueSince = undefined;
  b.canceledAt = undefined;
  b.accessEndsAt = undefined;
}

function readPayments(value: unknown): { invoiceId: string; amount: number; at: string }[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows = value.filter((row): row is { invoiceId: string; amount: number; at: string } => {
    const item = row as { amount?: number; at?: string; invoiceId?: string };
    return typeof item.amount === 'number' && typeof item.at === 'string' && typeof item.invoiceId === 'string';
  }).slice(-200);
  return rows.length ? rows : undefined;
}

function readRefunds(value: unknown): { id: string; amount: number; at: string }[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows = value.filter((row): row is { id: string; amount: number; at: string } => {
    const item = row as { amount?: number; at?: string; id?: string };
    return typeof item.amount === 'number' && typeof item.at === 'string' && typeof item.id === 'string';
  }).slice(-200);
  return rows.length ? rows : undefined;
}

function saveBilling(data: Record<string, unknown>, b: BillingState): void {
  data.billing = { ...b, updatedAt: new Date().toISOString() };
}

/**
 * Checkout finished — attach the Stripe identities to this account. Stripe
 * only fires this event once a subscription-mode Checkout has actually
 * produced a subscription, so the status moves to active here rather than
 * waiting on the invoice event, which is not guaranteed to arrive first (it
 * would otherwise leave the account looking unsubscribed for the gap between
 * the two webhooks — status is cheap to set early; only credits wait for the
 * invoice, so crediting still only ever happens in the one place).
 */
export function linkCheckout(data: Record<string, unknown>, customerId: string, subscriptionId: string): void {
  const b = billingState(data);
  b.stripeCustomerId = customerId;
  b.stripeSubscriptionId = subscriptionId;
  b.status = 'active';
  b.cancelAtPeriodEnd = false;
  clearLapse(b);
  saveBilling(data, b);
}

export interface RenewalResult {
  applied: boolean;
  /** Why nothing happened, when applied is false — for the caller to log. */
  reason?: string;
  band?: Band['key'];
  granted?: number;
}

/**
 * An invoice was paid — grant that band's monthly credits, once per invoice.
 * `bandKey` comes from the Stripe Price on the invoice line, resolved by the
 * caller (stripe.ts) since only it knows the price-id → band mapping.
 */
export function mapStripeStatus(status: string | undefined): SubStatus {
  if (status === 'trialing') return 'trialing';
  if (status === 'active') return 'active';
  if (status === 'past_due' || status === 'unpaid') return 'past_due';
  if (status === 'canceled' || status === 'incomplete_expired') return 'canceled';
  return 'none';
}

/** Subscription created or updated. Rewriting the same ids is safe to repeat. */
export function syncSubscription(
  data: Record<string, unknown>,
  args: { customerId?: string; subscriptionId: string; status?: string; bandKey?: Band['key']; periodEnd?: string; cancelAtPeriodEnd?: boolean },
): void {
  const b = billingState(data);
  if (b.stripeSubscriptionId && b.stripeSubscriptionId !== args.subscriptionId) return;
  if (args.customerId) b.stripeCustomerId = args.customerId;
  b.stripeSubscriptionId = args.subscriptionId;
  const mapped = mapStripeStatus(args.status);
  if (mapped === 'past_due' && b.status !== 'past_due') b.pastDueSince = b.pastDueSince ?? new Date().toISOString();
  if (mapped === 'active' || mapped === 'trialing') clearLapse(b);
  if (mapped === 'canceled' && b.status !== 'canceled') {
    b.status = 'canceled';
    stampCancel(b, new Date());
  }
  if (mapped !== 'none') b.status = mapped;
  if (args.bandKey && (args.bandKey === 'launch' || BANDS.some((row) => row.key === args.bandKey))) b.band = args.bandKey;
  if (args.periodEnd) b.currentPeriodEnd = args.periodEnd;
  if (args.cancelAtPeriodEnd != null) b.cancelAtPeriodEnd = args.cancelAtPeriodEnd;
  saveBilling(data, b);
}

export function applyRenewal(
  data: Record<string, unknown>,
  args: { invoiceId: string; customerId: string; subscriptionId: string; bandKey: Band['key']; periodEnd: string; amountUsd?: number; paidAt?: string },
): RenewalResult {
  const b = billingState(data);
  const seen = new Set([...(b.grantKeys ?? []), ...b.grantedInvoices]);
  if (seen.has(args.invoiceId)) {
    return { applied: false, reason: 'already granted for this invoice' };
  }
  const band = BANDS.find((x) => x.key === args.bandKey);
  if (!band) return { applied: false, reason: `unknown band: ${args.bandKey}` };

  // Read the previous grant the same way the billing page does (creditState's
  // own default applies to a never-touched account) so a renewal can never
  // silently disagree with what the customer was already shown as granted.
  //
  // Through writeCredits, never by rebuilding data.credits here: a renewal
  // touches `granted` and `launchOffer` and nothing else, and every other
  // field — the running `spent` total above all — has to survive it intact.
  const before = creditState(data);
  const prior = (data.billing ?? {}) as BillingState;
  if (!prior.baseInvoices) prior.baseInvoices = [...(prior.grantKeys ?? prior.grantedInvoices ?? [])];
  writeCredits(data, {
    granted: Math.round((before.granted + band.monthlyCredits) * 100) / 100,
    launchOffer: false,
  });

  b.stripeCustomerId = args.customerId;
  b.stripeSubscriptionId = args.subscriptionId;
  b.band = band.key;
  b.status = 'active';
  clearLapse(b);
  b.currentPeriodEnd = args.periodEnd;
  if (typeof args.amountUsd === 'number' && Number.isFinite(args.amountUsd)) {
    b.mrr = Math.round(args.amountUsd * 100) / 100;
    const at = args.paidAt || new Date().toISOString();
    b.lastPayment = { amount: b.mrr, at, invoiceId: args.invoiceId };
    const payments = b.payments ?? [];
    if (!payments.some((row) => row.invoiceId === args.invoiceId)) {
      b.payments = [...payments, { invoiceId: args.invoiceId, amount: b.mrr, at }].slice(-200);
    }
  }
  b.grantKeys = [...(b.grantKeys ?? b.grantedInvoices), args.invoiceId].slice(-5000);
  b.grantedInvoices = b.grantKeys.slice(-MAX_GRANTED_INVOICES);
  b.grantAmounts = { ...(b.grantAmounts ?? {}), [args.invoiceId]: band.monthlyCredits };
  b.baseInvoices = prior.baseInvoices;
  saveBilling(data, b);
  return { applied: true, band: band.key, granted: band.monthlyCredits };
}

/** A refund Stripe confirmed. The same id is not stored twice. */
export function recordRefund(data: Record<string, unknown>, args: { id: string; amount: number; at?: string }): void {
  if (!args.id || !(args.amount > 0)) return;
  const b = billingState(data);
  const refunds = b.refunds ?? [];
  if (refunds.some((row) => row.id === args.id)) return;
  b.refunds = [...refunds, { id: args.id, amount: Math.round(args.amount * 100) / 100, at: args.at || new Date().toISOString() }].slice(-200);
  saveBilling(data, b);
}

/** A payment failed. Monitoring is never gated on billing. Paid work keeps
 *  running through a 7-day grace period from the first failure (Terms 4.5),
 *  then pauses until a payment succeeds (see access.ts). A retry that fails
 *  again does not restart the grace period. */
export function markPastDue(data: Record<string, unknown>, subscriptionId: string, now = new Date()): void {
  const b = billingState(data);
  if (b.stripeSubscriptionId && b.stripeSubscriptionId !== subscriptionId) return; // not this account's subscription
  if (b.status !== 'past_due' || !b.pastDueSince) b.pastDueSince = b.pastDueSince ?? now.toISOString();
  b.status = 'past_due';
  saveBilling(data, b);
}

/** When a canceled plan stops working. A paid-up plan runs to the end of its
 *  period (Terms 4.6). A plan Stripe ended over an unpaid invoice stops now:
 *  that period was never paid for. */
function stampCancel(b: BillingState, now: Date): void {
  const wasUnpaid = !!b.pastDueSince;
  b.canceledAt = now.toISOString();
  const periodEnd = b.currentPeriodEnd && Date.parse(b.currentPeriodEnd) > now.getTime() ? b.currentPeriodEnd : undefined;
  b.accessEndsAt = !wasUnpaid && periodEnd ? periodEnd : now.toISOString();
}

/** Whether a plan is open for paid work. One rule with workAccess (access.ts):
 *  a paid-up canceled plan runs to the end of its period, a plan ended over an
 *  unpaid invoice stops now, and a failed payment keeps its 7-day grace.
 *  No plan on file is not open. A new subscription turns it back on. */
export function accessOpen(
  billing: { status?: string; currentPeriodEnd?: string; accessEndsAt?: string; canceledAt?: string; pastDueSince?: string; cancelAtPeriodEnd?: boolean; updatedAt?: string },
  now = Date.now(),
): boolean {
  if (!['active', 'trialing', 'canceled', 'past_due'].includes(String(billing.status))) return false;
  return !workAccess({ billing }, new Date(now)).paused;
}

/** The subscription ended — cancellation, or Stripe gave up retrying a failed card.
 *  After `accessEndsAt`, included credits and top-ups stop working and the
 *  account is monitoring only (Terms 4.6, 4.7; see access.ts). */
export function markCanceled(data: Record<string, unknown>, subscriptionId: string, now = new Date()): void {
  const b = billingState(data);
  if (b.stripeSubscriptionId && b.stripeSubscriptionId !== subscriptionId) return;
  if (b.status !== 'canceled' || !b.accessEndsAt) stampCancel(b, now);
  b.status = 'canceled';
  saveBilling(data, b);
}

/** A plan change (upgrade/downgrade) took effect — updates the band on file.
 *  Credits for the new band land through the next invoice, same as any renewal. */
export function updateBand(data: Record<string, unknown>, subscriptionId: string, bandKey: Band['key']): void {
  const b = billingState(data);
  if (b.stripeSubscriptionId && b.stripeSubscriptionId !== subscriptionId) return;
  if (!BANDS.some((x) => x.key === bandKey)) return;
  b.band = bandKey;
  saveBilling(data, b);
}
