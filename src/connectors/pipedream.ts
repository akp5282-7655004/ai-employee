import type { Config } from '../config.js';
import { META_SHARED_ACCOUNT_NOTE as _META_NOTE } from '../agents/googlelaunch.js';
import { collectReadIds, googleResourceMissing, listCampaignRows, parseGoogleStatuses, retryReadback } from '../agents/enablecheck.js';
import { actionPayload, customerPair, plainGoogleError, statusReportProps } from './gadsread.js';
import { areaTerms, chooseGeoHits, geoReportProps, locationCriterion, locationReadbackOk, parseGeoTargets, parseLocationCriteria, resolveAreas, type GeoTarget } from '../agents/geotarget.js';
import { plainStepErrors } from '../agents/googlelaunch.js';
import { classifyGadsAccounts, extractCustomerNodes, type GadsAccess } from './gadsAccess.js';
import { explainPipedreamError, type PipedreamFailure } from './pipedreamErrors.js';
import { withTimeout } from './readcache.js';
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
  /** customerId → descriptive name, harvested from list-customer-clients responses. */
  private gadsNames = new Map<string, string>();
  /** Why customer-id resolution failed for this external user. Never another user's error. */
  private gadsBlock = new Map<string, PipedreamFailure>();
  /** Last honest read of which customer ids this login can use. */
  private gadsAccess = new Map<string, GadsAccess>();
  /** The ad account the owner last launched into — reads prefer it too, so an
   *  MCC with many clients reports the business the owner actually works in. */
  private gadsPreferred = new Map<string, string>();
  /** Manager login saved with the preferred client. Does not call Google. */
  private gadsLogin = new Map<string, string>();
  private static GHL_SLUGS = ['gohighlevel', 'highlevel_oauth', 'highlevel', 'leadconnector'];
  /** Successful account lists. A page load calls this many times; Pipedream does not. */
  private accountCache = new Map<string, { ts: number; value: ConnectedAccount[] }>();
  private accountInflight = new Map<string, Promise<ConnectedAccount[]>>();
  private accountGen = new Map<string, number>();
  private projectCache = new Map<string, { ts: number; value: ConnectedAccount[] }>();
  private projectInflight = new Map<string, Promise<ConnectedAccount[]>>();
  private projectGen = new Map<string, number>();
  private static readonly ACCOUNT_TTL_MS = 15_000;
  private static readonly PROJECT_TTL_MS = 45_000;
  /** One hung Pipedream list must not pin every later read. */
  private static readonly LIST_TIMEOUT_MS = 8_000;

  /** Order targets so the owner's preferred (last-launched-into) account is tried first. */
  private preferTargets(externalUserId: string, targets: { login: string; client?: string }[]): { login: string; client?: string }[] {
    const pref = this.gadsPreferred.get(externalUserId);
    if (!pref) return targets;
    return [...targets].sort((a, b) => (((b.client ?? b.login) === pref) ? 1 : 0) - (((a.client ?? a.login) === pref) ? 1 : 0));
  }
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

  private aliases = new Map<string, Set<string>>();

  rememberExternalIds(userId: string, externalIds: string[]): void {
    const set = this.aliases.get(userId) ?? new Set<string>();
    for (const id of externalIds) if (id && id !== userId) set.add(id);
    this.aliases.set(userId, set);
  }

  private async listAccountsOnce(externalUserId: string): Promise<ConnectedAccount[]> {
    const pd = await this.backend();
    const res = await pd.accounts.list({ externalUserId });
    return this.mapAccounts(res, externalUserId);
  }

  private accountKey(externalUserId: string): string {
    const aliases = [...(this.aliases.get(externalUserId) ?? [])].sort();
    return `${externalUserId}|${aliases.join(',')}`;
  }

  /** Full list for this login and its aliases. One live read is shared for a short while. */
  private listAccountsCached(externalUserId: string): Promise<ConnectedAccount[]> {
    const key = this.accountKey(externalUserId);
    const hit = this.accountCache.get(key);
    if (hit && Date.now() - hit.ts < PipedreamConnector.ACCOUNT_TTL_MS) return Promise.resolve(hit.value);
    const pending = this.accountInflight.get(key);
    if (pending) return pending;
    const gen = this.accountGen.get(key) ?? 0;
    const p = this.listAccountsLive(externalUserId)
      .then((value) => {
        if ((this.accountGen.get(key) ?? 0) === gen) this.accountCache.set(key, { ts: Date.now(), value });
        return value;
      })
      .finally(() => { if (this.accountInflight.get(key) === p) this.accountInflight.delete(key); });
    this.accountInflight.set(key, p);
    return p;
  }

  private async listAccountsLive(externalUserId: string): Promise<ConnectedAccount[]> {
    const ids = [externalUserId, ...(this.aliases.get(externalUserId) ?? [])];
    // Alias lookups used to run one after another. Walk them together so one
    // slow id does not add its full latency to every other id.
    const rows = await Promise.all(ids.map(async (id, index) => {
      try { return await withTimeout(this.listAccountsOnce(id), PipedreamConnector.LIST_TIMEOUT_MS); }
      catch { return index === 0 ? null : []; }
    }));
    if (rows[0] == null) throw new Error('Pipedream account list did not finish');
    const seen = new Set<string>();
    const out: ConnectedAccount[] = [];
    for (const batch of rows) {
      for (const row of batch ?? []) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        out.push(row);
      }
    }
    return out;
  }

  private dropAccountCache(externalUserId?: string): void {
    const bump = (key: string) => {
      this.accountGen.set(key, (this.accountGen.get(key) ?? 0) + 1);
      this.accountInflight.delete(key);
    };
    if (!externalUserId) {
      for (const key of new Set([...this.accountCache.keys(), ...this.accountInflight.keys()])) bump(key);
      this.accountCache.clear();
      return;
    }
    for (const key of new Set([...this.accountCache.keys(), ...this.accountInflight.keys()])) {
      if (key === externalUserId || key.startsWith(`${externalUserId}|`)) {
        bump(key);
        this.accountCache.delete(key);
      }
    }
  }

  private mapAccounts(res: any, fallbackUserId: string): ConnectedAccount[] {
    const rows: any[] = res?.data ?? res?.accounts ?? (Array.isArray(res) ? res : []);
    return rows.map((a) => {
      const raw = a.app?.nameSlug ?? a.app?.name_slug ?? (typeof a.app === 'string' ? a.app : a.app?.name) ?? 'unknown';
      return {
        id: a.id,
        app: String(raw).toLowerCase().replace(/\s+/g, '_'),
        name: a.name,
        externalUserId: String(a.externalId ?? a.external_id ?? fallbackUserId),
        healthy: a.healthy ?? true,
      };
    });
  }

  async listAccounts(externalUserId: string, app?: string): Promise<ConnectedAccount[]> {
    const all = await this.listAccountsCached(externalUserId);
    return app ? all.filter((a) => a.app === app) : all;
  }

  async listProjectAccounts(app?: string): Promise<ConnectedAccount[]> {
    const key = app ?? '*';
    const hit = this.projectCache.get(key);
    if (hit && Date.now() - hit.ts < PipedreamConnector.PROJECT_TTL_MS) return hit.value;
    const pending = this.projectInflight.get(key);
    if (pending) return pending;
    const gen = this.projectGen.get(key) ?? 0;
    const p = withTimeout(this.listProjectAccountsLive(app), PipedreamConnector.LIST_TIMEOUT_MS)
      .then((value) => {
        if ((this.projectGen.get(key) ?? 0) === gen) this.projectCache.set(key, { ts: Date.now(), value });
        return value;
      })
      .finally(() => { if (this.projectInflight.get(key) === p) this.projectInflight.delete(key); });
    this.projectInflight.set(key, p);
    return p;
  }

  private async listProjectAccountsLive(app?: string): Promise<ConnectedAccount[]> {
    const pd = await this.backend();
    const res = await pd.accounts.list(app ? { app, limit: 100 } : { limit: 100 });
    return this.mapAccounts(res, '');
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
    const runList = async (key: string, extra: Record<string, unknown> = {}): Promise<{ ids: Set<string>; nodes: ReturnType<typeof extractCustomerNodes>; missing: boolean; error: string }> => {
      const found = new Set<string>();
      const comp = rows.find((c) => (c.key ?? c.id ?? c.componentKey) === key);
      if (!comp) return { ids: found, nodes: [], missing: true, error: '' };
      try {
        const props = await this.componentProps(comp, key);
        const appName = props.find((p: any) => p?.type === 'app')?.name ?? 'googleAds';
        const cp: Record<string, unknown> = { [appName]: { authProvisionId: authId } };
        for (const [k, v] of Object.entries(extra)) if (props.some((p: any) => p?.name === k)) cp[k] = v;
        const res = await pd.actions.run({ externalUserId, id: key, configuredProps: cp });
        const payload = res?.ret ?? res?.exports ?? res;
        collectCustomerIds(payload, found);
        collectCustomerNames(payload, this.gadsNames);
        return { ids: found, nodes: extractCustomerNodes(payload), missing: false, error: '' };
      } catch (err) {
        const failure = explainPipedreamError(err);
        this.gadsBlock.set(externalUserId, failure);
        return { ids: found, nodes: [], missing: false, error: failure.message };
      }
    };
    const blocked = this.gadsBlock.get(externalUserId);
    if (blocked?.kind === 'connect_production_unavailable') {
      this.gadsAccess.set(externalUserId, { kind: 'error', reason: blocked.message, customers: [] });
      return [];
    }
    const loginRes = await runList('google_ads-list-account-id-options');
    if (this.gadsBlock.get(externalUserId)?.kind === 'connect_production_unavailable') {
      this.gadsAccess.set(externalUserId, { kind: 'error', reason: this.gadsBlock.get(externalUserId)!.message, customers: [] });
      return [];
    }
    let loginIds = loginRes.ids;
    let loginNodes = loginRes.nodes;
    let missingAction = loginRes.missing ? 'google_ads-list-account-id-options' : '';
    let error = loginRes.error;
    if (!loginIds.size && !error) {
      const fallback = await runList('google_ads-list-customer-clients');
      loginIds = fallback.ids;
      loginNodes = fallback.nodes;
      if (fallback.error) error = fallback.error;
      if (fallback.missing && missingAction) missingAction = 'google_ads-list-account-id-options and google_ads-list-customer-clients';
    }
    const clientsByLogin: Record<string, ReturnType<typeof extractCustomerNodes>> = {};
    for (const login of [...loginIds].slice(0, 5)) {
      // accountId is the manager (login-customer-id). Do not also send that
      // manager as customerClientId. That prop is the client ad account, and
      // setting it to the manager hides the client list.
      const clients = await runList('google_ads-list-customer-clients', { accountId: login });
      clientsByLogin[login] = clients.nodes.length ? clients.nodes : [...clients.ids].map((id) => ({ id }));
      if (clients.error) error = error || clients.error;
    }
    const logins = loginNodes.length ? loginNodes : [...loginIds].map((id) => ({ id }));
    const fmtId = (id: string) => (/^\d{10}$/.test(id) ? `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}` : id);
    let access = classifyGadsAccounts({
      logins,
      clientsByLogin,
      missingAction: missingAction || undefined,
      error: error || undefined,
      selectedId: this.gadsPreferred.get(externalUserId),
    });
    const savedClient = (this.gadsPreferred.get(externalUserId) || '').replace(/[^\d]/g, '');
    const savedLogin = (this.gadsLogin.get(externalUserId) || '').replace(/[^\d]/g, '');
    if ((access.kind === 'manager_only' || access.kind === 'none') && /^\d{10}$/.test(savedClient)) {
      const login = /^\d{10}$/.test(savedLogin) ? savedLogin : (access.loginCustomerId || savedClient);
      const name = this.gadsNames.get(savedClient);
      const label = name ? `${name} (${fmtId(savedClient)})` : fmtId(savedClient);
      access = {
        kind: 'ready',
        reason: 'A saved Google Ads customer id is selected.',
        loginCustomerId: login,
        customers: [{ id: savedClient, login, name, label }],
        selectedId: savedClient,
      };
    } else if (access.kind === 'manager_only' && access.loginCustomerId) {
      const harvested = await this.clientsFromCampaignList(externalUserId, authId, rows, access.loginCustomerId);
      if (harvested.length === 1) {
        const client = harvested[0]!;
        access = classifyGadsAccounts({
          logins: [{ id: access.loginCustomerId, manager: true }],
          clientsByLogin: { [access.loginCustomerId]: [client] },
          selectedId: savedClient || client.id,
        });
      }
    }
    this.gadsAccess.set(externalUserId, access);
    if (access.kind === 'ready' && access.selectedId) {
      const chosen = access.customers.find((c) => c.id === access.selectedId)!;
      return [{ login: chosen.login, client: chosen.id === chosen.login ? undefined : chosen.id }];
    }
    if (access.kind === 'choose') return access.customers.map((c) => ({ login: c.login, client: c.id === c.login ? undefined : c.id }));
    return [];
  }

  googleAdsAccess(externalUserId: string): GadsAccess | null {
    return this.gadsAccess.get(externalUserId) ?? null;
  }

  rememberGoogleCustomer(externalUserId: string, customerId: string, loginCustomerId?: string): void {
    const client = customerId.replace(/[^\d]/g, '');
    this.gadsPreferred.set(externalUserId, client);
    const login = (loginCustomerId || '').replace(/[^\d]/g, '');
    if (/^\d{10}$/.test(login)) this.gadsLogin.set(externalUserId, login);
    this.gadsCache.delete(externalUserId);
  }

  /**
   * When the client list only returns the manager, a campaign list on that
   * login can still name the client in customers/{id}/. One client is enough
   * to resolve. An empty or failed list does not invent an id.
   */
  private async clientsFromCampaignList(externalUserId: string, authId: string, rows: any[], login: string): Promise<{ id: string; manager?: boolean; name?: string }[]> {
    const comp = rows.find((c) => (c.key ?? c.id ?? c.componentKey) === 'google_ads-list-campaigns');
    if (!comp) return [];
    try {
      const pd = await this.backend();
      const key = comp.key ?? comp.id ?? comp.componentKey;
      const props = await this.componentProps(comp, key);
      const appName = props.find((p: any) => p?.type === 'app')?.name ?? 'googleAds';
      const res = await pd.actions.run({
        externalUserId,
        id: key,
        configuredProps: { [appName]: { authProvisionId: authId }, accountId: login },
      });
      const ids = new Set<string>();
      const text = JSON.stringify(res?.ret ?? res?.exports ?? res ?? {});
      for (const match of text.matchAll(/customers\/(\d{10})\//g)) {
        if (match[1] && match[1] !== login) ids.add(match[1]);
      }
      return [...ids].map((id) => ({ id, manager: false, name: this.gadsNames.get(id) }));
    } catch {
      return [];
    }
  }

  /**
   * The Google Ads accounts a launch can write into, with names when Google
   * provides them — an MCC owner picks WHICH client account gets the campaign.
   */
  async listAdTargets(externalUserId: string): Promise<{ id: string; login: string; name?: string; label: string }[]> {
    const accts = await this.listAccounts(externalUserId, 'google_ads');
    const account = accts.find((a) => a.healthy) ?? accts[0];
    if (!account) return [];
    if (this.gadsBlock.get(externalUserId)?.kind === 'connect_production_unavailable') return [];
    const cached = this.gadsCache.get(externalUserId);
    let targets = cached?.targets && Date.now() - cached.ts < 10 * 60_000 ? cached.targets : undefined;
    if (!targets) {
      const rows = await this.listComponents('google_ads');
      targets = await this.resolveGadsTargets(externalUserId, account.id, rows);
    }
    const fmt = (id: string) => /^\d{10}$/.test(id) ? `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}` : id;
    return targets.map((t) => {
      const id = t.client ?? t.login;
      const name = this.gadsNames.get(id);
      return { id, login: t.login, name, label: name ? `${name} — ${fmt(id)}` : fmt(id) };
    });
  }

  /** Last tool-call failure for this external user only. */
  googleAdsBlock(externalUserId: string): PipedreamFailure | null {
    return this.gadsBlock.get(externalUserId) ?? null;
  }

  /**
   * Deals/opportunities from the connected CRM (GoHighLevel under any of its
   * Pipedream slugs). Best-effort component discovery: finds a list/search
   * opportunities action and normalizes rows into Deal objects — this is what
   * turns Booked Jobs and Revenue live from the actual pipeline, without
   * waiting for a webhook to fire.
   */
  async getDeals(externalUserId: string): Promise<import('../revenue/attribution.js').Deal[]> {
    const out: import('../revenue/attribution.js').Deal[] = [];
    try {
      const pd = await this.backend();
      for (const slug of PipedreamConnector.GHL_SLUGS) {
        const accts = await this.listAccounts(externalUserId, slug).catch(() => [] as import('./types.js').ConnectedAccount[]);
        const account = accts.find((a) => a.healthy) ?? accts[0];
        if (!account) continue;
        const rows = await this.listComponents(slug);
        const isOpp = (c: any) => /opportunit/i.test(String(c.key ?? c.id ?? c.componentKey ?? ''));
        const comp = rows.find((c) => isOpp(c) && /list|search|get/i.test(String(c.key ?? c.id ?? c.componentKey ?? ''))) ?? rows.find(isOpp);
        if (!comp) continue;
        const key = comp.key ?? comp.id ?? comp.componentKey;
        const props = await this.componentProps(comp, key);
        const appName = props.find((p: any) => p?.type === 'app')?.name ?? slug;
        const cp: Record<string, unknown> = { [appName]: { authProvisionId: account.id } };
        if (props.some((p: any) => p?.name === 'limit')) cp.limit = 100;
        const res = await pd.actions.run({ externalUserId, id: key, configuredProps: cp });
        for (const r of asRows(res?.ret ?? res?.exports ?? res)) {
          const id = r?.id ?? r?._id;
          if (!id) continue;
          const status = String(r?.status ?? r?.stage ?? r?.stageName ?? '').toLowerCase();
          out.push({
            id: String(id),
            value: num(r?.monetaryValue ?? r?.monetary_value ?? r?.value ?? r?.amount),
            won: status === 'won' || /closed.?won/.test(status),
            utmSource: r?.source ? String(r.source) : undefined,
            createdAt: r?.createdAt ?? r?.dateAdded ?? r?.date_added ?? undefined,
            wonAt: r?.lastStatusChangeAt ?? r?.updatedAt ?? undefined,
            email: r?.contact?.email ?? r?.email ?? undefined,
            phone: r?.contact?.phone ?? r?.phone ?? undefined,
          });
        }
        if (out.length) return out;
      }
    } catch {
      /* CRM read unavailable — callers fall back to the webhook ledger */
    }
    return out;
  }

  /**
   * Search terms with spend/conversions, for the Gold Miner skill. Best-effort:
   * Pipedream's Google Ads app exposes a search-terms report on some plans;
   * when no matching component exists this returns [] and the skill says so
   * (sample-labeled) instead of pretending.
   */
  async getSearchTerms(externalUserId: string): Promise<{ term: string; cost: number; clicks: number; conversions: number }[]> {
    const out: { term: string; cost: number; clicks: number; conversions: number }[] = [];
    try {
      const pd = await this.backend();
      const accts = await this.listAccounts(externalUserId, 'google_ads');
      const account = accts.find((a) => a.healthy) ?? accts[0];
      if (!account) return out;
      const rows = await this.listComponents('google_ads');
      const comp = rows.find((c) => /search.?term/i.test(String(c.key ?? c.id ?? c.componentKey ?? '')));
      if (!comp) return out;
      const key = comp.key ?? comp.id ?? comp.componentKey;
      const props = await this.componentProps(comp, key);
      const appName = props.find((p: any) => p?.type === 'app')?.name ?? 'googleAds';
      const targets = await this.resolveGadsTargets(externalUserId, account.id, rows);
      if (this.gadsBlock.get(externalUserId)?.kind === 'connect_production_unavailable') return out;
      const t = this.preferTargets(externalUserId, targets)[0];
      const cp: Record<string, unknown> = { [appName]: { authProvisionId: account.id }, dateRange: 'LAST_30_DAYS' };
      if (t?.login && props.some((p: any) => p?.name === 'accountId')) cp.accountId = t.login;
      if (t?.client && props.some((p: any) => p?.name === 'customerClientId')) cp.customerClientId = t.client;
      const res = await pd.actions.run({ externalUserId, id: key, configuredProps: cp });
      for (const r of asRows(res?.ret ?? res?.exports ?? res)) {
        const term = r?.searchTermView?.searchTerm ?? r?.search_term ?? r?.searchTerm ?? r?.term;
        if (!term) continue;
        out.push({
          term: String(term),
          cost: num(r?.metrics?.costMicros ?? r?.metrics?.cost_micros) / 1e6 || num(r?.cost),
          clicks: num(r?.metrics?.clicks ?? r?.clicks),
          conversions: num(r?.metrics?.conversions ?? r?.conversions),
        });
      }
    } catch {
      /* unavailable — skill reports sample */
    }
    return out;
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
    if (this.gadsBlock.get(externalUserId)?.kind === 'connect_production_unavailable') return out;

    // Reuse cached discovery (component, {login,client} targets, and the metric/
    // field format Pipedream accepted) when fresh; only the report run per load.
    let key: string, appName: string, targets: { login: string; client?: string }[], cachedShape: GadsShape | undefined;
    const cached = this.gadsCache.get(externalUserId);
    if (cached && cached.targets && Date.now() - cached.ts < PipedreamConnector.DISCOVERY_TTL_MS) {
      ({ key, appName, targets, shape: cachedShape } = cached as typeof cached & { targets: { login: string; client?: string }[] });
    } else {
      const rows = await this.listComponents('google_ads');
      const comp = rows.find((c) => (c.key ?? c.id ?? c.componentKey) === 'google_ads-create-campaign-report') ?? pickComponent(rows, 'create campaign report');
      key = comp ? (comp.key ?? comp.id ?? comp.componentKey) : '';
      const props = comp ? await this.componentProps(comp, key) : [];
      appName = props.find((p: any) => p?.type === 'app')?.name ?? 'googleAds';
      targets = await this.resolveGadsTargets(externalUserId, account.id, rows);
      if (this.gadsBlock.get(externalUserId)?.kind === 'connect_production_unavailable') return out;
      targets = (targets ?? []).filter((t) => /^\d{10}$/.test(t.client || t.login));
      const access = this.gadsAccess.get(externalUserId);
      if (!targets.length || access?.kind === 'none' || access?.kind === 'manager_only' || access?.kind === 'error' || access?.kind === 'choose') return out;
      this.gadsCache.set(externalUserId, { key, appName, ids: targets.map((t) => t.client ?? t.login).filter((id) => /^\d{10}$/.test(id)), targets, ts: Date.now() });
    }
    const preferred = this.preferTargets(externalUserId, targets).slice(0, 8);
    const listed = await this.listGoogleCampaigns(externalUserId, account.id, preferred);
    const metrics = new Map<string, { name: string; spend: number; clicks: number; conversions: number }>();
    // Metrics are optional. A date-window report omits campaigns with no impressions.
    // The list above is the source of campaign rows. Metrics fill in spend when present.
    if (key) {
      const shapes = cachedShape ? [cachedShape, ...GADS_SHAPES.filter((s) => s.tag !== cachedShape.tag)] : GADS_SHAPES;
      let matched = false;
      for (const t of preferred) {
        if (matched) break;
        for (const shape of shapes) {
          const configuredProps: Record<string, unknown> = { [appName]: { authProvisionId: account.id }, dateRange: range, fields: shape.fields, metrics: shape.metrics, segments: ['segments.date'] };
          if (t.login) configuredProps.accountId = t.login;
          if (t.client) configuredProps.customerClientId = t.client;
          let raw: unknown;
          try {
            const res = await pd.actions.run({ externalUserId, id: key, configuredProps });
            raw = actionPayload(res);
          } catch (err) {
            const failure = explainPipedreamError(err);
            if (failure.kind === 'connect_production_unavailable') {
              this.gadsBlock.set(externalUserId, failure);
              return listed;
            }
            continue;
          }
          const rows = asRows(raw);
          if (!rows.length) continue;
          matched = true;
          for (const r of rows) {
            const name = String(r?.campaign?.name ?? r.campaignName ?? r.name ?? 'Google campaign');
            const spend = num(r?.metrics?.costMicros ?? r?.metrics?.cost_micros) / 1e6 || num(r.cost ?? r.spend);
            const clicks = num(r?.metrics?.clicks ?? r.clicks);
            const conv = num(r?.metrics?.conversions ?? r.conversions);
            const keyName = name.toLowerCase();
            const prev = metrics.get(keyName) ?? { name, spend: 0, clicks: 0, conversions: 0 };
            metrics.set(keyName, { name: prev.name, spend: prev.spend + spend, clicks: prev.clicks + clicks, conversions: prev.conversions + conv });
          }
          const prev = this.gadsCache.get(externalUserId);
          if (prev) this.gadsCache.set(externalUserId, { ...prev, shape });
          break;
        }
      }
    }
    if (listed.length) {
      return listed.map((row) => {
        const hit = metrics.get((row.campaign || '').toLowerCase());
        return { ...row, spend: Math.round(hit?.spend || 0), clicks: hit?.clicks || 0, conversions: Math.round(hit?.conversions || 0) };
      });
    }
    for (const hit of metrics.values()) {
      out.push({ platform: 'google_ads', campaign: hit.name, utm: '', spend: Math.round(hit.spend), clicks: hit.clicks, conversions: Math.round(hit.conversions) });
    }
    return out;
  }

  /** Every non-removed campaign on the client account, including paused and zero-spend. */
  private async listGoogleCampaigns(externalUserId: string, authId: string, targets: { login: string; client?: string }[]): Promise<import('../revenue/attribution.js').CampaignSpend[]> {
    const out: import('../revenue/attribution.js').CampaignSpend[] = [];
    try {
      const pd = await this.backend();
      const rows = await this.listComponents('google_ads');
      const listComp = rows.find((c) => (c.key ?? c.id ?? c.componentKey) === 'google_ads-list-campaigns');
      const report = rows.find((c) => (c.key ?? c.id ?? c.componentKey) === 'google_ads-create-campaign-report');
      const comp = listComp ?? report;
      if (!comp) return out;
      const key = comp.key ?? comp.id ?? comp.componentKey;
      const props = await this.componentProps(comp, key);
      const appName = props.find((p: any) => p?.type === 'app')?.name ?? 'googleAds';
      const seen = new Set<string>();
      for (const t of targets) {
        const pair = customerPair({ login: t.login, client: t.client });
        const configuredProps: Record<string, unknown> = listComp
          ? { [appName]: { authProvisionId: authId }, accountId: pair.accountId, ...(pair.customerClientId ? { customerClientId: pair.customerClientId } : {}) }
          : statusReportProps({ appName, authId, pair, resource: 'campaign', ids: [] });
        const res = await pd.actions.run({ externalUserId, id: key, configuredProps });
        for (const row of listCampaignRows(actionPayload(res))) {
          if (seen.has(row.id) || row.status === 'UNKNOWN' && !row.name) continue;
          seen.add(row.id);
          out.push({
            platform: 'google_ads',
            campaign: row.name || `Campaign ${row.id}`,
            utm: '',
            spend: 0,
            clicks: 0,
            conversions: 0,
            status: row.status,
          });
        }
        if (out.length) break;
      }
    } catch {
      /* the metrics report is still attempted */
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
          ? `Google rejected it: ${osErrors.join(' · ').slice(0, 800)}`
          : `sent[${sent.join(', ') || 'nothing but auth'}] · resp ${JSON.stringify(raw ?? null).slice(0, 300)}`;
      return { ok: !osErrors.length, resource, error: osErrors.length ? osErrors.join(' · ').slice(0, 800) : undefined, detail };
    } catch (e) {
      return { ok: false, error: String((e as Error).message) };
    }
  }

  async launchCampaign(externalUserId: string, spec: import('../agents/campaign.js').CampaignSpec, targetCustomerId?: string): Promise<import('./types.js').CampaignLaunchResult> {
    const steps: import('./types.js').CampaignLaunchStep[] = [];
    const accts = await this.listAccounts(externalUserId, 'google_ads');
    const account = accts.find((a) => a.healthy) ?? accts[0];
    if (!account) return { ok: false, live: true, steps: [{ step: 'Google Ads account', ok: false, error: 'No connected Google Ads account.' }], note: 'Connect Google Ads first.' };
    const rows = await this.listComponents('google_ads');
    // MCC-aware: write "as" the login/manager (accountId) but INTO the client
    // account that runs ads (customerClientId) — same split the report needs.
    const targets = await this.resolveGadsTargets(externalUserId, account.id, rows);
    // An MCC can hold many client accounts — never guess which one gets the
    // campaign. Honor an explicit pick; refuse a pick that doesn't resolve.
    const wanted = (targetCustomerId ?? '').replace(/[^\d]/g, '');
    const target = wanted ? targets.find((t) => (t.client ?? t.login) === wanted) : targets[0];
    if (!targets.length) {
      const blocked = this.gadsBlock.get(externalUserId);
      const note = blocked
        ? `${blocked.message} Provider said: ${blocked.providerMessage} Nothing was created.`
        : 'Connect Google Ads in Integrations. Nothing was created.';
      return { ok: false, live: false, steps: [{ step: 'Google Ads account', ok: false, error: blocked?.providerMessage || 'No Google Ads customer account was found on this connection.' }], note };
    }
    if (!wanted && targets.length > 1) {
      return { ok: false, live: false, steps: [{ step: 'Choose an ad account', ok: false, error: 'This Google login manages more than one ad account. Pick one and approve again.' }], note: 'Pick the Google Ads account before Miles creates a paused campaign. Nothing was created.' };
    }
    if (wanted && !target) {
      return { ok: false, live: false, steps: [{ step: `Target account ${targetCustomerId}`, ok: false, error: 'That Google Ads account is not reachable from your connected login.' }], note: 'Pick one of the accounts Miles lists for your connection. Nothing was created.' };
    }
    // Remember the pick — spend reads and search terms follow the same account.
    if (target) this.gadsPreferred.set(externalUserId, target.client ?? target.login);
    const customerId = target?.client ?? target?.login;
    const acctVals: Record<string, string[]> = {};
    if (target?.login) acctVals.loginAccount = [target.login, 'use google ads as', 'use google ads', 'accountid'];
    if (target?.client) acctVals.managedAccount = [target.client, 'managed account', 'customer client', 'customerclient'];

    // Exact prop names from the Pipedream google_ads component sources — no
    // keyword-matching guesswork. operationType is LOWERCASE "create" (the
    // uppercase form skipped the components' own required-field validation).
    const acct: Record<string, unknown> = {};
    if (target?.login) acct.accountId = target.login;
    if (target?.client) acct.customerClientId = target.client;

    // Say up front WHICH account everything lands in — an MCC can have many
    // clients, and "verified" means nothing if the owner is looking at the
    // wrong one in the Google Ads account switcher.
    const fmtCid = (id?: string) => id && /^\d{10}$/.test(id) ? `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}` : id ?? '';
    if (customerId) steps.push({ step: `Target account: ${fmtCid(customerId)}${target?.client && target.login !== target.client ? ` (client under manager ${fmtCid(target.login)})` : ''}`, ok: true });

    const pair = customerPair({ login: target?.login, client: target?.client });
    const indexed = spec.geoTargets?.length ? spec.geoTargets : resolveAreas(spec.locations).targets;
    let geos: GeoTarget[] = indexed;
    try {
      const live = await this.lookupLiveGeo(externalUserId, account.id, pair, spec.locations || []);
      if (live.length) geos = live;
    } catch {
      /* the published geo list still applies */
    }
    if (!geos.length) {
      const block = resolveAreas(spec.locations).block;
      return { ok: false, live: true, steps: [{ step: 'Add location targeting', ok: false, error: block }], note: block };
    }

    // 1) Budget — micros ($1 = 1_000_000). Budget names must be UNIQUE across
    // the account (Google rejects a re-launch with DUPLICATE_NAME), so stamp
    // each launch's budget with the launch time.
    const micros = String(Math.round(spec.dailyBudget * 1_000_000));
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const budget = await this.writeComponent(externalUserId, 'google_ads-create-or-update-campaign-budget', account.id, {}, {
      ...acct,
      operationType: 'create',
      name: `${spec.name} Budget ${stamp}`,
      amountMicros: micros,
      deliveryMethod: 'STANDARD',
    });
    steps.push({ step: `Create daily budget ($${spec.dailyBudget})`, ok: budget.ok && !!budget.resource, resource: budget.resource, error: budget.error || (!budget.resource ? `no budget resource returned — Google said: ${budget.detail ?? '(empty)'}` : undefined) });

    // 2) Campaign — create requires name, advertisingChannelType, an attached
    // budget, containsEuPoliticalAdvertising (Google v25 demands it — this was
    // the "required field was not present" error), and a bidding strategy.
    // "Maximize Clicks" is the TARGET_SPEND enum, not "MAXIMIZE_CLICKS".
    const biddingEnum = spec.biddingStrategy === 'MAXIMIZE_CLICKS' ? 'TARGET_SPEND' : spec.biddingStrategy;
    const ceiling = biddingEnum === 'TARGET_SPEND'
      ? String(Math.round((spec.bidPlan?.maxCpc || 4) * 1_000_000))
      : undefined;
    const campaign = budget.resource
      ? await this.writeComponent(externalUserId, 'google_ads-create-or-update-campaign', account.id, {}, {
          ...acct,
          operationType: 'create',
          name: spec.name,
          advertisingChannelType: 'SEARCH',
          campaignBudget: budget.resource,
          status: 'PAUSED', // client status is ignored — Miles never enables a campaign
          biddingStrategyType: biddingEnum,
          ...(ceiling ? { cpcBidCeilingMicros: ceiling } : {}),
          additionalFields: {
            networkSettings: { targetGoogleSearch: true, targetSearchNetwork: false, targetContentNetwork: false },
            geoTargetTypeSetting: { positiveGeoTargetType: 'PRESENCE', negativeGeoTargetType: 'PRESENCE' },
          },
          containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
        })
      : { ok: false as const, resource: undefined, error: 'Skipped — Google requires a budget on every campaign and the budget step failed above.', detail: undefined };
    steps.push({ step: `Create campaign "${spec.name}" (PAUSED)`, ok: campaign.ok && !!campaign.resource, resource: campaign.resource, error: campaign.error || (!campaign.resource ? `no campaign resource returned — Google said: ${campaign.detail ?? '(empty)'}` : undefined) });

    // 3) Ad groups + keywords + RSA — only if the campaign resource resolved.
    // These components take NUMERIC ids (campaignId/adGroupId) and build the
    // resource paths themselves, so extract the id from each resource name.
    const campaignNumId = (campaign.resource?.match(/campaigns\/(\d+)/) || [])[1];
    if (campaign.resource && campaignNumId) {
      let located = 0;
      let locateErr: string | undefined;
      for (const geo of geos) {
        const placed = await this.writeComponent(externalUserId, 'google_ads-create-or-remove-campaign-criteria', account.id, {}, {
          ...acct,
          operationType: 'create',
          campaignId: campaignNumId,
          negative: false,
          additionalFields: { location: locationCriterion(geo) },
        });
        if (placed.ok) located++;
        else locateErr = locateErr ?? placed.error;
      }
      const read = await this.readLocationCriteria(externalUserId, account.id, pair, campaignNumId, rows);
      const check = locationReadbackOk(geos, read.found, read.presence);
      const locationOk = located === geos.length && check.ok;
      steps.push({
        step: 'Add location targeting',
        ok: locationOk,
        error: locationOk ? undefined : (locateErr || check.reason || 'Location targeting did not read back from Google.'),
      });
      for (const g of spec.adGroups) {
        const ag = await this.writeComponent(externalUserId, 'google_ads-create-or-update-ad-group', account.id, {}, {
          ...acct,
          operationType: 'create',
          name: g.name,
          campaignId: campaignNumId,
          status: 'ENABLED',
        });
        steps.push({ step: `Create ad group "${g.name}"`, ok: ag.ok && !!ag.resource, resource: ag.resource, error: ag.error || (!ag.resource ? `no ad group resource — Google said: ${ag.detail ?? '(empty)'}` : undefined) });
        const adGroupNumId = (ag.resource?.match(/adGroups\/(\d+)/) || [])[1];
        if (!adGroupNumId) continue;
        // Keywords: the component creates ONE keyword per run.
        let kwOk = 0;
        let kwErr: string | undefined;
        for (const k of g.keywords) {
          const kw = await this.writeComponent(externalUserId, 'google_ads-create-or-update-keywords', account.id, {}, {
            ...acct,
            operationType: 'create',
            adGroupId: adGroupNumId,
            keywordText: k.text,
            keywordMatchType: k.match.toUpperCase(),
          });
          if (kw.ok) kwOk++;
          else kwErr = kwErr ?? kw.error;
        }
        steps.push({ step: `Add ${g.keywords.length} keywords to "${g.name}"`, ok: kwOk === g.keywords.length, error: kwErr ? `${kwOk}/${g.keywords.length} added — first failure: ${kwErr}` : undefined });
        const rsa = await this.writeComponent(externalUserId, 'google_ads-create-responsive-search-ad', account.id, {}, {
          ...acct,
          adGroupId: adGroupNumId,
          headlines: g.rsa.headlines,
          descriptions: g.rsa.descriptions,
          finalUrls: [g.finalUrl || spec.finalUrl],
        });
        steps.push({ step: `Create responsive search ad in "${g.name}"`, ok: rsa.ok, resource: rsa.resource, error: rsa.error });
      }
      const negatives = (spec.negatives || []).map((text) => text.trim()).filter(Boolean).slice(0, 40);
      let blocked = 0;
      let blockErr: string | undefined;
      for (const text of negatives) {
        const neg = await this.writeComponent(externalUserId, 'google_ads-create-or-remove-campaign-criteria', account.id, {}, {
          ...acct,
          operationType: 'create',
          campaignId: campaignNumId,
          negative: true,
          keywordText: text,
          keywordMatchType: 'PHRASE',
        });
        if (neg.ok) blocked++;
        else blockErr = blockErr ?? neg.error;
      }
      if (negatives.length) {
        steps.push({ step: `Block wasted searches (${blocked}/${negatives.length})`, ok: blocked === negatives.length, error: blockErr ? `${blocked}/${negatives.length} blocked. First failure: ${blockErr}` : undefined });
      }
      const schedule = spec.targeting?.schedule;
      const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
      const wantedDays = schedule?.days?.length ? schedule.days : [0, 1, 2, 3, 4, 5, 6];
      let scheduled = 0;
      let scheduleErr: string | undefined;
      for (const day of wantedDays) {
        const name = days[day];
        if (!name) continue;
        const slot = await this.writeComponent(externalUserId, 'google_ads-create-or-remove-campaign-criteria', account.id, {}, {
          ...acct,
          operationType: 'create',
          campaignId: campaignNumId,
          additionalFields: {
            adSchedule: {
              dayOfWeek: name,
              startHour: schedule?.startHour ?? 7,
              startMinute: 'ZERO',
              endHour: schedule?.endHour ?? 20,
              endMinute: 'ZERO',
            },
          },
        });
        if (slot.ok) scheduled++;
        else scheduleErr = scheduleErr ?? slot.error;
      }
      steps.push({ step: 'Set ad schedule', ok: scheduled === wantedDays.length, error: scheduleErr ? `${scheduled}/${wantedDays.length} days set. First failure: ${scheduleErr}` : undefined });
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
          verified = blob.includes(spec.name) || (!!campaign.resource && blob.includes(campaign.resource.split('/').pop() ?? ''));
        }
      } catch {
        /* verification unavailable — reported below */
      }
      steps.push({ step: 'Verify campaign in Google Ads', ok: verifyAttempted ? verified : true, error: verifyAttempted && !verified ? 'Not found in your account — treat as NOT launched.' : verifyAttempted ? undefined : 'Could not independently verify (verification unavailable).' });
    }

    const locationOk = steps.some((step) => /location targeting/i.test(step.step) && step.ok);
    const structureOk = campaignCreated && adGroupCreated && rsaCreated && locationOk;
    const ok = structureOk && (verifyAttempted ? verified : true);
    const link = campaign.resource && customerId ? `https://ads.google.com/aw/campaigns?ocid=&campaignId=${(campaign.resource.match(/campaigns\/(\d+)/) || [])[1] ?? ''}` : undefined;
    const errors = plainStepErrors(steps);
    const note = !campaignCreated
      ? `The campaign was not created in Google Ads. ${errors || 'No step error was returned.'} Nothing was charged.`
      : verifyAttempted && !verified
        ? `Miles could not find this campaign in your Google Ads account afterward. ${errors || 'Treat it as not launched.'} Nothing was charged.`
        : !structureOk
          ? `A paused campaign was created, but it is not complete. ${errors || 'The ad groups or ads did not finish.'} Nothing was charged for a step Google rejected.`
          : `Paused Search campaign created in Google Ads account ${customerId ? `${customerId.slice(0, 3)}-${customerId.slice(3, 6)}-${customerId.slice(6)}` : ''}${verifyAttempted ? '' : ' (structure confirmed; independent verification unavailable)'}. It is PAUSED. Miles does not enable it and does not spend. Turn it on only in Google Ads after you review it. ${planGaps(spec)}`.trim();
    return { ok, live: true, campaignResource: campaign.resource, link, steps, note };
  }

  /**
   * Ask Google for geo_target_constant rows. create-report rejects that
   * resource today, so a thrown call returns [] and the published list is used.
   */
  private async lookupLiveGeo(externalUserId: string, authId: string, pair: { accountId: string; customerClientId?: string }, areas: string[]): Promise<GeoTarget[]> {
    const terms = areaTerms(areas);
    if (!terms.length) return [];
    const pd = await this.backend();
    const rows = await this.listComponents('google_ads');
    const report = rows.find((c) => (c.key ?? c.id ?? c.componentKey) === 'google_ads-create-report');
    if (!report) return [];
    const key = report.key ?? report.id ?? report.componentKey;
    const props = await this.componentProps(report, key);
    const appName = props.find((p: any) => p?.type === 'app')?.name ?? 'googleAds';
    const queryProp = props.find((p: any) => p?.name === 'query' && /gaql|select/i.test(`${p.label ?? ''} ${p.description ?? ''}`));
    const hits: GeoTarget[] = [];
    for (const term of terms) {
      try {
        const configured = geoReportProps({ appName, authId, accountId: pair.accountId, customerClientId: pair.customerClientId, term });
        if (!queryProp) delete configured.query;
        const res = await pd.actions.run({ externalUserId, id: key, configuredProps: configured });
        const picked = chooseGeoHits(term, parseGeoTargets(actionPayload(res)));
        if (picked && picked !== 'ambiguous') hits.push(picked);
      } catch {
        return [];
      }
    }
    return hits;
  }

  /** Read location criteria and the campaign presence setting back from Google. */
  private async readLocationCriteria(externalUserId: string, authId: string, pair: { accountId: string; customerClientId?: string }, campaignId: string, rows: any[]): Promise<{ found: { id: string; negative: boolean }[]; presence?: string }> {
    const pd = await this.backend();
    const acct: Record<string, unknown> = { accountId: pair.accountId };
    if (pair.customerClientId) acct.customerClientId = pair.customerClientId;
    let found: { id: string; negative: boolean }[] = [];
    let presence: string | undefined;
    const list = rows.find((c) => (c.key ?? c.id ?? c.componentKey) === 'google_ads-list-campaign-criteria');
    if (list) {
      try {
        const key = list.key ?? list.id ?? list.componentKey;
        const props = await this.componentProps(list, key);
        const appName = props.find((p: any) => p?.type === 'app')?.name ?? 'googleAds';
        const res = await pd.actions.run({ externalUserId, id: key, configuredProps: { [appName]: { authProvisionId: authId }, ...acct } });
        found = parseLocationCriteria(actionPayload(res)).filter((row) => row.id);
      } catch {
        found = [];
      }
    }
    const report = rows.find((c) => (c.key ?? c.id ?? c.componentKey) === 'google_ads-create-report');
    if (report) {
      try {
        const key = report.key ?? report.id ?? report.componentKey;
        const props = await this.componentProps(report, key);
        const appName = props.find((p: any) => p?.type === 'app')?.name ?? 'googleAds';
        const res = await pd.actions.run({
          externalUserId,
          id: key,
          configuredProps: {
            ...statusReportProps({ appName, authId, pair, resource: 'campaign', ids: [campaignId] }),
            fields: ['geo_target_type_setting.positive_geo_target_type'],
          },
        });
        const payload = actionPayload(res);
        const text = JSON.stringify(payload ?? {});
        const match = text.match(/positiveGeoTargetType"\s*:\s*"([A-Z_]+)"/i) || text.match(/PRESENCE|PRESENCE_OR_INTEREST|SEARCH_INTEREST/);
        presence = match?.[1] || match?.[0];
      } catch {
        presence = undefined;
      }
    }
    return { found, presence };
  }

  /**
   * Read campaign.status, ad_group.status, and ad_group_ad.status by id.
   * The report action builds GAQL from fields. Segments are empty and there
   * is no date range, so a paused campaign with no impressions still returns.
   * accountId is the manager (login-customer-id). customerClientId is the client.
   */
  private async readEnablePayload(externalUserId: string, authId: string, pair: { accountId: string; customerClientId?: string }, campaignId: string, adGroupIds: string[], adIds: string[], rows: any[]): Promise<{ payload: unknown; queriedGroups: boolean }> {
    const pd = await this.backend();
    const chunks: unknown[] = [];
    let queriedGroups = false;
    const run = async (key: string, configuredProps: Record<string, unknown>) => {
      const res = await pd.actions.run({ externalUserId, id: key, configuredProps });
      chunks.push(actionPayload(res));
    };
    const listComp = rows.find((c) => (c.key ?? c.id ?? c.componentKey) === 'google_ads-list-campaigns');
    if (listComp) {
      const lkey = listComp.key ?? listComp.id ?? listComp.componentKey;
      const lprops = await this.componentProps(listComp, lkey);
      const lapp = lprops.find((p: any) => p?.type === 'app')?.name ?? 'googleAds';
      try {
        await run(lkey, {
          [lapp]: { authProvisionId: authId },
          accountId: pair.accountId,
          ...(pair.customerClientId ? { customerClientId: pair.customerClientId } : {}),
        });
      } catch {
        /* the status report still runs */
      }
    }
    const report = rows.find((c) => (c.key ?? c.id ?? c.componentKey) === 'google_ads-create-report')
      ?? rows.find((c) => (c.key ?? c.id ?? c.componentKey) === 'google_ads-create-campaign-report');
    if (report) {
      const key = report.key ?? report.id ?? report.componentKey;
      const props = await this.componentProps(report, key);
      const appName = props.find((p: any) => p?.type === 'app')?.name ?? 'googleAds';
      const reads: { resource: 'campaign' | 'ad_group' | 'ad_group_ad'; ids: string[] }[] = [
        { resource: 'campaign', ids: campaignId ? [campaignId] : [] },
        { resource: 'ad_group', ids: adGroupIds },
        { resource: 'ad_group_ad', ids: adIds },
      ];
      for (const read of reads) {
        try {
          await run(key, statusReportProps({ appName, authId, pair, resource: read.resource, ids: read.ids }));
          if (read.resource !== 'campaign') queriedGroups = true;
        } catch {
          /* one resource can fail without hiding the others */
        }
      }
    }
    return { payload: chunks, queriedGroups };
  }

  /**
   * Update one campaign's status through google_ads-create-or-update-campaign.
   * Google Ads CampaignStatus values used here are ENABLED and PAUSED.
   * A production tool-call block returns before any actions.run.
   */
  async setGoogleCampaignStatus(externalUserId: string, args: { campaignResource: string; status: 'ENABLED' | 'PAUSED'; adGroupResources?: string[]; adResources?: string[] }): Promise<{ ok: boolean; live: boolean; called: boolean; missing?: boolean; note: string; readback?: import('../agents/enablecheck.js').EnableReadback }> {
    if (args.status !== 'ENABLED' && args.status !== 'PAUSED') {
      return { ok: false, live: false, called: false, note: 'Only ENABLED or PAUSED are allowed.' };
    }
    const blocked = this.gadsBlock.get(externalUserId);
    if (blocked?.kind === 'connect_production_unavailable') {
      return { ok: false, live: false, called: false, note: blocked.message };
    }
    const campaignId = (args.campaignResource.match(/campaigns\/(\d+)/) || [])[1];
    if (!campaignId) return { ok: false, live: false, called: false, note: 'That is not a Google campaign resource. Nothing was changed.' };
    const accts = await this.listAccounts(externalUserId, 'google_ads');
    const account = accts.find((a) => a.healthy) ?? accts[0];
    if (!account) return { ok: false, live: false, called: false, note: 'Google Ads is not connected for this account. Nothing was changed.' };
    const rows = await this.listComponents('google_ads');
    const targets = await this.resolveGadsTargets(externalUserId, account.id, rows);
    if (this.gadsBlock.get(externalUserId)?.kind === 'connect_production_unavailable') {
      return { ok: false, live: false, called: false, note: this.gadsBlock.get(externalUserId)!.message };
    }
    const target = this.preferTargets(externalUserId, targets)[0];
    const pair = customerPair({ resource: args.campaignResource, login: target?.login, client: target?.client });
    const acct: Record<string, unknown> = { accountId: pair.accountId };
    if (pair.customerClientId) acct.customerClientId = pair.customerClientId;
    const cleared = 'That campaign is no longer in the Google Ads account. Miles cleared the saved campaign. Nothing was changed.';
    const result = await this.writeComponent(externalUserId, 'google_ads-create-or-update-campaign', account.id, {}, {
      ...acct,
      operationType: 'update',
      campaignId,
      updateMask: 'status',
      status: args.status,
    });
    if (googleResourceMissing(result.error)) {
      return { ok: false, live: true, called: true, missing: true, note: cleared };
    }
    const writeErrors: string[] = [];
    if (!result.ok && result.error) writeErrors.push(result.error);
    for (const resource of args.adGroupResources ?? []) {
      const adGroupId = resource.split('/').pop();
      if (!adGroupId) continue;
      const updated = await this.writeComponent(externalUserId, 'google_ads-create-or-update-ad-group', account.id, {}, {
        ...acct,
        operationType: 'update',
        adGroupId,
        updateMask: 'status',
        status: args.status,
      });
      if (googleResourceMissing(updated.error)) writeErrors.push(`Ad group ${adGroupId} is not in the account.`);
      else if (!updated.ok && updated.error) writeErrors.push(updated.error);
    }
    const adKey = ['google_ads-update-ad-group-ad', 'google_ads-create-or-update-ad-group-ad'].find((key) => rows.some((c) => (c.key ?? c.id ?? c.componentKey) === key));
    if (adKey) {
      for (const resource of args.adResources ?? []) {
        const adId = resource.split('/').pop();
        if (!adId) continue;
        const updated = await this.writeComponent(externalUserId, adKey, account.id, {}, {
          ...acct,
          operationType: 'update',
          adId,
          updateMask: 'status',
          status: args.status,
        });
        if (!updated.ok && updated.error && !googleResourceMissing(updated.error)) writeErrors.push(updated.error);
      }
    }
    const passedGroups = (args.adGroupResources ?? []).map((resource) => resource.split('/').pop() || '').filter(Boolean);
    const passedAds = (args.adResources ?? []).map((resource) => resource.split('/').pop() || '').filter(Boolean);
    const readOnce = async (): Promise<import('../agents/enablecheck.js').EnableReadback> => {
      const { payload, queriedGroups } = await this.readEnablePayload(externalUserId, account.id, pair, campaignId, passedGroups, passedAds, rows);
      const discovered = collectReadIds(payload);
      const readback = parseGoogleStatuses(payload, {
        campaignId,
        adGroupIds: passedGroups.length ? passedGroups : discovered.adGroupIds,
        adIds: passedAds.length ? passedAds : discovered.adIds,
      });
      if (!queriedGroups) readback.note = 'The campaign list does not include ad group status. Miles could not read ad groups back from Google.';
      if (readback.campaign !== 'UNKNOWN') readback.note = readback.note.replace(/UNKNOWN/g, '').trim();
      return readback;
    };
    let readback: import('../agents/enablecheck.js').EnableReadback = {
      campaign: 'UNKNOWN',
      adGroups: passedGroups.map(() => 'UNKNOWN' as const),
      ads: passedAds.map(() => 'UNKNOWN' as const),
      note: 'Miles could not read the status back from Google.',
    };
    try {
      readback = args.status === 'ENABLED'
        ? await retryReadback(readOnce, 'ENABLED', { tries: 3, waitMs: 300 })
        : await readOnce();
    } catch {
      /* readback stays unknown */
    }
    const ready = args.status === 'ENABLED'
      ? readback.campaign === 'ENABLED' && readback.adGroups.length > 0 && readback.adGroups.every((status) => status === 'ENABLED') && readback.ads.length > 0 && readback.ads.every((status) => status === 'ENABLED')
      : readback.campaign === 'PAUSED';
    const extra = writeErrors.filter(Boolean).join(' ');
    const googleSaid = plainGoogleError(extra);
    const readSentence = readback.campaign === 'UNKNOWN'
      ? ''
      : `The campaign reads as ${readback.campaign}.`;
    const note = googleResourceMissing(extra)
      ? cleared
      : googleSaid
        ? [googleSaid, readSentence].filter(Boolean).join(' ')
        : ready
          ? (args.status === 'ENABLED'
            ? 'Google reports the campaign, its ad groups, and its ads as enabled.'
            : 'Google reports the campaign as PAUSED.')
          : [readSentence, readback.note].filter(Boolean).join(' ');
    return {
      ok: result.ok && (args.status === 'PAUSED' ? readback.campaign !== 'UNKNOWN' || result.ok : ready) && !googleResourceMissing(extra),
      live: true,
      called: true,
      missing: googleResourceMissing(extra),
      note,
      readback,
    };
  }

  /**
   * Read campaign status through google_ads-list-campaigns. This is the same
   * list the enable path uses for read-back, and it does not update anything.
   */
  async readGoogleCampaignStatus(externalUserId: string, campaignResource?: string): Promise<import('../agents/enablecheck.js').GoogleCampaignRead> {
    const blocked = this.gadsBlock.get(externalUserId);
    if (blocked?.kind === 'connect_production_unavailable') {
      return { live: false, called: false, sample: false, note: blocked.message, campaigns: [] };
    }
    try {
      const accts = await this.listAccounts(externalUserId, 'google_ads');
      const account = accts.find((a) => a.healthy) ?? accts[0];
      if (!account) return { live: false, called: false, sample: false, note: 'Google Ads is not connected for this account.', campaigns: [] };
      const rows = await this.listComponents('google_ads');
      const targets = await this.resolveGadsTargets(externalUserId, account.id, rows);
      const again = this.gadsBlock.get(externalUserId);
      if (again?.kind === 'connect_production_unavailable') {
        return { live: false, called: false, sample: false, note: again.message, campaigns: [] };
      }
      const target = this.preferTargets(externalUserId, targets)[0];
      const pair = customerPair({ resource: campaignResource, login: target?.login, client: target?.client });
      const acct: Record<string, unknown> = { accountId: pair.accountId };
      if (pair.customerClientId) acct.customerClientId = pair.customerClientId;
      const listComp = rows.find((c) => (c.key ?? c.id ?? c.componentKey) === 'google_ads-list-campaigns');
      if (!listComp) {
        return { live: false, called: false, sample: false, note: 'google_ads-list-campaigns is not available on this connection, so Miles could not read campaign status.', campaigns: [] };
      }
      const pd = await this.backend();
      const lkey = listComp.key ?? listComp.id ?? listComp.componentKey;
      const lprops = await this.componentProps(listComp, lkey);
      const lapp = lprops.find((p: any) => p?.type === 'app')?.name ?? 'googleAds';
      const res = await pd.actions.run({ externalUserId, id: lkey, configuredProps: { [lapp]: { authProvisionId: account.id }, ...acct } });
      const payload = actionPayload(res) ?? {};
      const campaignId = (campaignResource?.match(/campaigns\/(\d+)/) || [])[1];
      const readback = parseGoogleStatuses(payload, { campaignId, adGroupIds: [], adIds: [] });
      const campaigns = listCampaignRows(payload);
      return {
        live: true,
        called: true,
        sample: false,
        note: campaigns.length ? 'Read from Google Ads just now.' : readback.note,
        readback,
        campaigns,
      };
    } catch {
      return { live: false, called: false, sample: false, note: 'Miles could not read campaign status from Google.', campaigns: [] };
    }
  }

  // ── Meta (Facebook/Instagram) campaign launch — direct Graph API ────────────
  // Connected via three Render env vars from the owner's Meta ad account:
  //   META_ADS_ACCESS_TOKEN  — a token with ads_management on the ad account
  //   META_AD_ACCOUNT_ID     — the numeric ad-account id (no "act_" prefix)
  //   META_PAGE_ID           — the Facebook Page the ads run under
  // Everything is created PAUSED, so it lands as a draft the owner reviews and
  // flips live in Ads Manager. Nothing here can spend money.
  metaLaunchReady(): { ready: boolean; account?: string; note: string } {
    return { ready: false, note: _META_NOTE };
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
    return { ok: false, live: false, steps: [{ step: 'Meta ad account', ok: false, error: ready.note }], note: ready.note };

  }

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
      this.dropAccountCache(externalUserId);
      this.projectGen.forEach((_v, key) => {
        this.projectGen.set(key, (this.projectGen.get(key) ?? 0) + 1);
        this.projectInflight.delete(key);
      });
      this.projectCache.clear();
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
        let errMsg = '';
        try {
          const rows = await this.listComponents('google_ads');
          await this.googleAdsCustomerIds(externalUserId, primary.id, rows);
        } catch (e) {
          errMsg = explainPipedreamError(e).message;
        }
        const access = this.gadsAccess.get(externalUserId);
        const blocked = this.gadsBlock.get(externalUserId);
        detail.ready = access?.kind === 'ready' && !blocked;
        if (blocked) {
          detail.note = `${blocked.message} Provider said: ${blocked.providerMessage}`;
          detail.rows!.push({ k: 'OAuth', v: 'Connected. This is not campaign readiness' });
          detail.rows!.push({ k: 'Ad account (customer) ID', v: 'Not resolved' });
        } else if (access?.kind === 'ready' && access.selectedId) {
          detail.rows!.push({ k: 'Ad account (customer) ID', v: fmt(access.selectedId) });
          if (access.loginCustomerId && access.loginCustomerId !== access.selectedId) detail.rows!.push({ k: 'Login customer id', v: fmt(access.loginCustomerId) });
          detail.note = 'OAuth is connected and a Google Ads customer id is selected. A paused create still needs a separate approval.';
        } else if (access?.kind === 'choose') {
          detail.rows!.push({ k: 'Ad account (customer) ID', v: 'Choose one' });
          detail.note = access.reason;
          detail.choices = access.customers.map((c) => ({ id: c.id, label: c.label }));
        } else if (access?.kind === 'manager_only') {
          detail.rows!.push({ k: 'Ad account (customer) ID', v: 'None' });
          if (access.loginCustomerId) detail.rows!.push({ k: 'Login customer id', v: fmt(access.loginCustomerId) });
          detail.note = access.reason;
        } else if (access?.kind === 'none' || access?.kind === 'error') {
          detail.rows!.push({ k: 'Ad account (customer) ID', v: access.kind === 'none' ? 'None' : 'Not resolved' });
          detail.note = access.reason;
        } else {
          detail.rows!.push({ k: 'Ad account (customer) ID', v: 'Not resolved' });
          detail.note = errMsg || 'Google is signed in. The customer id was not resolved, so Miles cannot read spend or create a campaign.';
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
    const targets = await this.resolveGadsTargets(externalUserId, account.id, rows);
    const blocked = this.gadsBlock.get(externalUserId);
    if (blocked?.kind === 'connect_production_unavailable') {
      return { ok: false, live: false, uploaded: 0, failed: items.length, steps: items.map((i) => ({ dealId: i.dealId, ok: false, error: blocked.providerMessage })), note: `${blocked.message} Nothing was uploaded.` };
    }
    const target = targets[0];
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
    for (const app of ['highlevel_oauth', 'gohighlevel', 'highlevel', 'leadconnector', 'hubspot', 'salesforce_rest_api', 'servicetitan', 'jobber', 'housecall_pro']) {
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

function planGaps(spec: import('../agents/campaign.js').CampaignSpec): string {
  // Checked 2026-11-12 against Pipedream's google_ads actions. There is no
  // generic mutate or API-request action, and no call, sitelink, or callout
  // action. Those stay on the plan only.
  const places = (spec.geoTargets || []).map((target) => target.name).join(', ');
  const parts = [
    places ? `Location targeting is Presence only for ${places}.` : '',
    spec.callAsset?.phone ? 'The call number is on the plan. This connection has no call asset action, so the call button was not created.' : '',
    (spec.sitelinks?.length || spec.callouts?.length) ? 'Sitelinks and callouts are on the plan. This connection has no asset action, so they were not created in Google.' : '',
  ].filter(Boolean);
  return parts.join(' ');
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
/**
 * Harvest {customerId → descriptive name} pairs from a list-customer-clients
 * style response: any object carrying both a 10-digit customer id and a
 * human name field (descriptiveName etc.) contributes a pair.
 */
function collectCustomerNames(v: unknown, into: Map<string, string>, depth = 0): void {
  if (v == null || depth > 6 || typeof v !== 'object') return;
  if (Array.isArray(v)) {
    for (const x of v) collectCustomerNames(x, into, depth + 1);
    return;
  }
  const o = v as Record<string, unknown>;
  let id: string | undefined;
  let name: string | undefined;
  for (const [k, val] of Object.entries(o)) {
    if (typeof val !== 'string' && typeof val !== 'number') continue;
    const s = String(val);
    const m = s.match(/customers\/(\d{10})/);
    const digits = s.replace(/[^\d]/g, '');
    if (m?.[1]) id ??= m[1];
    else if (/^\d{10}$/.test(digits) && /id|customer/i.test(k)) id ??= digits;
    if (typeof val === 'string' && /name/i.test(k) && !/resource/i.test(k) && val.trim() && !/^[\d\s-]+$/.test(val)) name ??= val.trim();
  }
  if (id && name) into.set(id, name);
  for (const val of Object.values(o)) collectCustomerNames(val, into, depth + 1);
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
