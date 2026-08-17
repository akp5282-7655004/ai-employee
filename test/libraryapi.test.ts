import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';

const PASTE = [
  'Acme Roofing\nSponsored · running 40 days · 4 ads\n0% APR financing on a new roof — no payments for 12 months.',
  'Bravo Exteriors\nSponsored · running 12 days\nFree estimate on any exterior job.',
  'Charlie Roofing\nSponsored · running 8 days\nProudly serving Philadelphia since 1994.',
].join('\n\n');

async function account(industry = 'roofing') {
  const store = new MemoryStore();
  const app = buildServer({ authStore: store });
  const res = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'paul@example.com', password: 'password1', tos: true } });
  const cookie = res.headers['set-cookie'] as string;
  const user = await store.getUserByEmail('paul@example.com');
  const data = await store.getUserData(user!.id);
  data.profile = { industry, businessName: 'Philly Roofers', serviceAreas: 'Philadelphia, PA' };
  await store.setUserData(user!.id, data);
  await app.inject({ method: 'POST', url: '/api/market/ads', headers: { cookie }, payload: { text: PASTE } });
  return { app, cookie };
}

const lib = async (app: ReturnType<typeof buildServer>, cookie: string, qs = '') =>
  (await app.inject({ method: 'GET', url: '/api/library' + qs, headers: { cookie } })).json();

describe('the ad library', () => {
  it('lists every captured ad, ranked, with its offer labelled', async () => {
    const { app, cookie } = await account();
    const j = await lib(app, cookie);
    expect(j.total).toBe(6); // Acme's "· 4 ads" expands into four variants
    expect(j.ads[0].page).toBe('Acme Roofing'); // replication ranks first
    expect(j.ads[0].offerKind).toBe('financing');
    expect(j.ads.some((a: { offerKind: string }) => a.offerKind === 'branding_only')).toBe(true); // weak ads stay visible
    await app.close();
  });

  it('offers facets drawn from the whole library, not the filtered view', async () => {
    const { app, cookie } = await account();
    const filtered = await lib(app, cookie, '?advertiser=Bravo%20Exteriors');
    expect(filtered.ads).toHaveLength(1);
    // The other advertisers must still be offered, or the filter is a one-way door.
    expect(filtered.facets.advertisers.length).toBeGreaterThan(1);
    await app.close();
  });

  it('filters by advertiser, offer type and minimum age', async () => {
    const { app, cookie } = await account();
    expect((await lib(app, cookie, '?kind=free_estimate')).ads).toHaveLength(1);
    expect((await lib(app, cookie, '?minDays=20')).ads).toHaveLength(4);
    await app.close();
  });
});

describe('picking ads', () => {
  it('toggles a pick and reports what Miles read into it', async () => {
    const { app, cookie } = await account();
    const first = (await lib(app, cookie)).ads[0];
    const on = (await app.inject({ method: 'POST', url: '/api/library/select', headers: { cookie }, payload: { id: first.id } })).json();
    expect(on.count).toBe(1);
    expect(on.selection.reading).toMatch(/financing/i);

    const off = (await app.inject({ method: 'POST', url: '/api/library/select', headers: { cookie }, payload: { id: first.id } })).json();
    expect(off.count).toBe(0);
    expect(off.selection).toBeNull();
    await app.close();
  });

  it('ignores an id that is not in the library, rather than storing a ghost', async () => {
    const { app, cookie } = await account();
    const j = (await app.inject({ method: 'POST', url: '/api/library/select', headers: { cookie }, payload: { id: 'not-a-real-ad' } })).json();
    expect(j.count).toBe(0);
    await app.close();
  });

  it('survives the ads being cleared — a selection cannot outlive its ads', async () => {
    const { app, cookie } = await account();
    const first = (await lib(app, cookie)).ads[0];
    await app.inject({ method: 'POST', url: '/api/library/select', headers: { cookie }, payload: { id: first.id } });
    await app.inject({ method: 'DELETE', url: '/api/market/ads', headers: { cookie } });
    const j = await lib(app, cookie);
    expect(j.total).toBe(0);
    expect(j.selection).toBeNull();
    await app.close();
  });

  it('shows only the picks when asked', async () => {
    const { app, cookie } = await account();
    const first = (await lib(app, cookie)).ads[0];
    await app.inject({ method: 'POST', url: '/api/library/select', headers: { cookie }, payload: { id: first.id } });
    expect((await lib(app, cookie, '?selectedOnly=1')).ads).toHaveLength(1);
    await app.close();
  });
});

describe('reskinning what was picked', () => {
  it('writes copy from the shared structure, and publishes nothing', async () => {
    const { app, cookie } = await account();
    const ads = (await lib(app, cookie)).ads;
    await app.inject({ method: 'POST', url: '/api/library/select', headers: { cookie }, payload: { ids: [ads[0].id, ads[1].id], on: true } });
    const j = (await app.inject({ method: 'POST', url: '/api/library/reskin', headers: { cookie }, payload: {} })).json();
    expect(j.published).toBe(false);
    expect(j.basedOn).toHaveLength(2);
    expect(j.creatives.length).toBeGreaterThan(0);
    expect(j.note).toMatch(/nothing is live/i);
    await app.close();
  });

  it('carries none of the competitor\'s wording into the result', async () => {
    const { app, cookie } = await account();
    const ads = (await lib(app, cookie)).ads;
    await app.inject({ method: 'POST', url: '/api/library/select', headers: { cookie }, payload: { ids: [ads[0].id], on: true } });
    const j = (await app.inject({ method: 'POST', url: '/api/library/reskin', headers: { cookie }, payload: {} })).json();
    const copy = JSON.stringify(j.creatives).toLowerCase();
    expect(copy).not.toContain('no payments for 12 months');
    expect(copy).not.toContain('acme roofing');
    await app.close();
  });

  it('writes for the business\'s own trade', async () => {
    const { app, cookie } = await account('painting');
    const ads = (await lib(app, cookie)).ads;
    await app.inject({ method: 'POST', url: '/api/library/select', headers: { cookie }, payload: { ids: [ads[0].id], on: true } });
    const j = (await app.inject({ method: 'POST', url: '/api/library/reskin', headers: { cookie }, payload: {} })).json();
    const copy = JSON.stringify(j.creatives).toLowerCase();
    expect(copy).toContain('painting');
    expect(copy).not.toContain('plumbing');
    await app.close();
  });

  it('refuses when nothing has been picked', async () => {
    const { app, cookie } = await account();
    const res = await app.inject({ method: 'POST', url: '/api/library/reskin', headers: { cookie }, payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/pick at least one/i);
    await app.close();
  });

  it('requires a session throughout', async () => {
    const { app } = await account();
    expect((await app.inject({ method: 'GET', url: '/api/library' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/library/select', payload: { id: 'x' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/library/reskin', payload: {} })).statusCode).toBe(401);
    await app.close();
  });
});
