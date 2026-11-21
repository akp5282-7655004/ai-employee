/**
 * Last resort: a number the trade playbook itself states.
 *
 * Nov 15 files: plumbing cost per lead $110 (Search, LSA, and Meta, the
 * channels in that playbook's budget split), roofing allowable cost per
 * booked job $2,000. The older Meta table in src/agents/playbook.ts is a
 * planning range for Meta only. It is not turned into a midpoint, and it is
 * not used for Google Ads.
 */
import { playbookCplBand } from '../agents/playbook.js';
import { tradePlaybook } from '../playbooks/load.js';
import type { Metric, Platform } from './types.js';
import { tradeKey } from './trades.js';

export interface PlaybookEstimate {
  value: number | null;
  low: number | null;
  high: number | null;
  label: 'Playbook estimate';
  note: string;
}

const PLAYBOOK_CHANNELS: Platform[] = ['google_ads', 'google_lsa', 'meta'];

export function playbookEstimate(trade: string, platform: Platform, metric: Metric): PlaybookEstimate | null {
  const key = tradeKey(trade);
  if (!key) return null;
  const book = tradePlaybook(key === 'garage_door' ? '' : key);
  const economics = book.economics;
  if (metric === 'cpl' && economics?.costPerLead && PLAYBOOK_CHANNELS.includes(platform) && key === 'plumbing') {
    return {
      value: economics.costPerLead,
      low: null,
      high: null,
      label: 'Playbook estimate',
      note: economics.source || 'Plumbing playbook cost per lead.',
    };
  }
  if (metric === 'cpa' && economics?.allowableCostPerSoldJob && key === 'roofing') {
    return {
      value: economics.allowableCostPerSoldJob,
      low: null,
      high: null,
      label: 'Playbook estimate',
      note: economics.source || 'Roofing playbook allowable cost per sold job.',
    };
  }
  if (platform === 'meta' && metric === 'cpl') {
    const band = playbookCplBand(key);
    if (!band) return null;
    // Plumbing's $110 is the point estimate. The older band is not a second number.
    if (key === 'plumbing') return null;
    return {
      value: null,
      low: band.low,
      high: band.high,
      label: 'Playbook estimate',
      note: 'Planning range from the Meta campaign playbook. Not a measured median.',
    };
  }
  return null;
}
