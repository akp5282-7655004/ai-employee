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
  if (read.campaign !== 'ENABLED') {
    return { enabled: false, reason: `Google reports the campaign as ${read.campaign}. It was not marked enabled. ${read.note}`.trim() };
  }
  if (!read.adGroups.length || read.adGroups.some((status) => status !== 'ENABLED')) {
    return { enabled: false, reason: `Google does not report every ad group as enabled. It was not marked enabled. ${read.note}`.trim() };
  }
  if (!read.ads.length || read.ads.some((status) => status !== 'ENABLED')) {
    return { enabled: false, reason: `Google does not report every ad as enabled. It was not marked enabled. ${read.note}`.trim() };
  }
  return { enabled: true, reason: 'Google reports the campaign, its ad groups, and its ads as enabled.' };
}

function asStatus(value: unknown): AdsStatus {
  const text = String(value || '').toUpperCase();
  if (text === 'ENABLED') return 'ENABLED';
  if (text === 'PAUSED' || text === 'REMOVED') return 'PAUSED';
  return 'UNKNOWN';
}

/** Pull status fields out of a list-campaigns payload. Missing rows stay UNKNOWN. */
export function parseGoogleStatuses(payload: unknown, ids: { campaignId?: string; adGroupIds: string[]; adIds: string[] }): EnableReadback {
  const found = new Map<string, AdsStatus>();
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    const row = node as Record<string, unknown>;
    const id = String(row.id ?? row.resourceName ?? '');
    const bare = id.split('/').pop() || '';
    const status = asStatus(row.status ?? (row.campaign as { status?: string } | undefined)?.status ?? (row.adGroup as { status?: string } | undefined)?.status ?? (row.ad as { status?: string } | undefined)?.status);
    if (bare && status !== 'UNKNOWN') found.set(bare, status);
    Object.values(row).forEach(walk);
  };
  walk(payload);
  const campaign = ids.campaignId ? (found.get(ids.campaignId) ?? 'UNKNOWN') : 'UNKNOWN';
  return {
    campaign,
    adGroups: ids.adGroupIds.map((id) => found.get(id) ?? 'UNKNOWN'),
    ads: ids.adIds.map((id) => found.get(id) ?? 'UNKNOWN'),
    note: found.size ? 'Read from the account list.' : 'The account list did not include a status.',
  };
}
