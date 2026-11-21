/**
 * Trailing-window aggregate. One row per trade, platform, and metric.
 * The output has no account id. An account's rates are summed across its
 * own days and campaign types first, then the cohort median is taken.
 */
import { BENCHMARK_CONFIG, type BenchmarkConfig } from './config.js';
import { requiredContributors } from './cohort.js';
import { cohortStats } from './stats.js';
import { METRICS, PLATFORMS, type AggregateRow, type DailyRow, type Membership, type Metric, type Platform } from './types.js';

interface AccountRollup {
  accountId: string;
  spend: number;
  clicks: number;
  leads: number;
  bookedJobs: number;
  revenue: number;
}

function dayOffset(day: string, days: number): string {
  const t = Date.parse(`${day}T00:00:00Z`);
  return new Date(t - days * 86_400_000).toISOString().slice(0, 10);
}

function metricValue(row: AccountRollup, metric: Metric): number | null {
  if (metric === 'cpl') return row.leads > 0 ? row.spend / row.leads : null;
  if (metric === 'cpc') return row.clicks > 0 ? row.spend / row.clicks : null;
  if (metric === 'cpa') return row.bookedJobs > 0 ? row.spend / row.bookedJobs : null;
  return row.spend > 0 ? row.revenue / row.spend : null;
}

function qualifies(row: AccountRollup, metric: Metric, config: BenchmarkConfig): boolean {
  if (row.spend < config.minSpend || row.leads < config.minLeads) return false;
  return metricValue(row, metric) != null;
}

export function aggregateBenchmarks(input: {
  asOf: string;
  daily: DailyRow[];
  membership: Membership[];
  config?: BenchmarkConfig;
}): AggregateRow[] {
  const config = input.config ?? BENCHMARK_CONFIG;
  const start = dayOffset(input.asOf, config.windowDays - 1);
  const trades = new Set<string>();
  for (const row of input.membership) if (row.trade) trades.add(row.trade);
  for (const row of input.daily) if (row.trade) trades.add(row.trade);
  const out: AggregateRow[] = [];
  for (const trade of trades) {
    for (const platform of PLATFORMS) {
      const members = input.membership.filter((row) => row.trade === trade && row.active && row.platforms.includes(platform));
      const cohortN = new Set(members.map((row) => row.accountId)).size;
      const requiredCount = requiredContributors(cohortN, config);
      const eligible = new Set(members.filter((row) => row.consent && row.trackingVerified).map((row) => row.accountId));
      const rolls = new Map<string, AccountRollup>();
      for (const row of input.daily) {
        if (row.trade !== trade || row.platform !== platform) continue;
        if (row.day < start || row.day > input.asOf) continue;
        if (!eligible.has(row.accountId)) continue;
        if (!row.accountActive || !row.consent || !row.trackingVerified) continue;
        const cur = rolls.get(row.accountId) ?? { accountId: row.accountId, spend: 0, clicks: 0, leads: 0, bookedJobs: 0, revenue: 0 };
        cur.spend += row.spend;
        cur.clicks += row.clicks;
        cur.leads += row.leads;
        cur.bookedJobs += row.bookedJobs;
        cur.revenue += row.revenue;
        rolls.set(row.accountId, cur);
      }
      for (const metric of METRICS) {
        const contributors = [...rolls.values()].filter((row) => qualifies(row, metric, config));
        const totalSpend = contributors.reduce((sum, row) => sum + row.spend, 0);
        const top = contributors.reduce((max, row) => Math.max(max, row.spend), 0);
        const spendCapOk = !(totalSpend > 0) || top / totalSpend <= config.maxSpendShare + 1e-9;
        const stats = contributors.length ? cohortStats(contributors.map((row) => metricValue(row, metric)!)) : null;
        let reason: AggregateRow['reason'] = 'published';
        if (!contributors.length) reason = 'no_contributors';
        else if (contributors.length < requiredCount) reason = 'below_minimum';
        else if (!spendCapOk) reason = 'spend_concentration';
        const published = reason === 'published' && !!stats;
        out.push({
          trade,
          platform,
          metric,
          windowDays: config.windowDays,
          asOf: input.asOf,
          median: published && stats ? stats.median : null,
          p25: published && stats ? stats.p25 : null,
          p75: published && stats ? stats.p75 : null,
          contributorCount: contributors.length,
          cohortN,
          requiredCount,
          published,
          spendCapOk,
          totalSpend: Math.round(totalSpend * 100) / 100,
          reason: published ? 'published' : reason,
        });
      }
    }
  }
  return out;
}
