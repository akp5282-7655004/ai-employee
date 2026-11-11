import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import { buildLoopPlan } from '../src/agents/plumberloop.js';
import { assessProfile, judgeTikTokCreate, planFollowUp, proposeOptimizations, rollupJobs, seasonFocus, stageOpportunity, TIKTOK_PAUSED_STATUS } from '../src/agents/contractorloop.js';
import type { Connector } from '../src/connectors/types.js';

const painter = {
  businessName: 'Philadelphia Painting Co',
  trade: 'Painting',
  city: 'Philadelphia',
  services: 'interior painting, exterior painting',
  website: 'https://paint.example',
  targetCpl: 45,
  averageJobValue: 3200,
};

describe('profile gate', () => {
  it('lists what is missing and does not invent a $20 budget or a city', () => {
    const plan = buildLoopPlan({ profile: { businessName: 'Philadelphia Painting Co', trade: 'Painting' }, googleAdsConnected: true, metaConnected: false });
    expect(plan.complete).toBe(false);
    expect(plan.missing.map((m) => m.field)).toEqual(expect.arrayContaining(['serviceArea', 'budget', 'targetCpl', 'averageJobValue', 'landingPage']));
    expect(plan.totalDaily).toBe(0);
    expect(plan.searchSpec).toBeUndefined();
    expect(plan.geo).toEqual([]);
    expect(JSON.stringify(plan)).not.toMatch(/United States/);
    expect(JSON.stringify(plan)).not.toMatch(/plumbing/i);
  });

  it('follows a painting profile in Philadelphia and stays inside the approved total', () => {
    const plan = buildLoopPlan({ profile: painter, totalDaily: 20, googleAdsConnected: true, metaConnected: false, now: new Date('2026-11-09T12:00:00Z') });
    expect(plan.complete).toBe(true);
    expect(plan.executedDaily).toBeLessThanOrEqual(20);
    expect(plan.searchCampaigns).toHaveLength(1);
    expect(plan.searchCampaigns[0]?.role).toBe('planned');
    expect(plan.searchCampaigns[0]?.spec.locations.join(' ')).toMatch(/Philadelphia/);
    expect(plan.searchCampaigns[0]?.spec.locations.join(' ')).not.toMatch(/United States/);
    expect(JSON.stringify(plan.searchCampaigns)).toMatch(/paint/i);
    expect(JSON.stringify(plan.searchCampaigns)).not.toMatch(/plumb/i);
    expect(plan.channels.find((c) => c.channel === 'meta')?.status).toBe('not_in_mix');
  });

  it('splits emergency and planned plumbing budgets without passing the cap', () => {
    const plan = buildLoopPlan({
      profile: { ...painter, businessName: 'Rivera Plumbing', trade: 'plumbing', services: 'drain cleaning, water heater' },
      totalDaily: 20,
      googleAdsConnected: true,
      metaConnected: false,
    });
    expect(plan.searchCampaigns.map((c) => c.role)).toEqual(['emergency', 'planned']);
    const sum = plan.searchCampaigns.reduce((s, c) => s + c.spec.dailyBudget, 0);
    expect(sum).toBeCloseTo(plan.executedDaily, 2);
    expect(sum).toBeLessThanOrEqual(20);
    expect(plan.searchCampaigns.every((c) => c.spec.status === 'PAUSED')).toBe(true);
    expect(plan.searchCampaigns[0]?.schedule).toMatch(/All hours/);
    expect(plan.searchCampaigns[1]?.schedule).toMatch(/Weekdays/);
  });
});

describe('seasonality and follow-up', () => {
  it('shifts HVAC toward air conditioning in July and furnace in October', () => {
    expect(seasonFocus('hvac', 6).line).toMatch(/air conditioning/);
    expect(seasonFocus('hvac', 9).line).toMatch(/furnace/);
    expect(seasonFocus('painting', 3).line).toMatch(/exterior/);
  });

  it('holds a missed-call text as a draft when GoHighLevel is not connected', () => {
    const held = planFollowUp({ name: 'Dana', phone: '2155550100', consent: true, missedCall: true, ghlConnected: false, automationEnabled: true, businessName: 'Philadelphia Painting Co' });
    expect(held.disposition).toBe('draft');
    expect(held.kind).toBe('missed_call');
    expect(held.body).toMatch(/missed your call/);
    const opted = planFollowUp({ name: 'Dana', phone: '2155550100', optOut: true, ghlConnected: true, automationEnabled: true });
    expect(opted.disposition).toBe('skip');
  });
});

describe('jobs, optimization, and channels', () => {
  it('rolls up real rows and labels an empty sample set', () => {
    const real = rollupJobs({
      sample: false,
      spend: [{ channel: 'google_ads', serviceLine: 'painting', amount: 200 }],
      jobs: [
        { eventId: '1', stage: 'won', jobValue: 500, channel: 'google_ads', serviceLine: 'painting' },
        { eventId: '2', stage: 'qualified', channel: 'google_ads', serviceLine: 'painting' },
      ],
    });
    expect(real.sample).toBe(false);
    expect(real.label).toMatch(/recorded spend/);
    expect(real.byChannel[0]?.cpl).toBe(100);
    expect(real.byChannel[0]?.cac).toBe(200);
    expect(real.byServiceLine[0]?.roi).toBe(1.5);
    const sample = rollupJobs({ sample: true, spend: [], jobs: [] });
    expect(sample.label).toMatch(/Sample data/);
  });

  it('proposes pauses and shifts that still require approval', () => {
    const out = proposeOptimizations({
      targetCpl: 40,
      spendThreshold: 50,
      approvedDailyCap: 20,
      rows: [
        { campaign: 'Emergency', channel: 'google_ads', spend: 80, leads: 0, booked: 0, won: 0, jobValue: 0, dailyBudget: 10 },
        { campaign: 'Planned', channel: 'google_ads', spend: 40, leads: 2, booked: 1, won: 1, jobValue: 400, dailyBudget: 10 },
      ],
      missedCalls: 4,
      averageJobValue: 400,
      leadsForRate: 2,
      bookedForRate: 1,
    });
    expect(out.requiresApproval).toBe(true);
    expect(out.proposals.every((p) => p.requiresApproval)).toBe(true);
    expect(out.proposals.some((p) => p.kind === 'pause')).toBe(true);
    expect(out.missedCallDollars).toBe(800);
    expect(out.missedCallNote).toMatch(/Not a guarantee/);
  });

  it('does not send an opportunity action', () => {
    expect(stageOpportunity().sent).toBe(false);
    expect(stageOpportunity().action).toBeNull();
  });

  it('allows a TikTok create only as DISABLE inside the cap', () => {
    const no = judgeTikTokCreate({ confirm: true, advertiserId: 'a', campaignName: 'Paint', dailyBudget: 30, approvedDailyCap: 20, connected: true });
    expect(no.allowed).toBe(false);
    const yes = judgeTikTokCreate({ confirm: true, advertiserId: 'a', campaignName: 'Paint', dailyBudget: 10, approvedDailyCap: 20, connected: true });
    expect(yes.configuredProps?.operationStatus).toBe(TIKTOK_PAUSED_STATUS);
    expect(yes.configuredProps?.operationStatus).toBe('DISABLE');
  });

  it('rejects a profile that has no recognizable trade instead of assuming plumbing', () => {
    expect(assessProfile({ businessName: 'Acme', trade: 'dentistry', serviceArea: 'Philadelphia', dailyBudget: 20, targetCpl: 10, averageJobValue: 100, landingPage: 'https://acme.example' }).trade).toBe('');
    expect(assessProfile({ businessName: 'Acme', trade: 'dentistry', serviceArea: 'Philadelphia', dailyBudget: 20, targetCpl: 10, averageJobValue: 100, landingPage: 'https://acme.example' }).missing.some((m) => m.field === 'trade')).toBe(true);
  });
});

describe('activation, revert, and honest dashboard', () => {
  it('enables only after approval and pauses on revert, and blocks a production tool-call failure', async () => {
    const calls: { op: string; status?: string; id?: string; actionId?: string }[] = [];
    let blocked = false;
    const connector = {
      name: 'pipedream',
      async createConnectToken() { return { token: 't', expiresAt: '2099', connectUrl: 'https://connect.example' }; },
      async listAccounts(id: string) {
        return [{ id: 'apn_current', app: 'google_ads', externalUserId: id, healthy: true }];
      },
      async listAdTargets(id: string) { return blocked ? [] : [{ id: '1111111111', login: '1111111111', label: 'A' }]; },
      googleAdsBlock() { return blocked ? { kind: 'connect_production_unavailable', message: 'blocked', providerMessage: 'Tool calling via Pipedream Connect in production is not available on this workspace.' } : null; },
      async launchCampaign(id: string, spec: { status?: string }) {
        calls.push({ op: 'launch', id, status: spec.status });
        return { ok: true, live: true, campaignResource: 'customers/1/campaigns/9', steps: [
          { step: 'Create daily budget', ok: true, resource: 'customers/1/campaignBudgets/1' },
          { step: 'Create campaign "x" (PAUSED)', ok: true, resource: 'customers/1/campaigns/9' },
          { step: 'Create ad group "g"', ok: true, resource: 'customers/1/adGroups/1' },
          { step: 'Add 3 keywords to "g"', ok: true },
          { step: 'Create responsive search ad in "g"', ok: true },
          { step: 'Verify campaign in Google Ads', ok: true },
        ] };
      },
      async setGoogleCampaignStatus(id: string, args: { status: string }) {
        calls.push({ op: 'status', id, status: args.status });
        return { ok: true, live: true, called: true, note: args.status };
      },
      async runAction(req: { externalUserId: string; actionId: string; configuredProps?: { operationStatus?: string } }) {
        calls.push({ op: 'run', id: req.externalUserId, actionId: req.actionId, status: req.configuredProps?.operationStatus });
        return { ok: true, actionId: req.actionId, app: 'tiktok_ads_manager', output: {} };
      },
    } as unknown as Connector;
    const app = buildServer({ authStore: new MemoryStore(), connector });
    const signup = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'painter@example.com', password: 'password1', name: 'Pat', tos: true } });
    const cookie = String(signup.headers['set-cookie']).split(';')[0] ?? '';
    const id = signup.json().user.id as string;
    await app.inject({ method: 'PUT', url: '/api/profile', headers: { cookie }, payload: { businessName: 'Philadelphia Painting Co', industry: 'Painting', serviceAreas: 'Philadelphia, 19103', services: 'interior painting', website: 'https://paint.example', targetCpl: '45', averageJobValue: '3200', dailyBudget: '20' } });
    const yes = await app.inject({ method: 'POST', url: '/api/journey/approve', headers: { cookie }, payload: { confirm: true, totalDaily: 20 } });
    expect(yes.statusCode).toBe(200);
    expect(yes.json().status).toBe('PAUSED');
    expect(calls.filter((c) => c.op === 'launch').every((c) => c.status === 'PAUSED' && c.id === id)).toBe(true);
    const tracking = await app.inject({ method: 'POST', url: '/api/miles/tracking', headers: { cookie }, payload: { leadConversion: true, ga4Linked: true, method: 'thank_you' } });
    expect(tracking.statusCode).toBe(200);
    const act = await app.inject({ method: 'POST', url: '/api/journey/activate', headers: { cookie }, payload: { confirm: true, campaignResource: 'customers/1/campaigns/9', dailyBudget: 20 } });
    expect(act.statusCode).toBe(200);
    expect(act.json().providerCalled).toBe(true);
    expect(act.json().status).toBe('ENABLED');
    expect(act.json().activatedBy).toBe('painter@example.com');
    expect(calls.some((c) => c.op === 'status' && c.status === 'ENABLED')).toBe(true);
    const back = await app.inject({ method: 'POST', url: '/api/journey/revert', headers: { cookie }, payload: { confirm: true, campaignResource: 'customers/1/campaigns/9' } });
    expect(back.statusCode).toBe(200);
    expect(back.json().status).toBe('PAUSED');
    expect(calls.some((c) => c.op === 'status' && c.status === 'PAUSED')).toBe(true);
    const before = calls.filter((c) => c.op === 'status').length;
    blocked = true;
    const again = await app.inject({ method: 'POST', url: '/api/journey/activate', headers: { cookie }, payload: { confirm: true, campaignResource: 'customers/1/campaigns/9', dailyBudget: 20 } });
    expect(again.statusCode).toBe(403);
    expect(again.json().providerCalled).toBe(false);
    expect(calls.filter((c) => c.op === 'status').length).toBe(before);
    const meta = await app.inject({ method: 'POST', url: '/api/meta/launch', headers: { cookie }, payload: { confirm: true, spec: { name: 'x' } } });
    expect(meta.statusCode).toBe(409);
    const dash = await app.inject({ method: 'GET', url: '/api/dashboard', headers: { cookie } });
    expect(dash.json().sample).toBe(false);
    await app.close();
  });
});
