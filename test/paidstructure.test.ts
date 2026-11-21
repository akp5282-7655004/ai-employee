import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import { abPlanFromBilling, abVariationLimit, buildMetaPlan, buildTikTokPlan, reviewBlocked, scaleIncreaseAllowed } from '../src/agents/paidstructure.js';
import { launchMetaStructure, setMetaBudget, setMetaTreeStatus, type MetaGraph } from '../src/agents/metalaunch.js';
import { idFrom, launchTikTokStructure, setTikTokBudget, setTikTokStatus, TIKTOK_AD_ACTION, TIKTOK_ADGROUP_ACTION, TIKTOK_CAMPAIGN_ACTION, TIKTOK_UPLOAD_ACTION, type TikTokRunner } from '../src/agents/tiktoklaunch.js';
import type { Connector } from '../src/connectors/types.js';

const image = 'https://cdn.example/roof.jpg';
const video = 'https://cdn.example/roof.mp4';

function meta(daily: number, trade: string, city = 'Philadelphia') {
  return buildMetaPlan({
    dailyBudget: daily,
    website: 'https://crew.example',
    imageUrls: [image],
    offer: 'Free inspection this month',
    business: 'Local Crew',
    trade,
    city,
    serviceAreas: `${city}, 19103`,
  });
}

describe('home-services Meta structure', () => {
  it('builds a paused leads campaign from the roofing audience file', () => {
    const { plan, checklist } = meta(80, 'Roofing');
    expect(plan.objective).toBe('OUTCOME_LEADS');
    expect(plan.status).toBe('PAUSED');
    expect(plan.specialAdCategories).toEqual([]);
    expect(plan.budgetMode).toBe('cbo');
    expect(plan.advantageAudience).toBe(true);
    expect(plan.destination).toBe('instant_form');
    expect(plan.form.higherIntent).toBe(true);
    expect(plan.form.questions.map((q) => q.label)).toEqual(['Do you own this home?', 'What kind of roof is it?']);
    const included = plan.adSets.filter((set) => set.included);
    expect(included.map((set) => set.segment)).toEqual(['Replacement prospects', 'Flat-roof / rowhome']);
    expect(plan.adSets.find((set) => set.segment === 'Storm-hit ZIPs')!.included).toBe(false);
    expect(included.every((set) => set.ageMin === 25)).toBe(true);
    expect(included.every((set) => set.zips[0] === '19103')).toBe(true);
    expect(included.reduce((sum, set) => sum + set.dailyBudget, 0)).toBe(80);
    const ads = included.flatMap((set) => set.ads.filter((ad) => ad.included));
    expect(ads.length).toBeGreaterThan(1);
    expect(ads.every((ad) => ad.imageUrl === image)).toBe(true);
    expect(JSON.stringify(plan)).not.toContain('"ACTIVE"');
    expect(reviewBlocked(checklist)).toBeNull();
    expect(checklist.find((row) => row.id === 'learning')!.state).toBe('warn');
    expect(plan.elements.map((row) => row.id)).toEqual(['strategy', 'competitors', 'campaign', 'creatives', 'geography', 'budget', 'ab_test', 'retargeting', 'form', 'report']);
    expect(plan.elements.find((row) => row.id === 'ab_test')!.detail).toMatch(/allowance is 1 variation/);
    expect(plan.elements.find((row) => row.id === 'report')!.label).toBe('Monthly performance report');
    expect(plan.elements.find((row) => row.id === 'geography')!.label).toBe('Geography targeting');
    const text = plan.elements.map((row) => row.detail).join(' ');
    expect(text).toMatch(/Campaign budget optimization/);
    expect(text).toMatch(/Lowest Cost/);
    expect(text).toMatch(/last 30 days/);
    expect(text).toMatch(/1%/);
    expect(text).toMatch(/2-5%/);
    expect(text).toMatch(/frequency above 3/i);
    expect(text).toMatch(/frequency above 5/i);
    expect(text).toMatch(/20% image-text rule is retired/);
    expect(text).toMatch(/not a 3x return on ad spend/);
    expect(text).toMatch(/Cart abandoners, catalogs, and dynamic product ads are not used/);
    expect(scaleIncreaseAllowed(80, 100, null)).toMatch(/20%/);
    expect(scaleIncreaseAllowed(80, 90, new Date().toISOString())).toMatch(/48 hours/);
    expect(scaleIncreaseAllowed(80, 90, null)).toBeNull();
    expect(JSON.stringify(plan)).not.toMatch(/\u2014/);
  });

  it('sets A/B variations from Starter, Growth, and Scale, and defaults to 1', () => {
    const variations = (plan: { adSets: { ads: { included: boolean; angle: string }[] }[] }) => plan.adSets.flatMap((set) => set.ads).filter((ad) => ad.included && ad.angle !== 'offer').length;
    const base = { dailyBudget: 80, website: 'https://crew.example', imageUrls: [image], business: 'Local Crew', trade: 'Roofing', city: 'Philadelphia', serviceAreas: 'Philadelphia, 19103' };
    expect(variations(buildMetaPlan({ ...base, abPlan: 'starter' }).plan)).toBe(0);
    expect(variations(buildMetaPlan({ ...base, abPlan: 'growth' }).plan)).toBe(1);
    expect(variations(buildMetaPlan({ ...base, abPlan: 'scale' }).plan)).toBe(2);
    expect(variations(buildMetaPlan(base).plan)).toBe(1);
    expect(buildMetaPlan({ ...base, abPlan: 'starter' }).plan.elements.find((row) => row.id === 'ab_test')!.detail).toMatch(/Starter includes no A\/B variations/);
    expect(buildMetaPlan({ ...base, abPlan: 'scale' }).plan.elements.find((row) => row.id === 'ab_test')!.detail).toMatch(/up to 3/);
    expect(abVariationLimit(null)).toBe(1);
    expect(abVariationLimit('starter')).toBe(0);
    expect(abVariationLimit('growth')).toBe(1);
    expect(abVariationLimit('scale')).toBe(3);
    expect(abPlanFromBilling(undefined)).toBeNull();
    expect(abPlanFromBilling({ band: 'growth', status: 'active' })).toBe('growth');
    expect(abPlanFromBilling({ band: 'scale', status: 'canceled' })).toBeNull();
    expect(abPlanFromBilling({ band: 'launch', status: 'active' })).toBeNull();
  });

  it('uses the budget ceiling for message count, not a fixed variation package', () => {
    const small = meta(8, 'Painting');
    const large = meta(80, 'Painting');
    const count = (built: ReturnType<typeof meta>) => built.plan.adSets.filter((set) => set.included).flatMap((set) => set.ads.filter((ad) => ad.included)).length;
    expect(count(small)).toBeLessThan(count(large));
    expect(count(small)).toBeGreaterThan(0);
    expect(small.plan.elements).toHaveLength(10);
    expect(large.plan.elements).toHaveLength(10);
  });

  it('holds HVAC emergency and membership, and keeps one replacement ad set', () => {
    const { plan } = meta(80, 'HVAC');
    const byName = (name: string) => plan.adSets.find((set) => set.segment === name)!;
    expect(byName('No heat / no AC').included).toBe(false);
    expect(byName('Tune-up and membership').included).toBe(false);
    expect(byName('System replacement').included).toBe(true);
    expect(plan.budgetMode).toBe('cbo');
    expect(byName('System replacement').dailyBudget).toBe(80);
  });

  it('warns when one ad set is under $10 and does not block it', () => {
    const { plan, checklist } = meta(8, 'Painting');
    expect(plan.adSets.filter((set) => set.included)).toHaveLength(1);
    expect(checklist.find((row) => row.id === 'split')!.state).toBe('warn');
    expect(reviewBlocked(checklist)).toBeNull();
  });

  it('blocks a country-wide plan with no image', () => {
    const { checklist } = buildMetaPlan({ dailyBudget: 40, website: 'https://crew.example', trade: 'Electrical', business: 'Spark' });
    expect(reviewBlocked(checklist)).toMatch(/image|city|ZIP/i);
  });
});

describe('home-services TikTok structure', () => {
  it('blocks a budget under TikTok\'s published minimum', () => {
    const { plan, checklist } = buildTikTokPlan({
      dailyBudget: 20, website: 'https://crew.example', videoUrl: video, trade: 'Plumbing', city: 'Philadelphia', serviceAreas: 'Philadelphia', business: 'Pipes',
    });
    expect(plan.status).toBe('DISABLE');
    expect(plan.destination).toBe('website');
    expect(plan.objective).toBe('LEAD_GENERATION');
    expect(reviewBlocked(checklist)).toMatch(/\$50/);
    expect(checklist.find((row) => row.id === 'connect')!.state).toBe('warn');
  });

  it('clears the review when the budget, video, and city are present', () => {
    const { plan, checklist } = buildTikTokPlan({
      dailyBudget: 60, website: 'https://crew.example', videoUrl: video, trade: 'Plumbing', city: 'Philadelphia', serviceAreas: 'Philadelphia, 19103', business: 'Pipes',
    });
    expect(reviewBlocked(checklist)).toBeNull();
    expect(plan.adSets.filter((set) => set.included).every((set) => set.dailyBudget > 20)).toBe(true);
    expect(plan.adSets.filter((set) => set.included).every((set) => set.placements === 'TikTok only')).toBe(true);
    expect(plan.form.questions).toHaveLength(2);
  });
});

function fakeGraph() {
  const posts: { path: string; body: Record<string, unknown> }[] = [];
  let n = 1;
  const graph: MetaGraph = {
    async get(path) {
      if (path === 'me/adaccounts') return { data: [{ id: 'act_55', name: 'Philly Ads' }] };
      if (path === 'me/accounts') return { data: [{ id: '99', name: 'Crew Page' }] };
      if (path === 'search') return { data: [{ key: '2490299' }] };
      return { id: path, name: 'Leads', status: 'PAUSED', effective_status: 'PAUSED' };
    },
    async post(path, body) {
      posts.push({ path, body });
      return { id: String(400 + n++) };
    },
  };
  return { graph, posts };
}

describe('paused Meta create from the plan', () => {
  it('creates the form, campaign, ad sets, and ads paused, and never sends ACTIVE', async () => {
    const { plan } = meta(80, 'Roofing');
    const { graph, posts } = fakeGraph();
    const result = await launchMetaStructure(graph, plan);
    expect(result.ok).toBe(true);
    expect(result.note).toMatch(/Nothing is spending/);
    expect(result.adSetIds).toHaveLength(2);
    expect((result.adIds || []).length).toBeGreaterThan(1);
    const raw = JSON.stringify(posts);
    expect(raw).not.toContain('ACTIVE');
    expect(raw).not.toContain('access_token');
    expect(posts[0]!.path).toBe('99/leadgen_forms');
    expect(posts[0]!.body.is_optimized_for_quality).toBe(true);
    expect(posts.some((row) => String(row.path).endsWith('/campaigns') && row.body.objective === 'OUTCOME_LEADS' && row.body.status === 'PAUSED')).toBe(true);
    const campaign = posts.find((row) => String(row.path).endsWith('/campaigns'))!;
    expect(campaign.body.daily_budget).toBe('8000');
    expect(campaign.body.special_ad_categories).toEqual([]);
    const adSets = posts.filter((row) => String(row.path).endsWith('/adsets'));
    expect(adSets).toHaveLength(2);
    expect(adSets.every((row) => row.body.status === 'PAUSED')).toBe(true);
    expect(adSets.every((row) => row.body.daily_budget == null)).toBe(true);
    const targeting = adSets[0]!.body.targeting as { age_min: number; targeting_automation: { advantage_audience: number }; geo_locations: { zips: { key: string }[] } };
    expect(targeting.age_min).toBe(25);
    expect(targeting.targeting_automation.advantage_audience).toBe(1);
    expect(targeting.geo_locations.zips[0]!.key).toBe('US:19103');
    expect(posts.filter((row) => String(row.path).endsWith('/ads')).every((row) => row.body.status === 'PAUSED')).toBe(true);
  });

  it('updates status and budget without inventing a third status', async () => {
    const posts: { path: string; body: Record<string, unknown> }[] = [];
    const graph: MetaGraph = {
      async get(path) { return { id: path, status: posts.at(-1)?.body.status || 'PAUSED', effective_status: posts.at(-1)?.body.status || 'PAUSED' }; },
      async post(path, body) { posts.push({ path, body }); return { success: true }; },
    };
    const paused = await setMetaTreeStatus(graph, { campaignId: '11', adSetIds: ['22'], adIds: ['33'], status: 'PAUSED' });
    expect(paused.ok).toBe(true);
    expect(posts.map((row) => row.body.status)).toEqual(['PAUSED', 'PAUSED', 'PAUSED']);
    posts.length = 0;
    const budget = await setMetaBudget(graph, { campaignId: '11', adSetIds: ['22'], mode: 'cbo', daily: 40 });
    expect(budget.ok).toBe(true);
    expect(posts[0]!.body).toEqual({ daily_budget: '4000' });
    expect(posts[0]!.body.status).toBeUndefined();
  });
});

function runner(opts?: { location?: boolean; video?: string }) {
  const calls: { actionId: string; props: Record<string, unknown> }[] = [];
  let n = 1;
  const fake: TikTokRunner = {
    async discoverAdvertisers() { return [{ id: '7123', name: 'Pipes Ads' }]; },
    async lookupLocation() { return opts?.location === false ? { error: 'no match' } : { ids: ['555'], label: 'Philadelphia' }; },
    async lookupIdentity() { return { id: 'id_1', type: 'CUSTOMIZED_USER' }; },
    async run(actionId, props) {
      calls.push({ actionId, props });
      if (actionId === TIKTOK_UPLOAD_ACTION) return { ok: true, output: { data: { video_id: opts?.video || 'vid_9' } } };
      return { ok: true, output: { data: { campaign_id: `c${n}`, adgroup_id: `g${n}`, ad_id: `a${n++}` } } };
    },
  };
  return { fake, calls };
}

describe('paused TikTok create from the plan', () => {
  it('creates a disabled campaign, ad group, and ad, and does not send ENABLE', async () => {
    const { plan } = buildTikTokPlan({
      dailyBudget: 60, website: 'https://crew.example', videoUrl: video, trade: 'Plumbing', city: 'Philadelphia', serviceAreas: 'Philadelphia', business: 'Pipes',
    });
    const { fake, calls } = runner();
    const result = await launchTikTokStructure(fake, plan, new Date('2026-11-21T15:00:00Z'));
    expect(result.ok).toBe(true);
    expect(result.status).toBe('DISABLE');
    expect(result.note).toMatch(/Nothing is spending/);
    expect(calls.map((call) => call.actionId)).toContain(TIKTOK_CAMPAIGN_ACTION);
    expect(calls.map((call) => call.actionId)).toContain(TIKTOK_ADGROUP_ACTION);
    expect(calls.map((call) => call.actionId)).toContain(TIKTOK_AD_ACTION);
    for (const call of calls) {
      if ('operationStatus' in call.props) expect(call.props.operationStatus).toBe('DISABLE');
      expect(JSON.stringify(call.props)).not.toContain('ENABLE');
    }
    const group = calls.find((call) => call.actionId === TIKTOK_ADGROUP_ACTION)!;
    expect(group.props.placements).toEqual(['PLACEMENT_TIKTOK']);
    expect(group.props.locationIds).toEqual(['555']);
    expect(group.props.scheduleStartTime).toBe('2026-11-21 15:00:00');
    expect(Number(group.props.budget)).toBeGreaterThan(20);
    const ad = calls.find((call) => call.actionId === TIKTOK_AD_ACTION)!;
    expect(ad.props.adFormat).toBe('SINGLE_VIDEO');
    expect(ad.props.videoId).toBe('vid_9');
    expect(ad.props.landingPageUrl).toBe('https://crew.example');
  });

  it('does not call TikTok when the budget is under the minimum or the city does not match', async () => {
    const low = buildTikTokPlan({ dailyBudget: 20, website: 'https://crew.example', videoUrl: video, trade: 'Plumbing', city: 'Philadelphia', business: 'Pipes' });
    const quiet = runner();
    const blocked = await launchTikTokStructure(quiet.fake, low.plan);
    expect(blocked.ok).toBe(false);
    expect(quiet.calls).toEqual([]);

    const ready = buildTikTokPlan({ dailyBudget: 60, website: 'https://crew.example', videoUrl: video, trade: 'Plumbing', city: 'Philadelphia', business: 'Pipes' });
    const missed = runner({ location: false });
    const nope = await launchTikTokStructure(missed.fake, ready.plan);
    expect(nope.ok).toBe(false);
    expect(nope.note).toBe('no match');
    expect(missed.calls).toEqual([]);
  });

  it('reads ids from nested TikTok payloads and refuses a budget under the minimum', async () => {
    expect(idFrom({ id: 'advertiser', data: { video_id: 'vid_9' } }, ['video_id', 'id'])).toBe('vid_9');
    const { fake, calls } = runner();
    const small = await setTikTokBudget(fake, { advertiserId: '7123', campaignId: 'c1', adGroupIds: ['g1'], daily: 30, shares: [30] });
    expect(small.ok).toBe(false);
    expect(calls).toEqual([]);
    const moved = await setTikTokBudget(fake, { advertiserId: '7123', campaignId: 'c1', adGroupIds: ['g1'], daily: 60, shares: [60] });
    expect(moved.ok).toBe(true);
    expect(moved.note).toMatch(/Status was not changed/);
    const paused = await setTikTokStatus(fake, { advertiserId: '7123', campaignId: 'c1', adGroupIds: ['g1'], adIds: ['a1'], status: 'DISABLE' });
    expect(paused.ok).toBe(true);
    expect(calls.at(-1)!.props.operationStatus).toBe('DISABLE');
  });
});

describe('owner approval routes', () => {
  function harness() {
    const calls: { op: string; status?: string; budget?: number }[] = [];
    const connector = {
      name: 'pipedream',
      async createConnectToken() { return { token: 't', expiresAt: '2099', connectUrl: 'https://connect.example' }; },
      async listAccounts() { return []; },
      async launchMetaStructure(_id: string, plan: { status?: string; dailyBudget?: number }) {
        calls.push({ op: 'meta', status: plan.status, budget: plan.dailyBudget });
        return { ok: true, live: true, status: 'PAUSED', note: 'Created paused. Nothing is spending.', steps: [], campaignId: '555', adSetIds: ['6'], adIds: ['7'] };
      },
      async setMetaTreeStatus(_id: string, args: { status: string }) {
        calls.push({ op: 'meta-status', status: args.status });
        return { ok: true, live: true, status: 'PAUSED', note: args.status === 'ACTIVE' ? 'Meta reports the campaign as active.' : 'Paused.', steps: [] };
      },
      async setMetaBudget(_id: string, args: { daily: number }) {
        calls.push({ op: 'meta-budget', budget: args.daily });
        return { ok: true, live: true, status: 'PAUSED', note: 'budget', steps: [] };
      },
      async launchTikTokStructure() {
        calls.push({ op: 'tiktok' });
        return { ok: false, live: false, status: 'DISABLE', note: 'should not run', steps: [] };
      },
    } as unknown as Connector;
    return { connector, calls };
  }

  async function cookie(app: ReturnType<typeof buildServer>) {
    const r = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: `social-${Date.now()}-${Math.random()}@example.com`, password: 'password1', tos: true } });
    return String(r.headers['set-cookie']).split(';')[0] ?? '';
  }

  it('returns the Meta structure on build and will not create it without confirm or over the cap', async () => {
    const { connector, calls } = harness();
    const app = buildServer({ authStore: new MemoryStore(), connector });
    const c = await cookie(app);
    await app.inject({ method: 'PUT', url: '/api/profile', headers: { cookie: c }, payload: { businessName: 'Local Crew', industry: 'Roofing', serviceAreas: 'Philadelphia, 19103', website: 'https://crew.example', dailyBudget: '80' } });
    await app.inject({ method: 'PUT', url: '/api/assets', headers: { cookie: c }, payload: { assets: { photos: [{ url: image }] } } });
    const built = await app.inject({ method: 'POST', url: '/api/meta/build', headers: { cookie: c }, payload: {} });
    expect(built.statusCode).toBe(200);
    const body = built.json();
    expect(body.structure.objective).toBe('OUTCOME_LEADS');
    expect(body.structure.adSets.some((set: { included: boolean }) => set.included)).toBe(true);
    expect(body.checklist.some((row: { id: string }) => row.id === 'objective')).toBe(true);
    const quiet = await app.inject({ method: 'POST', url: '/api/meta/launch', headers: { cookie: c }, payload: { structure: body.structure, confirm: false } });
    expect(quiet.statusCode).toBe(400);
    expect(calls).toEqual([]);
    body.structure.dailyBudget = 500;
    const over = await app.inject({ method: 'POST', url: '/api/meta/launch', headers: { cookie: c }, payload: { structure: body.structure, confirm: true } });
    expect(over.statusCode).toBe(409);
    expect(calls).toEqual([]);
    body.structure.dailyBudget = 80;
    const yes = await app.inject({ method: 'POST', url: '/api/meta/launch', headers: { cookie: c }, payload: { structure: { ...body.structure, status: 'ACTIVE' }, confirm: true } });
    expect(yes.statusCode).toBe(200);
    expect(yes.json().status).toBe('PAUSED');
    expect(yes.json().live).toBe(false);
    expect(calls).toEqual([{ op: 'meta', status: 'PAUSED', budget: 80 }]);
    const on = await app.inject({ method: 'POST', url: '/api/meta/delivery', headers: { cookie: c }, payload: { confirm: true, campaignId: '555', status: 'live' } });
    expect(on.statusCode).toBe(200);
    expect(calls.some((row) => row.op === 'meta-status' && row.status === 'ACTIVE')).toBe(true);
    const undo = await app.inject({ method: 'POST', url: '/api/social/undo', headers: { cookie: c }, payload: { confirm: true, id: on.json().undoId } });
    expect(undo.statusCode).toBe(200);
    expect(calls.filter((row) => row.op === 'meta-status').at(-1)!.status).toBe('PAUSED');
    await app.close();
  });

  it('shows a TikTok plan and does not call TikTok when the review blocks it', async () => {
    const { connector, calls } = harness();
    const app = buildServer({ authStore: new MemoryStore(), connector });
    const c = await cookie(app);
    await app.inject({ method: 'PUT', url: '/api/profile', headers: { cookie: c }, payload: { businessName: 'Pipes', industry: 'Plumbing', serviceAreas: 'Philadelphia', website: 'https://crew.example', dailyBudget: '20' } });
    const built = await app.inject({ method: 'POST', url: '/api/tiktok/build', headers: { cookie: c }, payload: { videoUrl: video } });
    expect(built.statusCode).toBe(200);
    expect(built.json().plan.objective).toBe('LEAD_GENERATION');
    const launch = await app.inject({ method: 'POST', url: '/api/tiktok/launch', headers: { cookie: c }, payload: { plan: built.json().plan, confirm: true } });
    expect(launch.statusCode).toBe(409);
    expect(launch.json().note).toMatch(/\$50/);
    expect(calls.filter((row) => row.op === 'tiktok')).toEqual([]);
    await app.close();
  });
});
