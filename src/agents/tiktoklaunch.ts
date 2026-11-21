/**
 * Paused TikTok lead structure. Tests pass a fake runner. No network here.
 * Action keys match Pipedream's TikTok Ads Manager actions, rechecked 21 Nov 2026.
 * Status and budget updates are not prebuilt as separate "set status" tools, so
 * the runner may map those two ids onto the Business API.
 */
import { includedAds, reviewBlocked, reviewTikTokPlan, TIKTOK_CAMPAIGN_MIN, type TikTokPlan } from './paidstructure.js';

export const TIKTOK_CAMPAIGN_ACTION = 'tiktok_ads_manager-create-or-update-campaign';
export const TIKTOK_ADGROUP_ACTION = 'tiktok_ads_manager-create-or-update-ad-group';
export const TIKTOK_AD_ACTION = 'tiktok_ads_manager-create-or-update-ad';
export const TIKTOK_UPLOAD_ACTION = 'tiktok_ads_manager-upload-creative';
export const TIKTOK_STATUS_ACTION = 'tiktok_ads_manager-status-update';
export const TIKTOK_BUDGET_ACTION = 'tiktok_ads_manager-budget-update';

export interface TikTokStep {
  step: string;
  ok: boolean;
  resource?: string;
  error?: string;
}

export interface TikTokLaunchResult {
  ok: boolean;
  live: boolean;
  status: 'DISABLE';
  note: string;
  steps: TikTokStep[];
  advertiserId?: string;
  campaignId?: string;
  adGroupIds?: string[];
  adIds?: string[];
}

export interface TikTokRunner {
  discoverAdvertisers(): Promise<{ id: string; name?: string }[] | { error: string }>;
  lookupLocation(advertiserId: string, city: string): Promise<{ ids: string[]; label?: string } | { error: string }>;
  lookupIdentity(advertiserId: string): Promise<{ id: string; type: string } | { error: string }>;
  run(actionId: string, props: Record<string, unknown>): Promise<{ ok: boolean; output: unknown; note?: string }>;
}

function plain(s: string): string {
  return s.replace(/[ \t]*\u2014[ \t]*/g, ', ').replace(/\u2013/g, '-').replace(/\s{2,}/g, ' ').trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

export function idFrom(output: unknown, keys: string[]): string {
  const walk = (value: unknown, names: string[]): string => {
    const seen = new Set<unknown>();
    const visit = (node: unknown): string => {
      if (!node || seen.has(node)) return '';
      const row = asRecord(node);
      if (!row) return '';
      seen.add(node);
      for (const key of names) {
        const hit = row[key];
        if (typeof hit === 'string' && hit.trim()) return hit.trim();
        if (typeof hit === 'number' && Number.isFinite(hit)) return String(hit);
      }
      for (const nested of Object.values(row)) {
        const found = visit(nested);
        if (found) return found;
      }
      return '';
    };
    return visit(value);
  };
  const specific = keys.filter((key) => key !== 'id');
  return walk(output, specific) || walk(output, ['id']);
}

function stamp(now = new Date()): string {
  const iso = now.toISOString().slice(0, 19);
  return iso.replace('T', ' ');
}

export async function launchTikTokStructure(runner: TikTokRunner, plan: TikTokPlan, now = new Date()): Promise<TikTokLaunchResult> {
  const steps: TikTokStep[] = [];
  const fail = (note: string): TikTokLaunchResult => ({ ok: false, live: false, status: 'DISABLE', note: plain(note), steps });
  const blocked = reviewBlocked(reviewTikTokPlan(plan));
  if (blocked) return fail(blocked);
  if (plan.status !== 'DISABLE') return fail('TikTok creates stay disabled. Nothing was created.');

  const found = await runner.discoverAdvertisers();
  if ('error' in found) return fail(found.error);
  const advertiser = found[0];
  if (!advertiser?.id) return fail('TikTok Ads is connected, but no advertiser came back. Nothing was created.');
  steps.push({ step: 'TikTok advertiser', ok: true, resource: advertiser.id });

  const city = plan.adSets.find((set) => set.included && set.city)?.city || '';
  const located = city ? await runner.lookupLocation(advertiser.id, city) : { ids: [] as string[] };
  if ('error' in located) return fail(located.error);
  if (!located.ids.length) return fail(`TikTok did not match ${city || 'the service area'} to a location. The whole country was not used. Nothing was created.`);
  steps.push({ step: 'Match location', ok: true, resource: located.ids[0] });

  const identity = await runner.lookupIdentity(advertiser.id);
  if ('error' in identity) return fail(identity.error);
  if (!identity.id) return fail('TikTok did not return an ad identity. Create a custom identity in Ads Manager, then approve again. Nothing was created.');
  steps.push({ step: 'Ad identity', ok: true, resource: identity.id });

  const upload = await runner.run(TIKTOK_UPLOAD_ACTION, { advertiserId: advertiser.id, fileUrl: plan.videoUrl });
  const videoId = upload.ok ? idFrom(upload.output, ['video_id', 'videoId', 'id']) : '';
  steps.push({ step: 'Upload video', ok: !!videoId, resource: videoId || undefined, error: videoId ? undefined : (upload.note || 'TikTok did not return a video id.') });
  if (!videoId) return fail(upload.note || 'The video was not uploaded. Nothing else was created.');

  const sets = plan.adSets.filter((set) => set.included);
  const campaignProps = {
    advertiserId: advertiser.id,
    campaignName: plan.name,
    objectiveType: 'LEAD_GENERATION',
    budgetMode: 'BUDGET_MODE_DAY',
    budget: String(plan.dailyBudget),
    operationStatus: 'DISABLE',
  };
  if (campaignProps.operationStatus !== 'DISABLE') return fail('Refusing a TikTok create that is not disabled.');
  const campaign = await runner.run(TIKTOK_CAMPAIGN_ACTION, campaignProps);
  const campaignId = campaign.ok ? idFrom(campaign.output, ['campaign_id', 'campaignId', 'id']) : '';
  steps.push({ step: 'Create disabled campaign', ok: !!campaignId, resource: campaignId || undefined, error: campaignId ? undefined : (campaign.note || 'TikTok did not return a campaign id.') });
  if (!campaignId) return fail(campaign.note || 'TikTok did not create the campaign. Nothing else was created.');

  const adGroupIds: string[] = [];
  const adIds: string[] = [];
  const start = stamp(now);
  for (const set of sets) {
    const groupProps = {
      advertiserId: advertiser.id,
      campaignId,
      adgroupName: set.name,
      placementType: 'PLACEMENT_TYPE_NORMAL',
      placements: ['PLACEMENT_TIKTOK'],
      budgetMode: 'BUDGET_MODE_DAY',
      budget: String(set.dailyBudget),
      scheduleType: 'SCHEDULE_FROM_NOW',
      scheduleStartTime: start,
      optimizationGoal: set.optimization,
      billingEvent: set.optimization === 'CLICK' ? 'CPC' : 'OCPM',
      pacing: 'PACING_MODE_SMOOTH',
      bidType: 'BID_TYPE_NO_BID',
      locationIds: located.ids,
      operationStatus: 'DISABLE',
    };
    const group = await runner.run(TIKTOK_ADGROUP_ACTION, groupProps);
    const adGroupId = group.ok ? idFrom(group.output, ['adgroup_id', 'adgroupId', 'id']) : '';
    steps.push({ step: `Create disabled ad group "${set.name}"`, ok: !!adGroupId, resource: adGroupId || undefined, error: adGroupId ? undefined : (group.note || 'TikTok did not return an ad group id.') });
    if (!adGroupId) return fail(group.note || `TikTok did not create "${set.name}". The campaign stays disabled.`, );
    adGroupIds.push(adGroupId);
    for (const pair of includedAds([set])) {
      const ad = pair.ad;
      const adProps = {
        advertiserId: advertiser.id,
        adgroupId: adGroupId,
        adName: ad.name,
        identityType: identity.type || 'CUSTOMIZED_USER',
        identityId: identity.id,
        adFormat: 'SINGLE_VIDEO',
        videoId,
        adText: ad.primaryText,
        callToAction: 'CONTACT_US',
        landingPageUrl: plan.form.privacyUrl,
        displayName: plan.name.split('|')[0]?.trim().slice(0, 40) || 'Local crew',
        operationStatus: 'DISABLE',
      };
      const created = await runner.run(TIKTOK_AD_ACTION, adProps);
      const adId = created.ok ? idFrom(created.output, ['ad_id', 'adId', 'id']) : '';
      steps.push({ step: `Create disabled ad "${ad.name}"`, ok: !!adId, resource: adId || undefined, error: adId ? undefined : (created.note || 'TikTok did not return an ad id.') });
      if (!adId) return fail(created.note || `TikTok did not create "${ad.name}". The campaign stays disabled.`);
      adIds.push(adId);
    }
  }

  return {
    ok: true,
    live: true,
    status: 'DISABLE',
    note: plain(`Created disabled in ${advertiser.name || 'your TikTok ad account'}. ${adGroupIds.length} ad group${adGroupIds.length === 1 ? '' : 's'}, ${adIds.length} ad${adIds.length === 1 ? '' : 's'}. Nothing is spending. Turning it on is a separate approval.`),
    steps,
    advertiserId: advertiser.id,
    campaignId,
    adGroupIds,
    adIds,
  };
}

export async function setTikTokStatus(runner: TikTokRunner, args: {
  advertiserId: string;
  campaignId: string;
  adGroupIds: string[];
  adIds: string[];
  status: 'DISABLE' | 'ENABLE';
}): Promise<TikTokLaunchResult> {
  const steps: TikTokStep[] = [];
  const fail = (note: string): TikTokLaunchResult => ({ ok: false, live: false, status: 'DISABLE', note: plain(note), steps });
  if (args.status !== 'DISABLE' && args.status !== 'ENABLE') return fail('Miles only disables or enables a TikTok campaign.');
  const ran = await runner.run(TIKTOK_STATUS_ACTION, {
    advertiserId: args.advertiserId,
    campaignIds: [args.campaignId],
    adgroupIds: args.adGroupIds,
    adIds: args.adIds,
    operationStatus: args.status,
  });
  steps.push({ step: args.status === 'DISABLE' ? 'Pause TikTok campaign' : 'Enable TikTok campaign', ok: ran.ok, resource: args.campaignId, error: ran.ok ? undefined : (ran.note || 'TikTok did not confirm the status.') });
  if (!ran.ok) return fail(ran.note || 'TikTok did not change the status. Nothing was marked live.');
  const note = args.status === 'DISABLE' ? 'Paused. Nothing is spending.' : 'TikTok accepted enable. It can spend.';
  return { ok: true, live: true, status: 'DISABLE', note, steps, advertiserId: args.advertiserId, campaignId: args.campaignId, adGroupIds: args.adGroupIds, adIds: args.adIds };
}

export async function setTikTokBudget(runner: TikTokRunner, args: {
  advertiserId: string;
  campaignId: string;
  adGroupIds: string[];
  daily: number;
  shares: number[];
}): Promise<TikTokLaunchResult> {
  const steps: TikTokStep[] = [];
  const fail = (note: string): TikTokLaunchResult => ({ ok: false, live: false, status: 'DISABLE', note: plain(note), steps });
  if (!(args.daily > TIKTOK_CAMPAIGN_MIN)) return fail('That budget does not clear TikTok\'s $50 campaign minimum. Nothing was changed.');
  if (args.shares.some((share) => !(share > 20))) return fail('Each ad group has to stay above $20. Nothing was changed.');
  const ran = await runner.run(TIKTOK_BUDGET_ACTION, {
    advertiserId: args.advertiserId,
    campaignId: args.campaignId,
    campaignBudget: String(args.daily),
    adgroups: args.adGroupIds.map((id, index) => ({ adgroupId: id, budget: String(args.shares[index] || args.daily) })),
  });
  steps.push({ step: 'Update TikTok daily budget', ok: ran.ok, resource: args.campaignId, error: ran.ok ? undefined : (ran.note || 'TikTok did not update the budget.') });
  if (!ran.ok) return fail(ran.note || 'TikTok did not update the budget. The previous amount still stands.');
  return { ok: true, live: true, status: 'DISABLE', note: plain(`Daily budget is now $${Math.round(args.daily)}. Status was not changed.`), steps, campaignId: args.campaignId };
}
