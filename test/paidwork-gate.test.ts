import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import type { Connector } from '../src/connectors/types.js';

/**
 * An account with no credits must not reach a paid provider.
 *
 * The operator pays for every model call. Six write routes let an account with
 * an empty balance run one anyway, because the check lived at individual call
 * sites and those six never got one. The gate now sits inside the provider
 * modules, so these tests ask the question the gate answers: with the balance
 * at zero, does any request leave the building?
 */
let paid: string[] = [];
const ENV = ['BILLING_ENFORCE', 'OPENROUTER_API_KEY', 'FAL_KEY', 'CRON_SECRET'] as const;
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));

beforeEach(() => {
  process.env.BILLING_ENFORCE = '1';
  process.env.OPENROUTER_API_KEY = 'sk-or-test';
  process.env.FAL_KEY = 'fal-test';
  process.env.CRON_SECRET = 'cron-test';
  paid = [];
  const real = globalThis.fetch;
  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
    const url = String(typeof input === 'string' ? input : (input as { url?: string })?.url ?? input);
    if (/openrouter\.ai|anthropic\.com|fal\.run|fal\.ai/.test(url)) {
      paid.push(url);
      return new Response(JSON.stringify({
        model: 'openai/gpt-4o-mini', usage: { prompt_tokens: 100, completion_tokens: 100, cost: 0.001 },
        choices: [{ message: { content: '{"intent":"unknown","text":"stub"}' } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (/^https?:\/\/(127\.0\.0\.1|localhost)/.test(url)) return real(input as Parameters<typeof fetch>[0], init);
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

const PROFILE = { businessName: 'Ace Roofing', industry: 'Roofing', website: 'https://ace.example', serviceAreas: 'Little Rock, AR', services: 'Roof repair', phone: '5015550142', dailyBudget: 40 };

/** Three connected tools is what unlocks the $100 launch credit. */
function threeTools(): Connector {
  return {
    name: 'mock',
    async createConnectToken() { return { token: 't', expiresAt: '2099-01-01', connectUrl: 'https://connect.example' }; },
    async listAccounts() {
      return [
        { id: 'g', app: 'google_my_business', externalUserId: 'u', name: 'Profile', healthy: true },
        { id: 'm', app: 'facebook_pages', externalUserId: 'u', name: 'Page', healthy: true },
        { id: 'c', app: 'gohighlevel', externalUserId: 'u', name: 'CRM', healthy: true },
      ];
    },
    async runAction() { return { ok: false, actionId: 'x', app: 'x', output: null }; },
    async describeConnections() { return []; },
  } as unknown as Connector;
}

async function account(opts: { funded?: boolean } = {}) {
  const app = buildServer({ authStore: new MemoryStore(), ...(opts.funded ? { connector: threeTools() } : {}) });
  const s = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: `u${Math.random().toString(36).slice(2, 8)}@example.com`, password: 'password1', tos: true } });
  const cookie = String(s.headers['set-cookie']).split(';')[0]!;
  await app.inject({ method: 'PUT', url: '/api/profile', headers: { cookie }, payload: PROFILE });
  const post = (url: string, body: unknown) => app.inject({ method: 'POST', url, headers: { cookie, 'content-type': 'application/json' }, payload: JSON.stringify(body) });
  const get = (url: string) => app.inject({ method: 'GET', url, headers: { cookie } });
  const balance = async () => (await get('/api/billing')).json().credits.remaining as number;
  return { app, cookie, post, get, balance };
}

/** The routes that were found reaching a model on an empty balance. */
const WAS_LEAKING: [string, Record<string, unknown>][] = [
  ['/api/message', { text: 'Write a Google ad for roof repair' }],
  ['/api/campaign/autofill', { dailyBudget: 20 }],
  ['/api/audit', { url: 'https://ace.example' }],
  ['/api/team/campaign', { goal: 'Get more roofing leads' }],
  ['/api/studio/optimize', { prompt: 'roof ad', kind: 'copy' }],
  ['/api/email/compose', { to: 'a@example.com', goal: 'follow up on a roof quote' }],
];

describe('an empty balance does not reach a paid provider', () => {
  it('answers 402 with the reason and makes no provider call, on every route that used to leak', async () => {
    const a = await account();
    expect(await a.balance()).toBe(0);
    for (const [url, body] of WAS_LEAKING) {
      paid = [];
      const r = await a.post(url, body);
      expect(paid, `${url} called a paid provider`).toEqual([]);
      expect(r.statusCode, url).toBe(402);
      expect(r.json(), url).toMatchObject({ ok: false, outOfCredits: true });
      expect(r.json().error, url).toMatch(/Connect 3 tools|Plan & Credits/);
    }
    await a.app.close();
  });

  it('tells a brand-new account about the free way forward, not only the paid one', async () => {
    const a = await account();
    const r = await a.post('/api/message', { text: 'hello' });
    expect(r.json().error).toMatch(/Connect 3 tools on Integrations to unlock \$100/);
    expect(r.json().error).toMatch(/\$149 a month/);
    await a.app.close();
  });

  it('makes no provider call from any write route in the server', async () => {
    // Every POST and PUT, with a body generous enough to get past most input
    // checks. A route added later is swept the day it is added.
    const a = await account();
    const src = readFileSync('src/server.ts', 'utf8');
    const routes = [...src.matchAll(/app\.(post|put)(?:<[^(]*>)?\('([^']+)'/g)]
      .map((m) => ({ method: m[1]!.toUpperCase() as 'POST' | 'PUT', url: m[2]! }))
      .filter((r) => !/^\/auth|\/api\/admin|account\/delete|stripe\/webhook|\/api\/reset|billing\/(checkout|portal|topup)|cron\/tick/.test(r.url));
    expect(routes.length).toBeGreaterThan(80);
    const body = {
      text: 'Write a Google ad for roof repair', message: 'Write a Google ad', prompt: 'roof ad', goal: 'Get more roofing leads', kind: 'copy', type: 'copy',
      key: 'social_content', skill: 'ads', name: 'Test', service: 'Roof repair', url: 'https://ace.example', website: 'https://ace.example', platform: 'google',
      to: 'a@example.com', subject: 'Hi', body: 'Hello', brief: 'roof promo', topic: 'roof repair', zip: '72201', zips: ['72201'], id: 'x', confirm: true,
      task: 'write a post', spec: { kind: 'copy', name: 'x', prompt: 'roof ad' }, lead: { name: 'Al', phone: '5015550100', message: 'need a roof' },
      phone: '5015550100', description: 'roof ad', count: 1, format: 'image', aspect: '1:1', dailyBudget: 20, enabled: true,
    };
    paid = [];
    for (const r of routes) {
      const url = r.url.replace(':key', 'social_content').replace(':platform', 'google').replace(':name', 'ads').replace(':token', 'x');
      await a.app.inject({ method: r.method, url, headers: { cookie: a.cookie, 'content-type': 'application/json' }, payload: JSON.stringify(body) }).catch(() => undefined);
    }
    expect(paid).toEqual([]);
    await a.app.close();
  }, 120_000);

  it('still loads the pages an out-of-credits owner needs', async () => {
    const a = await account();
    for (const url of ['/api/dashboard', '/api/billing', '/api/profile', '/api/leads', '/api/miles/home', '/api/reports/marketing', '/api/setup/tools']) {
      expect((await a.get(url)).statusCode, url).toBe(200);
    }
    // And work that costs nothing to serve is not refused.
    expect((await a.post('/api/campaign/draft', { goal: 'leads' })).statusCode).toBe(200);
    expect((await a.post('/api/leads', { name: 'Al', phone: '501-555-0100', confirm: true })).statusCode).toBe(200);
    expect(paid).toEqual([]);
    await a.app.close();
  });

  it('lets a funded account through, and the call is made', async () => {
    const a = await account({ funded: true });
    expect(await a.balance()).toBe(100);
    const r = await a.post('/api/campaign/autofill', { dailyBudget: 20 });
    expect(r.statusCode).toBe(200);
    expect(paid.length).toBeGreaterThan(0);
    await a.app.close();
  });

  it('does nothing when enforcement is off', async () => {
    process.env.BILLING_ENFORCE = '0';
    const a = await account();
    const r = await a.post('/api/campaign/autofill', { dailyBudget: 20 });
    expect(r.statusCode).toBe(200);
    expect(paid.length).toBeGreaterThan(0);
    await a.app.close();
  });
});

describe('work nobody is waiting on', () => {
  const dueNow = () => {
    const now = new Date();
    return {
      id: 'a1', name: 'Morning post', task: 'social_content', enabled: true, tzOffset: 0, createdAt: now.toISOString(),
      time: `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`, days: [now.getUTCDay()],
    };
  };
  const tick = (app: Awaited<ReturnType<typeof account>>['app']) =>
    app.inject({ method: 'POST', url: '/api/cron/tick', headers: { 'x-cron-secret': 'cron-test' } });

  it('does not run a scheduled agent for an account with no credits, and runs it once funded', async () => {
    const broke = await account();
    await broke.app.inject({ method: 'PUT', url: '/api/schedules', headers: { cookie: broke.cookie }, payload: { agents: [dueNow()] } });
    paid = [];
    expect((await tick(broke.app)).statusCode).toBe(200);
    expect(paid).toEqual([]);
    // Still due: nothing was marked as run, so it goes the moment there are credits.
    const saved = (await broke.get('/api/schedules')).json();
    expect(JSON.stringify(saved)).not.toContain('lastRunAt');
    await broke.app.close();

    const funded = await account({ funded: true });
    await funded.app.inject({ method: 'PUT', url: '/api/schedules', headers: { cookie: funded.cookie }, payload: { agents: [dueNow()] } });
    paid = [];
    await tick(funded.app);
    expect(paid.length).toBeGreaterThan(0);
    await funded.app.close();
  });

  it('still answers a new lead with no credits, from the template, and tells the CRM it worked', async () => {
    const a = await account();
    await a.post('/api/speed-to-lead', { enabled: true, quietHours: { enabled: false } });
    const hook = (await a.get('/api/speed-to-lead')).json();
    const url = String(hook.webhook.newLead);
    const path = url.slice(url.indexOf('/api/hooks/lead/'));
    expect(path).toMatch(/^\/api\/hooks\/lead\/.+\..+/);
    paid = [];
    const r = await a.app.inject({ method: 'POST', url: path, headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ name: 'Dana Homeowner', phone: '5015550177', service: 'roof repair' }) });
    expect(r.statusCode).toBe(200); // a 402 here would make the CRM retry or drop the lead
    expect(paid).toEqual([]);
    expect(String(r.json().message)).toMatch(/Dana|Ace Roofing/);
    await a.app.close();
  });
});
