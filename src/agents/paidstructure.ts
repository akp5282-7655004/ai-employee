/**
 * Meta and TikTok leads structures for home-services contractors.
 * The rules live in docs/meta-tiktok-campaign-sop.md. This file only builds
 * the plan and the pre-launch review. It does not call an ad platform.
 */
import { audiencesFor, tradeKeyOf, tradePlaybook, type AudienceSegment } from '../playbooks/load.js';
import { applyAudienceRules, guardCopy, usesProtectedTrait } from '../playbooks/guard.js';
import { playbookCplBand } from './playbook.js';
import type { VerifiedClaims } from './claims.js';

export const META_RADIUS_MILES = 15;
export const META_ADSET_MIN = 10;
export const TIKTOK_CAMPAIGN_MIN = 50;
export const TIKTOK_ADGROUP_MIN = 20;
export const AGE_CONTROL = 25;

export type ReviewState = 'pass' | 'warn' | 'block';

export interface ReviewItem {
  id: string;
  label: string;
  state: ReviewState;
  detail: string;
}

/** Every Meta and TikTok build includes these. None of them depend on a package tier. */
export const BUILD_ELEMENT_IDS = ['strategy', 'competitors', 'campaign', 'creatives', 'geography', 'budget', 'ab_test', 'retargeting', 'form', 'report'] as const;

export interface BuildElement {
  id: (typeof BUILD_ELEMENT_IDS)[number];
  label: string;
  detail: string;
}

export interface FormQuestion {
  label: string;
  options: string[];
}

export interface PaidAd {
  name: string;
  angle: 'offer' | 'problem' | 'crew';
  primaryText: string;
  headline: string;
  description: string;
  cta: string;
  imageUrl?: string;
  videoUrl?: string;
  included: boolean;
  heldReason?: string;
}

export interface PaidAdSet {
  id: string;
  name: string;
  segment: string;
  demand: string;
  included: boolean;
  heldReason?: string;
  dailyBudget: number;
  radiusMiles: number;
  zips: string[];
  city: string;
  locationNote: string;
  ageMin: number;
  ageSuggestion: string;
  homeownerNote: string;
  destination: 'instant_form' | 'website';
  optimization: string;
  placements: string;
  ads: PaidAd[];
}

export interface LeadFormPlan {
  name: string;
  higherIntent: boolean;
  intro: string;
  privacyUrl: string;
  followUpUrl: string;
  prefill: string[];
  questions: FormQuestion[];
  heldQuestions: string[];
}

export interface MetaPlan {
  channel: 'meta';
  name: string;
  objective: 'OUTCOME_LEADS';
  buyingType: 'AUCTION';
  specialAdCategories: string[];
  specialAdNote: string;
  budgetMode: 'cbo' | 'abo';
  budgetNote: string;
  dailyBudget: number;
  status: 'PAUSED';
  advantageAudience: true;
  advantagePlacements: true;
  destination: 'instant_form' | 'website';
  pixelId?: string;
  form: LeadFormPlan;
  adSets: PaidAdSet[];
  exclusionsNote: string;
  /** The ten elements in every build. Not a package menu. */
  elements: BuildElement[];
}

export interface TikTokPlan {
  channel: 'tiktok';
  name: string;
  objective: 'LEAD_GENERATION';
  budgetMode: 'ad_group';
  budgetNote: string;
  dailyBudget: number;
  status: 'DISABLE';
  destination: 'website';
  destinationNote: string;
  pixelId?: string;
  videoUrl?: string;
  form: LeadFormPlan;
  adSets: PaidAdSet[];
  exclusionsNote: string;
  /** The ten elements in every build. Not a package menu. */
  elements: BuildElement[];
}

export interface PaidPlanInput {
  dailyBudget: number;
  dailyCap?: number;
  monthlyCap?: number;
  website?: string;
  imageUrls?: string[];
  videoUrl?: string;
  offer?: string;
  financing?: boolean;
  pixelId?: string;
  destination?: 'instant_form' | 'website';
  business?: string;
  trade?: string;
  city?: string;
  serviceAreas?: string;
  services?: string;
  claims?: VerifiedClaims;
  /** Names the owner already saved. Empty means the plan says so and does not invent any. */
  competitors?: string[];
}

const SERVICE_QUESTION: Record<string, FormQuestion> = {
  roofing: { label: 'What kind of roof is it?', options: ['Shingle', 'Flat or rubber', 'Not sure'] },
  hvac: { label: 'What do you need help with?', options: ['No heat or no AC', 'System replacement', 'Tune-up'] },
  plumbing: { label: 'What is going on?', options: ['Leak, clog, or no hot water', 'Water heater', 'Repipe or sewer'] },
  electrical: { label: 'What do you need?', options: ['Power issue', 'Panel upgrade', 'EV charger'] },
  painting: { label: 'What should we paint?', options: ['Exterior', 'Interior', 'Cabinets'] },
  solar: { label: 'What are you considering?', options: ['Solar panels', 'Battery backup', 'Not sure'] },
  landscaping: { label: 'What do you need?', options: ['Regular maintenance', 'Seasonal cleanup', 'Hardscape'] },
};

const HOMEOWNER: FormQuestion = {
  label: 'Do you own this home?',
  options: ['Yes', 'No, I rent'],
};

function plain(s: string): string {
  return s.replace(/[ \t]*\u2014[ \t]*/g, ', ').replace(/\u2013/g, '-').replace(/\u2019/g, "'").replace(/\s{2,}/g, ' ').trim();
}

function clip(s: string, max: number): string {
  const text = plain(s);
  return text.length <= max ? text : text.slice(0, max - 1).trim();
}

export function parseServiceArea(serviceAreas?: string, city?: string): { zips: string[]; city: string } {
  const parts = (serviceAreas || '').split(/[,\n;]/).map((s) => s.trim()).filter(Boolean);
  const zips: string[] = [];
  const cities: string[] = [];
  for (const part of parts) {
    const zip = part.match(/\b(\d{5})\b/);
    if (zip?.[1]) zips.push(zip[1]);
    else if (!/^\d+$/.test(part)) cities.push(part);
  }
  const named = (city || '').trim();
  return {
    zips: [...new Set(zips)].slice(0, 25),
    city: named || cities[0] || '',
  };
}

export function adCeiling(daily: number, cplHigh: number): number {
  const cost = cplHigh > 0 ? cplHigh : 80;
  return Math.max(1, Math.floor((daily * 14) / (2 * cost)));
}

function demandWeight(demand: string): number {
  const d = demand.toLowerCase();
  if (d === 'planned') return 3;
  if (d === 'event' || d === 'seasonal') return 2;
  return 1;
}

function holdReason(segment: AudienceSegment): string | null {
  const meta = segment.meta || '';
  if (/not primary|retargeting only/i.test(meta)) return `${segment.name} is marked not primary for Meta prospecting. It is not created.`;
  if (/custom audience|lookalike|past customers/i.test(meta)) return `${segment.name} needs a customer list Miles does not have. It is not created.`;
  if (/hail|affected zips|storm/i.test(`${meta} ${segment.zip_filters}`)) return `${segment.name} needs a storm ZIP list. The saved service area is not a hail map, so this ad set is not created.`;
  return null;
}

function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const raw = weights.map((w) => Math.floor((total * w) / sum));
  let used = raw.reduce((a, b) => a + b, 0);
  let i = 0;
  while (used < total && raw.length) {
    raw[i % raw.length]! += 1;
    used += 1;
    i += 1;
  }
  return raw;
}

function fitCount(daily: number, want: number, minEach: number): number {
  let n = want;
  while (n > 1) {
    if (allocate(daily, Array(n).fill(1)).every((share) => share >= minEach)) return n;
    n -= 1;
  }
  return 1;
}

function safeCopy(text: string, fallback: string): string {
  const checked = guardCopy(plain(text));
  return checked.ok && checked.text ? checked.text : plain(fallback);
}

function websiteOf(raw?: string): string {
  const w = (raw || '').trim();
  if (!w) return '';
  return /^https?:\/\//i.test(w) ? w : `https://${w}`;
}

function httpsOnly(url?: string): string {
  const value = (url || '').trim();
  return /^https:\/\//i.test(value) ? value : '';
}

function tradeLabel(trade?: string): string {
  const key = tradeKeyOf(trade);
  if (!key) return plain(trade || 'Home services');
  return tradePlaybook(trade).label || key;
}

function questionsFor(trade?: string): { questions: FormQuestion[]; held: string[] } {
  const key = tradeKeyOf(trade) || '';
  const service = SERVICE_QUESTION[key] || { label: 'What do you need?', options: ['Repair', 'Replacement', 'Not sure'] };
  return {
    questions: [HOMEOWNER, service],
    held: [
      'How soon do you need this? The playbook asks it. A third custom question is left off so the form stays short.',
      'A phone number typed by hand is a stronger quality signal than the prefilled phone. It is not a separate question here.',
    ],
  };
}

function formFor(name: string, site: string, trade: string | undefined, intro: string): LeadFormPlan {
  const asked = questionsFor(trade);
  return {
    name: clip(`${name} form`, 100),
    higherIntent: true,
    intro: clip(intro, 60),
    privacyUrl: site,
    followUpUrl: site,
    prefill: ['Full name', 'Phone', 'Email', 'ZIP'],
    questions: asked.questions,
    heldQuestions: asked.held,
  };
}

function angleCopy(args: {
  angle: PaidAd['angle'];
  business: string;
  trade: string;
  city: string;
  segment: string;
  offer: string;
  financing: boolean;
}): { primary: string; headline: string; description: string } {
  const where = args.city ? ` in ${args.city}` : '';
  const offer = args.offer || `a quote for ${args.trade}`;
  const financing = args.financing ? ' Financing with approved credit. See terms.' : '';
  if (args.angle === 'problem') {
    return {
      primary: safeCopy(`${args.segment}${where}? ${args.business || 'A local crew'} will look and tell you what the job is before you book.${financing}`, `${args.segment}${where}. Ask for a quote.`),
      headline: clip(args.segment, 40),
      description: clip('Ask for a quote', 30),
    };
  }
  if (args.angle === 'crew') {
    return {
      primary: safeCopy(`${args.business || args.trade} serves ${args.city || 'your area'}. Tell us about the ${args.segment.toLowerCase()} job and we will call you back.${financing}`, 'A local crew. Ask for a quote.'),
      headline: clip(args.city ? `${args.trade} in ${args.city}` : args.trade, 40),
      description: clip('A local crew', 30),
    };
  }
  return {
    primary: safeCopy(`${offer}${where}. ${args.segment}. Ask ${args.business || 'us'} for a quote.${financing}`, `${offer}. Ask for a quote.`),
    headline: clip(args.offer || args.segment, 40),
    description: clip('Request a quote', 30),
  };
}

function ctaFor(segment: AudienceSegment, channel: 'meta' | 'tiktok'): string {
  if (channel === 'tiktok') return 'CONTACT_US';
  return segment.demand === 'emergency' ? 'CALL_NOW' : 'GET_QUOTE';
}

interface Ranked {
  segment: AudienceSegment;
  held: string | null;
}

function rankedSegments(trade?: string): Ranked[] {
  const file = audiencesFor(trade);
  const rows = file.segments.length
    ? file.segments
    : [{
      id: 'core',
      name: 'Homeowners in the service area',
      demand: 'planned',
      age: '30-65+',
      zip_income: '',
      homeowner: 'intended buyer',
      zip_filters: 'service area',
      meta: 'Advantage+ on; control age 25',
      google: '',
      seed: '',
    } satisfies AudienceSegment];
  return [...rows]
    .map((segment) => ({ segment, held: holdReason(segment) }))
    .sort((a, b) => demandWeight(b.segment.demand) - demandWeight(a.segment.demand));
}

function buildSets(args: {
  channel: 'meta' | 'tiktok';
  input: PaidPlanInput;
  daily: number;
  minEach: number;
  destination: 'instant_form' | 'website';
  optimization: string;
  placements: string;
  image?: string;
  video?: string;
}): PaidAdSet[] {
  const geo = parseServiceArea(args.input.serviceAreas, args.input.city);
  const ranked = rankedSegments(args.input.trade);
  const open = ranked.filter((row) => !row.held);
  const pool = open.length ? open : ranked.slice(0, 1);
  const count = fitCount(args.daily, pool.length, args.minEach);
  const chosen = pool.slice(0, count);
  const weights = chosen.map((row) => demandWeight(row.segment.demand));
  const shares = args.daily > 0 ? allocate(args.daily, weights) : chosen.map(() => 0);
  const cpl = playbookCplBand(args.input.trade)?.high ?? 80;
  const ceiling = adCeiling(args.daily, cpl);
  const perSet = Math.max(1, Math.floor(ceiling / chosen.length) || 1);
  const trade = tradeLabel(args.input.trade);
  const business = plain(args.input.business || trade);
  const offer = plain(args.input.offer || '');
  const place = geo.zips.length ? 'ZIPs' : (geo.city ? `${META_RADIUS_MILES} mi` : 'no area');
  const locationNote = geo.zips.length
    ? `ZIP list from the service area (${geo.zips.join(', ')}). A radius is not added on top.`
    : geo.city
      ? `${geo.city} plus ${META_RADIUS_MILES} miles. People living in or recently in that area.`
      : 'No city or ZIP is saved. This cannot be created.';

  const included: PaidAdSet[] = chosen.map((row, index) => {
    const angles: PaidAd['angle'][] = ['offer', 'problem', 'crew'];
    const running = Math.min(angles.length, perSet);
    const ads: PaidAd[] = angles.map((angle) => {
      const copy = angleCopy({
        angle,
        business,
        trade,
        city: geo.city,
        segment: row.segment.name,
        offer,
        financing: !!args.input.financing,
      });
      const keep = angles.indexOf(angle) < running;
      return {
        name: clip(`${row.segment.name} | ${angle}`, 100),
        angle,
        primaryText: clip(copy.primary, args.channel === 'tiktok' ? 100 : 500),
        headline: copy.headline,
        description: copy.description,
        cta: ctaFor(row.segment, args.channel),
        imageUrl: args.image || undefined,
        videoUrl: args.video || undefined,
        included: keep,
        heldReason: keep ? undefined : 'This angle stays off the create. The daily budget cannot feed another ad.',
      };
    });
    return {
      id: row.segment.id,
      name: clip(`${trade} | ${row.segment.name} | ${place}`, 100),
      segment: row.segment.name,
      demand: row.segment.demand,
      included: true,
      dailyBudget: shares[index] || 0,
      radiusMiles: geo.zips.length ? 0 : META_RADIUS_MILES,
      zips: geo.zips,
      city: geo.city,
      locationNote,
      ageMin: AGE_CONTROL,
      ageSuggestion: row.segment.age || '30-65+',
      homeownerNote: plain(row.segment.homeowner || 'Homeowners are the intended buyer. Meta will not lock that under Advantage+ audience.'),
      destination: args.destination,
      optimization: args.optimization,
      placements: args.placements,
      ads,
    };
  });

  const held: PaidAdSet[] = ranked
    .filter((row) => row.held || !chosen.includes(row))
    .filter((row) => !chosen.includes(row))
    .map((row) => ({
      id: row.segment.id,
      name: clip(`${trade} | ${row.segment.name}`, 100),
      segment: row.segment.name,
      demand: row.segment.demand,
      included: false,
      heldReason: row.held || 'The daily budget cannot feed another ad set at the minimum. This one is not created.',
      dailyBudget: 0,
      radiusMiles: 0,
      zips: [],
      city: geo.city,
      locationNote: '',
      ageMin: AGE_CONTROL,
      ageSuggestion: row.segment.age || '',
      homeownerNote: '',
      destination: args.destination,
      optimization: args.optimization,
      placements: args.placements,
      ads: [],
    }));
  return [...included, ...held];
}

function budgetMode(sets: PaidAdSet[]): 'cbo' | 'abo' {
  return sets.filter((set) => set.included).length > 1 ? 'cbo' : 'abo';
}

function buildElements(args: {
  channel: 'meta' | 'tiktok';
  business: string;
  trade: string;
  city: string;
  daily: number;
  budgetNote: string;
  destinationNote: string;
  sets: PaidAdSet[];
  competitors?: string[];
  cpl: number;
}): BuildElement[] {
  const included = args.sets.filter((set) => set.included);
  const ads = included.flatMap((set) => set.ads.filter((ad) => ad.included));
  const names = (args.competitors || []).map((name) => plain(name)).filter(Boolean).slice(0, 8);
  const ceiling = adCeiling(args.daily, args.cpl);
  const where = args.city || 'the service area';
  const competitorDetail = names.length
    ? `Saved competitor names: ${names.join(', ')}. The messages come from the trade playbook. Miles did not copy their ads and did not invent claims from their names.`
    : 'No competitor names are saved. This plan does not invent any. Add them on the business profile when you have them, then rebuild.';
  return [
    { id: 'strategy', label: 'Strategy summary', detail: plain(`${args.business} runs a leads campaign for ${args.trade} in ${where}. ${args.budgetNote} ${args.destinationNote}`) },
    { id: 'competitors', label: 'Competitor research', detail: competitorDetail },
    { id: 'campaign', label: 'Campaign creation', detail: `Create ${included.length} paused ${args.channel === 'tiktok' ? 'ad group' : 'ad set'}${included.length === 1 ? '' : 's'} and ${ads.length} paused ad${ads.length === 1 ? '' : 's'}. Going live is a separate approval.` },
    { id: 'creatives', label: 'Creatives', detail: ads.length
      ? `${ads.length} ad${ads.length === 1 ? '' : 's'} in this create. The only difference between them is the message.`
      : 'No ad is included yet. Add the creative the channel requires.' },
    { id: 'geography', label: 'Geography', detail: included[0]?.locationNote || 'No service area is saved.' },
    { id: 'budget', label: 'Budget management', detail: `${args.budgetNote} A later budget change has to stay inside the daily cap and the max percent change. Undo puts the previous amount back. Status is not changed by a budget edit.` },
    { id: 'ab_test', label: 'A/B test', detail: `One variable at a time: the message (offer, the job itself, or the local crew). Image, audience, and destination stay the same inside an ad set. The learning ceiling at this budget is ${ceiling} ad${ceiling === 1 ? '' : 's'}. This create runs ${ads.length}. That count comes from the ceiling and the three messages the playbook can write. It is not a package size.` },
    { id: 'retargeting', label: 'Retargeting', detail: 'Retargeting is part of this build: site visitors, video viewers, and people who opened the form, with past customers excluded once a list is connected. No list is connected, so no retargeting ad set is created and no audience is invented.' },
    { id: 'form', label: 'Landing page and lead form', detail: args.destinationNote },
    { id: 'report', label: 'Reporting', detail: 'Weekly check after a campaign is turned on: leave it alone for the first three days, then read cost per lead. Monthly: the marketing report on Reports, with spend and leads for this channel. Those reads do not change the budget. A change still needs your approval.' },
  ];
}

function exclusions(trade?: string): string {
  const rules = applyAudienceRules(trade, audiencesFor(trade).segments);
  const list = rules.alwaysExclude.length ? rules.alwaysExclude.join(', ') : 'past customers, open leads, employees';
  return `Do not target protected traits. When a customer list exists, exclude ${list}. No list is connected, so those exclusions are not attached.`;
}

export function buildMetaPlan(input: PaidPlanInput): { plan: MetaPlan; checklist: ReviewItem[] } {
  const daily = Math.max(0, Math.round(Number(input.dailyBudget) || 0));
  const site = websiteOf(input.website);
  const image = (input.imageUrls || []).map(httpsOnly).find(Boolean) || '';
  const pixel = (input.pixelId || '').replace(/[^\d]/g, '');
  const wantSite = input.destination === 'website';
  const destination: MetaPlan['destination'] = wantSite && pixel ? 'website' : 'instant_form';
  const geo = parseServiceArea(input.serviceAreas, input.city);
  const trade = tradeLabel(input.trade);
  const name = clip(`${plain(input.business || trade)} | Leads | ${geo.city || 'service area'}`, 100);
  const sets = buildSets({
    channel: 'meta',
    input,
    daily,
    minEach: META_ADSET_MIN,
    destination,
    optimization: destination === 'website' ? 'OFFSITE_CONVERSIONS' : 'LEAD_GENERATION',
    placements: 'Advantage+ placements',
    image,
  });
  const mode = budgetMode(sets);
  const included = sets.filter((set) => set.included);
  const plan: MetaPlan = {
    channel: 'meta',
    name,
    objective: 'OUTCOME_LEADS',
    buyingType: 'AUCTION',
    specialAdCategories: [],
    specialAdNote: 'No special ad category. Home-services repair and replacement are not in Meta\'s housing examples (listings, insurance, mortgages, appraisals). Financing copy is not declared as a financial product unless the ad itself is the loan.',
    budgetMode: mode,
    budgetNote: mode === 'cbo'
      ? `Advantage+ campaign budget. $${daily} a day sits on the campaign. The ad set amounts are the intended weights, not separate caps.`
      : `One ad set, so the $${daily} daily amount sits on that ad set.`,
    dailyBudget: daily,
    status: 'PAUSED',
    advantageAudience: true,
    advantagePlacements: true,
    destination,
    pixelId: pixel || undefined,
    form: formFor(name, site, input.trade, input.offer || `${trade} quote`),
    adSets: sets,
    exclusionsNote: exclusions(input.trade),
    elements: buildElements({
      channel: 'meta',
      business: plain(input.business || trade),
      trade,
      city: geo.city,
      daily,
      budgetNote: mode === 'cbo'
        ? `$${daily} a day is a campaign budget Miles lets Meta distribute.`
        : `$${daily} a day sits on the one ad set.`,
      destinationNote: destination === 'website' ? 'People who click go to the website, and the pixel is the lead event.' : 'People who click open a higher-intent instant form.',
      sets,
      competitors: input.competitors,
      cpl: playbookCplBand(input.trade)?.high ?? 80,
    }),
  };
  if (wantSite && !pixel) {
    plan.budgetNote += ' A website destination was asked for, and no pixel id is saved, so the plan stays on the instant form.';
  }
  const checklist = reviewMetaPlan(plan, { dailyCap: input.dailyCap, monthlyCap: input.monthlyCap, financing: input.financing, cpl: playbookCplBand(input.trade)?.high ?? 80 });
  void included;
  return { plan, checklist };
}

export function buildTikTokPlan(input: PaidPlanInput): { plan: TikTokPlan; checklist: ReviewItem[] } {
  const daily = Math.max(0, Math.round(Number(input.dailyBudget) || 0));
  const site = websiteOf(input.website);
  const video = httpsOnly(input.videoUrl);
  const pixel = (input.pixelId || '').replace(/[^\d]/g, '');
  const geo = parseServiceArea(input.serviceAreas, input.city);
  const trade = tradeLabel(input.trade);
  const name = clip(`${plain(input.business || trade)} | TikTok leads | ${geo.city || 'service area'}`, 100);
  const sets = buildSets({
    channel: 'tiktok',
    input,
    daily,
    minEach: TIKTOK_ADGROUP_MIN + 1,
    destination: 'website',
    optimization: pixel ? 'LEAD_GENERATION' : 'CLICK',
    placements: 'TikTok only',
    video,
  });
  const plan: TikTokPlan = {
    channel: 'tiktok',
    name,
    objective: 'LEAD_GENERATION',
    budgetMode: 'ad_group',
    budgetNote: `Manual lead campaign. The campaign daily budget is $${daily}. Each included ad group has its own daily budget. Smart+ is not used.`,
    dailyBudget: daily,
    status: 'DISABLE',
    destination: 'website',
    destinationNote: 'The ad opens your website. TikTok instant forms are not created: Pipedream has no verified form action. The questions below are for that page.',
    pixelId: pixel || undefined,
    videoUrl: video || undefined,
    form: formFor(name, site, input.trade, input.offer || `${trade} quote`),
    adSets: sets,
    exclusionsNote: exclusions(input.trade),
    elements: buildElements({
      channel: 'tiktok',
      business: plain(input.business || trade),
      trade,
      city: geo.city,
      daily,
      budgetNote: `$${daily} a day on the campaign, with each ad group carrying its own share.`,
      destinationNote: 'People who click go to the website. The qualifying questions are for that page. An instant form is not created.',
      sets,
      competitors: input.competitors,
      cpl: playbookCplBand(input.trade)?.high ?? 80,
    }),
  };
  return { plan, checklist: reviewTikTokPlan(plan, { dailyCap: input.dailyCap, monthlyCap: input.monthlyCap, financing: input.financing, cpl: playbookCplBand(input.trade)?.high ?? 80 }) };
}

function item(id: string, label: string, state: ReviewState, detail: string): ReviewItem {
  return { id, label, state, detail: plain(detail) };
}

function capBlocks(daily: number, caps?: { dailyCap?: number; monthlyCap?: number }): ReviewItem[] {
  const out: ReviewItem[] = [];
  if (caps?.dailyCap && caps.dailyCap > 0 && daily > caps.dailyCap) {
    out.push(item('cap', 'Daily cap', 'block', `$${daily} a day is above the $${caps.dailyCap} daily cap. Nothing will be created.`));
  } else if (caps?.dailyCap && caps.dailyCap > 0) {
    out.push(item('cap', 'Daily cap', 'pass', `$${daily} a day is inside the $${caps.dailyCap} daily cap.`));
  }
  if (caps?.monthlyCap && caps.monthlyCap > 0 && daily * 30 > caps.monthlyCap) {
    out.push(item('month', 'Monthly cap', 'block', `$${daily} a day is about $${daily * 30} a month, above the $${caps.monthlyCap} monthly cap.`));
  }
  return out;
}

export function reviewMetaPlan(plan: MetaPlan, extra?: { dailyCap?: number; monthlyCap?: number; financing?: boolean; cpl?: number }): ReviewItem[] {
  const included = plan.adSets.filter((set) => set.included);
  const ads = included.flatMap((set) => set.ads.filter((ad) => ad.included));
  const rows: ReviewItem[] = [];
  rows.push(item('objective', 'Objective', plan.objective === 'OUTCOME_LEADS' ? 'pass' : 'block', plan.objective === 'OUTCOME_LEADS' ? 'Leads. Traffic is not used.' : 'The objective is not Leads.'));
  const paused = plan.status === 'PAUSED' && included.every((set) => true) && ads.every((ad) => true);
  rows.push(item('status', 'Status', paused ? 'pass' : 'block', 'Created paused. This approval does not turn spend on.'));
  rows.push(item('category', 'Special ad category', plan.specialAdCategories.length === 0 ? 'pass' : 'block', plan.specialAdNote));
  if (extra?.financing) rows.push(item('financing', 'Financing line', 'warn', 'Financing is mentioned with a terms line. The special ad category stays empty. If Meta rejects the ad, appeal it. Do not switch the category on in order to force it through.'));
  const located = included.length > 0 && included.every((set) => set.zips.length > 0 || (set.city && set.radiusMiles >= 10 && set.radiusMiles <= 50));
  rows.push(item('location', 'Location', located ? 'pass' : 'block', located ? included[0]!.locationNote : 'Add a service-area ZIP or a city. Miles will not target the whole country.'));
  const ageOk = included.every((set) => set.ageMin === AGE_CONTROL);
  rows.push(item('age', 'Age', ageOk ? 'pass' : 'block', ageOk ? `Hard minimum ${AGE_CONTROL}. Segment age is a suggestion (${included[0]?.ageSuggestion || '30-65+'}).` : 'The hard age minimum has to stay at 25 while Advantage+ audience is on.'));
  rows.push(...capBlocks(plan.dailyBudget, extra));
  const starved = included.length > 1 && included.some((set) => set.dailyBudget < META_ADSET_MIN);
  const small = included.length === 1 && included[0]!.dailyBudget > 0 && included[0]!.dailyBudget < META_ADSET_MIN;
  rows.push(item('split', 'Ad set budget', !included.length || starved ? 'block' : small ? 'warn' : 'pass', small ? `${plan.budgetNote} Under $${META_ADSET_MIN} a day. Meta can take it. Learning will not get 50 leads a week.` : plan.budgetNote));
  if (plan.destination === 'website') {
    rows.push(item('destination', 'Destination', plan.pixelId ? 'pass' : 'block', plan.pixelId ? `Website conversions on pixel ${plan.pixelId}.` : 'A website destination needs a pixel id. Nothing will be created.'));
  } else {
    const formOk = !!plan.form.privacyUrl && plan.form.questions.length === 2 && plan.form.higherIntent && plan.form.prefill.length >= 3;
    rows.push(item('destination', 'Lead form', formOk ? 'pass' : 'block', formOk ? `Higher-intent form. Prefill ${plan.form.prefill.join(', ')}. Custom: ${plan.form.questions.map((q) => q.label).join(' ')}` : 'The form needs a privacy URL and two qualifying questions.'));
  }
  const images = ads.length > 0 && ads.every((ad) => httpsOnly(ad.imageUrl));
  rows.push(item('creative', 'Image', images ? 'pass' : 'block', images ? 'Each included ad has an https image.' : 'Add an https image. A data URL is not sent to Meta.'));
  if (images && new Set(ads.map((ad) => ad.imageUrl)).size < 2 && ads.length > 1) {
    rows.push(item('creative-mix', 'Creative mix', 'warn', 'Every ad uses the same image. Add more photos before you scale. The create still uses this image.'));
  }
  const dirty = ads.some((ad) => usesProtectedTrait(`${ad.primaryText} ${ad.headline}`));
  rows.push(item('copy', 'Copy', dirty ? 'block' : 'pass', dirty ? 'Copy uses a protected trait. It will not be created.' : 'No protected trait in the ad copy.'));
  const cpl = extra?.cpl ?? 80;
  const week = cpl > 0 ? Math.round((plan.dailyBudget * 7) / cpl) : 0;
  rows.push(item('learning', 'Learning', 'warn', week >= 50 ? `About ${week} leads a week at the playbook's high cost per lead. That can exit learning.` : `About ${week} leads a week at the playbook's high cost per lead. Meta's learning guide is about 50 optimization events a week. This budget will not get there. The campaign can still be created paused.`));
  rows.push(item('live', 'Go live', 'pass', 'Not part of this approval.'));
  for (const element of plan.elements || []) {
    const warn = element.id === 'retargeting' || (element.id === 'competitors' && /No competitor/.test(element.detail));
    rows.push(item(element.id, element.label, warn ? 'warn' : 'pass', element.detail));
  }
  return rows;
}

export function reviewTikTokPlan(plan: TikTokPlan, extra?: { dailyCap?: number; monthlyCap?: number; financing?: boolean; cpl?: number }): ReviewItem[] {
  const included = plan.adSets.filter((set) => set.included);
  const ads = included.flatMap((set) => set.ads.filter((ad) => ad.included));
  const rows: ReviewItem[] = [];
  rows.push(item('objective', 'Objective', plan.objective === 'LEAD_GENERATION' ? 'pass' : 'block', 'Lead generation. Smart+ is not used.'));
  rows.push(item('status', 'Status', plan.status === 'DISABLE' ? 'pass' : 'block', 'Created disabled. TikTok\'s word for paused on create is DISABLE. This approval does not enable it.'));
  const budgetOk = plan.dailyBudget > TIKTOK_CAMPAIGN_MIN && included.every((set) => set.dailyBudget > TIKTOK_ADGROUP_MIN);
  rows.push(item('tiktok-min', 'TikTok minimum', budgetOk ? 'pass' : 'block', budgetOk
    ? `Campaign $${plan.dailyBudget} exceeds $50. Each ad group exceeds $20.`
    : `TikTok requires a daily campaign budget over $50 and each ad group over $20 (About budgets, July 2026). This plan is $${plan.dailyBudget}. Miles will not raise it. Nothing will be created.`));
  rows.push(...capBlocks(plan.dailyBudget, extra));
  const located = included.length > 0 && included.every((set) => set.zips.length > 0 || !!set.city);
  rows.push(item('location', 'Location', located ? 'pass' : 'block', located ? `${included[0]!.locationNote} The city is matched to a TikTok location id when you approve. If it does not match, nothing is created.` : 'Add a city or ZIP. Miles will not target the whole country.'));
  rows.push(item('placement', 'Placement', included.every((set) => set.placements === 'TikTok only') ? 'pass' : 'block', 'TikTok placement only. Pangle is not included.'));
  rows.push(item('destination', 'Destination', plan.form.privacyUrl ? 'pass' : 'block', plan.destinationNote));
  const videoOk = !!httpsOnly(plan.videoUrl) && ads.length > 0 && ads.every((ad) => httpsOnly(ad.videoUrl));
  rows.push(item('creative', 'Video', videoOk ? 'pass' : 'block', videoOk ? 'A public https video URL is on the plan. Confirm it is 9:16, about 5 to 60 seconds, with a hook in the first 3 seconds and captions. Miles does not inspect the file.' : 'Add a public https video URL. TikTok lead ads are built from video, not a still image.'));
  const dirty = ads.some((ad) => usesProtectedTrait(`${ad.primaryText} ${ad.headline}`));
  rows.push(item('copy', 'Copy', dirty ? 'block' : 'pass', dirty ? 'Copy uses a protected trait.' : 'Ad text is short and has no protected trait.'));
  if (extra?.financing) rows.push(item('financing', 'Financing line', 'warn', 'Financing copy includes the terms line. It is not a loan ad.'));
  const cpl = extra?.cpl ?? 80;
  const week = cpl > 0 ? Math.round((plan.dailyBudget * 7) / cpl) : 0;
  rows.push(item('learning', 'Learning', 'warn', `About ${week} results a week at the playbook high cost per lead. TikTok still wants the $50 / $20 minimums before it will take the campaign.`));
  rows.push(item('connect', 'Connection', 'warn', 'The TikTok advertiser is checked when you approve. This page does not connect an account.'));
  rows.push(item('live', 'Go live', 'pass', 'Not part of this approval.'));
  for (const element of plan.elements || []) {
    const warn = element.id === 'retargeting' || (element.id === 'competitors' && /No competitor/.test(element.detail));
    rows.push(item(element.id, element.label, warn ? 'warn' : 'pass', element.detail));
  }
  return rows;
}

export function reviewBlocked(items: ReviewItem[]): string | null {
  const hit = items.find((row) => row.state === 'block');
  return hit ? hit.detail : null;
}

export function includedAds(sets: PaidAdSet[]): { set: PaidAdSet; ad: PaidAd }[] {
  const out: { set: PaidAdSet; ad: PaidAd }[] = [];
  for (const set of sets) {
    if (!set.included) continue;
    for (const ad of set.ads) if (ad.included) out.push({ set, ad });
  }
  return out;
}
