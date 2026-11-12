/**
 * Google Ads reads that match the live Pipedream actions.
 *
 * google_ads-create-report does not run a caller-supplied GAQL string. It
 * builds the query from resource, fields, segments, and metrics. Segments
 * default to segments.date, and a date range adds
 * `WHERE segments.date DURING <range>`. Google then omits every campaign
 * with no metrics in that window, which is why a paused campaign and an
 * idle older campaign both disappeared.
 *
 * Status reads send fields only, segments as an empty list (so the date
 * default is not applied), and no metrics or dateRange. The customer in
 * the request path is the client account. accountId is the manager and
 * becomes the login-customer-id header.
 *
 * list-campaigns returns the search rows as a bare array. create-report
 * returns `{ query, results }`. The SDK wraps either one as
 * `{ ret, exports: { $summary }, os }`. The summary text is not a status.
 */

export interface AdsCustomerPair {
  /** login-customer-id. The manager when this login manages a client. */
  accountId: string;
  /** The ad account that owns the campaigns. Omitted when it is the same as accountId. */
  customerClientId?: string;
}

export interface StatusReportArgs {
  appName: string;
  authId: string;
  pair: AdsCustomerPair;
  resource: 'campaign' | 'ad_group' | 'ad_group_ad';
  ids: string[];
}

const digits = (value: string | undefined): string => (value || '').replace(/[^\d]/g, '');

/** Client customer from a resource name, with the manager kept as the login. */
export function customerPair(args: { resource?: string; login?: string; client?: string }): AdsCustomerPair {
  const fromResource = (args.resource || '').match(/customers\/(\d{10})\//)?.[1];
  const customer = fromResource || digits(args.client) || digits(args.login);
  const login = digits(args.login) || customer;
  if (!customer) return { accountId: login };
  if (!login || login === customer) return { accountId: customer };
  return { accountId: login, customerClientId: customer };
}

/**
 * Props for google_ads-create-report / google_ads-create-campaign-report.
 * Empty segments override the component default of segments.date.
 * No metrics and no dateRange, so zero-impression rows stay in the result.
 */
export function statusReportProps(args: StatusReportArgs): Record<string, unknown> {
  const fields = args.resource === 'ad_group_ad'
    ? ['status', 'resource_name', 'ad.id']
    : ['status', 'id', 'name', 'resource_name'];
  const props: Record<string, unknown> = {
    [args.appName]: { authProvisionId: args.authId },
    accountId: args.pair.accountId,
    resource: args.resource,
    fields,
    segments: [],
  };
  if (args.pair.customerClientId) props.customerClientId = args.pair.customerClientId;
  if (args.ids.length) props.objectFilter = args.ids;
  return props;
}

/** The GAQL the live report action builds from statusReportProps. No date, no metrics. */
export function statusGaql(resource: 'campaign' | 'ad_group' | 'ad_group_ad', ids: string[]): string {
  const fields = resource === 'ad_group_ad'
    ? [`${resource}.status`, `${resource}.resource_name`, `${resource}.ad.id`]
    : [`${resource}.status`, `${resource}.id`, `${resource}.name`, `${resource}.resource_name`];
  let query = `SELECT ${fields.join(', ')} FROM ${resource}`;
  if (ids.length) {
    const column = resource === 'ad_group_ad' ? 'ad_group_ad.ad.id' : `${resource}.id`;
    query += ` WHERE ${column} IN (${ids.join(', ')})`;
  }
  return query;
}

/** List every campaign, including paused and zero-spend, and skip removed. */
export function campaignListGaql(): string {
  return "SELECT campaign.id, campaign.name, campaign.status, campaign.resource_name FROM campaign WHERE campaign.status != 'REMOVED'";
}

/** Unwrap a Pipedream actions.run body. Prefer ret. A $summary export is not the rows. */
export function actionPayload(res: unknown): unknown {
  if (!res || typeof res !== 'object') return res ?? null;
  const row = res as Record<string, unknown>;
  if ('ret' in row || 'exports' in row || 'os' in row) {
    if (row.ret != null) return row.ret;
    return null;
  }
  return res;
}

export function plainGoogleError(raw: string | undefined): string {
  const text = (raw || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const quoted = text.match(/"message"\s*:\s*"([^"]+)"/i);
  const picked = (quoted?.[1] || text).replace(/\\n/g, ' ').replace(/_/g, ' ');
  return picked.length > 280 ? `${picked.slice(0, 277)}...` : picked;
}

/**
 * Real return values from the Pipedream Google Ads actions
 * (components/google_ads, read 2026-11-12).
 * list-campaigns returns the search rows. create-report returns { query, results }.
 * The SDK wraps that return value in ret.
 */
export const PIPEDREAM_LIST_CAMPAIGNS = [
  {
    campaign: {
      resourceName: 'customers/9013698905/campaigns/111',
      id: '111',
      name: 'Painting | Philadelphia | Search | Planned',
      status: 'PAUSED',
      advertisingChannelType: 'SEARCH',
      startDateTime: '2026-11-11 20:39:00',
      endDateTime: '2037-12-30 23:59:59',
    },
  },
  {
    campaign: {
      resourceName: 'customers/9013698905/campaigns/222',
      id: '222',
      name: 'HOUSE PAINTING',
      status: 'PAUSED',
      advertisingChannelType: 'SEARCH',
    },
  },
  {
    campaign: {
      resourceName: 'customers/9013698905/campaigns/333',
      id: '333',
      name: 'Old removed',
      status: 'REMOVED',
    },
  },
];

export const PIPEDREAM_STATUS_REPORT = {
  query: "SELECT campaign.status, campaign.id, campaign.name, campaign.resource_name FROM campaign WHERE campaign.id IN (111)",
  results: [
    {
      campaign: {
        resourceName: 'customers/9013698905/campaigns/111',
        id: '111',
        name: 'Painting | Philadelphia | Search | Planned',
        status: 'PAUSED',
      },
    },
  ],
};

export const PIPEDREAM_AD_GROUP_REPORT = {
  query: 'SELECT ad_group.status, ad_group.id, ad_group.name, ad_group.resource_name FROM ad_group WHERE ad_group.id IN (3)',
  results: [
    {
      campaign: { id: '111', status: 'ENABLED' },
      adGroup: { id: '3', resourceName: 'customers/9013698905/adGroups/3', status: 'ENABLED', name: 'Interior painting' },
    },
  ],
};

export const PIPEDREAM_AD_REPORT = {
  query: 'SELECT ad_group_ad.status, ad_group_ad.resource_name, ad_group_ad.ad.id FROM ad_group_ad WHERE ad_group_ad.ad.id IN (8)',
  results: [
    {
      adGroupAd: {
        resourceName: 'customers/9013698905/adGroupAds/3~8',
        status: 'ENABLED',
        ad: { id: '8', resourceName: 'customers/9013698905/ads/8' },
      },
    },
  ],
};

/** What a metrics report returns for a paused campaign with no impressions. */
export const PIPEDREAM_METRICS_EMPTY = {
  query: 'SELECT campaign.name, segments.date, metrics.cost_micros, metrics.clicks, metrics.conversions FROM campaign WHERE segments.date DURING LAST_30_DAYS',
  results: [] as unknown[],
};

export const PIPEDREAM_RUN = {
  exports: { $summary: 'Successfully retrieved 2 campaigns.' },
  os: [] as unknown[],
  ret: PIPEDREAM_LIST_CAMPAIGNS,
};

/**
 * One campaign's metrics inside a date window. Daily rows are summed by the
 * caller. costMicros is millionths of a dollar. A missing micros field can
 * still carry a dollar `cost`.
 */
export interface CampaignMetric {
  id: string;
  name: string;
  impressions: number;
  clicks: number;
  conversions: number;
  spend: number;
}

function metricNumber(value: unknown): number {
  if (typeof value === 'string') {
    const n = Number(value.replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function campaignIdOf(value: unknown): string {
  const text = String(value ?? '');
  const fromResource = text.match(/campaigns\/(\d+)/);
  if (fromResource?.[1]) return fromResource[1];
  const digits = text.replace(/\D/g, '');
  return /^\d+$/.test(digits) ? digits : '';
}

/** True when a report row actually carries a metric, not just a campaign name. */
export function metricRowHasNumbers(row: unknown): boolean {
  if (!row || typeof row !== 'object') return false;
  const rec = row as Record<string, unknown>;
  const metrics = rec.metrics && typeof rec.metrics === 'object' ? rec.metrics as Record<string, unknown> : rec;
  return ['impressions', 'clicks', 'conversions', 'costMicros', 'cost_micros', 'cost', 'spend'].some((key) => {
    const value = metrics[key] ?? rec[key];
    return value != null && value !== '' && Number.isFinite(Number(typeof value === 'string' ? value.replace(/,/g, '') : value));
  });
}

export function parseCampaignMetric(row: unknown): CampaignMetric | null {
  if (!row || typeof row !== 'object') return null;
  const rec = row as Record<string, unknown>;
  const campaign = rec.campaign && typeof rec.campaign === 'object' ? rec.campaign as Record<string, unknown> : {};
  const metrics = rec.metrics && typeof rec.metrics === 'object' ? rec.metrics as Record<string, unknown> : rec;
  const id = campaignIdOf(campaign.id ?? campaign.resourceName ?? rec.id ?? rec.resourceName);
  const name = String(campaign.name ?? rec.campaignName ?? rec.name ?? '').trim();
  if (!id && !name) return null;
  const micros = metrics.costMicros ?? metrics.cost_micros ?? rec.costMicros ?? rec.cost_micros;
  const spend = micros != null && String(micros).trim() !== ''
    ? metricNumber(micros) / 1_000_000
    : metricNumber(metrics.cost ?? rec.cost ?? rec.spend);
  return {
    id,
    name,
    impressions: metricNumber(metrics.impressions),
    clicks: metricNumber(metrics.clicks),
    conversions: metricNumber(metrics.conversions),
    spend,
  };
}

export interface ListedCampaignSpend {
  platform?: string;
  campaign: string;
  utm?: string;
  spend: number;
  clicks?: number;
  conversions?: number;
  impressions?: number;
  status?: 'ENABLED' | 'PAUSED' | 'UNKNOWN';
  id?: string;
}

/**
 * Keep every listed campaign, including paused and zero-impression rows.
 * Overlay summed metrics from the date-window report. Match on campaign id,
 * then on name. Metrics-only rows are appended so spend is not dropped when
 * the status list failed.
 */
export function mergeCampaignMetrics(listed: ListedCampaignSpend[], metricRows: unknown[]): ListedCampaignSpend[] {
  const buckets = new Map<string, CampaignMetric>();
  const add = (key: string, row: CampaignMetric) => {
    const prev = buckets.get(key);
    if (!prev) {
      buckets.set(key, { ...row });
      return;
    }
    prev.impressions += row.impressions;
    prev.clicks += row.clicks;
    prev.conversions += row.conversions;
    prev.spend += row.spend;
    if (!prev.id && row.id) prev.id = row.id;
    if (!prev.name && row.name) prev.name = row.name;
  };
  for (const raw of metricRows) {
    const row = parseCampaignMetric(raw);
    if (!row) continue;
    add(row.id || row.name.toLowerCase(), row);
  }
  const used = new Set<string>();
  const take = (item: ListedCampaignSpend): CampaignMetric | undefined => {
    const byId = item.id ? buckets.get(item.id) : undefined;
    const byName = buckets.get(item.campaign.toLowerCase());
    const hit = byId ?? byName;
    if (!hit) return undefined;
    if (hit.id) used.add(hit.id);
    if (hit.name) used.add(hit.name.toLowerCase());
    return hit;
  };
  const merged = listed.map((item) => {
    const hit = take(item);
    if (!hit) {
      return { ...item, impressions: item.impressions ?? 0, clicks: item.clicks ?? 0, conversions: item.conversions ?? 0 };
    }
    return {
      ...item,
      spend: Math.round(hit.spend * 100) / 100,
      clicks: hit.clicks,
      conversions: hit.conversions,
      impressions: hit.impressions,
    };
  });
  for (const row of buckets.values()) {
    if ((row.id && used.has(row.id)) || (row.name && used.has(row.name.toLowerCase()))) continue;
    merged.push({
      platform: 'google_ads',
      campaign: row.name || `Campaign ${row.id}`,
      utm: '',
      spend: Math.round(row.spend * 100) / 100,
      clicks: row.clicks,
      conversions: row.conversions,
      impressions: row.impressions,
      id: row.id || undefined,
    });
  }
  return merged;
}

export type AdsReportLevel = 'campaign' | 'ad_group' | 'keyword' | 'search_term';

export interface AdsPerformanceRow {
  level: AdsReportLevel;
  date?: string;
  campaign: string;
  adGroup?: string;
  keyword?: string;
  searchTerm?: string;
  impressions: number;
  clicks: number;
  conversions: number;
  spend: number;
  reach?: number;
  frequency?: number;
  status?: string;
}

const METRICS = ['metrics.impressions', 'metrics.clicks', 'metrics.cost_micros', 'metrics.conversions'];

/** Props for a dated performance read. Campaign rows include segments.date. */
export function marketingReportProps(args: {
  appName: string;
  authId: string;
  pair: AdsCustomerPair;
  level: AdsReportLevel;
  dateRange: string;
  startDate?: string;
  endDate?: string;
}): Record<string, unknown> {
  const resource = args.level === 'campaign' ? 'campaign'
    : args.level === 'ad_group' ? 'ad_group'
      : args.level === 'keyword' ? 'keyword_view'
        : 'search_term_view';
  const fields = args.level === 'campaign'
    ? ['campaign.id', 'campaign.name', 'campaign.status']
    : args.level === 'ad_group'
      ? ['campaign.name', 'ad_group.id', 'ad_group.name']
      : args.level === 'keyword'
        ? ['campaign.name', 'ad_group.name', 'ad_group_criterion.keyword.text']
        : ['campaign.name', 'ad_group.name', 'search_term_view.search_term'];
  const props: Record<string, unknown> = {
    [args.appName]: { authProvisionId: args.authId },
    accountId: args.pair.accountId,
    resource,
    fields,
    metrics: METRICS,
    segments: args.level === 'campaign' ? ['segments.date'] : [],
    dateRange: args.dateRange,
  };
  if (args.pair.customerClientId) props.customerClientId = args.pair.customerClientId;
  if (args.startDate && args.endDate) {
    props.startDate = args.startDate;
    props.endDate = args.endDate;
  }
  return props;
}

function nestedName(value: unknown, key: string): string {
  if (!value || typeof value !== 'object') return '';
  const row = value as Record<string, unknown>;
  const direct = row[key];
  return typeof direct === 'string' ? direct.trim() : '';
}

function leadActions(rec: Record<string, unknown>): number | null {
  if (!Array.isArray(rec.actions)) return null;
  let total = 0;
  let found = false;
  for (const action of rec.actions) {
    if (!action || typeof action !== 'object') continue;
    const type = String((action as { action_type?: string }).action_type || '');
    if (!/lead/i.test(type)) continue;
    found = true;
    total += metricNumber((action as { value?: unknown }).value);
  }
  return found ? total : null;
}

/** One Google or Meta performance row. Returns null when the row has no name. */
export function parseAdsPerformanceRow(row: unknown, level: AdsReportLevel): AdsPerformanceRow | null {
  if (!row || typeof row !== 'object') return null;
  const rec = row as Record<string, unknown>;
  const named = typeof rec.campaign_name === 'string'
    ? { ...rec, name: rec.name || rec.campaign_name, campaign: rec.campaign || { name: rec.campaign_name } }
    : rec;
  const metric = parseCampaignMetric(named);
  if (!metric) return null;
  const segments = rec.segments && typeof rec.segments === 'object' ? rec.segments as Record<string, unknown> : {};
  const adGroup = rec.adGroup && typeof rec.adGroup === 'object' ? rec.adGroup as Record<string, unknown>
    : rec.ad_group && typeof rec.ad_group === 'object' ? rec.ad_group as Record<string, unknown> : {};
  const criterion = rec.adGroupCriterion && typeof rec.adGroupCriterion === 'object' ? rec.adGroupCriterion as Record<string, unknown>
    : rec.ad_group_criterion && typeof rec.ad_group_criterion === 'object' ? rec.ad_group_criterion as Record<string, unknown> : {};
  const keyword = criterion.keyword && typeof criterion.keyword === 'object' ? criterion.keyword as Record<string, unknown> : {};
  const termView = rec.searchTermView && typeof rec.searchTermView === 'object' ? rec.searchTermView as Record<string, unknown>
    : rec.search_term_view && typeof rec.search_term_view === 'object' ? rec.search_term_view as Record<string, unknown> : {};
  const campaign = rec.campaign && typeof rec.campaign === 'object' ? rec.campaign as Record<string, unknown> : {};
  const date = typeof segments.date === 'string' ? segments.date
    : typeof rec.date_start === 'string' ? rec.date_start : undefined;
  const adGroupName = nestedName(adGroup, 'name') || (typeof rec.adset_name === 'string' ? rec.adset_name : '');
  const keywordText = typeof keyword.text === 'string' ? keyword.text
    : typeof rec.keyword === 'string' ? rec.keyword : '';
  const searchTerm = typeof termView.searchTerm === 'string' ? termView.searchTerm
    : typeof termView.search_term === 'string' ? termView.search_term
      : typeof rec.search_term === 'string' ? rec.search_term : '';
  const name = metric.name || (typeof rec.campaign_name === 'string' ? rec.campaign_name : '');
  if (level === 'keyword' && !keywordText) return null;
  if (level === 'search_term' && !searchTerm) return null;
  if (level === 'ad_group' && !adGroupName) return null;
  const leads = leadActions(rec);
  const metrics = rec.metrics && typeof rec.metrics === 'object' ? rec.metrics as Record<string, unknown> : rec;
  const reach = metrics.reach != null ? metricNumber(metrics.reach) : undefined;
  const frequency = metrics.frequency != null ? metricNumber(metrics.frequency) : undefined;
  const status = typeof campaign.status === 'string' ? campaign.status : undefined;
  return {
    level,
    date,
    campaign: name || adGroupName || keywordText || searchTerm,
    adGroup: adGroupName || undefined,
    keyword: keywordText || undefined,
    searchTerm: searchTerm || undefined,
    impressions: metric.impressions,
    clicks: metric.clicks,
    conversions: leads != null ? leads : metric.conversions,
    spend: Math.round(metric.spend * 100) / 100,
    reach,
    frequency,
    status,
  };
}

/** Last 30 days of one live campaign, split by day the way a segmented report returns it. */
export const PIPEDREAM_METRICS_WINDOW = {
  query: 'SELECT campaign.id, campaign.name, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM campaign WHERE segments.date DURING LAST_30_DAYS',
  results: [
    {
      campaign: { id: '222', name: 'HOUSE PAINTING', resourceName: 'customers/9013698905/campaigns/222' },
      metrics: { impressions: '80', clicks: '12', costMicros: '12000000', conversions: 1 },
      segments: { date: '2026-11-01' },
    },
    {
      campaign: { id: '222', name: 'HOUSE PAINTING', resourceName: 'customers/9013698905/campaigns/222' },
      metrics: { impressions: '120', clicks: '8', costMicros: '8000000', conversions: 1 },
      segments: { date: '2026-11-02' },
    },
  ],
};
