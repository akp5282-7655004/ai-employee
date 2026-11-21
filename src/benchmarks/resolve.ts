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
import { platformOf, tradeLabel, platformLabel, metricLabel } from './trades.js';
import { EMPTY_COHORT, METRICS, type Metric, type MilesCohort, type Platform } from './types.js';

export type BenchmarkKind = 'miles' | 'searchlight' | 'external' | 'playbook' | 'none';

/** Stable id for the launcher. `label` is the sentence an owner should read. */
export type BenchmarkSource = 'miles' | 'searchlight' | 'localiq' | 'wordstream' | 'playbook' | 'none';

export interface ResolvedBenchmark {
  trade: string;
  platform: Platform;
  metric: Metric;
  kind: BenchmarkKind;
  /** Launcher field. Same set as `kind`, with LocaliQ and WordStream named apart. */
  source: BenchmarkSource;
  value: number | null;
  low: number | null;
  high: number | null;
  /** Launcher field. The sentence next to the number. */
  label: string;
  /** Same text as `label`. Kept for the screens that already read this name. */
  sourceLabel: string;
  /** Published sample when the source states one. Null when it does not. */
  sampleSize: number | null;
  /** True only when the Miles minimum is met and this value is the Miles median. */
  minimumMet: boolean;
  /** The lead type that was asked for, when one was. */
  leadType: string | null;
  /** Set when Miles is not the number being shown. */
  milesShortfall: string | null;
  note: string;
}

export interface ResolveBenchmarkInput {
  trade: string;
  platform: Platform | string;
  metric: Metric | string;
  /** Optional cut such as emergency or replacement. No published cut exists, so the trade figure is used and the label says so. */
  leadType?: string | null;
  cohort?: MilesCohort | null;
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

function asMetric(raw: string): Metric | null {
  const metric = raw.toLowerCase().trim();
  return (METRICS as readonly string[]).includes(metric) ? metric as Metric : null;
}

function externalSource(name: string): BenchmarkSource {
  const text = name.toLowerCase();
  if (text.includes('wordstream')) return 'wordstream';
  if (text.includes('localiq')) return 'localiq';
  return 'none';
}

function finish(row: {
  trade: string;
  platform: Platform;
  metric: Metric;
  kind: BenchmarkKind;
  source: BenchmarkSource;
  value: number | null;
  low: number | null;
  high: number | null;
  sourceLabel: string;
  sampleSize: number | null;
  minimumMet: boolean;
  leadType: string | null;
  milesShortfall: string | null;
  note: string;
}): ResolvedBenchmark {
  const label = row.leadType
    ? `${row.sourceLabel}. Trade-level figure. No separate benchmark for ${row.leadType} leads.`
    : row.sourceLabel;
  return { ...row, sourceLabel: label, label };
}

export function resolveBenchmark(input: ResolveBenchmarkInput): ResolvedBenchmark {
  const trade = input.trade;
  const metric = asMetric(String(input.metric));
  const leadType = (input.leadType || '').trim() || null;
  const cohort = input.cohort ?? EMPTY_COHORT;
  const knownPlatform = platformOf(input.platform);
  if (!knownPlatform || !metric) {
    const safePlatform: Platform = knownPlatform ?? 'google_ads';
    const safeMetric: Metric = metric ?? 'cpl';
    return finish({
      trade,
      platform: safePlatform,
      metric: safeMetric,
      kind: 'none',
      source: 'none',
      value: null,
      low: null,
      high: null,
      sourceLabel: 'No benchmark',
      sampleSize: null,
      minimumMet: false,
      leadType,
      milesShortfall: milesShortfall(cohort),
      note: 'Miles will not invent a benchmark for an unknown platform or metric.',
    });
  }
  const base = { trade, platform: knownPlatform, metric, leadType };
  if (cohort.published && cohort.median != null && Number.isFinite(cohort.median)) {
    return finish({
      ...base,
      kind: 'miles',
      source: 'miles',
      value: cohort.median,
      low: cohort.p25,
      high: cohort.p75,
      sourceLabel: milesLabel(trade, cohort.contributors),
      sampleSize: cohort.contributors,
      minimumMet: true,
      milesShortfall: null,
      note: 'Miles aggregate for the trailing 90 days. Other sources are not blended in.',
    });
  }
  const shortfall = milesShortfall(cohort);
  const searchlight = searchlightFigure(trade, knownPlatform, metric);
  if (searchlight) {
    return finish({
      ...base,
      kind: 'searchlight',
      source: 'searchlight',
      value: searchlight.value,
      low: null,
      high: null,
      sourceLabel: searchlight.label,
      sampleSize: searchlight.sampleSize,
      minimumMet: false,
      milesShortfall: shortfall,
      note: searchlight.note,
    });
  }
  const external = externalBenchmark(trade, knownPlatform, metric);
  if (external) {
    return finish({
      ...base,
      kind: 'external',
      source: externalSource(external.sourceName),
      value: external.value,
      low: null,
      high: null,
      sourceLabel: external.label,
      sampleSize: external.sampleSize,
      minimumMet: false,
      milesShortfall: shortfall,
      note: external.note,
    });
  }
  const estimate = playbookEstimate(trade, knownPlatform, metric);
  if (estimate && (estimate.value != null || (estimate.low != null && estimate.high != null))) {
    return finish({
      ...base,
      kind: 'playbook',
      source: 'playbook',
      value: estimate.value,
      low: estimate.low,
      high: estimate.high,
      sourceLabel: estimate.label,
      sampleSize: null,
      minimumMet: false,
      milesShortfall: shortfall,
      note: estimate.note,
    });
  }
  return finish({
    ...base,
    kind: 'none',
    source: 'none',
    value: null,
    low: null,
    high: null,
    sourceLabel: 'No benchmark',
    sampleSize: null,
    minimumMet: false,
    milesShortfall: shortfall,
    note: `${tradeLabel(trade)} has no ${platformLabel(knownPlatform)} ${metricLabel(metric)} on file. Miles will not invent one.`,
  });
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
