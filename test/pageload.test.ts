import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import { GHL_SLUGS } from '../src/connectors/ghlstatus.js';
import { PipedreamConnector } from '../src/connectors/pipedream.js';
import { createReadThrough } from '../src/connectors/readcache.js';
import type { Config } from '../src/config.js';
import type { Connector, ConnectedAccount } from '../src/connectors/types.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function session(app: ReturnType<typeof buildServer>, email: string) {
  const signed = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email, password: 'password1', tos: true } });
  expect(signed.statusCode).toBe(200);
  return { cookie: String(signed.headers['set-cookie']).split(';')[0] ?? '', id: signed.json().user.id as string };
}

describe('read-through cache', () => {
  it('shares one load across callers and does not repeat it while the answer is fresh', async () => {
    const reads = createReadThrough();
    let calls = 0;
    const load = async () => {
      calls++;
      await sleep(30);
      return 'ads';
    };
    const opts = { freshMs: 5_000, staleMs: 10_000, waitMs: 1_000 };
    const [a, b] = await Promise.all([reads.read('k', load, opts), reads.read('k', load, opts)]);
    expect(a).toEqual({ value: 'ads', confirmed: true });
    expect(b).toEqual({ value: 'ads', confirmed: true });
    expect(await reads.read('k', load, opts)).toEqual({ value: 'ads', confirmed: true });
    expect(calls).toBe(1);
  });

  it('does not store a timeout as the answer, then serves the finished read', async () => {
    const reads = createReadThrough();
    let calls = 0;
    let release: (value: string) => void = () => {};
    const gate = new Promise<string>((resolve) => { release = resolve; });
    const opts = { freshMs: 5_000, staleMs: 10_000, waitMs: 40 };
    const first = await reads.read('k', () => { calls++; return gate; }, opts);
    expect(first.confirmed).toBe(false);
    expect(first.value).toBeUndefined();
    const second = await reads.read('k', () => { calls++; return gate; }, opts);
    expect(second.confirmed).toBe(false);
    expect(calls).toBe(1);
    release('google');
    await gate;
    await sleep(10);
    const third = await reads.read('k', () => { calls++; return Promise.resolve('nope'); }, opts);
    expect(third).toEqual({ value: 'google', confirmed: true });
    expect(calls).toBe(1);
  });

  it('serves a stale answer immediately and refreshes it once', async () => {
    const reads = createReadThrough();
    let calls = 0;
    const opts = { freshMs: 400, staleMs: 5_000, waitMs: 1_000, errorBackoffMs: 5_000 };
    expect(await reads.read('k', async () => { calls++; return 'a'; }, opts)).toEqual({ value: 'a', confirmed: true });
    await sleep(450);
    let started = false;
    const refresh = reads.read('k', async () => { calls++; started = true; await sleep(80); return 'b'; }, opts);
    const stale = await refresh;
    expect(stale).toEqual({ value: 'a', confirmed: true });
    expect(started).toBe(true);
    const again = await reads.read('k', async () => { calls++; return 'c'; }, opts);
    expect(again.value).toBe('a');
    await sleep(120);
    expect(await reads.read('k', async () => { calls++; return 'd'; }, opts)).toEqual({ value: 'b', confirmed: true });
    expect(calls).toBe(2);
  });

  it('does not treat a failed read as a confirmed empty', async () => {
    const reads = createReadThrough();
    let calls = 0;
    const opts = { freshMs: 5_000, staleMs: 10_000, waitMs: 200, errorBackoffMs: 80 };
    const first = await reads.read('k', async () => { calls++; throw new Error('down'); }, opts);
    expect(first).toEqual({ value: undefined, confirmed: false });
    const second = await reads.read('k', async () => { calls++; return 'up'; }, opts);
    expect(second.confirmed).toBe(false);
    expect(calls).toBe(1);
    await sleep(100);
    expect(await reads.read('k', async () => { calls++; return 'up'; }, opts)).toEqual({ value: 'up', confirmed: true });
    expect(calls).toBe(2);
  });
});

describe('signed-in pages do not repeat Pipedream account work', () => {
  it('does not scan GoHighLevel again on the next page, and does not mark it connected before the scan finishes', async () => {
    let projectCalls = 0;
    let release: (rows: ConnectedAccount[]) => void = () => {};
    const gate = new Promise<ConnectedAccount[]>((resolve) => { release = resolve; });
    const connector = {
      name: 'pipedream',
      async createConnectToken() { return { token: 't', expiresAt: '2099', connectUrl: 'https://connect.example' }; },
      async listAccounts() { return []; },
      async listProjectAccounts() { projectCalls++; return gate; },
      async runAction() { return { ok: false, actionId: 'x', app: 'gohighlevel', output: null }; },
    } as unknown as Connector;
    const app = buildServer({ authStore: new MemoryStore(), connector });
    const { cookie } = await session(app, 'ghl-speed@example.com');
    const headers = { cookie };
    const t0 = Date.now();
    const first = await app.inject({ method: 'GET', url: '/api/dashboard', headers });
    const home = await app.inject({ method: 'GET', url: '/api/miles/home', headers });
    const drafts = await app.inject({ method: 'GET', url: '/api/campaign/drafts', headers });
    expect(Date.now() - t0).toBeLessThan(2_500);
    expect(first.statusCode).toBe(200);
    expect(first.json().leads.connected).toBe(false);
    expect(home.json().ghl.connected).toBe(false);
    expect(drafts.statusCode).toBe(200);
    expect(projectCalls).toBe(GHL_SLUGS.length);
    release([{ id: 'ghl1', app: 'highlevel_oauth', name: 'GHL', externalUserId: 'legacy', healthy: true }]);
    await sleep(30);
    const again = await app.inject({ method: 'GET', url: '/api/dashboard', headers });
    const profile = await app.inject({ method: 'GET', url: '/api/miles/home', headers });
    expect(again.json().leads.connected).toBe(true);
    expect(profile.json().ghl.connected).toBe(true);
    expect(profile.json().ghl.setup).toMatch(/GoHighLevel is connected/);
    const biz = await app.inject({ method: 'GET', url: '/api/profile/business', headers });
    expect(biz.json().business.accounts.ghl.pill).toBe('Connected');
    expect(biz.json().business.accounts.ghl.connect).toBe(false);
    expect(projectCalls).toBe(GHL_SLUGS.length);
    expect(again.json().marketing.platforms.metaAds.ready).toBe(false);
    await app.close();
  });

  it('a slow account list does not block every page, and the finished list is reused', async () => {
    let accountCalls = 0;
    const connector = {
      name: 'pipedream',
      async createConnectToken() { return { token: 't', expiresAt: '2099', connectUrl: 'https://connect.example' }; },
      async listAccounts() {
        accountCalls++;
        await sleep(3_000);
        return [{ id: 'apn', app: 'google_ads', externalUserId: 'u', healthy: true }];
      },
      async runAction() { return { ok: false, actionId: 'x', app: 'google_ads', output: null }; },
    } as unknown as Connector;
    const app = buildServer({ authStore: new MemoryStore(), connector });
    const { cookie } = await session(app, 'accounts-speed@example.com');
    const headers = { cookie };
    const t0 = Date.now();
    const first = await app.inject({ method: 'GET', url: '/api/dashboard', headers });
    const home = await app.inject({ method: 'GET', url: '/api/miles/home', headers });
    const conn = await app.inject({ method: 'GET', url: '/api/connections', headers });
    const bizEarly = await app.inject({ method: 'GET', url: '/api/profile/business', headers });
    expect(Date.now() - t0).toBeLessThan(2_500);
    expect(first.json().marketing.platforms.googleAds.oauth).toBe(false);
    expect(first.json().marketing.platforms.googleAds.ready).toBe(false);
    expect(first.json().marketing.platforms.metaAds.ready).toBe(false);
    expect(conn.statusCode).toBe(200);
    expect(home.statusCode).toBe(200);
    expect(accountCalls).toBe(1);
    expect(bizEarly.statusCode).toBe(200);
    expect(bizEarly.json().business.accounts.google.fix).toBe(false);
    expect(bizEarly.json().business.accounts.google.pill).toBe('Not connected');
    expect(bizEarly.json().business.accounts.meta.pill).toBe('Coming soon');
    await sleep(3_200);
    const again = await app.inject({ method: 'GET', url: '/api/dashboard', headers });
    const launch = await app.inject({ method: 'GET', url: '/api/campaign/drafts', headers });
    const biz = await app.inject({ method: 'GET', url: '/api/profile/business', headers });
    expect(accountCalls).toBe(1);
    expect(biz.json().business.accounts.google.pill).toBe('Customer ID not found');
    expect(biz.json().business.accounts.google.fix).toBe(true);
    expect(biz.json().business.accounts.ghl.pill).toBe('Not connected');
    expect(biz.json().business.accounts.meta.pill).toBe('Coming soon');
    expect(again.json().marketing.platforms.googleAds.oauth).toBe(true);
    expect(again.json().marketing.platforms.googleAds.ready).toBe(false);
    expect(again.json().marketing.connected).toBe(false);
    expect(launch.json().gadsConnected).toBe(true);
    await app.close();
  });

  it('does not rediscover Google customer ids on every dashboard open, and does not call the account ready early', async () => {
    let targets = 0;
    let release: (rows: { id: string; login: string; label: string }[]) => void = () => {};
    const gate = new Promise<{ id: string; login: string; label: string }[]>((resolve) => { release = resolve; });
    const connector = {
      name: 'pipedream',
      async createConnectToken() { return { token: 't', expiresAt: '2099', connectUrl: 'https://connect.example' }; },
      async listAccounts() { return [{ id: 'apn', app: 'google_ads', externalUserId: 'u', healthy: true }]; },
      async listAdTargets() { targets++; return gate; },
      googleAdsBlock() { return null; },
      async runAction() { return { ok: false, actionId: 'x', app: 'google_ads', output: null }; },
    } as unknown as Connector;
    const app = buildServer({ authStore: new MemoryStore(), connector });
    const { cookie } = await session(app, 'gads-speed@example.com');
    const headers = { cookie };
    const t0 = Date.now();
    const first = await app.inject({ method: 'GET', url: '/api/dashboard', headers });
    const home = await app.inject({ method: 'GET', url: '/api/miles/home', headers });
    expect(Date.now() - t0).toBeLessThan(2_500);
    expect(first.json().marketing.platforms.googleAds.oauth).toBe(true);
    expect(first.json().marketing.platforms.googleAds.ready).toBe(false);
    expect(first.json().marketing.platforms.metaAds.oauth).toBe(false);
    expect(home.statusCode).toBe(200);
    expect(targets).toBe(1);
    release([{ id: '1234567890', login: '1234567890', label: 'Paint Co' }]);
    await sleep(30);
    const again = await app.inject({ method: 'GET', url: '/api/dashboard', headers });
    const ads = await app.inject({ method: 'GET', url: '/api/ads/campaigns', headers });
    expect(targets).toBe(1);
    expect(again.json().marketing.platforms.googleAds.ready).toBe(true);
    expect(again.json().marketing.connected).toBe(true);
    expect(ads.json().googleReady).toBe(true);
    expect(ads.json().metaAds).toBe(false);
    await app.close();
  });
});

describe('Pipedream account list cache', () => {
  const cfg = { connector: 'pipedream', pipedream: { environment: 'production', projectId: 'p', clientId: 'c', clientSecret: 's' } } as Config;

  it('lists every alias together and reuses that list', async () => {
    let calls = 0;
    const starts: number[] = [];
    const client = {
      accounts: {
        list: async ({ externalUserId }: { externalUserId?: string }) => {
          calls++;
          starts.push(Date.now());
          await sleep(80);
          return { data: [{ id: `apn_${externalUserId}`, app: { nameSlug: externalUserId === 'alias' ? 'gohighlevel' : 'google_ads' }, healthy: true }] };
        },
      },
    };
    const connector = new PipedreamConnector(cfg);
    (connector as unknown as { client: unknown }).client = client;
    connector.rememberExternalIds('owner', ['alias']);
    const all = await connector.listAccounts('owner');
    expect(all.map((a) => a.app).sort()).toEqual(['gohighlevel', 'google_ads']);
    expect(calls).toBe(2);
    expect(Math.abs(starts[0]! - starts[1]!)).toBeLessThan(40);
    expect((await connector.listAccounts('owner', 'google_ads')).map((a) => a.app)).toEqual(['google_ads']);
    expect(calls).toBe(2);
  });

  it('does not keep a disconnected account in the list cache', async () => {
    let calls = 0;
    const client = {
      accounts: {
        list: async () => {
          calls++;
          return { data: [{ id: 'apn_1', app: { nameSlug: 'google_ads' }, healthy: true }] };
        },
        delete: async () => {},
      },
    };
    const connector = new PipedreamConnector(cfg);
    (connector as unknown as { client: unknown }).client = client;
    expect((await connector.listAccounts('owner')).length).toBe(1);
    expect((await connector.disconnectAccount('owner', 'apn_1')).ok).toBe(true);
    expect((await connector.listAccounts('owner')).length).toBe(1);
    expect(calls).toBe(2);
  });
});
