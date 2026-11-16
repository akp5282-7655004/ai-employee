/**
 * Stripe wrapper — every real network call to Stripe lives here, and nowhere
 * else. subscription.ts holds the business logic and is tested without a
 * network; this file is the thin, mostly-untested-by-design edge that talks
 * to the actual API, so a test never needs a real Stripe account to run.
 *
 * Card numbers never reach this server: Checkout and the Billing Portal are
 * both Stripe-hosted pages the customer is redirected to, so Miles is never
 * in PCI scope and never charges a card without the customer's own action on
 * Stripe's page.
 */
let client: import('stripe').default | undefined;

export function stripeReady(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

async function getClient(): Promise<import('stripe').default> {
  if (client) return client;
  const { default: Stripe } = await import('stripe');
  client = new Stripe(process.env.STRIPE_SECRET_KEY!);
  return client;
}

/** The purchasable bands — 'launch' is the free grant, never a Stripe price. */
export type PaidBand = 'starter' | 'growth' | 'scale';

/** Band key -> the Stripe Price id for it, from env vars set once the prices exist in Stripe. */
export function priceIdForBand(bandKey: PaidBand): string | undefined {
  const env: Record<PaidBand, string | undefined> = {
    starter: process.env.STRIPE_PRICE_STARTER,
    growth: process.env.STRIPE_PRICE_GROWTH,
    scale: process.env.STRIPE_PRICE_SCALE,
  };
  return env[bandKey] || undefined;
}

/** The reverse of priceIdForBand — which band a Stripe Price id belongs to. */
export function bandForPriceId(priceId: string | undefined): PaidBand | undefined {
  if (!priceId) return undefined;
  const bands: PaidBand[] = ['starter', 'growth', 'scale'];
  return bands.find((b) => priceIdForBand(b) === priceId);
}

/**
 * A Stripe-hosted Checkout page for one band. `userId` is stamped onto both
 * the session and the resulting customer's metadata — the webhook reads it
 * back to know which Miles account a Stripe customer belongs to, since
 * Stripe (not our database) is the source of truth for that mapping.
 */
export async function createCheckoutSession(args: {
  bandKey: PaidBand; userId: string; email: string; successUrl: string; cancelUrl: string;
}): Promise<{ url: string } | { error: string }> {
  const priceId = priceIdForBand(args.bandKey);
  if (!priceId) return { error: `Stripe isn't finished being set up for the ${args.bandKey} plan yet.` };
  try {
    const stripe = await getClient();
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: args.userId,
      customer_email: args.email,
      subscription_data: { metadata: { milesUserId: args.userId } },
      success_url: args.successUrl,
      cancel_url: args.cancelUrl,
      allow_promotion_codes: true,
    });
    if (!session.url) return { error: 'Stripe did not return a checkout link — try again.' };
    return { url: session.url };
  } catch (err) {
    return { error: `Couldn't reach Stripe: ${(err as Error).message}` };
  }
}

/** The Stripe-hosted self-service page — cancel, update card, see invoices. */
export async function createPortalSession(customerId: string, returnUrl: string): Promise<{ url: string } | { error: string }> {
  try {
    const stripe = await getClient();
    const session = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
    return { url: session.url };
  } catch (err) {
    return { error: `Couldn't reach Stripe: ${(err as Error).message}` };
  }
}

/**
 * The card Checkout saved for this customer. A subscription Checkout puts it
 * on the subscription, not on the customer's invoice settings, so look in
 * both, then fall back to any card attached to the customer.
 */
async function savedCard(
  stripe: import('stripe').default, customerId: string, subscriptionId?: string,
): Promise<string | undefined> {
  const idOf = (v: unknown): string | undefined =>
    typeof v === 'string' ? v : (v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'string' ? (v as { id: string }).id : undefined);
  const customer = await stripe.customers.retrieve(customerId);
  if (!customer.deleted) {
    const onCustomer = idOf(customer.invoice_settings?.default_payment_method);
    if (onCustomer) return onCustomer;
  }
  if (subscriptionId) {
    try {
      const sub = await stripe.subscriptions.retrieve(subscriptionId);
      const onSub = idOf(sub.default_payment_method);
      if (onSub) return onSub;
    } catch { /* a canceled or missing subscription still leaves the customer's cards */ }
  }
  const cards = await stripe.paymentMethods.list({ customer: customerId, type: 'card', limit: 1 });
  return cards.data[0]?.id;
}

/**
 * Charge a top-up to the card already on file, and confirm it in the same call.
 *
 * It used to create a bare PaymentIntent with only a customer on it. An intent
 * like that waits in `requires_payment_method` for a browser to confirm it,
 * and nothing in Miles ever did: no payment succeeded, no webhook fired, and a
 * top-up could never add credits. The owner is not on a card form here, so the
 * charge is off-session against the saved card and either clears now or fails
 * now with the bank's reason.
 *
 * `payment_method_types: ['card']` keeps Stripe from requiring a return URL
 * for redirect-based methods this flow cannot handle.
 *
 * Credits are still not granted here. The caller settles a `succeeded` result
 * by payment id, and the webhook settles the same id idempotently.
 */
export async function createTopUpPaymentIntent(args: {
  userId: string; customerId?: string; subscriptionId?: string; amountDollars: number; idempotencyKey?: string;
}): Promise<{ paymentId: string; status: 'succeeded' | 'processing' } | { error: string; paymentId?: string }> {
  if (!args.customerId) return { error: 'There is no card on file yet. Subscribe to a plan first. No charge was made.' };
  if (!(args.amountDollars > 0)) return { error: 'Top-up amount must be greater than zero.' };
  try {
    const stripe = await getClient();
    const card = await savedCard(stripe, args.customerId, args.subscriptionId);
    if (!card) return { error: 'There is no card on file. Open Manage billing to add one. No charge was made.' };
    const intent = await stripe.paymentIntents.create({
      amount: Math.round(args.amountDollars * 100),
      currency: 'usd',
      customer: args.customerId,
      payment_method: card,
      payment_method_types: ['card'],
      off_session: true,
      confirm: true,
      description: `Miles credit top-up ($${args.amountDollars.toFixed(2)})`,
      metadata: { milesUserId: args.userId, purpose: 'topup', amountDollars: String(args.amountDollars) },
    }, args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : undefined);
    if (intent.status === 'succeeded') return { paymentId: intent.id, status: 'succeeded' };
    if (intent.status === 'processing') return { paymentId: intent.id, status: 'processing' };
    return {
      paymentId: intent.id,
      error: 'Your bank wants to confirm this card before it can be charged. Open Manage billing to update it. No credits were added.',
    };
  } catch (err) {
    // A declined card is an exception carrying the intent that was attempted.
    const e = err as { message?: string; payment_intent?: { id?: string } };
    return {
      paymentId: e.payment_intent?.id,
      error: `The card was not charged: ${e.message || 'Stripe did not accept it'} No credits were added.`,
    };
  }
}

/** Verify a webhook actually came from Stripe before trusting anything in it. */
export async function verifyWebhook(rawBody: Buffer, signature: string): Promise<import('stripe').default.Event | { error: string }> {
  if (!process.env.STRIPE_WEBHOOK_SECRET) return { error: 'STRIPE_WEBHOOK_SECRET not set' };
  const stripe = await getClient();
  try {
    return stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return { error: `signature verification failed: ${(err as Error).message}` };
  }
}

/** Pull the milesUserId back off a customer's metadata (stamped by stampCustomer below). */
export async function userIdForCustomer(customerId: string): Promise<string | undefined> {
  const stripe = await getClient();
  const customer = await stripe.customers.retrieve(customerId);
  if (customer.deleted) return undefined;
  return customer.metadata?.milesUserId || undefined;
}

/**
 * Pull the milesUserId off the *subscription's* metadata instead — set via
 * subscription_data.metadata at Checkout Session creation, so it exists on
 * the subscription the instant Stripe creates it, before any webhook about
 * that subscription can possibly fire. Preferred over userIdForCustomer
 * wherever a subscription id is available: stampCustomer's write to the
 * customer happens in a separate, later API call, so a webhook that arrives
 * fast (invoice.paid on a brand-new subscription often does) can beat it.
 */
export async function userIdForSubscription(subscriptionId: string): Promise<string | undefined> {
  const stripe = await getClient();
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  return sub.metadata?.milesUserId || undefined;
}

/**
 * Stamp the Miles account id onto the Stripe *customer*, not just the
 * subscription — called once, right after checkout.session.completed links
 * the two. Every later webhook (invoice.paid, a failed payment, a
 * cancellation, a plan change) carries a customer id but not always a
 * subscription id, so userIdForCustomer above is how they all find their way
 * back to an account. Without this stamp those events have nothing to look
 * up and silently do nothing.
 */
export async function stampCustomer(customerId: string, userId: string): Promise<void> {
  const stripe = await getClient();
  await stripe.customers.update(customerId, { metadata: { milesUserId: userId } });
}

/** Change the price on an existing subscription. The price id comes from env. */
export async function setSubscriptionPrice(subscriptionId: string, priceId: string): Promise<{ ok: true } | { error: string }> {
  if (!stripeReady() || !priceId) return { error: 'Stripe not connected' };
  try {
    const stripe = await getClient();
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    const item = sub.items?.data?.[0];
    if (!item) return { error: 'Stripe not connected' };
    await stripe.subscriptions.update(subscriptionId, {
      items: [{ id: item.id, price: priceId }],
      proration_behavior: 'create_prorations',
    });
    return { ok: true };
  } catch (err) {
    return { error: `Couldn't reach Stripe: ${(err as Error).message}` };
  }
}

/** Cancel at period end, or immediately. */
export async function cancelStripeSubscription(subscriptionId: string, atPeriodEnd: boolean): Promise<{ ok: true } | { error: string }> {
  if (!stripeReady()) return { error: 'Stripe not connected' };
  try {
    const stripe = await getClient();
    if (atPeriodEnd) await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
    else await stripe.subscriptions.cancel(subscriptionId);
    return { ok: true };
  } catch (err) {
    return { error: `Couldn't reach Stripe: ${(err as Error).message}` };
  }
}

/** Refund the newest charge Stripe has for this customer. */
export async function refundLatestCharge(customerId: string): Promise<{ ok: true; amount: number } | { error: string }> {
  if (!stripeReady()) return { error: 'Stripe not connected' };
  try {
    const stripe = await getClient();
    const charges = await stripe.charges.list({ customer: customerId, limit: 1 });
    const charge = charges.data[0];
    if (!charge || charge.refunded) return { error: 'No payment to refund.' };
    await stripe.refunds.create({ charge: charge.id });
    return { ok: true, amount: Math.round(charge.amount) / 100 };
  } catch (err) {
    return { error: `Couldn't reach Stripe: ${(err as Error).message}` };
  }
}

/** Attach a coupon that already exists in Stripe. */
export async function applySubscriptionCoupon(subscriptionId: string, couponId: string): Promise<{ ok: true } | { error: string }> {
  if (!stripeReady() || !couponId) return { error: 'Stripe not connected' };
  try {
    const stripe = await getClient();
    await stripe.subscriptions.update(subscriptionId, { discounts: [{ coupon: couponId }] });
    return { ok: true };
  } catch (err) {
    return { error: `Couldn't reach Stripe: ${(err as Error).message}` };
  }
}

/** Reset the client between tests, or after env vars change. */
export function resetStripeClient(): void { client = undefined; }

/**
 * Ask Stripe what it actually has, for the launch check. Read-only: it looks
 * up the three configured prices and lists the webhook destinations. A read
 * that fails is reported as that item's error and never thrown — one missing
 * permission on a restricted key must not hide every other answer.
 */
export async function probeStripe(): Promise<import('../ops/launchcheck.js').StripeProbe> {
  const { stripeModeOf } = await import('../ops/launchcheck.js');
  const mode = stripeModeOf(process.env.STRIPE_SECRET_KEY);
  const stripe = await getClient();
  // Stripe quotes the offending id back in its message. Ids and keys stay out of the report.
  const why = (err: unknown) => String((err as Error)?.message || err)
    .replace(/\b(?:sk|rk|pk|whsec|price|prod|cus|sub|acct|we)_[A-Za-z0-9_]+/g, '[id]')
    .slice(0, 160);

  const prices: import('../ops/launchcheck.js').StripeProbe['prices'] = {};
  for (const band of ['starter', 'growth', 'scale'] as const) {
    const id = priceIdForBand(band);
    if (!id) continue;
    try {
      const p = await stripe.prices.retrieve(id);
      prices[band] = { active: p.active, livemode: p.livemode, interval: p.recurring?.interval, unitAmount: p.unit_amount };
    } catch (err) {
      prices[band] = { error: why(err) };
    }
  }

  let webhooks: import('../ops/launchcheck.js').StripeProbe['webhooks'];
  try {
    const list = await stripe.webhookEndpoints.list({ limit: 100 });
    webhooks = list.data.map((h) => ({ url: h.url, status: h.status, events: h.enabled_events ?? [], livemode: h.livemode }));
  } catch (err) {
    webhooks = { error: why(err) };
  }
  return { mode, prices, webhooks };
}
