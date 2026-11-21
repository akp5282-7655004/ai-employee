/**
 * Percentiles and winsorizing for a cohort of account-level rates.
 *
 * Percentile is linear interpolation (Hyndman type 7). Winsorizing clips to
 * the 5th and 95th percentile before p25, median, and p75 are taken, so one
 * extreme account cannot drag the published median. Samples under 4 values
 * are left as they are: the tails are not estimable.
 */

export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  if (sorted.length === 1) return sorted[0]!;
  const rank = (Math.min(100, Math.max(0, p)) / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo]!;
  const weight = rank - lo;
  return sorted[lo]! * (1 - weight) + sorted[hi]! * weight;
}

export function winsorize(values: number[]): number[] {
  const finite = values.filter((n) => Number.isFinite(n));
  if (finite.length < 4) return finite.slice();
  const sorted = [...finite].sort((a, b) => a - b);
  const lo = percentile(sorted, 5);
  const hi = percentile(sorted, 95);
  return finite.map((n) => Math.min(hi, Math.max(lo, n)));
}

export function cohortStats(values: number[]): { p25: number; median: number; p75: number } | null {
  const clipped = winsorize(values);
  if (!clipped.length) return null;
  const sorted = [...clipped].sort((a, b) => a - b);
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    p25: round(percentile(sorted, 25)),
    median: round(percentile(sorted, 50)),
    p75: round(percentile(sorted, 75)),
  };
}
