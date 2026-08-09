import type {
  AppInfo,
  ConnectedAccount,
  ConnectTokenResult,
  Connector,
  RunActionRequest,
  RunActionResult,
} from './types.js';

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
