/**
 * Launch page view model.
 * Budget pills follow the saved daily cap. Channels Miles cannot launch stay
 * unselectable. Estimates are math from saved inputs, never the mock's figures.
 */
import type { CampaignSpec } from '../agents/campaign.js';
import { buildCampaignSpec } from '../agents/campaign.js';
import { parseServiceArea, seasonFocus } from '../agents/contractorloop.js';
import type { MilesMode } from '../agents/policy.js';
import { categoryForIndustry } from '../brand/trade.js';

export const BUDGET_CHOICES = [
  { daily: 10, hint: 'Test the water' },
  { daily: 20, hint: 'Playbook default' },
  { daily: 35, hint: 'Grow faster' },
  { daily: 50, hint: 'Go big' },
] as const;

export interface LaunchInput {
  mode: MilesMode | null;
  trade: string;
  market: string;
  services: string;
  website: string;
  phone: string;
  /** Saved daily cap from setup. Null when the owner has not saved one. */
  savedCap: number | null;
  leadsPerDay: number | null;
  averageJobValue: number | null;
  /** Close rate as a fraction, only when the owner saved one. */
  closeRate: number | null;
  financing: boolean;
  google: { oauth: boolean; ready: boolean; note: string };
  businessName: string;
  now?: Date;
}

export interface LaunchEstimate {
  label: string;
  display: string;
  kind: 'estimate' | 'saved_goal' | 'empty';
  note: string;
}

export interface LaunchView {
  mode: MilesMode | null;
  tradeLabel: string;
  playbookLine: string;
  seasonLine: string;
  seasonNote: string;
  services: string[];
  goals: { id: 'more_calls' | 'slow_season' | 'offer'; title: string; detail: string }[];
  channels: { id: 'google' | 'meta' | 'lsa'; label: string; selectable: boolean; state: 'ready' | 'hold' | 'off' | 'soon'; detail: string }[];
  budgets: { daily: number; label: string; hint: string; selected: boolean; recommended: boolean }[];
  selectedDaily: number | null;
  savedCap: number | null;
  area: string;
  landingPage: string | null;
  landingHost: string | null;
  jobValue: string | null;
  financing: boolean;
  estimates: LaunchEstimate[];
  breakEven: string | null;
  counts: {
    adGroups: number | null;
    keywords: number | null;
    blocked: number | null;
    ads: number | null;
    sitelinks: number | null;
    call: boolean;
    note: string;
  };
  photoNote: string;
  footer: string;
}

function plain(s: string): string {
  return s.replace(/\u2014/g, ' - ').replace(/\u2013/g, '-').replace(/\s{2,}/g, ' ').trim();
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

function pos(n: number | null | undefined): number | null {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}

export function serviceList(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,;\n]/)) {
    const text = part.trim();
    const key = text.toLowerCase();
    if (text.length < 2 || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

export function launchBudgets(savedCap: number | null): LaunchView['budgets'] {
  const cap = pos(savedCap);
  return BUDGET_CHOICES.map((choice) => {
    const matches = cap != null && choice.daily === cap;
    return {
      daily: choice.daily,
      label: `${money(choice.daily)} / day`,
      hint: matches ? 'Recommended' : choice.hint,
      selected: matches,
      recommended: matches,
    };
  });
}

export function launchEstimates(args: {
  daily: number | null;
  leadsPerDay: number | null;
  averageJobValue: number | null;
  closeRate: number | null;
}): { estimates: LaunchEstimate[]; breakEven: string | null } {
  const daily = pos(args.daily);
  const leadsPerDay = pos(args.leadsPerDay);
  const job = pos(args.averageJobValue);
  const close = args.closeRate != null && args.closeRate > 0 && args.closeRate <= 1 ? args.closeRate : null;
  const estimates: LaunchEstimate[] = [
    daily
      ? { label: 'Monthly spend', display: money(daily * 30), kind: 'estimate', note: `Estimate from the ${money(daily)}/day budget. Not measured spend.` }
      : { label: 'Monthly spend', display: 'n/a', kind: 'empty', note: 'Pick a daily budget. Miles will not assume $0.' },
    leadsPerDay
      ? { label: 'Leads / mo', display: String(Math.round(leadsPerDay * 30)), kind: 'saved_goal', note: 'From your saved leads-per-day goal. Not a forecast.' }
      : { label: 'Leads / mo', display: 'n/a', kind: 'empty', note: 'No leads-per-day goal is saved.' },
  ];
  const booked = leadsPerDay && close ? Math.round(leadsPerDay * 30 * close) : null;
  estimates.push(
    booked != null
      ? { label: 'Booked jobs / mo', display: String(booked), kind: 'estimate', note: 'Estimate from your saved lead goal and close rate. Not booked jobs on file.' }
      : { label: 'Booked jobs / mo', display: 'n/a', kind: 'empty', note: 'No close rate is saved, so Miles will not estimate booked jobs.' },
  );
  estimates.push(
    booked != null && job
      ? { label: 'Revenue / mo', display: money(booked * job), kind: 'estimate', note: 'Estimate from that job count and your saved average job value. Not revenue on file.' }
      : { label: 'Revenue / mo', display: 'n/a', kind: 'empty', note: 'Revenue needs a saved job value and a close rate.' },
  );
  const breakEven = job && close ? money(job * close) : null;
  return { estimates, breakEven };
}

export function launchBuildAction(args: {
  mode: MilesMode | null;
  selectedDaily: number | null;
  savedCap: number | null;
}): { action: 'need_budget' | 'over_cap' | 'skip' | 'queue' | 'create_paused'; message: string } {
  const daily = pos(args.selectedDaily);
  const cap = pos(args.savedCap);
  if (!daily) return { action: 'need_budget', message: 'Pick a daily budget. Nothing was created.' };
  if (cap && daily > cap + 0.001) {
    return { action: 'over_cap', message: `That is above your ${money(cap)}/day cap. Raise the cap in setup, or pick a lower budget. Nothing was created.` };
  }
  if (args.mode === 'manual' || !args.mode) {
    return { action: 'skip', message: 'Ask me first is on. Miles will not create this campaign. Nothing was created.' };
  }
  if (args.mode === 'hybrid') {
    return { action: 'queue', message: 'Hybrid is on. Miles queued this for your approval. Nothing was created or spent.' };
  }
  return { action: 'create_paused', message: 'Do everything is on. Miles will create this paused, inside your cap. This button does not enable it or spend.' };
}

export function hostOf(url: string): string | null {
  const raw = url.trim();
  if (!raw || /example\.com/i.test(raw)) return null;
  try {
    const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    return new URL(withProto).host.replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function buildLaunchView(input: LaunchInput, spec?: CampaignSpec | null): LaunchView {
  const tradeKey = categoryForIndustry(input.trade);
  const now = input.now ?? new Date();
  const season = seasonFocus(tradeKey, now.getMonth());
  const services = serviceList(input.services);
  const cap = pos(input.savedCap);
  const area = parseServiceArea(input.market);
  const city = area.locations.find((loc) => !/^\d{5}$/.test(loc)) || input.market.trim();
  const areaLabel = city
    ? (area.radiusMiles ? `${city} + ${area.radiusMiles} mi` : city)
    : 'Not saved';
  const landing = input.website.trim();
  const realLanding = landing && !/example\.com/i.test(landing) ? landing : null;
  const budgets = launchBudgets(cap);
  const selectedDaily = budgets.find((b) => b.selected)?.daily ?? cap;
  const math = launchEstimates({
    daily: selectedDaily,
    leadsPerDay: input.leadsPerDay,
    averageJobValue: input.averageJobValue,
    closeRate: input.closeRate,
  });
  const tradeLabel = input.trade.trim() || 'your trade';
  const goals: LaunchView['goals'] = [
    { id: 'more_calls', title: 'More calls', detail: 'Ready-to-book homeowners' },
    { id: 'slow_season', title: 'Fill a slow season', detail: season.line ? `Push ${season.line}` : plain(season.note) },
    { id: 'offer', title: 'Promote an offer', detail: 'Lead with a deal' },
  ];
  const googleDetail = input.google.ready
    ? 'Ready'
    : plain(input.google.note || (input.google.oauth
      ? 'Signed in. The ad customer id is not resolved, so this is not ready to launch.'
      : 'Not ready. Connect Google Ads and resolve the customer id.'));
  return {
    mode: input.mode,
    tradeLabel,
    playbookLine: plain(`Don't want to set it up? Run a ready-made playbook for ${tradeLabel.toLowerCase()} instead.`),
    seasonLine: season.line,
    seasonNote: plain(season.note),
    services,
    goals,
    channels: [
      { id: 'google', label: 'Google Search', selectable: input.google.ready, state: input.google.ready ? 'ready' : (input.google.oauth ? 'hold' : 'off'), detail: googleDetail },
      { id: 'meta', label: 'Facebook / Instagram', selectable: false, state: 'soon', detail: 'Coming soon. Miles cannot launch this.' },
      { id: 'lsa', label: 'Local Services Ads', selectable: false, state: 'soon', detail: 'Coming soon. Miles cannot launch this.' },
    ],
    budgets,
    selectedDaily,
    savedCap: cap,
    area: areaLabel,
    landingPage: realLanding,
    landingHost: realLanding ? hostOf(realLanding) : null,
    jobValue: pos(input.averageJobValue) ? money(input.averageJobValue!) : null,
    financing: input.financing,
    estimates: math.estimates,
    breakEven: math.breakEven ? `Break-even cost per lead: ${math.breakEven}. That uses your saved job value and close rate. It is not a measured result.` : null,
    counts: {
      adGroups: spec ? spec.adGroups.length : null,
      keywords: spec ? spec.adGroups.reduce((n, g) => n + g.keywords.length, 0) : null,
      blocked: spec ? spec.negatives.length : null,
      ads: spec ? spec.adGroups.length : null,
      sitelinks: spec ? (spec.sitelinks || []).length : null,
      call: !!input.phone.trim(),
      note: 'You will review every setting before approving. Counts are the planned Search build, not a live account.',
    },
    photoNote: 'A photo Miles makes uses monthly media credits. This page does not generate a photo or charge credits.',
    footer: 'Miles builds it paused. You will see every setting, then approve it in your decisions before a dollar is spent.',
  };
}

export function previewSpec(input: LaunchInput): CampaignSpec | null {
  const services = serviceList(input.services);
  const landing = input.website.trim();
  if (!services.length && !landing) return null;
  const cap = pos(input.savedCap) || 20;
  const area = parseServiceArea(input.market);
  const city = area.locations.find((loc) => !/^\d{5}$/.test(loc)) || '';
  const spec = buildCampaignSpec(
    {
      goal: services[0] || input.trade || 'more calls',
      dailyBudget: cap,
      finalUrl: landing && !/example\.com/i.test(landing) ? landing : undefined,
      locations: area.locations.length ? area.locations : undefined,
    },
    {
      business: input.businessName,
      trade: input.trade,
      city,
      services: services.join(', ') || input.trade,
    },
  );
  if (/example\.com/i.test(spec.finalUrl)) spec.finalUrl = '';
  spec.status = 'PAUSED';
  return spec;
}

export function launchCopy(view: LaunchView): string[] {
  const out: string[] = [view.playbookLine, view.seasonNote, view.footer, view.photoNote, view.counts.note, view.area];
  if (view.breakEven) out.push(view.breakEven);
  if (view.landingPage) out.push(view.landingPage);
  view.goals.forEach((g) => out.push(g.title, g.detail));
  view.channels.forEach((c) => out.push(c.label, c.detail));
  view.budgets.forEach((b) => out.push(b.label, b.hint));
  view.estimates.forEach((e) => out.push(e.label, e.display, e.note));
  return out;
}
