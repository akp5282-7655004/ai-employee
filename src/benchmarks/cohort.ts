/**
 * Scaled minimum group size.
 *
 * N is the count of active accounts in the trade with that platform connected.
 * p is 0.50 at N <= 10 and 0.75 at N >= 100, linear in between.
 * required = max(5, ceil(p * N)).
 *
 * N=10 -> 5. N=100 -> 75.
 */
import { BENCHMARK_CONFIG, type BenchmarkConfig } from './config.js';

export function shareP(n: number, config: BenchmarkConfig = BENCHMARK_CONFIG): number {
  const size = Math.max(0, Math.floor(n));
  if (size <= config.nAtSmall) return config.pAtSmall;
  if (size >= config.nAtLarge) return config.pAtLarge;
  const span = config.nAtLarge - config.nAtSmall;
  const rise = config.pAtLarge - config.pAtSmall;
  return config.pAtSmall + rise * ((size - config.nAtSmall) / span);
}

export function requiredContributors(n: number, config: BenchmarkConfig = BENCHMARK_CONFIG): number {
  const size = Math.max(0, Math.floor(n));
  const need = Math.ceil(shareP(size, config) * size - 1e-9);
  return Math.max(config.floor, need);
}
