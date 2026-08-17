import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';

/** A market where financing clearly outlasts branding. */
const PASTE = [
  ...Array.from({ length: 5 }, (_, i) => `Acme Roofing ${i}\nSponsored · running ${40 + i} days\n0% APR financing on a new roof — no payments for 12 months.`),
  ...Array.from({ length: 5 }, (_, i) => `Bravo Exteriors ${i}\nSponsored · running ${5 + i} days\nProudly serving Philadelphia homeowners since 1994.`),
].join('\n\n');

async function account(profile: Record<string, string> = { industry: 'roofing', serviceAreas: 'Philadelphia, PA' }) {
  const store = new MemoryStore();
  const app = buildServer({ authStore: store });
  const res = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'paul@example.com', password: 'password1', tos: true } });
  const cookie = res.headers['set-cookie'] as string;
  const user = await store.getUserByEmail('paul@example.com');
  const data = await store.getUserData(user!.id);
  data.profile = profile;
  await store.setUserData(user!.id, data);
  return { app, cookie };
}

describe('market scan', () => {
  it('says plainly that there is nothing to analyse yet, rather than showing zeros as findings', async () => {
    const { app, cookie } = await account();
    const scan = (await app.inject({ method: 'GET', url: '/api/market/scan', headers: { cookie } })).json();
    expect(scan.stats.adsAnalyzed).toBe(0);
    expect(scan.note).toMatch(/does not return US commercial ads/i);
    expect(scan.brief).toBeNull(); // no guess from an empty market
    await app.close();
  });

  it('captures pasted ads and reads the market from them', async () => {
    const { app, cookie } = await account();
    const add = await app.inject({ method: 'POST', url: '/api/market/ads', headers: { cookie }, payload: { text: PASTE } });
    expect(add.statusCode).toBe(200);
    expect(add.json().added).toBe(10);

    const scan = (await app.inject({ method: 'GET', url: '/api/market/scan', headers: { cookie } })).json();
    expect(scan.stats.adsAnalyzed).toBe(10);
    expect(scan.stats.advertisersSeen).toBe(10);
    expect(scan.sources.captured).toBe(10);
    expect(scan.offerMix[0].kind).toBe('financing');
    expect(scan.survival[0].kind).toBe('financing');
    expect(scan.brief.kind).toBe('financing');
    await app.close();
  });

  it('reports where every ad came from, so an empty API is visible not silent', async () => {
    const { app, cookie } = await account();
    await app.inject({ method: 'POST', url: '/api/market/ads', headers: { cookie }, payload: { text: PASTE } });
    const scan = (await app.inject({ method: 'GET', url: '/api/market/scan', headers: { cookie } })).json();
    expect(scan.sources).toMatchObject({ adLibraryApi: 0, captured: 10, places: false });
    expect(scan.note).toMatch(/what you pasted in/i);
    expect(scan.placesConfigured).toBe(false); // no key — reported, never faked
    expect(scan.competitors).toEqual([]);
    await app.close();
  });

  it('adds to the set across sittings, and can replace or clear it', async () => {
    const { app, cookie } = await account();
    await app.inject({ method: 'POST', url: '/api/market/ads', headers: { cookie }, payload: { text: PASTE } });
    const more = await app.inject({ method: 'POST', url: '/api/market/ads', headers: { cookie }, payload: { text: 'Charlie Roofing\nrunning 20 days\nFree roof inspection.' } });
    expect(more.json().total).toBe(11);

    const replaced = await app.inject({ method: 'POST', url: '/api/market/ads', headers: { cookie }, payload: { text: 'Delta Roofing\nrunning 9 days\nFree estimate.', replace: true } });
    expect(replaced.json().total).toBe(1);

    await app.inject({ method: 'DELETE', url: '/api/market/ads', headers: { cookie } });
    expect((await app.inject({ method: 'GET', url: '/api/market/scan', headers: { cookie } })).json().stats.adsAnalyzed).toBe(0);
    await app.close();
  });

  it('explains an unreadable paste instead of silently accepting nothing', async () => {
    const { app, cookie } = await account();
    const res = await app.inject({ method: 'POST', url: '/api/market/ads', headers: { cookie }, payload: { text: 'Acme Roofing' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/advertiser name/i);
    await app.close();
  });

  it('requires a session — a market read is account data', async () => {
    const { app } = await account();
    expect((await app.inject({ method: 'GET', url: '/api/market/scan' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/market/ads', payload: { text: PASTE } })).statusCode).toBe(401);
    await app.close();
  });
});

describe('turning the winning angle into an ad', () => {
  it('generates copy for the surviving offer type, and publishes nothing', async () => {
    const { app, cookie } = await account();
    await app.inject({ method: 'POST', url: '/api/market/ads', headers: { cookie }, payload: { text: PASTE } });
    const res = await app.inject({ method: 'POST', url: '/api/market/generate', headers: { cookie }, payload: {} });
    expect(res.statusCode).toBe(200);
    const out = res.json();
    expect(out.kind).toBe('financing');
    expect(out.published).toBe(false);
    expect(out.creatives.length).toBeGreaterThan(0);
    expect(out.note).toMatch(/nothing is live/i);
    await app.close();
  });

  it('never reuses a competitor\'s wording in the generated copy', async () => {
    const { app, cookie } = await account();
    await app.inject({ method: 'POST', url: '/api/market/ads', headers: { cookie }, payload: { text: PASTE } });
    const out = (await app.inject({ method: 'POST', url: '/api/market/generate', headers: { cookie }, payload: {} })).json();
    const everything = JSON.stringify(out.creatives).toLowerCase();
    expect(everything).not.toContain('no payments for 12 months'); // the competitor's line
    expect(everything).not.toContain('acme roofing');
    await app.close();
  });

  it('writes copy for the business\'s actual trade', async () => {
    const { app, cookie } = await account({ industry: 'painting', serviceAreas: 'Philadelphia, PA', businessName: 'Painters In Philly' });
    await app.inject({ method: 'POST', url: '/api/market/ads', headers: { cookie }, payload: { text: PASTE } });
    const out = (await app.inject({ method: 'POST', url: '/api/market/generate', headers: { cookie }, payload: {} })).json();
    const copy = JSON.stringify(out.creatives).toLowerCase();
    // The profile stores the trade under `industry`; reading an unset `category`
    // used to fall back to plumbing copy for every business on the platform.
    expect(copy).not.toContain('plumbing');
    expect(copy).toContain('painting');
    await app.close();
  });

  it('lets the owner supply their own offer line, since it is their promise to keep', async () => {
    const { app, cookie } = await account();
    await app.inject({ method: 'POST', url: '/api/market/ads', headers: { cookie }, payload: { text: PASTE } });
    const out = (await app.inject({
      method: 'POST', url: '/api/market/generate', headers: { cookie },
      payload: { offer: '6 months interest-free, approved on the spot' },
    })).json();
    expect(out.offer).toBe('6 months interest-free, approved on the spot');
    expect(JSON.stringify(out.creatives)).toContain('6 months interest-free');
    await app.close();
  });

  it('refuses to invent an angle when the market has not been read', async () => {
    const { app, cookie } = await account();
    const res = await app.inject({ method: 'POST', url: '/api/market/generate', headers: { cookie }, payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/not enough competitor ads/i);
    await app.close();
  });
});
