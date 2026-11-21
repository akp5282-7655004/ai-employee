/**
 * Living playbook types.
 *
 * Daily rows keep an internal account id so a deletion or opt-out can remove
 * that account. Aggregation rows and every outward payload omit it. Names,
 * phones, emails, and addresses are never fields on these rows.
 */

export const PLATFORMS = ['google_ads', 'google_lsa', 'meta', 'tiktok'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const METRICS = ['cpl', 'cpc', 'cpa', 'roas'] as const;
export type Metric = (typeof METRICS)[number];

export const TRADES = ['hvac', 'plumbing', 'electrical', 'roofing', 'painting', 'solar', 'landscaping'] as const;
export type Trade = (typeof TRADES)[number];

export interface DailyRow {
  /** Internal only. Never copied onto an aggregate or an API payload. */
  accountId: string;
  /** YYYY-MM-DD, the day these figures describe. */
  day: string;
  platform: Platform;
  campaignType: string;
  trade: string;
  trackingVerified: boolean;
  accountActive: boolean;
  consent: boolean;
  spend: number;
  clicks: number;
  impressions: number;
  leads: number;
  conversions: number;
  bookedJobs: number;
  revenue: number;
  cpl: number | null;
  cpc: number | null;
  cpa: number | null;
  roas: number | null;
}

export interface Membership {
  /** Internal only. */
  accountId: string;
  trade: string;
  active: boolean;
  /** False after the owner opts out. The account still counts in N. */
  consent: boolean;
  trackingVerified: boolean;
  platforms: Platform[];
}

export type AggregateReason = 'published' | 'below_minimum' | 'spend_concentration' | 'no_contributors';

export interface AggregateRow {
  trade: string;
  platform: Platform;
  metric: Metric;
  windowDays: number;
  asOf: string;
  /** Null when the cohort is not publishable. The number is not stored for show. */
  median: number | null;
  p25: number | null;
  p75: number | null;
  contributorCount: number;
  /** Active accounts in this trade with this platform connected. */
  cohortN: number;
  requiredCount: number;
  published: boolean;
  spendCapOk: boolean;
  totalSpend: number;
  reason: AggregateReason;
}

/** What the resolver needs from Miles. No account ids. */
export interface MilesCohort {
  published: boolean;
  median: number | null;
  p25: number | null;
  p75: number | null;
  contributors: number;
  required: number;
  cohortN: number;
  spendCapOk: boolean;
}

export const EMPTY_COHORT: MilesCohort = {
  published: false,
  median: null,
  p25: null,
  p75: null,
  contributors: 0,
  required: 5,
  cohortN: 0,
  spendCapOk: true,
};
