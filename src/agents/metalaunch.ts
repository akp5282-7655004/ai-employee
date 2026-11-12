/**
 * Paused Facebook and Instagram campaign create.
 *
 * Pipedream has no Meta campaign action. Miles calls the Marketing API through
 * Pipedream Connect's proxy, which attaches the owner's connected Facebook
 * token. A shared META_ADS_ACCESS_TOKEN is never used. Every object is created
 * PAUSED. Tests pass a fake graph and never touch the network.
 */
import type { MetaCampaignSpec } from './metacampaign.js';

export const META_GRAPH_BASE = 'https://graph.facebook.com/v21.0';

export const META_NOT_CONNECTED =
  'No Facebook ad account is connected for this business. Connect Facebook under Integrations, including an ad account and a Page. Nothing was created.';

export const META_NO_PAGE =
  'Facebook is connected, but no Page came back. Miles needs a Page to run the ad. Nothing else was created.';

export const META_NO_IMAGE =
  'This ad has no public image link. Add one in Creative Studio, then approve the paused campaign again. Nothing was created.';

export const META_PAGE_ONLY =
  'A Facebook Page is connected, but this connection cannot see an ad account. Creating a campaign needs ads permission on the Facebook app, plus an ad account and a Page. Nothing was created.';

export interface MetaGraph {
  get(path: string, query?: Record<string, string>): Promise<unknown>;
  post(path: string, body: Record<string, unknown>): Promise<unknown>;
}

export interface MetaAccount {
  adAccountId: string;
  adAccountName?: string;
  pageId: string;
  pageName?: string;
}

export interface MetaLaunchStep {
  step: string;
  ok: boolean;
  resource?: string;
  error?: string;
}

export interface MetaLaunchResult {
  ok: boolean;
  /** True only when Meta accepted a paused campaign. It does not mean money is spending. */
  live: boolean;
  status: 'PAUSED';
  note: string;
  steps: MetaLaunchStep[];
  campaignId?: string;
  adSetId?: string;
  creativeId?: string;
  adId?: string;
  readback?: { id: string; name?: string; status: string };
  link?: string;
}

export interface MetaStatus {
  ready: boolean;
  account?: string;
  page?: string;
  note: string;
  readback?: { id: string; name?: string; status: string };
}

function plain(s: string): string {
  return s.replace(/[ \t]*\u2014[ \t]*/g, ', ').replace(/\u2013/g, '-').replace(/\s{2,}/g, ' ').trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function graphError(value: unknown): string | null {
  const row = asRecord(value);
  const err = asRecord(row?.error);
  if (!err) return null;
  const message = err.error_user_msg || err.message;
  return typeof message === 'string' && message.trim() ? plain(message) : 'Meta refused that step.';
}

function idOf(value: unknown): string | undefined {
  const row = asRecord(value);
  return typeof row?.id === 'string' && row.id.trim() ? row.id.trim() : undefined;
}

function listOf(value: unknown): Record<string, unknown>[] {
  const row = asRecord(value);
  const data = row?.data;
  if (!Array.isArray(data)) return [];
  return data.filter((item) => item && typeof item === 'object') as Record<string, unknown>[];
}

function pausedStatus(value: string): boolean {
  return value === 'PAUSED' || value === 'CAMPAIGN_PAUSED';
}

/** Facebook daily dollars from the saved cap and the share left after Google. */
export function facebookDaily(dailyCap: number, googleShare: number, explicit?: number): number {
  if (explicit != null && explicit > 0) return Math.round(explicit);
  const cap = dailyCap > 0 ? dailyCap : 0;
  const share = Math.min(1, Math.max(0, Number.isFinite(googleShare) ? googleShare : 1));
  return Math.max(0, Math.round(cap * (1 - share)));
}

export function publicImage(url?: string): string {
  const value = (url || '').trim();
  return /^https:\/\//i.test(value) ? value : '';
}

export async function discoverMetaAccount(graph: MetaGraph): Promise<{ account?: MetaAccount; error?: string }> {
  let adAccounts: unknown;
  let pages: unknown;
  try {
    adAccounts = await graph.get('me/adaccounts', { fields: 'id,name,account_status' });
    pages = await graph.get('me/accounts', { fields: 'id,name' });
  } catch (err) {
    return { error: plain((err as Error).message || 'Miles could not read Facebook.') };
  }
  const adError = graphError(adAccounts);
  const pageError = graphError(pages);
  if (adError) return { error: adError };
  if (pageError) return { error: pageError };
  const ad = listOf(adAccounts)[0];
  const page = listOf(pages)[0];
  if (!ad?.id) return { error: META_NOT_CONNECTED };
  if (!page?.id) return { error: META_NO_PAGE };
  return {
    account: {
      adAccountId: String(ad.id),
      adAccountName: typeof ad.name === 'string' ? ad.name : undefined,
      pageId: String(page.id),
      pageName: typeof page.name === 'string' ? page.name : undefined,
    },
  };
}

async function cityKey(graph: MetaGraph, city: string): Promise<string | null> {
  const name = city.trim();
  if (!name) return null;
  const found = await graph.get('search', {
    type: 'adgeolocation',
    q: name,
    location_types: '["city"]',
    limit: '1',
  });
  if (graphError(found)) return null;
  const hit = listOf(found)[0];
  return hit && typeof hit.key === 'string' ? hit.key : null;
}

function targeting(spec: MetaCampaignSpec, cityId: string | null): Record<string, unknown> {
  const geo: Record<string, unknown> = {};
  if (spec.geo.zips.length) geo.zips = spec.geo.zips.map((zip) => ({ key: zip.startsWith('US:') ? zip : `US:${zip}` }));
  if (cityId) geo.cities = [{ key: cityId, radius: 15, distance_unit: 'mile' }];
  if (!spec.geo.zips.length && !cityId) geo.countries = spec.geo.countries.length ? spec.geo.countries : ['US'];
  return {
    age_min: spec.ageMin,
    age_max: spec.ageMax,
    geo_locations: geo,
    publisher_platforms: spec.placements?.length ? spec.placements : ['facebook', 'instagram'],
    facebook_positions: ['feed'],
    instagram_positions: ['stream'],
  };
}

function assertPaused(body: Record<string, unknown>): void {
  if (body.status !== 'PAUSED') throw new Error('Miles will only create paused Facebook campaigns.');
}

export async function readMetaCampaign(graph: MetaGraph, campaignId: string): Promise<MetaStatus['readback'] & { error?: string }> {
  const read = await graph.get(campaignId, { fields: 'id,name,status,effective_status' });
  const readErr = graphError(read);
  if (readErr) return { id: campaignId, status: '', error: readErr };
  const row = asRecord(read);
  const status = typeof row?.effective_status === 'string' && row.effective_status
    ? row.effective_status
    : typeof row?.status === 'string' ? row.status : '';
  return {
    id: campaignId,
    name: typeof row?.name === 'string' ? row.name : undefined,
    status,
  };
}

export async function launchPausedMeta(graph: MetaGraph, spec: MetaCampaignSpec): Promise<MetaLaunchResult> {
  const steps: MetaLaunchStep[] = [];
  const fail = (note: string, live = false): MetaLaunchResult => ({ ok: false, live, status: 'PAUSED', note: plain(note), steps });
  if (spec.status !== 'PAUSED') return fail('Miles will only create this campaign paused. Nothing was created.');
  if (!(spec.dailyBudget > 0)) return fail('Set a daily budget above $0. Nothing was created.');
  if (!spec.website) return fail('Add a website. The ad needs a page to open. Nothing was created.');
  const imageUrl = publicImage(spec.imageUrl);
  if (!imageUrl) return fail(META_NO_IMAGE);

  const found = await discoverMetaAccount(graph);
  if (!found.account) return fail(found.error || META_NOT_CONNECTED);
  const account = found.account;
  steps.push({ step: 'Facebook ad account and Page', ok: true, resource: `${account.adAccountId} / ${account.pageId}` });

  const formBody = {
    name: `${spec.name} form`.slice(0, 100),
    privacy_policy: { url: spec.website },
    follow_up_action_url: spec.website,
    questions: [{ type: 'FULL_NAME' }, { type: 'EMAIL' }, { type: 'PHONE' }],
  };
  const form = await graph.post(`${account.pageId}/leadgen_forms`, formBody);
  const formErr = graphError(form);
  const formId = idOf(form);
  steps.push({ step: 'Create lead form', ok: !!formId && !formErr, resource: formId, error: formErr || undefined });
  if (!formId || formErr) return fail(formErr || 'Meta did not create a lead form. A leads campaign needs that form. Nothing else was created.');

  const act = account.adAccountId.startsWith('act_') ? account.adAccountId : `act_${account.adAccountId}`;
  const campaignBody = {
    name: spec.name,
    objective: 'OUTCOME_LEADS',
    status: 'PAUSED',
    special_ad_categories: [] as string[],
    buying_type: 'AUCTION',
  };
  assertPaused(campaignBody);
  const campaign = await graph.post(`${act}/campaigns`, campaignBody);
  const campaignErr = graphError(campaign);
  const campaignId = idOf(campaign);
  steps.push({ step: 'Create paused campaign', ok: !!campaignId && !campaignErr, resource: campaignId, error: campaignErr || undefined });
  if (!campaignId || campaignErr) return fail(campaignErr || 'Meta did not return a campaign id. Nothing else was created.');

  const cityName = spec.geo.cities[0] || '';
  const cityId = cityName ? await cityKey(graph, cityName) : null;
  const adSetBody = {
    name: `${spec.name} audience`,
    campaign_id: campaignId,
    daily_budget: String(Math.round(spec.dailyBudget * 100)),
    billing_event: 'IMPRESSIONS',
    optimization_goal: 'LEAD_GENERATION',
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    status: 'PAUSED',
    destination_type: 'ON_AD',
    promoted_object: { page_id: account.pageId },
    targeting: targeting(spec, cityId),
  };
  assertPaused(adSetBody);
  const adSet = await graph.post(`${act}/adsets`, adSetBody);
  const adSetErr = graphError(adSet);
  const adSetId = idOf(adSet);
  steps.push({ step: 'Create paused ad set', ok: !!adSetId && !adSetErr, resource: adSetId, error: adSetErr || undefined });
  if (!adSetId || adSetErr) return fail(adSetErr || 'Meta did not return an ad set id. The campaign stays paused.', true);

  const creativeBody = {
    name: `${spec.name} creative`,
    object_story_spec: {
      page_id: account.pageId,
      link_data: {
        message: spec.ad.primaryText,
        link: spec.website,
        name: spec.ad.headline,
        description: spec.ad.description,
        image_url: imageUrl,
        call_to_action: { type: spec.ad.cta || 'GET_QUOTE', value: { lead_gen_form_id: formId, link: spec.website } },
      },
    },
  };
  const creative = await graph.post(`${act}/adcreatives`, creativeBody);
  const creativeErr = graphError(creative);
  const creativeId = idOf(creative);
  steps.push({ step: 'Create ad creative', ok: !!creativeId && !creativeErr, resource: creativeId, error: creativeErr || undefined });
  if (!creativeId || creativeErr) return fail(creativeErr || 'Meta did not accept the ad creative. The campaign stays paused.', true);

  const adBody = {
    name: `${spec.name} ad`,
    adset_id: adSetId,
    creative: { creative_id: creativeId },
    status: 'PAUSED',
  };
  assertPaused(adBody);
  const ad = await graph.post(`${act}/ads`, adBody);
  const adErr = graphError(ad);
  const adId = idOf(ad);
  steps.push({ step: 'Create paused ad', ok: !!adId && !adErr, resource: adId, error: adErr || undefined });
  if (!adId || adErr) return fail(adErr || 'Meta did not create the ad. The campaign stays paused.', true);

  const read = await readMetaCampaign(graph, campaignId);
  const reported = read?.status || '';
  const confirmed = pausedStatus(reported);
  steps.push({
    step: 'Read campaign status',
    ok: confirmed && !read?.error,
    resource: campaignId,
    error: read?.error || (reported && !confirmed ? `Meta reported ${reported}.` : undefined),
  });
  const where = account.adAccountName || 'your Facebook ad account';
  const note = confirmed
    ? `Created paused in ${where}. Nothing is spending. Turn it on in Meta Ads Manager when you want it to run.`
    : `Meta did not confirm the campaign is paused${reported ? `. It reported ${reported}` : ''}. Check Ads Manager before anything runs.`;
  return {
    ok: confirmed,
    live: true,
    status: 'PAUSED',
    note: plain(note),
    steps,
    campaignId,
    adSetId,
    creativeId,
    adId,
    readback: reported ? { id: campaignId, name: read?.name, status: reported } : undefined,
    link: `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${act.replace(/^act_/, '')}&selected_campaign_ids=${campaignId}`,
  };
}
