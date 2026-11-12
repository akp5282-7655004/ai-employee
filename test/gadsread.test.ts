import { describe, expect, it } from 'vitest';
import { PipedreamConnector } from '../src/connectors/pipedream.js';
import type { Config } from '../src/config.js';
import { judgeEnableReadback, listCampaignRows, parseGoogleStatuses } from '../src/agents/enablecheck.js';
import { buildOperatorView, type OperatorInput } from '../src/dashboard/operator.js';
import {
  PIPEDREAM_AD_GROUP_REPORT,
  PIPEDREAM_AD_REPORT,
  PIPEDREAM_LIST_CAMPAIGNS,
  PIPEDREAM_METRICS_EMPTY,
  PIPEDREAM_METRICS_WINDOW,
  PIPEDREAM_RUN,
  PIPEDREAM_STATUS_REPORT,
  actionPayload,
  customerPair,
  mergeCampaignMetrics,
  metricRowHasNumbers,
  parseCampaignMetric,
  plainGoogleError,
  statusGaql,
  statusReportProps,
} from '../src/connectors/gadsread.js';

const MANAGER = '3519644891';
const CLIENT = '9013698905';

describe('Google Ads response shapes', () => {
  it('reads campaign status from the list-campaigns array and the report envelope', () => {
    const fromList = parseGoogleStatuses(actionPayload(PIPEDREAM_RUN), { campaignId: '111', adGroupIds: [], adIds: [] });
    expect(fromList.campaign).toBe('PAUSED');
    expect(fromList.note).toMatch(/Read from the account/);
    const fromReport = parseGoogleStatuses(PIPEDREAM_STATUS_REPORT, { campaignId: '111', adGroupIds: ['3'], adIds: ['8'] });
    expect(fromReport.campaign).toBe('PAUSED');
    const groups = parseGoogleStatuses(PIPEDREAM_AD_GROUP_REPORT, { campaignId: '111', adGroupIds: ['3'], adIds: [] });
    const ads = parseGoogleStatuses(PIPEDREAM_AD_REPORT, { campaignId: '111', adGroupIds: ['3'], adIds: ['8'] });
    expect(groups.adGroups).toEqual(['ENABLED']);
    expect(ads.ads).toEqual(['ENABLED']);
    expect(judgeEnableReadback(fromList).reason).not.toMatch(/UNKNOWN/);
    expect(judgeEnableReadback(fromList).reason).toMatch(/PAUSED/);
  });

  it('lists paused campaigns and skips removed ones when the metrics report is empty', () => {
    const rows = listCampaignRows(actionPayload(PIPEDREAM_RUN));
    expect(rows.map((row) => row.name)).toEqual(['Painting | Philadelphia | Search | Planned', 'HOUSE PAINTING']);
    expect(rows.every((row) => row.status === 'PAUSED')).toBe(true);
    expect(listCampaignRows(PIPEDREAM_METRICS_EMPTY)).toEqual([]);
    expect(PIPEDREAM_METRICS_EMPTY.query).toMatch(/segments\.date DURING LAST_30_DAYS/);
  });

  it('builds a status read against the client with the manager as login, and no date', () => {
    const pair = customerPair({ resource: `customers/${CLIENT}/campaigns/111`, login: MANAGER, client: CLIENT });
    expect(pair).toEqual({ accountId: MANAGER, customerClientId: CLIENT });
    const props = statusReportProps({ appName: 'googleAds', authId: 'apn', pair, resource: 'campaign', ids: ['111'] });
    expect(props.accountId).toBe(MANAGER);
    expect(props.customerClientId).toBe(CLIENT);
    expect(props.segments).toEqual([]);
    expect(props).not.toHaveProperty('dateRange');
    expect(props).not.toHaveProperty('metrics');
    expect(statusGaql('campaign', ['111'])).toBe('SELECT campaign.status, campaign.id, campaign.name, campaign.resource_name FROM campaign WHERE campaign.id IN (111)');
    expect(statusGaql('ad_group', ['3'])).not.toMatch(/metrics|segments\.date/);
    expect(statusGaql('ad_group_ad', ['8'])).toMatch(/ad_group_ad\.status/);
  });

  it('says the Google error in plain words', () => {
    const note = plainGoogleError('Google 400 {"error":{"message":"The operation is not allowed for removed campaigns."}}');
    expect(note).toBe('The operation is not allowed for removed campaigns.');
    expect(note).not.toMatch(/UNKNOWN/);
  });
});

function managerClient() {
  const sent: { id?: string; configuredProps?: Record<string, unknown> }[] = [];
  const components = [
    { key: 'google_ads-list-account-id-options', configurableProps: [{ type: 'app', name: 'googleAds' }] },
    { key: 'google_ads-list-customer-clients', configurableProps: [{ type: 'app', name: 'googleAds' }, { name: 'accountId' }] },
    { key: 'google_ads-list-campaigns', configurableProps: [{ type: 'app', name: 'googleAds' }, { name: 'accountId' }, { name: 'customerClientId' }] },
    { key: 'google_ads-create-report', configurableProps: [{ type: 'app', name: 'googleAds' }, { name: 'accountId' }, { name: 'customerClientId' }, { name: 'resource' }, { name: 'fields' }, { name: 'segments' }] },
    { key: 'google_ads-create-campaign-report', configurableProps: [{ type: 'app', name: 'googleAds' }, { name: 'accountId' }, { name: 'customerClientId' }] },
    { key: 'google_ads-create-or-update-campaign', configurableProps: [{ type: 'app', name: 'googleAds' }] },
  ];
  return {
    sent,
    pd: {
      accounts: { list: async () => ({ data: [{ id: 'apn_1', app: { nameSlug: 'google_ads' }, healthy: true, name: 'Google' }] }) },
      actions: {
        list: async () => ({ data: components }),
        run: async (req: { id?: string; configuredProps?: Record<string, unknown> }) => {
          sent.push({ id: req.id, configuredProps: req.configuredProps });
          if (req.id === 'google_ads-list-account-id-options') return { ret: [{ value: MANAGER }] };
          if (req.id === 'google_ads-list-customer-clients') return { ret: [{ id: CLIENT, descriptiveName: 'Painters In Philly', manager: false }] };
          if (req.id === 'google_ads-list-campaigns') return PIPEDREAM_RUN;
          if (req.id === 'google_ads-create-campaign-report') return { ret: PIPEDREAM_METRICS_EMPTY };
          if (req.id === 'google_ads-create-report') {
            const resource = req.configuredProps?.resource;
            if (resource === 'ad_group') return { ret: PIPEDREAM_AD_GROUP_REPORT };
            if (resource === 'ad_group_ad') return { ret: PIPEDREAM_AD_REPORT };
            return { ret: PIPEDREAM_STATUS_REPORT };
          }
          if (req.id === 'google_ads-create-or-update-campaign') {
            return { ret: { results: [{ resourceName: `customers/${CLIENT}/campaigns/111` }] } };
          }
          return { ret: {} };
        },
      },
    },
  };
}

describe('campaign metrics merge', () => {
  it('sums a date window and keeps a paused campaign that had no impressions', () => {
    const house = parseCampaignMetric(PIPEDREAM_METRICS_WINDOW.results[0]);
    expect(house).toMatchObject({ id: '222', name: 'HOUSE PAINTING', spend: 12, impressions: 80, clicks: 12, conversions: 1 });
    expect(metricRowHasNumbers(PIPEDREAM_METRICS_WINDOW.results[0])).toBe(true);
    expect(metricRowHasNumbers({ campaign: { name: 'Only a name' } })).toBe(false);
    const merged = mergeCampaignMetrics([
      { platform: 'google_ads', campaign: 'Painting | Philadelphia | Search | Planned', utm: '', spend: 0, clicks: 0, conversions: 0, impressions: 0, status: 'PAUSED' as const, id: '111' },
      { platform: 'google_ads', campaign: 'HOUSE PAINTING', utm: '', spend: 0, clicks: 0, conversions: 0, impressions: 0, status: 'PAUSED' as const, id: '222' },
    ], PIPEDREAM_METRICS_WINDOW.results);
    expect(merged[0]).toMatchObject({ status: 'PAUSED', spend: 0, impressions: 0, clicks: 0, conversions: 0 });
    expect(merged[1]).toMatchObject({ spend: 20, impressions: 200, clicks: 20, conversions: 2, status: 'PAUSED' });
    const dollars = parseCampaignMetric({ campaign: { name: 'Search' }, metrics: { cost: 15.5, impressions: 3, clicks: 1, conversions: 0 } });
    expect(dollars?.spend).toBe(15.5);
  });
});

describe('live Google read path', () => {
  it('lists paused zero-spend campaigns when the metrics window is empty', async () => {
    const fake = managerClient();
    const connector = new PipedreamConnector({ connector: 'pipedream', pipedream: { environment: 'production', projectId: 'p', clientId: 'c', clientSecret: 's' } } as Config);
    (connector as unknown as { client: unknown }).client = fake.pd;
    const rows = await connector.getAdSpend!('painters');
    expect(rows.map((row) => row.campaign)).toEqual(['Painting | Philadelphia | Search | Planned', 'HOUSE PAINTING']);
    expect(rows.every((row) => row.spend === 0 && row.conversions === 0 && row.status === 'PAUSED')).toBe(true);
    const list = fake.sent.find((call) => call.id === 'google_ads-list-campaigns');
    expect(list?.configuredProps?.accountId).toBe(MANAGER);
    expect(list?.configuredProps?.customerClientId).toBe(CLIENT);
  });

  it('reads status by resource on the client account and reports a failed enable in plain words', async () => {
    const fake = managerClient();
    const connector = new PipedreamConnector({ connector: 'pipedream', pipedream: { environment: 'production', projectId: 'p', clientId: 'c', clientSecret: 's' } } as Config);
    (connector as unknown as { client: unknown }).client = fake.pd;
    (fake.pd.actions as { run: (req: { id?: string; configuredProps?: Record<string, unknown> }) => Promise<unknown> }).run = async (req) => {
      fake.sent.push({ id: req.id, configuredProps: req.configuredProps });
      if (req.id === 'google_ads-list-account-id-options') return { ret: [{ value: MANAGER }] };
      if (req.id === 'google_ads-list-customer-clients') return { ret: [{ id: CLIENT, descriptiveName: 'Painters In Philly' }] };
      if (req.id === 'google_ads-create-or-update-campaign') throw new Error('Google 400 {"error":{"message":"Campaign budget is required."}}');
      if (req.id === 'google_ads-create-report') return { ret: PIPEDREAM_STATUS_REPORT };
      if (req.id === 'google_ads-list-campaigns') return PIPEDREAM_RUN;
      return { ret: {} };
    };
    const turned = await connector.setGoogleCampaignStatus('painters', {
      campaignResource: `customers/${CLIENT}/campaigns/111`,
      status: 'ENABLED',
      adGroupResources: [`customers/${CLIENT}/adGroups/3`],
      adResources: [`customers/${CLIENT}/ads/8`],
    });
    const statusCall = fake.sent.find((call) => call.id === 'google_ads-create-report' && call.configuredProps?.resource === 'campaign');
    expect(statusCall?.configuredProps?.accountId).toBe(MANAGER);
    expect(statusCall?.configuredProps?.customerClientId).toBe(CLIENT);
    expect(statusCall?.configuredProps?.segments).toEqual([]);
    expect(statusCall?.configuredProps).not.toHaveProperty('dateRange');
    expect(turned.ok).toBe(false);
    expect(turned.note).toMatch(/Campaign budget is required/);
    expect(turned.note).not.toMatch(/UNKNOWN/);
    expect(turned.readback?.campaign).toBe('PAUSED');
  });

  it('reads spend, impressions, clicks, and conversions for the client, and still lists a paused campaign with no impressions', async () => {
    const fake = managerClient();
    (fake.pd.actions as { run: (req: { id?: string; configuredProps?: Record<string, unknown> }) => Promise<unknown> }).run = async (req) => {
      fake.sent.push({ id: req.id, configuredProps: req.configuredProps });
      if (req.id === 'google_ads-list-account-id-options') return { ret: [{ value: MANAGER }] };
      if (req.id === 'google_ads-list-customer-clients') return { ret: [{ id: CLIENT, descriptiveName: 'Painters In Philly', manager: false }] };
      if (req.id === 'google_ads-list-campaigns') return PIPEDREAM_RUN;
      if (req.id === 'google_ads-create-campaign-report') return { ret: PIPEDREAM_METRICS_WINDOW };
      return { ret: {} };
    };
    const connector = new PipedreamConnector({ connector: 'pipedream', pipedream: { environment: 'production', projectId: 'p', clientId: 'c', clientSecret: 's' } } as Config);
    (connector as unknown as { client: unknown }).client = fake.pd;
    const rows = await connector.getAdSpend!('painters', 'LAST_30_DAYS');
    const paused = rows.find((row) => row.id === '111')!;
    const house = rows.find((row) => row.id === '222')!;
    expect(paused.status).toBe('PAUSED');
    expect(paused.spend).toBe(0);
    expect(paused.impressions).toBe(0);
    expect(house).toMatchObject({ status: 'PAUSED', spend: 20, impressions: 200, clicks: 20, conversions: 2 });
    expect(house.spend / house.conversions!).toBe(10);
    const report = fake.sent.find((call) => call.id === 'google_ads-create-campaign-report');
    expect(report?.configuredProps?.accountId).toBe(MANAGER);
    expect(report?.configuredProps?.customerClientId).toBe(CLIENT);
    expect(report?.configuredProps?.dateRange).toBe('LAST_30_DAYS');
    expect(report?.configuredProps?.metrics).toEqual(expect.arrayContaining(['metrics.impressions', 'metrics.clicks', 'metrics.cost_micros', 'metrics.conversions']));
  });

  it('uses the saved client under the manager when the client list only returns the manager', async () => {
    const fake = managerClient();
    (fake.pd.actions as { run: (req: { id?: string; configuredProps?: Record<string, unknown> }) => Promise<unknown> }).run = async (req) => {
      fake.sent.push({ id: req.id, configuredProps: req.configuredProps });
      if (req.id === 'google_ads-list-account-id-options') return { ret: [{ value: MANAGER }] };
      if (req.id === 'google_ads-list-customer-clients') return { ret: [{ id: MANAGER, manager: true, descriptiveName: 'Manager' }] };
      if (req.id === 'google_ads-list-campaigns') {
        return req.configuredProps?.customerClientId === CLIENT ? PIPEDREAM_RUN : { ret: [] };
      }
      if (req.id === 'google_ads-create-campaign-report') return { ret: PIPEDREAM_METRICS_WINDOW };
      return { ret: {} };
    };
    const connector = new PipedreamConnector({ connector: 'pipedream', pipedream: { environment: 'production', projectId: 'p', clientId: 'c', clientSecret: 's' } } as Config);
    (connector as unknown as { client: unknown }).client = fake.pd;
    const blind = await connector.getAdSpend!('painters');
    expect(blind).toEqual([]);
    connector.rememberGoogleCustomer('painters', CLIENT, MANAGER);
    const rows = await connector.getAdSpend!('painters');
    expect(rows.find((row) => row.id === '222')).toMatchObject({ spend: 20, impressions: 200, clicks: 20, conversions: 2 });
    expect(rows.find((row) => row.id === '111')?.status).toBe('PAUSED');
    const report = fake.sent.filter((call) => call.id === 'google_ads-create-campaign-report').at(-1);
    expect(report?.configuredProps?.accountId).toBe(MANAGER);
    expect(report?.configuredProps?.customerClientId).toBe(CLIENT);
  });
});

describe('dashboard campaign rows', () => {
  it('shows paused campaigns with zero spend instead of an empty window', () => {
    const input = {
      mode: 'automate',
      trade: 'Painting',
      market: 'Philadelphia',
      dailyBudget: 20,
      maxChangePct: 10,
      leadsPerDay: 1,
      targetCpa: null,
      sampleConnector: false,
      google: { oauth: true, ready: true, note: '' },
      ghlConnected: false,
      ghlDetail: '',
      socialConnected: false,
      gbpConnected: false,
      gbpHasData: false,
      paused: false,
      hasBundle: true,
      playbook: null,
      reviewOn: false,
      speedOn: false,
      metrics: [],
      campaigns: [
        { platform: 'google_ads', name: 'HOUSE PAINTING', spend: 0, leads: 0, status: 'PAUSED' as const },
        { platform: 'google_ads', name: 'Painting | Philadelphia | Search | Planned', spend: 0, leads: 0, status: 'PAUSED' as const },
      ],
      recommendations: [],
      inbox: [],
    } satisfies OperatorInput;
    const view = buildOperatorView(input);
    expect(view.channels.find((row) => row.id === 'google')?.verdict).not.toMatch(/no campaign rows/);
    expect(view.breakdown.rows.map((row) => row.name)).toEqual(['HOUSE PAINTING', 'Painting | Philadelphia | Search | Planned']);
    expect(view.breakdown.rows.every((row) => row.spend === '$0' && row.leads === '0' && row.status === 'Paused')).toBe(true);
    expect(view.breakdown.empty).toBeNull();
  });

  it('shows paused status, impressions, clicks, conversions, and cost per lead from the Google read', () => {
    const input = {
      mode: 'automate',
      trade: 'Painting',
      market: 'Philadelphia',
      dailyBudget: 20,
      maxChangePct: 10,
      leadsPerDay: 1,
      targetCpa: null,
      sampleConnector: false,
      google: { oauth: true, ready: true, note: '' },
      ghlConnected: false,
      ghlDetail: '',
      socialConnected: false,
      gbpConnected: false,
      gbpHasData: false,
      paused: false,
      hasBundle: true,
      playbook: null,
      reviewOn: false,
      speedOn: false,
      metrics: [],
      campaigns: [
        { platform: 'google_ads', name: 'Painting | Philadelphia | Search | Planned', spend: 0, leads: 0, impressions: 0, clicks: 0, status: 'PAUSED' as const },
        { platform: 'google_ads', name: 'HOUSE PAINTING', spend: 20, leads: 2, impressions: 200, clicks: 20, status: 'PAUSED' as const },
      ],
      recommendations: [],
      inbox: [],
    } satisfies OperatorInput;
    const view = buildOperatorView(input);
    expect(view.breakdown.note).toMatch(/last 30 days/i);
    expect(view.breakdown.rows[0]).toMatchObject({ spend: '$0', impressions: '0', clicks: '0', leads: '0', cost: 'n/a', status: 'Paused' });
    expect(view.breakdown.rows[1]).toMatchObject({ spend: '$20', impressions: '200', clicks: '20', leads: '2', cost: '$10', status: 'Paused' });
    expect(view.channels.find((row) => row.id === 'google')?.foot).toMatch(/\$20 spent. 200 impressions. 20 clicks. 2 conversions/);
    expect(view.breakdown.sample).toBe(false);
  });
});
