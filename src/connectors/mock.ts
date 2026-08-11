import type {
  AppInfo,
  AppTaskRequest,
  AppTaskResult,
  ConnectedAccount,
  ConnectTokenResult,
  Connector,
  RunActionRequest,
  RunActionResult,
} from './types.js';

/** A friendly one-line summary of an app task, from its query + params. */
export function summarizeTask(app: string, query: string, params: Record<string, string>): string {
  const who =
    params.name ||
    [params.firstName, params.lastName].filter(Boolean).join(' ') ||
    params.email ||
    params.phone ||
    'the contact';
  const detail = params.email && who !== params.email ? ` (${params.email})` : '';
  const q = query.toLowerCase();
  if (q.includes('contact') || q.includes('lead')) return `Add ${who}${detail} as a new contact in ${app}`;
  if (q.includes('sms') || q.includes('text') || q.includes('message'))
    return `Text ${who}${params.message ? `: “${params.message}”` : ''} via ${app}`;
  if (q.includes('note')) return `Add a note to ${who} in ${app}${params.note ? `: “${params.note}”` : ''}`;
  if (q.includes('tag') || q.includes('label')) return `Tag ${who}${params.tag ? ` “${params.tag}”` : ''} in ${app}`;
  return `Run “${query}” in ${app}`;
}

/** A curated slice of the app catalog for offline/demo mode. */
const MOCK_APPS: AppInfo[] = [
  { slug: 'google_ads', name: 'Google Ads', categories: ['Advertising'] },
  { slug: 'facebook', name: 'Meta Ads', categories: ['Advertising'] },
  { slug: 'google_my_business', name: 'Google Business Profile', categories: ['Marketing'] },
  { slug: 'gohighlevel', name: 'GoHighLevel', categories: ['CRM'] },
  { slug: 'hubspot', name: 'HubSpot', categories: ['CRM'] },
  { slug: 'salesforce_rest_api', name: 'Salesforce', categories: ['CRM'] },
  { slug: 'servicetitan', name: 'ServiceTitan', categories: ['Field Service'] },
  { slug: 'slack', name: 'Slack', categories: ['Communication'] },
  { slug: 'gmail', name: 'Gmail', categories: ['Email'] },
  { slug: 'google_sheets', name: 'Google Sheets', categories: ['Productivity'] },
  { slug: 'google_calendar', name: 'Google Calendar', categories: ['Productivity'] },
  { slug: 'calendly', name: 'Calendly', categories: ['Scheduling'] },
  { slug: 'twilio', name: 'Twilio', categories: ['Communication'] },
  { slug: 'mailchimp', name: 'Mailchimp', categories: ['Email'] },
  { slug: 'stripe', name: 'Stripe', categories: ['Payments'] },
  { slug: 'notion', name: 'Notion', categories: ['Productivity'] },
  { slug: 'zoom', name: 'Zoom', categories: ['Communication'] },
  { slug: 'linkedin', name: 'LinkedIn', categories: ['Social'] },
  { slug: 'google_analytics', name: 'Google Analytics', categories: ['Analytics'] },
  { slug: 'quickbooks', name: 'QuickBooks', categories: ['Accounting'] },
];

/**
 * The offline connector — the default, no Pipedream account required. It
 * simulates the connect flow, connected accounts, and action runs deterministically
 * so the whole product (and its tests) runs with zero external dependencies, then
 * swaps for the live Pipedream connector when credentials are set.
 */
export class MockConnector implements Connector {
  readonly name = 'mock';
  private seq = 0;
  private accounts = new Map<string, ConnectedAccount[]>();

  constructor(seed?: Record<string, string[]>) {
    // Optionally pre-connect some apps per user, e.g. { "shop-1": ["google_ads", "google_my_business"] }.
    for (const [user, apps] of Object.entries(seed ?? {})) {
      for (const app of apps) this.connect(user, app);
    }
  }

  /** Test/demo helper: pretend a user connected an app account. */
  connect(externalUserId: string, app: string, name?: string): ConnectedAccount {
    const account: ConnectedAccount = {
      id: `acc_${++this.seq}`,
      app,
      name: name ?? `${app} account`,
      externalUserId,
      healthy: true,
    };
    const list = this.accounts.get(externalUserId) ?? [];
    list.push(account);
    this.accounts.set(externalUserId, list);
    return account;
  }

  async createConnectToken(externalUserId: string): Promise<ConnectTokenResult> {
    const token = `mocktok_${externalUserId}_${++this.seq}`;
    return {
      token,
      expiresAt: new Date(Date.now() + 4 * 3600_000).toISOString(),
      connectUrl: `https://mock.connect.local/connect?token=${token}`,
    };
  }

  async listAccounts(externalUserId: string, app?: string): Promise<ConnectedAccount[]> {
    const list = this.accounts.get(externalUserId) ?? [];
    return app ? list.filter((a) => a.app === app) : list;
  }

  async listApps(query?: string, limit = 60): Promise<{ apps: AppInfo[]; after?: string }> {
    const q = (query ?? '').trim().toLowerCase();
    const rows = q ? MOCK_APPS.filter((a) => a.name.toLowerCase().includes(q) || a.slug.includes(q)) : MOCK_APPS;
    return { apps: rows.slice(0, limit) };
  }

  async getAdSpend(externalUserId: string) {
    const apps = new Set((this.accounts.get(externalUserId) ?? []).map((a) => a.app));
    const rows: import('../revenue/attribution.js').CampaignSpend[] = [];
    if (apps.has('google_ads')) {
      rows.push(
        { platform: 'google_ads', campaign: 'Emergency Plumbing', utm: 'gads_plumbing', spend: 1240, clicks: 410, conversions: 38 },
        { platform: 'google_ads', campaign: 'AC Repair Search', utm: 'gads_ac', spend: 980, clicks: 300, conversions: 26 },
      );
    }
    if (apps.has('facebook')) {
      rows.push({ platform: 'facebook', campaign: 'AC Tune-up Promo', utm: 'meta_ac', spend: 620, clicks: 520, conversions: 19 });
    }
    return rows;
  }

  async getDeals(externalUserId: string) {
    const CRMS = ['gohighlevel', 'servicetitan', 'jobber', 'hubspot', 'salesforce_rest_api', 'housecall_pro', 'service_fusion'];
    const apps = new Set((this.accounts.get(externalUserId) ?? []).map((a) => a.app));
    if (!CRMS.some((c) => apps.has(c))) return [];
    return [
      { id: 'd1', value: 4200, won: true, utmSource: 'google_ads', utmCampaign: 'gads_plumbing' },
      { id: 'd2', value: 1850, won: true, utmSource: 'google_ads', utmCampaign: 'gads_plumbing' },
      { id: 'd3', value: 2100, won: true, utmSource: 'google_ads', utmCampaign: 'gads_ac' },
      { id: 'd4', value: 890, won: false, utmSource: 'facebook', utmCampaign: 'meta_ac' },
      { id: 'd5', value: 2480, won: true, utmSource: 'facebook', utmCampaign: 'meta_ac' },
      { id: 'd6', value: 1714, won: true, utmSource: 'google_ads', utmCampaign: 'gads_plumbing' },
    ];
  }

  async runAppTask(req: AppTaskRequest): Promise<AppTaskResult> {
    const summary = summarizeTask(req.app, req.query, req.params);
    const connected = (this.accounts.get(req.externalUserId) ?? []).some((a) => a.app === req.app);
    if (!connected) {
      return {
        ok: false,
        actionId: `${req.app}-${req.query.replace(/\s+/g, '-')}`,
        app: req.app,
        output: null,
        summary,
        note: `No connected "${req.app}" account — connect it first, then I can ${summary.charAt(0).toLowerCase()}${summary.slice(1)}.`,
      };
    }
    const componentKey = `${req.app}-${req.query.replace(/\s+/g, '-')}`;
    return {
      ok: true,
      actionId: componentKey,
      componentKey,
      app: req.app,
      output: { simulated: true, ranAt: new Date().toISOString(), params: req.params },
      summary,
      note: 'Mock run — no real API call was made.',
    };
  }

  async runAction(req: RunActionRequest): Promise<RunActionResult> {
    const app = req.actionId.split('-')[0];
    const connected = (this.accounts.get(req.externalUserId) ?? []).some((a) => a.app === app);
    if (!connected) {
      return {
        ok: false,
        actionId: req.actionId,
        app,
        output: null,
        note: `No connected "${app}" account for user "${req.externalUserId}" — send them the connect link first.`,
      };
    }
    // Simulate a successful run, echoing the configured inputs.
    return {
      ok: true,
      actionId: req.actionId,
      app,
      output: { simulated: true, ranAt: new Date().toISOString(), inputs: req.configuredProps ?? {} },
      note: 'Mock run — no real API call was made.',
    };
  }
}
