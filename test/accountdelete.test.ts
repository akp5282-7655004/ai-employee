import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';

/**
 * Deleting an account with a live subscription. The Stripe cancel is the one
 * call mocked: it returns `{ error }` (as the real helper does when Stripe
 * fails), and the account, its data, and its session must all survive.
 */
let cancelResult: { ok: true } | { error: string } = { ok: true };
const cancelCalls: string[] = [];
const sent: string[] = [];

vi.mock('../src/billing/stripe.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/billing/stripe.js')>();
  return {
    ...actual,
    stampCustomer: async () => undefined,
    cancelStripeSubscription: async (subscriptionId: string) => { cancelCalls.push(subscriptionId); return cancelResult; },
  };
});
vi.mock('../src/delivery/send.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/delivery/send.js')>();
  return {
    ...actual,
    deliveryStatus: () => ({ ...actual.deliveryStatus(), email: true }),
    sendEmail: async (_to: string, subject: string) => { sent.push(subject); },
  };
});

const WEBHOOK_SECRET = 'whsec_delete_test';
const signer = new Stripe('sk_test_unused');
const ENV = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'] as const;
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  cancelCalls.length = 0;
  sent.length = 0;
});
afterEach(() => {
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

async function subscribed() {
  const store = new MemoryStore();
  const app = buildServer({ authStore: store });
  const signed = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'leaving@example.com', password: 'password1', tos: true } });
  const cookie = String(signed.headers['set-cookie']).split(';')[0] ?? '';
  const uid = (await store.listUserIds())[0]!;
  const payload = JSON.stringify({ id: 'evt_checkout', object: 'event', type: 'checkout.session.completed', data: { object: { client_reference_id: uid, customer: 'cus_9', subscription: 'sub_9' } } });
  const header = signer.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const hooked = await app.inject({ method: 'POST', url: '/api/stripe/webhook', headers: { 'content-type': 'application/json', 'stripe-signature': header }, payload });
  expect(hooked.statusCode).toBe(200);
  return { app, store, uid, cookie };
}

describe('deleting an account with a subscription', () => {
  it('keeps the account and says so when Stripe will not cancel', async () => {
    cancelResult = { error: "Couldn't reach Stripe: timeout" };
    const { app, store, uid, cookie } = await subscribed();
    const r = await app.inject({ method: 'POST', url: '/api/account/delete', headers: { cookie }, payload: { confirm: 'DELETE' } });
    expect(r.statusCode).toBe(502);
    expect(r.json()).toMatchObject({ ok: false, deleted: false });
    expect(r.json().error).toMatch(/could not cancel your subscription/i);
    expect(r.json().error).toMatch(/not deleted/);
    expect(cancelCalls).toEqual(['sub_9']);
    expect(sent.some((subject) => /deleted/i.test(subject))).toBe(false);
    expect(await store.getUserById(uid)).not.toBeNull();
    const me = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    await app.close();
  });

  it('deletes once the subscription is cancelled', async () => {
    cancelResult = { ok: true };
    const { app, store, uid, cookie } = await subscribed();
    const r = await app.inject({ method: 'POST', url: '/api/account/delete', headers: { cookie }, payload: { confirm: 'DELETE' } });
    expect(r.statusCode).toBe(200);
    expect(r.json().ok).toBe(true);
    expect(cancelCalls).toEqual(['sub_9']);
    expect(sent.some((subject) => /deleted/i.test(subject))).toBe(true);
    expect(await store.getUserById(uid)).toBeNull();
    await app.close();
  });
});
