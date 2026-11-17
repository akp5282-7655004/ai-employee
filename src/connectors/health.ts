import type { ConnectedAccount } from './types.js';

/**
 * Connection health, in one place.
 *
 * Pipedream marks an account `healthy: false` when the owner revoked access or
 * the platform's token stopped working. Such an account is not connected: Miles
 * must not count it, and must not run an action on it (the call would fail with
 * the platform's raw error, or worse, act on a stale login).
 */

/** The healthy account to act with, or undefined. Never falls back to a broken one. */
export function healthyAccount<T extends Pick<ConnectedAccount, 'healthy'>>(accounts: T[]): T | undefined {
  return accounts.find((a) => a.healthy !== false);
}

/** Apps with at least one healthy account, and apps whose every account needs a reconnect. */
export function splitByHealth(accounts: Pick<ConnectedAccount, 'app' | 'healthy'>[]): { connectedApps: string[]; needsReconnect: string[] } {
  const ok = new Set<string>();
  const broken = new Set<string>();
  for (const a of accounts) (a.healthy === false ? broken : ok).add(a.app);
  return { connectedApps: [...ok], needsReconnect: [...broken].filter((app) => !ok.has(app)) };
}

const NAMES: Record<string, string> = {
  google_ads: 'Google Ads',
  google_my_business: 'Google Business Profile',
  facebook: 'Meta',
  facebook_pages: 'Facebook Pages',
  facebook_graph_api: 'Meta',
  gohighlevel: 'GoHighLevel',
  highlevel_oauth: 'GoHighLevel',
  gmail: 'Gmail',
  tiktok_ads_manager: 'TikTok Ads',
};

/** Plain sentence for an account that needs a reconnect. */
export function reconnectNote(app: string): string {
  const name = NAMES[app] ?? app.replace(/_/g, ' ');
  return `Your ${name} connection stopped working (access was revoked or expired). Reconnect ${name} in Integrations. Nothing was changed.`;
}
