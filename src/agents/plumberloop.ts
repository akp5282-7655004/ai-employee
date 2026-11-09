import type { CampaignSpec } from './campaign.js';
import { assessProfile, buildSearchCampaigns, seasonFocus, type PlannedSearch, type ProfileGap } from './contractorloop.js';

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
  serviceAreas?: string;
  services?: string;
  website?: string;
  phone?: string;
  logoUrl?: string;
  dailyBudget?: number;
  monthlyBudget?: number;
  targetCpl?: number;
  averageJobValue?: number;
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
  searchCampaigns: PlannedSearch[];
  complete: boolean;
  missing: ProfileGap[];
  geo: string[];
  seasonNote: string;
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
  const service = (profile.services || profile.trade || 'local service').split(',')[0]!.trim();
  const logo = (profile.logoUrl || '').trim();
  const headline = clip(city ? `${name} in ${city}` : name, 30);
  const headlines = [
    headline,
    clip(service ? `${service} help` : 'Local service', 30),
    clip(city ? `Serving ${city}` : 'Call today', 30),
  ];
  const descriptions = [
    clip(`${name}${city ? ` in ${city}` : ''}. ${service}. Call for a visit.`, 90),
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

export function buildLoopPlan(args: {
  profile: LoopProfile;
  totalDaily?: number;
  googleAdsConnected: boolean;
  metaConnected: boolean;
  googleBlocked?: boolean;
  observedAds?: ObservedAd[];
  now?: Date;
}): LoopPlan {
  const explicit = typeof args.totalDaily === 'number' && args.totalDaily > 0 ? args.totalDaily : undefined;
  const assessed = assessProfile({
    businessName: args.profile.businessName,
    trade: args.profile.trade,
    serviceArea: [args.profile.serviceAreas, args.profile.city].filter(Boolean).join(', '),
    services: args.profile.services,
    dailyBudget: args.profile.dailyBudget,
    monthlyBudget: args.profile.monthlyBudget,
    targetCpl: args.profile.targetCpl,
    averageJobValue: args.profile.averageJobValue,
    landingPage: args.profile.website,
    logoUrl: args.profile.logoUrl,
  }, explicit);
  const now = args.now ?? new Date();
  const season = seasonFocus(assessed.trade, now.getMonth());
  const asset = brandedAsset({ ...args.profile, services: assessed.services.join(', ') || args.profile.services, city: assessed.locations.find((loc) => !/^\d{5}$/.test(loc)) || args.profile.city });
  const market = readMarket(args.observedAds);
  const totalDaily = assessed.dailyBudget ?? 0;
  const searches = assessed.complete ? buildSearchCampaigns(assessed, now) : [];
  const searchDaily = moneySum(searches.map((s) => s.spec.dailyBudget));
  const otherDaily = totalDaily >= 50 ? 0 : 0;
  const channels: ChannelDecision[] = [
    {
      channel: 'google_ads',
      label: 'Google Ads Search',
      recommendedDaily: assessed.complete ? searchDaily : 0,
      executedDaily: assessed.complete && args.googleAdsConnected && !args.googleBlocked ? searchDaily : 0,
      status: !assessed.complete ? 'blocked' : args.googleBlocked ? 'blocked' : args.googleAdsConnected ? 'ready_paused' : 'blocked',
      executable: assessed.complete && args.googleAdsConnected && !args.googleBlocked && searchDaily > 0,
      reason: !assessed.complete
        ? `Profile is incomplete: ${assessed.missing.map((m) => m.label).join(', ')}. Nothing will be created.`
        : args.googleBlocked
          ? 'Google sign-in is healthy, but Pipedream is blocking production tool calls. Nothing will be created.'
          : args.googleAdsConnected
            ? (assessed.emergency && searches.length > 1
              ? 'Miles can create separate paused emergency and planned Search campaigns inside the approved total.'
              : 'Miles can create this Search campaign paused. Creating it does not run ads.')
            : 'Google Ads is not connected for this account. Nothing will be created.',
    },
    {
      channel: 'meta',
      label: 'Facebook Ads',
      recommendedDaily: 0,
      executedDaily: 0,
      status: totalDaily >= 50 ? 'blocked' : 'not_in_mix',
      executable: false,
      reason: totalDaily >= 50
        ? META_BLOCKED
        : `At $${totalDaily}/day Meta is not added. ${META_BLOCKED}`,
    },
    {
      channel: 'google_leads',
      label: 'Google Leads (Local Services Ads)',
      recommendedDaily: 0,
      executedDaily: 0,
      status: 'blocked',
      executable: false,
      reason: totalDaily >= 50 ? LSA_BLOCKED : `At $${totalDaily}/day Local Services Ads are not added. ${LSA_BLOCKED}`,
    },
  ];
  const executedDaily = channels.find((c) => c.channel === 'google_ads')?.executedDaily ?? 0;
  const heldDaily = moneySum([totalDaily - executedDaily, otherDaily]);
  const summary = !assessed.complete
    ? `Still needed: ${assessed.missing.map((m) => m.label).join(', ')}.`
    : `${assessed.businessName} ${assessed.tradeLabel || assessed.trade}: $${totalDaily}/day on Google Search inside ${assessed.locations.join(', ')}. ${season.note} ${asset.image.note}`;
  return {
    totalDaily,
    executedDaily,
    heldDaily: Math.max(0, Math.round(heldDaily * 100) / 100),
    budgetControl: BUDGET_CONTROL,
    feasible: assessed.complete && executedDaily > 0 && executedDaily <= totalDaily + 0.001,
    summary,
    channels,
    asset,
    market,
    searchSpec: channels.find((c) => c.channel === 'google_ads')?.executable ? searches[0]?.spec : undefined,
    searchCampaigns: channels.find((c) => c.channel === 'google_ads')?.executable ? searches : [],
    complete: assessed.complete,
    missing: assessed.missing,
    geo: assessed.locations,
    seasonNote: season.note,
  };
}

function moneySum(values: number[]): number {
  return Math.round(values.reduce((sum, n) => sum + n, 0) * 100) / 100;
}

export function judgeActivation(args: {
  confirm: boolean;
  ownerId: string;
  recordOwnerId?: string;
  campaignResource?: string;
  approvedDaily?: number;
  requestedDaily?: number;
  productionBlocked?: boolean;
}): ActivationDecision {
  if (!args.confirm) return { allowed: false, providerCalled: false, reason: 'Activation needs its own explicit approval. Creating a paused campaign did not approve this.' };
  if (args.productionBlocked) return { allowed: false, providerCalled: false, reason: 'Pipedream is blocking production tool calls for this account. Nothing was enabled.' };
  if (!args.recordOwnerId || args.recordOwnerId !== args.ownerId) return { allowed: false, providerCalled: false, reason: 'That campaign is not on this account.' };
  if (!args.campaignResource) return { allowed: false, providerCalled: false, reason: 'There is no paused campaign to activate.' };
  if (typeof args.approvedDaily !== 'number' || typeof args.requestedDaily !== 'number' || args.requestedDaily > args.approvedDaily + 0.001) {
    return { allowed: false, providerCalled: false, reason: 'The requested daily budget is above the approved cap.' };
  }
  return {
    allowed: true,
    providerCalled: false,
    reason: 'Approval is recorded. Miles will set this campaign to ENABLED.',
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
