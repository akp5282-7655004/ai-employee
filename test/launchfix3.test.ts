import { describe, expect, it, vi } from 'vitest';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import type { Connector } from '../src/connectors/types.js';
import { signupInputProblem } from '../src/auth/signupRules.js';
import { buildBundle } from '../src/agents/journey.js';

function app() {
  const connector = {
    name: 'mock',
    async createConnectToken() { return { token: 't', expiresAt: '2099-01-01', connectUrl: 'https://connect.example' }; },
    async listAccounts() { return []; },
    async runAction() { return { ok: false, actionId: 'x', app: 'google_ads', output: null }; },
    async launchCampaign() { return { ok: false, live: false, steps: [] }; },
    async setGoogleCampaignStatus() { return { ok: false, live: false, called: false, note: 'no' }; },
  } as unknown as Connector;
  return buildServer({ authStore: new MemoryStore(), connector });
}

async function signIn(server: ReturnType<typeof buildServer>, email: string) {
  const r = await server.inject({ method: 'POST', url: '/auth/signup', payload: { email, password: 'password1', tos: true } });
  expect(r.statusCode).toBe(200);
  return { cookie: String(r.headers['set-cookie']).split(';')[0] ?? '' };
}

// A page with no trade words, so the trade can only come from the saved profile.
const plainHtml = '<html><head><title>Summit Co</title></head><body><p>Family owned since 1998. Call 501-555-0100.</p></body></html>';

const groupNames = (spec: { adGroups: { name: string }[] }) => spec.adGroups.map((g) => g.name).join(' | ');

describe('setup plan follows the saved trade', () => {
  it('buildBundle uses the industry it is given, not painting', () => {
    const bundle = buildBundle({ businessName: 'Summit Roofing', location: 'Little Rock, AR', website: 'https://summitroof.example', industry: 'Roofing', services: 'Roof repair, roof replacement', goal: 'get me leads', dailyBudget: 30, leadsPerDay: 1, googleShare: 1 });
    expect(bundle.playbook.title).toMatch(/roofing/i);
    expect(bundle.profile.industry).toBe('Roofing');
    expect(groupNames(bundle.spec)).not.toMatch(/paint/i);
  });

  it('/api/miles/questions builds a Roofing plan for a Roofing business', async () => {
    const server = app();
    const headers = await signIn(server, 'roof@example.com');
    await server.inject({ method: 'PUT', url: '/api/profile', headers, payload: { businessName: 'Summit Roofing', industry: 'Roofing', services: 'Roof repair, roof replacement', serviceAreas: 'Little Rock, AR' } });
    await server.inject({ method: 'POST', url: '/api/miles/crawl', headers, payload: { website: 'https://summitroof.example', html: plainHtml } });
    const r = await server.inject({ method: 'POST', url: '/api/miles/questions', headers, payload: { goal: 'get me leads', dailyBudget: 30, leadsPerDay: 1 } });
    expect(r.statusCode).toBe(200);
    const bundle = r.json().bundle;
    expect(bundle.playbook.title).toMatch(/roofing/i);
    expect(bundle.playbook.title).not.toMatch(/painting/i);
    expect(groupNames(bundle.spec)).not.toMatch(/paint/i);
    expect(JSON.stringify(bundle.social)).not.toMatch(/painting/i);
    await server.close();
  });

  it('/api/miles/goal/confirm with no saved bundle builds on the saved trade', async () => {
    const server = app();
    const headers = await signIn(server, 'roof-goal@example.com');
    await server.inject({ method: 'PUT', url: '/api/profile', headers, payload: { businessName: 'Summit Roofing', industry: 'Roofing', services: 'Roof repair', serviceAreas: 'Little Rock, AR', website: 'https://summitroof.example' } });
    const r = await server.inject({ method: 'POST', url: '/api/miles/goal/confirm', headers, payload: { budgetAmount: 40, budgetPeriod: 'day', leadGoal: 4, leadPeriod: 'month', choice: 'keep_budget' } });
    expect(r.statusCode).toBe(200);
    const home = await server.inject({ method: 'GET', url: '/api/miles/home', headers });
    expect(home.json().playbook.title).toMatch(/roofing/i);
    await server.close();
  });

  it('switching the trade rebuilds the saved setup and drops the old offer', async () => {
    const server = app();
    const headers = await signIn(server, 'switch@example.com');
    await server.inject({ method: 'PUT', url: '/api/profile', headers, payload: { businessName: 'Rivera Home', industry: 'Painting', services: 'Interior painting', currentOffers: '10% off interior painting', serviceAreas: 'Philadelphia, PA' } });
    await server.inject({ method: 'POST', url: '/api/miles/crawl', headers, payload: { website: 'https://rivera.example', html: plainHtml } });
    await server.inject({ method: 'POST', url: '/api/miles/questions', headers, payload: { goal: 'get me leads', dailyBudget: 25, leadsPerDay: 1, mode: 'hybrid' } });
    const before = await server.inject({ method: 'GET', url: '/api/miles/home', headers });
    expect(before.json().playbook.title).toMatch(/painting/i);
    const caps = before.json().caps;

    const put = await server.inject({ method: 'PUT', url: '/api/profile', headers, payload: { industry: 'Plumbing' } });
    expect(put.statusCode).toBe(200);
    expect(put.json().profile.industry).toBe('Plumbing');
    expect(put.json().profile.currentOffers).toBeUndefined();
    expect(put.json().profile.services).toBeUndefined();

    const after = await server.inject({ method: 'GET', url: '/api/miles/home', headers });
    expect(after.json().playbook.title).toMatch(/plumbing/i);
    expect(after.json().bundle.profile.industry).toBe('Plumbing');
    expect(after.json().caps).toEqual(caps);
    expect(after.json().mode).toBe('hybrid');
    expect(groupNames(after.json().bundle.spec)).not.toMatch(/paint/i);
    const plan = await server.inject({ method: 'GET', url: '/api/miles/plan', headers });
    expect(groupNames(plan.json().spec)).not.toMatch(/paint/i);
    await server.close();
  });

  it('first time setting a trade keeps the offer and services', async () => {
    const server = app();
    const headers = await signIn(server, 'first@example.com');
    const put = await server.inject({ method: 'PUT', url: '/api/profile', headers, payload: { businessName: 'New Co', currentOffers: 'Free estimate', services: 'Roof repair' } });
    expect(put.statusCode).toBe(200);
    const second = await server.inject({ method: 'PUT', url: '/api/profile', headers, payload: { industry: 'Roofing' } });
    expect(second.json().profile.currentOffers).toBe('Free estimate');
    expect(second.json().profile.services).toBe('Roof repair');
    await server.close();
  });
});

describe('profile edits reach the saved setup', () => {
  it('copies a new business name, website and phone into the bundle and redrafts the plan', async () => {
    const server = app();
    const headers = await signIn(server, 'rename@example.com');
    await server.inject({ method: 'PUT', url: '/api/profile', headers, payload: { businessName: 'Old Name Painting', industry: 'Painting', serviceAreas: 'Philadelphia, PA', phone: '215-555-0199' } });
    await server.inject({ method: 'POST', url: '/api/miles/crawl', headers, payload: { website: 'https://old-site.example', html: plainHtml } });
    await server.inject({ method: 'POST', url: '/api/miles/questions', headers, payload: { goal: 'get me leads', dailyBudget: 25, leadsPerDay: 1 } });
    const before = await server.inject({ method: 'GET', url: '/api/miles/plan', headers });
    expect(before.json().spec.finalUrl).toMatch(/old-site\.example/);

    const put = await server.inject({ method: 'PUT', url: '/api/profile', headers, payload: { businessName: 'New Name Painting', website: 'https://new-site.example', phone: '215-555-0123' } });
    expect(put.statusCode).toBe(200);

    const home = await server.inject({ method: 'GET', url: '/api/miles/home', headers });
    const bundle = home.json().bundle;
    expect(bundle.setup.businessName).toBe('New Name Painting');
    expect(bundle.setup.website).toMatch(/new-site\.example/);
    expect(bundle.profile.businessName).toBe('New Name Painting');
    expect(bundle.profile.website).toMatch(/new-site\.example/);
    expect(bundle.profile.phone).toBe('+12155550123');
    expect(JSON.stringify(bundle.spec)).not.toMatch(/old-site\.example/);
    const plan = await server.inject({ method: 'GET', url: '/api/miles/plan', headers });
    expect(plan.json().spec.finalUrl).toMatch(/new-site\.example/);
    expect(JSON.stringify(plan.json().spec)).not.toMatch(/old-site\.example/);
    const log = await server.inject({ method: 'GET', url: '/api/approvals', headers });
    expect(log.json().entries.map((e: { title: string }) => e.title).join(' ')).toMatch(/Website updated/);
    await server.close();
  });

  it('a save that changes nothing leaves the setup alone', async () => {
    const server = app();
    const headers = await signIn(server, 'same@example.com');
    await server.inject({ method: 'PUT', url: '/api/profile', headers, payload: { businessName: 'Same Co', industry: 'Painting', serviceAreas: 'Philadelphia, PA' } });
    await server.inject({ method: 'POST', url: '/api/miles/crawl', headers, payload: { website: 'https://same.example', html: plainHtml } });
    await server.inject({ method: 'POST', url: '/api/miles/questions', headers, payload: { goal: 'get me leads', dailyBudget: 25, leadsPerDay: 1 } });
    const before = (await server.inject({ method: 'GET', url: '/api/miles/home', headers })).json();
    await server.inject({ method: 'PUT', url: '/api/profile', headers, payload: { businessName: 'Same Co', industry: 'Painting' } });
    const after = (await server.inject({ method: 'GET', url: '/api/miles/home', headers })).json();
    expect(after.bundle.spec).toEqual(before.bundle.spec);
    expect(after.events.length).toBe(before.events.length);
    await server.close();
  });
});

describe('resend confirmation form', () => {
  it('accepts the plain HTML form post instead of returning 415', async () => {
    const server = app();
    const r = await server.inject({ method: 'POST', url: '/auth/confirm/resend', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'email=someone%40example.com' });
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatch(/new link is on the way/);
    await server.close();
  });

  it('keeps every other route JSON-only', async () => {
    const server = app();
    const r = await server.inject({ method: 'POST', url: '/auth/login', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'email=a%40example.com&password=password1' });
    expect(r.statusCode).toBe(415);
    await server.close();
  });

  it('escapes the email in the hidden field on the expired page', async () => {
    const store = new MemoryStore();
    const server = buildServer({ authStore: store });
    await store.createUser({ id: 'u-esc', email: 'a"><script>x()</script>@example.com', passwordHash: 'x', createdAt: new Date().toISOString() });
    const r = await server.inject({ method: 'GET', url: '/auth/confirm?uid=u-esc&token=nope' });
    expect(r.statusCode).toBe(400);
    expect(r.body).toMatch(/This link expired/);
    expect(r.body).not.toContain('<script>x()</script>');
    expect(r.body).toContain('value="a&quot;&gt;&lt;script&gt;x()&lt;/script&gt;@example.com"');
    await server.close();
  });
});

describe('signup input checks', () => {
  it('rules out bad emails and weak passwords, naming the field', () => {
    expect(signupInputProblem('notanemail', 'good-password-9')).toMatchObject({ field: 'email' });
    expect(signupInputProblem('a@b', 'good-password-9')).toMatchObject({ field: 'email' });
    expect(signupInputProblem('a b@example.com', 'good-password-9')).toMatchObject({ field: 'email' });
    expect(signupInputProblem('', 'good-password-9')).toMatchObject({ field: 'email' });
    expect(signupInputProblem('owner@example.com', '123456')).toMatchObject({ field: 'password' });
    expect(signupInputProblem('owner@example.com', 'aaaaaaaa')).toMatchObject({ field: 'password' });
    expect(signupInputProblem('owner@example.com', 'Password')).toMatchObject({ field: 'password' });
    expect(signupInputProblem('owner@example.com', '12345678')).toMatchObject({ field: 'password' });
    expect(signupInputProblem('owner@example.com', 'good-password-9')).toBeNull();
  });

  it('/auth/signup returns { error, field } and creates nothing', async () => {
    const server = app();
    const cases: [string, string, string][] = [
      ['notanemail', 'good-password-9', 'email'],
      ['owner@example.com', '123456', 'password'],
      ['owner@example.com', 'aaaaaaaaaa', 'password'],
      ['owner@example.com', 'qwerty123', 'password'],
    ];
    for (const [email, password, field] of cases) {
      const r = await server.inject({ method: 'POST', url: '/auth/signup', payload: { email, password, tos: true } });
      expect(r.statusCode).toBe(400);
      expect(r.json().field).toBe(field);
      expect(typeof r.json().error).toBe('string');
    }
    const ok = await server.inject({ method: 'POST', url: '/auth/signup', payload: { email: '  Owner@Example.com ', password: 'good-password-9', tos: true } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user.email).toBe('owner@example.com');
    await server.close();
  });
});

describe('Start free opens Sign up', () => {
  it('GET /signup redirects to the Sign up tab and keeps the link parameters', async () => {
    const server = app();
    const plain = await server.inject({ method: 'GET', url: '/signup' });
    expect(plain.statusCode).toBeGreaterThanOrEqual(300);
    expect(plain.statusCode).toBeLessThan(400);
    expect(plain.headers.location).toBe('/login?signup=1');
    const tagged = await server.inject({ method: 'GET', url: '/signup?utm_source=duda&invite=abc' });
    expect(tagged.headers.location).toBe('/login?signup=1&utm_source=duda&invite=abc');
    await server.close();
  });

  it('the login page opens the Sign up tab for ?signup=1 and #signup', async () => {
    const server = app();
    const page = await server.inject({ method: 'GET', url: '/login' });
    expect(page.body).toMatch(/params\.get\('signup'\)==='1'/);
    expect(page.body).toMatch(/location\.hash==='#signup'/);
    expect(page.body).toContain('id="email-err"');
    expect(page.body).toContain('id="password-err"');
    await server.close();
  });
});

describe('favicon and name', () => {
  it('serves the Miles mark as an SVG icon', async () => {
    const server = app();
    for (const url of ['/favicon.ico', '/favicon.svg']) {
      const r = await server.inject({ method: 'GET', url });
      expect(r.statusCode).toBe(200);
      expect(String(r.headers['content-type'])).toMatch(/image\/svg\+xml/);
      expect(r.body).toMatch(/^<svg /);
    }
    const app1 = await server.inject({ method: 'GET', url: '/login' });
    expect(app1.body).toMatch(/<title>Miles, Sign in<\/title>/);
    const privacy = await server.inject({ method: 'GET', url: '/privacy' });
    expect(privacy.body).toMatch(/<title>Miles, /);
    await server.close();
  });
});

describe('dashboard snapshot after a connection change', () => {
  function liveish() {
    const accounts: { id: string; app: string; name: string; externalUserId: string; healthy: boolean }[] = [];
    const connector = {
      name: 'mock',
      async createConnectToken() { return { token: 't', expiresAt: '2099-01-01', connectUrl: 'https://connect.example' }; },
      async listAccounts() { return accounts.slice(); },
      async disconnectAccount(_u: string, id: string) {
        const i = accounts.findIndex((a) => a.id === id);
        if (i < 0) return { ok: false, note: 'Account not found.' };
        accounts.splice(i, 1);
        return { ok: true };
      },
      async getAdSpend() {
        return accounts.some((a) => a.app === 'google_ads') ? [{ campaign: 'Search', spend: 2840, conversions: 3, platform: 'google_ads' }] : [];
      },
      async runAction() { return { ok: false, actionId: 'x', app: 'google_ads', output: null }; },
    } as unknown as Connector;
    const store = new MemoryStore();
    return { server: buildServer({ authStore: store, connector }), store, accounts };
  }

  it('rebuilds the stored snapshot on disconnect, so the old spend is gone', async () => {
    const { server, store, accounts } = liveish();
    const signed = await server.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'disc@example.com', password: 'password1', tos: true } });
    const headers = { cookie: String(signed.headers['set-cookie']).split(';')[0] ?? '' };
    const uid = signed.json().user.id as string;
    accounts.push({ id: 'acc_1', app: 'google_ads', name: 'Ads', externalUserId: uid, healthy: true });
    const data = await store.getUserData(uid);
    data.snapshot = { ts: new Date().toISOString(), campaigns: [{ campaign: 'Search', spend: 2840, conversions: 3 }], adSpend: 2840, deals: [], searchTerms: [], leads: [], reviews: [], social: null };
    await store.setUserData(uid, data);
    const r = await server.inject({ method: 'POST', url: '/api/connections/disconnect', headers, payload: { accountId: 'acc_1' } });
    expect(r.statusCode).toBe(200);
    const after = (await store.getUserData(uid)).snapshot as { campaigns: unknown[]; adSpend?: number } | undefined;
    expect(after?.campaigns ?? []).toEqual([]);
    expect(after?.adSpend).toBeUndefined();
    await server.close();
  });

  it('rebuilds the snapshot when a new connection shows up', async () => {
    const { server, store, accounts } = liveish();
    const signed = await server.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'conn@example.com', password: 'password1', tos: true } });
    const headers = { cookie: String(signed.headers['set-cookie']).split(';')[0] ?? '' };
    const uid = signed.json().user.id as string;
    const data = await store.getUserData(uid);
    data.snapshot = { ts: new Date().toISOString(), campaigns: [], deals: [], searchTerms: [], leads: [], reviews: [], social: null };
    await store.setUserData(uid, data);
    await server.inject({ method: 'GET', url: '/api/connections', headers });
    accounts.push({ id: 'acc_2', app: 'google_ads', name: 'Ads', externalUserId: uid, healthy: true });
    // The account list is cached for a few seconds. Move the clock past that,
    // then poll the way the connect window does.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + 60_000);
      let spend: number | undefined;
      for (let i = 0; i < 40 && spend == null; i++) {
        await server.inject({ method: 'GET', url: '/api/connections', headers });
        await new Promise((resolve) => setTimeout(resolve, 50));
        spend = ((await store.getUserData(uid)).snapshot as { adSpend?: number } | undefined)?.adSpend;
      }
      expect(spend).toBe(2840);
    } finally {
      vi.useRealTimers();
    }
    await server.close();
  }, 20_000);
});
