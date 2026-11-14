/**
 * One daily read per tenant. The manager routes each finding to one skill,
 * then the mode decides whether it is applied, queued, or only suggested.
 */
import { decidePolicy, type MilesMode } from '../agents/policy.js';
import { rulesForTrade, type SkillRules } from './rules.js';
import { runSkills, type DailyInput, type Finding, type SummaryWriter, type TermJudge } from './skills.js';

export const CREDIT_PAUSE = 'Your free credits are used up. Automation is paused. You can still view your reports and data. Starter is $149, Growth is $397, and Scale is $797.';

const DAY_MS = 20 * 60 * 60 * 1000;

export function dailyDue(lastRunAt: string | null | undefined, now: Date): boolean {
  if (!lastRunAt) return true;
  const then = Date.parse(lastRunAt);
  if (!Number.isFinite(then)) return true;
  return now.getTime() - then >= DAY_MS;
}

export interface DailyResult {
  ran: boolean;
  findings: Finding[];
  rules: SkillRules;
}

export function runDailyRead(input: DailyInput, opts?: { judge?: TermJudge; write?: SummaryWriter }): DailyResult {
  const rules = input.rules ?? rulesForTrade(input.trade);
  return { ran: true, rules, findings: runSkills({ ...input, rules }, rules, opts) };
}

export type LogEffect = 'applied' | 'queued' | 'suggested' | 'paused' | 'reverted';

export interface ChangeEntry {
  id: string;
  ts: string;
  skill: string;
  title: string;
  effect: LogEffect;
  before: string;
  after: string;
  reason: string;
}

export interface GuardInput {
  mode: MilesMode;
  paused: boolean;
  creditsLeft: number;
  dailyBudget: number;
  monthlyCeiling: number;
  maxChangePct: number;
  spentToday: number;
  spentMonth: number;
}

export function guardAction(input: GuardInput, action: NonNullable<Finding['action']>): { effect: LogEffect; reason: string } {
  if (input.paused) {
    return { effect: 'paused', reason: 'Kill switch is on. Miles is paused. Nothing is created, enabled, or published.' };
  }
  if (input.creditsLeft <= 0) {
    return { effect: 'paused', reason: CREDIT_PAUSE };
  }
  const decision = decidePolicy({
    mode: input.mode,
    caps: {
      dailyBudget: input.dailyBudget,
      monthlyCeiling: input.monthlyCeiling,
      maxChangePct: input.maxChangePct,
      paused: false,
    },
    spentToday: input.spentToday,
    spentMonth: input.spentMonth,
    action: {
      area: 'ppc',
      kind: action.kind === 'create' ? 'create' : 'optimize',
      spend: action.spend,
      changePct: action.changePct,
      canPush: true,
    },
  });
  if (input.mode === 'manual' || decision.effect === 'skip') {
    return { effect: 'suggested', reason: 'Manual mode. Miles only suggests this. Nothing was changed.' };
  }
  if (decision.effect === 'queue' || decision.effect === 'hold' || input.mode === 'hybrid') {
    return { effect: 'queued', reason: decision.reason };
  }
  const raises = action.kind === 'create' || (action.changePct ?? 0) > 0 || action.spend > 0;
  if (raises) {
    return { effect: 'queued', reason: 'This is new spend or a budget increase. It waits for your tap.' };
  }
  return { effect: 'applied', reason: 'Inside your budget and caps. Logged so you can revert it. The ad account is updated only when a verified write is connected.' };
}

export function planActions(findings: Finding[], guard: GuardInput, now: string): ChangeEntry[] {
  const entries: ChangeEntry[] = [];
  for (const finding of findings) {
    if (!finding.action) {
      entries.push({
        id: finding.id,
        ts: now,
        skill: finding.skill,
        title: finding.title,
        effect: guard.paused ? 'paused' : guard.creditsLeft <= 0 ? 'paused' : 'suggested',
        before: '',
        after: finding.detail,
        reason: guard.creditsLeft <= 0 ? CREDIT_PAUSE : finding.detail,
      });
      continue;
    }
    const decided = guardAction(guard, finding.action);
    entries.push({
      id: finding.id,
      ts: now,
      skill: finding.skill,
      title: finding.action.title,
      effect: decided.effect,
      before: finding.action.before,
      after: finding.action.after,
      reason: decided.reason,
    });
  }
  return entries;
}

export function revertChange(log: ChangeEntry[], id: string): { ok: boolean; log: ChangeEntry[]; restored: string | null; reason: string } {
  const hit = log.find((row) => row.id === id);
  if (!hit) return { ok: false, log, restored: null, reason: 'That change is not on the log.' };
  if (hit.effect !== 'applied') return { ok: false, log, restored: null, reason: 'Only an applied change can be reverted.' };
  const next = log.map((row) => row.id === id ? { ...row, effect: 'reverted' as const, reason: 'Reverted. The previous value is restored on this log.' } : row);
  return { ok: true, log: next, restored: hit.before, reason: 'Reverted. The previous value is restored on this log.' };
}

export function approveChange(log: ChangeEntry[], id: string): { ok: boolean; log: ChangeEntry[]; reason: string } {
  const hit = log.find((row) => row.id === id);
  if (!hit) return { ok: false, log, reason: 'That change is not on the log.' };
  if (hit.effect !== 'queued') return { ok: false, log, reason: 'That change is not waiting for approval.' };
  const next = log.map((row) => row.id === id ? { ...row, effect: 'applied' as const, reason: 'You approved this. Logged so you can revert it.' } : row);
  return { ok: true, log: next, reason: 'You approved this. Logged so you can revert it.' };
}
