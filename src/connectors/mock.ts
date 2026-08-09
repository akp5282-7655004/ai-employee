import type {
  ConnectedAccount,
  ConnectTokenResult,
  Connector,
  RunActionRequest,
  RunActionResult,
} from './types.js';

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
