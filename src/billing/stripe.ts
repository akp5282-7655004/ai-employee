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

/** Reset the client between tests, or after env vars change. */
export function resetStripeClient(): void { client = undefined; }
