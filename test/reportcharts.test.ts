import { describe, expect, it } from 'vitest';
import { buildMarketingReport, type MarketingReportInput } from '../src/reports/marketing.js';
import { samplePlan } from '../src/reports/charts.js';
import { cplBandForGoal } from '../src/agents/goalcheck.js';
import type { BudgetExpectation } from '../src/agents/budgetexpect.js';

const NOW = new Date('2026-11-12T15:00:00.000Z');

function channel(over: Partial<MarketingReportInput['google']> = {}): MarketingReportInput['google'] {
  return { connected: false, note: 'Not connected.', rows: [], previousRows: [], previousKnown: false, ...over };
}

function input(over: Partial<MarketingReportInput> = {}): MarketingReportInput {
  return {
    now: NOW,
    range: '30',
    business: 'Painters In Philly',
    trade: 'Painting',
    sample: false,
    expectation: null,
    ticket: 3500,
    ticketSource: 'the playbook job value for Painting',
    events: [],
    replies: [],
    speedOn: false,
    dailyBudget: 20,
    google: channel(),
    meta: channel(),
    ...over,
  };
}

describe('sample chart series', () => {
  it('is deterministic and uses the goal-check cost per lead and the saved daily budget', () => {
    const first = samplePlan({ trade: 'Painting', dailyBudget: 20, start: '2026-10-14', end: '2026-11-12' });
    const second = samplePlan({ trade: 'Painting', dailyBudget: 20, start: '2026-10-14', end: '2026-11-12' });
    expect(second).toEqual(first);
    expect(first.daily).toBe(20);
    expect(first.days).toHaveLength(30);
    expect(first.totalSpend).toBe(600);
    expect(first.totalLeads).toBe(Math.max(1, Math.round(600 / cplBandForGoal('Painting')!.typical)));
    expect(first.cpl).toBe(first.totalSpend / first.totalLeads);
    expect(first.googleSpend + first.metaSpend).toBe(first.totalSpend);
    expect(first.googleClicks + first.metaClicks).toBe(first.totalClicks);
    expect(first.days.reduce((sum, day) => sum + day.spend, 0)).toBe(600);
    expect(first.google.reduce((sum, day) => sum + day.spend, 0)).toBe(first.googleSpend);
    expect(first.meta.reduce((sum, day) => sum + day.spend, 0)).toBe(first.metaSpend);
    expect(first.days.every((day) => Number.isInteger(day.spend) && Number.isInteger(day.clicks) && Number.isInteger(day.leads) && Number.isInteger(day.impressions))).toBe(true);
    const weekend = first.days.filter((day) => [0, 6].includes(new Date(`${day.date}T00:00:00.000Z`).getUTCDay()));
    const weekday = first.days.filter((day) => ![0, 6].includes(new Date(`${day.date}T00:00:00.000Z`).getUTCDay()));
    const avg = (rows: typeof first.days) => rows.reduce((sum, day) => sum + day.spend, 0) / rows.length;
    expect(avg(weekend)).toBeLessThan(avg(weekday));
    expect(first.days.some((day, index) => index > 0 && day.spend !== first.days[index - 1]!.spend)).toBe(true);
  });

  it('keeps sample overview, Google, and Facebook spend on the same total', () => {
    const report = buildMarketingReport(input());
    const sum = (title: string, list: { title: string; points: { value: number | null }[] }[]) =>
      list.find((widget) => widget.title === title)!.points.reduce((total, point) => total + (point.value || 0), 0);
    const overview = sum('Spend', report.charts.overview);
    const google = sum('Spend', report.charts.google);
    const meta = sum('Spend', report.charts.meta);
    expect(google + meta).toBe(overview);
    expect(overview).toBe(600);
    expect(Number.isInteger(google)).toBe(true);
    const plan = samplePlan({ trade: 'Painting', dailyBudget: 20, start: '2026-10-14', end: '2026-11-12' });
    expect(sum('Clicks', report.charts.google)).toBe(plan.googleClicks);
    expect(report.charts.google.find((widget) => widget.title === 'CTR')!.headline).toBe(`${Math.round((plan.googleClicks / plan.googleImpressions) * 1000) / 10}%`);
    expect(report.charts.google.find((widget) => widget.title === 'Cost per lead')!.headline).toBe(
      (plan.googleSpend / plan.googleLeads).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: Number.isInteger(plan.googleSpend / plan.googleLeads) ? 0 : 2 }),
    );
  });
});

describe('real data replaces sample one widget at a time', () => {
  it('keeps Google real and Facebook sample, and never mixes them in one chart', () => {
    const report = buildMarketingReport(input({
      events: [
        { type: 'lead', ts: '2026-11-08T12:00:00.000Z' },
        { type: 'missed_call', ts: '2026-11-09T12:00:00.000Z' },
        { type: 'closed_won', ts: '2026-11-10T12:00:00.000Z', amount: 500 },
      ],
      replies: [{ key: '1', name: 'Ann', source: 'Website', at: '2026-11-08T12:05:00.000Z', channels: ['sms'], held: false, responseSec: 30 }],
      expectation: { range: { jobs: { low: 1.5, high: 2.4 }, leads: { low: 4, high: 6 } } } as BudgetExpectation,
      google: channel({
        connected: true,
        note: 'Read from Google Ads.',
        previousKnown: true,
        rows: [
          { level: 'campaign', campaign: 'HOUSE PAINTING', date: '2026-11-02', impressions: 200, clicks: 20, conversions: 2, spend: 40 },
          { level: 'keyword', campaign: 'HOUSE PAINTING', keyword: 'painters philadelphia', impressions: 80, clicks: 8, conversions: 1, spend: 16 },
          { level: 'search_term', campaign: 'HOUSE PAINTING', searchTerm: 'house painters philly', impressions: 40, clicks: 4, conversions: 1, spend: 8 },
        ],
        previousRows: [{ level: 'campaign', campaign: 'HOUSE PAINTING', date: '2026-10-02', impressions: 10, clicks: 1, conversions: 0, spend: 5 }],
      }),
    }));
    const googleSpend = report.charts.google.find((widget) => widget.title === 'Spend')!;
    const metaSpend = report.charts.meta.find((widget) => widget.title === 'Spend')!;
    const keywords = report.charts.google.find((widget) => widget.title === 'Top keywords')!;
    const terms = report.charts.google.find((widget) => widget.title === 'Top search terms')!;
    const device = report.charts.overview.find((widget) => widget.title === 'Device mix')!;
    const funnel = report.charts.overview.find((widget) => widget.title === 'Impressions to booked jobs')!;
    const gauge = report.charts.overview.find((widget) => widget.title === 'Goal pacing')!;
    const source = report.charts.overview.find((widget) => widget.title === 'Lead source')!;
    const calls = report.charts.leads.find((widget) => widget.title === 'Missed and answered calls')!;
    expect(googleSpend.sample).toBe(false);
    expect(googleSpend.points).toEqual([{ label: '2026-11-02', value: 40 }]);
    expect(metaSpend.sample).toBe(true);
    expect(metaSpend.note.startsWith('Sample data')).toBe(true);
    expect(metaSpend.points.some((point) => point.value === 40)).toBe(false);
    expect(keywords.sample).toBe(false);
    expect(keywords.points[0]!.label).toBe('painters philadelphia');
    expect(terms.sample).toBe(false);
    expect(terms.points[0]!.label).toBe('house painters philly');
    expect(funnel.sample).toBe(false);
    expect(funnel.points.map((point) => point.value)).toEqual([200, 20, 2, 1]);
    expect(gauge.sample).toBe(false);
    expect(gauge.caption).toMatch(/1\.5 to 2\.4/);
    expect(source.sample).toBe(false);
    expect(source.points).toEqual([{ label: 'Website', value: 1 }]);
    expect(device.sample).toBe(true);
    expect(device.note.startsWith('Sample data')).toBe(true);
    expect(calls.sample).toBe(true);
    expect(report.sampleBanner).toMatch(/Sample data/);
    expect(report.sampleBanner).toMatch(/saved projection/);
    expect(report.overview.tiles.find((tile) => tile.label === 'Spend')!.sample).toBe(false);
    expect(report.overview.tiles.find((tile) => tile.label === 'Spend')!.delta).toBe('up');
    expect(report.overview.tiles.find((tile) => tile.label === 'Leads')!.sample).toBe(false);
  });

  it('uses sample keywords until keyword rows exist, without touching the real campaign', () => {
    const report = buildMarketingReport(input({
      google: channel({
        connected: true,
        note: 'Read from Google Ads.',
        previousKnown: false,
        rows: [{ level: 'campaign', campaign: 'HOUSE PAINTING', date: '2026-11-02', impressions: 10, clicks: 2, conversions: 0, spend: 10 }],
      }),
    }));
    const campaigns = report.charts.google.find((widget) => widget.title === 'Spend by campaign')!;
    const keywords = report.charts.google.find((widget) => widget.title === 'Top keywords')!;
    expect(campaigns.sample).toBe(false);
    expect(campaigns.points.map((point) => point.label)).toEqual(['HOUSE PAINTING']);
    expect(keywords.sample).toBe(true);
    expect(keywords.points.some((point) => point.label === 'HOUSE PAINTING')).toBe(false);
    expect(keywords.note.startsWith('Sample data')).toBe(true);
    const gauge = report.charts.overview.find((widget) => widget.title === 'Goal pacing')!;
    expect(gauge.sample).toBe(true);
    expect(gauge.caption).toBe('Sample pacing for this budget.');
    expect(gauge.caption).not.toMatch(/1\.5/);
  });
});
