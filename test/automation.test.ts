import { describe, expect, it } from 'vitest';
import { rulesForTrade, rulesFromPlaybook } from '../src/automation/rules.js';
import { playbookTrades } from '../src/agents/playbook.js';
import { negativeKeywords, runSkills, wastedSpend, type DailyInput } from '../src/automation/skills.js';
import { approveChange, dailyDue, planActions, revertChange, runDailyRead, CREDIT_PAUSE } from '../src/automation/engine.js';
import { buildOrgChart } from '../src/automation/org.js';
import { buildAdminBusiness } from '../src/admin/business.js';
import { chargeCredits } from '../src/billing/credits.js';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';

function input(over: Partial<DailyInput> = {}): DailyInput {
  return {
    now: '2026-11-14T12:00:00.000Z',
    trade: 'Painting',
    monthlyBudget: 600,
    spentMonth: 200,
    dayOfMonth: 10,
    leads: 4,
    bookedJobs: 1,
    channels: { google: true, meta: true, gbp: true, ghl: true },
    campaigns: [
      { name: 'House Painting', platform: 'google_ads', spend: 80, conversions: 0, clicks: 40 },
      { name: 'Brand', platform: 'google_ads', spend: 20, conversions: 2, clicks: 10 },
    ],
    searchTerms: [
      { term: 'house painting jobs', spend: 5, clicks: 3, conversions: 0 },
      { term: 'interior painters philadelphia', spend: 30, clicks: 8, conversions: 0 },
    ],
    conversionActions: 0,
    callTracking: false,
    metaSpend: 40,
    gbpCalls: 3,
    ghlLeads: 4,
    ...over,
  };
}

describe('playbook rules', () => {
  it('uses the playbook threshold and junk list, not a skill switch', () => {
    for (const trade of playbookTrades()) {
      expect(rulesForTrade(trade.label).key).toBe(trade.key);
    }
    const painting = rulesForTrade('Painting');
    expect(painting.junkTerms.join(' ')).toMatch(/sherwin williams/);
    expect(rulesForTrade('Plumbing').junkTerms.join(' ')).not.toMatch(/sherwin williams/);
    const pest = rulesFromPlaybook({ key: 'pest', label: 'Pest', wastedSpendUsd: 12, junkTerms: ['exterminator jobs'] });
    const rows = wastedSpend(input({ campaigns: [{ name: 'Ants', platform: 'google_ads', spend: 12, conversions: 0, clicks: 4 }] }), pest);
    expect(rows[0]!.title).toMatch(/Ants/);
    const negatives = negativeKeywords(input({ searchTerms: [{ term: 'exterminator jobs near me', spend: 1, clicks: 1, conversions: 0 }] }), pest);
    expect(negatives[0]!.detail).toMatch(/exterminator jobs/);
  });
});

describe('daily manager', () => {
  it('routes findings and applies only inside caps', () => {
    const read = runDailyRead(input());
    expect(read.findings.map((row) => row.skill)).toEqual(expect.arrayContaining(['wasted-spend', 'negative-keywords', 'budget-pacing', 'conversion-tracking', 'weekly-report']));
    expect(read.findings.map((row) => row.detail).join(' ')).not.toMatch(/searchlight|\u2014/i);
    const guard = { mode: 'automate' as const, paused: false, creditsLeft: 100, dailyBudget: 20, monthlyCeiling: 600, maxChangePct: 10, spentToday: 0, spentMonth: 200 };
    const applied = planActions(read.findings, guard, input().now);
    expect(applied.find((row) => row.id.startsWith('wasted-spend-'))!.effect).toBe('applied');
    expect(applied.find((row) => row.id === 'negative-keywords-add')!.effect).toBe('applied');
    const queued = planActions(runDailyRead(input({ spentMonth: 40, dayOfMonth: 20 })).findings, guard, input().now);
    expect(queued.find((row) => row.id === 'budget-pacing-behind')!.effect).toBe('queued');
    const hybrid = planActions(read.findings, { ...guard, mode: 'hybrid' }, input().now);
    expect(hybrid.filter((row) => row.effect === 'applied')).toHaveLength(0);
    expect(hybrid.some((row) => row.effect === 'queued')).toBe(true);
    const manual = planActions(read.findings, { ...guard, mode: 'manual' }, input().now);
    expect(manual.every((row) => row.effect === 'suggested')).toBe(true);
    const killed = planActions(read.findings, { ...guard, paused: true }, input().now);
    expect(killed.every((row) => row.effect === 'paused')).toBe(true);
    const broke = planActions(read.findings, { ...guard, creditsLeft: 0 }, input().now);
    expect(broke[0]!.reason).toBe(CREDIT_PAUSE);
  });

  it('reverts an applied change and approves a queued one', () => {
    const guard = { mode: 'automate' as const, paused: false, creditsLeft: 100, dailyBudget: 20, monthlyCeiling: 600, maxChangePct: 10, spentToday: 0, spentMonth: 200 };
    const log = planActions(runDailyRead(input()).findings, guard, input().now);
    const pause = log.find((row) => row.effect === 'applied')!;
    const reverted = revertChange(log, pause.id);
    expect(reverted.ok).toBe(true);
    expect(reverted.restored).toMatch(/enabled/);
    expect(reverted.log.find((row) => row.id === pause.id)!.effect).toBe('reverted');
    const waiting = planActions(runDailyRead(input({ spentMonth: 40, dayOfMonth: 20 })).findings, guard, input().now);
    const raise = waiting.find((row) => row.id === 'budget-pacing-behind')!;
    const approved = approveChange(waiting, raise.id);
    expect(approved.ok).toBe(true);
    expect(approved.log.find((row) => row.id === raise.id)!.effect).toBe('applied');
  });

  it('runs at most once a day', () => {
    const now = new Date('2026-11-14T12:00:00.000Z');
    expect(dailyDue(null, now)).toBe(true);
    expect(dailyDue('2026-11-14T08:00:00.000Z', now)).toBe(false);
    expect(dailyDue('2026-11-13T10:00:00.000Z', now)).toBe(true);
  });
});

describe('org chart', () => {
  it('names the playbook and counts rules that fired this week', () => {
    const chart = buildOrgChart({
      trade: 'Painting',
      now: '2026-11-14T12:00:00.000Z',
      fired: [
        { skill: 'wasted-spend', title: 'Pause House Painting', ts: '2026-11-13T12:00:00.000Z', effect: 'applied' },
        { skill: 'wasted-spend', title: 'Old', ts: '2026-10-01T12:00:00.000Z', effect: 'applied' },
      ],
    });
    expect(chart.head).toMatchObject({ name: 'Miles', title: 'Head of Growth', playbook: 'Painting' });
    expect(chart.departments.map((row) => row.name)).toEqual(['Search terms', 'Bidding and budget', 'Tracking', 'Reporting']);
    expect(chart.departments[0]!.skills[0]!.fired).toBe(1);
    expect(chart.rulesFired).toHaveLength(1);
    expect(JSON.stringify(chart)).not.toMatch(/searchlight|\u2014/i);
  });
});

describe('openrouter cost on the admin view', () => {
  it('shows the recorded serve cost instead of Not connected', () => {
    const data: Record<string, unknown> = {
      profile: { businessName: 'Painters', industry: 'Painting' },
      credits: { granted: 100, spent: 0, ledger: [] },
      billing: { status: 'active', band: 'launch', grantedInvoices: [] },
    };
    chargeCredits(data, 'skill_run', 'Daily account read');
    const view = buildAdminBusiness([{
      id: 'u1', email: 'a@example.com', createdAt: '2026-11-10T00:00:00.000Z', apps: [], data,
    }], { stripeReady: false });
    expect(typeof view.totals.openRouterCost).toBe('number');
    expect(view.totals.openRouterCost).toBeGreaterThan(0);
    expect(view.accounts[0]!.profit).toBeLessThan(0);
  });
});

describe('automation route', () => {
  it('reads once, then waits, and the library shows the org chart', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const signed = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'auto@example.com', password: 'password1', tos: true } });
    const headers = { cookie: String(signed.headers['set-cookie']).split(';')[0] };
    const first = await app.inject({ method: 'POST', url: '/api/automation/read', headers });
    expect(first.statusCode).toBe(200);
    expect(first.json().ran).toBe(true);
    expect(first.json().findings.some((row: { skill: string }) => row.skill === 'weekly-report')).toBe(true);
    const second = await app.inject({ method: 'POST', url: '/api/automation/read', headers });
    expect(second.json().ran).toBe(false);
    const library = await app.inject({ method: 'GET', url: '/api/marketing/library', headers });
    expect(library.json().org.head.title).toBe('Head of Growth');
    const killed = await app.inject({ method: 'POST', url: '/api/automation/kill', headers, payload: { paused: true } });
    expect(killed.json().paused).toBe(true);
    await app.close();
  });
});
