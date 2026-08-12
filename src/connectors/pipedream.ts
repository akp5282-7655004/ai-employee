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
}

const lower = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

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
