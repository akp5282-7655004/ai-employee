/**
 * Skill thresholds live on the playbook, not inside a skill.
 * A new trade added to the campaign playbook picks up these defaults.
 * Pass rulesFromPlaybook when that trade needs its own numbers.
 */
import { playbookTrades } from '../agents/playbook.js';
import { RULEBOOK_DEFAULTS, STANDARD_NEGATIVES } from '../agents/rulebook.js';

const EXTRA_JUNK: Record<string, string[]> = {
  painting: ['paint color', 'paint colors', 'colour chart', 'sherwin williams', 'home depot paint'],
};

export interface SkillRules {
  key: string;
  label: string;
  wastedSpendUsd: number;
  negativeSpendUsd: number;
  junkTerms: string[];
  pacingAheadPct: number;
  pacingBehindPct: number;
}

const PACING_AHEAD_PCT = 10;
const PACING_BEHIND_PCT = 20;

export function rulesFromPlaybook(row: Partial<SkillRules> & { key: string; label: string }): SkillRules {
  const junk = row.junkTerms ?? [...STANDARD_NEGATIVES, ...(EXTRA_JUNK[row.key] ?? [])];
  return {
    key: row.key,
    label: row.label,
    wastedSpendUsd: row.wastedSpendUsd ?? RULEBOOK_DEFAULTS.keywordPauseSpend,
    negativeSpendUsd: row.negativeSpendUsd ?? RULEBOOK_DEFAULTS.searchTermNegativeSpend,
    junkTerms: [...junk],
    pacingAheadPct: row.pacingAheadPct ?? PACING_AHEAD_PCT,
    pacingBehindPct: row.pacingBehindPct ?? PACING_BEHIND_PCT,
  };
}

export function rulesForTrade(trade?: string): SkillRules {
  const name = (trade || '').toLowerCase();
  const hit = playbookTrades().find((row) => name.includes(row.key) || name.includes(row.label.toLowerCase()));
  if (!hit) return rulesFromPlaybook({ key: 'default', label: 'Home services' });
  return rulesFromPlaybook({ key: hit.key, label: hit.label });
}
