/**
 * Offer intelligence — the layer that turns a pile of competitor ads into one
 * sentence a contractor can act on: "run a financing offer, not a branding ad."
 *
 * The market-scan products in this category all end at the same panel: which
 * KIND of offer survives longest in your market. That is the whole product;
 * everything above it is plumbing to reach it. This module is that panel.
 *
 * On "what's working": the common shortcut is days-running alone — an ad live
 * 30+ days is called a winner. That is a weak read on its own. Under cost-cap
 * or bid-cap buying an old ad is frequently just one nobody pruned, and a brand
 * running a permanent always-on ad looks identical to a scaling winner. The
 * stronger signal is REPLICATION: the same angle rebuilt as many near-identical
 * variants means someone is deliberately feeding it. Both are reported here,
 * separately and labelled, so a weak signal is never sold as a strong one.
 */
import type { CompetitorAd } from './adlibrary.js';

/**
 * Offer vocabulary for home services. Deliberately not the dental taxonomy —
 * a roofer's market runs on financing, free inspections and storm urgency, not
 * on Invisalign discounts. Order matters: the first pattern that matches wins,
 * so the specific kinds are tested before the generic money ones.
 */
export type OfferKind =
  | 'financing'
  | 'free_estimate'
  | 'free_inspection'
  | 'seasonal_tuneup'
  | 'warranty'
  | 'percent_off'
  | 'dollar_off'
  | 'price_anchor'
  | 'urgency'
  | 'social_proof'
  | 'branding_only';

export interface OfferKindMeta {
  kind: OfferKind;
  label: string;
  /** How a contractor should read it when it wins. */
  meaning: string;
}

export const OFFER_KINDS: OfferKindMeta[] = [
  { kind: 'financing', label: 'Financing / monthly payments', meaning: 'Price is the objection. Removing the lump sum beats discounting it.' },
  { kind: 'free_inspection', label: 'Free inspection', meaning: 'A diagnosis-first market — the job is sold at the house, not in the ad.' },
  { kind: 'free_estimate', label: 'Free estimate / quote', meaning: 'Low-commitment entry. Cheap leads, heavier qualification load.' },
  { kind: 'seasonal_tuneup', label: 'Seasonal tune-up / maintenance', meaning: 'Selling a small job to open the door to the big one.' },
  { kind: 'warranty', label: 'Warranty / guarantee', meaning: 'Trust is the objection, not price.' },
  { kind: 'percent_off', label: '% off', meaning: 'Discounting without naming a number — weakest on a high ticket.' },
  { kind: 'dollar_off', label: '$ off', meaning: 'A concrete number. Works when the job price is already understood.' },
  { kind: 'price_anchor', label: 'Price anchor ("from $X")', meaning: 'Sets the frame before a competitor does.' },
  { kind: 'urgency', label: 'Urgency / limited time', meaning: 'Usually stacked on another offer rather than standing alone.' },
  { kind: 'social_proof', label: 'Reviews / social proof', meaning: 'Reputation as the offer. Slow to convert, cheap to run.' },
  { kind: 'branding_only', label: 'Branding only (no offer)', meaning: 'No ask. Reliably the shortest-lived kind of ad.' },
];

const PATTERNS: { kind: OfferKind; re: RegExp }[] = [
  { kind: 'financing', re: /\b(0%\s*(apr|interest|financing)|no interest|financing available|monthly payments?|payment plans?|as low as \$?\d+\s*\/?\s*(mo|month)|\$\d+\s*(a|per)\s*month)\b/i },
  { kind: 'free_inspection', re: /\bfree\s+(roof\s+)?(inspection|assessment|diagnos\w*|safety check)\b/i },
  { kind: 'free_estimate', re: /\bfree\s+(estimate|quote|consultation|consult|in-home estimate)\b/i },
  { kind: 'seasonal_tuneup', re: /\b(tune-?up|maintenance plan|seasonal (special|service)|pre-?season|spring|fall|winter)\b.*\b(special|tune-?up|check|service)\b|\b(tune-?up)\b/i },
  { kind: 'warranty', re: /\b(\d+[- ]year (warranty|guarantee)|lifetime (warranty|guarantee)|satisfaction guaranteed|money[- ]back)\b/i },
  { kind: 'percent_off', re: /\b\d{1,2}%\s*(off|discount|savings?)\b/i },
  { kind: 'dollar_off', re: /\$\s?[\d,]+\s*(off|discount|savings?|rebate)\b|\bsave\s+\$\s?[\d,]+/i },
  { kind: 'price_anchor', re: /\b(starting at|from|as low as|only)\s*\$\s?[\d,]+/i },
  { kind: 'urgency', re: /\b(limited (time|spots|slots)|ends (soon|friday|sunday|this)|this (week|month) only|while supplies last|book by|hurry|last chance)\b/i },
  { kind: 'social_proof', re: /\b(\d[\d,]*\+?\s*(5[- ]star|five[- ]star)? ?(reviews|customers|homeowners|families)|rated \d(\.\d)? stars?|a\+ rated|bbb)\b/i },
];

export interface ExtractedOffer {
  kind: OfferKind;
  /** The exact text that triggered the match — the evidence, so a claim can be checked. */
  evidence?: string;
}

/** Read the offer out of one ad's copy. Never guesses: no match is branding_only. */
export function extractOffer(text: string): ExtractedOffer {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return { kind: 'branding_only' };
  for (const p of PATTERNS) {
    const m = p.re.exec(t);
    if (m) return { kind: p.kind, evidence: m[0].trim() };
  }
  return { kind: 'branding_only' };
}

const adText = (a: CompetitorAd) => `${a.title ?? ''} ${a.body ?? ''}`;

export interface OfferShare {
  kind: OfferKind;
  label: string;
  count: number;
  /** Share of the scanned ads running this kind of offer, 0–100. */
  sharePct: number;
}

/** "Most common offers" — what the market is currently saying. */
export function offerMix(ads: CompetitorAd[]): OfferShare[] {
  const counts = new Map<OfferKind, number>();
  for (const a of ads) {
    const k = extractOffer(adText(a)).kind;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const total = ads.length || 1;
  return [...counts.entries()]
    .map(([kind, count]) => ({
      kind,
      label: OFFER_KINDS.find((o) => o.kind === kind)?.label ?? kind,
      count,
      sharePct: Math.round((count / total) * 1000) / 10,
    }))
    .sort((a, b) => b.count - a.count);
}

export interface OfferSurvival {
  kind: OfferKind;
  label: string;
  meaning: string;
  /** Mean days running across ads carrying this offer kind. */
  avgDays: number;
  medianDays: number;
  ads: number;
  /** False when too few ads carry this kind to say anything. */
  reliable: boolean;
}

/** How many ads of one kind before its average means anything. */
export const MIN_ADS_FOR_SURVIVAL = 4;

/**
 * "Offer types by average longevity" — the payoff panel. An offer kind that
 * survives longer across MANY advertisers is the market telling you what pays,
 * and that aggregate is far more trustworthy than any single long-running ad.
 */
export function survivalByOfferKind(ads: CompetitorAd[]): OfferSurvival[] {
  const buckets = new Map<OfferKind, number[]>();
  for (const a of ads) {
    if (typeof a.daysRunning !== 'number' || !Number.isFinite(a.daysRunning)) continue;
    const k = extractOffer(adText(a)).kind;
    const list = buckets.get(k) ?? [];
    list.push(a.daysRunning);
    buckets.set(k, list);
  }
  const out: OfferSurvival[] = [];
  for (const [kind, days] of buckets) {
    const sorted = [...days].sort((x, y) => x - y);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[mid]! : Math.round(((sorted[mid - 1]! + sorted[mid]!) / 2) * 10) / 10;
    const meta = OFFER_KINDS.find((o) => o.kind === kind);
    out.push({
      kind,
      label: meta?.label ?? kind,
      meaning: meta?.meaning ?? '',
      avgDays: Math.round((days.reduce((s, d) => s + d, 0) / days.length) * 10) / 10,
      medianDays: median,
      ads: days.length,
      reliable: days.length >= MIN_ADS_FOR_SURVIVAL,
    });
  }
  return out.sort((a, b) => b.avgDays - a.avgDays);
}

export interface WinnerRead {
  ad: CompetitorAd;
  offer: ExtractedOffer;
  daysRunning: number;
  /** Near-identical siblings from the same advertiser — the replication signal. */
  variants: number;
  /**
   * How much weight to put on this. Replication is the strong read; longevity
   * alone is explicitly the weak one, and is labelled as such rather than
   * dressed up.
   */
  confidence: 'strong' | 'moderate' | 'weak';
  why: string;
}

const LONG_RUN_DAYS = 30;

/** Cheap fingerprint for "the same angle" — offer kind plus the opening words. */
const fingerprint = (a: CompetitorAd): string =>
  `${a.page}|${extractOffer(adText(a)).kind}|${(a.body ?? '').replace(/\s+/g, ' ').trim().slice(0, 40).toLowerCase()}`;

/**
 * Rank the ads most likely to be earning. Replication outranks age, because a
 * rebuilt-many-times angle is a bet someone is feeding, while an old ad may
 * simply be one nobody turned off.
 */
export function readWinners(ads: CompetitorAd[]): WinnerRead[] {
  const groups = new Map<string, CompetitorAd[]>();
  for (const a of ads) {
    const f = fingerprint(a);
    groups.set(f, [...(groups.get(f) ?? []), a]);
  }
  const reads: WinnerRead[] = [];
  for (const group of groups.values()) {
    const best = [...group].sort((x, y) => (y.daysRunning ?? 0) - (x.daysRunning ?? 0))[0]!;
    const days = best.daysRunning ?? 0;
    const variants = group.length;
    let confidence: WinnerRead['confidence'];
    let why: string;
    if (variants >= 3 && days >= LONG_RUN_DAYS) {
      confidence = 'strong';
      why = `${variants} near-identical variants still running after ${days} days — an angle being fed, not forgotten.`;
    } else if (variants >= 3) {
      confidence = 'moderate';
      why = `${variants} near-identical variants, but only ${days} days in — a bet being placed, too early to call won.`;
    } else if (days >= LONG_RUN_DAYS) {
      confidence = 'weak';
      why = `Running ${days} days, but as a single ad. Longevity alone can just mean nobody pruned it.`;
    } else {
      confidence = 'weak';
      why = `${days} days, ${variants} variant${variants === 1 ? '' : 's'} — nothing to read yet.`;
    }
    reads.push({ ad: best, offer: extractOffer(adText(best)), daysRunning: days, variants, confidence, why });
  }
  const rank = { strong: 0, moderate: 1, weak: 2 };
  return reads.sort((a, b) => rank[a.confidence] - rank[b.confidence] || b.variants - a.variants || b.daysRunning - a.daysRunning);
}

export interface OfferBrief {
  /** The offer kind to run, and why the market says so. */
  kind: OfferKind;
  label: string;
  rationale: string;
  /** Competitor ads that evidence the call — never presented as copy to reuse. */
  evidence: { page: string; days: number; variants: number; offer?: string }[];
  /** What the generator is told to write. Angle only — never their words. */
  brief: string;
  confidence: 'strong' | 'moderate' | 'weak';
}

/**
 * The bridge into ad generation. This deliberately hands over the ANGLE — the
 * offer kind and why it wins — and never a competitor's copy. Reusing their
 * words is someone else's copyright, and Meta rejects near-duplicate creative
 * anyway, so lifting it would fail twice over.
 */
export function offerBrief(ads: CompetitorAd[], trade: string): OfferBrief | null {
  const survival = survivalByOfferKind(ads).filter((s) => s.reliable && s.kind !== 'branding_only');
  const winners = readWinners(ads);
  const top = survival[0];
  if (!top) return null;

  const supporting = winners.filter((w) => w.offer.kind === top.kind).slice(0, 4);
  const strong = supporting.some((w) => w.confidence === 'strong');
  const branding = survivalByOfferKind(ads).find((s) => s.kind === 'branding_only');
  const contrast = branding?.reliable
    ? ` Ads with no offer at all last ${branding.avgDays} days on average in this market.`
    : '';

  return {
    kind: top.kind,
    label: top.label,
    rationale: `${top.label} ads run ${top.avgDays} days on average here across ${top.ads} ads — the longest-surviving offer type in this market. ${top.meaning}${contrast}`,
    evidence: supporting.map((w) => ({ page: w.ad.page, days: w.daysRunning, variants: w.variants, offer: w.offer.evidence })),
    brief: [
      `Write a Meta ad for a ${trade} business.`,
      `Offer type: ${top.label}.`,
      `Why: ${top.meaning}`,
      `Write original copy in this business's own voice and offer. Do not imitate any competitor's wording, and do not reference a competitor.`,
    ].join(' '),
    confidence: strong ? 'strong' : supporting.length ? 'moderate' : 'weak',
  };
}
