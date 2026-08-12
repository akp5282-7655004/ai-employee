/**
 * Credit metering — per-workspace usage. Every metered action costs credits;
 * we track counts + credits for the current calendar month and reset cleanly when
 * the month rolls over. Pure and testable; the server calls `meter()` at the few
 * endpoints that actually consume work (LLM text, image/video/audio, agent runs,
 * audits) and surfaces the total in Settings → Usage.
 */

export type MeterKind =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'agent_run'
  | 'agent_design'
  | 'audit';

/** What each action costs, in credits. Heavier media costs more. */
export const CREDIT_COST: Record<MeterKind, number> = {
  text: 1,
  image: 5,
  video: 20,
  audio: 3,
  agent_run: 2,
  agent_design: 1,
  audit: 2,
};

export const ACTION_LABEL: Record<MeterKind, string> = {
  text: 'Copy & text generations',
  image: 'Images generated',
  video: 'Videos generated',
  audio: 'Voiceovers generated',
  agent_run: 'Agent runs',
  agent_design: 'Agents designed',
  audit: 'Website audits',
};

/** Default monthly credit allowance per workspace. */
export const MONTHLY_ALLOWANCE = 1000;

export interface Usage {
  period: string; // 'YYYY-MM'
  actions: Partial<Record<MeterKind, number>>;
  credits: number;
}

/** The calendar-month key for a date, e.g. "2026-08". */
export function periodOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function blankUsage(period: string): Usage {
  return { period, actions: {}, credits: 0 };
}

/**
 * Record `n` of `kind` against a usage record for `now`. If the record is from a
 * previous month (or missing), it starts fresh — metering is per calendar month.
 * Returns the updated usage (mutates and returns for convenience).
 */
export function applyMeter(usage: Usage | undefined, kind: MeterKind, now: Date, n = 1): Usage {
  const period = periodOf(now);
  const u = usage && usage.period === period ? usage : blankUsage(period);
  u.actions[kind] = (u.actions[kind] ?? 0) + n;
  u.credits += CREDIT_COST[kind] * n;
  return u;
}

export interface UsageSummary {
  period: string;
  credits: number;
  allowance: number;
  pct: number;
  overage: number;
  rows: Array<{ kind: MeterKind; label: string; count: number; credits: number }>;
}

/** Shape the usage for display: credit bar + a per-action breakdown. */
export function summarizeUsage(usage: Usage | undefined, now: Date, allowance = MONTHLY_ALLOWANCE): UsageSummary {
  const period = periodOf(now);
  const u = usage && usage.period === period ? usage : blankUsage(period);
  const rows = (Object.keys(CREDIT_COST) as MeterKind[])
    .map((kind) => ({ kind, label: ACTION_LABEL[kind], count: u.actions[kind] ?? 0, credits: (u.actions[kind] ?? 0) * CREDIT_COST[kind] }))
    .filter((r) => r.count > 0);
  return {
    period,
    credits: u.credits,
    allowance,
    pct: allowance > 0 ? Math.min(100, Math.round((u.credits / allowance) * 100)) : 0,
    overage: Math.max(0, u.credits - allowance),
    rows,
  };
}
