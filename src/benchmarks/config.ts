/**
 * Living playbook thresholds. Override in tests; production uses these.
 *
 * p rises linearly from pAtSmall at nAtSmall to pAtLarge at nAtLarge.
 * required = max(floor, ceil(p * N)).
 */

export interface BenchmarkConfig {
  windowDays: number;
  /** Hard floor on the number of clean contributors. */
  floor: number;
  pAtSmall: number;
  nAtSmall: number;
  pAtLarge: number;
  nAtLarge: number;
  /** A contributor needs at least this much spend in the window. */
  minSpend: number;
  /** A contributor needs at least this many leads in the window. */
  minLeads: number;
  /** Not publishable when one account is above this share of cohort spend. */
  maxSpendShare: number;
}

export const BENCHMARK_CONFIG: BenchmarkConfig = {
  windowDays: 90,
  floor: 5,
  pAtSmall: 0.5,
  nAtSmall: 10,
  pAtLarge: 0.75,
  nAtLarge: 100,
  minSpend: 100,
  minLeads: 5,
  maxSpendShare: 0.4,
};
