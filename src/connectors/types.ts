/**
 * The **connector seam** (docs/VISION.md §3) — the boundary between our engine
 * and the ~3,000-app long tail. Pipedream Connect is the first implementation;
 * anything else (a native ad-platform client, a CRM) implements the same
 * interface. The engine only ever talks to this — it never knows which connector
 * is behind it, exactly like the "mock by default, live when configured" pattern.
 *
 * "Account ownership" (VISION §5, objection #3): the customer owns their app
 * accounts. We connect *in* on their behalf via a short-lived token; we never
 * hold their credentials or their spend.
 */

export interface ConnectTokenResult {
  /** Short-lived token the frontend uses to open the connect flow. */
  token: string;
  /** ISO timestamp when the token expires. */
  expiresAt: string;
  /** Hosted URL that lets the end-user connect an app account. */
  connectUrl: string;
}

export interface ConnectedAccount {
  id: string;
  /** App slug, e.g. "google_ads", "google_my_business", "facebook_pages". */
  app: string;
  name?: string;
  externalUserId: string;
  /** Connection-health flag — surfaced so we can nudge reconnects (VISION §5). */
  healthy: boolean;
}

export interface RunActionRequest {
  externalUserId: string;
  /** The action/component id to run, e.g. "google_ads-create-campaign". */
  actionId: string;
  /** Configured inputs for the action. */
  configuredProps?: Record<string, unknown>;
}

export interface RunActionResult {
  ok: boolean;
  actionId: string;
  app?: string;
  /** Whatever the action returned (a created campaign id, a report, …). */
  output: unknown;
  note?: string;
}

/** One app in the connector's catalog (Pipedream's ~3,000-app registry). */
export interface AppInfo {
  slug: string;
  name: string;
  description?: string;
  /** Logo URL. */
  img?: string;
  categories?: string[];
}

export interface Connector {
  readonly name: string;
  /** Mint a short-lived token so an end-user can connect an app account. */
  createConnectToken(externalUserId: string): Promise<ConnectTokenResult>;
  /** List the app accounts a user has connected (optionally filtered by app). */
  listAccounts(externalUserId: string, app?: string): Promise<ConnectedAccount[]>;
  /** Run an app action on the user's behalf — the "hands". */
  runAction(req: RunActionRequest): Promise<RunActionResult>;
  /** Browse/search the connector's app catalog (Pipedream's registry), paginated. */
  listApps?(query?: string, limit?: number, after?: string): Promise<{ apps: AppInfo[]; after?: string }>;
  /**
   * Mark an app connected for a user. Present on the mock (a demo shortcut); on
   * live Pipedream the real connection happens through the connect-token flow, so
   * this is optional.
   */
  connect?(externalUserId: string, app: string): void;
}
