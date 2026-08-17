import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';

async function account() {
  const store = new MemoryStore();
  const app = buildServer({ authStore: store });
  const res = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'paul@example.com', password: 'password1', tos: true } });
  const cookie = res.headers['set-cookie'] as string;
  const user = await store.getUserByEmail('paul@example.com');
  const data = await store.getUserData(user!.id);
  data.profile = { industry: 'painting', businessName: 'Painters In Philly' };
  await store.setUserData(user!.id, data);
  return { app, cookie, store, uid: user!.id };
}

describe('competitive audit endpoint', () => {
  it('declares what each channel can actually see, before anything is run', async () => {
    const { app, cookie } = await account();
    const j = (await app.inject({ method: 'GET', url: '/api/competitive/audit', headers: { cookie } })).json();
    expect(j.audit).toBeNull();
    expect(j.max).toBe(5);
    const byId = Object.fromEntries(j.channels.map((c: { id: string; coverage: string }) => [c.id, c.coverage]));
    expect(byId).toMatchObject({ seo: 'crawl', local: 'crawl', google_ads: 'capture', meta: 'capture', email: 'none' });
    await app.close();
  });

  it('will not run without your own site — everything is measured relative to it', async () => {
    const { app, cookie } = await account();
    const res = await app.inject({ method: 'POST', url: '/api/competitive/audit', headers: { cookie }, payload: { competitors: ['rival.com'] } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/your website/i);
    await app.close();
  });

  it('will not run with no one to compare against', async () => {
    const { app, cookie } = await account();
    const res = await app.inject({ method: 'POST', url: '/api/competitive/audit', headers: { cookie }, payload: { url: 'mine.com', competitors: [] } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/at least one competitor/i);
    await app.close();
  });

  it('records a site it could not read, with the reason, instead of dropping the row', async () => {
    // No outbound network in test, so every fetch fails — exactly the case where
    // a silent gap in the table would be most misleading.
    const { app, cookie } = await account();
    const res = await app.inject({
      method: 'POST', url: '/api/competitive/audit', headers: { cookie },
      payload: { url: 'mine.example', competitors: ['rival-one.example', 'rival-two.example'] },
    });
    expect(res.statusCode).toBe(200);
    const a = res.json().audit;
    expect(a.audits).toHaveLength(3);
    expect(a.audits.every((x: { ok: boolean; error?: string }) => x.ok === false && !!x.error)).toBe(true);
    // Nothing measurable, so nothing is claimed.
    expect(a.gaps.every((g: { verdict: string }) => g.verdict === 'unknown')).toBe(true);
    expect(a.priorities).toEqual([]);
    await app.close();
  });

  it('remembers the sites so the owner does not retype them', async () => {
    const { app, cookie, store, uid } = await account();
    await app.inject({
      method: 'POST', url: '/api/competitive/audit', headers: { cookie },
      payload: { url: 'mine.example', competitors: ['rival-one.example'] },
    });
    const saved = (await store.getUserData(uid)).profile as Record<string, string>;
    expect(saved.website).toContain('mine.example');
    expect(saved.competitors).toContain('rival-one.example');

    const back = (await app.inject({ method: 'GET', url: '/api/competitive/audit', headers: { cookie } })).json();
    expect(back.audit).not.toBeNull();
    expect(back.competitors).toEqual(['rival-one.example']);
    await app.close();
  });

  it('caps the comparison at five rivals however many are sent', async () => {
    const { app, cookie } = await account();
    const many = Array.from({ length: 9 }, (_, i) => `rival${i}.example`);
    const a = (await app.inject({
      method: 'POST', url: '/api/competitive/audit', headers: { cookie },
      payload: { url: 'mine.example', competitors: many },
    })).json().audit;
    expect(a.audits.filter((x: { role: string }) => x.role === 'competitor')).toHaveLength(5);
    await app.close();
  });

  it('does not compare a site against itself', async () => {
    const { app, cookie } = await account();
    const a = (await app.inject({
      method: 'POST', url: '/api/competitive/audit', headers: { cookie },
      payload: { url: 'mine.example', competitors: ['mine.example', 'rival.example'] },
    })).json().audit;
    expect(a.audits.filter((x: { role: string }) => x.role === 'competitor').map((x: { url: string }) => x.url))
      .toEqual(['https://rival.example']);
    await app.close();
  });

  it('requires a session', async () => {
    const { app } = await account();
    expect((await app.inject({ method: 'GET', url: '/api/competitive/audit' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/competitive/audit', payload: { url: 'a.com' } })).statusCode).toBe(401);
    await app.close();
  });
});
