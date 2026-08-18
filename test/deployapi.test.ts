import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import { MAX_ACTIVE_FRAMEWORKS } from '../src/skills/deploy.js';

type App = ReturnType<typeof buildServer>;

/** Sign up and return the cookie every later call rides on. */
async function session(app: App, email = 'dep@example.com'): Promise<string> {
  const r = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email, password: 'password1', tos: true } });
  const raw = r.headers['set-cookie'];
  const first = Array.isArray(raw) ? raw[0] : raw;
  return String(first ?? '').split(';')[0] ?? '';
}
const get = (app: App, url: string, cookie: string) => app.inject({ method: 'GET', url, headers: { cookie } });
const post = (app: App, url: string, cookie: string, payload: unknown) =>
  app.inject({ method: 'POST', url, headers: { cookie }, payload: payload as object });
const del = (app: App, url: string, cookie: string, payload: unknown) =>
  app.inject({ method: 'DELETE', url, headers: { cookie }, payload: payload as object });

describe('deploying a skill', () => {
  it('starts empty and lists what can be deployed, with each skill’s cadence', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const c = await session(app);
    const d = (await get(app, '/api/deployments', c)).json();
    expect(d.skills).toEqual([]);
    expect(d.available.length).toBeGreaterThan(5);
    expect(d.available.find((s: any) => s.key === 'ad-copy-performance-ranker').cadence).toBe('monthly');
    await app.close();
  });

  it('runs the skill once on deploy, so pressing Deploy produces something today', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const c = await session(app);
    const r = await post(app, '/api/deployments', c, { kind: 'skill', id: 'loser-pauser' });
    expect(r.statusCode).toBe(200);
    expect(r.json().skills).toHaveLength(1);
    expect(r.json().skills[0].runs).toBe(1);
    const runs = (await get(app, '/api/skills7', c)).json().runs;
    expect(runs).toHaveLength(1);
    expect(runs[0].skill).toBe('loser-pauser');
    await app.close();
  });

  it('files the run for approval rather than applying it', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const c = await session(app);
    await post(app, '/api/deployments', c, { kind: 'skill', id: 'loser-pauser' });
    const runs = (await get(app, '/api/skills7', c)).json().runs;
    expect(runs[0].status).not.toBe('executed');
    expect(['needs_approval', 'read_only']).toContain(runs[0].status);
    const log = (await get(app, '/api/approvals', c)).json().entries;
    expect(log.some((e: any) => e.kind === 'proposal' && e.source === 'loser-pauser')).toBe(true);
    await app.close();
  });

  it('does not silently grant autonomy — a deployed skill still cannot spend', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const c = await session(app);
    await post(app, '/api/deployments', c, { kind: 'skill', all: true });
    const autonomy = (await get(app, '/api/approvals', c)).json().autonomy;
    expect(Object.values(autonomy.perSkill)).not.toContain('auto');
    await app.close();
  });

  it('deploys every skill at once and is idempotent', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const c = await session(app);
    const first = (await post(app, '/api/deployments', c, { kind: 'skill', all: true })).json();
    expect(first.added.length).toBeGreaterThan(5);
    const again = (await post(app, '/api/deployments', c, { kind: 'skill', all: true })).json();
    expect(again.added).toEqual([]);
    expect(again.skills).toHaveLength(first.skills.length);
    await app.close();
  });

  it('refuses a skill that does not exist', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const c = await session(app);
    const r = (await post(app, '/api/deployments', c, { kind: 'skill', id: 'made-up' })).json();
    expect(r.skills).toEqual([]);
    expect(r.failed[0].error).toMatch(/unknown/i);
    await app.close();
  });

  it('stops a deployed skill on request', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const c = await session(app);
    await post(app, '/api/deployments', c, { kind: 'skill', id: 'loser-pauser' });
    const r = await del(app, '/api/deployments', c, { kind: 'skill', id: 'loser-pauser' });
    expect(r.json().skills).toEqual([]);
    await app.close();
  });

  it('keeps deployments per account', async () => {
    const store = new MemoryStore();
    const app = buildServer({ authStore: store });
    const a = await session(app, 'a@example.com');
    const b = await session(app, 'b@example.com');
    await post(app, '/api/deployments', a, { kind: 'skill', id: 'loser-pauser' });
    expect((await get(app, '/api/deployments', b)).json().skills).toEqual([]);
    await app.close();
  });

  it('needs a session', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    expect((await app.inject({ method: 'GET', url: '/api/deployments' })).statusCode).toBe(401);
    await app.close();
  });
});

describe('the schedule running a deployed skill unattended', () => {
  /** Age the deployment so the next tick finds it due. */
  async function ageDeployment(store: MemoryStore, days: number) {
    const [uid] = await store.listUserIds();
    const data = await store.getUserData(uid!);
    const old = new Date(Date.now() - days * 86_400_000).toISOString();
    for (const s of data.deployedSkills as { lastRunAt?: string; deployedAt: string }[]) { s.lastRunAt = old; s.deployedAt = old; }
    await store.setUserData(uid!, data);
  }
  const tick = (app: App) => (app as unknown as { runDueSchedules: () => Promise<void> }).runDueSchedules();

  it('runs a weekly skill again once its week is up', async () => {
    const store = new MemoryStore();
    const app = buildServer({ authStore: store });
    const c = await session(app);
    await post(app, '/api/deployments', c, { kind: 'skill', id: 'loser-pauser' });
    expect((await get(app, '/api/skills7', c)).json().runs).toHaveLength(1);

    await tick(app); // nothing is due yet
    expect((await get(app, '/api/skills7', c)).json().runs).toHaveLength(1);

    await ageDeployment(store, 8);
    await tick(app);
    const after = (await get(app, '/api/deployments', c)).json().skills[0];
    expect(after.runs).toBe(2);
    expect((await get(app, '/api/skills7', c)).json().runs).toHaveLength(2);
    await app.close();
  });

  it('holds a monthly skill back until its month is up', async () => {
    const store = new MemoryStore();
    const app = buildServer({ authStore: store });
    const c = await session(app);
    await post(app, '/api/deployments', c, { kind: 'skill', id: 'ad-copy-performance-ranker' });
    await ageDeployment(store, 8); // a week is not a month
    await tick(app);
    expect((await get(app, '/api/deployments', c)).json().skills[0].runs).toBe(1);
    await ageDeployment(store, 30);
    await tick(app);
    expect((await get(app, '/api/deployments', c)).json().skills[0].runs).toBe(2);
    await app.close();
  });

  it('files each unattended run for approval, marked as coming from the deployment', async () => {
    const store = new MemoryStore();
    const app = buildServer({ authStore: store });
    const c = await session(app);
    await post(app, '/api/deployments', c, { kind: 'skill', id: 'loser-pauser' });
    await ageDeployment(store, 8);
    await tick(app);
    const log = (await get(app, '/api/approvals', c)).json().entries;
    expect(log.some((e: any) => e.kind === 'proposal' && /\(deployed\)/.test(e.title))).toBe(true);
    expect(log.some((e: any) => e.kind === 'execution')).toBe(false);
    await app.close();
  });

  it('stops running once the owner undeploys it', async () => {
    const store = new MemoryStore();
    const app = buildServer({ authStore: store });
    const c = await session(app);
    await post(app, '/api/deployments', c, { kind: 'skill', id: 'loser-pauser' });
    await del(app, '/api/deployments', c, { kind: 'skill', id: 'loser-pauser' });
    await tick(app);
    expect((await get(app, '/api/skills7', c)).json().runs).toHaveLength(1); // the deploy run, and no more
    await app.close();
  });
});

describe('deploying a framework', () => {
  it('adds it to the set Miles writes with', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const c = await session(app);
    const r = await post(app, '/api/deployments', c, { kind: 'framework', id: 'ad-creative' });
    expect(r.statusCode).toBe(200);
    expect(r.json().frameworks).toEqual(['ad-creative']);
    await app.close();
  });

  it('refuses one that is not in the library', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const c = await session(app);
    expect((await post(app, '/api/deployments', c, { kind: 'framework', id: '../../etc/passwd' })).statusCode).toBe(404);
    await app.close();
  });

  it('caps the active set and says why', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const c = await session(app);
    const names: string[] = (await get(app, '/api/skill-library', c)).json().skills
      .filter((s: any) => s.source === 'library').map((s: any) => s.name);
    for (const n of names.slice(0, MAX_ACTIVE_FRAMEWORKS)) {
      expect((await post(app, '/api/deployments', c, { kind: 'framework', id: n })).statusCode).toBe(200);
    }
    const over = await post(app, '/api/deployments', c, { kind: 'framework', id: names[MAX_ACTIVE_FRAMEWORKS]! });
    expect(over.statusCode).toBe(409);
    expect(over.json().error).toMatch(new RegExp(String(MAX_ACTIVE_FRAMEWORKS)));
    await app.close();
  });

  it('is idempotent and removable', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const c = await session(app);
    await post(app, '/api/deployments', c, { kind: 'framework', id: 'ad-creative' });
    expect((await post(app, '/api/deployments', c, { kind: 'framework', id: 'ad-creative' })).json().frameworks).toEqual(['ad-creative']);
    expect((await del(app, '/api/deployments', c, { kind: 'framework', id: 'ad-creative' })).json().frameworks).toEqual([]);
    await app.close();
  });

  it('rejects an unknown kind', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const c = await session(app);
    expect((await post(app, '/api/deployments', c, { kind: 'nonsense', id: 'x' })).statusCode).toBe(400);
    await app.close();
  });
});
