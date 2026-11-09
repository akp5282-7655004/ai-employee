/**
 * Contractor loop rules that sit on top of the paused Google Search create.
 * Pure functions. They do not call Pipedream.
 *
 * Google Search is the intent backbone. Emergency and planned demand are
 * separate campaigns when the trade has emergency work and the approved total
 * can fund both. Other channels stay out until the budget and a verified
 * action both exist.
 */

import { buildCampaignSpec, type CampaignSpec } from './campaign.js';
import { categoryForIndustry } from '../brand/trade.js';

export interface ProfileFields {
  businessName?: string;
  trade?: string;
  serviceArea?: string;
  services?: string;
  dailyBudget?: number;
  monthlyBudget?: number;
  targetCpl?: number;
  averageJobValue?: number;
  landingPage?: string;
  logoUrl?: string;
}

export interface ProfileGap {
  field: string;
  label: string;
}

export interface ProfileAssessment {
  complete: boolean;
  missing: ProfileGap[];
  businessName: string;
  trade: string;
  tradeLabel: string;
  emergency: boolean;
  locations: string[];
  radiusMiles: number | null;
  services: string[];
  dailyBudget: number | null;
  targetCpl: number | null;
  averageJobValue: number | null;
  landingPage: string;
  logo: { present: boolean; note: string };
}

export interface PlannedSearch {
  role: 'emergency' | 'planned';
  serviceLine: string;
  schedule: string;
  spec: CampaignSpec;
}

const EMERGENCY = ['plumbing', 'hvac', 'electrical', 'roofing', 'water_damage', 'garage_door'];

const money = (n: number) => Math.round(n * 100) / 100;

export function parseServiceArea(raw: string | undefined): { locations: string[]; radiusMiles: number | null } {
  const text = (raw || '').trim();
  if (!text) return { locations: [], radiusMiles: null };
  const radius = text.match(/(\d+(?:\.\d+)?)\s*(?:mile|miles|mi)\b/i);
  const zips = text.match(/\b\d{5}\b/g) ?? [];
  const cities = text
    .split(/[,;\n]/)
    .map((part) => part.replace(/\b\d{5}\b/g, '').replace(/(\d+(?:\.\d+)?)\s*(?:mile|miles|mi)\b/i, '').trim())
    .filter((part) => part.length > 1 && !/^(usa|united states)$/i.test(part));
  const locations = [...zips, ...cities];
  return { locations: [...new Set(locations)].slice(0, 40), radiusMiles: radius ? Number(radius[1]) : null };
}

export function assessProfile(input: ProfileFields, explicitDaily?: number): ProfileAssessment {
  const missing: ProfileGap[] = [];
  const businessName = (input.businessName || '').trim();
  const trade = categoryForIndustry(input.trade);
  const area = parseServiceArea(input.serviceArea);
  const services = (input.services || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const dailyFromMonthly = input.monthlyBudget && input.monthlyBudget > 0 ? money(input.monthlyBudget / 30) : null;
  const daily = explicitDaily && explicitDaily > 0 ? money(explicitDaily) : (input.dailyBudget && input.dailyBudget > 0 ? money(input.dailyBudget) : dailyFromMonthly);
  const target = input.targetCpl && input.targetCpl > 0 ? money(input.targetCpl) : null;
  const job = input.averageJobValue && input.averageJobValue > 0 ? money(input.averageJobValue) : null;
  const landing = (input.landingPage || '').trim();
  const logo = (input.logoUrl || '').trim();
  if (!businessName) missing.push({ field: 'businessName', label: 'Business name' });
  if (!trade) missing.push({ field: 'trade', label: 'Trade' });
  if (!area.locations.length) missing.push({ field: 'serviceArea', label: 'Service area (ZIPs, cities, or a radius)' });
  if (daily == null) missing.push({ field: 'budget', label: 'Daily or monthly budget' });
  if (target == null) missing.push({ field: 'targetCpl', label: 'Target cost per lead' });
  if (job == null) missing.push({ field: 'averageJobValue', label: 'Average job value' });
  if (!landing) missing.push({ field: 'landingPage', label: 'Landing page' });
  return {
    complete: missing.length === 0,
    missing,
    businessName,
    trade,
    tradeLabel: (input.trade || '').trim(),
    emergency: EMERGENCY.includes(trade),
    locations: area.locations,
    radiusMiles: area.radiusMiles,
    services: services.length ? services : (trade ? [trade.replace(/_/g, ' ')] : []),
    dailyBudget: daily,
    targetCpl: target,
    averageJobValue: job,
    landingPage: landing,
    logo: {
      present: !!logo,
      note: logo ? 'The uploaded logo is attached. Miles did not generate a new image.' : 'No logo is on the profile. No image was generated.',
    },
  };
}

export function seasonFocus(trade: string, month: number): { line: string; note: string } {
  if (trade === 'hvac' && month >= 5 && month <= 7) return { line: 'air conditioning', note: 'Summer shifts the Search plan toward air conditioning. Furnace stays in the account for fall.' };
  if (trade === 'hvac' && month >= 8 && month <= 10) return { line: 'furnace', note: 'Fall shifts the Search plan toward furnace work. Air conditioning is not the lead service this month.' };
  if (trade === 'roofing' && month >= 3 && month <= 8) return { line: 'storm roof repair', note: 'Storm season leads with roof repair. Planned replacement stays in its own ad group.' };
  if (trade === 'painting' && (month === 3 || month === 4 || month === 8 || month === 9)) return { line: 'exterior painting', note: 'Spring and fall lead with exterior painting. Interior work stays in the same planned campaign.' };
  if (trade === 'painting') return { line: 'interior painting', note: 'Outside the exterior season, interior painting leads. The budget does not move to a different city.' };
  return { line: '', note: 'No seasonal shift applies this month. The approved total stays on the service area in the profile.' };
}

function keywords(role: 'emergency' | 'planned', service: string, place: string): { text: string; match: 'phrase' | 'exact' }[] {
  const placeBit = place ? ` ${place}` : '';
  if (role === 'emergency') {
    return [
      { text: `emergency ${service}${placeBit}`.trim(), match: 'phrase' },
      { text: `${service} near me`, match: 'phrase' },
      { text: `24 hour ${service}`, match: 'exact' },
    ];
  }
  return [
    { text: `${service}${placeBit}`.trim(), match: 'phrase' },
    { text: `${service} quote`, match: 'phrase' },
    { text: `${service} near me`, match: 'exact' },
  ];
}

function oneSpec(args: {
  name: string;
  business: string;
  trade: string;
  service: string;
  city: string;
  locations: string[];
  daily: number;
  landing: string;
  role: 'emergency' | 'planned';
}): CampaignSpec {
  const spec = buildCampaignSpec(
    { goal: args.service, dailyBudget: args.daily, finalUrl: args.landing, locations: args.locations },
    { business: args.business, trade: args.trade, city: args.city, services: args.service },
  );
  spec.name = args.name.slice(0, 120);
  spec.dailyBudget = args.daily;
  spec.locations = args.locations.slice();
  spec.finalUrl = args.landing;
  spec.status = 'PAUSED';
  const group = spec.adGroups[0];
  if (group) {
    group.name = args.role === 'emergency' ? `Emergency ${args.service}` : args.service;
    group.keywords = keywords(args.role, args.service, args.city);
    group.rsa.headlines = [
      `${args.business}`.slice(0, 30),
      `${args.service}`.slice(0, 30),
      args.city ? `Serving ${args.city}`.slice(0, 30) : 'Local service',
    ];
    group.rsa.descriptions = [
      `${args.business} ${args.service}. Created paused. Nothing spends until you approve activation.`.slice(0, 90),
    ];
  }
  return spec;
}

export function buildSearchCampaigns(assessed: ProfileAssessment, now = new Date()): PlannedSearch[] {
  if (!assessed.complete || !assessed.dailyBudget) return [];
  const total = assessed.dailyBudget;
  const season = seasonFocus(assessed.trade, now.getMonth());
  const place = assessed.locations.find((loc) => !/^\d{5}$/.test(loc)) || assessed.locations[0] || '';
  const leadService = season.line || assessed.services[0] || assessed.trade.replace(/_/g, ' ');
  const plannedService = assessed.services.find((s) => !s.toLowerCase().includes(leadService.split(' ')[0] || '___')) || leadService;
  const base = `${assessed.businessName} ${now.getFullYear()}`;
  if (assessed.emergency && total >= 10) {
    const emergencyDaily = money(total / 2);
    const plannedDaily = money(total - emergencyDaily);
    return [
      {
        role: 'emergency',
        serviceLine: leadService,
        schedule: 'All hours. Emergency calls only.',
        spec: oneSpec({
          name: `${base} emergency`,
          business: assessed.businessName,
          trade: assessed.trade,
          service: assessed.trade === 'painting' ? leadService : `emergency ${assessed.services[0] || assessed.trade}`,
          city: place,
          locations: assessed.locations,
          daily: emergencyDaily,
          landing: assessed.landingPage,
          role: 'emergency',
        }),
      },
      {
        role: 'planned',
        serviceLine: plannedService,
        schedule: 'Weekdays, 8am to 6pm in the account time zone.',
        spec: oneSpec({
          name: `${base} planned`,
          business: assessed.businessName,
          trade: assessed.trade,
          service: plannedService,
          city: place,
          locations: assessed.locations,
          daily: plannedDaily,
          landing: assessed.landingPage,
          role: 'planned',
        }),
      },
    ];
  }
  return [{
    role: 'planned',
    serviceLine: leadService,
    schedule: assessed.emergency
      ? 'One Search campaign. The daily total is under $10, so Miles does not split off a second emergency budget.'
      : 'Weekdays, 8am to 6pm in the account time zone.',
    spec: oneSpec({
      name: `${base} search`,
      business: assessed.businessName,
      trade: assessed.trade,
      service: leadService,
      city: place,
      locations: assessed.locations,
      daily: total,
      landing: assessed.landingPage,
      role: 'planned',
    }),
  }];
}

export const GHL_OPPORTUNITY_ACTION = null;
export const GHL_OPPORTUNITY_GAP =
  'Pipedream highlevel_oauth publishes six actions (add contact to campaign, create contact, list businesses, list campaign ids, update contact, upsert contact). None of them upsert an opportunity or set a pipeline stage. Miles keeps the stage on this account and does not call the HighLevel API for it.';

export function stageOpportunity(): { sent: false; action: null; reason: string } {
  return { sent: false, action: null, reason: GHL_OPPORTUNITY_GAP };
}

export interface FollowUpPlan {
  disposition: 'skip' | 'draft' | 'send';
  kind: 'none' | 'speed_to_lead' | 'missed_call' | 'nurture';
  body: string;
  reason: string;
}

export function planFollowUp(args: {
  name?: string;
  phone?: string;
  consent?: boolean;
  optOut?: boolean;
  source?: string;
  missedCall?: boolean;
  ghlConnected: boolean;
  automationEnabled: boolean;
  businessName?: string;
}): FollowUpPlan {
  const who = (args.businessName || 'us').slice(0, 80);
  const person = args.name || 'there';
  if (args.optOut || args.consent === false) {
    return { disposition: 'skip', kind: 'none', body: '', reason: 'No message. Consent is missing or the person opted out.' };
  }
  if (args.source === 'google_lsa_forwarded') {
    return { disposition: 'skip', kind: 'none', body: '', reason: 'Forwarded Local Services notice. Miles does not text from this event.' };
  }
  if (!args.phone) return { disposition: 'skip', kind: 'none', body: '', reason: 'No phone, so no text.' };
  if (!args.automationEnabled && !args.missedCall) {
    return { disposition: 'draft', kind: 'nurture', body: `Hi ${person}, ${who} received your request.`, reason: 'Speed-to-lead is off. The text is saved as a draft.' };
  }
  const kind = args.missedCall ? 'missed_call' : 'speed_to_lead';
  const body = args.missedCall
    ? `Hi ${person}, we missed your call at ${who}. Reply here and we will get you scheduled.`
    : `Hi ${person}, ${who} received your request and will follow up shortly.`;
  if (!args.ghlConnected) {
    return { disposition: 'draft', kind, body, reason: 'GoHighLevel is not connected. The text is saved as a draft and was not sent.' };
  }
  return { disposition: 'send', kind, body, reason: 'GoHighLevel is connected and the person has not opted out.' };
}

export interface JobMark {
  eventId: string;
  stage: 'new' | 'qualified' | 'booked' | 'won';
  jobValue?: number;
  serviceLine?: string;
  channel?: string;
}

export interface PerfRow {
  key: string;
  spend: number;
  leads: number;
  qualified: number;
  booked: number;
  won: number;
  jobValue: number;
  cpl: number | null;
  costPerQualified: number | null;
  costPerBookedJob: number | null;
  cac: number | null;
  roi: number | null;
}

function ratio(spend: number, count: number): number | null {
  if (count <= 0) return null;
  return money(spend / count);
}

export function rollupJobs(args: {
  spend: { channel: string; serviceLine?: string; amount: number }[];
  jobs: JobMark[];
  sample: boolean;
}): { sample: boolean; label: string; byChannel: PerfRow[]; byServiceLine: PerfRow[] } {
  const group = (keyOf: (channel: string, line: string) => string) => {
    const map = new Map<string, PerfRow>();
    const ensure = (key: string) => map.get(key) ?? map.set(key, { key, spend: 0, leads: 0, qualified: 0, booked: 0, won: 0, jobValue: 0, cpl: null, costPerQualified: null, costPerBookedJob: null, cac: null, roi: null }).get(key)!;
    for (const s of args.spend) ensure(keyOf(s.channel || 'unknown', s.serviceLine || 'general')).spend += s.amount || 0;
    for (const job of args.jobs) {
      const row = ensure(keyOf(job.channel || 'unknown', job.serviceLine || 'general'));
      row.leads += 1;
      if (job.stage === 'qualified' || job.stage === 'booked' || job.stage === 'won') row.qualified += 1;
      if (job.stage === 'booked' || job.stage === 'won') row.booked += 1;
      if (job.stage === 'won') {
        row.won += 1;
        row.jobValue += job.jobValue || 0;
      }
    }
    return [...map.values()].map((row) => ({
      ...row,
      spend: money(row.spend),
      jobValue: money(row.jobValue),
      cpl: ratio(row.spend, row.leads),
      costPerQualified: ratio(row.spend, row.qualified),
      costPerBookedJob: ratio(row.spend, row.booked),
      cac: ratio(row.spend, row.won),
      roi: row.spend > 0 ? money((row.jobValue - row.spend) / row.spend) : null,
    }));
  };
  return {
    sample: args.sample,
    label: args.sample ? 'Sample data. These figures are not from a live ad account.' : 'Figures use this account’s recorded spend and job marks only.',
    byChannel: group((channel) => channel),
    byServiceLine: group((_channel, line) => line),
  };
}

export interface OptimizeProposal {
  id: string;
  kind: 'pause' | 'shift' | 'compare' | 'missed_calls';
  campaign?: string;
  channel?: string;
  requiresApproval: true;
  summary: string;
}

export function proposeOptimizations(args: {
  rows: { campaign: string; channel: string; serviceLine?: string; spend: number; leads: number; booked: number; won: number; jobValue: number; dailyBudget: number; resource?: string }[];
  targetCpl: number;
  spendThreshold: number;
  approvedDailyCap: number;
  missedCalls?: number;
  averageJobValue?: number;
  leadsForRate?: number;
  bookedForRate?: number;
}): { requiresApproval: true; proposals: OptimizeProposal[]; missedCallDollars: number | null; missedCallNote: string } {
  const proposals: OptimizeProposal[] = [];
  const losers = args.rows.filter((row) => {
    if (row.spend >= args.spendThreshold && row.leads === 0) return true;
    if (row.leads > 0 && args.targetCpl > 0 && row.spend / row.leads > args.targetCpl) return true;
    return false;
  });
  for (const row of losers) {
    proposals.push({
      id: `pause:${row.channel}:${row.campaign}`,
      kind: 'pause',
      campaign: row.campaign,
      channel: row.channel,
      requiresApproval: true,
      summary: row.leads === 0
        ? `${row.campaign} spent ${row.spend} with no leads, over the ${args.spendThreshold} pause threshold. Pause is a proposal until you approve it.`
        : `${row.campaign} cost per lead is above the ${args.targetCpl} target. Pause is a proposal until you approve it.`,
    });
  }
  const winners = args.rows.filter((row) => row.booked > 0 && !losers.includes(row));
  winners.sort((a, b) => (a.spend / a.booked) - (b.spend / b.booked));
  const winner = winners[0];
  const loser = losers[0];
  if (winner && loser && loser.dailyBudget > 0) {
    const shift = money(Math.min(loser.dailyBudget, Math.max(0, args.approvedDailyCap)));
    const nextTotal = args.rows.reduce((sum, row) => sum + row.dailyBudget, 0) - (loser === winner ? 0 : 0);
    proposals.push({
      id: `shift:${loser.campaign}:${winner.campaign}`,
      kind: 'shift',
      requiresApproval: true,
      summary: nextTotal <= args.approvedDailyCap + shift
        ? `Move up to ${shift} per day from ${loser.campaign} to ${winner.campaign}, which has the lowest cost per booked job in this set. The approved cap stays ${args.approvedDailyCap}. This does not change Google until you approve it.`
        : `No budget move. Shifting would pass the approved ${args.approvedDailyCap} cap.`,
    });
  }
  const comparable = args.rows.filter((row) => row.booked > 0);
  if (comparable.length) {
    const ranked = [...comparable].sort((a, b) => (a.spend / a.booked) - (b.spend / b.booked));
    proposals.push({
      id: 'compare:channels',
      kind: 'compare',
      requiresApproval: true,
      summary: ranked.map((row) => `${row.channel} ${row.campaign}: ${money(row.spend / row.booked)} per booked job`).join('. '),
    });
  }
  let missedCallDollars: number | null = null;
  let missedCallNote = 'Missed-call dollars need your own lead count, booked count, and average job value. Miles will not invent a close rate.';
  const missed = args.missedCalls ?? 0;
  if (missed > 0 && (args.leadsForRate ?? 0) > 0 && args.averageJobValue && args.averageJobValue > 0 && args.bookedForRate != null) {
    const rate = args.bookedForRate / (args.leadsForRate || 1);
    missedCallDollars = money(missed * rate * args.averageJobValue);
    missedCallNote = `Estimate from your booked-job rate of ${args.bookedForRate} booked out of ${args.leadsForRate} leads. Not a guarantee.`;
    proposals.push({ id: 'missed:calls', kind: 'missed_calls', requiresApproval: true, summary: `${missed} missed calls estimate ${missedCallDollars} using your own rate. ${missedCallNote}` });
  }
  return { requiresApproval: true, proposals, missedCallDollars, missedCallNote };
}

/** TikTok create docs name DISABLE as disabled when created. Pipedream’s operationStatus is that create-time status field. */
export const TIKTOK_CREATE_ACTION = 'tiktok_ads_manager-create-or-update-campaign';
export const TIKTOK_PAUSED_STATUS = 'DISABLE';

export function judgeTikTokCreate(args: {
  confirm: boolean;
  advertiserId?: string;
  campaignName?: string;
  dailyBudget?: number;
  approvedDailyCap?: number;
  connected: boolean;
}): { allowed: boolean; reason: string; configuredProps?: Record<string, unknown> } {
  if (!args.confirm) return { allowed: false, reason: 'Explicit approval is required. Nothing was created.' };
  if (!args.connected) return { allowed: false, reason: 'TikTok Ads is not connected for this account. Nothing was created.' };
  if (!args.advertiserId) return { allowed: false, reason: 'An advertiser id from this account is required. Nothing was created.' };
  if (!args.campaignName) return { allowed: false, reason: 'A campaign name is required. Nothing was created.' };
  const daily = Number(args.dailyBudget);
  const cap = Number(args.approvedDailyCap);
  if (!Number.isFinite(daily) || daily <= 0) return { allowed: false, reason: 'A daily budget is required. Nothing was created.' };
  if (!Number.isFinite(cap) || daily > cap + 0.001) return { allowed: false, reason: 'That budget is above the approved cap. Nothing was created.' };
  return {
    allowed: true,
    reason: 'Approved paused TikTok create. operationStatus is DISABLE.',
    configuredProps: {
      advertiserId: args.advertiserId,
      campaignName: args.campaignName,
      objectiveType: 'LEAD_GENERATION',
      budgetMode: 'BUDGET_MODE_DAY',
      budget: String(daily),
      operationStatus: TIKTOK_PAUSED_STATUS,
    },
  };
}
