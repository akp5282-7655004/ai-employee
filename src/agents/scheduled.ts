/**
 * Scheduled agents — Miles doing recurring, unattended work: a daily morning
 * brief, a marketing performance report, and more. This module is the pure core:
 * the schedule model, the "is it due right now" check, and the task builders that
 * turn real data into a written result. The runner + persistence live in server.ts.
 */
import type { CampaignSpend, Deal } from '../revenue/attribution.js';

export type TaskType = 'morning_brief' | 'cpa_report';

export interface TaskSpec {
  task: TaskType;
  label: string;
  description: string;
  /** A sensible default time (local HH:MM) to pre-fill the form. */
  defaultTime: string;
}

export const TASK_SPECS: TaskSpec[] = [
  {
    task: 'morning_brief',
    label: 'Morning brief + to-do list',
    description: 'A daily rundown — weather, what needs your approval, and the day’s priorities.',
    defaultTime: '08:30',
  },
  {
    task: 'cpa_report',
    label: 'Marketing performance report',
    description: 'Cost-per-acquisition across every ad platform vs. your target, with what to fix.',
    defaultTime: '09:00',
  },
];

export interface ScheduledAgent {
  id: string;
  name: string;
  task: TaskType;
  /** Local wall-clock time, "HH:MM" (24h). */
  time: string;
  /** Weekday numbers to run on: 0=Sun … 6=Sat. */
  days: number[];
  enabled: boolean;
  /** Minutes the owner's local time is behind UTC (browser getTimezoneOffset). */
  tzOffset: number;
  createdAt: string;
  lastRunAt?: string;
}

export interface AgentRun {
  id: string;
  agentId: string;
  task: TaskType;
  ts: string;
  title: string;
  body: string;
}

/** The owner's local wall clock for a given UTC instant + their tz offset. */
function localParts(nowUtc: Date, tzOffset: number): { day: number; hh: number; mm: number; ymd: string } {
  const local = new Date(nowUtc.getTime() - tzOffset * 60_000);
  return {
    day: local.getUTCDay(),
    hh: local.getUTCHours(),
    mm: local.getUTCMinutes(),
    ymd: local.toISOString().slice(0, 10),
  };
}

/**
 * True when an enabled agent should run at `now`: the weekday matches, the local
 * time is at/just past its scheduled minute, and it hasn't already run this local
 * day. The small look-back window means a scheduler ticking each minute won't miss it.
 */
export function isDue(agent: ScheduledAgent, now: Date): boolean {
  if (!agent.enabled || !agent.days?.length) return false;
  const [h = NaN, m = NaN] = agent.time.split(':').map((n) => parseInt(n, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return false;
  const { day, hh, mm, ymd } = localParts(now, agent.tzOffset);
  if (!agent.days.includes(day)) return false;
  const nowMin = hh * 60 + mm;
  const dueMin = h * 60 + m;
  // Fire in the minute it's due, and forgive up to a 5-minute scheduler lag.
  if (nowMin < dueMin || nowMin > dueMin + 5) return false;
  // Once per local day.
  if (agent.lastRunAt) {
    const last = localParts(new Date(agent.lastRunAt), agent.tzOffset);
    if (last.ymd === ymd) return false;
  }
  return true;
}

// ── task builders ────────────────────────────────────────────────────────────

export interface BriefContext {
  business?: string;
  dateLabel: string;
  weatherLine?: string;
  weatherOpportunity?: string;
  pendingApprovals: number;
  activeTriggers: number;
  focus?: string;
}

export function buildMorningBrief(ctx: BriefContext): { title: string; body: string } {
  const biz = ctx.business || 'your business';
  const lines: string[] = [`Good morning — here's ${biz} for ${ctx.dateLabel}.`, ''];
  if (ctx.weatherLine) {
    lines.push(`🌤  Weather: ${ctx.weatherLine}`);
    if (ctx.weatherOpportunity) lines.push(`     Opportunity: ${ctx.weatherOpportunity}`);
    lines.push('');
  }
  lines.push('✅ To-do today:');
  const todos: string[] = [];
  if (ctx.pendingApprovals > 0)
    todos.push(`Approve ${ctx.pendingApprovals} change${ctx.pendingApprovals === 1 ? '' : 's'} waiting in Deploy.`);
  if (ctx.activeTriggers > 0) todos.push(`${ctx.activeTriggers} weather trigger${ctx.activeTriggers === 1 ? '' : 's'} armed — no action needed.`);
  todos.push('Reply to any new leads from overnight.');
  todos.push('Check yesterday’s ad spend vs. booked jobs.');
  todos.forEach((t, i) => lines.push(`   ${i + 1}. ${t}`));
  lines.push('');
  lines.push(`🎯 Focus: ${ctx.focus || 'Turn yesterday’s leads into booked jobs before chasing new ones.'}`);
  return { title: `Morning brief — ${ctx.dateLabel}`, body: lines.join('\n') };
}

export interface CpaRow {
  platform: string;
  spend: number;
  conversions: number;
  cpa: number | null;
  status: 'under' | 'over' | 'no_data';
}

/**
 * Cost-per-acquisition per platform vs. a target. Conversions come from ad-platform
 * data; when a platform reports none we say so rather than divide by zero.
 */
export function buildCpaReport(
  spend: CampaignSpend[],
  _deals: Deal[],
  targetCpa: number,
): { title: string; body: string; rows: CpaRow[]; overCount: number } {
  const byPlatform = new Map<string, { spend: number; conversions: number }>();
  for (const s of spend) {
    const cur = byPlatform.get(s.platform) ?? { spend: 0, conversions: 0 };
    cur.spend += s.spend || 0;
    cur.conversions += s.conversions || 0;
    byPlatform.set(s.platform, cur);
  }
  const rows: CpaRow[] = [...byPlatform.entries()].map(([platform, v]) => {
    const cpa = v.conversions > 0 ? Math.round((v.spend / v.conversions) * 100) / 100 : null;
    const status: CpaRow['status'] = cpa === null ? 'no_data' : cpa <= targetCpa ? 'under' : 'over';
    return { platform, spend: Math.round(v.spend), conversions: v.conversions, cpa, status };
  });
  const overCount = rows.filter((r) => r.status === 'over').length;
  const fmt = (n: number) => `$${n.toLocaleString()}`;
  const label: Record<string, string> = {
    google_ads: 'Google Ads',
    facebook: 'Meta Ads',
    google_lsa: 'Local Services Ads',
  };
  const lines: string[] = [`Target CPA: ${fmt(targetCpa)} per booked job.`, ''];
  if (!rows.length) {
    lines.push('No ad-platform data yet. Connect Google Ads / Meta in Integrations and I’ll track CPA here automatically.');
  } else {
    for (const r of rows) {
      const name = label[r.platform] || r.platform;
      if (r.status === 'no_data') lines.push(`• ${name}: ${fmt(r.spend)} spent, no conversions reported yet.`);
      else {
        const mark = r.status === 'under' ? '✅ under target' : '⚠️ OVER target';
        lines.push(`• ${name}: ${fmt(r.cpa!)} CPA — ${mark}  (${fmt(r.spend)} / ${r.conversions} conv)`);
      }
    }
    lines.push('');
    lines.push(
      overCount === 0
        ? '🎉 Every platform is at or under your target CPA. Hold budgets and keep scaling the winners.'
        : `⚠️ ${overCount} platform${overCount === 1 ? '' : 's'} over target. Recommend trimming budget on the worst performer and shifting it to the best.`,
    );
  }
  return { title: 'Marketing performance — CPA vs. target', body: lines.join('\n'), rows, overCount };
}
