/**
 * Owner-only cohort list. Counts and the current source. No account ids and
 * no unpublished median.
 */
import { aggregateBenchmarks } from './aggregate.js';
import { requiredContributors } from './cohort.js';
import { resolveBenchmark } from './resolve.js';
import { TRADES, type AggregateRow, type Membership, type Metric, type MilesCohort, type Platform } from './types.js';
import { METRICS, PLATFORMS } from './types.js';

export interface AdminCohortRow {
  trade: string;
  platform: Platform;
  metric: Metric;
  n: number;
  required: number;
  contributors: number;
  published: boolean;
  source: string;
  reason: string;
}

export function cohortFromAggregate(row: AggregateRow | undefined): MilesCohort {
  if (!row) {
    return {
      published: false,
      median: null,
      p25: null,
      p75: null,
      contributors: 0,
      required: requiredContributors(0),
      cohortN: 0,
      spendCapOk: true,
    };
  }
  return {
    published: row.published,
    median: row.published ? row.median : null,
    p25: row.published ? row.p25 : null,
    p75: row.published ? row.p75 : null,
    contributors: row.contributorCount,
    required: row.requiredCount,
    cohortN: row.cohortN,
    spendCapOk: row.spendCapOk,
  };
}

export function adminCohorts(rows: AggregateRow[], membership: Membership[] = []): AdminCohortRow[] {
  const trades = new Set<string>(TRADES);
  for (const row of rows) trades.add(row.trade);
  for (const row of membership) if (row.trade) trades.add(row.trade);
  const out: AdminCohortRow[] = [];
  for (const trade of trades) {
    for (const platform of PLATFORMS) {
      for (const metric of METRICS) {
        const found = rows.find((row) => row.trade === trade && row.platform === platform && row.metric === metric);
        const cohort = cohortFromAggregate(found);
        if (!found) {
          const n = new Set(membership.filter((row) => row.trade === trade && row.active && row.platforms.includes(platform)).map((row) => row.accountId)).size;
          cohort.cohortN = n;
          cohort.required = requiredContributors(n);
          cohort.contributors = 0;
        }
        const resolved = resolveBenchmark({ trade, platform, metric, cohort });
        out.push({
          trade,
          platform,
          metric,
          n: cohort.cohortN,
          required: cohort.required,
          contributors: cohort.contributors,
          published: resolved.kind === 'miles',
          source: resolved.sourceLabel,
          reason: found?.reason || (resolved.kind === 'none' ? 'no_contributors' : 'fallback'),
        });
      }
    }
  }
  return out;
}

export function cohortsForTrade(rows: AggregateRow[], trade: string): Partial<Record<Platform, Partial<Record<Metric, MilesCohort>>>> {
  const out: Partial<Record<Platform, Partial<Record<Metric, MilesCohort>>>> = {};
  for (const row of rows) {
    if (row.trade !== trade) continue;
    const platform = out[row.platform] ?? {};
    platform[row.metric] = cohortFromAggregate(row);
    out[row.platform] = platform;
  }
  return out;
}

/** Recompute from the ledger the job just wrote. */
export function rebuildAggregates(asOf: string, daily: Parameters<typeof aggregateBenchmarks>[0]['daily'], membership: Membership[]): AggregateRow[] {
  return aggregateBenchmarks({ asOf, daily, membership });
}
