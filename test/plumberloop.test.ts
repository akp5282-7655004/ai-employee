import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import { buildLoopPlan, decideLead, ghlUpsertProps, GHL_UPSERT_ACTION, normalizeLead, readMarket } from '../src/agents/plumberloop.js';
import { PIPEDREAM_APPS, appByProduct } from '../src/connectors/pipedreamCatalog.js';
import type { Connector } from '../src/connectors/types.js';

const plumber = {
  businessName: 'Rivera Plumbing',
  trade: 'plumbing',
  city: 'Philadelphia',
  services: 'drain cleaning, leak repair',
  website: 'https://rivera.example',
  logoUrl: 'https://rivera.example/logo.png',
};

describe('Pipedream catalog is quoted, not assumed connected', () => {
  it('names the verified Google and TikTok campaign keys and the missing Meta one', () => {
    expect(appByProduct('Google Ads')?.campaign.actionKey).toBe('google_ads-create-or-update-campaign');
    expect(appByProduct('TikTok Ads')?.slug).toBe('tiktok_ads_manager');
    expect(appByProduct('TikTok Ads')?.campaign.actionKey).toBe('tiktok_ads_manager-create-or-update-campaign');
    expect(appByProduct('TikTok Ads')?.repoWiring).toMatch(/Not wired/);
    const meta = appByProduct('Meta Ads (Facebook and Instagram campaigns)');
    expect(meta?.catalog).toBe('not_found');
    expect(meta?.campaign.available).toBe(false);
    expect(appByProduct('Facebook Pages')?.campaign.actionKey).toBe('facebook_pages-create-post');
    expect(appByProduct('GoHighLevel')?.campaign.actionKey).toBe(GHL_UPSERT_ACTION);
    expect(PIPEDREAM_APPS.every((a) => a.ownerProject === 'unknown')).toBe(true);
  });
});

describe('a $20 plumber plan', () => {
  it('keeps the total, creates only paused Search dollars, and does not invent spend', () => {
    const plan = buildLoopPlan({ profile: plumber, totalDaily: 20, googleAdsConnected: true, metaConnected: true, observedAds: [
      { id: 'ad1', page: 'Other Plumber', body: 'Free estimates', started: '2026-10-01', source: 'owner_paste' },
      { id: '', page: 'x', body: 'y', started: '2026-10-01', source: 'owner_paste' },
    ] });
    expect(plan.totalDaily).toBe(20);
    expect(plan.executedDaily).toBeLessThanOrEqual(20);
    expect(plan.executedDaily + plan.heldDaily).toBeCloseTo(20, 2);
    expect(plan.channels.find((c) => c.channel === 'meta')?.executable).toBe(false);
    expect(plan.channels.find((c) => c.channel === 'google_leads')?.executable).toBe(false);
    expect(plan.channels.find((c) => c.channel === 'google_leads')?.reason).toMatch(/Local Services Ads/);
    expect(plan.searchSpec?.status).toBe('PAUSED');
    expect(plan.searchSpec?.dailyBudget).toBe(plan.executedDaily);
    expect(plan.asset.logoIncluded).toBe(true);
    expect(plan.asset.headlines.join(' ')).toMatch(/Rivera Plumbing/);
    expect(plan.asset.image.status).toBe('uses_uploaded_logo');
    expect(plan.market.competitorSpend.available).toBe(false);
    expect(plan.market.observedAds).toHaveLength(1);
    expect(plan.budgetControl).toMatch(/not a promise/);
  });

  it('does not claim a logo or a Search create when they are missing', () => {
    const plan = buildLoopPlan({
      profile: { businessName: 'Rivera Plumbing', trade: 'plumbing', city: 'Philadelphia', services: 'drains' },
      totalDaily: 20,
      googleAdsConnected: false,
      metaConnected: false,
    });
    expect(plan.asset.logoIncluded).toBe(false);
    expect(plan.asset.image.status).toBe('blocked');
    expect(plan.channels.find((c) => c.channel === 'google_ads')?.executable).toBe(false);
    expect(plan.executedDaily).toBe(0);
    expect(plan.searchSpec).toBeUndefined();
  });

  it('drops ads that have no date and never fills in a spend', () => {
    const market = readMarket([{ id: '1', page: 'A', body: 'Hi', started: 'not-a-date', source: 'owner_paste' }]);
    expect(market.observedAds).toEqual([]);
    expect(market.competitorSpend.available).toBe(false);
  });
});

describe('lead ingest', () => {
  it('maps a Google lead form without calling it LSA, and suppresses follow-up without consent', () => {
    const parsed = normalizeLead({
      lead_id: 'L1',
      campaign_id: 'C9',
      gcl_id: 'gclid-1',
      user_column_data: [
        { column_id: 'FULL_NAME', string_value: 'Dana' },
        { column_id: 'PHONE_NUMBER', string_value: '2155550100' },
      ],
    });
    expect(parsed.lead?.source).toBe('google_ads_lead_form');
    const no = decideLead({ ...parsed.lead!, consent: false }, [], true);
    expect(no.followUp).toBe(false);
    expect(no.upsert).toBe(true);
    const lsa = normalizeLead({ eventId: 'e2', source: 'google_lsa', name: 'Pat', phone: '2155550199' });
    expect(lsa.lead?.source).toBe('google_lsa_forwarded');
    expect(decideLead(lsa.lead!, [], true).followUp).toBe(false);
    expect(ghlUpsertProps(parsed.lead!).additionalOptions.source).toMatch(/^miles:google_ads_lead_form/);
    expect(JSON.stringify(ghlUpsertProps(parsed.lead!))).not.toMatch(/tags/);
  });
});

describe('journey routes', () => {
  function harness() {
    const calls: { op: string; id?: string; actionId?: string; status?: string }[] = [];
    const accounts = new Map<string, string[]>();
    const targets = new Map<string, { id: string; label: string; login: string }[]>();
    let upsertOk = true;
    const connector = {
      name: 'pipedream',
      async createConnectToken(id: string) { return { token: 't', expiresAt: '2099', connectUrl: 'https://connect.example/' + id }; },
      async listAccounts(id: string) {
        calls.push({ op: 'accounts', id });
        return (accounts.get(id) ?? []).map((app) => ({ id: app, app, externalUserId: id, healthy: true }));
      },
      async listAdTargets(id: string) { return targets.get(id) ?? []; },
      async launchCampaign(id: string, spec: { status?: string; name: string }) {
        calls.push({ op: 'launch', id, status: spec.status });
        return {
          ok: true, live: true, campaignResource: 'customers/1/campaigns/9',
          steps: [
            { step: 'Create daily budget ($4)', ok: true, resource: 'customers/1/campaignBudgets/1' },
            { step: `Create campaign "${spec.name}" (PAUSED)`, ok: true, resource: 'customers/1/campaigns/9' },
            { step: 'Create ad group "Drain"', ok: true, resource: 'customers/1/adGroups/3' },
            { step: 'Add 4 keywords to "Drain"', ok: true },
            { step: 'Create responsive search ad in "Drain"', ok: true },
            { step: 'Verify campaign in Google Ads', ok: true },
          ],
        };
      },
      async runAction(req: { externalUserId: string; actionId: string }) {
        calls.push({ op: 'run', id: req.externalUserId, actionId: req.actionId });
        return { ok: upsertOk, actionId: req.actionId, app: 'highlevel_oauth', output: { id: 'c1' }, note: upsertOk ? undefined : 'ghl down' };
      },
      async runAppTask(req: { externalUserId: string }) {
        calls.push({ op: 'sms', id: req.externalUserId });
        return { ok: true, app: 'highlevel_oauth', summary: 'sent' };
      },
    } as unknown as Connector;
    return { connector, calls, accounts, targets, failUpsert() { upsertOk = false; } };
  }

  async function setup(email = 'plumber@example.com') {
    const h = harness();
    const store = new MemoryStore();
    const app = buildServer({ authStore: store, connector: h.connector });
    const signup = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email, password: 'password1', name: 'Rivera', tos: true } });
    const cookie = String(signup.headers['set-cookie']).split(';')[0] ?? '';
    const id = signup.json().user.id as string;
    await app.inject({
      method: 'PUT', url: '/api/profile', headers: { cookie },
      payload: { businessName: 'Rivera Plumbing', industry: 'plumbing', serviceAreas: 'Philadelphia', services: 'drain cleaning, leak repair', website: 'https://rivera.example' },
    });
    await app.inject({ method: 'PUT', url: '/api/brand', headers: { cookie }, payload: { kit: { logoUrl: 'https://rivera.example/logo.png', colors: ['#0c5aa6'], keywords: [] } } });
    return { h, app, cookie, id, store };
  }

  it('plans without creating, then approves a paused Search create on that tenant only', async () => {
    const a = await setup('a@example.com');
    const b = await setup('b@example.com');
    a.h.accounts.set(a.id, ['google_ads']);
    a.h.targets.set(a.id, [{ id: '1111111111', login: '1111111111', label: 'A — 111-111-1111' }]);
    b.h.accounts.set(b.id, ['google_ads']);
    b.h.targets.set(b.id, [{ id: '2222222222', login: '2222222222', label: 'B — 222-222-2222' }]);

    const plan = await a.app.inject({ method: 'POST', url: '/api/journey/plan', headers: { cookie: a.cookie }, payload: { totalDaily: 20 } });
    expect(plan.statusCode).toBe(200);
    expect(plan.json().plan.asset.logoIncluded).toBe(true);
    expect(a.h.calls.some((c) => c.op === 'launch')).toBe(false);

    const stolen = await b.app.inject({
      method: 'POST', url: '/api/journey/approve', headers: { cookie: b.cookie },
      payload: { confirm: true, totalDaily: 20, target: '1111111111' },
    });
    expect(stolen.statusCode).toBe(400);
    expect(b.h.calls.filter((c) => c.op === 'launch')).toEqual([]);

    const no = await a.app.inject({ method: 'POST', url: '/api/journey/approve', headers: { cookie: a.cookie }, payload: { confirm: false, totalDaily: 20 } });
    expect(no.statusCode).toBe(400);

    const yes = await a.app.inject({ method: 'POST', url: '/api/journey/approve', headers: { cookie: a.cookie }, payload: { confirm: true, totalDaily: 20 } });
    expect(yes.statusCode).toBe(200);
    expect(yes.json().status).toBe('PAUSED');
    expect(yes.json().live).toBe(true);
    expect(a.h.calls.find((c) => c.op === 'launch')).toMatchObject({ id: a.id, status: 'PAUSED' });

    const act = await a.app.inject({
      method: 'POST', url: '/api/journey/activate', headers: { cookie: a.cookie },
      payload: { confirm: true, campaignResource: 'customers/1/campaigns/9', dailyBudget: 999 },
    });
    expect(act.statusCode).toBe(403);
    expect(act.json().providerCalled).toBe(false);
    expect(a.h.calls.filter((c) => c.op === 'launch')).toHaveLength(1);

    const other = await b.app.inject({
      method: 'POST', url: '/api/journey/activate', headers: { cookie: b.cookie },
      payload: { confirm: true, campaignResource: 'customers/1/campaigns/9' },
    });
    expect(other.statusCode).toBe(403);
    await a.app.close();
    await b.app.close();
  });

  it('upserts once, retries a failed write, and does not text without consent', async () => {
    const { h, app, id, store } = await setup();
    h.accounts.set(id, ['highlevel_oauth']);
    const data = await store.getUserData(id);
    const secret = 'a'.repeat(24);
    data.speedToLead = { enabled: true, webhookSecret: secret, contacted: [], log: [] };
    await store.setUserData(id, data);
    const token = `${id}.${secret}`;

    const lead = { eventId: 'evt-1', source: 'google_ads_lead_form', name: 'Dana', phone: '2155550100', consent: false, campaign: 'Search' };
    const first = await app.inject({ method: 'POST', url: '/api/journey/leads/' + token, payload: lead });
    expect(first.statusCode).toBe(200);
    expect(first.json().upserted).toBe(true);
    expect(first.json().followedUp).toBe(false);
    expect(h.calls.filter((c) => c.op === 'sms')).toEqual([]);
    expect(h.calls.find((c) => c.op === 'run')?.actionId).toBe(GHL_UPSERT_ACTION);

    const again = await app.inject({ method: 'POST', url: '/api/journey/leads/' + token, payload: lead });
    expect(again.json().duplicate).toBe(true);
    expect(h.calls.filter((c) => c.op === 'run')).toHaveLength(1);

    h.failUpsert();
    const retry = await app.inject({ method: 'POST', url: '/api/journey/leads/' + token, payload: { ...lead, eventId: 'evt-2', consent: true } });
    expect(retry.statusCode).toBe(503);
    h.calls.splice(0, h.calls.length);
    const anon = await app.inject({ method: 'POST', url: '/api/journey/leads/nope.secret', payload: lead });
    expect(anon.statusCode).toBe(401);
    await app.close();
  });
});
