/**
 * Skills and playbooks as an org chart. Miles sits at the top.
 * A department appears only when a skill on this desk exists in code.
 */
import { rulesForTrade } from './rules.js';

export interface OrgSkill {
  key: string;
  name: string;
  fired: number;
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
];

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function buildOrgChart(args: {
  trade?: string;
  fired?: { skill: string; title: string; ts: string; effect?: string }[];
  now?: string;
}): OrgChart {
  const rules = rulesForTrade(args.trade);
  const now = args.now ? Date.parse(args.now) : Date.now();
  const recent = (args.fired ?? []).filter((row) => {
    const ts = Date.parse(row.ts);
    return Number.isFinite(ts) && now - ts <= WEEK_MS && row.effect !== 'reverted';
  });
  return {
    head: { name: 'Miles', title: 'Head of Growth', playbook: rules.label },
    departments: DESKS.map((desk) => ({
      name: desk.name,
      skills: desk.skills.map((skill) => ({
        ...skill,
        fired: recent.filter((row) => row.skill === skill.key).length,
      })),
    })),
    rulesFired: recent.map((row) => ({ skill: row.skill, title: row.title, ts: row.ts })),
  };
}
