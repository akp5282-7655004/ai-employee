import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import { buildCampaignSpec } from '../src/agents/campaign.js';
import { forcePausedSearchSpec, judgeSearchLaunch } from '../src/agents/googlelaunch.js';
import type { CampaignLaunchResult, Connector } from '../src/connectors/types.js';

type Call = { op: string; id?: string; status?: string; target?: string; actionId?: string };

function harness() {
  const calls: Call[] = [];
  const targets = new Map<string, { id: string; login: string; label: string }[]>();
  let mode: 'ok' | 'keywords' | 'budget' = 'ok';
  const connector = {
    name: 'pipedream',
    async createConnectToken(id: string) {
      calls.push({ op: 'token', id });
      return { token: 't', expiresAt: '2099-01-01', connectUrl: `https://connect.example/${id}` };
    },
    async listAccounts(id: string) {
      calls.push({ op: 'accounts', id });
      return targets.has(id) ? [{ id: 'acct', app: 'google_ads', externalUserId: id, healthy: true }] : [];
    },
    async runAction(req: { externalUserId: string; actionId: string }) {
      calls.push({ op: 'run', id: req.externalUserId, actionId: req.actionId });
      return { ok: true, actionId: req.actionId, app: 'google_ads', output: null };
    },
    async listAdTargets(id: string) {
      calls.push({ op: 'targets', id });
      return targets.get(id) ?? [];
    },
    async launchCampaign(id: string, spec: { name: string; status?: string }, target?: string): Promise<CampaignLaunchResult> {
      calls.push({ op: 'launch', id, status: spec.status, target });
      if (mode === 'budget') {
        return { ok: false, live: true, steps: [{ step: 'Create daily budget ($20)', ok: false, error: 'BUDGET_REJECTED' }], note: 'Google rejected the budget.' };
      }
      if (mode === 'keywords') {
        return {
          ok: true, live: true,
          steps: [
            { step: 'Create daily budget ($20)', ok: true, resource: 'customers/1/campaignBudgets/1' },
            { step: 'Create campaign "x" (PAUSED)', ok: true, resource: 'customers/1/campaigns/2' },
            { step: 'Create ad group "Repairs"', ok: true, resource: 'customers/1/adGroups/3' },
            { step: 'Add 4 keywords to "Repairs"', ok: false, error: 'KEYWORD_TEXT_TOO_LONG' },
            { step: 'Create responsive search ad in "Repairs"', ok: true },
          ],
        };
      }
      return {
        ok: true, live: true, campaignResource: 'customers/1/campaigns/9', link: 'https://ads.google.com/aw/campaigns?campaignId=9',
        steps: [
          { step: 'Create daily budget ($20)', ok: true, resource: 'customers/1/campaignBudgets/1' },
          { step: `Create campaign "${spec.name}" (PAUSED)`, ok: true, resource: 'customers/1/campaigns/9' },
          { step: 'Create ad group "Repairs"', ok: true, resource: 'customers/1/adGroups/3' },
          { step: 'Add 4 keywords to "Repairs"', ok: true },
          { step: 'Create responsive search ad in "Repairs"', ok: true },
          { step: 'Verify campaign in Google Ads', ok: true },
          { step: 'Add location targeting', ok: true },
        ],
      };
    },
    async launchMetaCampaign() {
      calls.push({ op: 'meta' });
      return { ok: true, live: true, steps: [] };
    },
  } as unknown as Connector;
  return { connector, calls, targets, setMode(next: typeof mode) { mode = next; } };
}

const spec = () => buildCampaignSpec(
  { goal: 'more calls', dailyBudget: 20, finalUrl: 'https://bensalemroofing.example/leak', locations: ['Bensalem, PA'] },
  { business: 'Bensalem Roofing', trade: 'Roofing', city: 'Bensalem', services: 'Leak repair' },
);

async function cookie(app: ReturnType<typeof buildServer>, email: string) {
  const r = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email, password: 'password1', tos: true } });
  return String(r.headers['set-cookie']).split(';')[0] ?? '';
}

describe('judgeSearchLaunch', () => {
  it('requires budget, campaign, ad group, keywords, and a responsive search ad', () => {
    const full = judgeSearchLaunch([
      { step: 'Create daily budget ($20)', ok: true, resource: 'customers/1/campaignBudgets/1' },
      { step: 'Create campaign "Leak" (PAUSED)', ok: true, resource: 'customers/1/campaigns/2' },
      { step: 'Create ad group "Repairs"', ok: true, resource: 'customers/1/adGroups/3' },
      { step: 'Add 4 keywords to "Repairs"', ok: true },
      { step: 'Create responsive search ad in "Repairs"', ok: true },
      { step: 'Add location targeting', ok: true },
    ]);
    expect(full.ok).toBe(true);
    expect(full.missing).toEqual([]);
    const partial = judgeSearchLaunch(full.ok ? [
      { step: 'Create daily budget ($20)', ok: true, resource: 'customers/1/campaignBudgets/1' },
      { step: 'Create campaign "Leak" (PAUSED)', ok: true, resource: 'customers/1/campaigns/2' },
      { step: 'Add 4 keywords to "Repairs"', ok: false, error: 'bad' },
    ] : []);
    expect(partial.ok).toBe(false);
    expect(partial.partial).toBe(true);
    expect(partial.missing).toEqual(expect.arrayContaining(['ad group', 'keywords', 'responsive search ad']));
  });

  it('forces paused no matter what the client sent', () => {
    expect(forcePausedSearchSpec({ status: 'ENABLED', name: 'x' }).status).toBe('PAUSED');
  });
});

describe('Google Search create is signed-in, paused, and honest', () => {
  it('refuses anonymous connector and launch calls', async () => {
    const h = harness();
    const app = buildServer({ authStore: new MemoryStore(), connector: h.connector });
    for (const req of [
      { method: 'POST' as const, url: '/api/campaign/launch', payload: { spec: spec(), confirm: true } },
      { method: 'POST' as const, url: '/api/message', payload: { sessionId: 'u_victim', text: 'approve' } },
      { method: 'POST' as const, url: '/api/connect-token', payload: { sessionId: 'u_victim', app: 'google_ads' } },
      { method: 'POST' as const, url: '/api/connect-and-run', payload: { sessionId: 'u_victim', actions: [{ actionId: 'google_ads-create-campaign', app: 'google_ads', label: 'x' }] } },
      { method: 'POST' as const, url: '/api/reset', payload: { sessionId: 'u_victim' } },
      { method: 'GET' as const, url: '/api/connections?sessionId=u_victim' },
      { method: 'GET' as const, url: '/api/revenue?sessionId=u_victim' },
    ]) {
      const r = await app.inject(req);
      expect(r.statusCode, req.url).toBe(401);
    }
    expect(h.calls).toEqual([]);
    await app.close();
  });

  it('does not write without an explicit approval', async () => {
    const h = harness();
    const app = buildServer({ authStore: new MemoryStore(), connector: h.connector });
    const c = await cookie(app, 'owner@example.com');
    h.targets.set('ignored', []);
    const me = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie: c } });
    h.targets.set(me.json().user.id, [{ id: '1111111111', login: '1111111111', label: 'Mine — 111-111-1111' }]);
    const r = await app.inject({ method: 'POST', url: '/api/campaign/launch', headers: { cookie: c }, payload: { spec: { ...spec(), status: 'ENABLED' }, confirm: false, target: '1111111111' } });
    expect(r.statusCode).toBe(400);
    expect(h.calls.some((x) => x.op === 'launch')).toBe(false);
    await app.close();
  });

  it('creates a complete paused campaign on the signed-in account only', async () => {
    const h = harness();
    const app = buildServer({ authStore: new MemoryStore(), connector: h.connector });
    const a = await cookie(app, 'a@example.com');
    const b = await cookie(app, 'b@example.com');
    const idA = (await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie: a } })).json().user.id as string;
    const idB = (await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie: b } })).json().user.id as string;
    h.targets.set(idA, [{ id: '1111111111', login: '1111111111', label: 'A Roofing — 111-111-1111' }]);
    h.targets.set(idB, [{ id: '2222222222', login: '2222222222', label: 'B Plumbing — 222-222-2222' }]);

    const stolen = await app.inject({
      method: 'POST', url: '/api/campaign/launch', headers: { cookie: b },
      payload: { spec: { ...spec(), status: 'ENABLED' }, confirm: true, target: '1111111111', sessionId: idA },
    });
    expect(stolen.statusCode).toBe(400);
    expect(h.calls.filter((x) => x.op === 'launch')).toEqual([]);

    const ok = await app.inject({
      method: 'POST', url: '/api/campaign/launch', headers: { cookie: a },
      payload: { spec: { ...spec(), status: 'ENABLED' }, confirm: true, target: '111-111-1111' },
    });
    expect(ok.statusCode).toBe(200);
    const body = ok.json();
    expect(body.ok).toBe(true);
    expect(body.live).toBe(true);
    expect(body.status).toBe('PAUSED');
    expect(body.activation).toBe('disabled');
    expect(body.demo).toBe(false);
    expect(body.campaignResource).toMatch(/campaigns\/9/);
    const launch = h.calls.find((x) => x.op === 'launch');
    expect(launch).toMatchObject({ id: idA, status: 'PAUSED', target: '1111111111' });
    expect(String(ok.body)).not.toMatch(/ENABLED/);
    await app.close();
  });

  it('reports a partial external failure instead of success', async () => {
    const h = harness();
    h.setMode('keywords');
    const app = buildServer({ authStore: new MemoryStore(), connector: h.connector });
    const c = await cookie(app, 'partial@example.com');
    const id = (await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie: c } })).json().user.id as string;
    h.targets.set(id, [{ id: '3333333333', login: '3333333333', label: 'Partial — 333-333-3333' }]);
    const r = await app.inject({ method: 'POST', url: '/api/campaign/launch', headers: { cookie: c }, payload: { spec: spec(), confirm: true } });
    expect(r.statusCode).toBe(409);
    const body = r.json();
    expect(body.ok).toBe(false);
    expect(body.partial).toBe(true);
    expect(body.live).toBe(true);
    expect(body.status).toBe('PAUSED');
    expect(body.note).toMatch(/keywords/i);
    expect(body.note).toMatch(/PAUSED/);
    expect(body.note).toMatch(/does not spend/);
    await app.close();
  });

  it('reports a total external failure with no created resource', async () => {
    const h = harness();
    h.setMode('budget');
    const app = buildServer({ authStore: new MemoryStore(), connector: h.connector });
    const c = await cookie(app, 'fail@example.com');
    const id = (await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie: c } })).json().user.id as string;
    h.targets.set(id, [{ id: '4444444444', login: '4444444444', label: 'Fail — 444-444-4444' }]);
    const r = await app.inject({ method: 'POST', url: '/api/campaign/launch', headers: { cookie: c }, payload: { spec: spec(), confirm: true } });
    expect(r.statusCode).toBe(502);
    expect(r.json().ok).toBe(false);
    expect(r.json().partial).toBe(false);
    expect(r.json().campaignResource).toBeUndefined();
    expect(r.json().note).toMatch(/BUDGET_REJECTED|No campaign was created|rejected the budget/);
    await app.close();
  });

  it('blocks a disconnected account before any write', async () => {
    const h = harness();
    const app = buildServer({ authStore: new MemoryStore(), connector: h.connector });
    const c = await cookie(app, 'none@example.com');
    const r = await app.inject({ method: 'POST', url: '/api/campaign/launch', headers: { cookie: c }, payload: { spec: spec(), confirm: true } });
    expect(r.statusCode).toBe(409);
    expect(r.json().live).toBe(false);
    expect(r.json().error).toMatch(/not connected/i);
    expect(h.calls.some((x) => x.op === 'launch')).toBe(false);
    await app.close();
  });

  it('runs connector actions as the cookie user, not a body id', async () => {
    const h = harness();
    const app = buildServer({ authStore: new MemoryStore(), connector: h.connector });
    const c = await cookie(app, 'actor@example.com');
    const id = (await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie: c } })).json().user.id as string;
    const r = await app.inject({
      method: 'POST', url: '/api/connect-and-run', headers: { cookie: c },
      payload: { sessionId: 'u_someone_else', actions: [{ actionId: 'google_ads-create-campaign', app: 'google_ads', label: 'Create' }] },
    });
    expect(r.statusCode).toBe(200);
    expect(h.calls.find((x) => x.op === 'run')).toMatchObject({ id, actionId: 'google_ads-create-campaign' });
    await app.close();
  });

  it('refuses an incomplete Facebook plan before any write', async () => {
    const h = harness();
    const app = buildServer({ authStore: new MemoryStore(), connector: h.connector });
    const c = await cookie(app, 'meta@example.com');
    const r = await app.inject({ method: 'POST', url: '/api/meta/launch', headers: { cookie: c }, payload: { spec: { name: 'x', dailyBudget: 10 }, confirm: true } });
    expect(r.statusCode).toBe(409);
    expect(r.json().ok).toBe(false);
    expect(r.json().live).toBe(false);
    expect(r.json().error).toMatch(/Nothing was created|website|image/i);
    expect(h.calls.some((x) => x.op === 'meta')).toBe(false);
    await app.close();
  });
});

describe('demo and operator access', () => {
  it('does not make the public demo an operator, and does not open it on a live connector', async () => {
    const mockApp = buildServer({ authStore: new MemoryStore() });
    const demo = await mockApp.inject({ method: 'GET', url: '/demo' });
    expect(demo.statusCode).toBe(200);
    const demoCookie = String(demo.headers['set-cookie']).split(';')[0] ?? '';
    const me = await mockApp.inject({ method: 'GET', url: '/auth/me', headers: { cookie: demoCookie } });
    expect(me.json().admin).toBe(false);
    expect(me.json().user.email).toBe('demo@miles.local');
    const econ = await mockApp.inject({ method: 'GET', url: '/api/economics', headers: { cookie: demoCookie } });
    expect(econ.statusCode).toBe(403);
    const launch = await mockApp.inject({
      method: 'POST', url: '/api/campaign/launch', headers: { cookie: demoCookie },
      payload: { spec: { ...spec(), status: 'ENABLED' }, confirm: true },
    });
    expect(launch.json().live).toBe(false);
    expect(launch.json().demo).toBe(true);
    expect(launch.json().ok).toBe(false);
    expect(String(launch.body)).toMatch(/Demo mode/);
    await mockApp.close();

    const live = harness();
    const liveApp = buildServer({ authStore: new MemoryStore(), connector: live.connector });
    const off = await liveApp.inject({ method: 'GET', url: '/demo' });
    expect(off.statusCode).toBe(302);
    expect(String(off.headers.location)).toContain('demo_off');
    expect(live.calls).toEqual([]);
    await liveApp.close();
  });
});

describe('the launch screen agrees with the server', () => {
  it('does not offer an enabled status or a go-live button', () => {
    const html = readFileSync('web/index.html', 'utf8');
    expect(html).not.toContain('Enabled — starts spending');
    expect(html).toContain('Approve & create paused campaign');
    expect(html).toContain("s.status='PAUSED'");
    expect(html).toContain('Miles cannot turn this campaign on');
    const login = readFileSync('web/login.html', 'utf8');
    expect(login).toContain('demo_off');
  });

  it('the operator checklist names the config and forbids enabling', () => {
    const doc = readFileSync('docs/ops/google-search-launch-acceptance.md', 'utf8');
    for (const name of ['ADMIN_EMAIL', 'DATABASE_URL', 'CONNECTOR', 'PIPEDREAM_PROJECT_ID', 'PIPEDREAM_CLIENT_ID', 'PIPEDREAM_CLIENT_SECRET', 'PIPEDREAM_ENVIRONMENT', 'APP_URL']) {
      expect(doc).toContain(name);
    }
    expect(doc).toMatch(/do not enable/i);
    expect(doc).toMatch(/paused/i);
    expect(doc).not.toMatch(/sk_live|api[_-]?key\s*[:=]\s*\S{8,}/i);
  });
});
