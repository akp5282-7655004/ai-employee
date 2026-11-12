/**
 * Enable is real only when Google reports ENABLED on the campaign, every ad
 * group, and every ad. A write that returned no error is not that report.
 */

export type AdsStatus = 'ENABLED' | 'PAUSED' | 'UNKNOWN';

export interface EnableReadback {
  campaign: AdsStatus;
  adGroups: AdsStatus[];
  ads: AdsStatus[];
  note: string;
}

export function judgeEnableReadback(read: EnableReadback): { enabled: boolean; reason: string } {
  if (read.campaign === 'UNKNOWN') {
    return { enabled: false, reason: `Miles could not read the campaign status from Google. It was not marked enabled. ${read.note}`.trim() };
  }
  if (read.campaign !== 'ENABLED') {
    return { enabled: false, reason: `Google reports the campaign as ${read.campaign}. It was not marked enabled. ${read.note}`.trim() };
  }
  if (!read.adGroups.length || read.adGroups.some((status) => status !== 'ENABLED')) {
    const unread = !read.adGroups.length || read.adGroups.some((status) => status === 'UNKNOWN');
    const why = unread
      ? 'Miles could not read every ad group as enabled.'
      : 'Google does not report every ad group as enabled.';
    return { enabled: false, reason: `${why} It was not marked enabled. ${read.note}`.trim() };
  }
  if (!read.ads.length || read.ads.some((status) => status !== 'ENABLED')) {
    const unread = !read.ads.length || read.ads.some((status) => status === 'UNKNOWN');
    const why = unread
      ? 'Miles could not read every ad as enabled.'
      : 'Google does not report every ad as enabled.';
    return { enabled: false, reason: `${why} It was not marked enabled. ${read.note}`.trim() };
  }
  return { enabled: true, reason: 'Google reports the campaign, its ad groups, and its ads as enabled.' };
}

/** True when the campaign, every ad group, and every ad already show the wanted status. */
export function readbackReady(read: EnableReadback, want: AdsStatus): boolean {
  if (read.campaign !== want) return false;
  if (!read.adGroups.length || read.adGroups.some((status) => status !== want)) return false;
  if (!read.ads.length || read.ads.some((status) => status !== want)) return false;
  return true;
}

/**
 * Read again while Google is still catching up. Stops as soon as the wanted
 * status is on the campaign, every ad group, and every ad, or when the tries run out.
 */
export async function retryReadback(
  read: () => Promise<EnableReadback>,
  want: AdsStatus,
  opts?: { tries?: number; waitMs?: number; sleep?: (ms: number) => Promise<void> },
): Promise<EnableReadback> {
  const tries = Math.max(1, opts?.tries ?? 3);
  const waitMs = opts?.waitMs ?? 300;
  const sleep = opts?.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  let last = await read();
  for (let attempt = 1; attempt < tries && !readbackReady(last, want); attempt++) {
    await sleep(waitMs * attempt);
    last = await read();
  }
  return last;
}

/** Google mutate 400 when the campaign id on file is gone. */
export function googleResourceMissing(text: string | undefined): boolean {
  return /RESOURCE_NOT_FOUND/i.test(text || '');
}

function asStatus(value: unknown): AdsStatus {
  const text = String(value ?? '').toUpperCase();
  if (text === 'ENABLED' || text === '2') return 'ENABLED';
  if (text === 'PAUSED' || text === 'REMOVED' || text === '3' || text === '4') return 'PAUSED';
  return 'UNKNOWN';
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function remember(found: Map<string, AdsStatus>, id: string, status: AdsStatus) {
  const bare = String(id || '').split('/').pop() || '';
  if (!bare || status === 'UNKNOWN' || found.has(bare)) return;
  found.set(bare, status);
  const adId = bare.includes('~') ? bare.split('~').pop() || '' : '';
  if (adId && !found.has(adId)) found.set(adId, status);
}

/**
 * Status belongs to the entity that owns the field. A campaign list does not
 * contain ad groups; their status is read from adGroup.status / ad_group.status,
 * and an ad's status is adGroupAd.status, not the campaign next to it.
 */
function walkStatuses(node: unknown, found: Map<string, AdsStatus>, groups: Set<string>, ads: Set<string>) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((item) => walkStatuses(item, found, groups, ads));
    return;
  }
  const row = node as Record<string, unknown>;
  const campaign = asRecord(row.campaign);
  const adGroup = asRecord(row.adGroup) ?? asRecord(row.ad_group);
  const adGroupAd = asRecord(row.adGroupAd) ?? asRecord(row.ad_group_ad);
  if (campaign) remember(found, String(campaign.id ?? campaign.resourceName ?? ''), asStatus(campaign.status));
  if (adGroup) {
    const id = String(adGroup.id ?? adGroup.resourceName ?? '');
    remember(found, id, asStatus(adGroup.status));
    const bare = id.split('/').pop() || '';
    if (bare) groups.add(bare);
  }
  if (adGroupAd) {
    const status = asStatus(adGroupAd.status);
    const resource = String(adGroupAd.resourceName ?? adGroupAd.id ?? '');
    remember(found, resource, status);
    const inner = asRecord(adGroupAd.ad);
    if (inner) remember(found, String(inner.id ?? inner.resourceName ?? ''), status);
    const bare = resource.split('/').pop() || '';
    if (bare) ads.add(bare.includes('~') ? (bare.split('~').pop() || bare) : bare);
  }
  const self = String(row.resourceName ?? '');
  if (/\/campaigns\/\d+$/.test(self)) remember(found, self, asStatus(row.status));
  else if (/\/adGroups\/\d+$/.test(self)) {
    remember(found, self, asStatus(row.status));
    const bare = self.split('/').pop() || '';
    if (bare) groups.add(bare);
  } else if (/\/adGroupAds\//.test(self)) {
    remember(found, self, asStatus(row.status));
    const bare = self.split('/').pop() || '';
    if (bare) ads.add(bare.includes('~') ? (bare.split('~').pop() || bare) : bare);
  } else if (row.id != null && row.status != null && !campaign && !adGroup && !adGroupAd) {
    remember(found, String(row.id), asStatus(row.status));
  }
  for (const value of Object.values(row)) walkStatuses(value, found, groups, ads);
}

/** Ad group and ad ids present in a status payload. Used when Miles did not store them. */
export function collectReadIds(payload: unknown): { adGroupIds: string[]; adIds: string[] } {
  const groups = new Set<string>();
  const ads = new Set<string>();
  walkStatuses(payload, new Map(), groups, ads);
  return { adGroupIds: [...groups], adIds: [...ads] };
}

/** Pull status fields out of a Google Ads payload. Missing rows stay UNKNOWN. */
export function parseGoogleStatuses(payload: unknown, ids: { campaignId?: string; adGroupIds: string[]; adIds: string[] }): EnableReadback {
  const found = new Map<string, AdsStatus>();
  walkStatuses(payload, found, new Set(), new Set());
  const campaign = ids.campaignId ? (found.get(ids.campaignId) ?? 'UNKNOWN') : 'UNKNOWN';
  return {
    campaign,
    adGroups: ids.adGroupIds.map((id) => found.get(id.split('/').pop() || id) ?? 'UNKNOWN'),
    ads: ids.adIds.map((id) => found.get(id.split('/').pop() || id) ?? 'UNKNOWN'),
    note: found.size ? 'Read from the account list.' : 'The account list did not include a status.',
  };
}

export interface ListedCampaign {
  id: string;
  name?: string;
  status: AdsStatus;
}

/** Result of a read-only Google campaign list. `sample` is never a live account. */
export interface GoogleCampaignRead {
  live: boolean;
  called: boolean;
  sample: boolean;
  note: string;
  readback?: EnableReadback;
  campaigns: ListedCampaign[];
}

/** Campaign rows from a google_ads-list-campaigns payload. Ad groups are skipped. */
export function listCampaignRows(payload: unknown): ListedCampaign[] {
  const found = new Map<string, ListedCampaign>();
  const walk = (node: unknown, keyHint?: string) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((item) => walk(item, keyHint));
      return;
    }
    const row = node as Record<string, unknown>;
    const campaign = row.campaign && typeof row.campaign === 'object' ? row.campaign as Record<string, unknown> : undefined;
    const rawId = String(row.resourceName ?? row.id ?? campaign?.resourceName ?? campaign?.id ?? '');
    const bare = rawId.split('/').pop() || '';
    const rawStatus = String(row.status ?? campaign?.status ?? '');
    const removed = /^removed$/i.test(rawStatus) || rawStatus === '4';
    const status = asStatus(rawStatus);
    const nameRaw = row.name ?? campaign?.name;
    const name = typeof nameRaw === 'string' && nameRaw.trim() ? nameRaw.trim() : undefined;
    const underCampaigns = keyHint === 'campaigns' || keyHint === 'results' || keyHint === 'ret';
    const nestedCampaign = !!campaign && !!bare && status !== 'UNKNOWN';
    const looksLikeCampaign = /campaigns\/\d+$/.test(rawId) || nestedCampaign || (underCampaigns && !!bare && (status !== 'UNKNOWN' || !!name));
    if (!removed && looksLikeCampaign && bare && !found.has(bare) && !row.adGroup && !row.ad_group && !row.adGroupAd && !row.ad_group_ad) {
      found.set(bare, { id: bare, name, status });
    }
    for (const [key, value] of Object.entries(row)) walk(value, key);
  };
  walk(payload);
  return [...found.values()].slice(0, 200);
}
