/**
 * PPC checklist limits by subscription plan.
 * These trim what a draft includes. They do not block a plan that is otherwise ready.
 * An unknown plan uses Starter.
 */
import type { CampaignSpec, KeywordSpec } from './campaign.js';

export type PlanTier = 'starter' | 'growth' | 'scale';

export interface PpcLimits {
  tier: PlanTier;
  /** Service campaigns. A branded campaign is extra when the owner has a brand name. */
  campaigns: number;
  adGroupsPerCampaign: number;
  keywords: number;
  retargetingDisplay: boolean;
  landingPages: boolean;
  abTesting: boolean;
}

export const PPC_LIMITS: Record<PlanTier, PpcLimits> = {
  starter: { tier: 'starter', campaigns: 1, adGroupsPerCampaign: 5, keywords: 50, retargetingDisplay: false, landingPages: false, abTesting: false },
  growth: { tier: 'growth', campaigns: 5, adGroupsPerCampaign: 10, keywords: 100, retargetingDisplay: true, landingPages: true, abTesting: false },
  scale: { tier: 'scale', campaigns: 10, adGroupsPerCampaign: 20, keywords: 200, retargetingDisplay: true, landingPages: true, abTesting: true },
};

export function planTierOf(band: string | undefined | null): PlanTier {
  if (band === 'growth' || band === 'scale' || band === 'starter') return band;
  return 'starter';
}

export interface PpcFit {
  spec: CampaignSpec;
  brand: CampaignSpec | null;
  note: string;
  checklist: string[];
}

function fitBrand(line: string): string {
  const text = line.replace(/\s+/g, ' ').trim();
  return text.length <= 30 ? text : '';
}

function brandSpec(source: CampaignSpec, brand: string, city: string): CampaignSpec {
  const name = brand.replace(/\s+/g, ' ').trim();
  const lower = name.toLowerCase();
  const place = city.split(',')[0]?.trim().toLowerCase() || '';
  const keywords: KeywordSpec[] = [{ text: lower, match: 'exact' }];
  if (place && !lower.includes(place)) keywords.push({ text: `${lower} ${place}`, match: 'exact' });
  const seed = source.adGroups[0]?.rsa;
  const headlines = [
    fitBrand(name),
    ...(seed?.headlines ?? []),
  ].filter((line, index, all) => line && all.indexOf(line) === index).slice(0, 10);
  const placeLabel = place ? place.replace(/\b\w/g, (letter) => letter.toUpperCase()) : 'Search';
  return {
    ...source,
    name: `Brand | ${placeLabel} | Search`.slice(0, 120),
    adGroups: [{
      name,
      keywords,
      finalUrl: source.finalUrl,
      rsa: {
        headlines: headlines.length ? headlines : [fitBrand(name) || 'Local Service'],
        descriptions: seed?.descriptions?.length ? seed.descriptions : [`${name}. Call to schedule a visit.`.slice(0, 90)],
        pinDescription1: false,
      },
    }],
  };
}

export function applyPpcLimits(spec: CampaignSpec, tierInput?: PlanTier | null, brandName?: string): PpcFit {
  const tier = tierInput || 'starter';
  const limits = PPC_LIMITS[tier];
  const next: CampaignSpec = {
    ...spec,
    adGroups: spec.adGroups.map((group) => ({ ...group, keywords: [...group.keywords], rsa: { ...group.rsa, headlines: [...group.rsa.headlines], descriptions: [...group.rsa.descriptions] } })),
    negatives: [...(spec.negatives || [])],
  };
  const heldGroups = next.adGroups.slice(limits.adGroupsPerCampaign).map((group) => group.name);
  next.adGroups = next.adGroups.slice(0, limits.adGroupsPerCampaign);
  const brandWords = brandSpecKeywordCount(brandName, next.locations[0] || '');
  let room = Math.max(0, limits.keywords - brandWords);
  for (const group of next.adGroups) {
    group.keywords = group.keywords.slice(0, room);
    room -= group.keywords.length;
  }
  next.adGroups = next.adGroups.filter((group) => group.keywords.length > 0);
  const city = (next.locations[0] || '').split(',')[0]?.trim() || '';
  const brand = brandName?.trim() ? brandSpec(next, brandName.trim(), city) : null;
  if (limits.abTesting) {
    for (const group of next.adGroups) {
      const lines = group.rsa.headlines;
      if (lines.length > 1) group.rsaVariant = { headlines: [...lines.slice(1), lines[0]!], descriptions: [...group.rsa.descriptions], pinDescription1: false };
    }
  }
  if (brand && !limits.abTesting) {
    /* one RSA on Starter and Growth */
  }
  if (brand && limits.abTesting && brand.adGroups[0] && brand.adGroups[0].rsa.headlines.length > 1) {
    const lines = brand.adGroups[0].rsa.headlines;
    brand.adGroups[0].rsaVariant = { headlines: [...lines.slice(1), lines[0]!], descriptions: [...brand.adGroups[0].rsa.descriptions], pinDescription1: false };
  }
  const brandLower = brandName?.trim().toLowerCase() || '';
  if (brandLower && !next.adGroups.some((group) => group.keywords.some((keyword) => keyword.text.includes(brandLower)))) {
    next.negatives = [...new Set([...next.negatives, brandLower])];
  }
  const label = tier[0]!.toUpperCase() + tier.slice(1);
  const notes = [
    `${label} plan limit: ${limits.campaigns} service campaign${limits.campaigns === 1 ? '' : 's'} plus a branded campaign, ${limits.adGroupsPerCampaign} ad groups per campaign, ${limits.keywords} keywords. Extra items stay off this draft.`,
  ];
  if (heldGroups.length) notes.push(`Left off this draft: ${heldGroups.join(', ')}.`);
  if (brand) notes.push(`Branded campaign: ${brand.name}.`);
  const checklist = [
    'Keyword competition: not available. No score was invented.',
    'Negative keywords, headlines, descriptions, and bid management are in this draft.',
    'Weekly optimization, keyword performance, monitoring, and the monthly report stay on every plan.',
    limits.retargetingDisplay
      ? 'Display and retargeting are on this plan. They are not turned on inside the Search campaign.'
      : 'Display and retargeting are not on this plan.',
    limits.landingPages
      ? 'Landing page creation is on this plan. This draft uses the pages already saved.'
      : 'Landing page creation is not on this plan. Ads use the saved website.',
    limits.abTesting
      ? 'A second responsive ad is included for A/B testing.'
      : 'A/B ad testing is not on this plan. Each ad group has one responsive ad.',
  ];
  return { spec: next, brand, note: notes.join(' '), checklist };
}

function brandSpecKeywordCount(brandName: string | undefined, location: string): number {
  if (!brandName?.trim()) return 0;
  const place = location.split(',')[0]?.trim().toLowerCase() || '';
  const lower = brandName.trim().toLowerCase();
  return place && !lower.includes(place) ? 2 : 1;
}
