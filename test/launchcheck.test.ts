import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import { launchChecks, summarize, stripeModeOf, REQUIRED_EVENTS, type LaunchFacts, type StripeProbe } from '../src/ops/launchcheck.js';

/**
 * The launch check exists because none of what it reports fails a build or a
 * test. So the verdicts are tested as verdicts: for each way a deploy can be
 * wrong, the line that names it has to turn red, and a correct deploy has to
 * come back with nothing to fix.
 */
const SITE = 'https://miles.example.com';
const PRICES = { starter: 149, growth: 397, scale: 797 };

const goodStripe = (): StripeProbe => ({
  mode: 'live',
  prices: {
    starter: { active: true, livemode: true, interval: 'month', unitAmount: 14900 },
    growth: { active: true, livemode: true, interval: 'month', unitAmount: 39700 },
    scale: { active: true, livemode: true, interval: 'month', unitAmount: 79700 },
  },
  webhooks: [{ url: `${SITE}/api/stripe/webhook`, status: 'enabled', events: [...REQUIRED_EVENTS], livemode: true }],
});

const good = (): LaunchFacts => ({
  env: {
    APP_URL: SITE,
    STRIPE_SECRET_KEY: 'sk_live_abc',
    STRIPE_WEBHOOK_SECRET: 'whsec_abc',
    STRIPE_PRICE_STARTER: 'price_s',
    STRIPE_PRICE_GROWTH: 'price_g',
    STRIPE_PRICE_SCALE: 'price_x',
    PIPEDREAM_ENVIRONMENT: 'production',
    GOOGLE_CLIENT_ID: 'gid',
    GOOGLE_CLIENT_SECRET: 'gsecret',
    ADMIN_EMAIL: 'owner@example.com',
  },
  durableStore: true,
  connectorLive: true,
  textAiReady: true,
  emailReady: true,
  billingEnforced: true,
  bandPrices: PRICES,
  stripe: goodStripe(),
});

const failing = (f: LaunchFacts) => launchChecks(f).filter((c) => !c.ok);
const line = (f: LaunchFacts, name: RegExp) => launchChecks(f).find((c) => name.test(c.name))!;

describe('launch check verdicts', () => {
  it('reads the mode off the key prefix', () => {
    expect(stripeModeOf('sk_live_x')).toBe('live');
    expect(stripeModeOf('rk_live_x')).toBe('live');
    expect(stripeModeOf('sk_test_x')).toBe('test');
    expect(stripeModeOf('pk_live_x')).toBe('unknown'); // a publishable key cannot charge anyone
    expect(stripeModeOf(undefined)).toBe('unknown');
  });

  it('passes a correctly configured live deploy, apart from the optional events', () => {
    const bad = failing(good());
    expect(bad.map((c) => c.name)).toEqual(['Optional Stripe events']);
    expect(summarize(launchChecks(good()))).toEqual({ ready: true, blockers: 0, warnings: 1 });
  });

  it('is fully green when the webhook sends everything', () => {
    const f = good();
    (f.stripe!.webhooks as { events: string[] }[])[0]!.events = ['*'];
    expect(failing(f)).toEqual([]);
  });

  it('blocks on a test key, because real cards are declined', () => {
    const f = good();
    f.env.STRIPE_SECRET_KEY = 'sk_test_abc';
    f.stripe!.mode = 'test';
    const c = line(f, /live mode/);
    expect(c).toMatchObject({ ok: false, level: 'blocker' });
    expect(c.note).toMatch(/test key/);
    expect(summarize(launchChecks(f)).ready).toBe(false);
  });

  it('blocks on a price id from the other mode', () => {
    const f = good();
    f.stripe!.prices.growth = { error: 'No such price: [id]' };
    const c = line(f, /^Growth price/);
    expect(c).toMatchObject({ ok: false, level: 'blocker' });
    expect(c.note).toMatch(/test-mode price id beside a live key/);
  });

  it('blocks when Stripe would charge a different amount than the app advertises', () => {
    const f = good();
    f.stripe!.prices.starter = { active: true, livemode: true, interval: 'month', unitAmount: 9900 };
    const c = line(f, /^Starter price/);
    expect(c.ok).toBe(false);
    expect(c.note).toMatch(/charges \$99\.00.*advertises \$149\.00/);
  });

  it('blocks on an archived or yearly price', () => {
    const f = good();
    f.stripe!.prices.scale = { active: false, livemode: true, interval: 'year', unitAmount: 79700 };
    const c = line(f, /^Scale price/);
    expect(c.ok).toBe(false);
    expect(c.note).toMatch(/archived/);
    expect(c.note).toMatch(/not monthly/);
  });

  it('blocks when a price id is not set at all', () => {
    const f = good();
    delete f.env.STRIPE_PRICE_SCALE;
    delete f.stripe!.prices.scale;
    expect(line(f, /^Scale price/)).toMatchObject({ ok: false, level: 'blocker' });
  });

  it('blocks when no webhook points at this site', () => {
    const f = good();
    f.stripe!.webhooks = [{ url: 'https://old.example.com/api/stripe/webhook', status: 'enabled', events: ['*'], livemode: true }];
    const c = line(f, /sends events/);
    expect(c).toMatchObject({ ok: false, level: 'blocker' });
    expect(c.note).toMatch(/Payments are taken and nothing is granted/);
  });

  it('accepts a webhook pointed at the host address when the app runs on a custom domain', () => {
    const f = good();
    f.env.RENDER_EXTERNAL_URL = 'https://miles-abcd.onrender.com';
    f.stripe!.webhooks = [{ url: 'https://miles-abcd.onrender.com/api/stripe/webhook', status: 'enabled', events: ['*'], livemode: true }];
    expect(line(f, /sends events/).ok).toBe(true);
  });

  it('blocks when the webhook is disabled', () => {
    const f = good();
    (f.stripe!.webhooks as { status: string }[])[0]!.status = 'disabled';
    expect(line(f, /sends events/).note).toMatch(/disabled/);
  });

  it('names the exact event a subscription is missing', () => {
    const f = good();
    (f.stripe!.webhooks as { events: string[] }[])[0]!.events = REQUIRED_EVENTS.filter((e) => e !== 'invoice.paid');
    const c = line(f, /sends events/);
    expect(c).toMatchObject({ ok: false, level: 'blocker' });
    expect(c.note).toContain('invoice.paid');
    expect(c.note).not.toContain('checkout.session.completed');
  });

  it('only warns when the webhook list cannot be read, and says where to look', () => {
    const f = good();
    f.stripe!.webhooks = { error: 'permission denied' };
    const c = line(f, /sends events/);
    expect(c).toMatchObject({ ok: false, level: 'warn' });
    expect(c.note).toContain(`${SITE}/api/stripe/webhook`);
  });

  it('blocks on the mock connector, the memory store, no email, no AI, no webhook secret', () => {
    const f = good();
    f.connectorLive = false; f.durableStore = false; f.emailReady = false; f.textAiReady = false;
    delete f.env.STRIPE_WEBHOOK_SECRET;
    const names = failing(f).filter((c) => c.level === 'blocker').map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining([
      'Accounts are stored in Postgres', 'Webhook signing secret is set',
      'Connected to real ad and CRM accounts', 'Email can be sent', 'AI writing is on',
    ]));
  });

  it('blocks when Pipedream is still in development, where only the project owner can connect', () => {
    const f = good();
    f.env.PIPEDREAM_ENVIRONMENT = 'development';
    expect(line(f, /Customers can connect/)).toMatchObject({ ok: false, level: 'blocker' });
  });

  it('asks nothing of Stripe when there is no key, and says nobody can subscribe', () => {
    const f = good();
    delete f.env.STRIPE_SECRET_KEY;
    delete f.stripe;
    const checks = launchChecks(f);
    expect(checks.find((c) => c.name === 'Stripe is connected')).toMatchObject({ ok: false, level: 'blocker' });
    expect(checks.some((c) => /price|live mode|sends events/.test(c.name))).toBe(false);
  });

  it('treats unenforced billing and missing Google sign-in as notes, not blockers', () => {
    const f = good();
    f.billingEnforced = false;
    delete f.env.GOOGLE_CLIENT_ID;
    (f.stripe!.webhooks as { events: string[] }[])[0]!.events = ['*'];
    expect(summarize(launchChecks(f))).toEqual({ ready: true, blockers: 0, warnings: 2 });
  });

  it('never puts a key, secret or id value in its text', () => {
    const f = good();
    f.env.STRIPE_SECRET_KEY = 'sk_test_SECRETVALUE';
    f.stripe!.mode = 'test';
    const text = JSON.stringify(launchChecks(f));
    for (const v of ['SECRETVALUE', 'whsec_abc', 'price_s', 'price_g', 'price_x', 'gsecret', 'owner@example.com']) {
      expect(text).not.toContain(v);
    }
  });
});

// ── The route ──
let probe: () => Promise<StripeProbe>;
vi.mock('../src/billing/stripe.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/billing/stripe.js')>();
  return { ...actual, probeStripe: () => probe() };
});

describe('GET /api/admin/launch-check', () => {
  const ENV = ['ADMIN_EMAIL', 'APP_URL', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_STARTER', 'STRIPE_PRICE_GROWTH', 'STRIPE_PRICE_SCALE'] as const;
  const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  beforeEach(() => {
    process.env.ADMIN_EMAIL = 'owner@example.com';
    process.env.APP_URL = SITE;
    process.env.STRIPE_SECRET_KEY = 'sk_test_ROUTESECRET';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_ROUTESECRET';
    process.env.STRIPE_PRICE_STARTER = 'price_ROUTE_S';
    process.env.STRIPE_PRICE_GROWTH = 'price_ROUTE_G';
    process.env.STRIPE_PRICE_SCALE = 'price_ROUTE_X';
    probe = async () => ({ ...goodStripe(), mode: 'test' });
  });
  afterEach(() => {
    for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  });

  const signup = async (app: ReturnType<typeof buildServer>, email: string) => {
    const r = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email, password: 'password1', tos: true } });
    return String(r.headers['set-cookie']).split(';')[0]!;
  };

  it('is for the owner only', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const other = await signup(app, 'painter@example.com');
    expect((await app.inject({ method: 'GET', url: '/api/admin/launch-check' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/admin/launch-check', headers: { cookie: other } })).statusCode).toBe(403);
    await app.close();
  });

  it('reports this server honestly and leaks no secret', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const owner = await signup(app, 'owner@example.com');
    const r = await app.inject({ method: 'GET', url: '/api/admin/launch-check', headers: { cookie: owner } });
    expect(r.statusCode).toBe(200);
    const d = r.json();
    expect(d.ready).toBe(false);
    expect(d.blockers).toBeGreaterThan(0);
    const by = (name: RegExp) => d.checks.find((c: { name: string }) => name.test(c.name));
    // A test server: memory store, test key, mock connector. Each must be called out.
    expect(by(/stored in Postgres/).ok).toBe(false);
    expect(by(/live mode/).ok).toBe(false);
    expect(by(/real ad and CRM/).ok).toBe(false);
    expect(by(/^Starter price/).note).toMatch(/other Stripe mode/); // live price beside a test key
    expect(r.body).not.toMatch(/ROUTESECRET|price_ROUTE/);
    await app.close();
  });

  it('still answers when Stripe cannot be reached', async () => {
    probe = async () => { throw new Error('network down'); };
    const app = buildServer({ authStore: new MemoryStore() });
    const owner = await signup(app, 'owner@example.com');
    const r = await app.inject({ method: 'GET', url: '/api/admin/launch-check', headers: { cookie: owner } });
    expect(r.statusCode).toBe(200);
    expect(r.json().checks.find((c: { name: string }) => /sends events/.test(c.name))).toMatchObject({ ok: false, level: 'warn' });
    await app.close();
  });
});
