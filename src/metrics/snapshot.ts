/**
 * Platform snapshot — the dashboard's read path.
 *
 * Reading Google Ads or the CRM means Miles → Pipedream → the platform: many
 * round-trips, seconds each. Doing that inside an HTTP request makes the
 * dashboard as slow as the slowest platform that minute.
 *
 * Instead, a background worker refreshes each active account into a stored
 * snapshot and every read serves the snapshot. Requests never wait on a
 * platform. The cost is staleness measured in minutes — irrelevant for
 * marketing data, where Google's own reporting lags hours.
 *
 * Behaviour is stale-while-revalidate: a missing snapshot is fetched once
 * (so a brand-new account still sees real numbers), a stale one is served
 * immediately while a refresh runs behind it.
 */
import type { Connector } from '../connectors/types.js';
import type { CampaignSpend, Deal } from '../revenue/attribution.js';

export interface PlatformSnapshot {
  /** When the platforms were last read. */
  ts: string;
  /** Full per-campaign rows as the ad platforms returned them, trailing 30 days. */
  campaigns: CampaignSpend[];
  /** Total spend across `campaigns`, or undefined when no campaign was read. */
  adSpend?: number;
  deals: Deal[];
  searchTerms: { term: string; cost: number; clicks: number; conversions: number }[];
  leads: unknown[];
  reviews: unknown[];
  social: unknown | null;
}

/** Serve a snapshot this old without refreshing. */
export const FRESH_MS = 5 * 60_000;
/** Beyond this, a background refresh is started (the stale copy is still served). */
export const STALE_MS = 5 * 60_000;

const CAPS = { spend: 100, deals: 300, terms: 300, leads: 100, reviews: 100 };

export function readSnapshot(data: Record<string, unknown>): PlatformSnapshot | undefined {
  const s = data.snapshot as PlatformSnapshot | undefined;
  return s && typeof s.ts === 'string' ? s : undefined;
}

/** The shape the seven skills read: campaign name + cost + conversions. */
export function spendRowsOf(s: PlatformSnapshot | undefined): { campaign: string; cost: number; conversions?: number }[] {
  return (s?.campaigns ?? []).map((r) => ({ campaign: r.campaign, cost: r.spend || 0, conversions: r.conversions }));
}

export function snapshotAgeMs(s: PlatformSnapshot | undefined): number {
  if (!s) return Number.POSITIVE_INFINITY;
  const t = Date.parse(s.ts);
  return Number.isFinite(t) ? Date.now() - t : Number.POSITIVE_INFINITY;
}

/** Read every platform once and build a snapshot. Never throws — a platform
 *  that fails contributes nothing rather than failing the whole refresh. */
export async function buildSnapshot(connector: Connector, userId: string): Promise<PlatformSnapshot> {
  const safe = async <T>(fn: (() => Promise<T>) | undefined, empty: T): Promise<T> => {
    try { return fn ? await fn() : empty; } catch { return empty; }
  };
  const [spendRows, deals, searchTerms, leads, reviews, social] = await Promise.all([
    safe(connector.getAdSpend ? () => connector.getAdSpend!(userId) : undefined, [] as CampaignSpend[]),
    safe(connector.getDeals ? () => connector.getDeals!(userId) : undefined, [] as Deal[]),
    safe(connector.getSearchTerms ? () => connector.getSearchTerms!(userId) : undefined, [] as { term: string; cost: number; clicks: number; conversions: number }[]),
    safe(connector.getLeads ? () => connector.getLeads!(userId) : undefined, [] as unknown[]),
    safe(connector.getReviews ? () => connector.getReviews!(userId) : undefined, [] as unknown[]),
    safe(connector.getSocialMetrics ? () => connector.getSocialMetrics!(userId) : undefined, null as unknown),
  ]);
  const campaigns = spendRows.slice(0, CAPS.spend);
  return {
    ts: new Date().toISOString(),
    campaigns,
    adSpend: campaigns.length ? Math.round(campaigns.reduce((a, r) => a + (r.spend || 0), 0) * 100) / 100 : undefined,
    deals: deals.slice(0, CAPS.deals),
    searchTerms: searchTerms.slice(0, CAPS.terms),
    leads: leads.slice(0, CAPS.leads),
    reviews: reviews.slice(0, CAPS.reviews),
    social,
  };
}
