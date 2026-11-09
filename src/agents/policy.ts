/**
 * Three ways Miles is allowed to act.
 *
 * Automate: the owner's budget, split, and caps are a standing approval.
 * Miles may create, enable, optimize, and publish inside those caps.
 * Anything over the cap waits.
 * Hybrid: Miles builds the work and always queues it.
 * Manual: Miles never acts. The owner uses the tools.
 *
 * A kill switch stops every mode. A channel with no verified push is held,
 * not pretended.
 */
export type MilesMode = 'automate' | 'hybrid' | 'manual';
export type MilesArea = 'ppc' | 'seo' | 'social' | 'ghl' | 'organic' | 'chat';

export interface Caps {
  /** Dollars Miles may spend today. */
  dailyBudget: number;
  /** Dollars Miles may spend this calendar month. */
  monthlyCeiling: number;
  /** Largest budget move, in percent, Miles may make in one day. */
  maxChangePct: number;
  /** Pause all. Nothing is created, enabled, or published. */
  paused: boolean;
}

export interface PolicyAction {
  area: MilesArea;
  kind: 'create' | 'enable' | 'optimize' | 'publish' | 'respond';
  /** Extra dollars this action would commit today. */
  spend?: number;
  /** Signed percent budget move, when this is an optimization. */
  changePct?: number;
  /** False when no verified Pipedream (or site) push exists. */
  canPush: boolean;
}

export interface PolicyInput {
  mode: MilesMode;
  areaModes?: Partial<Record<MilesArea, MilesMode>>;
  caps: Caps;
  spentToday: number;
  spentMonth: number;
  action: PolicyAction;
}

export type PolicyEffect = 'apply' | 'queue' | 'skip' | 'hold';

export interface PolicyDecision {
  effect: PolicyEffect;
  mode: MilesMode;
  reason: string;
}

/** Conservative until the owner raises them. $20 a day, about a 30-day month, 10% moves. */
export const DEFAULT_CAPS: Caps = {
  dailyBudget: 20,
  monthlyCeiling: 600,
  maxChangePct: 10,
  paused: false,
};

export const AREA_LABELS: Record<MilesArea, string> = {
  ppc: 'PPC campaigns',
  seo: 'SEO pages',
  social: 'Social posts',
  ghl: 'GoHighLevel replies',
  organic: 'Organic marketing',
  chat: 'Website chat',
};

export function modeFor(input: Pick<PolicyInput, 'mode' | 'areaModes' | 'action'>): MilesMode {
  return input.areaModes?.[input.action.area] ?? input.mode;
}

export function decidePolicy(input: PolicyInput): PolicyDecision {
  const mode = modeFor(input);
  if (input.caps.paused) {
    return { effect: 'skip', mode, reason: 'Kill switch is on. Miles is paused. Nothing is created, enabled, or published.' };
  }
  if (mode === 'manual') {
    return { effect: 'skip', mode, reason: 'Manual mode. Miles does not act. You build this yourself.' };
  }
  const pushes = input.action.kind === 'create' || input.action.kind === 'enable' || input.action.kind === 'publish';
  if (pushes && !input.action.canPush) {
    return {
      effect: 'hold',
      mode,
      reason: 'Miles built this. There is no verified way to push it yet, so nothing was sent.',
    };
  }
  if (mode === 'hybrid') {
    return { effect: 'queue', mode, reason: 'Hybrid mode. This waits for your approval before anything is pushed or published.' };
  }
  const spend = Math.max(0, input.action.spend ?? 0);
  if (input.spentMonth + spend > input.caps.monthlyCeiling) {
    return { effect: 'queue', mode, reason: 'This would pass the monthly ceiling you set. It needs your approval.' };
  }
  if (input.spentToday + spend > input.caps.dailyBudget) {
    return { effect: 'queue', mode, reason: 'This would pass the daily budget you set. It needs your approval.' };
  }
  if (input.action.changePct != null && Math.abs(input.action.changePct) > input.caps.maxChangePct) {
    return { effect: 'queue', mode, reason: 'This move is larger than the max percent change per day. It needs your approval.' };
  }
  return { effect: 'apply', mode, reason: 'Inside the daily budget, monthly ceiling, and max percent change you set. Logged so you can revert it.' };
}
