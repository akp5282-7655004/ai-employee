import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';

type App = ReturnType<typeof buildServer>;

/**
 * Buying a top-up, end to end through the HTTP route.
 *
 * The charge itself is the one call to Stripe, so it is the one thing mocked:
 * `charge` decides what the card does and counts how many times it was asked.
 * Everything else — the plan check, the confirm, the ceiling, the in-flight
 * claim, the settlement — is the real code.
 */
type Charge = { paymentId: string; status: 'succeeded' | 'processing' } | { error: string; paymentId?: string };
let charge: (args: { amountDollars: number; idempotencyKey?: string }) => Promise<Charge>;
let chargeCalls: Array<{ amountDollars: number; idempotencyKey?: string; customerId?: string; subscriptionId?: string }> = [];
/** Stripe customer or subscription id -> Miles account, as Stripe's metadata would resolve it. */
const owners = new Map<string, string>();

vi.mock('../src/billing/stripe.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/billing/stripe.js')>();
  return {
    ...actual,
    userIdForCustomer: async (customerId: string) => owners.get(customerId),
    userIdForSubscription: async (subscriptionId: string) => owners.get(subscriptionId),
    stampCustomer: async (customerId: string, userId: string) => { owners.set(customerId, userId); },
    createTopUpPaymentIntent: async (args: { userId: string; customerId?: string; subscriptionId?: string; amountDollars: number; idempotencyKey?: string }) => {
      chargeCalls.push({ amountDollars: args.amountDollars, idempotencyKey: args.idempotencyKey, customerId: args.customerId, subscriptionId: args.subscriptionId });
      return charge(args);
    },
  };
});

const WEBHOOK_SECRET = 'whsec_topup_test';
const signer = new Stripe('sk_test_unused');
const ENV = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_STARTER', 'STRIPE_PRICE_GROWTH', 'STRIPE_PRICE_SCALE'] as const;
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.STRIPE_PRICE_STARTER = 'price_starter';
  process.env.STRIPE_PRICE_GROWTH = 'price_growth';
  process.env.STRIPE_PRICE_SCALE = 'price_scale';
  chargeCalls = [];
  owners.clear();
  charge = async () => ({ paymentId: 'pi_ok_1', status: 'succeeded' });
});
afterEach(() => {
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

async function signup(app: App, email: string): Promise<string> {
  const r = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email, password: 'password1', tos: true } });
  const raw = r.headers['set-cookie'];
  return String((Array.isArray(raw) ? raw[0] : raw) ?? '').split(';')[0] ?? '';
}

function hook(app: App, type: string, object: unknown) {
  const payload = JSON.stringify({ id: `evt_${type}`, object: 'event', type, data: { object } });
  const header = signer.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  return app.inject({ method: 'POST', url: '/api/stripe/webhook', headers: { 'content-type': 'application/json', 'stripe-signature': header }, payload });
}

/**
 * An account on an active paid plan, reached the way a real one is: a signed
 * checkout.session.completed, then a signed invoice.paid. Writing the billing
 * blob straight into the store would sit behind the server's read cache.
 */
async function subscriber(band: 'starter' | 'growth' = 'starter') {
  const store = new MemoryStore();
  const app = buildServer({ authStore: store });
  const cookie = await signup(app, `${band}-${Math.random().toString(36).slice(2, 8)}@example.com`);
  const uid = (await store.listUserIds())[0]!;
  await hook(app, 'checkout.session.completed', { client_reference_id: uid, customer: 'cus_1', subscription: 'sub_1' });
  owners.set('sub_1', uid);
  const paid = await hook(app, 'invoice.paid', {
    id: 'in_first', customer: 'cus_1', subscription: 'sub_1', amount_paid: band === 'starter' ? 14900 : 39700,
    lines: { data: [{ pricing: { price_details: { price: `price_${band}` } }, period: { end: Math.floor(Date.now() / 1000) + 2_592_000 } }] },
  });
  expect(paid.statusCode).toBe(200);
  const topup = (body: unknown = { confirm: true }) =>
    app.inject({ method: 'POST', url: '/api/billing/topup', headers: { cookie, 'content-type': 'application/json' }, payload: JSON.stringify(body) });
  const billing = async () => (await app.inject({ method: 'GET', url: '/api/billing', headers: { cookie } })).json();
  const balance = async () => (await billing()).credits.remaining as number;
  expect((await billing()).subscription).toMatchObject({ status: 'active', band });
  return { app, store, uid, cookie, topup, balance };
}

describe('buying a top-up', () => {
  it('charges the band increment once and adds the credits when the card clears', async () => {
    const s = await subscriber('starter');
    const before = await s.balance();

    const r = await s.topup();
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, status: 'succeeded', added: 25, paymentId: 'pi_ok_1' });
    expect(chargeCalls).toHaveLength(1);
    expect(chargeCalls[0]).toMatchObject({ amountDollars: 25, customerId: 'cus_1', subscriptionId: 'sub_1' });
    expect(chargeCalls[0]!.idempotencyKey).toMatch(/^topup:/); // a retried request must not be a second charge at Stripe
    expect(await s.balance()).toBe(before + 25);
    await s.app.close();
  });

  it('uses the plan the account is on for the amount', async () => {
    const s = await subscriber('growth');
    const before = await s.balance();
    const r = await s.topup();
    expect(r.json().added).toBe(50);
    expect(chargeCalls[0]!.amountDollars).toBe(50);
    expect(await s.balance()).toBe(before + 50);
    await s.app.close();
  });

  it('will not charge without an explicit confirm', async () => {
    const s = await subscriber();
    const before = await s.balance();
    for (const body of [{}, { confirm: false }, { confirm: 'yes' }]) {
      const r = await s.topup(body);
      expect(r.statusCode).toBe(400);
      expect(r.json().error).toMatch(/No charge was made/);
    }
    expect(chargeCalls).toHaveLength(0);
    expect(await s.balance()).toBe(before);
    await s.app.close();
  });

  it('refuses an account with no paid plan, because there is no card to charge', async () => {
    const store = new MemoryStore();
    const app = buildServer({ authStore: store });
    const cookie = await signup(app, 'free@example.com');
    const r = await app.inject({ method: 'POST', url: '/api/billing/topup', headers: { cookie, 'content-type': 'application/json' }, payload: JSON.stringify({ confirm: true }) });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toMatch(/Pick a plan first/);
    expect(chargeCalls).toHaveLength(0);
    await app.close();
  });

  it('checks the monthly ceiling before the card is charged, not after', async () => {
    // Starter's ceiling is $397 a month: fifteen $25 top-ups fit, the sixteenth does not.
    const s = await subscriber('starter');
    let n = 0;
    charge = async () => ({ paymentId: `pi_month_${++n}`, status: 'succeeded' });
    for (let i = 0; i < 15; i++) expect((await s.topup()).json().added).toBe(25);
    const before = await s.balance();

    const r = await s.topup();
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toMatch(/top-up limit/);
    expect(r.json().error).toMatch(/No charge was made/);
    // A charge that clears and is then refused credits is a customer paying for nothing.
    expect(chargeCalls).toHaveLength(15);
    expect(await s.balance()).toBe(before);
    await s.app.close();
  });

  it('adds nothing and says why when the card is declined', async () => {
    const s = await subscriber();
    const before = await s.balance();
    charge = async () => ({ error: 'The card was not charged: Your card was declined. No credits were added.', paymentId: 'pi_declined' });
    const r = await s.topup();
    expect(r.statusCode).toBe(402);
    expect(r.json().error).toMatch(/declined/);
    expect(await s.balance()).toBe(before);
    // And a failed attempt does not lock the owner out of trying again.
    charge = async () => ({ paymentId: 'pi_retry', status: 'succeeded' });
    expect((await s.topup()).json().added).toBe(25);
    expect(await s.balance()).toBe(before + 25);
    await s.app.close();
  });

  it('does not start a second charge while one is in flight', async () => {
    const s = await subscriber();
    const before = await s.balance();
    let release!: (c: Charge) => void;
    charge = () => new Promise<Charge>((resolve) => { release = resolve; });

    const first = s.topup();
    await vi.waitFor(() => expect(chargeCalls).toHaveLength(1));
    const second = await s.topup(); // the double click
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toMatch(/already being charged/);
    expect(chargeCalls).toHaveLength(1);

    release({ paymentId: 'pi_single', status: 'succeeded' });
    expect((await first).json().added).toBe(25);
    expect(await s.balance()).toBe(before + 25); // one charge, one grant
    await s.app.close();
  });

  it('grants once when the webhook for the same payment arrives after the route settled it', async () => {
    const s = await subscriber();
    const before = await s.balance();
    expect((await s.topup()).json().added).toBe(25);

    const again = await hook(s.app, 'payment_intent.succeeded', {
      id: 'pi_ok_1', amount: 2500, amount_received: 2500, metadata: { purpose: 'topup', milesUserId: s.uid, amountDollars: '25' },
    });
    expect(again.statusCode).toBe(200);
    expect(await s.balance()).toBe(before + 25); // not + 50
    await s.app.close();
  });

  it('holds credits back while the bank is still processing, then adds them when the webhook confirms', async () => {
    const s = await subscriber();
    const before = await s.balance();
    charge = async () => ({ paymentId: 'pi_slow', status: 'processing' });
    const r = await s.topup();
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, status: 'awaiting_payment' });
    expect(await s.balance()).toBe(before);

    await hook(s.app, 'payment_intent.succeeded', {
      id: 'pi_slow', amount: 2500, amount_received: 2500, metadata: { purpose: 'topup', milesUserId: s.uid, amountDollars: '25' },
    });
    expect(await s.balance()).toBe(before + 25);
    await s.app.close();
  });
});
