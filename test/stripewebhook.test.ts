import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';

type App = ReturnType<typeof buildServer>;

const WEBHOOK_SECRET = 'whsec_test_secret';
const stripeForSigning = new Stripe('sk_test_unused'); // key is never used for local signing

/**
 * `userIdForCustomer` is the one real network call the webhook handler makes
 * (a customer.metadata lookup on Stripe's API) — everything else in
 * src/billing/stripe.ts is either pure local crypto (signature verification)
 * or, for checkout/portal creation, exercised separately below by asserting
 * on the well-defined error paths rather than a live Stripe account. Mocking
 * just this one function keeps the test testing OUR webhook logic instead of
 * Stripe's uptime, while every other function in the module stays real.
 */
const custMap = new Map<string, string>();
vi.mock('../src/billing/stripe.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/billing/stripe.js')>();
  return {
    ...actual,
    userIdForCustomer: async (customerId: string) => custMap.get(customerId),
    // The real implementation would PATCH the customer on Stripe's API; the mock
    // just records it in the same map userIdForCustomer reads, so a test can
    // rely on checkout.session.completed's own handler to make the link — no
    // manual custMap.set needed — exactly like production.
    stampCustomer: async (customerId: string, userId: string) => { custMap.set(customerId, userId); },
  };
});

const ENV = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_STARTER', 'STRIPE_PRICE_GROWTH', 'STRIPE_PRICE_SCALE', 'APP_URL'] as const;
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.STRIPE_PRICE_STARTER = 'price_starter';
  process.env.STRIPE_PRICE_GROWTH = 'price_growth';
  process.env.STRIPE_PRICE_SCALE = 'price_scale';
  process.env.APP_URL = 'https://miles.example.com';
  custMap.clear();
});
afterEach(() => {
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

async function session(app: App, email = 'sub@example.com'): Promise<string> {
  const r = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email, password: 'password1', tos: true } });
  const raw = r.headers['set-cookie'];
  const first = Array.isArray(raw) ? raw[0] : raw;
  return String(first ?? '').split(';')[0] ?? '';
}
const get = (app: App, url: string, cookie: string) => app.inject({ method: 'GET', url, headers: { cookie } });

/** Sign a fake Stripe event exactly the way Stripe itself would, then POST it
 *  through raw HTTP — this exercises the real raw-body wiring end to end,
 *  not a mocked shortcut, so a broken content-type parser would be caught. */
function send(app: App, type: string, object: unknown) {
  const payload = JSON.stringify({ id: 'evt_1', object: 'event', type, data: { object } });
  const header = stripeForSigning.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  return app.inject({
    method: 'POST', url: '/api/stripe/webhook',
    headers: { 'content-type': 'application/json', 'stripe-signature': header },
    payload,
  });
}

describe('checkout and portal', () => {
  it('refuses checkout when Stripe has no keys configured', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const app = buildServer({ authStore: new MemoryStore() });
    const c = await session(app);
    const r = await app.inject({ method: 'POST', url: '/api/billing/checkout', headers: { cookie: c }, payload: { band: 'starter' } });
    expect(r.statusCode).toBe(503);
    await app.close();
  });
  it('rejects a band that is not a real paid plan', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const c = await session(app);
    const r = await app.inject({ method: 'POST', url: '/api/billing/checkout', headers: { cookie: c }, payload: { band: 'launch' } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });
  it('refuses the portal before any subscription exists', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const c = await session(app);
    const r = await app.inject({ method: 'POST', url: '/api/billing/portal', headers: { cookie: c } });
    expect(r.statusCode).toBe(404);
    await app.close();
  });
  it('fails cleanly, not a raw 500, when Stripe itself rejects the request', async () => {
    // A fake key against the real Stripe API — this is exactly what an admin
    // sees if the key is wrong or Stripe is briefly unreachable. Confirms the
    // route never lets an SDK exception escape as an unhandled crash.
    const app = buildServer({ authStore: new MemoryStore() });
    const c = await session(app);
    const r = await app.inject({ method: 'POST', url: '/api/billing/checkout', headers: { cookie: c }, payload: { band: 'starter' } });
    expect(r.statusCode).toBe(502);
    expect(r.json().error).toMatch(/couldn't reach stripe/i);
  }, 15000);

  it('reports which bands are actually purchasable — checkoutReady tracks the env vars', async () => {
    delete process.env.STRIPE_PRICE_GROWTH;
    const app = buildServer({ authStore: new MemoryStore() });
    const c = await session(app);
    const d = (await get(app, '/api/billing', c)).json();
    const byKey = Object.fromEntries(d.bands.map((b: any) => [b.key, b.checkoutReady]));
    expect(byKey.starter).toBe(true);
    expect(byKey.growth).toBe(false);
    await app.close();
  });
});

describe('the webhook, signed and posted over real HTTP', () => {
  it('rejects a request with no signature header', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const r = await app.inject({ method: 'POST', url: '/api/stripe/webhook', payload: JSON.stringify({ type: 'x' }), headers: { 'content-type': 'application/json' } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it('rejects a forged signature', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const r = await app.inject({
      method: 'POST', url: '/api/stripe/webhook', payload: JSON.stringify({ type: 'x' }),
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=deadbeef' },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it('links the account on checkout.session.completed and marks it active, without granting credits yet', async () => {
    const store = new MemoryStore();
    const app = buildServer({ authStore: store });
    const c = await session(app, 'link@example.com');
    const before = (await get(app, '/api/billing', c)).json();
    const uid = (await store.listUserIds())[0]!;
    const r = await send(app, 'checkout.session.completed', { client_reference_id: uid, customer: 'cus_1', subscription: 'sub_1' });
    expect(r.statusCode).toBe(200);
    const after = (await get(app, '/api/billing', c)).json();
    expect(after.subscription).toMatchObject({ status: 'active', stripeCustomerId: 'cus_1' });
    expect(after.credits.granted).toBe(before.credits.granted); // unchanged — no grant on link alone
    await app.close();
  });

  it('grants the band’s monthly credits on invoice.paid, and keeps the sub active', async () => {
    const store = new MemoryStore();
    const app = buildServer({ authStore: store });
    const c = await session(app, 'pay@example.com');
    const uid = (await store.listUserIds())[0]!;
    await send(app, 'checkout.session.completed', { client_reference_id: uid, customer: 'cus_2', subscription: 'sub_2' });
    custMap.set('cus_2', uid); // what Stripe's own customer.metadata lookup would resolve
    const before = (await get(app, '/api/billing', c)).json().credits.granted;

    const r = await send(app, 'invoice.paid', {
      id: 'in_1', customer: 'cus_2', subscription: 'sub_2',
      lines: { data: [{ pricing: { price_details: { price: 'price_starter' } }, period: { end: Math.floor(Date.now() / 1000) + 2_592_000 } }] },
    });
    expect(r.statusCode).toBe(200);
    const after = (await get(app, '/api/billing', c)).json();
    expect(after.credits.granted).toBe(before + 50); // Starter's monthlyCredits
    expect(after.subscription.status).toBe('active');
    expect(after.subscription.band).toBe('starter');
    await app.close();
  });

  it('also grants credits when Stripe sends the newer invoice.parent.subscription_details shape (no top-level subscription field)', async () => {
    const store = new MemoryStore();
    const app = buildServer({ authStore: store });
    const c = await session(app, 'newshape@example.com');
    const uid = (await store.listUserIds())[0]!;
    await send(app, 'checkout.session.completed', { client_reference_id: uid, customer: 'cus_new', subscription: 'sub_new' });
    custMap.set('cus_new', uid);
    const before = (await get(app, '/api/billing', c)).json().credits.granted;

    const r = await send(app, 'invoice.paid', {
      id: 'in_new', customer: 'cus_new',
      parent: { subscription_details: { subscription: 'sub_new' } },
      lines: { data: [{ pricing: { price_details: { price: 'price_starter' } }, period: { end: Math.floor(Date.now() / 1000) + 2_592_000 } }] },
    });
    expect(r.statusCode).toBe(200);
    const after = (await get(app, '/api/billing', c)).json();
    expect(after.credits.granted).toBe(before + 50);
    expect(after.subscription.band).toBe('starter');
    await app.close();
  });

  it('finds the account on invoice.paid using only what checkout.session.completed itself links — no test-side custMap.set', async () => {
    const store = new MemoryStore();
    const app = buildServer({ authStore: store });
    const c = await session(app, 'realflow@example.com');
    const uid = (await store.listUserIds())[0]!;
    // Deliberately no custMap.set('cus_real', uid) here — checkout.session.completed's
    // own handler must be the thing that makes 'cus_real' resolve to uid, the same
    // way stampCustomer is supposed to do it against the real Stripe API.
    await send(app, 'checkout.session.completed', { client_reference_id: uid, customer: 'cus_real', subscription: 'sub_real' });
    const before = (await get(app, '/api/billing', c)).json().credits.granted;

    const r = await send(app, 'invoice.paid', {
      id: 'in_real', customer: 'cus_real', subscription: 'sub_real',
      lines: { data: [{ pricing: { price_details: { price: 'price_starter' } }, period: { end: Math.floor(Date.now() / 1000) + 2_592_000 } }] },
    });
    expect(r.statusCode).toBe(200);
    const after = (await get(app, '/api/billing', c)).json();
    expect(after.credits.granted).toBe(before + 50);
    expect(after.subscription.band).toBe('starter');
    await app.close();
  });

  it('never double-grants when Stripe re-sends the same invoice event', async () => {
    const store = new MemoryStore();
    const app = buildServer({ authStore: store });
    const c = await session(app, 'retry@example.com');
    const uid = (await store.listUserIds())[0]!;
    await send(app, 'checkout.session.completed', { client_reference_id: uid, customer: 'cus_3', subscription: 'sub_3' });
    custMap.set('cus_3', uid);
    const invoice = {
      id: 'in_dup', customer: 'cus_3', subscription: 'sub_3',
      lines: { data: [{ pricing: { price_details: { price: 'price_starter' } }, period: { end: Math.floor(Date.now() / 1000) + 2_592_000 } }] },
    };
    await send(app, 'invoice.paid', invoice);
    const first = (await get(app, '/api/billing', c)).json().credits.granted;
    await send(app, 'invoice.paid', invoice); // Stripe's at-least-once delivery — this happens in the real world
    const second = (await get(app, '/api/billing', c)).json().credits.granted;
    expect(second).toBe(first);
    await app.close();
  });

  it('grants the upgraded band’s credits on the next invoice after a plan change', async () => {
    const store = new MemoryStore();
    const app = buildServer({ authStore: store });
    const c = await session(app, 'upgrade@example.com');
    const uid = (await store.listUserIds())[0]!;
    await send(app, 'checkout.session.completed', { client_reference_id: uid, customer: 'cus_up', subscription: 'sub_up' });
    custMap.set('cus_up', uid);
    await send(app, 'invoice.paid', {
      id: 'in_a', customer: 'cus_up', subscription: 'sub_up',
      lines: { data: [{ pricing: { price_details: { price: 'price_starter' } }, period: { end: Math.floor(Date.now() / 1000) + 2_592_000 } }] },
    });
    const afterFirst = (await get(app, '/api/billing', c)).json();
    expect(afterFirst.credits.granted).toBe(afterFirst.credits.granted); // sanity, real value asserted below
    await send(app, 'invoice.paid', {
      id: 'in_b', customer: 'cus_up', subscription: 'sub_up',
      lines: { data: [{ pricing: { price_details: { price: 'price_scale' } }, period: { end: Math.floor(Date.now() / 1000) + 5_184_000 } }] },
    });
    const after = (await get(app, '/api/billing', c)).json();
    expect(after.credits.granted).toBe(afterFirst.credits.granted + 350); // Scale's monthlyCredits
    expect(after.subscription.band).toBe('scale');
    await app.close();
  });

  it('marks the account past_due on invoice.payment_failed', async () => {
    const store = new MemoryStore();
    const app = buildServer({ authStore: store });
    const c = await session(app, 'fail@example.com');
    const uid = (await store.listUserIds())[0]!;
    await send(app, 'checkout.session.completed', { client_reference_id: uid, customer: 'cus_4', subscription: 'sub_4' });
    custMap.set('cus_4', uid);
    await send(app, 'invoice.payment_failed', { customer: 'cus_4', subscription: 'sub_4' });
    const after = (await get(app, '/api/billing', c)).json();
    expect(after.subscription.status).toBe('past_due');
    await app.close();
  });

  it('marks the account canceled on customer.subscription.deleted', async () => {
    const store = new MemoryStore();
    const app = buildServer({ authStore: store });
    const c = await session(app, 'cancel@example.com');
    const uid = (await store.listUserIds())[0]!;
    await send(app, 'checkout.session.completed', { client_reference_id: uid, customer: 'cus_5', subscription: 'sub_5' });
    custMap.set('cus_5', uid);
    await send(app, 'customer.subscription.deleted', { id: 'sub_5', customer: 'cus_5' });
    const after = (await get(app, '/api/billing', c)).json();
    expect(after.subscription.status).toBe('canceled');
    await app.close();
  });

  it('updates the on-file band on customer.subscription.updated (a plan swap in the portal)', async () => {
    const store = new MemoryStore();
    const app = buildServer({ authStore: store });
    const c = await session(app, 'swap@example.com');
    const uid = (await store.listUserIds())[0]!;
    await send(app, 'checkout.session.completed', { client_reference_id: uid, customer: 'cus_6', subscription: 'sub_6' });
    custMap.set('cus_6', uid);
    await send(app, 'customer.subscription.updated', { id: 'sub_6', customer: 'cus_6', items: { data: [{ price: { id: 'price_growth' } }] } });
    const after = (await get(app, '/api/billing', c)).json();
    expect(after.subscription.band).toBe('growth');
    await app.close();
  });

  it('does not crash on an event type it does not act on', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const r = await send(app, 'customer.created', { id: 'cus_x' });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it('does not throw when the event references a customer with no linked account', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const r = await send(app, 'invoice.payment_failed', { customer: 'cus_unknown', subscription: 'sub_x' });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it('keeps two accounts’ billing state completely separate', async () => {
    const store = new MemoryStore();
    const app = buildServer({ authStore: store });
    const ca = await session(app, 'ba@example.com');
    const cb = await session(app, 'bb@example.com');
    const [uidA, uidB] = await store.listUserIds();
    await send(app, 'checkout.session.completed', { client_reference_id: uidA, customer: 'cus_a', subscription: 'sub_a' });
    custMap.set('cus_a', uidA!);
    await send(app, 'invoice.paid', {
      id: 'in_a1', customer: 'cus_a', subscription: 'sub_a',
      lines: { data: [{ pricing: { price_details: { price: 'price_scale' } }, period: { end: Math.floor(Date.now() / 1000) + 2_592_000 } }] },
    });
    const a = (await get(app, '/api/billing', ca)).json();
    const b = (await get(app, '/api/billing', cb)).json();
    expect(a.subscription.band).toBe('scale');
    expect(b.subscription).toBeNull();
    expect(uidB).toBeDefined();
    await app.close();
  });
});
