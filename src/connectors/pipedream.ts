import type { Config } from '../config.js';
import type {
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
 *  - `runAction` is left as an explicit TODO. The connect-token and accounts calls
 *    are verified against the public API reference; the action-run surface was not
 *    reachable from the build environment (pipedream.com egress is blocked), so it
 *    is not shipped half-known. The mock connector implements it for now.
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
    // Hidden from the static module graph so tsc/npm don't require the package
    // until the connector actually goes live.
    const importDynamic = new Function('m', 'return import(m)') as (m: string) => Promise<any>;
    let sdk: any;
    try {
      sdk = await importDynamic('@pipedream/sdk/server');
    } catch {
      throw new Error('Live Pipedream connector needs the SDK — run: npm install @pipedream/sdk');
    }
    this.client = sdk.createBackendClient({
      environment,
      projectId,
      credentials: { clientId, clientSecret },
    });
    return this.client;
  }

  async createConnectToken(externalUserId: string): Promise<ConnectTokenResult> {
    const pd = await this.backend();
    const res = await pd.createConnectToken({ external_user_id: externalUserId });
    return {
      token: res.token,
      expiresAt: res.expires_at,
      connectUrl: res.connect_link_url,
    };
  }

  async listAccounts(externalUserId: string, app?: string): Promise<ConnectedAccount[]> {
    const pd = await this.backend();
    const res = await pd.getAccounts({ external_user_id: externalUserId, app });
    const rows: any[] = res?.data ?? res?.accounts ?? res ?? [];
    return rows.map((a) => ({
      id: a.id,
      app: a.app?.name_slug ?? a.app?.name ?? a.app ?? 'unknown',
      name: a.name,
      externalUserId,
      healthy: a.healthy ?? true,
    }));
  }

  async runAction(_req: RunActionRequest): Promise<RunActionResult> {
    // Intentionally not implemented against the live API yet — see class docstring.
    throw new Error(
      'PipedreamConnector.runAction is not wired to the live API yet. Verify the ' +
        'runAction/component-run surface against the Connect API reference, then implement here.',
    );
  }
}
