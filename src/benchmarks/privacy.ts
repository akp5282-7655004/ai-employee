/**
 * Outward shapes. Account ids, names, phones, emails, and addresses are not
 * fields here. Unpublished medians are omitted so a sub-minimum cohort cannot
 * leak the aggregate.
 */
import type { AggregateRow } from './types.js';
import { resolveBenchmark, type ResolvedBenchmark } from './resolve.js';
import type { Metric, Platform } from './types.js';
import { cohortFromAggregate } from './adminView.js';

const FORBIDDEN = ['accountid', 'account_id', 'email', 'phone', 'name', 'address', 'firstname', 'lastname'];

export interface PublicAggregate {
  trade: string;
  platform: Platform;
  metric: Metric;
  windowDays: number;
  asOf: string;
  contributorCount: number;
  cohortN: number;
  requiredCount: number;
  published: boolean;
  median: number | null;
  p25: number | null;
  p75: number | null;
  sourceLabel: string;
  source: string;
  label: string;
  sampleSize: number | null;
  minimumMet: boolean;
  milesShortfall: string | null;
}

export function publicAggregate(row: AggregateRow): PublicAggregate {
  const resolved = resolveBenchmark({
    trade: row.trade,
    platform: row.platform,
    metric: row.metric,
    cohort: cohortFromAggregate(row),
  });
  return {
    trade: row.trade,
    platform: row.platform,
    metric: row.metric,
    windowDays: row.windowDays,
    asOf: row.asOf,
    contributorCount: row.contributorCount,
    cohortN: row.cohortN,
    requiredCount: row.requiredCount,
    published: row.published,
    median: row.published ? row.median : null,
    p25: row.published ? row.p25 : null,
    p75: row.published ? row.p75 : null,
    sourceLabel: resolved.label,
    source: resolved.source,
    label: resolved.label,
    sampleSize: resolved.sampleSize,
    minimumMet: resolved.minimumMet,
    milesShortfall: resolved.milesShortfall,
  };
}

export function publicResolution(row: ResolvedBenchmark): Record<string, unknown> {
  return {
    trade: row.trade,
    platform: row.platform,
    metric: row.metric,
    kind: row.kind,
    value: row.value,
    source: row.source,
    label: row.label,
    sampleSize: row.sampleSize,
    minimumMet: row.minimumMet,
    low: row.low,
    high: row.high,
    sourceLabel: row.sourceLabel,
    milesShortfall: row.milesShortfall,
    note: row.note,
  };
}

/** True when a payload carries another business's identity or a hidden median. */
export function payloadLeaks(value: unknown, accountIds: string[] = []): string | null {
  const text = JSON.stringify(value).toLowerCase();
  for (const id of accountIds) {
    if (id && text.includes(id.toLowerCase())) return `account id ${id}`;
  }
  for (const key of FORBIDDEN) {
    if (text.includes(`"${key}"`)) return key;
  }
  return null;
}
