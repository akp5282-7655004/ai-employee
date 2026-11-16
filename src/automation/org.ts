/**
 * Skills and playbooks as an org chart. Miles sits at the top.
 * A department appears only when a skill on this desk exists in code.
 */
import { rulesForTrade } from './rules.js';

export interface OrgSkill {
  key: string;
  name: string;
  fired: number;
  status: 'Clear' | 'Findings' | 'Not run';
  lastRun: string | null;
  findings: number;
}

export interface OrgDepartment {
  name: string;
  skills: OrgSkill[];
}

export interface OrgChart {
  head: { name: string; title: string; playbook: string };
  departments: OrgDepartment[];
  rulesFired: { skill: string; title: string; ts: string }[];
}

const DESKS: { name: string; skills: { key: string; name: string }[] }[] = [
  { name: 'Search terms', skills: [{ key: 'wasted-spend', name: 'Wasted spend' }, { key: 'negative-keywords', name: 'Negative keywords' }] },
  { name: 'Bidding and budget', skills: [{ key: 'budget-pacing', name: 'Budget pacing' }] },
  { name: 'Tracking', skills: [{ key: 'conversion-tracking', name: 'Conversion tracking check' }] },
  { name: 'Reporting', skills: [{ key: 'weekly-report', name: 'Weekly report' }] },
  { name: 'Pages', skills: [{ key: 'landing-pages', name: 'Landing pages' }, { key: 'audits', name: 'Audits' }] },
  { name: 'Ads', skills: [{ key: 'feed-titles', name: 'Feed and titles' }, { key: 'structure', name: 'Structure' }] },
  { name: 'People', skills: [{ key: 'audiences', name: 'Audiences' }, { key: 'seasonal', name: 'Seasonal' }] },
  { name: 'Money', skills: [{ key: 'margin-cac', name: 'Margin and CAC' }] },
];

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function buildOrgChart(args: {
  trade?: string;
  fired?: { skill: string; title: string; ts: string; effect?: string }[];
  findings?: { id?: string; skill: string }[];
  lastRunAt?: string | null;
  now?: string;
}): OrgChart {
  const rules = rulesForTrade(args.trade);
  const now = args.now ? Date.parse(args.now) : Date.now();
  const recent = (args.fired ?? []).filter((row) => {
    const ts = Date.parse(row.ts);
    return Number.isFinite(ts) && now - ts <= WEEK_MS && row.effect !== 'reverted';
  });
  const findings = args.findings ?? [];
  const ran = !!args.lastRunAt;
  return {
    head: { name: 'Miles', title: 'Head of Growth', playbook: rules.label },
    departments: DESKS.map((desk) => ({
      name: desk.name,
      skills: desk.skills.map((skill) => {
        const rows = findings.filter((row) => row.skill === skill.key);
        const open = rows.filter((row) => !/-(ok|clear)$/.test(row.id || '')).length;
        return {
          ...skill,
          fired: recent.filter((row) => row.skill === skill.key).length,
          status: !ran ? 'Not run' as const : open > 0 ? 'Findings' as const : 'Clear' as const,
          lastRun: args.lastRunAt ?? null,
          findings: open,
        };
      }),
    })),
    rulesFired: recent.map((row) => ({ skill: row.skill, title: row.title, ts: row.ts })),
  };
}
