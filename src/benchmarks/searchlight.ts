/**
 * Searchlight figures already stored in src/packs/benchmarks.ts.
 * Values are read from that file. Periods are the ones named on the source
 * pages in the 21 Nov 2026 notes. A combined sample is not used as one trade.
 * The HVAC Google Ads 4.37x ROAS cell is flagged unverified on the hub and skipped.
 */
import { BENCHMARK_HUB, type HubEntry } from '../packs/benchmarks.js';
import type { Metric, Platform } from './types.js';
import { tradeKey } from './trades.js';

export interface SearchlightFigure {
  trade: string;
  platform: Platform;
  metric: Metric;
  value: number;
  label: string;
  period: string;
  sourceUrl: string;
  note: string;
}

const PERIOD: Record<string, string> = {
  'google_lsa|hvac|cpl': 'Feb 2026',
  'google_lsa|hvac|roas': 'Feb 2026',
  'google_lsa|plumbing|cpl': 'Feb 2026',
  'google_lsa|plumbing|roas': 'Feb 2026',
  'google_lsa|electrical|cpl': 'Feb 2026',
  'google_lsa|electrical|roas': 'Feb 2026',
  'google_lsa|drain|cpl': 'Feb 2026',
  'google_lsa|drain|roas': 'Feb 2026',
  'google_lsa|water_heater|cpl': 'Feb 2026',
  'google_lsa|water_heater|roas': 'Feb 2026',
  'google_lsa|roofing|cpl': 'Q1 2026',
  'google_lsa|roofing|roas': 'Q1 2026',
  'google_lsa|garage_door|cpl': 'Jan-Apr 2026',
  'google_lsa|garage_door|roas': 'Jan-Apr 2026',
  'google_ads|hvac|cpl': 'Jan 2026',
  'google_ads|plumbing|cpl': 'Q1 2026',
  'google_ads|roofing|cpl': 'Q1 2026',
  'google_ads|electrical|cpl': 'Jan 2026',
  'meta|hvac|roas': 'Q4 2025',
};

function platformOfChannel(id: string): Platform | null {
  if (id === 'google_ads') return 'google_ads';
  if (id === 'lsa') return 'google_lsa';
  if (id === 'facebook') return 'meta';
  return null;
}

function metricOf(entry: HubEntry): Metric | null {
  if (entry.metric === 'CPL') return 'cpl';
  if (entry.metric === 'ROAS') return 'roas';
  return null;
}

export function searchlightFigures(): SearchlightFigure[] {
  const out: SearchlightFigure[] = [];
  for (const channel of BENCHMARK_HUB) {
    const platform = platformOfChannel(channel.id);
    if (!platform) continue;
    for (const entry of channel.entries) {
      if (entry.unverified) continue;
      if (entry.value == null) continue;
      const metric = metricOf(entry);
      if (!metric) continue;
      const trade = tradeKey(entry.trade);
      if (!trade) continue;
      const period = PERIOD[`${platform}|${trade}|${metric}`] || '';
      out.push({
        trade,
        platform,
        metric,
        value: entry.value,
        period,
        label: period ? `Searchlight, ${period}` : 'Searchlight',
        sourceUrl: entry.source,
        note: entry.note || '',
      });
    }
  }
  return out;
}

export function searchlightFigure(trade: string, platform: Platform, metric: Metric): SearchlightFigure | null {
  return searchlightFigures().find((row) => row.trade === trade && row.platform === platform && row.metric === metric) ?? null;
}
