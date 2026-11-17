import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import { lowCredit, workAccess, GRACE_DAYS } from '../src/billing/access.js';
import { canAfford, chargeCredits } from '../src/billing/credits.js';
import { adSpendAllowed } from '../src/billing/gate.js';

type App = ReturnType<typeof buildServer>;

const WEBHOOK_SECRET = 'whsec_test_secret';
const signer = new Stripe('sk_test_unused');

// Same seam as stripewebhook.test.ts: only the Stripe metadata lookups are faked.
const custMap = new Map<string, string>();
const subMap = new Map<string, string>();
vi.mock('../src/billing/stripe.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/billing/stripe.js')>();
  return {
    ...actual,
    userIdForCustomer: async (customerId: string) => custMap.get(customerId),
    userIdForSubscription: async (subscriptionId: string) => subMap.get(subscriptionId),
    stampCustomer: async (customerId: string, userId: string) => { custMap.set(customerId, userId); },
  };
});

const ENV = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_STARTER', 'STRIPE_PRICE_GROWTH', 'STRIPE_PRICE_SCALE', 'APP_URL', 'BILLING_ENFORCE'] as const;
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.STRIPE_PRICE_STARTER = 'price_starter';
  process.env.STRIPE_PRICE_GROWTH = 'price_growth';
  process.env.STRIPE_PRICE_SCALE = 'price_scale';
  process.env.APP_URL = 'https://miles.example.com';
  process.env.BILLING_ENFORCE = '1';
  custMap.clear();
  subMap.clear();
});
afterEach(() => {
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

const DAY = 86_400_000;

function send(app: App, type: string, object: unknown, id = `evt_${Math.random().toString(36).slice(2)}`) {
  const payload = JSON.stringify({ id, object: 'event', type, data: { object } });
  const header = signer.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  return app.inject({ method: 'POST', url: '/api/stripe/webhook', headers: { 'content-type': 'application/json', 'stripe-signature': header }, payload });
}

async function setup(email: string) {
  const store = new MemoryStore();
  const app = buildServer({ authStore: store, chatModel: async () => ({ text: 'Answer.', toolCalls: [] }) });
  const r = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email, password: 'password1', tos: true } });
  const raw = r.headers['set-cookie'];
  const cookie = String(Array.isArray(raw) ? raw[0] : raw).split(';')[0] ?? '';
  const uid = r.json().user.id as string;
  return { store, app, cookie, uid };
}

async function subscribe(app: App, uid: string, n: string, periodEndMs: number) {
  await send(app, 'checkout.session.completed', { client_reference_id: uid, customer: `cus_${n}`, subscription: `sub_${n}` });
  custMap.set(`cus_${n}`, uid);
  await send(app, 'invoice.paid', {
    id: `in_${n}`, customer: `cus_${n}`, subscription: `sub_${n}`,
    lines: { data: [{ pricing: { price_details: { price: 'price_starter' } }, period: { end: Math.floor(periodEndMs / 1000) } }] },
  });
}

const billing = async (app: App, cookie: string) => (await app.inject({ method: 'GET', url: '/api/billing', headers: { cookie } })).json();
const status = async (app: App, cookie: string) => (await app.inject({ method: 'GET', url: '/api/billing/status', headers: { cookie } })).json();
const ask = async (app: App, cookie: string) =>
  (await app.inject({ method: 'POST', url: '/api/chat/ask', headers: { cookie }, payload: { messages: [{ role: 'user', text: 'How are my ads?' }] } })).json();

async function editBilling(store: MemoryStore, uid: string, patch: Record<string, unknown>) {
  const data = await store.getUserData(uid);
  data.billing = { ...(data.billing as Record<string, unknown>), ...patch };
  await store.setUserData(uid, data);
}

describe('low credit warning (row 70)', () => {
  it('warns under $10 or under 10% of the grant, and says when the balance is out', () => {
    expect(lowCredit({ granted: 100, remaining: 50 }).low).toBe(false);
    expect(lowCredit({ granted: 100, remaining: 9.5 })).toMatchObject({ low: true, out: false, pctLeft: 10 });
    expect(lowCredit({ granted: 350, remaining: 30 }).low).toBe(true); // over $10, under 10% of 350
    expect(lowCredit({ granted: 350, remaining: 40 }).low).toBe(false);
    const out = lowCredit({ granted: 100, remaining: 0 });
    expect(out).toMatchObject({ low: true, out: true });
    expect(out.message).toMatch(/Monitoring/);
    expect(lowCredit({ granted: 0, remaining: 0 }).low).toBe(false);
  });

  it('shows on the billing view and the dashboard status read', async () => {
    const { store, app, cookie, uid } = await setup('low@example.com');
    const before = await billing(app, cookie);
    expect(before.lowCredit.low).toBe(false);
    const data = await store.getUserData(uid);
    data.credits = { granted: 100, spent: 95, ledger: [] };
    await store.setUserData(uid, data);
    const after = await billing(app, cookie);
    expect(after.lowCredit).toMatchObject({ low: true, out: false });
    expect(after.lowCredit.message).toMatch(/running low/);
    expect((await status(app, cookie)).lowCredit.low).toBe(true);
    await app.close();
  });
});

describe('failed payment grace period (row 75)', () => {
  it('keeps work running for 7 days, then pauses paid work until a payment succeeds; monitoring stays', async () => {
    const { store, app, cookie, uid } = await setup('grace@example.com');
    await subscribe(app, uid, 'g1', Date.now() + 30 * DAY);
    await send(app, 'invoice.payment_failed', { customer: 'cus_g1', subscription: 'sub_g1' });

    const inGrace = await billing(app, cookie);
    expect(inGrace.subscription.status).toBe('past_due');
    expect(inGrace.access.state).toBe('grace');
    expect(inGrace.access.paused).toBe(false);
    const ends = Date.parse(inGrace.access.graceEndsAt) - Date.now();
    expect(ends).toBeGreaterThan((GRACE_DAYS - 1) * DAY);
    expect(ends).toBeLessThanOrEqual(GRACE_DAYS * DAY);
    expect(inGrace.access.message).toMatch(/grace period/);
    expect((await ask(app, cookie)).text).toBe('Answer.');

    // A retry that fails again does not restart the clock.
    const first = ((await store.getUserData(uid)).billing as { pastDueSince: string }).pastDueSince;
    await send(app, 'invoice.payment_failed', { customer: 'cus_g1', subscription: 'sub_g1' });
    expect(((await store.getUserData(uid)).billing as { pastDueSince: string }).pastDueSince).toBe(first);

    // Eight days later.
    await editBilling(store, uid, { pastDueSince: new Date(Date.now() - 8 * DAY).toISOString() });
    const paused = await billing(app, cookie);
    expect(paused.access).toMatchObject({ state: 'paused_payment', paused: true });
    expect(paused.access.message).toMatch(/paused until the payment goes through/);
    expect(paused.access.message).toMatch(/Monitoring/);
    expect((await ask(app, cookie)).text).toMatch(/paused until the payment goes through/);
    const data = await store.getUserData(uid);
    expect(canAfford(data, 'video').ok).toBe(false);
    expect(chargeCredits(data, 'skill_run', 'x').blocked).toBe(true);
    expect(adSpendAllowed(data).ok).toBe(false);
    // Monitoring is never gated.
    expect(canAfford(data, 'dashboard_read').ok).toBe(true);
    expect((await app.inject({ method: 'GET', url: '/api/billing/status', headers: { cookie } })).statusCode).toBe(200);

    // The card goes through: work resumes.
    await send(app, 'invoice.paid', {
      id: 'in_g1b', customer: 'cus_g1', subscription: 'sub_g1',
      lines: { data: [{ pricing: { price_details: { price: 'price_starter' } }, period: { end: Math.floor((Date.now() + 30 * DAY) / 1000) } }] },
    });
    const back = await billing(app, cookie);
    expect(back.subscription.status).toBe('active');
    expect(back.access).toMatchObject({ state: 'ok', paused: false });
    expect(back.subscription.pastDueSince).toBeUndefined();
    expect((await ask(app, cookie)).text).toBe('Answer.');
    await app.close();
  });

  it('billing still loads with no Stripe keys (mock mode), with nothing paused', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.BILLING_ENFORCE;
    const { app, cookie } = await setup('nokeys@example.com');
    const b = await billing(app, cookie);
    expect(b.paymentsConnected).toBe(false);
    expect(b.access).toEqual({ state: 'ok', paused: false });
    await app.close();
  });
});

describe('cancellation (row 76)', () => {
  it('keeps the plan working until the paid period ends, then moves to monitoring only', async () => {
    const { store, app, cookie, uid } = await setup('cancel@example.com');
    const periodEnd = Date.now() + 10 * DAY;
    await subscribe(app, uid, 'c1', periodEnd);
    await send(app, 'customer.subscription.deleted', { id: 'sub_c1', customer: 'cus_c1' });
    const canceling = await billing(app, cookie);
    expect(canceling.subscription.status).toBe('canceled');
    expect(canceling.access.state).toBe('canceling');
    expect(canceling.access.paused).toBe(false);
    expect(Math.abs(Date.parse(canceling.access.accessEndsAt) - periodEnd)).toBeLessThan(1000);
    expect((await ask(app, cookie)).text).toBe('Answer.');

    // The period ends. Credits left over (included and top-ups) stop working.
    await editBilling(store, uid, { accessEndsAt: new Date(Date.now() - 1000).toISOString() });
    const ended = await billing(app, cookie);
    expect(ended.credits.remaining).toBeGreaterThan(0);
    expect(ended.access).toMatchObject({ state: 'ended', paused: true });
    expect(ended.access.message).toMatch(/monitoring only/);
    expect(ended.access.message).toMatch(/top-ups/);
    const reply = (await ask(app, cookie)).text;
    expect(reply).toMatch(/Your plan ended/);
    expect(reply).toMatch(/Plans start at \$149 a month/);
    expect(adSpendAllowed(await store.getUserData(uid)).ok).toBe(false);
    await app.close();
  });

  it('ends at once when the paid period is already over', async () => {
    const { app, cookie, uid } = await setup('cancel-now@example.com');
    await subscribe(app, uid, 'c2', Date.now() - DAY);
    await send(app, 'customer.subscription.deleted', { id: 'sub_c2', customer: 'cus_c2' });
    expect((await billing(app, cookie)).access).toMatchObject({ state: 'ended', paused: true });
    await app.close();
  });

  it('does not run out an unpaid period when Stripe gives up on a failed card', async () => {
    const { app, cookie, uid } = await setup('cancel-unpaid@example.com');
    await subscribe(app, uid, 'c3', Date.now() + 20 * DAY);
    await send(app, 'invoice.payment_failed', { customer: 'cus_c3', subscription: 'sub_c3' });
    await send(app, 'customer.subscription.deleted', { id: 'sub_c3', customer: 'cus_c3' });
    expect((await billing(app, cookie)).access).toMatchObject({ state: 'ended', paused: true });
    await app.close();
  });

  it('treats cancel at period end as ended once that period is over, even before the deleted event', () => {
    const now = new Date('2026-11-17T12:00:00Z');
    const live = { billing: { status: 'active', band: 'starter', cancelAtPeriodEnd: true, currentPeriodEnd: '2026-11-20T00:00:00Z' } };
    expect(workAccess(live, now)).toMatchObject({ state: 'canceling', paused: false });
    const over = { billing: { status: 'active', band: 'starter', cancelAtPeriodEnd: true, currentPeriodEnd: '2026-11-16T00:00:00Z' } };
    expect(workAccess(over, now)).toMatchObject({ state: 'ended', paused: true });
  });

  it('a new checkout after cancel turns work back on', async () => {
    const { app, cookie, uid } = await setup('resub@example.com');
    await subscribe(app, uid, 'c4', Date.now() - DAY);
    await send(app, 'customer.subscription.deleted', { id: 'sub_c4', customer: 'cus_c4' });
    expect((await billing(app, cookie)).access.paused).toBe(true);
    await subscribe(app, uid, 'c5', Date.now() + 30 * DAY);
    expect((await billing(app, cookie)).access).toMatchObject({ state: 'ok', paused: false });
    await app.close();
  });
});
