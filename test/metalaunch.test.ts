import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import { PipedreamConnector } from '../src/connectors/pipedream.js';
import { buildMetaCampaignSpec } from '../src/agents/metacampaign.js';
import { facebookDaily, launchPausedMeta, META_NOT_CONNECTED, META_PAGE_ONLY, type MetaGraph } from '../src/agents/metalaunch.js';
import type { Connector } from '../src/connectors/types.js';

function spec() {
  return buildMetaCampaignSpec(
    { offer: 'Free estimate', website: 'https://paint.example', dailyBudget: 8, imageUrl: 'https://cdn.example/painter.jpg', headline: 'Painters in Philly', primaryText: 'House painting in Philadelphia. Free estimate.' },
    { business: 'Painters In Philly', industry: 'Painting', city: 'Philadelphia', serviceAreas: 'Philadelphia, 19103' },
  );
}

function fakeGraph(opts?: { ad?: boolean; page?: boolean; status?: string; formError?: string }) {
  const posts: { path: string; body: Record<string, unknown> }[] = [];
  const gets: string[] = [];
  let n = 1;
  const graph: MetaGraph = {
    async get(path) {
      gets.push(path);
      if (path === 'me/adaccounts') return opts?.ad === false ? { data: [] } : { data: [{ id: 'act_55', name: 'Philly Ads' }] };
      if (path === 'me/accounts') return opts?.page === false ? { data: [] } : { data: [{ id: '99', name: 'Painters Page' }] };
      if (path === 'search') return { data: [{ key: '2490299', name: 'Philadelphia' }] };
      return { id: path, name: 'House painting', status: opts?.status || 'PAUSED', effective_status: opts?.status || 'PAUSED' };
    },
    async post(path, body) {
      posts.push({ path, body });
      if (path.endsWith('leadgen_forms') && opts?.formError) return { error: { message: opts.formError } };
      return { id: String(100 + n++) };
    },
  };
  return { graph, posts, gets };
}

describe('facebook daily from the saved split', () => {
  it('uses the share left after Google, and an explicit amount when the owner types one', () => {
    expect(facebookDaily(20, 0.6)).toBe(8);
    expect(facebookDaily(20, 1)).toBe(0);
    expect(facebookDaily(20, 1, 12)).toBe(12);
  });
});

describe('paused Meta create on a fake graph', () => {
  it('creates a leads campaign, ad set, creative, and ad, all paused, then reads PAUSED back', async () => {
    const { graph, posts, gets } = fakeGraph();
    const result = await launchPausedMeta(graph, spec());
    expect(result.ok).toBe(true);
    expect(result.status).toBe('PAUSED');
    expect(result.readback?.status).toBe('PAUSED');
    expect(result.note).toMatch(/Nothing is spending/);
    expect(result.note).not.toMatch(/\u2014/);
    const bodies = posts.map((p) => p.body);
    expect(posts.map((p) => p.path)).toEqual([
      '99/leadgen_forms',
      'act_55/campaigns',
      'act_55/adsets',
      'act_55/adcreatives',
      'act_55/ads',
    ]);
    for (const body of bodies) {
      const raw = JSON.stringify(body);
      expect(raw).not.toContain('ACTIVE');
      expect(raw).not.toContain('access_token');
      if ('status' in body) expect(body.status).toBe('PAUSED');
    }
    const campaign = posts.find((p) => p.path.endsWith('/campaigns'))!.body;
    expect(campaign.objective).toBe('OUTCOME_LEADS');
    const adSet = posts.find((p) => p.path.endsWith('/adsets'))!.body;
    expect(adSet.daily_budget).toBe('800');
    expect(adSet.optimization_goal).toBe('LEAD_GENERATION');
    const geo = (adSet.targeting as { geo_locations: { cities: { key: string }[]; zips: { key: string }[] } }).geo_locations;
    expect(geo.cities[0]!.key).toBe('2490299');
    expect(geo.zips[0]!.key).toBe('US:19103');
    expect((adSet.targeting as { publisher_platforms: string[] }).publisher_platforms).toEqual(['facebook', 'instagram']);
    const creative = posts.find((p) => p.path.endsWith('/adcreatives'))!.body;
    const link = (creative.object_story_spec as { link_data: { image_url: string; message: string } }).link_data;
    expect(link.image_url).toBe('https://cdn.example/painter.jpg');
    expect(link.message).toMatch(/Philadelphia/);
    expect(gets).toContain('me/adaccounts');
    expect(gets.some((path) => path === 'search')).toBe(true);
  });

  it('creates nothing when no ad account or page comes back', async () => {
    const noAccount = fakeGraph({ ad: false });
    const missing = await launchPausedMeta(noAccount.graph, spec());
    expect(missing.ok).toBe(false);
    expect(missing.live).toBe(false);
    expect(missing.note).toBe(META_NOT_CONNECTED);
    expect(noAccount.posts).toEqual([]);

    const noPage = fakeGraph({ page: false });
    const page = await launchPausedMeta(noPage.graph, spec());
    expect(page.note).toMatch(/Page/);
    expect(noPage.posts).toEqual([]);
  });

  it('refuses a missing image before any Facebook call', async () => {
    const { graph, posts, gets } = fakeGraph();
    const bare = spec();
    bare.imageUrl = undefined;
    const result = await launchPausedMeta(graph, bare);
    expect(result.ok).toBe(false);
    expect(result.note).toMatch(/image/i);
    expect(posts).toEqual([]);
    expect(gets).toEqual([]);
  });

  it('reports a status Meta returned that is not paused, and never sent ACTIVE', async () => {
    const { graph, posts } = fakeGraph({ status: 'ACTIVE' });
    const result = await launchPausedMeta(graph, spec());
    expect(result.ok).toBe(false);
    expect(result.readback?.status).toBe('ACTIVE');
    expect(result.note).toMatch(/reported ACTIVE/);
    expect(JSON.stringify(posts)).not.toContain('"ACTIVE"');
  });
});

describe('Pipedream proxy uses the owner Facebook account', () => {
  function connector(accounts: { id: string; slug: string }[], handler: (req: { url: string; externalUserId: string; accountId: string; body?: Record<string, unknown>; params?: Record<string, string> }) => unknown) {
    const calls: { url: string; externalUserId: string; accountId: string; body?: Record<string, unknown> }[] = [];
    const pd = new PipedreamConnector({ connector: 'pipedream', pipedream: { environment: 'development', projectId: 'p', clientId: 'c', clientSecret: 's' } });
    (pd as unknown as { client: unknown }).client = {
      accounts: {
        list: async () => ({ data: accounts.map((a) => ({ id: a.id, app: { nameSlug: a.slug }, healthy: true, externalId: 'owner-1' })) }),
      },
      proxy: {
        get: async (req: { url: string; externalUserId: string; accountId: string }) => {
          calls.push(req);
          return handler(req);
        },
        post: async (req: { url: string; externalUserId: string; accountId: string; body?: Record<string, unknown> }) => {
          calls.push(req);
          return handler(req);
        },
      },
    };
    return { pd, calls };
  }

  it('posts through proxy as the signed-in user and does not send a shared token', async () => {
    process.env.META_ADS_ACCESS_TOKEN = 'shared-secret-token';
    let n = 1;
    const { pd, calls } = connector([{ id: 'apn_owner', slug: 'facebook_graph_api' }], (req) => {
      const path = req.url.split('/v21.0/')[1] || '';
      if (path.startsWith('me/adaccounts')) return { data: [{ id: 'act_55', name: 'Philly Ads' }] };
      if (path.startsWith('me/accounts')) return { data: [{ id: '99', name: 'Painters Page' }] };
      if (path.startsWith('search')) return { data: [{ key: '2490299' }] };
      if (req.body) return { id: String(300 + n++) };
      return { id: path, status: 'PAUSED', effective_status: 'PAUSED', name: 'House painting' };
    });
    const result = await pd.launchMetaCampaign('owner-1', spec());
    expect(result.ok).toBe(true);
    expect(result.note).toMatch(/Nothing is spending/);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.accountId).toBe('apn_owner');
      expect(call.externalUserId).toBe('owner-1');
      expect(call.url).toMatch(/^https:\/\/graph\.facebook\.com\/v21\.0\//);
      expect(JSON.stringify(call)).not.toContain('shared-secret-token');
      expect(JSON.stringify(call.body || {})).not.toContain('access_token');
      if (call.body && 'status' in call.body) expect(call.body.status).toBe('PAUSED');
    }
    delete process.env.META_ADS_ACCESS_TOKEN;
  });

  it('says a Page connection cannot create ads when no ad account is visible', async () => {
    const { pd, calls } = connector([{ id: 'apn_page', slug: 'facebook_pages' }], () => ({ data: [] }));
    const status = await pd.metaStatus('owner-1');
    expect(status.ready).toBe(false);
    expect(status.note).toBe(META_PAGE_ONLY);
    expect(calls.every((call) => call.url.includes('/me/'))).toBe(true);
    expect(calls.some((call) => call.body)).toBe(false);
  });

  it('names the missing ad account when Facebook is not connected', async () => {
    const { pd, calls } = connector([{ id: 'apn_g', slug: 'google_ads' }], () => ({}));
    const status = await pd.metaStatus('owner-1');
    expect(status.ready).toBe(false);
    expect(status.note).toBe(META_NOT_CONNECTED);
    expect(calls).toEqual([]);
  });
});

describe('Facebook approval route', () => {
  function harness() {
    const calls: { op: string; status?: string; budget?: number }[] = [];
    const connector = {
      name: 'pipedream',
      async createConnectToken() { return { token: 't', expiresAt: '2099', connectUrl: 'https://connect.example' }; },
      async listAccounts() { return []; },
      async launchMetaCampaign(_id: string, incoming: { status?: string; dailyBudget?: number }) {
        calls.push({ op: 'meta', status: incoming.status, budget: incoming.dailyBudget });
        return {
          ok: true,
          live: true,
          campaignResource: '555',
          steps: [{ step: 'Create paused campaign', ok: true, resource: '555' }, { step: 'Read campaign status', ok: true, resource: '555' }],
          note: 'Created paused in Philly Ads. Nothing is spending.',
        };
      },
    } as unknown as Connector;
    return { connector, calls };
  }

  async function cookie(app: ReturnType<typeof buildServer>) {
    const r = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: `fb-${Date.now()}@example.com`, password: 'password1', tos: true } });
    return String(r.headers['set-cookie']).split(';')[0] ?? '';
  }

  it('builds a Philadelphia leads plan from the profile, split, and studio image', async () => {
    const { connector } = harness();
    const app = buildServer({ authStore: new MemoryStore(), connector });
    const c = await cookie(app);
    await app.inject({ method: 'PUT', url: '/api/profile', headers: { cookie: c }, payload: { businessName: 'Painters In Philly', industry: 'Painting', serviceAreas: 'Philadelphia, 19103', website: 'https://paint.example', services: 'interior painting' } });
    await app.inject({ method: 'PUT', url: '/api/assets', headers: { cookie: c }, payload: { assets: { photos: [{ url: 'https://cdn.example/painter.jpg' }] } } });
    await app.inject({ method: 'POST', url: '/api/miles/questions', headers: { cookie: c }, payload: { dailyBudget: 20, googleShare: 0.6, goal: 'more booked jobs' } });
    const built = await app.inject({ method: 'POST', url: '/api/meta/build', headers: { cookie: c }, payload: {} });
    expect(built.statusCode).toBe(200);
    const body = built.json();
    expect(body.spec.objective).toBe('OUTCOME_LEADS');
    expect(body.spec.status).toBe('PAUSED');
    expect(body.spec.dailyBudget).toBe(8);
    expect(body.spec.geo.cities).toContain('Philadelphia');
    expect(body.spec.geo.zips).toContain('19103');
    expect(body.spec.imageUrl).toBe('https://cdn.example/painter.jpg');
    expect(body.plan.objective).toBe('Leads');
    expect(body.plan.placements).toMatch(/Facebook and Instagram/);
    expect(body.budgetNote).toMatch(/\$8 a day/);
    expect(JSON.stringify(body.spec.ad)).not.toMatch(/\u2014|\u2013/);
    expect(body.status.ready).toBe(false);
    expect(body.status.note).toMatch(/ad account/i);
    await app.close();
  });

  it('requires confirm, stays inside the cap, and returns paused even if the connector says the write landed', async () => {
    const h = harness();
    const app = buildServer({ authStore: new MemoryStore(), connector: h.connector });
    const c = await cookie(app);
    await app.inject({ method: 'PUT', url: '/api/profile', headers: { cookie: c }, payload: { dailyBudget: '20' } });
    const plan = spec();
    const quiet = await app.inject({ method: 'POST', url: '/api/meta/launch', headers: { cookie: c }, payload: { spec: plan, confirm: false } });
    expect(quiet.statusCode).toBe(400);
    expect(h.calls).toEqual([]);
    plan.dailyBudget = 50;
    const over = await app.inject({ method: 'POST', url: '/api/meta/launch', headers: { cookie: c }, payload: { spec: plan, confirm: true } });
    expect(over.statusCode).toBe(409);
    expect(over.json().live).toBe(false);
    expect(over.json().error).toMatch(/daily cap/);
    expect(h.calls).toEqual([]);
    plan.dailyBudget = 8;
    const yes = await app.inject({ method: 'POST', url: '/api/meta/launch', headers: { cookie: c }, payload: { spec: { ...plan, status: 'ENABLED' }, confirm: true } });
    expect(yes.statusCode).toBe(200);
    expect(yes.json().ok).toBe(true);
    expect(yes.json().live).toBe(false);
    expect(yes.json().status).toBe('PAUSED');
    expect(yes.json().note).toMatch(/Nothing is spending/);
    expect(h.calls).toEqual([{ op: 'meta', status: 'PAUSED', budget: 8 }]);
    await app.close();
  });
});
