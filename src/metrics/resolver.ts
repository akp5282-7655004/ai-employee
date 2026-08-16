/**
 * getMetric() — the one function every dashboard widget calls
 * (spec §3.3): resolve a catalog entry, produce { value, prior_value,
 * series[] }, and label the source honestly.
 *
 * Live data today: google_ads.cost (real spend via the connector's
 * getAdSpend). Everything else returns SAMPLE data — deterministic per
 * metric so the dashboard is stable — and is labeled source:'sample'.
 * As connectors gain read scopes, metrics flip to live here, one at a
 * time, without touching any widget code. Never show fake numbers as real.
 */
import { metricByKey, type MetricEntry } from './catalog.js';

export interface MetricResult {
  key: string;
  label: string;
  format: MetricEntry['format'];
  direction: MetricEntry['direction'];
  value: number;
  prior_value: number;
  series: number[];
  source: 'live' | 'sample';
}

/** Deterministic pseudo-random stream from a string seed (stable dashboards). */
function seeded(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

function sampleResult(entry: MetricEntry, days: number): Omit<MetricResult, 'key' | 'label' | 'format' | 'direction' | 'source'> {
  const rnd = seeded(`${entry.key}:${days}`);
  const n = Math.min(days, 30);
  const base = entry.sample_value;
  // Rates/averages hover around the sample value; volumes split it across days.
  const perDay = entry.aggregation === 'sum' ? base / n : base;
  const series = Array.from({ length: n }, () => Math.max(0, perDay * (0.55 + rnd() * 0.9)));
  const value = entry.aggregation === 'sum' ? series.reduce((a, b) => a + b, 0) : base * (0.92 + rnd() * 0.16);
  const prior = value * (0.82 + rnd() * 0.3);
  const round = (x: number) => (entry.format === 'integer' ? Math.round(x) : Math.round(x * 100) / 100);
  return { value: round(value), prior_value: round(prior), series: series.map((x) => Math.round(x * 100) / 100) };
}

export interface LiveReaders {
  /** Total ad spend for the range, or undefined when not connected. */
  googleAdsCost?: (days: number) => Promise<number | undefined>;
}

export async function getMetric(key: string, days: number, live: LiveReaders = {}): Promise<MetricResult | undefined> {
  const entry = metricByKey(key);
  if (!entry) return undefined;
  const base: MetricResult = { key, label: entry.label, format: entry.format, direction: entry.direction, source: 'sample', ...sampleResult(entry, days) };
  if (key === 'google_ads.cost' && live.googleAdsCost) {
    try {
      const real = await live.googleAdsCost(days);
      if (typeof real === 'number' && Number.isFinite(real)) {
        return { ...base, value: Math.round(real * 100) / 100, prior_value: base.prior_value, source: 'live' };
      }
    } catch { /* fall through to sample */ }
  }
  return base;
}

export async function getMetrics(keys: string[], days: number, live: LiveReaders = {}): Promise<MetricResult[]> {
  const out: MetricResult[] = [];
  for (const k of keys) {
    const r = await getMetric(k, days, live);
    if (r) out.push(r);
  }
  return out;
}
