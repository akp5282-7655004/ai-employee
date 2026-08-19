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
import { BANDS, creditState, type Band } from './credits.js';

export type SubStatus = 'none' | 'active' | 'past_due' | 'canceled';

export interface BillingState {
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  band?: Band['key'];
  status: SubStatus;
  currentPeriodEnd?: string; // ISO
  /** Stripe invoice ids already granted for — a webhook can arrive more than
   *  once for the same invoice, and this is what stops a double grant. */
  grantedInvoices: string[];
  updatedAt?: string;
}

const MAX_GRANTED_INVOICES = 50;

export function emptyBilling(): BillingState {
  return { status: 'none', grantedInvoices: [] };
}

/** Read `data.billing` back, dropping anything malformed rather than trusting it. */
export function billingState(data: Record<string, unknown>): BillingState {
  const raw = (data.billing ?? {}) as Partial<BillingState>;
  const status: SubStatus = ['none', 'active', 'past_due', 'canceled'].includes(raw.status as string)
    ? (raw.status as SubStatus) : 'none';
  const band = BANDS.some((b) => b.key === raw.band) ? (raw.band as Band['key']) : undefined;
  return {
    stripeCustomerId: typeof raw.stripeCustomerId === 'string' ? raw.stripeCustomerId : undefined,
    stripeSubscriptionId: typeof raw.stripeSubscriptionId === 'string' ? raw.stripeSubscriptionId : undefined,
    band,
    status,
    currentPeriodEnd: typeof raw.currentPeriodEnd === 'string' ? raw.currentPeriodEnd : undefined,
    grantedInvoices: Array.isArray(raw.grantedInvoices) ? raw.grantedInvoices.filter((x) => typeof x === 'string').slice(-MAX_GRANTED_INVOICES) : [],
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : undefined,
  };
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
export function applyRenewal(
  data: Record<string, unknown>,
  args: { invoiceId: string; customerId: string; subscriptionId: string; bandKey: Band['key']; periodEnd: string },
): RenewalResult {
  const b = billingState(data);
  if (b.grantedInvoices.includes(args.invoiceId)) {
    return { applied: false, reason: 'already granted for this invoice' };
  }
  const band = BANDS.find((x) => x.key === args.bandKey);
  if (!band) return { applied: false, reason: `unknown band: ${args.bandKey}` };

  // Read the previous grant the same way the billing page does (creditState's
  // own default applies to a never-touched account) so a renewal can never
  // silently disagree with what the customer was already shown as granted.
  const before = creditState(data);
  data.credits = { granted: before.granted, ledger: before.ledger, launchOffer: false };
  const credits = data.credits as { granted: number; ledger: unknown[]; launchOffer: boolean };
  credits.granted += band.monthlyCredits;

  b.stripeCustomerId = args.customerId;
  b.stripeSubscriptionId = args.subscriptionId;
  b.band = band.key;
  b.status = 'active';
  b.currentPeriodEnd = args.periodEnd;
  b.grantedInvoices = [...b.grantedInvoices, args.invoiceId].slice(-MAX_GRANTED_INVOICES);
  saveBilling(data, b);
  return { applied: true, band: band.key, granted: band.monthlyCredits };
}

/** A payment failed — the account keeps working (monitoring is never gated
 *  on billing), but the status reflects reality for the Billing page to show. */
export function markPastDue(data: Record<string, unknown>, subscriptionId: string): void {
  const b = billingState(data);
  if (b.stripeSubscriptionId && b.stripeSubscriptionId !== subscriptionId) return; // not this account's subscription
  b.status = 'past_due';
  saveBilling(data, b);
}

/** The subscription ended — cancellation, or Stripe gave up retrying a failed card. */
export function markCanceled(data: Record<string, unknown>, subscriptionId: string): void {
  const b = billingState(data);
  if (b.stripeSubscriptionId && b.stripeSubscriptionId !== subscriptionId) return;
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
