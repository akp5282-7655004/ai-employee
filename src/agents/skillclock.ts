/** Each of the 11 skills has its own cadence. A period key makes a tick idempotent. */
export const SKILL_CADENCE = {
  'loser-pauser': 'daily',
  'budget-shifter': 'daily',
  'spend-pacing-monitor': 'daily',
  'search-term-gold-miner': 'weekly',
  'negative-keyword-implementer': 'weekly',
  'cpl-funnel-reader': 'weekly',
  'channel-comparator': 'weekly',
  'ad-copy-performance-ranker': 'weekly',
  'seasonality-demand-layer': 'weekly',
  'service-area-audience-builder': 'monthly',
  'campaign-launcher': 'weekly',
} as const;

export type SkillKey = keyof typeof SKILL_CADENCE;

function isoWeek(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function periodKey(skill: string, now: Date): string {
  const cadence = SKILL_CADENCE[skill as SkillKey] ?? 'weekly';
  if (cadence === 'daily') return now.toISOString().slice(0, 10);
  if (cadence === 'monthly') return now.toISOString().slice(0, 7);
  return isoWeek(now);
}

/** Skills whose period key is not the one already stored. */
export function dueSkills(last: Record<string, string> | undefined, now: Date): string[] {
  const prev = last ?? {};
  return Object.keys(SKILL_CADENCE).filter((skill) => prev[skill] !== periodKey(skill, now));
}
