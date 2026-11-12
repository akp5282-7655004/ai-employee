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
