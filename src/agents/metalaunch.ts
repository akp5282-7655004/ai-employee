/**
 * Paused Facebook and Instagram campaign create.
 *
 * Pipedream has no Meta campaign action. Miles calls the Marketing API through
 * Pipedream Connect's proxy, which attaches the owner's connected Facebook
 * token. A shared META_ADS_ACCESS_TOKEN is never used. Every object is created
 * PAUSED. Tests pass a fake graph and never touch the network.
 */
import type { MetaCampaignSpec } from './metacampaign.js';
import { includedAds, type MetaPlan, type PaidAdSet } from './paidstructure.js';

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
  adSetIds?: string[];
  creativeId?: string;
  adId?: string;
  adIds?: string[];
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

function actId(id: string): string {
  return id.startsWith('act_') ? id : `act_${id}`;
}

async function cityKeyFor(graph: MetaGraph, city: string): Promise<string | null> {
  return cityKey(graph, city);
}

/**
 * Create the reviewed Meta structure: one lead form, one paused campaign,
 * the included ad sets, and the included ads. Status is forced to PAUSED.
 */
export async function launchMetaStructure(graph: MetaGraph, plan: MetaPlan): Promise<MetaLaunchResult> {
  const steps: MetaLaunchStep[] = [];
  const fail = (note: string, live = false): MetaLaunchResult => ({ ok: false, live, status: 'PAUSED', note: plain(note), steps });
  if (plan.objective !== 'OUTCOME_LEADS') return fail('Miles only creates a Leads campaign. Nothing was created.');
  if (plan.specialAdCategories.length) return fail('This plan declared a special ad category Miles did not intend. Nothing was created.');
  if (!(plan.dailyBudget > 0)) return fail('Set a daily budget above $0. Nothing was created.');
  const sets = plan.adSets.filter((set) => set.included);
  const pairs = includedAds(sets);
  if (!sets.length || !pairs.length) return fail('The plan has no ad set to create. Nothing was created.');
  if (plan.destination === 'instant_form' && !plan.form.privacyUrl) return fail('The lead form needs the website as its privacy policy. Nothing was created.');
  if (plan.destination === 'website' && !plan.pixelId) return fail('A website campaign needs a pixel id. Nothing was created.');
  if (pairs.some(({ ad }) => !publicImage(ad.imageUrl))) return fail(META_NO_IMAGE);

  const found = await discoverMetaAccount(graph);
  if (!found.account) return fail(found.error || META_NOT_CONNECTED);
  const account = found.account;
  steps.push({ step: 'Facebook ad account and Page', ok: true, resource: `${account.adAccountId} / ${account.pageId}` });

  const cityNeeded = sets.some((set) => !set.zips.length && !!set.city);
  const cityId = cityNeeded ? await cityKeyFor(graph, sets.find((set) => set.city)?.city || '') : null;
  if (cityNeeded && !cityId) return fail(`Meta did not match ${sets.find((set) => set.city)?.city || 'that city'} to a location. Nothing else was created.`);

  let formId = '';
  if (plan.destination === 'instant_form') {
    const formBody = {
      name: plan.form.name,
      privacy_policy: { url: plan.form.privacyUrl },
      follow_up_action_url: plan.form.followUpUrl || plan.form.privacyUrl,
      question_page_custom_headline: plan.form.intro,
      is_optimized_for_quality: true,
      questions: [
        { type: 'FULL_NAME' },
        { type: 'EMAIL' },
        { type: 'PHONE' },
        { type: 'ZIP' },
        ...plan.form.questions.map((question, index) => ({
          type: 'CUSTOM',
          key: `q${index + 1}`,
          label: question.label,
          options: question.options.map((option, optionIndex) => ({ value: option, key: `o${optionIndex + 1}` })),
        })),
      ],
    };
    const form = await graph.post(`${account.pageId}/leadgen_forms`, formBody);
    const formErr = graphError(form);
    formId = idOf(form) || '';
    steps.push({ step: 'Create higher-intent lead form', ok: !!formId && !formErr, resource: formId, error: formErr || undefined });
    if (!formId || formErr) return fail(formErr || 'Meta did not create the lead form. Nothing else was created.');
  }

  const act = actId(account.adAccountId);
  const campaignBody: Record<string, unknown> = {
    name: plan.name,
    objective: 'OUTCOME_LEADS',
    status: 'PAUSED',
    special_ad_categories: [] as string[],
    buying_type: 'AUCTION',
  };
  if (plan.budgetMode === 'cbo') {
    campaignBody.daily_budget = String(Math.round(plan.dailyBudget * 100));
    campaignBody.bid_strategy = 'LOWEST_COST_WITHOUT_CAP';
  }
  assertPaused(campaignBody);
  const campaign = await graph.post(`${act}/campaigns`, campaignBody);
  const campaignErr = graphError(campaign);
  const campaignId = idOf(campaign) || '';
  steps.push({ step: 'Create paused campaign', ok: !!campaignId && !campaignErr, resource: campaignId, error: campaignErr || undefined });
  if (!campaignId || campaignErr) return fail(campaignErr || 'Meta did not return a campaign id. Nothing else was created.');

  const adSetIds: string[] = [];
  const adIds: string[] = [];
  for (const set of sets) {
    const adSetBody = adSetPayload(plan, set, campaignId, account.pageId, cityId, formId);
    assertPaused(adSetBody);
    const adSet = await graph.post(`${act}/adsets`, adSetBody);
    const adSetErr = graphError(adSet);
    const adSetId = idOf(adSet) || '';
    steps.push({ step: `Create paused ad set "${set.name}"`, ok: !!adSetId && !adSetErr, resource: adSetId, error: adSetErr || undefined });
    if (!adSetId || adSetErr) return fail(adSetErr || `Meta did not create ad set "${set.name}". The campaign stays paused.`, true);
    adSetIds.push(adSetId);
    for (const ad of set.ads.filter((row) => row.included)) {
      const creativeBody = {
        name: `${ad.name} creative`.slice(0, 100),
        object_story_spec: {
          page_id: account.pageId,
          link_data: {
            message: ad.primaryText,
            link: plan.form.privacyUrl,
            name: ad.headline,
            description: ad.description,
            image_url: publicImage(ad.imageUrl),
            call_to_action: plan.destination === 'instant_form'
              ? { type: ad.cta || 'GET_QUOTE', value: { lead_gen_form_id: formId, link: plan.form.privacyUrl } }
              : { type: ad.cta || 'GET_QUOTE', value: { link: plan.form.privacyUrl } },
          },
        },
      };
      const creative = await graph.post(`${act}/adcreatives`, creativeBody);
      const creativeErr = graphError(creative);
      const creativeId = idOf(creative) || '';
      steps.push({ step: `Create ad creative "${ad.name}"`, ok: !!creativeId && !creativeErr, resource: creativeId, error: creativeErr || undefined });
      if (!creativeId || creativeErr) return fail(creativeErr || `Meta did not accept "${ad.name}". The campaign stays paused.`, true);
      const adBody = { name: ad.name, adset_id: adSetId, creative: { creative_id: creativeId }, status: 'PAUSED' };
      assertPaused(adBody);
      const created = await graph.post(`${act}/ads`, adBody);
      const adErr = graphError(created);
      const adId = idOf(created) || '';
      steps.push({ step: `Create paused ad "${ad.name}"`, ok: !!adId && !adErr, resource: adId, error: adErr || undefined });
      if (!adId || adErr) return fail(adErr || `Meta did not create "${ad.name}". The campaign stays paused.`, true);
      adIds.push(adId);
    }
  }

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
    ? `Created paused in ${where}. ${sets.length} ad set${sets.length === 1 ? '' : 's'}, ${adIds.length} ad${adIds.length === 1 ? '' : 's'}. Nothing is spending. Turning it on is a separate approval.`
    : `Meta did not confirm the campaign is paused${reported ? `. It reported ${reported}` : ''}. Check Ads Manager before anything runs.`;
  return {
    ok: confirmed,
    live: true,
    status: 'PAUSED',
    note: plain(note),
    steps,
    campaignId,
    adSetId: adSetIds[0],
    adSetIds,
    adId: adIds[0],
    adIds,
    readback: reported ? { id: campaignId, name: read?.name, status: reported } : undefined,
    link: `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${act.replace(/^act_/, '')}&selected_campaign_ids=${campaignId}`,
  };
}

function adSetPayload(plan: MetaPlan, set: PaidAdSet, campaignId: string, pageId: string, cityId: string | null, _formId: string): Record<string, unknown> {
  const geo: Record<string, unknown> = {};
  if (set.zips.length) geo.zips = set.zips.map((zip) => ({ key: zip.startsWith('US:') ? zip : `US:${zip}` }));
  else if (cityId) geo.cities = [{ key: cityId, radius: set.radiusMiles || META_RADIUS_MILES, distance_unit: 'mile' }];
  const body: Record<string, unknown> = {
    name: set.name,
    campaign_id: campaignId,
    billing_event: 'IMPRESSIONS',
    optimization_goal: plan.destination === 'website' ? 'OFFSITE_CONVERSIONS' : 'LEAD_GENERATION',
    status: 'PAUSED',
    destination_type: plan.destination === 'website' ? 'WEBSITE' : 'ON_AD',
    promoted_object: plan.destination === 'website' && plan.pixelId
      ? { pixel_id: plan.pixelId, custom_event_type: 'LEAD' }
      : { page_id: pageId },
    targeting: {
      age_min: 25,
      geo_locations: geo,
      targeting_automation: { advantage_audience: 1 },
    },
  };
  if (plan.budgetMode === 'abo') {
    body.daily_budget = String(Math.round(set.dailyBudget * 100));
    body.bid_strategy = 'LOWEST_COST_WITHOUT_CAP';
  }
  return body;
}

const META_RADIUS_MILES = 15;

/** Pause or enable the campaign, its ad sets, and its ads. No other status is sent. */
export async function setMetaTreeStatus(graph: MetaGraph, args: {
  campaignId: string;
  adSetIds: string[];
  adIds: string[];
  status: 'PAUSED' | 'ACTIVE';
}): Promise<MetaLaunchResult> {
  const steps: MetaLaunchStep[] = [];
  const fail = (note: string): MetaLaunchResult => ({ ok: false, live: false, status: 'PAUSED', note: plain(note), steps });
  if (args.status !== 'PAUSED' && args.status !== 'ACTIVE') return fail('Miles only sets a Meta campaign to paused or active.');
  if (!/^\d+$/.test(args.campaignId)) return fail('That campaign id is not one Miles saved. Nothing was changed.');
  const ids = [args.campaignId, ...args.adSetIds, ...args.adIds].filter((id) => /^\d+$/.test(id));
  for (const id of ids) {
    const body = { status: args.status };
    const wrote = await graph.post(id, body);
    const err = graphError(wrote);
    steps.push({ step: `${args.status === 'PAUSED' ? 'Pause' : 'Enable'} ${id}`, ok: !err, resource: id, error: err || undefined });
    if (err) return fail(err);
  }
  const read = await readMetaCampaign(graph, args.campaignId);
  const reported = read?.status || '';
  const want = args.status === 'PAUSED' ? pausedStatus(reported) : reported === 'ACTIVE';
  steps.push({ step: 'Read campaign status', ok: want && !read?.error, resource: args.campaignId, error: read?.error || (!want && reported ? `Meta reported ${reported}.` : undefined) });
  const note = want
    ? (args.status === 'PAUSED' ? 'Paused. Nothing is spending.' : 'Meta reports the campaign as active. It can spend.')
    : `Meta did not confirm ${args.status}. Nothing was marked live.`;
  return { ok: want, live: true, status: 'PAUSED', note: plain(note), steps, campaignId: args.campaignId, readback: reported ? { id: args.campaignId, name: read?.name, status: reported } : undefined };
}

/** Change the daily budget in cents. Does not change status. */
export async function setMetaBudget(graph: MetaGraph, args: {
  campaignId: string;
  adSetIds: string[];
  mode: 'cbo' | 'abo';
  daily: number;
  shares?: number[];
}): Promise<MetaLaunchResult> {
  const steps: MetaLaunchStep[] = [];
  const fail = (note: string): MetaLaunchResult => ({ ok: false, live: false, status: 'PAUSED', note: plain(note), steps });
  if (!(args.daily > 0)) return fail('The daily budget has to be above $0. Nothing was changed.');
  if (args.mode === 'cbo') {
    const wrote = await graph.post(args.campaignId, { daily_budget: String(Math.round(args.daily * 100)) });
    const err = graphError(wrote);
    steps.push({ step: 'Update campaign daily budget', ok: !err, resource: args.campaignId, error: err || undefined });
    if (err) return fail(err);
  } else {
    const shares = args.shares && args.shares.length === args.adSetIds.length ? args.shares : args.adSetIds.map(() => args.daily);
    for (let i = 0; i < args.adSetIds.length; i++) {
      const id = args.adSetIds[i]!;
      const wrote = await graph.post(id, { daily_budget: String(Math.round((shares[i] || args.daily) * 100)) });
      const err = graphError(wrote);
      steps.push({ step: `Update ad set budget ${id}`, ok: !err, resource: id, error: err || undefined });
      if (err) return fail(err);
    }
  }
  return { ok: true, live: true, status: 'PAUSED', note: plain(`Daily budget is now $${Math.round(args.daily)}. Status was not changed.`), steps, campaignId: args.campaignId };
}
