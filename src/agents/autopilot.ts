/**
 * The home Miles shows after signup. Proposals only. Rules that can apply a
 * change are off until the owner turns them on. No invented performance numbers.
 */
import { SEVEN_SKILLS, type SkillRun } from '../skills/seven.js';

export interface AutopilotRules {
  enabled: boolean;
  weeklySpendCap: number;
  maxBudgetMovePct: number;
}

export interface InboxCard {
  id: string;
  skill: string;
  title: string;
  why: string;
  cost: string;
  impact: string;
  status: 'pending' | 'approved' | 'rejected' | 'reverted';
  needsApproval: boolean;
}

export interface HealthAlert {
  id: string;
  severity: 'info' | 'warn';
  text: string;
}

export const DEFAULT_RULES: AutopilotRules = { enabled: false, weeklySpendCap: 0, maxBudgetMovePct: 10 };

const CADENCE: Record<string, string> = {
  'search-term-gold-miner': 'weekly',
  'negative-keyword-implementer': 'weekly',
  'loser-pauser': 'daily',
  'budget-shifter': 'daily',
  'spend-pacing-monitor': 'daily',
  'cpl-funnel-reader': 'weekly',
  'channel-comparator': 'weekly',
  'ad-copy-performance-ranker': 'weekly',
  'service-area-audience-builder': 'monthly',
  'seasonality-demand-layer': 'weekly',
  'campaign-launcher': 'when no paused campaign exists',
};

export function skillCards(runs: Pick<SkillRun, 'skill' | 'name' | 'summary' | 'source' | 'status'>[]): InboxCard[] {
  return runs.map((run) => ({
    id: run.skill,
    skill: run.skill,
    title: run.name,
    why: run.source === 'sample' || run.source === 'live' && /sample|not on file|no campaign spend|not exposed/i.test(run.summary)
      ? `${run.summary} Schedule: ${CADENCE[run.skill] || 'weekly'}.`
      : `${run.summary} Schedule: ${CADENCE[run.skill] || 'weekly'}.`,
    cost: 'No spend until you approve a paused create or an enable.',
    impact: run.source === 'sample' ? 'No live numbers yet. This is not a measured result.' : 'Based on data already on this account.',
    status: 'pending' as const,
    needsApproval: run.status === 'needs_approval',
  }));
}

export function judgeAutopilotRule(rules: AutopilotRules, card: InboxCard, movePct: number, weeklySpend: number): { auto: boolean; reason: string } {
  if (!rules.enabled) return { auto: false, reason: 'Autopilot rules are off. Miles waits for Approve.' };
  if (card.skill === 'campaign-launcher' || /enable/i.test(card.title)) {
    return { auto: false, reason: 'Creating or enabling ads always needs an explicit approval.' };
  }
  if (weeklySpend > rules.weeklySpendCap) return { auto: false, reason: 'This week is already at the spend cap you set.' };
  if (Math.abs(movePct) > rules.maxBudgetMovePct) return { auto: false, reason: 'The move is larger than the percent you allowed.' };
  if (card.skill !== 'budget-shifter' && card.skill !== 'loser-pauser') {
    return { auto: false, reason: 'Only pause and budget-shift proposals can auto-apply, and only inside your caps.' };
  }
  return { auto: true, reason: 'Inside the weekly cap and the percent you set. Logged so you can revert it.' };
}

export function morningBrief(args: { spend: number; leads: number; booked: number; pending: number }): { title: string; body: string; empty: boolean } {
  if (args.spend <= 0 && args.leads <= 0 && args.booked <= 0) {
    return { title: 'Morning brief', body: 'No spend, leads, or booked jobs are on file yet. Nothing happened to report.', empty: true };
  }
  return {
    title: 'Morning brief',
    body: `Yesterday on file: $${args.spend} spend, ${args.leads} leads, ${args.booked} booked jobs. ${args.pending} decision${args.pending === 1 ? '' : 's'} waiting.`,
    empty: false,
  };
}

export function healthAlerts(args: {
  google: boolean;
  customerReady: boolean;
  meta: boolean;
  ghl: boolean;
  creditsRemaining: number;
  enforced: boolean;
  daysPerLead: number | null;
  pausedWithoutAd: boolean;
}): HealthAlert[] {
  const out: HealthAlert[] = [];
  if (!args.google) out.push({ id: 'google', severity: 'warn', text: 'Google Ads is not connected.' });
  else if (!args.customerReady) out.push({ id: 'customer', severity: 'warn', text: 'Google is signed in, but no ad customer id is selected.' });
  if (!args.meta) out.push({ id: 'meta', severity: 'info', text: 'Meta Ads is not connected. Pipedream has no verified Meta campaign action, so this stays off.' });
  if (!args.ghl) out.push({ id: 'ghl', severity: 'info', text: 'GoHighLevel is not connected. Follow-up stays a draft.' });
  if (args.enforced && args.creditsRemaining <= 0) out.push({ id: 'credits', severity: 'warn', text: 'Media credits are at zero. Monitoring still runs. Images, voice, and video wait.' });
  if (args.daysPerLead != null && args.daysPerLead >= 14) out.push({ id: 'budget', severity: 'warn', text: `Daily budget is low versus the target cost per lead: about ${args.daysPerLead} days of spend per lead at that target. Not a guarantee.` });
  if (args.pausedWithoutAd) out.push({ id: 'noad', severity: 'warn', text: 'A paused campaign is missing a responsive search ad. Approve a retry of that ad only.' });
  return out;
}

export function checklist(args: { google: boolean; customerReady: boolean; meta: boolean; tiktok: boolean; ghl: boolean; website: boolean }) {
  return [
    { id: 'website', label: 'Website', state: args.website ? 'found' : 'missing', detail: args.website ? 'A website is on the profile.' : 'Paste a website so Miles can read it.' },
    { id: 'google', label: 'Google Ads', state: args.google && args.customerReady ? 'connected' : args.google ? 'signed_in' : 'not_connected', detail: args.google && args.customerReady ? 'Customer id selected.' : args.google ? 'Signed in. Customer id not selected.' : 'Not connected.' },
    { id: 'meta', label: 'Meta Ads', state: 'not_available', detail: 'No verified Pipedream Meta campaign action. A Facebook Page is not an ad account.' },
    { id: 'tiktok', label: 'TikTok Ads', state: args.tiktok ? 'connected' : 'not_connected', detail: args.tiktok ? 'Connected. Creates stay paused until you approve.' : 'Not connected.' },
    { id: 'ghl', label: 'GoHighLevel', state: args.ghl ? 'connected' : 'not_connected', detail: args.ghl ? 'Connected for contact upsert and speed-to-lead drafts.' : 'Not connected. Messages stay drafts.' },
  ];
}

export const SKILL_KEYS = SEVEN_SKILLS.map((s) => s.key);
