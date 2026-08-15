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

  async disconnectAccount(externalUserId: string, accountId: string): Promise<{ ok: boolean; note?: string }> {
    for (const key of [externalUserId, '*']) {
      const list = this.accounts.get(key);
      if (list && list.some((a) => a.id === accountId)) {
        this.accounts.set(key, list.filter((a) => a.id !== accountId));
        return { ok: true };
      }
    }
    return { ok: false, note: 'Account not found.' };
  }

  async createConnectToken(externalUserId: string): Promise<ConnectTokenResult> {
    const token = `mocktok_${externalUserId}_${++this.seq}`;
    return {
      token,
      expiresAt: new Date(Date.now() + 4 * 3600_000).toISOString(),
      connectUrl: `https://mock.connect.local/connect?token=${token}`,
    };
  }

  /** Accounts for a user, plus any seeded under the "*" wildcard (dev/demo). */
  private acc(externalUserId: string): ConnectedAccount[] {
    return [...(this.accounts.get(externalUserId) ?? []), ...(this.accounts.get('*') ?? [])];
  }

  async listAccounts(externalUserId: string, app?: string): Promise<ConnectedAccount[]> {
    const list = this.acc(externalUserId);
    return app ? list.filter((a) => a.app === app) : list;
  }

  async listApps(query?: string, limit = 60): Promise<{ apps: AppInfo[]; after?: string }> {
    const q = (query ?? '').trim().toLowerCase();
    const rows = q ? MOCK_APPS.filter((a) => a.name.toLowerCase().includes(q) || a.slug.includes(q)) : MOCK_APPS;
    return { apps: rows.slice(0, limit) };
  }

  async launchCampaign(externalUserId: string, spec: import('../agents/campaign.js').CampaignSpec): Promise<import('./types.js').CampaignLaunchResult> {
    const connected = this.acc(externalUserId).some((a) => a.app === 'google_ads');
    if (!connected) {
      return { ok: false, live: false, steps: [{ step: 'Google Ads account', ok: false, error: 'Connect Google Ads in Integrations first.' }], note: 'No Google Ads account connected.' };
    }
    const steps: import('./types.js').CampaignLaunchStep[] = [];
    steps.push({ step: 'Create daily budget ($' + spec.dailyBudget + ')', ok: true, resource: 'customers/DEMO/campaignBudgets/1' });
    steps.push({ step: `Create campaign "${spec.name}" (${spec.status})`, ok: true, resource: 'customers/DEMO/campaigns/2' });
    spec.adGroups.forEach((g, i) => {
      steps.push({ step: `Create ad group "${g.name}"`, ok: true, resource: `customers/DEMO/adGroups/${10 + i}` });
      steps.push({ step: `Add ${g.keywords.length} keywords to "${g.name}"`, ok: true });
      steps.push({ step: `Create responsive search ad in "${g.name}"`, ok: true });
    });
    return { ok: true, live: false, campaignResource: 'customers/DEMO/campaigns/2', steps, note: 'Demo connector — no real campaign was created. On Render with Google Ads connected + Pipedream in production, this runs the real write-chain.' };
  }

  metaLaunchReady(): { ready: boolean; account?: string; note: string } {
    const token = process.env.META_ADS_ACCESS_TOKEN;
    const acct = process.env.META_AD_ACCOUNT_ID;
    const page = process.env.META_PAGE_ID;
    if (token && acct && page) return { ready: true, account: 'act_' + acct.replace(/[^0-9]/g, ''), note: 'Connected to Meta ad account.' };
    return { ready: false, note: 'Not connected — add META_ADS_ACCESS_TOKEN, META_AD_ACCOUNT_ID, META_PAGE_ID on Render (from your Meta ad account).' };
  }

  async describeConnections(externalUserId: string): Promise<import('./types.js').ConnectionDetail[]> {
    const LABEL: Record<string, string> = { google_ads: 'Google Ads', google_my_business: 'Google Business Profile', gohighlevel: 'GoHighLevel', highlevel_oauth: 'GoHighLevel', highlevel: 'GoHighLevel', leadconnector: 'GoHighLevel', facebook_pages: 'Facebook Page', google_analytics: 'Google Analytics' };
    const seen = new Map<string, string>();
    for (const a of this.acc(externalUserId)) if (!seen.has(a.app)) seen.set(a.app, a.id);
    const details: import('./types.js').ConnectionDetail[] = [...seen.entries()].map(([app, id]) => ({
      app,
      label: LABEL[app] ?? app,
      connected: true,
      accountName: app === 'google_ads' ? 'demo@yourbusiness.com' : 'Demo account',
      accountId: id,
      rows: app === 'google_ads' ? [{ k: 'Ad account (customer) ID', v: '123-456-7890' }] : [],
      note: 'Demo connector — on Render with real accounts connected, this shows your actual account names & IDs.',
    }));
    const metaReady = this.metaLaunchReady();
    details.push(
      metaReady.ready
        ? { app: 'meta_ads', label: 'Meta (Facebook / Instagram) Ads', connected: true, accountName: 'Demo Ad Account', accountId: metaReady.account, rows: [{ k: 'Ad account', v: metaReady.account ?? '' }, { k: 'Facebook Page', v: 'Your Page · ' + (process.env.META_PAGE_ID || '') }], note: 'Demo connector — on Render this resolves the real ad-account & Page name/logo from Meta.' }
        : { app: 'meta_ads', label: 'Meta (Facebook / Instagram) Ads', connected: false, note: metaReady.note },
    );
    return details;
  }

  async launchMetaCampaign(_externalUserId: string, spec: import('../agents/metacampaign.js').MetaCampaignSpec): Promise<import('./types.js').CampaignLaunchResult> {
    const steps: import('./types.js').CampaignLaunchStep[] = [];
    steps.push({ step: `Create campaign "${spec.name}" (PAUSED)`, ok: true, resource: 'DEMO_CAMPAIGN_1' });
    steps.push({ step: `Create ad set ($${spec.dailyBudget}/day, ${spec.geo.zips.length ? spec.geo.zips.length + ' ZIPs' : 'US'})`, ok: true, resource: 'DEMO_ADSET_1' });
    steps.push({ step: 'Create ad creative (offer copy + website link)', ok: true, resource: 'DEMO_CREATIVE_1' });
    steps.push({ step: 'Create ad (PAUSED)', ok: true, resource: 'DEMO_AD_1' });
    return {
      ok: true,
      live: false,
      campaignResource: 'DEMO_CAMPAIGN_1',
      link: 'https://adsmanager.facebook.com/adsmanager/manage/campaigns',
      steps,
      note: 'Demo connector — no real campaign was created. On Render with your Meta ad account connected (META_ADS_ACCESS_TOKEN, META_AD_ACCOUNT_ID, META_PAGE_ID), this builds it as a PAUSED draft in your Ads Manager.',
    };
  }

  async uploadOfflineConversions(externalUserId: string, items: import('./types.js').ConversionItem[]): Promise<import('./types.js').ConversionUploadResult> {
    const connected = this.acc(externalUserId).some((a) => a.app === 'google_ads');
    if (!connected) return { ok: false, live: false, uploaded: 0, failed: items.length, steps: items.map((i) => ({ dealId: i.dealId, ok: false, error: 'Connect Google Ads first.' })), note: 'No Google Ads account connected.' };
    return { ok: true, live: false, uploaded: items.length, failed: 0, steps: items.map((i) => ({ dealId: i.dealId, ok: true })), note: 'Demo connector — no real upload. On Render with Google Ads connected, this sends offline conversions live so Smart Bidding learns from your real jobs.' };
  }

  async adjustCampaignBudgets(externalUserId: string, changes: import('./types.js').BudgetChange[]): Promise<import('./types.js').BudgetChangeResult> {
    const connected = this.acc(externalUserId).some((a) => a.app === 'google_ads');
    if (!connected) return { ok: false, live: false, applied: 0, steps: changes.map((c) => ({ campaign: c.campaign, ok: false, error: 'Connect Google Ads first.' })), note: 'No Google Ads account connected.' };
    const acted = changes.filter((c) => c.action !== 'hold');
    return { ok: true, live: false, applied: acted.length, steps: acted.map((c) => ({ campaign: c.campaign, ok: true })), note: 'Demo connector — no real budget change. On Render with Google Ads connected, this pushes the approved budget moves live.' };
  }

  async getAdSpend(externalUserId: string, range = 'LAST_30_DAYS') {
    const apps = new Set((this.acc(externalUserId)).map((a) => a.app));
    // Scale demo figures to the selected window so the range selector visibly works.
    const factor: Record<string, number> = { LAST_7_DAYS: 0.25, LAST_14_DAYS: 0.5, LAST_30_DAYS: 1, THIS_MONTH: 0.7, LAST_MONTH: 1.05 };
    const f = factor[range] ?? 1;
    const sc = (r: import('../revenue/attribution.js').CampaignSpend): import('../revenue/attribution.js').CampaignSpend => ({ ...r, spend: Math.round((r.spend || 0) * f), clicks: Math.round((r.clicks || 0) * f), conversions: Math.round((r.conversions || 0) * f) });
    const rows: import('../revenue/attribution.js').CampaignSpend[] = [];
    if (apps.has('google_ads')) {
      rows.push(
        sc({ platform: 'google_ads', campaign: 'Emergency Plumbing', utm: 'gads_plumbing', spend: 1240, clicks: 410, conversions: 38 }),
        sc({ platform: 'google_ads', campaign: 'AC Repair Search', utm: 'gads_ac', spend: 980, clicks: 300, conversions: 26 }),
      );
    }
    if (apps.has('facebook')) {
      rows.push(sc({ platform: 'facebook', campaign: 'AC Tune-up Promo', utm: 'meta_ac', spend: 620, clicks: 520, conversions: 19 }));
    }
    return rows;
  }

  async getDeals(externalUserId: string) {
    const CRMS = ['gohighlevel', 'servicetitan', 'jobber', 'hubspot', 'salesforce_rest_api', 'housecall_pro', 'service_fusion'];
    const apps = new Set((this.acc(externalUserId)).map((a) => a.app));
    if (!CRMS.some((c) => apps.has(c))) return [];
    const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
    return [
      { id: 'd1', value: 4200, won: true, utmSource: 'google_ads', utmCampaign: 'gads_plumbing', createdAt: ago(2), wonAt: ago(1), gclid: 'DEMO-gclid-d1', email: 'sarah@example.com' },
      { id: 'd2', value: 1850, won: true, utmSource: 'google_ads', utmCampaign: 'gads_plumbing', createdAt: ago(9), wonAt: ago(7), gclid: 'DEMO-gclid-d2' },
      { id: 'd3', value: 2100, won: true, utmSource: 'google_ads', utmCampaign: 'gads_ac', createdAt: ago(20), wonAt: ago(18), email: 'mike@example.com', phone: '2155550142' },
      { id: 'd4', value: 890, won: false, utmSource: 'facebook', utmCampaign: 'meta_ac', createdAt: ago(25) },
      { id: 'd5', value: 2480, won: true, utmSource: 'facebook', utmCampaign: 'meta_ac', createdAt: ago(40), wonAt: ago(38) },
      { id: 'd6', value: 1714, won: true, utmSource: 'google_ads', utmCampaign: 'gads_plumbing', createdAt: ago(55), wonAt: ago(52), gclid: 'DEMO-gclid-d6' },
    ];
  }

  async getRecentEmails(externalUserId: string, limit = 25) {
    const apps = new Set((this.acc(externalUserId)).map((a) => a.app));
    if (!apps.has('gmail') && !apps.has('google_gmail')) return [];
    const demo: import('./types.js').EmailMessage[] = [
      { from: 'Sarah (new lead)', subject: 'Kitchen repaint quote?', snippet: 'Hi, saw your Google ad — can you quote a 2-room repaint this week?', unread: true },
      { from: 'Mike Rivera', subject: 'Re: Tuesday job', snippet: 'Confirming we start the Thompson job at 8am. Need the deposit invoice.', unread: true },
      { from: 'HomeAdvisor', subject: 'You have 3 new leads', snippet: '3 homeowners in Phoenix requested painting quotes.', unread: true },
      { from: 'QuickBooks', subject: 'Invoice #1042 is overdue', snippet: 'Invoice for $1,850 to J. Thompson is 5 days overdue.', unread: false },
      { from: 'Google Business Profile', subject: 'New 5-star review', snippet: 'A customer left you a 5-star review — reply to boost ranking.', unread: true },
    ];
    return demo.slice(0, limit);
  }

  async getSocialMetrics(externalUserId: string) {
    const apps = new Set((this.acc(externalUserId)).map((a) => a.app));
    if (!['facebook', 'instagram', 'linkedin'].some((a) => apps.has(a))) return null;
    return { impressions: 3420, clicks: 128, likes: 74, followers: 1290 };
  }
  async getReviews(externalUserId: string) {
    const apps = new Set((this.acc(externalUserId)).map((a) => a.app));
    if (!apps.has('google_my_business') && !apps.has('gmb')) return [];
    return [
      { author: 'Jenna M.', rating: 5, text: 'Showed up on time and did a beautiful job on our living room. Highly recommend!', platform: 'Google' },
      { author: 'Dave R.', rating: 2, text: 'Work was fine but they were an hour late and didn’t call.', platform: 'Google' },
    ];
  }
  async getLeads(externalUserId: string) {
    const CRMS = ['gohighlevel', 'servicetitan', 'jobber', 'hubspot', 'salesforce_rest_api', 'housecall_pro'];
    const apps = new Set((this.acc(externalUserId)).map((a) => a.app));
    if (!CRMS.some((c) => apps.has(c))) return [];
    const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
    return [
      { name: 'Sarah Kim', service: 'Kitchen repaint', source: 'Google Ads', contacted: false, createdAt: ago(1) },
      { name: 'Tom B.', service: 'Exterior painting quote', source: 'Website form', contacted: false, createdAt: ago(4) },
      { name: 'Rosa L.', service: 'Cabinet refinishing', source: 'Google Ads', contacted: true, createdAt: ago(11) },
      { name: 'Dan P.', service: 'Deck staining', source: 'Referral', contacted: true, createdAt: ago(26) },
      { name: 'Aisha N.', service: 'Whole-home interior', source: 'Website form', contacted: true, createdAt: ago(48) },
    ];
  }
  async probe(externalUserId: string, app: string): Promise<{ connected: boolean; count: number; sample: unknown; error?: string }> {
    const connected = this.acc(externalUserId).some((a) => a.app === app);
    return { connected, count: connected ? 1 : 0, sample: connected ? { note: 'offline mock connector — returns demo data, not live figures', app } : null };
  }

  async runAppTask(req: AppTaskRequest): Promise<AppTaskResult> {
    const summary = summarizeTask(req.app, req.query, req.params);
    const connected = this.acc(req.externalUserId).some((a) => a.app === req.app);
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
