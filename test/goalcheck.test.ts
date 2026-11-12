import { describe, expect, it } from 'vitest';
import { BENCHMARK_HUB } from '../src/packs/benchmarks.js';
import { choiceById, goalCheck, nationalSearchCpl } from '../src/agents/goalcheck.js';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import type { Connector } from '../src/connectors/types.js';
import { validateCampaignSpec } from '../src/agents/campaign.js';

function googleCpl(trade: string) {
  const channel = BENCHMARK_HUB.find((c) => c.id === 'google_ads');
  return channel?.entries.find((e) => e.trade === trade && e.metric === 'CPL') ?? null;
}

describe('goal check math', () => {
  it('uses the published plumbing figures and says the city fell back to national', () => {
    const row = googleCpl('Plumbing');
    expect(row?.value).toBe(183);
    expect(row?.note).toContain('$168');
    const band = nationalSearchCpl('plumbing');
    expect(band).toMatchObject({ low: 168, typical: 183, high: 183, single: false });
    const check = goalCheck({
      trade: 'Plumbing',
      city: 'Philadelphia',
      budgetAmount: 20,
      budgetPeriod: 'day',
      leadGoal: 20,
      leadPeriod: 'month',
    });
    expect(check.likely).toBe('not_likely');
    expect(check.leads).toEqual({ low: 3, typical: 3, high: 4 });
    expect(check.verdict).toBe('Not likely. For 20 leads a month you would need about $122/day, or at $20/day expect about 3 to 4 leads.');
    expect(check.cityNote).toMatch(/Philadelphia/);
    expect(check.cityNote).toMatch(/national/);
    expect(check.assumption).toMatch(/\$168/);
    expect(check.assumption).toMatch(/\$183/);
    expect(check.assumption).toMatch(/Industry benchmarks, aggregated from public sources/);
    expect(JSON.stringify(check).toLowerCase()).not.toContain('searchlight');
    expect(check.verdict).not.toContain('\u2014');
    const keep = choiceById(check, 'keep_budget');
    const raise = choiceById(check, 'raise_budget');
    expect(keep).toMatchObject({ daily: 20, leadGoal: 3, raisesCap: false });
    expect(raise).toMatchObject({ daily: 122, leadGoal: 20, raisesCap: false });
  });

  it('treats a monthly budget as 30 days and a weekly goal as 7 days', () => {
    const month = goalCheck({ trade: 'Plumbing', city: 'Austin', budgetAmount: 600, budgetPeriod: 'month', leadGoal: 3, leadPeriod: 'month' });
    expect(month.likely).toBe('yes');
    expect(month.daily).toBe(20);
    expect(month.verdict).toBe('Yes, $20/day should bring about 3 to 4 leads a month.');
    const week = goalCheck({ trade: 'Plumbing', city: 'Austin', budgetAmount: 20, budgetPeriod: 'day', leadGoal: 5, leadPeriod: 'week' });
    expect(week.likely).toBe('not_likely');
    expect(week.verdict).toBe('Not likely. For 5 leads a week you would need about $131/day, or at $20/day expect about 1 lead.');
  });

  it('reads the HVAC spread from the benchmark note and does not average it', () => {
    const row = googleCpl('HVAC');
    expect(row?.value).toBe(149);
    expect(row?.note).toContain('$144');
    expect(row?.note).toContain('$198');
    expect(nationalSearchCpl('HVAC')).toMatchObject({ low: 144, typical: 149, high: 198 });
    const check = goalCheck({ trade: 'HVAC', city: 'Dallas', budgetAmount: 20, budgetPeriod: 'day', leadGoal: 4, leadPeriod: 'month' });
    expect(check.leads).toEqual({ low: 3, typical: 4, high: 4 });
    expect(check.likely).toBe('yes');
  });

  it('keeps roofing, garage door, and electrical on their published non-brand figures', () => {
    expect(googleCpl('Roofing')?.value).toBe(124);
    expect(nationalSearchCpl('Roofing')).toMatchObject({ low: 124, typical: 124, high: 124, single: true });
    expect(googleCpl('Garage Door')?.value).toBe(173);
    expect(nationalSearchCpl('Garage door')).toMatchObject({ low: 173, typical: 173, high: 173 });
    const electrical = googleCpl('Electrical');
    expect(electrical?.value).toBe(163);
    expect(electrical?.note).toContain('$128');
    expect(nationalSearchCpl('Electrical')).toMatchObject({ low: 128, typical: 163, high: 163 });
  });

  it('does not invent a painting cost per lead when the trade has no national row', () => {
    expect(nationalSearchCpl('painting')).toBeNull();
    expect(googleCpl('Painting')).toBeNull();
    const check = goalCheck({ trade: 'Painting', city: 'Philadelphia', budgetAmount: 20, budgetPeriod: 'day', leadGoal: 10, leadPeriod: 'month' });
    expect(check.likely).toBe('unknown');
    expect(check.leads).toBeNull();
    expect(check.verdict).toMatch(/will not guess/);
    expect(check.cityNote).toMatch(/no national Google Ads figure/i);
    expect(check.assumption).not.toMatch(/\$40|\$90|\$42/);
    expect(check.choices.map((choice) => choice.id)).toEqual(['keep_budget']);
  });
});

describe('cap handling', () => {
  it('keeps the saved cap unless the owner picks the raise choice', () => {
    const check = goalCheck({
      trade: 'Plumbing',
      city: 'Philadelphia',
      budgetAmount: 500,
      budgetPeriod: 'day',
      leadGoal: 20,
      leadPeriod: 'month',
      caps: { daily: 20, monthly: 600 },
    });
    const keep = choiceById(check, 'keep_budget')!;
    const raise = choiceById(check, 'raise_budget')!;
    expect(keep.daily).toBe(20);
    expect(keep.leadGoal).toBe(3);
    expect(keep.raisesCap).toBe(false);
    expect(keep.monthly).toBe(600);
    expect(raise.daily).toBe(122);
    expect(raise.leadGoal).toBe(20);
    expect(raise.raisesCap).toBe(true);
    expect(raise.monthly).toBe(3660);
    expect(raise.label).toMatch(/Raise my daily cap to \$122/);
    expect(raise.label).toMatch(/\$3,660 a month/);
  });
});

describe('confirm then build', () => {
  function app() {
    const calls: { op: string; budget?: number; status?: string }[] = [];
    const connector = {
      name: 'pipedream',
      async createConnectToken() { return { token: 't', expiresAt: '2099-01-01', connectUrl: 'https://connect.example' }; },
      async listAccounts() { return [{ id: 'acct', app: 'google_ads', externalUserId: 'u', healthy: true }]; },
      async runAction() { return { ok: true, actionId: 'x', app: 'google_ads', output: null }; },
      async listAdTargets() { return [{ id: '9013698905', label: 'Rivera' }]; },
      async launchCampaign(_id: string, spec: { dailyBudget: number; status?: string }) {
        calls.push({ op: 'launch', budget: spec.dailyBudget, status: spec.status });
        return {
          ok: true, live: true, campaignResource: 'customers/9013698905/campaigns/111',
          steps: [
            { step: 'Create daily budget', ok: true, resource: 'customers/9013698905/campaignBudgets/1' },
            { step: 'Create campaign (PAUSED)', ok: true, resource: 'customers/9013698905/campaigns/111' },
            { step: 'Create ad group "Drain cleaning"', ok: true, resource: 'customers/9013698905/adGroups/3' },
            { step: 'Add keywords', ok: true },
            { step: 'Create responsive search ad', ok: true, resource: 'customers/9013698905/ads/8' },
            { step: 'Add location targeting', ok: true },
          ],
        };
      },
      async setGoogleCampaignStatus() {
        calls.push({ op: 'status' });
        return { ok: true, live: true, called: true, note: 'Enabled.', readback: { campaign: 'ENABLED', adGroups: ['ENABLED'], ads: ['ENABLED'], note: 'Read from the account list.' } };
      },
    } as unknown as Connector;
    return { app: buildServer({ authStore: new MemoryStore(), connector }), calls };
  }

  const html = '<html><head><title>Rivera Plumbing</title></head><body><p>Drain cleaning and leak repair in Philadelphia, PA. Call 215-555-0199. Monday 8am to 5pm.</p></body></html>';

  async function owner(server: ReturnType<typeof buildServer>, email: string) {
    const signed = await server.inject({ method: 'POST', url: '/auth/signup', payload: { email, password: 'password1', tos: true } });
    const headers = { cookie: String(signed.headers['set-cookie']).split(';')[0] };
    await server.inject({ method: 'POST', url: '/api/miles/crawl', headers, payload: { businessName: 'Rivera Plumbing', location: 'Philadelphia, PA', website: 'https://rivera.example', html } });
    await server.inject({ method: 'POST', url: '/api/miles/mode', headers, payload: { mode: 'automate' } });
    await server.inject({ method: 'POST', url: '/api/miles/tracking', headers, payload: { leadConversion: true, method: 'call_or_form' } });
    return headers;
  }

  it('saves the kept budget as the daily cap, builds the playbook plan, and launches that plan', async () => {
    const { app: server, calls } = app();
    const headers = await owner(server, 'goal@example.com');
    const checked = await server.inject({ method: 'POST', url: '/api/miles/goal', headers, payload: { budgetAmount: 20, budgetPeriod: 'day', leadGoal: 20, leadPeriod: 'month' } });
    expect(checked.statusCode).toBe(200);
    expect(checked.json().check.verdict).toMatch(/Not likely/);
    expect(checked.json().check.cityNote).toMatch(/national/);
    const saved = await server.inject({ method: 'POST', url: '/api/miles/goal/confirm', headers, payload: { budgetAmount: 20, budgetPeriod: 'day', leadGoal: 20, leadPeriod: 'month', choice: 'keep_budget' } });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().dailyCap).toBe(20);
    expect(saved.json().raisedCap).toBe(false);
    expect(saved.json().questions).toEqual([]);
    expect(saved.json().spec.dailyBudget).toBe(20);
    expect(saved.json().spec.adGroups.map((group: { name: string }) => group.name)).toEqual(expect.arrayContaining(['Drain Cleaning', 'Leak Repair']));
    expect(validateCampaignSpec(saved.json().spec)).toEqual([]);
    expect(saved.json().confirmation).toBe('Miles will build and launch Google Search for you.');
    const profile = await server.inject({ method: 'GET', url: '/api/profile/business', headers });
    expect(profile.json().profile.goalConfirmed).toBe('yes');
    expect(profile.json().profile.goalChoice).toBe('keep_budget');
    expect(profile.json().profile.leadGoal).toBe('3');
    expect(profile.json().profile.leadPeriod).toBe('month');
    expect(Number(profile.json().profile.dailyBudget)).toBe(20);
    const log = await server.inject({ method: 'GET', url: '/api/approvals', headers });
    expect(log.json().entries.map((entry: { title: string }) => entry.title).join(' ')).toMatch(/Confirmed \$20\/day and 3 leads a month/);
    const launched = await server.inject({ method: 'POST', url: '/api/miles/go', headers, payload: { confirm: true, plan: saved.json().spec } });
    expect(launched.statusCode).toBe(200);
    expect(launched.json().created).toBe(true);
    expect(calls.find((call) => call.op === 'launch')).toMatchObject({ budget: 20, status: 'PAUSED' });
  });

  it('refuses to keep a budget above the cap and raises it only when that choice is explicit', async () => {
    const { app: server } = app();
    const headers = await owner(server, 'cap@example.com');
    await server.inject({ method: 'POST', url: '/api/miles/questions', headers, payload: { goal: 'Get more calls', dailyBudget: 20, leadsPerDay: 1, mode: 'automate' } });
    const kept = await server.inject({ method: 'POST', url: '/api/miles/goal/confirm', headers, payload: { budgetAmount: 500, budgetPeriod: 'day', leadGoal: 20, leadPeriod: 'month', choice: 'keep_budget' } });
    expect(kept.statusCode).toBe(200);
    expect(kept.json().dailyCap).toBe(20);
    expect(kept.json().raisedCap).toBe(false);
    const afterKeep = await server.inject({ method: 'GET', url: '/api/miles/goal', headers });
    expect(afterKeep.json().caps.daily).toBe(20);
    expect(afterKeep.json().caps.monthly).toBe(600);
    const raised = await server.inject({ method: 'POST', url: '/api/miles/goal/confirm', headers, payload: { budgetAmount: 20, budgetPeriod: 'day', leadGoal: 20, leadPeriod: 'month', choice: 'raise_budget' } });
    expect(raised.statusCode).toBe(200);
    expect(raised.json().dailyCap).toBe(122);
    expect(raised.json().raisedCap).toBe(true);
    expect(raised.json().spec.dailyBudget).toBe(122);
    const after = await server.inject({ method: 'GET', url: '/api/miles/goal', headers });
    expect(after.json().caps.daily).toBe(122);
    expect(after.json().caps.monthly).toBe(3660);
    const log = await server.inject({ method: 'GET', url: '/api/approvals', headers });
    expect(log.json().entries.map((entry: { title: string }) => entry.title).join(' ')).toMatch(/Raised the daily cap/);
  });
});
