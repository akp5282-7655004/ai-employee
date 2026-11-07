import { buildCampaignSpec, type CampaignSpec } from './campaign.js';
import { parseIntake } from '../intake.js';
import { planCampaign } from '../plan/planner.js';
import type { Channel } from '../packs/index.js';

/**
 * One contractor loop: research what we can actually see, size a plan inside
 * one daily total, and say which channels Miles can create paused.
 *
 * Google Leads means Local Services Ads. It is not a Google Ads Search
 * campaign and this build does not call an LSA write API.
 */

export const LSA_BLOCKED =
  'Google Leads means Google Local Services Ads: a verified business profile billed per lead, not a Search campaign. Miles cannot create or activate LSA from google_ads-create-or-update-campaign, and it will not relabel a Search campaign as LSA. Google Ads lead-form assets are also not created here.';

export const META_BLOCKED =
  'Facebook and Instagram ads are not created. Pipedream’s public catalog has no Meta Ads campaign action: facebook_graph_api has zero actions, and facebook_pages only creates Page posts. Miles will not call the Graph API itself and will not use META_ADS_ACCESS_TOKEN.';

export const SPEND_UNAVAILABLE =
  'Exact competitor ad spend is not public. Miles will not invent a dollar figure.';

export const BUDGET_CONTROL =
  'The daily amounts below are Miles allocation caps. They are not a promise that Google or Meta will stop at that number once a campaign is enabled in the provider.';

export const GHL_UPSERT_ACTION = 'highlevel_oauth-upsert-contact';

export type LoopChannel = 'google_ads' | 'meta' | 'google_leads';

export interface LoopProfile {
  businessName?: string;
  trade?: string;
  city?: string;
  services?: string;
  website?: string;
  phone?: string;
  logoUrl?: string;
}

export interface ObservedAd {
  id: string;
  page: string;
  body: string;
  /** When the ad was seen or when the source says it started. Required to show it. */
  started: string;
  source: 'meta_ad_library' | 'owner_paste';
}

export interface MarketRead {
  competitorSpend: { available: false; reason: string };
  observedAds: ObservedAd[];
  dropped: number;
  note: string;
}

export interface ChannelDecision {
  channel: LoopChannel;
  label: string;
  recommendedDaily: number;
  executedDaily: number;
  status: 'ready_paused' | 'blocked' | 'not_in_mix';
  executable: boolean;
  reason: string;
}

export interface BrandedAsset {
  ok: boolean;
  businessName?: string;
  logoIncluded: boolean;
  logoUrl?: string;
  image: { status: 'uses_uploaded_logo' | 'blocked'; note: string };
  headlines: string[];
  descriptions: string[];
  primaryText?: string;
  blocked?: string;
}

export interface LoopPlan {
  totalDaily: number;
  executedDaily: number;
  heldDaily: number;
  budgetControl: string;
  feasible: boolean;
  summary: string;
  channels: ChannelDecision[];
  asset: BrandedAsset;
  market: MarketRead;
  /** Search spec Miles would create paused, present only when that channel is executable. */
  searchSpec?: CampaignSpec;
}

export interface ActivationDecision {
  allowed: boolean;
  providerCalled: false;
  reason: string;
}

export type LeadSource = 'google_ads_lead_form' | 'google_lsa_forwarded' | 'meta_lead' | 'webhook';

export interface InboundLead {
  eventId: string;
  source: LeadSource;
  name?: string;
  phone?: string;
  email?: string;
  consent?: boolean;
  optOut?: boolean;
  campaign?: string;
  gclid?: string;
}

export interface LeadDecision {
  valid: boolean;
  duplicate: boolean;
  upsert: boolean;
  followUp: boolean;
  reason: string;
}

const clip = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n).trim());

export function readMarket(observed: ObservedAd[] | undefined): MarketRead {
  const raw = Array.isArray(observed) ? observed : [];
  const kept: ObservedAd[] = [];
  for (const ad of raw) {
    if (!ad || !ad.id || !ad.page || !ad.body || !ad.started) continue;
    if (Number.isNaN(Date.parse(ad.started))) continue;
    if (ad.source !== 'meta_ad_library' && ad.source !== 'owner_paste') continue;
    kept.push({
      id: String(ad.id).slice(0, 80),
      page: String(ad.page).slice(0, 120),
      body: String(ad.body).slice(0, 500),
      started: new Date(ad.started).toISOString(),
      source: ad.source,
    });
  }
  return {
    competitorSpend: { available: false, reason: SPEND_UNAVAILABLE },
    observedAds: kept.slice(0, 20),
    dropped: raw.length - kept.length,
    note: kept.length
      ? 'These are observed ads with a page, text, and a date. Spend is unavailable.'
      : 'No dated competitor ads are on file. Spend is unavailable.',
  };
}

export function brandedAsset(profile: LoopProfile): BrandedAsset {
  const name = (profile.businessName || '').trim();
  if (!name) {
    return {
      ok: false,
      logoIncluded: false,
      image: { status: 'blocked', note: 'No image was generated.' },
      headlines: [],
      descriptions: [],
      blocked: 'Add a business name before Miles writes ads.',
    };
  }
  const city = (profile.city || '').trim();
  const service = (profile.services || 'plumbing').split(',')[0]!.trim();
  const logo = (profile.logoUrl || '').trim();
  const headline = clip(city ? `${name} in ${city}` : name, 30);
  const headlines = [
    headline,
    clip(service ? `${service} help` : 'Local plumber', 30),
    clip(city ? `Serving ${city}` : 'Call today', 30),
  ];
  const descriptions = [
    clip(`${name}${city ? ` in ${city}` : ''} — ${service}. Call for a visit.`, 90),
    clip('Licensed local crew. You approve every campaign before it is created paused.', 90),
  ];
  return {
    ok: true,
    businessName: name,
    logoIncluded: !!logo,
    logoUrl: logo || undefined,
    image: logo
      ? { status: 'uses_uploaded_logo', note: 'The uploaded logo is attached. Miles did not generate a new image.' }
      : { status: 'blocked', note: 'No logo is on the profile. No image was generated.' },
    headlines,
    descriptions,
    primaryText: `${name}${city ? `, ${city}` : ''}. ${service}. ${logo ? 'Logo attached.' : 'No logo on file.'}`,
  };
}

function dailyOf(monthly: number): number {
  return Math.round((monthly / 30) * 100) / 100;
}

export function buildLoopPlan(args: {
  profile: LoopProfile;
  totalDaily: number;
  googleAdsConnected: boolean;
  metaConnected: boolean;
  observedAds?: ObservedAd[];
}): LoopPlan {
  const totalDaily = Math.round(Math.max(0, args.totalDaily) * 100) / 100;
  const asset = brandedAsset(args.profile);
  const market = readMarket(args.observedAds);
  const name = (args.profile.businessName || '').trim();
  const services = (args.profile.services || 'drain cleaning, leak repair')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const city = (args.profile.city || '').trim();

  let searchMonthly = 0;
  let socialMonthly = 0;
  let lsaMonthly = 0;
  let summary = 'Add a business name, a trade, and a city before Miles sizes a plan.';
  if (name && city && services.length && totalDaily > 0) {
    const planned = planCampaign(parseIntake({
      businessName: name,
      vertical: 'home_services',
      category: mapTrade(args.profile.trade),
      services,
      serviceArea: { cities: [city] },
      monthlyBudget: Math.round(totalDaily * 30),
      goal: 'more_calls',
      emergency: /plumb|hvac|electric/i.test(args.profile.trade || 'plumbing'),
    }));
    summary = planned.summary;
    const dollars = (ch: Channel) => planned.allocations.find((a) => a.channel === ch)?.monthlyBudget ?? 0;
    searchMonthly = dollars('search');
    socialMonthly = dollars('social');
    lsaMonthly = dollars('lsa');
  }

  const searchDaily = dailyOf(searchMonthly);
  const socialDaily = dailyOf(socialMonthly);
  const lsaDaily = dailyOf(lsaMonthly);

  const channels: ChannelDecision[] = [
    {
      channel: 'google_ads',
      label: 'Google Ads Search',
      recommendedDaily: searchDaily,
      executedDaily: args.googleAdsConnected && searchDaily > 0 ? searchDaily : 0,
      status: searchDaily <= 0 ? 'not_in_mix' : args.googleAdsConnected ? 'ready_paused' : 'blocked',
      executable: args.googleAdsConnected && searchDaily > 0,
      reason: searchDaily <= 0
        ? 'This budget’s trade mix assigns no Search dollars.'
        : args.googleAdsConnected
          ? 'Miles can create this Search campaign paused. Creating it does not run ads.'
          : 'Google Ads is not connected for this account. Nothing will be created.',
    },
    {
      channel: 'meta',
      label: 'Facebook Ads',
      recommendedDaily: socialDaily,
      executedDaily: 0,
      status: socialDaily <= 0 ? 'not_in_mix' : 'blocked',
      executable: false,
      reason: socialDaily <= 0
        ? `At $${totalDaily}/day the trade mix assigns $0 to Facebook. ${META_BLOCKED}`
        : META_BLOCKED + (args.metaConnected ? ' A Facebook account is connected; the create is still not run.' : ' No per-tenant Facebook ad account is connected.'),
    },
    {
      channel: 'google_leads',
      label: 'Google Leads (Local Services Ads)',
      recommendedDaily: lsaDaily,
      executedDaily: 0,
      status: 'blocked',
      executable: false,
      reason: LSA_BLOCKED,
    },
  ];

  const executedDaily = Math.round(channels.reduce((s, c) => s + c.executedDaily, 0) * 100) / 100;
  const heldDaily = Math.round((totalDaily - executedDaily) * 100) / 100;
  let searchSpec: CampaignSpec | undefined;
  const search = channels.find((c) => c.channel === 'google_ads');
  if (search?.executable && asset.ok) {
    searchSpec = buildCampaignSpec(
      {
        goal: `${name} ${services[0]}`,
        dailyBudget: search.executedDaily,
        finalUrl: args.profile.website || 'https://example.com',
        locations: city ? [city] : undefined,
      },
      { business: name, trade: args.profile.trade || 'plumbing', city, services: services.join(', ') },
    );
    const group = searchSpec.adGroups[0];
    if (group) {
      group.rsa.headlines = asset.headlines;
      group.rsa.descriptions = asset.descriptions;
    }
    searchSpec.status = 'PAUSED';
  }

  return {
    totalDaily,
    executedDaily,
    heldDaily,
    budgetControl: BUDGET_CONTROL,
    feasible: executedDaily > 0 && executedDaily <= totalDaily + 0.001,
    summary,
    channels,
    asset,
    market,
    searchSpec,
  };
}

function mapTrade(trade?: string): string {
  const t = (trade || 'plumbing').toLowerCase();
  if (t.includes('hvac')) return 'hvac';
  if (t.includes('electric')) return 'electrical';
  if (t.includes('roof')) return 'roofing';
  if (t.includes('paint')) return 'painting';
  return 'plumbing';
}

export function judgeActivation(args: {
  confirm: boolean;
  ownerId: string;
  recordOwnerId?: string;
  campaignResource?: string;
  approvedDaily?: number;
  requestedDaily?: number;
}): ActivationDecision {
  if (!args.confirm) return { allowed: false, providerCalled: false, reason: 'Activation needs its own explicit approval. Creating a paused campaign did not approve this.' };
  if (!args.recordOwnerId || args.recordOwnerId !== args.ownerId) return { allowed: false, providerCalled: false, reason: 'That campaign is not on this account.' };
  if (!args.campaignResource) return { allowed: false, providerCalled: false, reason: 'There is no paused campaign to activate.' };
  if (typeof args.approvedDaily !== 'number' || typeof args.requestedDaily !== 'number' || args.requestedDaily > args.approvedDaily + 0.001) {
    return { allowed: false, providerCalled: false, reason: 'The requested daily budget is above the approved cap.' };
  }
  return {
    allowed: true,
    providerCalled: false,
    reason: 'Approval is recorded. Miles will not send ENABLED to Google. Turn the paused campaign on in Google Ads if you want it to spend.',
  };
}

export function normalizeLead(body: Record<string, unknown>): { lead?: InboundLead; error?: string } {
  const explicit = typeof body.eventId === 'string' ? body.eventId.trim() : '';
  const leadId = typeof body.lead_id === 'string' ? body.lead_id.trim() : '';
  const eventId = (explicit || leadId).slice(0, 120);
  if (!eventId) return { error: 'eventId or lead_id is required.' };
  let source: LeadSource = 'webhook';
  const rawSource = String(body.source || body.form_id && 'google_ads_lead_form' || '').toLowerCase();
  if (body.is_lsa === true || rawSource.includes('lsa') || rawSource === 'google_lsa') source = 'google_lsa_forwarded';
  else if (rawSource.includes('meta') || rawSource.includes('facebook')) source = 'meta_lead';
  else if (leadId || rawSource.includes('google')) source = 'google_ads_lead_form';
  const columns = Array.isArray(body.user_column_data) ? body.user_column_data as Array<{ column_id?: string; string_value?: string }> : [];
  const fromCol = (id: string) => columns.find((c) => String(c.column_id || '').toUpperCase() === id)?.string_value;
  const name = String(body.name || fromCol('FULL_NAME') || '').trim().slice(0, 120) || undefined;
  const phone = String(body.phone || fromCol('PHONE_NUMBER') || '').trim().slice(0, 40) || undefined;
  const email = String(body.email || fromCol('EMAIL') || '').trim().slice(0, 120) || undefined;
  if (!name && !phone && !email) return { error: 'A name, phone, or email is required.' };
  const consent = typeof body.consent === 'boolean' ? body.consent : undefined;
  return {
    lead: {
      eventId,
      source,
      name,
      phone,
      email,
      consent,
      optOut: body.optOut === true || body.opt_out === true,
      campaign: typeof body.campaign === 'string' ? body.campaign.slice(0, 120) : (typeof body.campaign_id === 'string' ? body.campaign_id.slice(0, 120) : undefined),
      gclid: typeof body.gclid === 'string' ? body.gclid.slice(0, 200) : (typeof body.gcl_id === 'string' ? body.gcl_id.slice(0, 200) : undefined),
    },
  };
}

export function decideLead(lead: InboundLead, seen: string[], automationEnabled: boolean): LeadDecision {
  if (seen.includes(lead.eventId)) {
    return { valid: true, duplicate: true, upsert: false, followUp: false, reason: 'Duplicate event. No second CRM write and no follow-up.' };
  }
  const consented = lead.consent !== false && !lead.optOut;
  const followUp = automationEnabled && consented && !!lead.phone && lead.source !== 'google_lsa_forwarded';
  let reason = 'Contact can be upserted.';
  if (!automationEnabled) reason = 'Follow-up is off until speed-to-lead is enabled.';
  else if (!consented) reason = 'No follow-up: consent is missing or the person opted out.';
  else if (lead.source === 'google_lsa_forwarded') reason = 'Forwarded LSA notice only. Miles did not pull this from the LSA API and will not text from this event.';
  else if (!lead.phone) reason = 'No phone, so no SMS follow-up.';
  return { valid: true, duplicate: false, upsert: true, followUp, reason };
}

/** Props for the documented highlevel_oauth-upsert-contact action. Tags are omitted because an upsert overwrites them. */
export function ghlUpsertProps(lead: InboundLead): { name?: string; email?: string; phone?: string; additionalOptions: { source: string } } {
  const source = lead.source === 'google_lsa_forwarded'
    ? 'miles:lsa-forwarded-not-api'
    : `miles:${lead.source}${lead.campaign ? ':' + lead.campaign : ''}`;
  return {
    name: lead.name,
    email: lead.email,
    phone: lead.phone,
    additionalOptions: { source: source.slice(0, 180) },
  };
}
