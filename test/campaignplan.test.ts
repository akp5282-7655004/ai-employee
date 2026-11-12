import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import type { Connector } from '../src/connectors/types.js';
import { applyPlanAnswer, buildSearchPlan, planQuestions } from '../src/agents/campaignplan.js';
import { validateCampaignSpec } from '../src/agents/campaign.js';

const html = '<html><head><title>Painters In Philly</title></head><body><p>Interior painting, exterior painting, cabinet painting, and commercial painting in Philadelphia. Call 215-555-0199. Monday 8am to 5pm.</p></body></html>';

describe('campaign plan generation', () => {
  const plan = buildSearchPlan({
    businessName: 'Painters In Philly',
    trade: 'Painting',
    services: 'Interior painting, exterior painting, cabinet painting, commercial painting',
    serviceAreas: 'Philadelphia, PA',
    phone: '215-555-0199',
    website: 'https://paintersinphilly.com',
    hours: 'Monday 8am to 5pm',
    goal: 'Get more calls',
    dailyBudget: 20,
    jobsToAvoid: 'jobs, careers, diy, how to, free, cheap, supplies, salary, school, sherwin williams, home depot',
    keywordFocus: 'interior painting philadelphia',
  });

  it('uses phrase and exact match, presence, negatives, and normal capitalization', () => {
    expect(plan.questions.map((q) => q.id)).not.toContain('services');
    expect(plan.questions.map((q) => q.id)).not.toContain('areas');
    expect(plan.spec.targeting?.presence).toBe('PRESENCE');
    expect(plan.spec.targeting?.schedule).toMatchObject({ startHour: 8, endHour: 17 });
    expect(plan.spec.dailyBudget).toBe(20);
    expect(plan.spec.biddingStrategy).toBe('MAXIMIZE_CLICKS');
    expect(plan.spec.bidPlan?.maxCpc).toBe(4);
    expect(plan.spec.locations.join(' ')).toMatch(/Philadelphia/);
    const names = plan.spec.adGroups.map((group) => group.name);
    expect(names).toEqual(expect.arrayContaining(['Interior Painting', 'Exterior Painting', 'Cabinet Painting', 'Commercial Painting']));
    for (const group of plan.spec.adGroups) {
      expect(group.keywords.length).toBeGreaterThan(0);
      expect(group.keywords.every((row) => row.match === 'phrase' || row.match === 'exact')).toBe(true);
      expect(group.keywords.some((row) => row.match === 'phrase' && row.text.includes('philadelphia'))).toBe(true);
      expect(group.keywords.some((row) => row.match === 'exact')).toBe(true);
      for (const line of [...group.rsa.headlines, ...group.rsa.descriptions]) {
        expect(line).toBe(line.replace(/\b[A-Z]{4,}\b/g, ''));
      }
    }
    const negatives = plan.spec.negatives.join(' ');
    expect(negatives).toMatch(/jobs/);
    expect(negatives).toMatch(/diy/);
    expect(negatives).toMatch(/sherwin/);
    expect(negatives).toMatch(/home depot|supplies|salary|school/);
    expect(plan.spec.status).toBe('PAUSED');
    expect(plan.sections.map((section) => section.title)).toEqual(['Locations', 'Keywords', 'Negative keywords', 'Ads', 'Assets', 'Budget and bidding']);
    expect(plan.sections.every((section) => section.reason && !section.reason.includes('\u2014'))).toBe(true);
  });

  it('asks one gap at a time and saves the answer onto the profile', () => {
    const first = planQuestions({ trade: 'Painting', businessName: 'Painters' });
    expect(first[0]?.id).toBe('website');
    expect(first[0]?.suggested).toBe('');
    const saved = applyPlanAnswer({ trade: 'Painting' }, 'services', 'Interior painting, Cabinet painting');
    expect(saved.services).toBe('Interior painting, Cabinet painting');
    const next = buildSearchPlan(saved);
    expect(next.questions.map((q) => q.id)).not.toContain('services');
    expect(next.spec.adGroups.map((group) => group.name)).toEqual(expect.arrayContaining(['Interior Painting', 'Cabinet Painting']));
  });
});

describe('approve then launch', () => {
  it('refuses to launch until the plan is approved, then builds that plan once', async () => {
    const calls: { op: string; name?: string; budget?: number; status?: string }[] = [];
    const connector = {
      name: 'pipedream',
      async createConnectToken() { return { token: 't', expiresAt: '2099-01-01', connectUrl: 'https://connect.example' }; },
      async listAccounts() { return [{ id: 'acct', app: 'google_ads', externalUserId: 'u', healthy: true }]; },
      async runAction() { return { ok: true, actionId: 'x', app: 'google_ads', output: null }; },
      async listAdTargets() { return [{ id: '9013698905', label: 'Painters' }]; },
      async launchCampaign(_id: string, spec: { name: string; dailyBudget: number; status?: string }) {
        calls.push({ op: 'launch', name: spec.name, budget: spec.dailyBudget, status: spec.status });
        return {
          ok: true, live: true, campaignResource: 'customers/9013698905/campaigns/111',
          steps: [
            { step: 'Create daily budget ($20)', ok: true, resource: 'customers/9013698905/campaignBudgets/1' },
            { step: 'Create campaign "Painting" (PAUSED)', ok: true, resource: 'customers/9013698905/campaigns/111' },
            { step: 'Create ad group "Interior painting"', ok: true, resource: 'customers/9013698905/adGroups/3' },
            { step: 'Add 4 keywords to "Interior painting"', ok: true },
            { step: 'Create responsive search ad in "Interior painting"', ok: true, resource: 'customers/9013698905/ads/8' },
          ],
        };
      },
      async setGoogleCampaignStatus() {
        calls.push({ op: 'status' });
        return { ok: true, live: true, called: true, note: 'Google reports the campaign, its ad groups, and its ads as enabled.', readback: { campaign: 'ENABLED', adGroups: ['ENABLED'], ads: ['ENABLED'], note: 'Read from the account list.' } };
      },
    } as unknown as Connector;
    const app = buildServer({ authStore: new MemoryStore(), connector });
    const signed = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'plan@example.com', password: 'password1', tos: true } });
    const headers = { cookie: String(signed.headers['set-cookie']).split(';')[0] };
    await app.inject({ method: 'POST', url: '/api/miles/crawl', headers, payload: { businessName: 'Painters In Philly', location: 'Philadelphia, PA', website: 'https://paintersinphilly.com', html } });
    await app.inject({ method: 'POST', url: '/api/miles/questions', headers, payload: { goal: 'Get more calls', dailyBudget: 20, leadsPerDay: 1, mode: 'automate' } });
    await app.inject({ method: 'POST', url: '/api/miles/tracking', headers, payload: { leadConversion: true, method: 'call_or_form' } });
    const blocked = await app.inject({ method: 'POST', url: '/api/miles/go', headers, payload: { confirm: true } });
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json().needsPlan).toBe(true);
    expect(calls).toEqual([]);
    const draft = await app.inject({ method: 'GET', url: '/api/miles/plan', headers });
    expect(draft.json().preapproved).toBe(false);
    expect(draft.json().spec.dailyBudget).toBe(20);
    expect(validateCampaignSpec(draft.json().spec)).toEqual([]);
    if (draft.json().questions?.length) {
      const answer = await app.inject({ method: 'POST', url: '/api/miles/plan/answer', headers, payload: { id: draft.json().questions[0].id, value: draft.json().questions[0].suggested || 'jobs, diy, free' } });
      expect(answer.statusCode).toBe(200);
    }
    const again = await app.inject({ method: 'GET', url: '/api/miles/plan', headers });
    const approved = await app.inject({ method: 'POST', url: '/api/miles/go', headers, payload: { confirm: true, plan: again.json().spec } });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().created).toBe(true);
    expect(calls.find((call) => call.op === 'launch')).toMatchObject({ budget: 20, status: 'PAUSED' });
    const home = await app.inject({ method: 'GET', url: '/api/miles/home', headers });
    expect(home.json().planApproved).toBe(true);
    const log = await app.inject({ method: 'GET', url: '/api/approvals', headers });
    expect(log.json().entries.map((entry: { title: string }) => entry.title).join(' ')).toMatch(/Approved Google Search plan/);
    const second = await app.inject({ method: 'POST', url: '/api/miles/go', headers, payload: { confirm: true } });
    expect(second.json().created).toBe(false);
    expect(calls.filter((call) => call.op === 'launch')).toHaveLength(1);
  });
});
