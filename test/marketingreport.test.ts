import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import { buildMarketingReport, reportWindow, type MarketingReportInput } from '../src/reports/marketing.js';
import { marketingReportProps, parseAdsPerformanceRow } from '../src/connectors/gadsread.js';
import { playbookTicket } from '../src/agents/playbook.js';
import type { BudgetExpectation } from '../src/agents/budgetexpect.js';
import type { Connector } from '../src/connectors/types.js';

const NOW = new Date('2026-11-12T15:00:00.000Z');

function blankChannel(over: Partial<MarketingReportInput['google']> = {}): MarketingReportInput['google'] {
  return { connected: false, note: 'Not connected.', rows: [], previousRows: [], previousKnown: false, ...over };
}

function base(over: Partial<MarketingReportInput> = {}): MarketingReportInput {
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
    google: blankChannel(),
    meta: blankChannel(),
    ...over,
  };
}

describe('report windows', () => {
  it('builds 7, 30, 90, month to date, and last month with a matching previous period', () => {
    const last7 = reportWindow('7', NOW);
    expect(last7).toMatchObject({ start: '2026-11-06', end: '2026-11-12', days: 7, googleRange: 'LAST_7_DAYS', metaPreset: 'last_7d' });
    expect(last7.previousEnd).toBe('2026-11-05');
    expect(reportWindow('30', NOW).days).toBe(30);
    expect(reportWindow('90', NOW)).toMatchObject({ days: 90, googleRange: 'LAST_90_DAYS', metaPreset: 'last_90d' });
    const mtd = reportWindow('mtd', NOW);
    expect(mtd.start).toBe('2026-11-01');
    expect(mtd.end).toBe('2026-11-12');
    expect(mtd.googleRange).toBe('THIS_MONTH');
    const last = reportWindow('last_month', NOW);
    expect(last.start).toBe('2026-10-01');
    expect(last.end).toBe('2026-10-31');
    expect(last.previousStart).toBe('2026-08-31');
    expect(last.previousEnd).toBe('2026-09-30');
    expect(last.days).toBe(31);
  });
});

describe('performance row parsing', () => {
  it('reads a dated Google campaign row and a Meta lead action', () => {
    const google = parseAdsPerformanceRow({
      campaign: { id: '222', name: 'HOUSE PAINTING' },
      metrics: { impressions: '200', clicks: '20', costMicros: '20000000', conversions: 2 },
      segments: { date: '2026-11-02' },
    }, 'campaign');
    expect(google).toMatchObject({ campaign: 'HOUSE PAINTING', date: '2026-11-02', spend: 20, clicks: 20, impressions: 200, conversions: 2 });
    const keyword = parseAdsPerformanceRow({
      campaign: { name: 'HOUSE PAINTING' },
      adGroup: { name: 'Interior' },
      adGroupCriterion: { keyword: { text: 'painters philadelphia' } },
      metrics: { impressions: 50, clicks: 5, costMicros: 5000000, conversions: 1 },
    }, 'keyword');
    expect(keyword?.keyword).toBe('painters philadelphia');
    const meta = parseAdsPerformanceRow({
      campaign_name: 'Philly leads',
      adset_name: 'Homeowners',
      impressions: '100',
      clicks: '10',
      spend: '25.5',
      reach: '80',
      date_start: '2026-11-03',
      actions: [{ action_type: 'link_click', value: '10' }, { action_type: 'lead', value: '3' }],
    }, 'campaign');
    expect(meta).toMatchObject({ campaign: 'Philly leads', spend: 25.5, conversions: 3, reach: 80, date: '2026-11-03' });
    const props = marketingReportProps({
      appName: 'googleAds', authId: 'apn', pair: { accountId: '3519644891', customerClientId: '9013698905' },
      level: 'keyword', dateRange: 'LAST_30_DAYS', startDate: '2026-10-14', endDate: '2026-11-12',
    });
    expect(props.resource).toBe('keyword_view');
    expect(props.fields).toContain('ad_group_criterion.keyword.text');
    expect(props.segments).toEqual([]);
    expect(props.dateRange).toBe('LAST_30_DAYS');
    expect(props.startDate).toBe('2026-10-14');
    const campaignProps = marketingReportProps({
      appName: 'googleAds', authId: 'apn', pair: { accountId: '1' }, level: 'campaign', dateRange: 'LAST_7_DAYS',
    });
    expect(campaignProps.segments).toEqual(['segments.date']);
  });
});

describe('marketing report', () => {
  it('shows real Google and lead numbers, the saved projection, and hides sample ad rows', () => {
    expect(playbookTicket('painting')).toBe(3500);
    const expectation = { range: { jobs: { low: 1.5, high: 2.4 }, leads: { low: 4, high: 6 } } } as BudgetExpectation;
    const report = buildMarketingReport(base({
      expectation,
      events: [
        { type: 'lead', ts: '2026-11-08T12:00:00.000Z', name: 'Ann' },
        { type: 'missed_call', ts: '2026-11-09T12:00:00.000Z' },
        { type: 'closed_won', ts: '2026-11-10T12:00:00.000Z', amount: 3200 },
        { type: 'lead', ts: '2026-09-01T12:00:00.000Z' },
      ],
      replies: [{ key: '1', name: 'Ann', source: 'Google', at: '2026-11-08T12:05:00.000Z', channels: ['sms'], held: false, responseSec: 45 }],
      speedOn: true,
      google: blankChannel({
        connected: true,
        note: 'Read from Google Ads.',
        previousKnown: true,
        rows: [
          { level: 'campaign', campaign: 'HOUSE PAINTING', date: '2026-11-02', impressions: 200, clicks: 20, conversions: 2, spend: 40 },
          { level: 'ad_group', campaign: 'HOUSE PAINTING', adGroup: 'Interior', impressions: 200, clicks: 20, conversions: 2, spend: 40 },
          { level: 'keyword', campaign: 'HOUSE PAINTING', adGroup: 'Interior', keyword: 'painters philadelphia', impressions: 80, clicks: 8, conversions: 1, spend: 16 },
          { level: 'search_term', campaign: 'HOUSE PAINTING', searchTerm: 'house painters philly', impressions: 40, clicks: 4, conversions: 1, spend: 8 },
        ],
        previousRows: [
          { level: 'campaign', campaign: 'HOUSE PAINTING', date: '2026-10-02', impressions: 100, clicks: 10, conversions: 1, spend: 20 },
        ],
      }),
      meta: blankChannel({ note: 'No Facebook ad account is connected.' }),
    }));
    expect(report.overview.tiles.find((tile) => tile.label === 'Spend')!.value).toBe('$40');
    expect(report.overview.tiles.find((tile) => tile.label === 'Spend')!.compare).toMatch(/Up 100%/);
    expect(report.overview.tiles.find((tile) => tile.label === 'Leads')!.value).toBe('2');
    expect(report.overview.tiles.find((tile) => tile.label === 'Cost per lead')!.value).toBe('$20');
    expect(report.overview.projection).toMatch(/1\.5 to 2\.4/);
    expect(report.overview.projection).toMatch(/1 won job/);
    expect(report.overview.revenue).toMatch(/\$5,250/);
    expect(report.overview.revenue).toMatch(/\$8,400/);
    expect(report.overview.revenue).toMatch(/\$3,200/);
    expect(report.overview.revenue).toMatch(/not money received/);
    expect(report.google.campaigns[0]).toMatchObject({ name: 'HOUSE PAINTING', ctr: '10%', cpc: '$2' });
    expect(report.google.keywords[0]!.name).toBe('painters philadelphia');
    expect(report.google.terms[0]!.name).toBe('house painters philly');
    expect(report.google.trend).toHaveLength(1);
    expect(report.google.footnote).toMatch(/does not treat them as leads/);
    expect(report.meta.connected).toBe(false);
    expect(report.meta.note).toMatch(/ad account/i);
    expect(report.leads.bySource).toEqual([{ label: 'Google', count: 1 }]);
    expect(report.leads.speedNote).toMatch(/45 seconds/);
    expect(report.summary.happened + report.summary.next).not.toMatch(/\u2014|\u2013|searchlight/i);
    expect(report.shareNote).toMatch(/not on a schedule/);

    const hidden = buildMarketingReport(base({
      sample: true,
      google: blankChannel({
        connected: true,
        previousKnown: true,
        rows: [{ level: 'campaign', campaign: 'Emergency Plumbing', impressions: 999, clicks: 999, conversions: 38, spend: 1240 }],
        previousRows: [],
      }),
    }));
    expect(JSON.stringify(hidden)).not.toMatch(/1240|Emergency Plumbing|999/);
    expect(hidden.google.note).toMatch(/preview/i);
    const hiddenSpend = hidden.overview.tiles.find((tile) => tile.label === 'Spend')!;
    expect(hiddenSpend.sample).toBe(true);
    expect(hiddenSpend.value).toBe('$600');
    expect(hidden.sampleBanner).toMatch(/Sample data/);
    expect(hidden.charts.google.every((widget) => widget.sample)).toBe(true);
    expect(hidden.charts.google.every((widget) => widget.note.startsWith('Sample data'))).toBe(true);
  });

  it('does not turn Google conversions into leads when the ledger is empty', () => {
    const report = buildMarketingReport(base({
      google: blankChannel({
        connected: true,
        note: 'Read from Google Ads.',
        previousKnown: false,
        rows: [{ level: 'campaign', campaign: 'HOUSE PAINTING', impressions: 10, clicks: 2, conversions: 4, spend: 10 }],
      }),
    }));
    const leadTile = report.overview.tiles.find((tile) => tile.label === 'Leads')!;
    expect(leadTile.sample).toBe(true);
    expect(leadTile.compare).toMatch(/Sample data/);
    const cplTile = report.overview.tiles.find((tile) => tile.label === 'Cost per lead')!;
    expect(cplTile.sample).toBe(true);
    expect(report.google.tiles.find((tile) => tile.label === 'Spend')!.sample).toBe(false);
    expect(report.google.tiles.find((tile) => tile.label === 'Conversions')!.value).toBe('4');
    expect(report.charts.overview.find((widget) => widget.title === 'Impressions to booked jobs')!.sample).toBe(true);
    expect(report.charts.google.find((widget) => widget.title === 'Spend by campaign')!.sample).toBe(false);
    expect(report.charts.google.find((widget) => widget.title === 'Spend by campaign')!.points[0]!.label).toBe('HOUSE PAINTING');
    expect(report.google.tiles.find((tile) => tile.label === 'Spend')!.compare).toBe('No earlier period to compare.');
  });
});

describe('reports route', () => {
  it('requires a sign-in and does not show preview spend as real', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const anon = await app.inject({ method: 'GET', url: '/api/reports/marketing?range=30' });
    expect(anon.statusCode).toBeGreaterThanOrEqual(400);
    const signup = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'reports@example.com', password: 'password1', tos: true } });
    const cookie = String(signup.headers['set-cookie']).split(';')[0] ?? '';
    await app.inject({ method: 'PUT', url: '/api/profile', headers: { cookie }, payload: { businessName: 'Painters In Philly', industry: 'Painting', serviceAreas: 'Philadelphia' } });
    const res = await app.inject({ method: 'GET', url: '/api/reports/marketing?range=7', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.report.window.googleRange).toBe('LAST_7_DAYS');
    expect(body.report.business).toBe('Painters In Philly');
    expect(body.report.sample).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/1240|Emergency Plumbing/);
    expect(body.report.google.note).toMatch(/preview/i);
    expect(body.report.shareNote).toMatch(/Print or save as PDF/);
    const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
    expect(html).toContain('data-page="reports"');
    expect(html).toContain('rep-tiles');
    expect(html).toContain('rep-svg');
    expect(html).toContain('Sample data');
    expect(html).toContain('Print or save as PDF');
    await app.close();
  });
});

describe('live report read uses the existing Google report action', () => {
  it('asks for campaign, ad group, keyword, and search term rows on the client account', async () => {
    const sent: { id?: string; configuredProps?: Record<string, unknown> }[] = [];
    const components = [
      { key: 'google_ads-list-customer-clients', configurableProps: [{ type: 'app', name: 'googleAds' }, { name: 'accountId' }] },
      { key: 'google_ads-create-report', configurableProps: [{ type: 'app', name: 'googleAds' }, { name: 'accountId' }, { name: 'customerClientId' }, { name: 'resource' }, { name: 'fields' }, { name: 'segments' }, { name: 'metrics' }, { name: 'dateRange' }] },
    ];
    const pd = new (await import('../src/connectors/pipedream.js')).PipedreamConnector({
      connector: 'pipedream',
      pipedream: { environment: 'development', projectId: 'p', clientId: 'c', clientSecret: 's' },
    });
    (pd as unknown as { client: unknown }).client = {
      accounts: { list: async () => ({ data: [{ id: 'apn_1', app: { nameSlug: 'google_ads' }, healthy: true }] }) },
      actions: {
        list: async () => ({ data: components }),
        retrieve: async (key: string) => components.find((row) => row.key === key),
        run: async (req: { id?: string; configuredProps?: Record<string, unknown> }) => {
          sent.push(req);
          if (req.id === 'google_ads-list-customer-clients') return { ret: [{ id: '9013698905', descriptiveName: 'Painters In Philly', manager: false }] };
          if (req.configuredProps?.resource === 'campaign') {
            return { ret: { results: [{ campaign: { id: '222', name: 'HOUSE PAINTING' }, metrics: { impressions: '10', clicks: '2', costMicros: '5000000', conversions: 1 }, segments: { date: '2026-11-02' } }] } };
          }
          return { ret: { results: [] } };
        },
      },
      proxy: { get: async () => ({ data: [] }), post: async () => ({}) },
    };
    const result = await pd.readMarketingAds('owner-1', { dateRange: 'LAST_30_DAYS', startDate: '2026-10-14', endDate: '2026-11-12', metaPreset: 'last_30d' });
    expect(result.google.connected).toBe(true);
    expect(result.google.rows.map((row) => row.campaign)).toContain('HOUSE PAINTING');
    const resources = sent.filter((call) => call.id === 'google_ads-create-report').map((call) => call.configuredProps?.resource);
    expect(resources).toEqual(['campaign', 'ad_group', 'keyword_view', 'search_term_view']);
    const campaignCall = sent.find((call) => call.configuredProps?.resource === 'campaign');
    expect(campaignCall?.configuredProps?.segments).toEqual(['segments.date']);
    expect(campaignCall?.configuredProps?.accountId).toBe('9013698905');
    expect(result.meta.connected).toBe(false);
    expect(result.meta.rows).toEqual([]);
  });
});
