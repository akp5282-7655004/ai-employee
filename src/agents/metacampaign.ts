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
  objective: string; // OUTCOME_TRAFFIC (reliable, no pixel/form dependency)
  optimizationGoal: string; // LANDING_PAGE_VIEWS
  billingEvent: string; // IMPRESSIONS
  dailyBudget: number; // dollars/day
  website: string;
  geo: MetaGeo;
  ageMin: number;
  ageMax: number;
  ad: MetaAdCopy;
  status: 'PAUSED'; // always paused from Miles — owner flips it live in Ads Manager
}

export interface MetaCampaignInput {
  offer?: string;
  website?: string;
  dailyBudget?: number;
  ticket?: number;
  financing?: boolean;
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

export function buildMetaCampaignSpec(input: MetaCampaignInput, ctx: MetaCampaignCtx): MetaCampaignSpec {
  // Lean on the playbook for the economics + engineered offer.
  const pb = buildPlaybook(
    { offer: input.offer, ticket: input.ticket, financing: input.financing, channel: 'meta' },
    { business: ctx.business, trade: ctx.industry, city: ctx.city, services: ctx.services },
  );
  const trade = pb.trade;
  const { zips, cities } = parseGeo(ctx.serviceAreas);
  const dailyBudget = input.dailyBudget && input.dailyBudget > 0 ? Math.round(input.dailyBudget) : pb.economics.testBudgetDaily;
  const website = cleanUrl(input.website);

  const offerLine = pb.offer.engineered;
  const primaryText = [
    offerLine + '.',
    pb.offer.reasonWhy,
    pb.offer.stack.join(' '),
    input.financing ? pb.offer.financing : '',
    'Licensed & insured, real local crew. Tap below for a fast, no-pressure quote.',
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 600);

  const headline = offerLine.split('—')[0]!.trim().slice(0, 40) || `${ctx.business || trade} — Special Offer`;
  const description = (pb.offer.riskReversal[0] || 'Licensed & insured · free estimate').slice(0, 60);

  return {
    name: `${ctx.business || trade} — ${offerLine}`.slice(0, 100),
    objective: 'OUTCOME_TRAFFIC',
    optimizationGoal: 'LANDING_PAGE_VIEWS',
    billingEvent: 'IMPRESSIONS',
    dailyBudget,
    website,
    geo: { countries: ['US'], zips, cities },
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
  if (!spec.website) issues.push('No website URL — the ad needs a destination link. Add your website.');
  if (spec.dailyBudget < 1) issues.push('Daily budget must be at least $1.');
  if (!spec.geo.zips.length && !spec.geo.cities.length)
    issues.push('No local ZIPs or cities found — I’ll target the US broadly. Add your service-area ZIPs for local targeting.');
  if (!spec.ad.primaryText.trim()) issues.push('Ad has no primary text.');
  return issues;
}
