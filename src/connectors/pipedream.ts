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
  private gadsCache = new Map<string, { key: string; appName: string; ids: string[]; targets?: { login: string; client?: string }[]; shape?: GadsShape; ts: number }>();
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

    // 2) Discover the action component for this app. A long/specific query makes
    //    Pipedream's server-side search return zero rows even when the action
    //    exists, so fall back to a broad listing and rank locally. Also seed the
    //    query with a canonical hint (e.g. "send sms") so scoring lands right.
    let comp: any;
    try {
      const list = await pd.actions.list({ app: req.app, q: req.query, limit: 10 });
      let rows: any[] = list?.data ?? (Array.isArray(list) ? list : list?.items ?? []);
      if (!rows.length) rows = await this.listComponents(req.app); // broad fallback
      comp = pickComponent(rows, canonicalVerb(req.query));
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
   * Resolve Google Ads report targets as {login, client} pairs. A plain account
   * reports on itself (login only). An MCC manager account runs no ads itself —
   * its campaigns live in client accounts — so we descend one level: list the
   * login accounts (the manager), then for each run list-customer-clients WITH
   * that manager set as the account, and report as accountId=manager +
   * customerClientId=client. This is the fix for "manager resolved, 0 rows".
   */
  private async resolveGadsTargets(externalUserId: string, authId: string, rows: any[]): Promise<{ login: string; client?: string }[]> {
    const pd = await this.backend();
    const runList = async (key: string, extra: Record<string, unknown> = {}): Promise<Set<string>> => {
      const found = new Set<string>();
      const comp = rows.find((c) => (c.key ?? c.id ?? c.componentKey) === key);
      if (!comp) return found;
      try {
        const props = await this.componentProps(comp, key);
        const appName = props.find((p: any) => p?.type === 'app')?.name ?? 'googleAds';
        const cp: Record<string, unknown> = { [appName]: { authProvisionId: authId } };
        // Only send props the component actually exposes (e.g. accountId).
        for (const [k, v] of Object.entries(extra)) if (props.some((p: any) => p?.name === k)) cp[k] = v;
        const res = await pd.actions.run({ externalUserId, id: key, configuredProps: cp });
        collectCustomerIds(res?.ret ?? res?.exports ?? res, found);
      } catch {
        /* skip */
      }
      return found;
    };
    // 1) The login accounts the connected user can act as (for an MCC, the manager).
    const logins = await runList('google_ads-list-account-id-options');
    if (!logins.size) for (const x of await runList('google_ads-list-customer-clients')) logins.add(x);
    // 2) For each login, list the client accounts underneath it.
    const targets: { login: string; client?: string }[] = [];
    for (const login of [...logins].slice(0, 5)) {
      const clients = await runList('google_ads-list-customer-clients', { accountId: login, customerClientId: login });
      clients.delete(login); // the manager itself runs no ads
      if (clients.size) for (const client of clients) targets.push({ login, client });
      else targets.push({ login });
    }
    return targets;
  }

  /** Leaf client customer IDs (the accounts that actually run ads). */
  private async googleAdsCustomerIds(externalUserId: string, authId: string, rows: any[]): Promise<string[]> {
    const targets = await this.resolveGadsTargets(externalUserId, authId, rows);
    return [...new Set(targets.map((t) => t.client ?? t.login))];
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

    // Reuse cached discovery (component, {login,client} targets, and the metric/
    // field format Pipedream accepted) when fresh; only the report run per load.
    let key: string, appName: string, targets: { login: string; client?: string }[], cachedShape: GadsShape | undefined;
    const cached = this.gadsCache.get(externalUserId);
    if (cached && cached.targets && Date.now() - cached.ts < PipedreamConnector.DISCOVERY_TTL_MS) {
      ({ key, appName, targets, shape: cachedShape } = cached as typeof cached & { targets: { login: string; client?: string }[] });
    } else {
      const rows = await this.listComponents('google_ads');
      const comp = rows.find((c) => (c.key ?? c.id ?? c.componentKey) === 'google_ads-create-campaign-report') ?? pickComponent(rows, 'create campaign report');
      if (!comp) return out;
      key = comp.key ?? comp.id ?? comp.componentKey;
      const props = await this.componentProps(comp, key);
      appName = props.find((p: any) => p?.type === 'app')?.name ?? 'googleAds';
      targets = await this.resolveGadsTargets(externalUserId, account.id, rows);
      if (!targets.length) targets = [{ login: '' }];
      this.gadsCache.set(externalUserId, { key, appName, ids: targets.map((t) => t.client ?? t.login), targets, ts: Date.now() });
    }
    // Self-healing: try the known metric/field formats until one returns rows,
    // then remember it so later loads use just that one. If a format is already
    // cached, try it alone first.
    const shapes = cachedShape ? [cachedShape, ...GADS_SHAPES.filter((s) => s.tag !== cachedShape.tag)] : GADS_SHAPES;
    for (const t of targets.slice(0, 8)) {
      for (const shape of shapes) {
        const configuredProps: Record<string, unknown> = { [appName]: { authProvisionId: account.id }, dateRange: range, fields: shape.fields, metrics: shape.metrics };
        if (t.login) configuredProps.accountId = t.login; // report "as" the login/manager
        if (t.client) configuredProps.customerClientId = t.client; // the client that runs ads
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
  private async writeComponent(externalUserId: string, componentKey: string, authId: string, values: Record<string, string[]>, direct: Record<string, unknown> = {}): Promise<{ ok: boolean; resource?: string; error?: string; detail?: string }> {
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
      // Map each semantic value onto a prop by trying its keywords in PRIORITY
      // order — the first (most specific) keyword that matches any unused prop
      // wins. (Matching "any keyword" let a loose word like "budget" grab
      // campaignBudgetId instead of amountMicros.) Values that find no prop yet
      // stay in `remaining` — dynamic props may expose their field later.
      const remaining = new Map(Object.entries(values));
      const mapOnto = (ps: any[]) => {
        for (const [vkey, keywords] of [...remaining]) {
          const val = keywords[0];
          let hit: any;
          for (const kw of keywords.slice(1)) {
            hit = ps.find((p: any) => p && p.type !== 'app' && p.name && !used.has(p.name) && `${p.label ?? ''} ${p.name}`.toLowerCase().includes(kw));
            if (hit) break;
          }
          if (hit) { configured[hit.name] = val; used.add(hit.name); remaining.delete(vkey); }
        }
      };
      mapOnto(props);
      // Dynamic props: components flagged with reloadProps rebuild their prop
      // list from the values configured so far. Pipedream only honors the
      // configured fields when the run carries the dynamicPropsId from that
      // reload — without it the action runs against the STATIC prop shape and
      // silently ignores the rest, which surfaces as an empty {} "success".
      let dynamicPropsId: string | undefined;
      let curProps: any[] = props;
      for (let i = 0; i < 3 && curProps.some((p: any) => p?.reloadProps || p?.remoteOptions); i++) {
        try {
          const rl: any = await (pd as any).components.reloadProps({
            id: key,
            externalUserId,
            configuredProps: configured as any,
            ...(dynamicPropsId ? { dynamicPropsId } : {}),
          });
          const dyn = rl?.dynamicProps ?? rl?.data?.dynamicProps;
          dynamicPropsId = dyn?.id ?? dynamicPropsId;
          const next: any[] = dyn?.configurableProps ?? [];
          if (!next.length) break;
          const before = used.size;
          mapOnto(next);
          curProps = next;
          if (used.size === before || !remaining.size) break; // stable — stop reloading
        } catch {
          break; // component has no dynamic props endpoint — run as-is
        }
      }
      const res = await pd.actions.run({ externalUserId, id: key, configuredProps: configured, ...(dynamicPropsId ? { dynamicPropsId } : {}) });
      const raw = res?.ret ?? res?.exports ?? res ?? null;
      const resource = extractResourceName(raw);
      // Real failures often hide in the run's observation log, not the return
      // value — pull any error entries out so "{}" stops masquerading as fine.
      const osErrors = ((res as any)?.os ?? [])
        .map((o: any) => o?.err ? `${o.err.name ?? 'Error'}: ${o.err.message ?? ''}`.trim() : /err/i.test(o?.k ?? '') ? o?.msg : undefined)
        .filter(Boolean) as string[];
      // Keep ok:true (some writes, e.g. keywords, don't return a single resource),
      // but when no resource comes back, capture WHAT we sent + WHAT Google/
      // Pipedream logged, so an empty {} response is diagnosable at a glance.
      const sent = Object.keys(configured).filter((k) => k !== appName);
      const detail = resource
        ? undefined
        : osErrors.length
          ? `Google rejected it: ${osErrors.join(' · ').slice(0, 400)}`
          : `sent[${sent.join(', ') || 'nothing but auth'}] · resp ${JSON.stringify(raw ?? null).slice(0, 300)}`;
      return { ok: !osErrors.length, resource, error: osErrors.length ? osErrors.join(' · ').slice(0, 400) : undefined, detail };
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
    // MCC-aware: write "as" the login/manager (accountId) but INTO the client
    // account that runs ads (customerClientId) — same split the report needs.
    const targets = await this.resolveGadsTargets(externalUserId, account.id, rows);
    const target = targets[0];
    const customerId = target?.client ?? target?.login;
    const acctVals: Record<string, string[]> = {};
    if (target?.login) acctVals.loginAccount = [target.login, 'use google ads as', 'use google ads', 'accountid'];
    if (target?.client) acctVals.managedAccount = [target.client, 'managed account', 'customer client', 'customerclient'];

    const op = ['CREATE', 'operationtype', 'operation type', 'operation'];
    // 1) Budget — Google Ads amounts are in micros ($1 = 1_000_000). Budget
    // names must be UNIQUE across the account (Google rejects a re-launch with
    // DUPLICATE_NAME), so stamp each launch's budget with the launch time.
    const micros = String(Math.round(spec.dailyBudget * 1_000_000));
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const budget = await this.writeComponent(externalUserId, 'google_ads-create-or-update-campaign-budget', account.id, {
      ...acctVals,
      operationType: op,
      name: [`${spec.name} Budget ${stamp}`, 'name'],
      amount: [micros, 'amountmicros', 'amount micros', 'micros', 'amount'], // NOT "budget" — that grabs campaignBudgetId
      delivery: ['STANDARD', 'deliverymethod', 'delivery method'],
    });
    steps.push({ step: `Create daily budget ($${spec.dailyBudget})`, ok: budget.ok && !!budget.resource, resource: budget.resource, error: budget.error || (!budget.resource ? `no budget resource returned — Google said: ${budget.detail ?? '(empty)'}` : undefined) });

    // 2) Campaign — REQUIRES advertisingChannelType (SEARCH) and an attached
    // budget (Google errors with REQUIRED without one), so don't even attempt
    // the create when the budget step failed. Google's biddingStrategyType is
    // a strict enum: "Maximize Clicks" is TARGET_SPEND, NOT "MAXIMIZE_CLICKS".
    const biddingEnum = spec.biddingStrategy === 'MAXIMIZE_CLICKS' ? 'TARGET_SPEND' : spec.biddingStrategy;
    const campaign = budget.resource
      ? await this.writeComponent(externalUserId, 'google_ads-create-or-update-campaign', account.id, {
          ...acctVals,
          operationType: op,
          name: [spec.name, 'campaign name', 'name'],
          channelType: ['SEARCH', 'advertisingchanneltype', 'channel type', 'channel'],
          biddingType: [biddingEnum, 'biddingstrategytype', 'bidding strategy type'],
          status: [spec.status, 'status'],
          campaignBudget: [budget.resource, 'campaignbudget', 'campaign budget'],
        })
      : { ok: false as const, resource: undefined, error: 'Skipped — Google requires a budget on every campaign and the budget step failed above.', detail: undefined };
    steps.push({ step: `Create campaign "${spec.name}" (${spec.status})`, ok: campaign.ok && !!campaign.resource, resource: campaign.resource, error: campaign.error || (!campaign.resource ? `no campaign resource returned — Google said: ${campaign.detail ?? '(empty)'}` : undefined) });

    // 3) Ad groups + keywords + RSA — only if the campaign resource resolved.
    if (campaign.resource) {
      for (const g of spec.adGroups) {
        const ag = await this.writeComponent(externalUserId, 'google_ads-create-or-update-ad-group', account.id, {
          ...acctVals,
          operationType: op,
          name: [g.name, 'ad group name', 'name'],
          campaign: [campaign.resource, 'campaign'],
        });
        steps.push({ step: `Create ad group "${g.name}"`, ok: ag.ok && !!ag.resource, resource: ag.resource, error: ag.error || (!ag.resource ? `no ad group resource — Google said: ${ag.detail ?? '(empty)'}` : undefined) });
        if (!ag.resource) continue;
        const kw = await this.writeComponent(externalUserId, 'google_ads-create-or-update-keywords', account.id, {
          ...acctVals,
          operationType: op,
          adGroup: [ag.resource, 'ad group', 'adgroup'],
        }, { keywords: g.keywords.map((k) => ({ text: k.text, matchType: k.match.toUpperCase() })) });
        steps.push({ step: `Add ${g.keywords.length} keywords to "${g.name}"`, ok: kw.ok, error: kw.error });
        const rsa = await this.writeComponent(externalUserId, 'google_ads-create-responsive-search-ad', account.id, {
          ...acctVals,
          operationType: op,
          adGroup: [ag.resource, 'ad group', 'adgroup'],
          url: [spec.finalUrl, 'final url', 'url', 'landing'],
        }, { headlines: g.rsa.headlines, descriptions: g.rsa.descriptions });
        steps.push({ step: `Create responsive search ad in "${g.name}"`, ok: rsa.ok, error: rsa.error });
      }
    }

    // Honest success: a campaign with no ads can't serve, so require the campaign
    // itself AND at least one ad group + responsive search ad to have been created.
    const campaignCreated = !!campaign.resource;
    const adGroupCreated = steps.some((s) => /Create ad group/i.test(s.step) && s.ok);
    const rsaCreated = steps.some((s) => /responsive search ad/i.test(s.step) && s.ok);

    // Verify the campaign actually exists in the account — never trust "no error".
    let verifyAttempted = false;
    let verified = false;
    if (campaignCreated) {
      try {
        const pd = await this.backend();
        const listComp = rows.find((c) => (c.key ?? c.id ?? c.componentKey) === 'google_ads-list-campaigns');
        if (listComp) {
          verifyAttempted = true;
          const lkey = listComp.key ?? listComp.id ?? listComp.componentKey;
          const lprops = await this.componentProps(listComp, lkey);
          const lapp = lprops.find((p: any) => p?.type === 'app')?.name ?? 'googleAds';
          const cp: Record<string, unknown> = { [lapp]: { authProvisionId: account.id } };
          for (const vals of Object.values(acctVals)) {
            const id = vals[0]; const kws = vals.slice(1);
            const prop = lprops.find((p: any) => p?.name && kws.some((kw) => `${p.label ?? ''} ${p.name}`.toLowerCase().includes(kw)));
            if (prop && id) cp[prop.name] = id;
          }
          const res = await pd.actions.run({ externalUserId, id: lkey, configuredProps: cp });
          const blob = JSON.stringify(res?.ret ?? res?.exports ?? res ?? '');
          verified = blob.includes(spec.name) || (!!campaign.resource && blob.includes(campaign.resource.split('/').pop() ?? ' '));
        }
      } catch {
        /* verification unavailable — reported below */
      }
      steps.push({ step: 'Verify campaign in Google Ads', ok: verifyAttempted ? verified : true, error: verifyAttempted && !verified ? 'Not found in your account — treat as NOT launched.' : verifyAttempted ? undefined : 'Could not independently verify (verification unavailable).' });
    }

    const structureOk = campaignCreated && adGroupCreated && rsaCreated;
    const ok = structureOk && (verifyAttempted ? verified : true);
    const link = campaign.resource && customerId ? `https://ads.google.com/aw/campaigns?ocid=&campaignId=${(campaign.resource.match(/campaigns\/(\d+)/) || [])[1] ?? ''}` : undefined;
    const note = !campaignCreated
      ? 'The campaign was NOT created in Google Ads — see the per-step errors. Nothing was charged.'
      : verifyAttempted && !verified
        ? 'Miles could not find this campaign in your Google Ads account afterward — treat it as NOT launched. See the per-step errors.'
        : !structureOk
          ? 'A campaign shell was created but the ad groups/ads did not — it would not serve. See the per-step errors.'
          : `Verified: campaign created ${spec.status} in your Google Ads account${verifyAttempted ? '' : ' (structure confirmed; independent verification unavailable)'}. Review it before enabling.`;
    return { ok, live: true, campaignResource: campaign.resource, link, steps, note };
  }

  // ── Meta (Facebook/Instagram) campaign launch — direct Graph API ────────────
  // Connected via three Render env vars from the owner's Meta ad account:
  //   META_ADS_ACCESS_TOKEN  — a token with ads_management on the ad account
  //   META_AD_ACCOUNT_ID     — the numeric ad-account id (no "act_" prefix)
  //   META_PAGE_ID           — the Facebook Page the ads run under
  // Everything is created PAUSED, so it lands as a draft the owner reviews and
  // flips live in Ads Manager. Nothing here can spend money.
  metaLaunchReady(): { ready: boolean; account?: string; note: string } {
    const token = process.env.META_ADS_ACCESS_TOKEN;
    const acct = process.env.META_AD_ACCOUNT_ID;
    const page = process.env.META_PAGE_ID;
    if (token && acct && page) {
      const masked = 'act_' + acct.replace(/[^0-9]/g, '');
      return { ready: true, account: masked, note: `Connected to Meta ad account ${masked}.` };
    }
    const missing = [!token && 'META_ADS_ACCESS_TOKEN', !acct && 'META_AD_ACCOUNT_ID', !page && 'META_PAGE_ID'].filter(Boolean);
    return { ready: false, note: `Not connected — add ${missing.join(', ')} on Render (from your Meta ad account).` };
  }

  private async metaPost(path: string, params: Record<string, string>): Promise<{ id?: string; error?: string }> {
    const base = process.env.META_GRAPH_BASE || 'https://graph.facebook.com/v20.0';
    const token = process.env.META_ADS_ACCESS_TOKEN || '';
    const body = new URLSearchParams({ ...params, access_token: token });
    try {
      const res = await fetch(`${base}/${path}`, { method: 'POST', body });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) return { error: data?.error?.error_user_msg || data?.error?.message || `HTTP ${res.status}` };
      return { id: typeof data?.id === 'string' ? data.id : undefined };
    } catch (e: any) {
      return { error: e?.message || 'network error' };
    }
  }

  async launchMetaCampaign(_externalUserId: string, spec: import('../agents/metacampaign.js').MetaCampaignSpec): Promise<import('./types.js').CampaignLaunchResult> {
    const ready = this.metaLaunchReady();
    const steps: import('./types.js').CampaignLaunchStep[] = [];
    if (!ready.ready) return { ok: false, live: true, steps: [{ step: 'Meta ad account', ok: false, error: ready.note }], note: ready.note };
    const acct = (process.env.META_AD_ACCOUNT_ID || '').replace(/[^0-9]/g, '');
    const pageId = (process.env.META_PAGE_ID || '').replace(/[^0-9]/g, '');
    const actPath = `act_${acct}`;

    // 1) Campaign — PAUSED, traffic objective (no pixel/lead-form dependency).
    const camp = await this.metaPost(`${actPath}/campaigns`, {
      name: spec.name,
      objective: spec.objective,
      status: 'PAUSED',
      special_ad_categories: JSON.stringify([]),
    });
    steps.push({ step: `Create campaign "${spec.name}" (PAUSED)`, ok: !!camp.id, resource: camp.id, error: camp.error });
    if (!camp.id) return { ok: false, live: true, steps, note: 'Campaign create failed — nothing else was created, no spend possible.' };

    // 2) Ad set — daily budget (cents), local geo, age. Self-heal geo: try ZIPs,
    //    fall back to broad US so a bad ZIP key never blocks the draft.
    const cents = String(Math.max(100, Math.round(spec.dailyBudget * 100)));
    const targetingWithZips = {
      geo_locations: spec.geo.zips.length
        ? { zips: spec.geo.zips.map((z) => ({ key: `US:${z}` })) }
        : { countries: spec.geo.countries },
      age_min: spec.ageMin,
      age_max: spec.ageMax,
    };
    const adsetParams = (targeting: unknown) => ({
      name: `${spec.name} — Ad set`.slice(0, 100),
      campaign_id: camp.id!,
      daily_budget: cents,
      billing_event: spec.billingEvent,
      optimization_goal: spec.optimizationGoal,
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      targeting: JSON.stringify(targeting),
      status: 'PAUSED',
    });
    let adset = await this.metaPost(`${actPath}/adsets`, adsetParams(targetingWithZips));
    if (!adset.id && spec.geo.zips.length) {
      // ZIP targeting rejected — retry with broad US so the draft still lands.
      adset = await this.metaPost(`${actPath}/adsets`, adsetParams({ geo_locations: { countries: spec.geo.countries }, age_min: spec.ageMin, age_max: spec.ageMax }));
      steps.push({ step: `Create ad set (ZIP geo rejected → targeted US; refine in Ads Manager)`, ok: !!adset.id, resource: adset.id, error: adset.error });
    } else {
      steps.push({ step: `Create ad set ($${spec.dailyBudget}/day, ${spec.geo.zips.length ? spec.geo.zips.length + ' ZIPs' : 'US'})`, ok: !!adset.id, resource: adset.id, error: adset.error });
    }
    if (!adset.id) return { ok: false, live: true, campaignResource: camp.id, steps, note: 'Ad set create failed — campaign is PAUSED and empty, no spend possible.' };

    // 3) Ad creative — the offer copy + link to the owner's website.
    const storySpec = {
      page_id: pageId,
      link_data: {
        message: spec.ad.primaryText,
        link: spec.website || 'https://facebook.com',
        name: spec.ad.headline,
        description: spec.ad.description,
        call_to_action: { type: spec.ad.cta, value: { link: spec.website || 'https://facebook.com' } },
      },
    };
    const creative = await this.metaPost(`${actPath}/adcreatives`, {
      name: `${spec.name} — Creative`.slice(0, 100),
      object_story_spec: JSON.stringify(storySpec),
    });
    steps.push({ step: 'Create ad creative (offer copy + website link)', ok: !!creative.id, resource: creative.id, error: creative.error });
    if (!creative.id) return { ok: false, live: true, campaignResource: camp.id, steps, note: 'Creative create failed — campaign & ad set are PAUSED, no spend possible.' };

    // 4) Ad — PAUSED, ties creative to the ad set.
    const ad = await this.metaPost(`${actPath}/ads`, {
      name: `${spec.name} — Ad`.slice(0, 100),
      adset_id: adset.id!,
      creative: JSON.stringify({ creative_id: creative.id }),
      status: 'PAUSED',
    });
    steps.push({ step: 'Create ad (PAUSED)', ok: !!ad.id, resource: ad.id, error: ad.error });

    const ok = steps.every((s) => s.ok);
    const link = `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${acct}&selected_campaign_ids=${camp.id}`;
    return {
      ok,
      live: true,
      campaignResource: camp.id,
      link,
      steps,
      note: ok
        ? 'Campaign built as a PAUSED draft in your Meta Ads Manager. Review every setting, then flip it live — nothing has spent.'
        : 'Some steps failed — see per-step errors. Everything created is PAUSED, so no spend has occurred.',
    };
  }

  // Resolve the concrete identity of a Meta ad account + Page from env creds.
  private async metaAccountDetails(): Promise<{ adAccount?: { id: string; name?: string; status?: string; currency?: string }; page?: { id: string; name?: string; logo?: string; link?: string } }> {
    const base = process.env.META_GRAPH_BASE || 'https://graph.facebook.com/v20.0';
    const token = process.env.META_ADS_ACCESS_TOKEN;
    const acct = (process.env.META_AD_ACCOUNT_ID || '').replace(/[^0-9]/g, '');
    const page = (process.env.META_PAGE_ID || '').replace(/[^0-9]/g, '');
    if (!token) return {};
    const get = async (path: string): Promise<any> => {
      try {
        const res = await fetch(`${base}/${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`);
        return await res.json().catch(() => ({}));
      } catch {
        return {};
      }
    };
    const out: { adAccount?: any; page?: any } = {};
    if (acct) {
      const a = await get(`act_${acct}?fields=name,account_status,currency`);
      if (a && !a.error) {
        const st: Record<number, string> = { 1: 'Active', 2: 'Disabled', 3: 'Unsettled', 7: 'Pending review', 9: 'In grace period', 101: 'Closed' };
        out.adAccount = { id: `act_${acct}`, name: a.name, status: st[a.account_status] ?? String(a.account_status ?? ''), currency: a.currency };
      } else {
        out.adAccount = { id: `act_${acct}`, name: undefined, status: a?.error?.message ? 'Token/account error' : undefined };
      }
    }
    if (page) {
      const pg = await get(`${page}?fields=name,link,picture.type(large){url}`);
      if (pg && !pg.error) out.page = { id: page, name: pg.name, logo: pg?.picture?.data?.url, link: pg.link };
      else out.page = { id: page };
    }
    return out;
  }

  async disconnectAccount(externalUserId: string, accountId: string): Promise<{ ok: boolean; note?: string }> {
    if (!accountId) return { ok: false, note: 'No account id.' };
    let pd: any;
    try { pd = await this.backend(); } catch (err) { return { ok: false, note: String((err as Error).message) }; }
    // Only delete an account that actually belongs to this user.
    try {
      const mine = (await this.listAccounts(externalUserId)).some((a) => a.id === accountId);
      if (!mine) return { ok: false, note: 'That account is not connected to your workspace.' };
    } catch { /* fall through and attempt */ }
    // The v3 SDK exposes accounts.delete; tolerate a couple of shapes.
    try {
      if (typeof pd?.accounts?.delete === 'function') await pd.accounts.delete(accountId);
      else if (typeof pd?.accounts?.delete === 'function') await pd.accounts.delete({ id: accountId });
      else if (typeof pd?.deleteAccount === 'function') await pd.deleteAccount({ id: accountId });
      else return { ok: false, note: 'This connector build cannot delete accounts.' };
      this.gadsCache.delete(externalUserId);
      return { ok: true };
    } catch (err) {
      return { ok: false, note: `Pipedream rejected the disconnect: ${String((err as Error).message)}` };
    }
  }

  async describeConnections(externalUserId: string): Promise<import('./types.js').ConnectionDetail[]> {
    const LABEL: Record<string, string> = { google_ads: 'Google Ads', google_my_business: 'Google Business Profile', gohighlevel: 'GoHighLevel', highlevel_oauth: 'GoHighLevel', highlevel: 'GoHighLevel', leadconnector: 'GoHighLevel', facebook_pages: 'Facebook Page', facebook: 'Facebook', instagram: 'Instagram', google_analytics: 'Google Analytics', google_lsa: 'Google Local Services' };
    const details: import('./types.js').ConnectionDetail[] = [];
    let accts: import('./types.js').ConnectedAccount[] = [];
    try {
      accts = await this.listAccounts(externalUserId);
    } catch {
      /* none */
    }
    const byApp = new Map<string, import('./types.js').ConnectedAccount[]>();
    for (const a of accts) byApp.set(a.app, [...(byApp.get(a.app) ?? []), a]);

    for (const [app, list] of byApp) {
      const primary = list.find((a) => a.healthy) ?? list[0]!;
      const detail: import('./types.js').ConnectionDetail = { app, label: LABEL[app] ?? app, connected: true, accountName: primary.name, accountId: primary.id, rows: [] };
      if (app === 'google_ads') {
        const fmt = (i: string) => i.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');
        // Reuse the IDs the spend pull already resolved (cached per user) before
        // re-running the lister components — that path is what actually works live.
        let ids = this.gadsCache.get(externalUserId)?.ids ?? [];
        let errMsg = '';
        if (!ids.length) {
          try {
            const rows = await this.listComponents('google_ads');
            ids = await this.googleAdsCustomerIds(externalUserId, primary.id, rows);
            if (ids.length) { const c = this.gadsCache.get(externalUserId); this.gadsCache.set(externalUserId, { key: c?.key ?? '', appName: c?.appName ?? 'googleAds', ids, shape: c?.shape, ts: Date.now() }); }
          } catch (e) {
            errMsg = String((e as Error).message || '').slice(0, 120);
          }
        }
        if (ids.length) {
          detail.rows!.push({ k: 'Ad account (customer) ID', v: fmt(ids[0]!) });
          if (ids.length > 1) detail.rows!.push({ k: 'Other accessible accounts', v: ids.slice(1).map(fmt).join(', ') });
        } else {
          detail.note = errMsg
            ? `Connected. Couldn’t resolve the ad-account ID yet (${errMsg}). It usually appears after you open the Dashboard once — the data pull resolves it.`
            : 'Connected. The ad-account (customer) ID shows here after you open the Dashboard once — that load resolves it. If it never appears, check this Google login has access to the ad account.';
        }
      }
      details.push(detail);
    }

    // Meta is connected via env creds (not Pipedream) — surface its identity too.
    const metaReady = this.metaLaunchReady();
    if (metaReady.ready) {
      const md = await this.metaAccountDetails();
      const rows: { k: string; v: string }[] = [];
      if (md.adAccount) {
        rows.push({ k: 'Ad account', v: `${md.adAccount.name ? md.adAccount.name + ' · ' : ''}${md.adAccount.id}` });
        if (md.adAccount.status) rows.push({ k: 'Account status', v: md.adAccount.status });
        if (md.adAccount.currency) rows.push({ k: 'Currency', v: md.adAccount.currency });
      }
      if (md.page) rows.push({ k: 'Facebook Page', v: `${md.page.name ? md.page.name + ' · ' : ''}${md.page.id}` });
      details.push({
        app: 'meta_ads',
        label: 'Meta (Facebook / Instagram) Ads',
        connected: true,
        accountName: md.adAccount?.name ?? md.page?.name ?? metaReady.account,
        accountId: md.adAccount?.id ?? metaReady.account,
        logo: md.page?.logo,
        rows,
        note: md.adAccount?.name ? undefined : 'Connected via env, but Meta didn’t return the account name — double-check the token has access to this ad account.',
      });
    } else {
      details.push({ app: 'meta_ads', label: 'Meta (Facebook / Instagram) Ads', connected: false, note: metaReady.note });
    }
    return details;
  }

  async uploadOfflineConversions(externalUserId: string, items: import('./types.js').ConversionItem[]): Promise<import('./types.js').ConversionUploadResult> {
    const accts = await this.listAccounts(externalUserId, 'google_ads');
    const account = accts.find((a) => a.healthy) ?? accts[0];
    if (!account) return { ok: false, live: true, uploaded: 0, failed: items.length, steps: items.map((i) => ({ dealId: i.dealId, ok: false, error: 'No connected Google Ads account.' })), note: 'Connect Google Ads first.' };
    const rows = await this.listComponents('google_ads');
    const target = (await this.resolveGadsTargets(externalUserId, account.id, rows))[0];
    const acctVals: Record<string, string[]> = {};
    if (target?.login) acctVals.loginAccount = [target.login, 'use google ads as', 'use google ads', 'accountid'];
    if (target?.client) acctVals.managedAccount = [target.client, 'managed account', 'customer client', 'customerclient'];
    const steps: { dealId: string; ok: boolean; error?: string }[] = [];
    let uploaded = 0;
    for (const it of items.slice(0, 200)) {
      const values: Record<string, string[]> = {
        ...acctVals,
        ...(it.gclid ? { gclid: [it.gclid, 'gclid', 'click id'] } : {}),
        ...(it.email ? { email: [it.email, 'email'] } : {}),
        ...(it.phone ? { phone: [it.phone, 'phone'] } : {}),
        value: [String(it.value), 'conversion value', 'value', 'amount'],
        time: [it.conversionTime || new Date().toISOString(), 'conversion time', 'date time', 'datetime', 'time'],
      };
      const r = await this.writeComponent(externalUserId, 'google_ads-send-offline-conversion', account.id, values);
      steps.push({ dealId: it.dealId, ok: r.ok, error: r.error });
      if (r.ok) uploaded++;
    }
    const failed = items.length - uploaded;
    return { ok: failed === 0, live: true, uploaded, failed, steps, note: failed ? 'Some uploads failed — see per-item errors. Common causes: no offline conversion action configured in Google Ads, or a missing/expired GCLID.' : 'Uploaded — Google will tie these jobs back to the clicks that produced them and bid toward more like them.' };
  }

  async adjustCampaignBudgets(externalUserId: string, changes: import('./types.js').BudgetChange[]): Promise<import('./types.js').BudgetChangeResult> {
    const accts = await this.listAccounts(externalUserId, 'google_ads');
    const account = accts.find((a) => a.healthy) ?? accts[0];
    const acted = changes.filter((c) => c.action !== 'hold');
    if (!account) return { ok: false, live: true, applied: 0, steps: acted.map((c) => ({ campaign: c.campaign, ok: false, error: 'No connected Google Ads account.' })), note: 'Connect Google Ads first.' };
    // Money-safety: never fire a budget write without first resolving each
    // campaign's current budget resource + amount (so a wrong number can't hit a
    // live budget). That live resolution is the final wiring step; until it's
    // verified against a real account, approved moves are logged, not pushed.
    return {
      ok: false,
      live: true,
      applied: 0,
      steps: acted.map((c) => ({ campaign: c.campaign, ok: false, error: 'held — live budget push needs verified budget-resource resolution (money-safe)' })),
      note: 'Approved moves are logged to your Change Log. The live push to Google Ads is held back for safety until the budget-write path is verified against your real account — so no wrong amount can ever hit your budget.',
    };
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
          const gTargets = await this.resolveGadsTargets(externalUserId, account?.id ?? '', rows);
          deep.resolvedCustomerIds = [...new Set(gTargets.map((t) => t.client ?? t.login))];
          deep.reportTargets = gTargets; // {login, client} pairs — the MCC-aware fix
          const trials: any[] = [];
          let runs = 0;
          outer: for (const t of (gTargets.length ? gTargets : [{ login: '' }]).slice(0, 3)) {
            for (const shape of GADS_SHAPES) {
              if (runs++ >= 9) break outer;
              const cp: Record<string, unknown> = { [appName]: { authProvisionId: account?.id }, dateRange: 'LAST_30_DAYS', fields: shape.fields, metrics: shape.metrics };
              if (t.login) cp.accountId = t.login;
              if (t.client) cp.customerClientId = t.client;
              try {
                const r = await pd.actions.run({ externalUserId, id: rkey, configuredProps: cp });
                const raw = r?.ret ?? r?.exports ?? r ?? null;
                const arr = asRows(raw);
                trials.push({ login: t.login, client: t.client, format: shape.tag, count: arr.length, sample: arr[0] ?? (raw && typeof raw === 'object' && !Array.isArray(raw) ? Object.keys(raw as any) : raw) });
                if (arr.length) break outer; // found a working combo — stop
              } catch (e) {
                trials.push({ login: t.login, client: t.client, format: shape.tag, error: String((e as Error).message) });
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
/** Map a descriptive verb to the keywords the real action is named with, so the
 *  component ranker lands on it (e.g. "Send missed-call text-back SMS" → GHL's
 *  "Send SMS"). Falls through to the original query for anything unmapped. */
export function canonicalVerb(query: string): string {
  const q = query.toLowerCase();
  if (/\bsms\b|text-?back|\btext\b/.test(q)) return 'send sms';
  if (/\btask\b/.test(q)) return 'create task';
  if (/\bemail\b/.test(q)) return 'send email';
  return query;
}

export function pickComponent(rows: any[], query: string): any {
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
