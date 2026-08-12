/**
 * 30-day social report — the monthly dataset the customer asked for. A connector
 * gives a metrics snapshot, so a real 30-day rollup is built by recording one
 * snapshot per day (the daily social agent, or this report, logs it) and compiling
 * the trailing window. Pure + testable; persistence is a patch returned to the caller.
 */
import type { SocialMetrics } from '../connectors/types.js';

export interface DailySnapshot {
  date: string; // YYYY-MM-DD
  impressions: number;
  clicks: number;
  likes: number;
  followers?: number;
}

/** Append today's snapshot (one per day, latest wins), keeping ~60 days of history. */
export function recordSnapshot(history: DailySnapshot[], metrics: SocialMetrics | null, nowISO: string): DailySnapshot[] {
  if (!metrics) return history;
  const date = nowISO.slice(0, 10);
  const kept = history.filter((h) => h.date !== date);
  kept.push({ date, impressions: metrics.impressions || 0, clicks: metrics.clicks || 0, likes: metrics.likes || 0, followers: metrics.followers });
  return kept.sort((a, b) => a.date.localeCompare(b.date)).slice(-60);
}

export interface SocialReport {
  title: string;
  body: string;
  rows: DailySnapshot[];
}

/** Compile the trailing 30 days into a summary + a daily dataset. */
export function buildSocialReport(history: DailySnapshot[], nowISO: string): SocialReport {
  const cutoff = new Date(Date.parse(nowISO) - 30 * 86_400_000).toISOString().slice(0, 10);
  const rows = history.filter((h) => h.date >= cutoff);
  if (!rows.length) {
    return {
      title: '30-day social report',
      body: 'No social data logged yet. Connect your social accounts (Integrations) and deploy the daily social agent — your 30-day dataset builds one day at a time and this report fills in automatically.',
      rows: [],
    };
  }
  const sum = (k: 'impressions' | 'clicks' | 'likes') => rows.reduce((s, r) => s + (r[k] || 0), 0);
  const impr = sum('impressions');
  const clk = sum('clicks');
  const lk = sum('likes');
  const best = [...rows].sort((a, b) => b.impressions - a.impressions)[0]!;
  const first = rows[0]!;
  const last = rows[rows.length - 1]!;
  const follGain = (last.followers ?? 0) - (first.followers ?? 0);
  const ctr = impr ? (clk / impr) * 100 : 0;
  const lines = [
    `Your last ${rows.length} days on social:`,
    '',
    `• ${impr.toLocaleString()} impressions`,
    `• ${clk.toLocaleString()} clicks (${ctr.toFixed(1)}% CTR)`,
    `• ${lk.toLocaleString()} likes`,
    first.followers != null && last.followers != null ? `• ${follGain >= 0 ? '+' : ''}${follGain.toLocaleString()} followers` : '',
    `• Best day: ${best.date} — ${best.impressions.toLocaleString()} impressions`,
    '',
    'Daily dataset:',
    ...rows.map((r) => `${r.date}: ${r.impressions} impr · ${r.clicks} clk · ${r.likes} likes${r.followers != null ? ` · ${r.followers} followers` : ''}`),
  ].filter(Boolean);
  return { title: `30-day social report — ${rows.length} days`, body: lines.join('\n'), rows };
}
