/**
 * Build one account's daily rows from figures the caller already read.
 * This module does not call an ad platform or a CRM.
 */
import type { CampaignSpend } from '../revenue/attribution.js';
import type { CrmDay } from './crm.js';
import type { DailyRow, Membership, Platform } from './types.js';
import { platformOf } from './trades.js';

export interface AccountCollectInput {
  accountId: string;
  day: string;
  trade: string;
  active: boolean;
  consent: boolean;
  trackingVerified: boolean;
  connectedPlatforms: Platform[];
  spend: CampaignSpend[];
  crm: CrmDay;
}

function rate(numerator: number, denominator: number): number | null {
  if (!(denominator > 0) || !Number.isFinite(numerator)) return null;
  return Math.round((numerator / denominator) * 10000) / 10000;
}

export function campaignTypeOf(platform: Platform, name: string): string {
  const n = (name || '').toLowerCase();
  if (platform === 'google_lsa') return 'lsa';
  if (platform === 'google_ads') {
    if (/pmax|performance max/.test(n)) return 'pmax';
    if (/\bbrand/.test(n)) return 'brand_search';
    return 'search';
  }
  if (platform === 'meta') return /lead/.test(n) ? 'lead_ads' : 'other';
  return 'other';
}

function addCrm(target: { leads: number; bookedJobs: number; revenue: number }, extra: { leads: number; bookedJobs: number; revenue: number } | undefined) {
  if (!extra) return;
  target.leads += extra.leads;
  target.bookedJobs += extra.bookedJobs;
  target.revenue += extra.revenue;
}

export function collectAccount(input: AccountCollectInput): { membership: Membership; daily: DailyRow[] } {
  const trade = input.trade;
  const platforms = new Set<Platform>(input.connectedPlatforms);
  const grouped = new Map<string, { platform: Platform; campaignType: string; spend: number; clicks: number; impressions: number; leads: number; conversions: number; bookedJobs: number; revenue: number }>();
  for (const row of input.spend) {
    const platform = platformOf(row.platform);
    if (!platform) continue;
    platforms.add(platform);
    const campaignType = campaignTypeOf(platform, row.campaign || '');
    const key = `${platform}|${campaignType}`;
    const cur = grouped.get(key) ?? { platform, campaignType, spend: 0, clicks: 0, impressions: 0, leads: 0, conversions: 0, bookedJobs: 0, revenue: 0 };
    cur.spend += row.spend || 0;
    cur.clicks += row.clicks || 0;
    cur.impressions += row.impressions || 0;
    cur.conversions += row.conversions || 0;
    cur.leads += row.conversions || 0;
    grouped.set(key, cur);
  }
  const connected = [...platforms];
  // CRM counts are one row per platform, not copied onto every campaign.
  // Unattributed outcomes attach only when a single ad platform is connected.
  const only = connected.length === 1 ? connected[0]! : null;
  const crmPlatforms = new Set<Platform>(Object.keys(input.crm.byPlatform) as Platform[]);
  if (only) crmPlatforms.add(only);
  for (const platform of crmPlatforms) {
    if (!connected.includes(platform) && !input.connectedPlatforms.includes(platform)) continue;
    const counts = { leads: 0, bookedJobs: 0, revenue: 0 };
    addCrm(counts, input.crm.byPlatform[platform]);
    if (only === platform) addCrm(counts, input.crm.unattributed);
    if (!(counts.leads || counts.bookedJobs || counts.revenue)) continue;
    const key = `${platform}|crm`;
    const cur = grouped.get(key) ?? { platform, campaignType: 'crm', spend: 0, clicks: 0, impressions: 0, leads: 0, conversions: 0, bookedJobs: 0, revenue: 0 };
    addCrm(cur, counts);
    grouped.set(key, cur);
  }
  const daily: DailyRow[] = [];
  if (input.consent) {
    for (const row of grouped.values()) {
      daily.push({
        accountId: input.accountId,
        day: input.day,
        platform: row.platform,
        campaignType: row.campaignType,
        trade,
        trackingVerified: input.trackingVerified,
        accountActive: input.active,
        consent: true,
        spend: Math.round(row.spend * 100) / 100,
        clicks: row.clicks,
        impressions: row.impressions,
        leads: row.leads,
        conversions: row.conversions,
        bookedJobs: row.bookedJobs,
        revenue: Math.round(row.revenue * 100) / 100,
        cpl: rate(row.spend, row.leads),
        cpc: rate(row.spend, row.clicks),
        cpa: rate(row.spend, row.bookedJobs),
        roas: rate(row.revenue, row.spend),
      });
    }
  }
  return {
    membership: {
      accountId: input.accountId,
      trade,
      active: input.active,
      consent: input.consent,
      trackingVerified: input.trackingVerified,
      platforms: connected,
    },
    daily,
  };
}
