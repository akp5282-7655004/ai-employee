/**
 * Metric Catalog — the single registry of every metric Miles can put on a
 * dashboard card (spec: docs/specs/dashboard-and-skills-spec.md §4).
 * Data lives in config/metric-catalog.json; defaults in
 * config/dashboard-defaults.json (the one file that changes when the real
 * contractor metric list arrives).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type MetricPlatform = 'google_ads' | 'meta' | 'lsa' | 'gbp' | 'calls' | 'crm' | 'calculated';
export type CardType = 'number' | 'number_spark' | 'line' | 'bar_by_campaign' | 'table_top_n';

export interface MetricEntry {
  key: string;
  platform: MetricPlatform;
  label: string;
  description: string;
  api_field: string | null;
  unit: 'count' | 'currency' | 'percent' | 'seconds' | 'ratio';
  format: 'integer' | 'currency' | 'percent_1dp' | 'decimal_2dp' | 'duration';
  aggregation: 'sum' | 'avg' | 'last' | 'weighted_avg' | 'recompute';
  direction: 'up_good' | 'down_good' | 'neutral';
  supports: string[];
  formula: string | null;
  depends_on: string[];
  default_card: CardType;
  tags: string[];
  sample_value: number;
}

let catalogCache: MetricEntry[] | undefined;
let defaultsCache: { kpi_strip: string[]; custom_grid: string[] } | undefined;

export function metricCatalog(): MetricEntry[] {
  if (!catalogCache) {
    const raw = JSON.parse(readFileSync(join(process.cwd(), 'config', 'metric-catalog.json'), 'utf8'));
    catalogCache = raw.metrics as MetricEntry[];
  }
  return catalogCache;
}

export function metricByKey(key: string): MetricEntry | undefined {
  return metricCatalog().find((m) => m.key === key);
}

export function dashboardDefaults(): { kpi_strip: string[]; custom_grid: string[] } {
  if (!defaultsCache) {
    const raw = JSON.parse(readFileSync(join(process.cwd(), 'config', 'dashboard-defaults.json'), 'utf8'));
    defaultsCache = { kpi_strip: raw.kpi_strip ?? [], custom_grid: raw.custom_grid ?? [] };
  }
  return defaultsCache;
}

/** Format a metric value for display according to its catalog entry. */
export function formatMetric(entry: MetricEntry, v: number): string {
  if (!Number.isFinite(v)) return '—';
  switch (entry.format) {
    case 'currency': return v >= 1000 ? `$${Math.round(v).toLocaleString('en-US')}` : `$${v.toFixed(2).replace(/\.00$/, '')}`;
    case 'percent_1dp': return `${v.toFixed(1)}%`;
    case 'decimal_2dp': return v.toFixed(2);
    case 'duration': return v >= 120 ? `${Math.round(v / 60)}m` : `${Math.round(v)}${entry.unit === 'seconds' ? 's' : ''}`;
    default: return Math.round(v).toLocaleString('en-US');
  }
}
