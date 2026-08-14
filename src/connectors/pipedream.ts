import type { Config } from '../config.js';
import { summarizeTask } from './mock.js';
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

/** Which component-prop names satisfy each semantic param, most-specific first. */
const PARAM_KEYWORDS: Record<string, string[]> = {
  firstName: ['first name', 'firstname', 'first'],
  lastName: ['last name', 'lastname', 'last', 'surname'],
  email: ['email'],
  phone: ['phone', 'mobile', 'cell', 'sms number', 'to number', 'number'],
  company: ['company', 'organization', 'business name', 'organisation'],
  name: ['full name', 'name', 'title'],
  message: ['message', 'body', 'text', 'content'],
  note: ['note', 'body', 'comment', 'description'],
  tag: ['tag', 'label'],
  // Social publishing: the post text and the media attachment.
  caption: ['caption', 'message', 'text', 'content', 'status', 'post'],
  media: ['media', 'image url', 'image', 'photo', 'video url', 'video', 'file url', 'attachment', 'url'],
};

/**
 * The **live Pipedream Connect** connector. It talks to Pipedream's managed-auth
 * backend via `@pipedream/sdk/server` — `createBackendClient` + `createConnectToken`
 * + `getAccounts` (per the Connect API reference). Pipedream holds each user's
 * OAuth credentials; we operate on their behalf with a short-lived token.
 *
 * Two deliberate choices:
 *  - The SDK is loaded dynamically at first use, so the offline project ships with
 *    no extra dependency and no typecheck coupling. Install it to go live:
 *      npm install @pipedream/sdk
 *  - `runAction` executes a Connect component (`id` = the component key) on the
 *    user's behalf. It's implemented against the documented RunActionOpts shape;
 *    because it runs real API calls, test it against a sandbox account before
 *    trusting it in production.
 */
export class PipedreamConnector implements Connector {
  readonly name = 'pipedream';
  private client: unknown | null = null;
  // Per-customer Google Ads discovery cache (report component + client account
  // IDs). Discovery is stable, so we resolve it once and reuse for TTL_MS —
  // every dashboard load then costs just the report run, not a full re-discovery.
  private gadsCache = new Map<string, { key: string; appName: string; ids: string[]; shape?: GadsShape; ts: number }>();
  private static readonly DISCOVERY_TTL_MS = 10 * 60 * 1000;

  constructor(private readonly cfg: Config) {}

  private async backend(): Promise<any> {
    if (this.client) return this.client;
    const { projectId, clientId, clientSecret, environment } = this.cfg.pipedream;
    if (!projectId || !clientId || !clientSecret) {
      throw new Error('Pipedream not configured — set PIPEDREAM_PROJECT_ID / _CLIENT_ID / _CLIENT_SECRET.');
    }
    // Dynamic import keeps tsc uncoupled from the SDK's generated types.
    const importDynamic = new Function('m', 'return import(m)') as (m: string) => Promise<any>;
    let sdk: any;
    try {
      sdk = await importDynamic('@pipedream/sdk');
    } catch {
      throw new Error('Live Pipedream connector needs the SDK — run: npm install @pipedream/sdk');
    }
    // v3 SDK: a single PipedreamClient with clientId/clientSecret/projectId.
    this.client = new sdk.PipedreamClient({
      clientId,
      clientSecret,
      projectId,
      projectEnvironment: environment,
    });
    return this.client;
  }

  async createConnectToken(externalUserId: string): Promise<ConnectTokenResult> {
    const pd = await this.backend();
    const res = await pd.tokens.create({ externalUserId });
    return {
      token: res.token,
      expiresAt: res.expiresAt ?? res.expires_at,
      connectUrl: res.connectLinkUrl ?? res.connect_link_url,
    };
  }

  async listAccounts(externalUserId: string, app?: string): Promise<ConnectedAccount[]> {
    const pd = await this.backend();
    const res = await pd.accounts.list({ externalUserId, app });
    const rows: any[] = res?.data ?? res?.accounts ?? (Array.isArray(res) ? res : []);
    return rows.map((a) => ({
      id: a.id,
      app: a.app?.nameSlug ?? a.app?.name_slug ?? a.app?.name ?? a.app ?? 'unknown',
      name: a.name,
      externalUserId,
      healthy: a.healthy ?? true,
    }));
  }

  async listApps(query?: string, limit = 48, after?: string): Promise<{ apps: AppInfo[]; after?: string }> {
    const pd = await this.backend();
    const res = await pd.apps.list({ q: query || undefined, limit, after, hasActions: true });
    const rows: any[] = res?.data ?? (Array.isArray(res) ? res : (res?.items ?? []));
    const apps = rows.map((a) => ({
      slug: a.nameSlug ?? a.name_slug,
      name: a.name,
      description: a.description,
      img: a.imgSrc ?? a.img_src,
      categories: a.categories ?? [],
    }));
    let next: string | undefined;
    try {
      if (res?.hasNextPage?.()) next = res?.response?.pageInfo?.endCursor ?? res?.response?.page_info?.end_cursor;
    } catch {
      /* no cursor */
    }
    return { apps, after: next };
  }

  async runAction(req: RunActionRequest): Promise<RunActionResult> {
    const app = req.actionId.split('-')[0] ?? 'unknown';
    const pd = await this.backend();
    try {
      // v3: actions.run executes a component on the user's behalf. `id` is the
      // component key (e.g. "google_ads-create-campaign").
      const res = await pd.actions.run({
        externalUserId: req.externalUserId,
        id: req.actionId,
        configuredProps: req.configuredProps ?? {},
      });
      const output = (res && (res.ret ?? res.exports ?? res)) ?? null;
      return { ok: true, actionId: req.actionId, app, output };
    } catch (err) {
      return { ok: false, actionId: req.actionId, app, output: null, note: String((err as Error).message) };
    }
  }

  /**
   * Read recent inbox messages via a connected Gmail account. Best-effort: discovers
   * a Gmail "list/find emails" action, runs it, and maps whatever it returns. Any
   * failure (Gmail not connected, action shape differs) returns [] so the agent
   * degrades to an honest "connect Gmail" message. Verify against a real account.
   */
  async getRecentEmails(externalUserId: string, limit = 25): Promise<import('./types.js').EmailMessage[]> {
    let pd: any;
    try {
      pd = await this.backend();
      const accts = await this.listAccounts(externalUserId, 'gmail');
      const account = accts.find((a) => a.healthy) ?? accts[0];
      if (!account) return [];
      const list = await pd.actions.list({ app: 'gmail', q: 'list emails', limit: 8 });
      const rows: any[] = list?.data ?? (Array.isArray(list) ? list : list?.items ?? []);
      const comp = rows.find((c) => /list|find|search|recent/i.test(`${c.name} ${c.key ?? c.id}`)) ?? rows[0];
      if (!comp) return [];
      const key = comp.key ?? comp.id;
      const props = comp.configurableProps ?? (await pd.actions.retrieve(key))?.data?.configurableProps ?? [];
      const configuredProps: Record<string, unknown> = {};
      const appProp = (props ?? []).find((p: any) => p?.type === 'app');
      if (appProp?.name) configuredProps[appProp.name] = { authProvisionId: account.id };
      const maxProp = (props ?? []).find((p: any) => /max|limit|count/i.test(`${p?.name} ${p?.label}`));
      if (maxProp?.name) configuredProps[maxProp.name] = limit;
      const res = await pd.actions.run({ externalUserId, id: key, configuredProps });
      const out = res?.ret ?? res?.exports ?? res ?? [];
      const msgs: any[] = Array.isArray(out) ? out : out?.messages ?? out?.emails ?? out?.data ?? [];
      return msgs.slice(0, limit).map((m: any) => ({
        from: m.from ?? m.From ?? m.sender ?? m?.payload?.headers?.find?.((h: any) => /^from$/i.test(h.name))?.value,
        subject: m.subject ?? m.Subject ?? m?.payload?.headers?.find?.((h: any) => /^subject$/i.test(h.name))?.value,
        snippet: m.snippet ?? m.bodyText ?? m.text ?? '',
        date: m.date ?? m.internalDate,
        unread: Array.isArray(m.labelIds) ? m.labelIds.includes('UNREAD') : undefined,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Resolve a plain-English task to a real component and run it. Discovers the
   * action for the app, attaches the user's connected account, maps the semantic
   * params onto the component's real props, and executes. All failures return a
   * friendly, actionable note rather than throwing.
   */
  async runAppTask(req: AppTaskRequest): Promise<AppTaskResult> {
    const summary = summarizeTask(req.app, req.query, req.params);
    const base = { app: req.app, output: null as unknown, summary };
    let pd: any;
    try {
      pd = await this.backend();
    } catch (err) {
      return { ok: false, actionId: `${req.app}-task`, ...base, note: String((err as Error).message) };
    }

    // 1) Must have a connected account for this app.
    let account: any;
    try {
      const accts = await this.listAccounts(req.externalUserId, req.app);
      account = accts.find((a) => a.healthy) ?? accts[0];
    } catch {
      /* fall through to the not-connected message */
    }
    if (!account) {
      return {
        ok: false,
        actionId: `${req.app}-task`,
        ...base,
        note: `No connected ${req.app} account yet — connect it in Integrations, then I can ${lower(summary)}.`,
      };
    }

    // 2) Discover the action component for this app.
    let comp: any;
    try {
      const list = await pd.actions.list({ app: req.app, q: req.query, limit: 10 });
      const rows: any[] = list?.data ?? (Array.isArray(list) ? list : list?.items ?? []);
      comp = pickComponent(rows, req.query);
    } catch (err) {
      return { ok: false, actionId: `${req.app}-task`, ...base, note: `Couldn't look up ${req.app} actions: ${String((err as Error).message)}` };
    }
    if (!comp) {
      return { ok: false, actionId: `${req.app}-task`, ...base, note: `${req.app} doesn't expose a “${req.query}” action I can run.` };
    }
    const key: string = comp.key ?? comp.id ?? comp.componentKey;

    // 3) Fetch the prop schema so we map onto real prop names.
    let props: any[] = comp.configurableProps ?? comp.configurable_props ?? [];
    if (!props.length) {
      try {
        const full = await pd.actions.retrieve(key);
        const data = full?.data ?? full;
        props = data?.configurableProps ?? data?.configurable_props ?? [];
      } catch {
        /* best effort — some components list their props inline */
      }
    }

    // 4) Build configuredProps: attach the account to the app prop, map params to the rest.
    const configuredProps = buildConfiguredProps(props, account.id, req.params);

    // 5) Run it.
    try {
      const res = await pd.actions.run({ externalUserId: req.externalUserId, id: key, configuredProps });
      const output = (res && (res.ret ?? res.exports ?? res)) ?? null;
      return { ok: true, actionId: key, componentKey: key, app: req.app, output, summary, note: `Done — ${lower(summary)}.` };
    } catch (err) {
      return { ok: false, actionId: key, componentKey: key, app: req.app, output: null, summary, note: `${req.app} rejected the run: ${String((err as Error).message)}` };
    }
  }

  // ── Live data reads ──────────────────────────────────────────────────────────
  // Each discovers a read component for the connected app, runs it on the user's
  // behalf, and maps common output shapes to our types. Best-effort: any failure
  // (app not connected, differing output shape) returns empty so the dashboard
  // degrades honestly. Field mapping should be verified against a real account.
  /**
   * List an app's action components broadly (no narrow text filter) and return
   * the raw rows. A long/specific `q` (e.g. "search report query campaign") makes
   * Pipedream's server-side search return zero matches even when the app has the
   * action — so we list wide and rank locally with pickComponent instead.
   */
  private async listComponents(app: string): Promise<any[]> {
    const pd = await this.backend();
    const out: any[] = [];
    let after: string | undefined;
    for (let page = 0; page < 3; page++) {
      const list = await pd.actions.list({ app, limit: 100, after });
      const rows: any[] = list?.data ?? (Array.isArray(list) ? list : list?.items ?? []);
      out.push(...rows);
      try {
        after = list?.hasNextPage?.() ? (list?.response?.pageInfo?.endCursor ?? list?.response?.page_info?.end_cursor) : undefined;
      } catch {
        after = undefined;
      }
      if (!after) break;
    }
    return out;
  }

  private async runRead(app: string, query: string, externalUserId: string, params: Record<string, string> = {}): Promise<unknown> {
    const pd = await this.backend();
    const accts = await this.listAccounts(externalUserId, app);
    const account = accts.find((a) => a.healthy) ?? accts[0];
    if (!account) return null;
    const rows = await this.listComponents(app);
    const comp = pickComponent(rows, query);
    if (!comp) return null;
    const key: string = comp.key ?? comp.id ?? comp.componentKey;
    let props: any[] = comp.configurableProps ?? comp.configurable_props ?? [];
    if (!props.length) {
      try {
        const full = await pd.actions.retrieve(key);
        const d = full?.data ?? full;
        props = d?.configurableProps ?? d?.configurable_props ?? [];
      } catch {
        /* some components inline their props */
      }
    }
    const configuredProps = buildConfiguredProps(props, account.id, params);
    const res = await pd.actions.run({ externalUserId, id: key, configuredProps });
    return res?.ret ?? res?.exports ?? res ?? null;
  }

  /** Fetch a component's configurable props (inline or via retrieve). */
  private async componentProps(comp: any, key: string): Promise<any[]> {
    let props: any[] = comp?.configurableProps ?? comp?.configurable_props ?? [];
    if (!props.length) {
      try {
        const full = await (await this.backend()).actions.retrieve(key);
        const d = full?.data ?? full;
        props = d?.configurableProps ?? d?.configurable_props ?? [];
      } catch {
        /* some components inline their props */
      }
    }
    return props ?? [];
  }

  /**
   * Discover the client (managed) Google Ads customer IDs reachable through the
   * connected login. Runs the account-listing components and pattern-extracts
   * 10-digit customer IDs from whatever shape comes back — so it works across a
   * plain account or an MCC (manager → clients) without hard-coding anything.
   */
  private async googleAdsCustomerIds(externalUserId: string, authId: string, rows: any[]): Promise<string[]> {
    const pd = await this.backend();
    const ids = new Set<string>();
    for (const key of ['google_ads-list-customer-clients', 'google_ads-list-account-id-options']) {
      const comp = rows.find((c) => (c.key ?? c.id ?? c.componentKey) === key);
      if (!comp) continue;
      try {
        const props = await this.componentProps(comp, key);
        const appName = props.find((p: any) => p?.type === 'app')?.name ?? 'googleAds';
        const res = await pd.actions.run({ externalUserId, id: key, configuredProps: { [appName]: { authProvisionId: authId } } });
        collectCustomerIds(res?.ret ?? res?.exports ?? res, ids);
      } catch {
        /* try the next lister */
      }
    }
    return [...ids];
  }

  /**
   * Google Ads spend via the structured `create-campaign-report` component.
   * The connected login is often an MCC manager, which can't report metrics
   * itself — so we resolve the client customer IDs and pull the report from each
   * account that actually runs ads. Field/metric names are GAQL-standard.
   */
  private async googleAdsSpend(externalUserId: string, range = 'LAST_30_DAYS'): Promise<import('../revenue/attribution.js').CampaignSpend[]> {
    const out: import('../revenue/attribution.js').CampaignSpend[] = [];
    const pd = await this.backend();
    const accts = await this.listAccounts(externalUserId, 'google_ads');
    const account = accts.find((a) => a.healthy) ?? accts[0];
    if (!account) return out;

    // Reuse cached discovery (component, client IDs, and the metric/field format
    // that Pipedream accepted) when fresh; only the report run happens per load.
    let key: string, appName: string, ids: string[], cachedShape: GadsShape | undefined;
    const cached = this.gadsCache.get(externalUserId);
    if (cached && Date.now() - cached.ts < PipedreamConnector.DISCOVERY_TTL_MS) {
      ({ key, appName, ids, shape: cachedShape } = cached);
    } else {
      const rows = await this.listComponents('google_ads');
      const comp = rows.find((c) => (c.key ?? c.id ?? c.componentKey) === 'google_ads-create-campaign-report') ?? pickComponent(rows, 'create campaign report');
      if (!comp) return out;
      key = comp.key ?? comp.id ?? comp.componentKey;
      const props = await this.componentProps(comp, key);
      appName = props.find((p: any) => p?.type === 'app')?.name ?? 'googleAds';
      ids = await this.googleAdsCustomerIds(externalUserId, account.id, rows);
      this.gadsCache.set(externalUserId, { key, appName, ids, ts: Date.now() });
    }
    // If we couldn't enumerate clients, still try once with no explicit account.
    const targets: (string | undefined)[] = ids.length ? ids : [undefined];
    // Self-healing: try the known metric/field formats until one returns rows,
    // then remember it so later loads use just that one. If a format is already
    // cached, try it alone first.
    const shapes = cachedShape ? [cachedShape, ...GADS_SHAPES.filter((s) => s.tag !== cachedShape.tag)] : GADS_SHAPES;
    for (const id of targets.slice(0, 8)) {
      for (const shape of shapes) {
        const configuredProps: Record<string, unknown> = { [appName]: { authProvisionId: account.id }, dateRange: range, fields: shape.fields, metrics: shape.metrics };
        if (id) configuredProps.accountId = id;
        let raw: unknown;
        try {
          const res = await pd.actions.run({ externalUserId, id: key, configuredProps });
          raw = res?.ret ?? res?.exports ?? res ?? null;
        } catch {
          continue; // bad account/format — try the next
        }
        const before = out.length;
        for (const r of asRows(raw)) {
          const name = r?.campaign?.name ?? r.campaignName ?? r.name ?? 'Google campaign';
          const spend = num(r?.metrics?.costMicros ?? r?.metrics?.cost_micros) / 1e6 || num(r.cost ?? r.spend);
          const clicks = num(r?.metrics?.clicks ?? r.clicks);
          const conv = num(r?.metrics?.conversions ?? r.conversions);
          if (spend || clicks || conv) out.push({ platform: 'google_ads', campaign: name, utm: '', spend: Math.round(spend), clicks, conversions: Math.round(conv) });
        }
        if (out.length > before) {
          const prev = this.gadsCache.get(externalUserId);
          if (prev) this.gadsCache.set(externalUserId, { ...prev, shape });
          return out; // found real data with this format — done
        }
      }
    }
    return out;
  }

  async getAdSpend(externalUserId: string, range = 'LAST_30_DAYS'): Promise<import('../revenue/attribution.js').CampaignSpend[]> {
    const out: import('../revenue/attribution.js').CampaignSpend[] = [];
    try {
      out.push(...(await this.googleAdsSpend(externalUserId, range)));
    } catch {
      /* Google Ads not connected or shape differs */
    }
    try {
      const f = await this.runRead('facebook', 'insights campaign spend', externalUserId, {});
      for (const r of asRows(f)) {
        const spend = num(r.spend ?? r.amount_spent);
        if (spend) out.push({ platform: 'facebook', campaign: r.campaign_name ?? r.name ?? 'Meta campaign', utm: '', spend: Math.round(spend), clicks: num(r.clicks), conversions: num(r.conversions ?? r.actions) });
      }
    } catch {
      /* Meta not connected */
    }
    return out;
  }

  /**
   * Run one Google Ads write component, mapping our semantic values onto whatever
   * prop names the component exposes (schema-adaptive, like the read path), then
   * extract the created resource name. Returns a structured, honest result.
   */
  private async writeComponent(externalUserId: string, componentKey: string, authId: string, values: Record<string, string[]>, direct: Record<string, unknown> = {}): Promise<{ ok: boolean; resource?: string; error?: string }> {
    try {
      const pd = await this.backend();
      const rows = await this.listComponents('google_ads');
      const comp = rows.find((c) => (c.key ?? c.id ?? c.componentKey) === componentKey);
      if (!comp) return { ok: false, error: `component ${componentKey} not found on this account` };
      const key = comp.key ?? comp.id ?? comp.componentKey;
      const props = await this.componentProps(comp, key);
      const appName = props.find((p: any) => p?.type === 'app')?.name ?? 'googleAds';
      const configured: Record<string, unknown> = { [appName]: { authProvisionId: authId }, ...direct };
      const used = new Set<string>(Object.keys(configured));
      // Map each semantic value onto the first matching, unused prop.
      for (const [, keywords] of Object.entries(values)) {
        const val = keywords[0];
        const kws = keywords.slice(1);
        const hit = props.find((p: any) => p && p.type !== 'app' && p.name && !used.has(p.name) && kws.some((kw) => `${p.label ?? ''} ${p.name}`.toLowerCase().includes(kw)));
        if (hit) { configured[hit.name] = val; used.add(hit.name); }
      }
      const res = await pd.actions.run({ externalUserId, id: key, configuredProps: configured });
      const raw = res?.ret ?? res?.exports ?? res ?? null;
      return { ok: true, resource: extractResourceName(raw) };
    } catch (e) {
      return { ok: false, error: String((e as Error).message) };
    }
  }

  async launchCampaign(externalUserId: string, spec: import('../agents/campaign.js').CampaignSpec): Promise<import('./types.js').CampaignLaunchResult> {
    const steps: import('./types.js').CampaignLaunchStep[] = [];
    const accts = await this.listAccounts(externalUserId, 'google_ads');
    const account = accts.find((a) => a.healthy) ?? accts[0];
    if (!account) return { ok: false, live: true, steps: [{ step: 'Google Ads account', ok: false, error: 'No connected Google Ads account.' }], note: 'Connect Google Ads first.' };
    const rows = await this.listComponents('google_ads');
    const ids = await this.googleAdsCustomerIds(externalUserId, account.id, rows);
    const customerId = ids[0]; // the client account that runs ads
    const cust = customerId ? [customerId, 'account', 'customer'] : undefined;

    // 1) Budget — Google Ads amounts are in micros ($1 = 1_000_000).
    const micros = String(Math.round(spec.dailyBudget * 1_000_000));
    const budget = await this.writeComponent(externalUserId, 'google_ads-create-or-update-campaign-budget', account.id, {
      ...(cust ? { customer: cust } : {}),
      name: [`${spec.name} Budget`, 'name'],
      amount: [micros, 'amount', 'micros', 'budget'],
    });
    steps.push({ step: `Create daily budget ($${spec.dailyBudget})`, ok: budget.ok, resource: budget.resource, error: budget.error });

    // 2) Campaign — attach budget, set status (PAUSED unless owner chose ENABLED).
    const campaign = await this.writeComponent(externalUserId, 'google_ads-create-or-update-campaign', account.id, {
      ...(cust ? { customer: cust } : {}),
      name: [spec.name, 'campaign name', 'name'],
      status: [spec.status, 'status'],
      ...(budget.resource ? { budget: [budget.resource, 'budget', 'campaign budget'] } : {}),
    });
    steps.push({ step: `Create campaign "${spec.name}" (${spec.status})`, ok: campaign.ok, resource: campaign.resource, error: campaign.error });

    // 3) Ad groups + keywords + RSA — only if the campaign resource resolved.
    if (campaign.resource) {
      for (const g of spec.adGroups) {
        const ag = await this.writeComponent(externalUserId, 'google_ads-create-or-update-ad-group', account.id, {
          ...(cust ? { customer: cust } : {}),
          name: [g.name, 'ad group name', 'name'],
          campaign: [campaign.resource, 'campaign'],
        });
        steps.push({ step: `Create ad group "${g.name}"`, ok: ag.ok, resource: ag.resource, error: ag.error });
        if (!ag.resource) continue;
        const kw = await this.writeComponent(externalUserId, 'google_ads-create-or-update-keywords', account.id, {
          ...(cust ? { customer: cust } : {}),
          adGroup: [ag.resource, 'ad group', 'adgroup'],
        }, { keywords: g.keywords.map((k) => ({ text: k.text, matchType: k.match.toUpperCase() })) });
        steps.push({ step: `Add ${g.keywords.length} keywords to "${g.name}"`, ok: kw.ok, error: kw.error });
        const rsa = await this.writeComponent(externalUserId, 'google_ads-create-responsive-search-ad', account.id, {
          ...(cust ? { customer: cust } : {}),
          adGroup: [ag.resource, 'ad group', 'adgroup'],
          url: [spec.finalUrl, 'final url', 'url', 'landing'],
        }, { headlines: g.rsa.headlines, descriptions: g.rsa.descriptions });
        steps.push({ step: `Create responsive search ad in "${g.name}"`, ok: rsa.ok, error: rsa.error });
      }
    }

    const ok = steps.every((s) => s.ok);
    const link = campaign.resource && customerId ? `https://ads.google.com/aw/campaigns?ocid=&campaignId=${(campaign.resource.match(/campaigns\/(\d+)/) || [])[1] ?? ''}` : undefined;
    return { ok, live: true, campaignResource: campaign.resource, link, steps, note: ok ? `Campaign created ${spec.status}. Review it in Google Ads before enabling.` : 'Some steps failed — see the per-step errors. Nothing partial charges until the campaign is enabled.' };
  }

  async getSocialMetrics(externalUserId: string): Promise<import('./types.js').SocialMetrics | null> {
    for (const app of ['facebook', 'instagram', 'linkedin']) {
      try {
        const d = await this.runRead(app, 'page insights metrics followers', externalUserId, {});
        const r = asRows(d)[0] ?? (d as Record<string, unknown>);
        if (!r) continue;
        const impressions = num((r as any).impressions ?? (r as any).reach ?? (r as any).page_impressions);
        const clicks = num((r as any).clicks ?? (r as any).link_clicks ?? (r as any).website_clicks);
        const likes = num((r as any).likes ?? (r as any).reactions ?? (r as any).engagement);
        const followers = num((r as any).followers ?? (r as any).fan_count ?? (r as any).followers_count);
        if (impressions || clicks || likes || followers) return { impressions, clicks, likes, followers };
      } catch {
        /* not connected */
      }
    }
    return null;
  }

  async getReviews(externalUserId: string): Promise<import('./types.js').Review[]> {
    try {
      const d = await this.runRead('google_my_business', 'list reviews', externalUserId, {});
      return asRows(d)
        .map((r) => ({ author: r?.reviewer?.displayName ?? r.author ?? 'A customer', rating: starToNum(r.starRating ?? r.rating), text: r.comment ?? r.text ?? '', platform: 'Google' }))
        .filter((r) => r.rating > 0);
    } catch {
      return [];
    }
  }

  // Diagnostic — run the raw read for an app and report exactly what came back,
  // stage by stage, so we can see WHERE a live pull fails: no account, no
  // component matched, required props (e.g. Google Ads customerId) left unset,
  // the raw response, or a run error. Read-only; never mutates anything.
  async probe(externalUserId: string, app: string, query?: string): Promise<{ connected: boolean; count: number; sample: unknown; error?: string; trace?: Record<string, unknown> }> {
    const trace: Record<string, unknown> = { app };
    try {
      const pd = await this.backend();
      const accts = await this.listAccounts(externalUserId, app);
      trace.accounts = accts.map((a) => ({ id: a.id, app: a.app, name: a.name, healthy: a.healthy }));
      if (!accts.length) return { connected: false, count: 0, sample: null, trace };
      const account = accts.find((a) => a.healthy) ?? accts[0];

      const gaql = app === 'google_ads' ? 'SELECT campaign.name, metrics.cost_micros, metrics.clicks, metrics.conversions FROM campaign WHERE segments.date DURING LAST_30_DAYS' : undefined;
      const q = query || (app === 'google_ads' ? 'search report query campaign' : app.includes('facebook') || app.includes('instagram') || app.includes('linkedin') ? 'insights metrics' : app === 'google_my_business' ? 'list reviews' : 'list contacts');
      trace.query = q;
      if (gaql) trace.gaql = gaql;

      // Stage: component discovery — list the app's actions broadly (no narrow
      // filter) and show the full menu + which one we pick. This reveals whether
      // the app even exposes a readable/report action on Pipedream.
      const rows = await this.listComponents(app);
      trace.availableComponents = rows.map((c) => c.key ?? c.id ?? c.componentKey ?? c.name);
      trace.availableComponentCount = rows.length;

      // Google Ads deep-dive: dump the exact prop schemas (with option values) of
      // the report components and actually run the account-id lister, so we can
      // wire the real read against real shapes instead of guessing enum strings.
      if (app === 'google_ads') {
        const detail = async (k: string) => {
          const c = rows.find((r) => (r.key ?? r.id ?? r.componentKey) === k);
          let p: any[] = c?.configurableProps ?? c?.configurable_props ?? [];
          if (!p.length) { try { const f = await pd.actions.retrieve(k); p = (f?.data ?? f)?.configurableProps ?? (f?.data ?? f)?.configurable_props ?? []; } catch { /* inline */ } }
          return (p ?? []).map((x: any) => ({ name: x?.name, label: x?.label, type: x?.type, optional: x?.optional, options: Array.isArray(x?.options) ? x.options.slice(0, 12) : undefined }));
        };
        const deep: Record<string, unknown> = {};
        try { deep.createReportProps = await detail('google_ads-create-report'); } catch (e) { deep.createReportPropsError = String((e as Error).message); }
        try { deep.createCampaignReportProps = await detail('google_ads-create-campaign-report'); } catch (e) { deep.createCampaignReportPropsError = String((e as Error).message); }
        try {
          const optProps = await detail('google_ads-list-account-id-options');
          const cp = buildConfiguredProps((optProps as any[]).map((x) => ({ name: x.name, type: x.type })), account?.id ?? '', {});
          const r = await pd.actions.run({ externalUserId, id: 'google_ads-list-account-id-options', configuredProps: cp });
          deep.accountIdOptions = r?.ret ?? r?.exports ?? r ?? null;
        } catch (e) { deep.accountIdOptionsError = String((e as Error).message); }

        // Actively RUN the report against each resolved account with each metric/
        // field format, and record exactly what each returns or errors with — this
        // is the one signal getAdSpend swallows, and it tells us which format works.
        try {
          const rc = rows.find((r) => (r.key ?? r.id ?? r.componentKey) === 'google_ads-create-campaign-report');
          const rkey = rc ? (rc.key ?? rc.id ?? rc.componentKey) : 'google_ads-create-campaign-report';
          const rprops = await this.componentProps(rc ?? {}, rkey);
          const appName = rprops.find((p: any) => p?.type === 'app')?.name ?? 'googleAds';
          const ids = await this.googleAdsCustomerIds(externalUserId, account?.id ?? '', rows);
          deep.resolvedCustomerIds = ids;
          const trials: any[] = [];
          let runs = 0;
          outer: for (const id of (ids.length ? ids : [undefined]).slice(0, 3)) {
            for (const shape of GADS_SHAPES) {
              if (runs++ >= 9) break outer;
              const cp: Record<string, unknown> = { [appName]: { authProvisionId: account?.id }, dateRange: 'LAST_30_DAYS', fields: shape.fields, metrics: shape.metrics };
              if (id) cp.accountId = id;
              try {
                const r = await pd.actions.run({ externalUserId, id: rkey, configuredProps: cp });
                const raw = r?.ret ?? r?.exports ?? r ?? null;
                const arr = asRows(raw);
                trials.push({ accountId: id, format: shape.tag, count: arr.length, sample: arr[0] ?? (raw && typeof raw === 'object' && !Array.isArray(raw) ? Object.keys(raw as any) : raw) });
                if (arr.length) break outer; // found a working combo — stop
              } catch (e) {
                trials.push({ accountId: id, format: shape.tag, error: String((e as Error).message) });
              }
            }
          }
          deep.reportTrials = trials;
        } catch (e) { deep.reportTrialsError = String((e as Error).message); }
        trace.googleAdsDeepDive = deep;
      }

      const comp = pickComponent(rows, q);
      if (!comp) return { connected: true, count: 0, sample: null, trace, error: rows.length ? 'none of the app’s actions matched the query' : 'this app exposes no action components on Pipedream (reads may need a custom API-request action or a trigger)' };
      const key: string = comp.key ?? comp.id ?? comp.componentKey;
      trace.pickedComponent = key;

      // Stage: prop schema — reveal which props exist (so we can see if the
      // component wants a customerId / loginCustomerId / query prop we never set).
      let props: any[] = comp.configurableProps ?? comp.configurable_props ?? [];
      if (!props.length) {
        try {
          const full = await pd.actions.retrieve(key);
          const d = full?.data ?? full;
          props = d?.configurableProps ?? d?.configurable_props ?? [];
        } catch {
          /* some components inline their props */
        }
      }
      trace.componentProps = (props ?? []).map((p: any) => ({ name: p?.name, label: p?.label, type: p?.type, optional: p?.optional }));

      // Stage: what we actually send — this is where a missing customerId shows up.
      const configuredProps = buildConfiguredProps(props, account?.id ?? '', gaql ? { query: gaql } : {});
      trace.configuredPropsSent = Object.keys(configuredProps);
      const requiredUnset = (props ?? [])
        .filter((p: any) => p && p.type !== 'app' && p.optional === false && !(p.name in configuredProps))
        .map((p: any) => p.name);
      trace.requiredPropsLeftUnset = requiredUnset;

      // Stage: run + raw response.
      const res = await pd.actions.run({ externalUserId, id: key, configuredProps });
      const raw = res?.ret ?? res?.exports ?? res ?? null;
      const rows2 = asRows(raw);
      trace.rawResponseKeys = raw && typeof raw === 'object' && !Array.isArray(raw) ? Object.keys(raw as Record<string, unknown>) : Array.isArray(raw) ? `array(${raw.length})` : typeof raw;
      return { connected: true, count: rows2.length, sample: rows2[0] ?? raw ?? null, trace };
    } catch (e) {
      return { connected: true, count: 0, sample: null, error: String((e as Error).message), trace };
    }
  }

  async getLeads(externalUserId: string): Promise<import('./types.js').Lead[]> {
    for (const app of ['gohighlevel', 'hubspot', 'salesforce_rest_api', 'servicetitan', 'jobber', 'housecall_pro']) {
      try {
        const accts = await this.listAccounts(externalUserId, app);
        if (!accts.length) continue;
        const d = await this.runRead(app, 'list contacts leads', externalUserId, {});
        const rows = asRows(d);
        if (rows.length)
          return rows.slice(0, 50).map((r) => ({
            id: str(r.id ?? r.contactId),
            name: r.name ?? [r.firstName, r.lastName].filter(Boolean).join(' ') ?? r.contactName,
            service: r.service ?? (Array.isArray(r.tags) ? r.tags[0] : undefined),
            source: r.source ?? app,
            phone: str(r.phone),
            email: str(r.email),
            createdAt: str(r.dateAdded ?? r.createdAt),
            contacted: !!(r.lastContacted ?? r.contacted),
          }));
      } catch {
        /* try the next CRM */
      }
    }
    return [];
  }
}

const lower = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/** Deep-scan a create-response for the Google Ads resource name it returned. */
function extractResourceName(v: unknown, depth = 0): string | undefined {
  if (v == null || depth > 6) return undefined;
  if (typeof v === 'string') return /customers\/\d+\/\w+\/[\w~]+/.test(v) ? v : undefined;
  if (Array.isArray(v)) { for (const x of v) { const r = extractResourceName(x, depth + 1); if (r) return r; } return undefined; }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    for (const k of ['resourceName', 'resource_name', 'results', 'result', 'data']) {
      if (k in o) { const r = extractResourceName(o[k], depth + 1); if (r) return r; }
    }
    for (const x of Object.values(o)) { const r = extractResourceName(x, depth + 1); if (r) return r; }
  }
  return undefined;
}

/** A candidate metric/field naming format for the Google Ads report component. */
type GadsShape = { tag: string; fields: string[]; metrics: string[] };
/** Formats Pipedream's create-campaign-report might expect, most-likely first.
 *  googleAdsSpend tries these until one returns rows, then caches the winner. */
const GADS_SHAPES: GadsShape[] = [
  { tag: 'qualified', fields: ['campaign.name'], metrics: ['metrics.cost_micros', 'metrics.clicks', 'metrics.conversions'] },
  { tag: 'short', fields: ['campaign.name'], metrics: ['cost_micros', 'clicks', 'conversions'] },
  { tag: 'bare', fields: ['name'], metrics: ['cost', 'clicks', 'conversions'] },
  { tag: 'cost', fields: ['campaign.name'], metrics: ['metrics.cost', 'metrics.clicks', 'metrics.conversions'] },
];

/**
 * Deep-walk an arbitrary Pipedream response and collect Google Ads customer IDs
 * — 10-digit numbers, however they're shaped: a bare "4347015374", a dashed
 * "434-701-5374", a { value } option, or a "customers/4347015374" resource name.
 */
function collectCustomerIds(v: unknown, into: Set<string>, depth = 0): void {
  if (v == null || depth > 6) return;
  if (typeof v === 'number') {
    const s = String(v);
    if (/^\d{10}$/.test(s)) into.add(s);
    return;
  }
  if (typeof v === 'string') {
    const m = v.match(/customers\/(\d{10})/);
    if (m?.[1]) into.add(m[1]);
    const digits = v.replace(/[^\d]/g, '');
    if (/^\d{10}$/.test(digits)) into.add(digits);
    return;
  }
  if (Array.isArray(v)) {
    for (const x of v) collectCustomerIds(x, into, depth + 1);
    return;
  }
  if (typeof v === 'object') {
    for (const x of Object.values(v as Record<string, unknown>)) collectCustomerIds(x, into, depth + 1);
  }
}
const asRows = (out: unknown): any[] => {
  if (!out) return [];
  if (Array.isArray(out)) return out;
  const o = out as Record<string, unknown>;
  const c = o.results ?? o.data ?? o.rows ?? o.items ?? o.reviews ?? o.contacts ?? o.records ?? o.campaigns;
  return Array.isArray(c) ? c : [];
};
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string | undefined => (v == null ? undefined : String(v));
const starToNum = (s: unknown): number => {
  if (typeof s === 'number') return s;
  const m: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
  return m[String(s).toUpperCase()] ?? num(s);
};

/** Pick the component whose name best matches the query (prefer create/add verbs). */
function pickComponent(rows: any[], query: string): any {
  if (!rows?.length) return undefined;
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const score = (c: any) => {
    const n = `${c.name ?? ''} ${c.key ?? c.id ?? ''}`.toLowerCase();
    let s = 0;
    for (const w of words) if (n.includes(w)) s += 2;
    if (/\b(create|add|new)\b/.test(n)) s += 1;
    return s;
  };
  return [...rows].sort((a, b) => score(b) - score(a))[0];
}

/** Attach the connected account to the app prop, then map semantic params to props. */
function buildConfiguredProps(props: any[], accountId: string, params: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const used = new Set<string>();
  const appProp = (props ?? []).find((p) => p?.type === 'app');
  if (appProp?.name) {
    out[appProp.name] = { authProvisionId: accountId };
    used.add(appProp.name);
  }
  const candidates = (props ?? []).filter((p) => p && p.type !== 'app' && p.name);
  const nameOf = (p: any) => `${p.label ?? ''} ${p.name ?? ''}`.toLowerCase();
  for (const [semantic, value] of Object.entries(params)) {
    if (value == null || value === '') continue;
    const keywords = PARAM_KEYWORDS[semantic] ?? [semantic.toLowerCase()];
    let hit: any;
    for (const kw of keywords) {
      hit = candidates.find((p) => !used.has(p.name) && nameOf(p).includes(kw));
      if (hit) break;
    }
    if (hit) {
      out[hit.name] = value;
      used.add(hit.name);
    }
  }
  return out;
}
