import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/memory.js';
import { buildSnapshot, readSnapshot, snapshotAgeMs, spendRowsOf, type PlatformSnapshot } from '../src/metrics/snapshot.js';
import type { Connector } from '../src/connectors/types.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A connector where every platform read takes `delayMs` — the real-world case
 *  the snapshot exists to hide (Pipedream → Google Ads is seconds, not ms). */
function slowConnector(delayMs: number) {
  let adSpendCalls = 0;
  const conn = {
    name: 'slow-test',
    createConnectToken: async () => ({ token: 't', expiresAt: '', connectLinkUrl: '' }),
    listAccounts: async () => [],
    runAction: async () => ({ ok: true, data: null }),
    getAdSpend: async () => {
      adSpendCalls++;
      await sleep(delayMs);
      return [
        { platform: 'google_ads', campaign: 'Labs — Exact', utm: 'labs_exact', spend: 420.5, clicks: 90, conversions: 6 },
        { platform: 'facebook', campaign: 'Retarget', utm: 'retarget', spend: 79.5, clicks: 40, conversions: 1 },
      ];
    },
    getDeals: async () => { await sleep(delayMs); return [{ id: 'd1', value: 2400, won: true, utmCampaign: 'labs_exact' }]; },
    getLeads: async () => { await sleep(delayMs); return []; },
    getReviews: async () => { await sleep(delayMs); return []; },
  } as unknown as Connector;
  return { conn, adSpendCalls: () => adSpendCalls };
}

describe('platform snapshot', () => {
  it('reads every platform once, keeps full campaign rows, and totals spend', async () => {
    const { conn, adSpendCalls } = slowConnector(0);
    const snap = await buildSnapshot(conn, 'u1');
    expect(adSpendCalls()).toBe(1);
    expect(snap.campaigns).toHaveLength(2);
    expect(snap.campaigns[0]!.platform).toBe('google_ads'); // platform survives, not hardcoded
    expect(snap.adSpend).toBe(500);
    expect(snap.deals).toHaveLength(1);
    expect(Date.parse(snap.ts)).toBeGreaterThan(0);
  });

  it('a platform that throws contributes nothing rather than failing the refresh', async () => {
    const conn = {
      name: 'broken',
      createConnectToken: async () => ({ token: '', expiresAt: '', connectLinkUrl: '' }),
      listAccounts: async () => [],
      runAction: async () => ({ ok: true, data: null }),
      getAdSpend: async () => { throw new Error('Google Ads not connected'); },
      getDeals: async () => [{ id: 'd1', value: 100, won: true }],
    } as unknown as Connector;
    const snap = await buildSnapshot(conn, 'u1');
    expect(snap.campaigns).toEqual([]);
    expect(snap.adSpend).toBeUndefined();
    expect(snap.deals).toHaveLength(1); // the CRM still made it in
  });

  it('projects the campaign-name/cost shape the skills read', () => {
    const snap = { campaigns: [{ platform: 'google_ads', campaign: 'A', utm: 'a', spend: 10, conversions: 2 }] } as PlatformSnapshot;
    expect(spendRowsOf(snap)).toEqual([{ campaign: 'A', cost: 10, conversions: 2 }]);
    expect(spendRowsOf(undefined)).toEqual([]);
  });

  it('treats a missing or malformed snapshot as infinitely stale', () => {
    expect(readSnapshot({})).toBeUndefined();
    expect(readSnapshot({ snapshot: { ts: 42 } })).toBeUndefined();
    expect(snapshotAgeMs(undefined)).toBe(Number.POSITIVE_INFINITY);
    expect(snapshotAgeMs({ ts: 'not-a-date' } as PlatformSnapshot)).toBe(Number.POSITIVE_INFINITY);
    expect(snapshotAgeMs({ ts: new Date().toISOString() } as PlatformSnapshot)).toBeLessThan(1000);
  });
});

describe('dashboard served from the snapshot', () => {
  /** Sign up and return the session cookie. */
  async function session(app: ReturnType<typeof buildServer>) {
    const res = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'paul@example.com', password: 'password1', tos: true } });
    expect(res.statusCode).toBe(200);
    return res.headers['set-cookie'] as string;
  }

  it('pays the platform cost once, then serves later loads without touching it', async () => {
    const { conn, adSpendCalls } = slowConnector(120);
    const app = buildServer({ authStore: new MemoryStore(), connector: conn });
    const cookie = await session(app);

    const t0 = Date.now();
    const first = await app.inject({ method: 'GET', url: '/api/dashboard', headers: { cookie } });
    const firstMs = Date.now() - t0;
    expect(first.statusCode).toBe(200);
    expect(first.json().marketing.spend).toBe(500);
    expect(firstMs).toBeGreaterThanOrEqual(100); // it really did wait on the platform

    // Second load: the snapshot is fresh, so no platform is contacted at all.
    const t1 = Date.now();
    const second = await app.inject({ method: 'GET', url: '/api/dashboard', headers: { cookie } });
    const secondMs = Date.now() - t1;
    expect(second.statusCode).toBe(200);
    expect(second.json().marketing.spend).toBe(500);
    expect(secondMs).toBeLessThan(50);
    expect(adSpendCalls()).toBe(1); // one read total, not one per request

    await app.close();
  });

  it('a burst of parallel loads shares a single platform read', async () => {
    const { conn, adSpendCalls } = slowConnector(80);
    const app = buildServer({ authStore: new MemoryStore(), connector: conn });
    const cookie = await session(app);

    const results = await Promise.all(
      Array.from({ length: 6 }, () => app.inject({ method: 'GET', url: '/api/dashboard', headers: { cookie } })),
    );
    for (const r of results) expect(r.statusCode).toBe(200);
    expect(adSpendCalls()).toBe(1); // no stampede

    await app.close();
  });
});
