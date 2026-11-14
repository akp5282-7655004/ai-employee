/**
 * Five skills. Each one reads the playbook rules it is given.
 * Math decides the finding. Writing the weekly summary can use an LLM
 * when the caller passes one. The default summary is a template.
 */
import { cplBandForGoal } from '../agents/goalcheck.js';
import type { SkillRules } from './rules.js';

export type SkillKey = 'wasted-spend' | 'negative-keywords' | 'budget-pacing' | 'conversion-tracking' | 'weekly-report';

export interface SkillAction {
  kind: 'optimize' | 'create';
  title: string;
  spend: number;
  changePct?: number;
  before: string;
  after: string;
}

export interface Finding {
  id: string;
  skill: SkillKey;
  title: string;
  detail: string;
  action?: SkillAction;
}

export interface ChannelRow {
  name: string;
  platform: string;
  spend: number;
  conversions: number;
  clicks: number;
}

export interface TermRow {
  term: string;
  spend: number;
  clicks: number;
  conversions: number;
}

export interface DailyInput {
  now: string;
  trade: string;
  rules?: SkillRules;
  monthlyBudget: number;
  spentMonth: number;
  dayOfMonth: number;
  leads: number;
  bookedJobs: number;
  channels: { google: boolean; meta: boolean; gbp: boolean; ghl: boolean };
  campaigns: ChannelRow[];
  searchTerms: TermRow[];
  conversionActions: number;
  callTracking: boolean;
  metaSpend: number | null;
  gbpCalls: number | null;
  ghlLeads: number | null;
}

export type TermJudge = (term: string) => boolean;
export type SummaryWriter = (draft: string) => string;

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

function plain(s: string): string {
  return s.replace(/\u2014/g, ', ').replace(/\u2013/g, '-').replace(/\s{2,}/g, ' ').trim();
}

export function wastedSpend(input: DailyInput, rules: SkillRules): Finding[] {
  const rows = input.campaigns.filter((row) => row.spend >= rules.wastedSpendUsd && row.conversions <= 0);
  if (!input.channels.google && !input.channels.meta) {
    return [{ id: 'wasted-spend-offline', skill: 'wasted-spend', title: 'Wasted spend', detail: 'Google Ads and Meta are not connected, so Miles cannot see spend with no conversions.' }];
  }
  if (!rows.length) {
    return [{ id: 'wasted-spend-clear', skill: 'wasted-spend', title: 'Wasted spend', detail: `No campaign has spent ${money(rules.wastedSpendUsd)} or more with zero conversions.` }];
  }
  return rows.slice(0, 8).map((row) => ({
    id: `wasted-spend-${slug(row.platform + '-' + row.name)}`,
    skill: 'wasted-spend' as const,
    title: `${row.name} spent ${money(row.spend)} with no conversions`,
    detail: plain(`${row.platform === 'facebook' ? 'Meta' : 'Google Ads'} campaign ${row.name} is past the playbook threshold of ${money(rules.wastedSpendUsd)} with zero conversions.`),
    action: {
      kind: 'optimize' as const,
      title: `Pause ${row.name}`,
      spend: 0,
      changePct: 0,
      before: `${row.name} enabled`,
      after: `${row.name} paused`,
    },
  }));
}

export function negativeKeywords(input: DailyInput, rules: SkillRules, judge?: TermJudge): Finding[] {
  if (!input.channels.google) {
    return [{ id: 'negative-keywords-offline', skill: 'negative-keywords', title: 'Negative keywords', detail: 'Google Ads is not connected, so Miles cannot mine search terms.' }];
  }
  const hits = input.searchTerms.filter((row) => {
    const text = row.term.toLowerCase();
    const junk = rules.junkTerms.some((word) => word && text.includes(word.toLowerCase()));
    const spent = row.spend >= rules.negativeSpendUsd && row.conversions <= 0;
    if (junk || spent) return true;
    return judge ? judge(row.term) : false;
  });
  if (!hits.length) {
    return [{ id: 'negative-keywords-clear', skill: 'negative-keywords', title: 'Negative keywords', detail: 'No search term matched the playbook junk list or the spend threshold.' }];
  }
  const terms = hits.slice(0, 12).map((row) => row.term);
  return [{
    id: 'negative-keywords-add',
    skill: 'negative-keywords',
    title: `${terms.length} negative keyword${terms.length === 1 ? '' : 's'} from search terms`,
    detail: plain(`Playbook junk list and a ${money(rules.negativeSpendUsd)} spend threshold with zero conversions. Terms: ${terms.join(', ')}.`),
    action: {
      kind: 'optimize',
      title: `Add negatives: ${terms.join(', ')}`,
      spend: 0,
      changePct: 0,
      before: 'No new negatives',
      after: terms.join(', '),
    },
  }];
}

export function budgetPacing(input: DailyInput, rules: SkillRules): Finding[] {
  if (!(input.monthlyBudget > 0)) {
    return [{ id: 'budget-pacing-none', skill: 'budget-pacing', title: 'Budget pacing', detail: 'No monthly budget is saved, so Miles cannot pace daily spend.' }];
  }
  const day = Math.min(30, Math.max(1, input.dayOfMonth || 1));
  const expected = input.monthlyBudget * (day / 30);
  const aheadLine = expected * (1 + rules.pacingAheadPct / 100);
  const behindLine = expected * (1 - rules.pacingBehindPct / 100);
  if (input.spentMonth > aheadLine) {
    return [{
      id: 'budget-pacing-ahead',
      skill: 'budget-pacing',
      title: 'Spend is ahead of the monthly budget',
      detail: plain(`Spent ${money(input.spentMonth)} by day ${day}. Even pace for ${money(input.monthlyBudget)} is about ${money(expected)}. The playbook flags anything more than ${rules.pacingAheadPct}% ahead.`),
      action: {
        kind: 'optimize',
        title: 'Lower today\'s budget to get back on pace',
        spend: 0,
        changePct: -rules.pacingAheadPct,
        before: `Spent ${money(input.spentMonth)}`,
        after: 'Daily budget lowered to the even pace',
      },
    }];
  }
  if (day > 3 && input.spentMonth < behindLine) {
    return [{
      id: 'budget-pacing-behind',
      skill: 'budget-pacing',
      title: 'Spend is behind the monthly budget',
      detail: plain(`Spent ${money(input.spentMonth)} by day ${day}. Even pace is about ${money(expected)}. Raising the budget is new spend, so it waits for your tap.`),
      action: {
        kind: 'optimize',
        title: 'Raise today\'s budget toward the monthly plan',
        spend: 0,
        changePct: rules.pacingAheadPct,
        before: `Spent ${money(input.spentMonth)}`,
        after: 'Daily budget raised toward the monthly plan',
      },
    }];
  }
  return [{ id: 'budget-pacing-ok', skill: 'budget-pacing', title: 'Budget pacing', detail: plain(`Spent ${money(input.spentMonth)} of ${money(input.monthlyBudget)}. That is on pace for day ${day}.`) }];
}

export function conversionTracking(input: DailyInput): Finding[] {
  if (!input.channels.google && !input.channels.ghl) {
    return [{ id: 'conversion-tracking-offline', skill: 'conversion-tracking', title: 'Conversion tracking', detail: 'Google Ads and GoHighLevel are not connected, so Miles cannot check conversion tracking.' }];
  }
  const conversions = input.campaigns.reduce((sum, row) => sum + (row.conversions || 0), 0);
  if (input.conversionActions > 0 || input.callTracking || conversions > 0) {
    return [{ id: 'conversion-tracking-ok', skill: 'conversion-tracking', title: 'Conversion tracking', detail: 'Miles can see conversions or call tracking on this account.' }];
  }
  return [{
    id: 'conversion-tracking-missing',
    skill: 'conversion-tracking',
    title: 'Conversion tracking looks missing',
    detail: 'This account has no conversion actions and no call tracking. Miles can still read spend. Leads and cost per lead stay incomplete until tracking is connected.',
  }];
}

export function weeklyReport(input: DailyInput, findings: Finding[], write?: SummaryWriter): Finding {
  const spend = input.campaigns.reduce((sum, row) => sum + (row.spend || 0), 0);
  const band = cplBandForGoal(input.trade, 'google_ads');
  const conversions = input.campaigns.reduce((sum, row) => sum + (row.conversions || 0), 0);
  const cpl = conversions > 0 ? spend / conversions : null;
  const actions = findings.filter((row) => row.action);
  const parts = [
    `${input.trade || 'This account'} for the week.`,
    `Spend on file is ${money(spend)}. Leads ${input.leads}. Booked jobs ${input.bookedJobs}.`,
    actions.length ? `Miles prepared ${actions.length} change${actions.length === 1 ? '' : 's'}.` : 'Miles found no account changes to make.',
  ];
  if (band) parts.push(`Published cost per lead for this check is ${money(band.low)} to ${money(band.high)}.`);
  if (cpl != null && band && cpl > band.high) parts.push(`Cost per lead on file is ${money(cpl)}, above that range.`);
  else if (cpl == null && spend > 0) parts.push('Cost per lead is not tracked yet because no conversions are on file.');
  if (input.channels.meta && input.metaSpend != null) parts.push(`Meta spend on file is ${money(input.metaSpend)}.`);
  if (input.channels.gbp && input.gbpCalls != null) parts.push(`Google Business Profile calls on file: ${input.gbpCalls}.`);
  if (input.channels.ghl && input.ghlLeads != null) parts.push(`GoHighLevel leads on file: ${input.ghlLeads}.`);
  const draft = plain(parts.join(' '));
  const detail = plain(write ? write(draft) : draft);
  return { id: 'weekly-report', skill: 'weekly-report', title: 'Weekly report', detail };
}

export function runSkills(input: DailyInput, rules: SkillRules, opts?: { judge?: TermJudge; write?: SummaryWriter }): Finding[] {
  const wasted = wastedSpend(input, rules);
  const negatives = negativeKeywords(input, rules, opts?.judge);
  const pacing = budgetPacing(input, rules);
  const tracking = conversionTracking(input);
  const report = weeklyReport(input, [...wasted, ...negatives, ...pacing, ...tracking], opts?.write);
  return [...wasted, ...negatives, ...pacing, ...tracking, report];
}
