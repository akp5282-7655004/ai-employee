import type { Config } from '../config.js';
import type {
  AppInfo,
  ConnectedAccount,
  ConnectTokenResult,
  Connector,
  RunActionRequest,
  RunActionResult,
} from './types.js';

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

  async listApps(query?: string, limit = 60): Promise<AppInfo[]> {
    const pd = await this.backend();
    const res = await pd.apps.list({ q: query || undefined, limit, hasActions: true });
    const rows: any[] = res?.data ?? (Array.isArray(res) ? res : (res?.items ?? []));
    return rows.map((a) => ({
      slug: a.nameSlug ?? a.name_slug,
      name: a.name,
      description: a.description,
      img: a.imgSrc ?? a.img_src,
      categories: a.categories ?? [],
    }));
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
}
