/**
 * Meta (Facebook / Instagram) campaign spec — turns a business profile + offer
 * into a complete, ready-to-launch paid-social campaign the way the Campaign
 * Playbook prescribes: unit-economics-driven budget, an engineered offer as the
 * ad copy, and local geo targeting. Deterministic so it always produces a full,
 * valid spec; the launcher writes it into Meta as a PAUSED draft the owner
 * reviews before spending a cent.
 */
import { buildPlaybook } from './playbook.js';

export interface MetaAdCopy {
  primaryText: string;
  headline: string;
  description: string;
  cta: string; // Meta call_to_action type, e.g. LEARN_MORE / GET_QUOTE
}
export interface MetaGeo {
  countries: string[];
  zips: string[];
  cities: string[];
}
export interface MetaCampaignSpec {
  name: string;
  objective: 'OUTCOME_LEADS';
  optimizationGoal: 'LEAD_GENERATION';
  billingEvent: 'IMPRESSIONS';
  placements: ('facebook' | 'instagram')[];
  dailyBudget: number; // dollars/day
  website: string;
  /** Public https image from Creative Studio. A data URL is not sent to Meta. */
  imageUrl?: string;
  geo: MetaGeo;
  ageMin: number;
  ageMax: number;
  ad: MetaAdCopy;
  status: 'PAUSED';
}

export interface MetaCampaignInput {
  offer?: string;
  website?: string;
  /** When set, including 0, this is the daily amount. 0 means the saved split left nothing for Facebook. */
  dailyBudget?: number;
  ticket?: number;
  financing?: boolean;
  imageUrl?: string;
  headline?: string;
  primaryText?: string;
  description?: string;
}
export interface MetaCampaignCtx {
  business?: string;
  industry?: string;
  city?: string;
  serviceAreas?: string;
  services?: string;
}

const CTA_BY_TRADE: Record<string, string> = {
  roofing: 'GET_QUOTE',
  hvac: 'GET_QUOTE',
  plumbing: 'CALL_NOW',
  electrical: 'GET_QUOTE',
  painting: 'GET_QUOTE',
  solar: 'GET_QUOTE',
  landscaping: 'GET_QUOTE',
};

/** Pull ZIPs (5-digit) and city names out of a free-text service-area string. */
function parseGeo(serviceAreas?: string): { zips: string[]; cities: string[] } {
  const raw = (serviceAreas || '')
    .split(/[,\n;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const zips: string[] = [];
  const cities: string[] = [];
  for (const part of raw) {
    const m = part.match(/\b(\d{5})\b/);
    if (m && m[1]) zips.push(m[1]);
    else if (!/^\d+$/.test(part)) cities.push(part);
  }
  return { zips: [...new Set(zips)].slice(0, 25), cities: [...new Set(cities)].slice(0, 10) };
}

function cleanUrl(website?: string): string {
  const w = (website || '').trim();
  if (!w) return '';
  return /^https?:\/\//i.test(w) ? w : 'https://' + w;
}

function ownerText(s: string): string {
  return s.replace(/[ \t]*\u2014[ \t]*/g, ', ').replace(/\u2013/g, '-').replace(/\u2019/g, "'").replace(/\s{2,}/g, ' ').trim();
}

export function buildMetaCampaignSpec(input: MetaCampaignInput, ctx: MetaCampaignCtx): MetaCampaignSpec {
  // Lean on the playbook for the economics + engineered offer.
  const pb = buildPlaybook(
    { offer: input.offer, ticket: input.ticket, financing: input.financing, channel: 'meta' },
    { business: ctx.business, trade: ctx.industry, city: ctx.city, services: ctx.services },
  );
  const trade = pb.trade;
  const { zips, cities } = parseGeo(ctx.serviceAreas);
  const city = (ctx.city || '').trim();
  if (city && !cities.some((c) => c.toLowerCase() === city.toLowerCase())) cities.unshift(city);
  const dailyBudget = input.dailyBudget != null ? Math.max(0, Math.round(input.dailyBudget)) : pb.economics.testBudgetDaily;
  const website = cleanUrl(input.website);

  const offerLine = ownerText(pb.offer.engineered);
  const primaryText = ownerText(input.primaryText || [
    offerLine + '.',
    pb.offer.reasonWhy,
    pb.offer.stack.join(' '),
    input.financing ? pb.offer.financing : '',
    'Licensed and insured, real local crew. Tap below for a fast, no-pressure quote.',
  ].filter(Boolean).join('\n\n')).slice(0, 600);

  const headline = ownerText(input.headline || offerLine.split(',')[0] || '').slice(0, 40) || `${ctx.business || trade} in ${ctx.city || 'your area'}`;
  const description = ownerText(input.description || pb.offer.riskReversal[0] || 'Licensed and insured. Free estimate').slice(0, 60);
  const imageUrl = /^https:\/\//i.test(input.imageUrl || '') ? input.imageUrl : undefined;

  return {
    name: `${ctx.business || trade}: ${headline}`.slice(0, 100),
    objective: 'OUTCOME_LEADS',
    optimizationGoal: 'LEAD_GENERATION',
    billingEvent: 'IMPRESSIONS',
    placements: ['facebook', 'instagram'],
    dailyBudget,
    website,
    imageUrl,
    geo: { countries: ['US'], zips, cities: cities.slice(0, 10) },
    ageMin: 30,
    ageMax: 65,
    ad: {
      primaryText,
      headline,
      description,
      cta: CTA_BY_TRADE[trade] ?? 'LEARN_MORE',
    },
    status: 'PAUSED',
  };
}

/** Human-readable validation issues — surfaced before the owner approves a launch. */
export function validateMetaCampaignSpec(spec: MetaCampaignSpec): string[] {
  const issues: string[] = [];
  if (!spec.website) issues.push('No website URL. The ad needs a destination link. Add your website.');
  if (spec.dailyBudget < 1) issues.push('Daily budget must be at least $1.');
  const zips = spec.geo?.zips?.length ?? 0;
  const cities = spec.geo?.cities?.length ?? 0;
  if (!zips && !cities)
    issues.push('No local ZIPs or cities found. Add your service-area ZIPs for local targeting.');
  if (!spec.ad?.primaryText?.trim()) issues.push('Ad has no primary text.');
  if (!spec.imageUrl) issues.push('Add a public image in Creative Studio. Meta needs an https image link before the ad can be created.');
  if (spec.status !== 'PAUSED') issues.push('Miles only creates paused campaigns. It will not turn spend on.');
  return issues;
}
