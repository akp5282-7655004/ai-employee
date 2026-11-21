/**
 * One benchmark for a trade, platform, and metric.
 *
 * 1. Miles aggregate, when the minimum is met. It replaces every other number.
 *    Nothing is blended with it.
 * 2. Searchlight, from src/packs/benchmarks.ts, skipping unverified cells.
 * 3. A verified external figure (LocaliQ / WordStream) for that trade.
 * 4. The trade playbook's own estimate.
 * 5. No benchmark. Solar on a platform with no row lands here.
 */
import { externalBenchmark } from './external.js';
import { playbookEstimate } from './playbookEstimate.js';
import { searchlightFigure } from './searchlight.js';
import { tradeLabel, platformLabel, metricLabel } from './trades.js';
import { EMPTY_COHORT, type Metric, type MilesCohort, type Platform } from './types.js';

export type BenchmarkKind = 'miles' | 'searchlight' | 'external' | 'playbook' | 'none';

export interface ResolvedBenchmark {
  trade: string;
  platform: Platform;
  metric: Metric;
  kind: BenchmarkKind;
  value: number | null;
  low: number | null;
  high: number | null;
  /** Source name the owner should see, e.g. "LocaliQ 2025". */
  sourceLabel: string;
  /** Set when Miles is not the number being shown. */
  milesShortfall: string | null;
  note: string;
}

export function milesShortfall(cohort: MilesCohort): string | null {
  if (cohort.published) return null;
  if (!cohort.spendCapOk && cohort.contributors >= cohort.required) {
    return 'Miles data is not published because one account is more than 40% of cohort spend.';
  }
  return `Not enough Miles data yet (${cohort.contributors} of ${cohort.required} accounts)`;
}

export function milesLabel(trade: string, contributors: number): string {
  const name = tradeLabel(trade).toLowerCase();
  const noun = contributors === 1 ? 'account' : 'accounts';
  return `Miles data, ${contributors} ${name} ${noun}, last 90 days`;
}

function money(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? `$${rounded}` : `$${rounded.toFixed(2)}`;
}

export function formatBenchmark(row: ResolvedBenchmark): string {
  const what = `${tradeLabel(row.trade)} ${platformLabel(row.platform)} ${metricLabel(row.metric)}`;
  const figure = row.value == null
    ? (row.low != null && row.high != null ? `${money(row.low)} to ${money(row.high)}` : 'no benchmark')
    : row.metric === 'roas'
      ? `${row.value}x`
      : money(row.value);
  const source = row.kind === 'none' ? 'No benchmark' : row.sourceLabel;
  const extra = row.milesShortfall ? ` ${row.milesShortfall}.` : '';
  return `${what}: ${figure}. Source: ${source}.${extra}`.replace(/\s{2,}/g, ' ').trim();
}

export function resolveBenchmark(input: {
  trade: string;
  platform: Platform;
  metric: Metric;
  cohort?: MilesCohort | null;
}): ResolvedBenchmark {
  const trade = input.trade;
  const cohort = input.cohort ?? EMPTY_COHORT;
  const base = { trade, platform: input.platform, metric: input.metric };
  if (cohort.published && cohort.median != null && Number.isFinite(cohort.median)) {
    return {
      ...base,
      kind: 'miles',
      value: cohort.median,
      low: cohort.p25,
      high: cohort.p75,
      sourceLabel: milesLabel(trade, cohort.contributors),
      milesShortfall: null,
      note: 'Miles aggregate for the trailing 90 days. Other sources are not blended in.',
    };
  }
  const shortfall = milesShortfall(cohort);
  const searchlight = searchlightFigure(trade, input.platform, input.metric);
  if (searchlight) {
    return {
      ...base,
      kind: 'searchlight',
      value: searchlight.value,
      low: null,
      high: null,
      sourceLabel: searchlight.label,
      milesShortfall: shortfall,
      note: searchlight.note,
    };
  }
  const external = externalBenchmark(trade, input.platform, input.metric);
  if (external) {
    return {
      ...base,
      kind: 'external',
      value: external.value,
      low: null,
      high: null,
      sourceLabel: external.label,
      milesShortfall: shortfall,
      note: external.note,
    };
  }
  const estimate = playbookEstimate(trade, input.platform, input.metric);
  if (estimate && (estimate.value != null || (estimate.low != null && estimate.high != null))) {
    return {
      ...base,
      kind: 'playbook',
      value: estimate.value,
      low: estimate.low,
      high: estimate.high,
      sourceLabel: estimate.label,
      milesShortfall: shortfall,
      note: estimate.note,
    };
  }
  return {
    ...base,
    kind: 'none',
    value: null,
    low: null,
    high: null,
    sourceLabel: 'No benchmark',
    milesShortfall: shortfall,
    note: `${tradeLabel(trade)} has no ${platformLabel(input.platform)} ${metricLabel(input.metric)} on file. Miles will not invent one.`,
  };
}

/** Lines for chat context. One per platform and metric. No account ids. */
export function benchmarkLines(trade: string, cohorts?: Partial<Record<Platform, Partial<Record<Metric, MilesCohort>>>>): string[] {
  const platforms: Platform[] = ['google_ads', 'google_lsa', 'meta', 'tiktok'];
  const metrics: Metric[] = ['cpl', 'cpc', 'cpa', 'roas'];
  const lines: string[] = [];
  for (const platform of platforms) {
    for (const metric of metrics) {
      const row = resolveBenchmark({ trade, platform, metric, cohort: cohorts?.[platform]?.[metric] ?? null });
      if (row.kind === 'none' && metric !== 'cpl') continue;
      lines.push(formatBenchmark(row));
    }
  }
  return lines;
}
