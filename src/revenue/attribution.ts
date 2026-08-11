/**
 * Closed-loop revenue attribution — the differentiator (spec §"Closed-Loop
 * Revenue Optimization"). It correlates on-platform ad spend to real CRM deals by
 * UTM, so Miles optimizes to booked revenue and customer quality, not form fills.
 *
 * This module is pure and deterministic — the math is fully testable without any
 * network. The connector supplies the raw spend + deals (real via Pipedream when a
 * CRM/ad account is connected, empty otherwise).
 */

export interface CampaignSpend {
  platform: string; // 'google_ads' | 'facebook' | …
  campaign: string; // human name
  utm: string; // utm_campaign this spend is tagged with
  spend: number;
  clicks?: number;
  conversions?: number;
}

export interface Deal {
  id: string;
  value: number; // deal / job value
  won: boolean;
  utmSource?: string; // e.g. 'google_ads'
  utmCampaign?: string; // matches CampaignSpend.utm
  createdAt?: string;
}

export interface AttributedRow {
  key: string; // platform or campaign name
  platform: string;
  spend: number;
  revenue: number;
  deals: number;
  wonDeals: number;
  roas: number; // revenue / spend
  costPerCustomer: number; // spend / wonDeals
}

export interface RevenueReport {
  totalSpend: number;
  attributedRevenue: number;
  blendedRoas: number;
  wonDeals: number;
  costPerCustomer: number;
  byPlatform: AttributedRow[];
  byCampaign: AttributedRow[];
  /** Won deals whose UTM matched no known campaign — a tracking gap to fix. */
  unattributedRevenue: number;
}

const norm = (s?: string): string => (s || '').trim().toLowerCase();
const round2 = (n: number): number => Math.round(n * 100) / 100;

function row(key: string, platform: string, spend: number, matched: Deal[]): AttributedRow {
  const won = matched.filter((d) => d.won);
  const revenue = won.reduce((s, d) => s + (d.value || 0), 0);
  return {
    key,
    platform,
    spend: Math.round(spend),
    revenue: Math.round(revenue),
    deals: matched.length,
    wonDeals: won.length,
    roas: spend > 0 ? round2(revenue / spend) : 0,
    costPerCustomer: won.length > 0 ? Math.round(spend / won.length) : 0,
  };
}

/** Correlate spend to deals by utm_campaign and roll up ROAS by campaign + platform. */
export function attributeRevenue(spend: CampaignSpend[], deals: Deal[]): RevenueReport {
  const dealsByCampaign = new Map<string, Deal[]>();
  for (const d of deals) {
    const k = norm(d.utmCampaign);
    if (!k) continue;
    (dealsByCampaign.get(k) ?? dealsByCampaign.set(k, []).get(k)!).push(d);
  }

  const byCampaign: AttributedRow[] = spend.map((s) =>
    row(s.campaign, s.platform, s.spend, dealsByCampaign.get(norm(s.utm)) ?? []),
  );

  // Platform rollup.
  const platMap = new Map<string, { spend: number; matched: Deal[] }>();
  for (const s of spend) {
    const agg = platMap.get(s.platform) ?? { spend: 0, matched: [] };
    agg.spend += s.spend;
    agg.matched.push(...(dealsByCampaign.get(norm(s.utm)) ?? []));
    platMap.set(s.platform, agg);
  }
  const byPlatform: AttributedRow[] = [...platMap.entries()].map(([p, v]) => row(p, p, v.spend, v.matched));

  const totalSpend = spend.reduce((s, x) => s + x.spend, 0);
  const knownUtms = new Set(spend.map((s) => norm(s.utm)));
  const attributedRevenue = byCampaign.reduce((s, r) => s + r.revenue, 0);
  const unattributedRevenue = deals
    .filter((d) => d.won && !knownUtms.has(norm(d.utmCampaign)))
    .reduce((s, d) => s + (d.value || 0), 0);
  const wonDeals = byCampaign.reduce((s, r) => s + r.wonDeals, 0);

  return {
    totalSpend: Math.round(totalSpend),
    attributedRevenue: Math.round(attributedRevenue),
    blendedRoas: totalSpend > 0 ? round2(attributedRevenue / totalSpend) : 0,
    wonDeals,
    costPerCustomer: wonDeals > 0 ? Math.round(totalSpend / wonDeals) : 0,
    byPlatform: byPlatform.sort((a, b) => b.revenue - a.revenue),
    byCampaign: byCampaign.sort((a, b) => b.revenue - a.revenue),
    unattributedRevenue: Math.round(unattributedRevenue),
  };
}
