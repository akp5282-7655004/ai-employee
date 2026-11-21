/**
 * Verified external benchmarks transcribed from the 21 Nov 2026 research notes.
 * Every value was read from a page that returned HTTP 200. Nothing here is
 * averaged, interpolated, or filled in for a trade the source did not publish.
 *
 * HVAC is two LocaliQ rows (air conditioning, heating). They are stored under
 * their own keys and are not used as the HVAC trade. Category rows (Home &
 * Home Improvement) are stored so the number is on file, and the resolver
 * will not apply a category average to one trade. Stale 2020-2021 rows are
 * stored with current:false and are not used.
 */
import type { Metric, Platform } from './types.js';

export type Reliability = 'high' | 'medium';

export interface ExternalBenchmark {
  /** Miles trade key, or a source-specific key that is not a Miles trade. */
  trade: string;
  platform: Platform;
  metric: Metric;
  value: number;
  /** trade = this trade. category = do not apply to one trade. split = not the parent trade. */
  scope: 'trade' | 'category' | 'split';
  /** False for the 2020-2021 LocaliQ window. The resolver skips these. */
  current: boolean;
  sourceName: string;
  /** Customer-facing label, e.g. "LocaliQ 2025". */
  label: string;
  url: string;
  period: string;
  sampleSize: number | null;
  reliability: Reliability;
  note: string;
}

const LOCALIQ_2025 = {
  sourceName: 'LocaliQ',
  label: 'LocaliQ 2025',
  url: 'https://localiq.com/blog/home-services-search-advertising-benchmarks/',
  period: '1 Apr 2024-21 Mar 2025',
  sampleSize: 3211,
  reliability: 'high' as const,
  platform: 'google_ads' as const,
};

function search(trade: string, metric: Metric, value: number, note: string, scope: ExternalBenchmark['scope'] = 'trade'): ExternalBenchmark {
  return { ...LOCALIQ_2025, trade, metric, value, scope, current: true, note };
}

export const EXTERNAL_BENCHMARKS: ExternalBenchmark[] = [
  search('plumbing', 'cpl', 129.02, 'Median. LocaliQ 2025 home-services search, Plumbing.'),
  search('plumbing', 'cpc', 10.49, 'Median. Same LocaliQ 2025 sample.'),
  search('electrical', 'cpl', 93.69, 'Median. LocaliQ 2025 home-services search, Electrical.'),
  search('electrical', 'cpc', 12.18, 'Median. Same LocaliQ 2025 sample.'),
  search('painting', 'cpl', 138.38, 'Median. LocaliQ label: Paint & Painting.'),
  search('painting', 'cpc', 13.74, 'Median. Highest CPC of the 16 subcategories.'),
  search('roofing', 'cpl', 228.15, 'Median. LocaliQ label: Roofing & Gutters.'),
  search('roofing', 'cpc', 10.70, 'Median. Same LocaliQ 2025 sample.'),
  search('landscaping', 'cpl', 117.92, 'Median. LocaliQ 2025 home-services search, Landscaping.'),
  search('landscaping', 'cpc', 8.76, 'Median. Same LocaliQ 2025 sample.'),
  // Two published HVAC cuts. Not collapsed into one HVAC number.
  search('hvac_ac', 'cpl', 127.74, 'Median. LocaliQ label: Air Conditioning Installation & Repair. Not a single HVAC row.', 'split'),
  search('hvac_ac', 'cpc', 9.68, 'Median. Air Conditioning Installation & Repair.', 'split'),
  search('hvac_heating', 'cpl', 129.02, 'Median. LocaliQ label: Heating & Furnaces. Not a single HVAC row.', 'split'),
  search('hvac_heating', 'cpc', 9.30, 'Median. Heating & Furnaces.', 'split'),
  // Category averages. Recorded, not applied to a trade.
  {
    ...LOCALIQ_2025,
    trade: 'home_services',
    metric: 'cpl',
    value: 90.92,
    scope: 'category',
    current: true,
    note: 'Median for all home-services subcategories. Not a trade figure.',
  },
  {
    trade: 'home_improvement',
    platform: 'google_ads',
    metric: 'cpl',
    value: 90.92,
    scope: 'category',
    current: true,
    sourceName: 'WordStream',
    label: 'WordStream 2026',
    url: 'https://www.wordstream.com/blog/2026-google-ads-benchmarks',
    period: '1 Apr 2025-31 Mar 2026',
    sampleSize: 13474,
    reliability: 'high',
    note: 'Home & Home Improvement category median. Identical to the 2025 home-services CPL. Not a trade breakout.',
  },
  {
    trade: 'home_improvement',
    platform: 'google_ads',
    metric: 'cpc',
    value: 8.33,
    scope: 'category',
    current: true,
    sourceName: 'WordStream',
    label: 'WordStream 2026',
    url: 'https://www.wordstream.com/blog/2026-google-ads-benchmarks',
    period: '1 Apr 2025-31 Mar 2026',
    sampleSize: 13474,
    reliability: 'high',
    note: 'Home & Home Improvement category median CPC. Not a trade breakout.',
  },
  {
    trade: 'home_improvement',
    platform: 'meta',
    metric: 'cpl',
    value: 42.95,
    scope: 'category',
    current: true,
    sourceName: 'WordStream',
    label: 'WordStream 2026',
    url: 'https://www.wordstream.com/blog/facebook-ads-benchmarks-2026',
    period: '1 Apr 2025-30 Jun 2026',
    sampleSize: 452,
    reliability: 'high',
    note: 'Meta Lead Ads median for Home & Home Improvement. No per-trade row.',
  },
  {
    trade: 'home_improvement',
    platform: 'meta',
    metric: 'cpc',
    value: 2.18,
    scope: 'category',
    current: true,
    sourceName: 'WordStream',
    label: 'WordStream 2026',
    url: 'https://www.wordstream.com/blog/facebook-ads-benchmarks-2026',
    period: '1 Apr 2025-30 Jun 2026',
    sampleSize: 452,
    reliability: 'high',
    note: 'Meta Lead Ads median CPC. Category only.',
  },
  // Stale. Kept so a caller cannot accidentally treat it as current.
  {
    trade: 'plumbing',
    platform: 'google_ads',
    metric: 'cpl',
    value: 48.91,
    scope: 'trade',
    current: false,
    sourceName: 'LocaliQ',
    label: 'LocaliQ 2020-2021',
    url: 'https://localiq.com/blog/home-services-advertising-benchmarks/',
    period: '1 May 2020-25 Jun 2021',
    sampleSize: 4595,
    reliability: 'high',
    note: 'Superseded by the 2025 LocaliQ home-services search report. Not a current target.',
  },
];

export function externalBenchmark(trade: string, platform: Platform, metric: Metric): ExternalBenchmark | null {
  return EXTERNAL_BENCHMARKS.find((row) =>
    row.current && row.scope === 'trade' && row.trade === trade && row.platform === platform && row.metric === metric,
  ) ?? null;
}
