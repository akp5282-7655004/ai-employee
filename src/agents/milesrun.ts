/**
 * What "Start" and a later approval are allowed to do.
 * Automate uses the saved caps as the standing yes.
 * Hybrid queues. Manual does nothing. An explicit approval clears a queue only.
 */
import { decidePolicy, type Caps, type MilesArea, type MilesMode, type PolicyDecision } from './policy.js';

export function resolveDecision(decision: PolicyDecision, explicit: boolean): PolicyDecision {
  if (explicit && decision.effect === 'queue') {
    return { ...decision, effect: 'apply', reason: 'You approved this. It is logged and you can revert it.' };
  }
  return decision;
}

export function planGo(args: {
  mode: MilesMode;
  areaModes?: Partial<Record<MilesArea, MilesMode>>;
  caps: Caps;
  spentToday: number;
  spentMonth: number;
  dailySpend: number;
  /** A yes on the queued create. Does not also enable. */
  explicitCreate?: boolean;
  /** A yes on the queued enable. */
  explicitEnable?: boolean;
}): { create: PolicyDecision; enable: PolicyDecision } {
  const base = {
    mode: args.mode,
    areaModes: args.areaModes,
    caps: args.caps,
    spentToday: args.spentToday,
    spentMonth: args.spentMonth,
  };
  const create = resolveDecision(decidePolicy({
    ...base,
    action: { area: 'ppc', kind: 'create', spend: 0, canPush: true },
  }), !!args.explicitCreate);
  if (create.effect !== 'apply') {
    return {
      create,
      enable: { effect: 'skip', mode: create.mode, reason: 'Enable waits until the paused campaign has been created.' },
    };
  }
  const enable = resolveDecision(decidePolicy({
    ...base,
    action: { area: 'ppc', kind: 'enable', spend: args.dailySpend, canPush: true },
  }), !!args.explicitEnable);
  return { create, enable };
}

export { decidePolicy };
