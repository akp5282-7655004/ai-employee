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

import type { CampaignSpend, Deal } from '../revenue/attribution.js';

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

export interface SocialMetrics {
  impressions: number;
  clicks: number;
  likes: number;
  followers?: number;
}
export interface Review {
  author?: string;
  rating: number;
  text?: string;
  platform?: string;
}
export interface Lead {
  /** Stable CRM id when the source provides one — used to dedup instant responses. */
  id?: string;
  name?: string;
  service?: string;
  source?: string;
  /** Contact channels, when the CRM exposes them (lets Miles send the first touch). */
  phone?: string;
  email?: string;
  /** What the lead actually asked, when captured (form message / call note). */
  message?: string;
  /** When the lead came in (ISO) — used to measure speed-to-first-response. */
  createdAt?: string;
  contacted?: boolean;
}

/** One inbox message an agent can read (the raw material for the task-list agent). */
export interface EmailMessage {
  from?: string;
  subject?: string;
  snippet?: string;
  date?: string;
  unread?: boolean;
}

/** A "do this in my app" task, resolved from plain English (the "hands"). */
export interface AppTaskRequest {
  externalUserId: string;
  /** App slug, e.g. "gohighlevel". */
  app: string;
  /** Short phrase naming the action to discover, e.g. "create contact". */
  query: string;
  /** Semantic inputs — email / firstName / phone / message / note / tag / … —
   * mapped onto the real component's props by the connector. */
  params: Record<string, string>;
}

export interface AppTaskResult extends RunActionResult {
  /** The discovered component key that ran (or would have). */
  componentKey?: string;
  /** A friendly, human-readable summary of what happened. */
  summary: string;
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

/** One write in the campaign-launch chain (budget, campaign, ad group, …). */
export interface CampaignLaunchStep {
  step: string;
  ok: boolean;
  /** The created resource name/id (e.g. customers/123/campaigns/456), when known. */
  resource?: string;
  error?: string;
}
export interface CampaignLaunchResult {
  ok: boolean;
  /** True when the writes actually hit Google Ads (vs. a simulated/demo run). */
  live: boolean;
  campaignResource?: string;
  /** A Google Ads UI link to the created campaign, when resolvable. */
  link?: string;
  steps: CampaignLaunchStep[];
  note?: string;
}

export interface Connector {
  readonly name: string;
  /** Mint a short-lived token so an end-user can connect an app account. */
  createConnectToken(externalUserId: string): Promise<ConnectTokenResult>;
  /** List the app accounts a user has connected (optionally filtered by app). */
  listAccounts(externalUserId: string, app?: string): Promise<ConnectedAccount[]>;
  /** Run an app action on the user's behalf — the "hands". */
  runAction(req: RunActionRequest): Promise<RunActionResult>;
  /** Resolve a plain-English task to a real app action and run it (discover +
   * attach the connected account + map params + execute). The "employee hands". */
  runAppTask?(req: AppTaskRequest): Promise<AppTaskResult>;
  /** Browse/search the connector's app catalog (Pipedream's registry), paginated. */
  listApps?(query?: string, limit?: number, after?: string): Promise<{ apps: AppInfo[]; after?: string }>;
  /** Ad spend by campaign from connected ad platforms — for revenue attribution.
   *  `range` is a Google-Ads-style preset (e.g. LAST_30_DAYS); defaults to 30d. */
  getAdSpend?(externalUserId: string, range?: string): Promise<CampaignSpend[]>;
  /** Create a full Google Ads Search campaign (budget → campaign → ad groups →
   *  keywords → RSAs) on the user's behalf. The owner has already approved every
   *  setting; this performs the live write-chain and reports each step. */
  launchCampaign?(externalUserId: string, spec: import('../agents/campaign.js').CampaignSpec): Promise<CampaignLaunchResult>;
  /** Deals from connected CRMs — for revenue attribution. */
  getDeals?(externalUserId: string): Promise<Deal[]>;
  /** Recent inbox messages — the raw material for the morning task-list agent. */
  getRecentEmails?(externalUserId: string, limit?: number): Promise<EmailMessage[]>;
  /** Yesterday's social metrics — for the social content agent's report. */
  getSocialMetrics?(externalUserId: string): Promise<SocialMetrics | null>;
  /** New reviews — for the review-responder agent. */
  getReviews?(externalUserId: string): Promise<Review[]>;
  /** New / uncontacted leads — for the lead-follow-up agent. */
  getLeads?(externalUserId: string): Promise<Lead[]>;
  /**
   * Diagnostic: run the raw read pipeline for an app and report what comes back —
   * whether the account is connected, how many rows, a sample row (unmapped), and
   * any error. Used to verify/lock the live field mapping against a real account.
   */
  probe?(externalUserId: string, app: string, query?: string): Promise<{ connected: boolean; count: number; sample: unknown; error?: string; trace?: Record<string, unknown> }>;
  /**
   * Mark an app connected for a user. Present on the mock (a demo shortcut); on
   * live Pipedream the real connection happens through the connect-token flow, so
   * this is optional.
   */
  connect?(externalUserId: string, app: string): void;
}
