/**
 * Plans, bands, and credits — the pricing model encoded
 * (docs/business/pricing-model-v1.md). What this implements:
 *
 *   - Bands by trailing-30-day ad spend under management (never a % of spend)
 *   - The launch offer: $0/mo with $100 in credits, hard cap, no expiry
 *   - Credit metering: MONITORING IS NEVER METERED — reads, dashboards,
 *     pacing checks are free. Credits draw only on work items.
 *   - Credits denominated at retail dollars.
 *
 * What this deliberately does NOT do yet: charge a card. There is no
 * payment processor connected, so enforcement is OFF by default (set
 * BILLING_ENFORCE=1 to make an empty balance pause work items). Until
 * then the meter is real accounting, visible in-app, enforcing nothing.
 */

import { claimCostItem } from './costsink.js';

export interface Band {
  key: 'launch' | 'starter' | 'growth' | 'scale';
  name: string;
  monthlyPrice: number;
  spendMin: number; // trailing-30 ad spend lower bound (inclusive)
  spendMax: number | null; // upper bound (exclusive), null = unbounded
  monthlyCredits: number; // retail $ included per month
  topUp: number; // auto top-up increment
}

export const BANDS: Band[] = [
  { key: 'starter', name: 'Starter', monthlyPrice: 149, spendMin: 0, spendMax: 5000, monthlyCredits: 50, topUp: 25 },
  { key: 'growth', name: 'Growth', monthlyPrice: 397, spendMin: 5000, spendMax: 15000, monthlyCredits: 150, topUp: 50 },
  { key: 'scale', name: 'Scale', monthlyPrice: 797, spendMin: 15000, spendMax: null, monthlyCredits: 350, topUp: 100 },
];

/** Which paid band a trailing-30-day spend figure implies. */
export function bandForSpend(spend30: number): Band {
  return BANDS.find((b) => spend30 >= b.spendMin && (b.spendMax === null || spend30 < b.spendMax)) ?? BANDS[0]!;
}

/**
 * Retail credit cost per work item, in dollars.
 *
 * Only media appears here, and that is the whole pricing model:
 *
 *  - TEXT WORK IS UNLIMITED. A skill run costs about $0.0006 of inference and
 *    a campaign build about $0.0015. Rationing them made the product feel
 *    metered while saving nothing, so they are free and uncapped (see
 *    UNLIMITED_ITEMS). An item absent from this table is never charged.
 *
 *  - MEDIA IS METERED, because it is the only thing that costs real money. A
 *    video is roughly a thousand skill runs. Prices are set to clear
 *    TARGET_MARGIN against the vendor costs in MEDIA_COST.
 *
 * Monitoring is absent on purpose and must never appear here.
 */
export const WORK_COSTS: Record<string, number> = {
  video: 1.5, // ~$0.35 to serve — 77% margin
  image: 0.1, // ~$0.0005 to serve — 99% margin
  audio: 0.5, // ~$0.03 to serve — 94% margin
};

/**
 * Work that is deliberately free and unlimited on every band.
 *
 * Listed rather than merely omitted, because "absent from WORK_COSTS" is how
 * video came to be unlimited and free on every plan without anyone deciding
 * that. If an item is here, someone chose it. If it is in neither list, that
 * is a bug, not a free tier.
 */
export const UNLIMITED_ITEMS = [
  'text',
  'campaign_build',
  'campaign_launch',
  'ai_autofill',
  'skill_run',
  'weekly_readout',
  'email_send',
  'audit',
  'agent_design',
  'agent_run',
] as const;

export interface CreditLedgerEntry {
  ts: string;
  item: string;
  cost: number;
  note?: string;
}

export interface CreditState {
  granted: number; // launch offer + monthly bundles credited so far
  spent: number;
  remaining: number;
  ledger: CreditLedgerEntry[]; // newest first, capped
  launchOffer: boolean; // still on the $100 launch grant
  /** Whether an empty balance buys another top-up automatically. OFF by
   *  default and opt-in only: a surprise charge costs more trust than a
   *  paused render costs time. */
  autoTopUp: boolean;
  /** Top-ups bought so far this account, for the ledger and the billing page. */
  topUps: number;
}

const LAUNCH_GRANT = 100;
const LEDGER_CAP = 200; // the page shows 50
/** Ceiling on top-ups bought to satisfy ONE charge. A runaway loop here spends
 *  a customer's money, so it is bounded even though no single item costs
 *  anywhere near a full increment. */
const MAX_AUTO_TOPUPS_PER_CHARGE = 4;

export interface ChargeResult {
  state: CreditState;
  /** True when enforcement is on and the balance could not cover the item. */
  blocked: boolean;
  /** Dollars of top-up bought to let this charge through (0 when none). */
  toppedUp: number;
  /** Plain-English reason, set only when blocked. */
  reason?: string;
}

export function creditState(data: Record<string, unknown>): CreditState {
  const raw = (data.credits ?? {}) as Partial<CreditState> & { ledger?: CreditLedgerEntry[] };
  const ledger = Array.isArray(raw.ledger) ? raw.ledger : [];
  const granted = typeof raw.granted === 'number' ? raw.granted : LAUNCH_GRANT;
  const spent = Math.round(ledger.reduce((a, e) => a + (e.cost || 0), 0) * 100) / 100;
  return {
    granted,
    spent,
    remaining: Math.max(0, Math.round((granted - spent) * 100) / 100),
    ledger,
    launchOffer: raw.launchOffer !== false,
    autoTopUp: raw.autoTopUp === true, // opt-in: anything but an explicit yes is no
    topUps: typeof raw.topUps === 'number' ? raw.topUps : 0,
  };
}

/** The band an account is on, read straight off the stored billing blob.
 *  Read as a plain field rather than imported, because subscription.ts already
 *  imports this module and the cycle is not worth the tidiness. */
export function bandOf(data: Record<string, unknown>): Band {
  const key = (data.billing as { band?: string } | undefined)?.band;
  return BANDS.find((b) => b.key === key) ?? BANDS[0]!;
}

/** Turn automatic top-ups on or off for an account. */
export function setAutoTopUp(data: Record<string, unknown>, on: boolean): CreditState {
  const before = creditState(data);
  data.credits = {
    granted: before.granted,
    ledger: before.ledger,
    launchOffer: before.launchOffer,
    topUps: before.topUps,
    autoTopUp: on,
  };
  return creditState(data);
}

/** Whether an empty balance actually pauses work (no processor → default off). */
export function billingEnforced(): boolean {
  return process.env.BILLING_ENFORCE === '1';
}

/**
 * Draw credits for a work item (mutates `data`). Unknown items are treated
 * as monitoring and never charged. Returns the post-charge state plus
 * whether the item should be BLOCKED (only when enforcement is on and the
 * balance was already empty).
 */
export function chargeCredits(
  data: Record<string, unknown>,
  item: string,
  note?: string,
): ChargeResult {
  const cost = WORK_COSTS[item];
  const before = creditState(data);
  // Not in the table means unlimited — monitoring, and now every text work
  // item. Never charged, never blocked.
  if (!cost) return { state: before, blocked: false, toppedUp: 0 };

  // Cost and revenue land on the same line: whatever this request has spent on
  // inference is what serving this billable item cost.
  claimCostItem(item);

  const band = bandOf(data);
  let granted = before.granted;
  let topUps = before.topUps;
  let toppedUp = 0;

  // Short of the price? Buy top-ups until the balance covers it — but only
  // with the owner's standing consent. Loop rather than add one increment,
  // so a single expensive item can never sit un-payable behind a $25 step.
  if (before.remaining < cost && before.autoTopUp && band.topUp > 0) {
    while (Math.round((granted - before.spent) * 100) / 100 < cost) {
      granted = Math.round((granted + band.topUp) * 100) / 100;
      topUps += 1;
      toppedUp = Math.round((toppedUp + band.topUp) * 100) / 100;
      if (topUps - before.topUps >= MAX_AUTO_TOPUPS_PER_CHARGE) break;
    }
  }

  const remaining = Math.round((granted - before.spent) * 100) / 100;

  // Enforcement is what turns the meter into a wall. Off by default so the
  // accounting can run honestly against real customers before it bites.
  //
  // The test is `<= 0`, not `< cost`: a positive balance always lets the next
  // item through even when it overdraws. Being refused for being twenty cents
  // short mid-render is a worse experience than eating one unit, and one unit
  // is at most $1.50.
  if (billingEnforced() && remaining <= 0) {
    return {
      state: before,
      blocked: true,
      toppedUp: 0,
      reason: before.autoTopUp
        ? `Top-up limit reached. Add credit or upgrade to ${nextBandName(band) ?? 'a larger plan'}.`
        : `Out of credits. Add $${band.topUp.toFixed(2)}, turn on auto top-up, or upgrade to ${nextBandName(band) ?? 'a larger plan'}.`,
    };
  }

  const ledger = [{ ts: new Date().toISOString(), item, cost, note }, ...before.ledger].slice(0, LEDGER_CAP);
  data.credits = {
    granted,
    launchOffer: before.launchOffer,
    autoTopUp: before.autoTopUp,
    topUps,
    ledger,
  };
  return { state: creditState(data), blocked: false, toppedUp };
}

/**
 * Whether an account could pay for one `item` right now — a pure check with no
 * ledger write and no top-up bought.
 *
 * Media is checked BEFORE the vendor call and charged only after a real
 * render, so a refusal spends nothing and a failed render bills nothing. Doing
 * it the other way round would either charge for images that never arrived or
 * pay fal.ai for work we then refuse to hand over.
 */
export function canAfford(data: Record<string, unknown>, item: string): { ok: boolean; reason?: string } {
  const cost = WORK_COSTS[item];
  if (!cost) return { ok: true }; // unlimited
  if (!billingEnforced()) return { ok: true }; // meter runs, wall is off
  const state = creditState(data);
  if (state.remaining > 0) return { ok: true }; // a positive balance always passes
  const band = bandOf(data);
  if (state.autoTopUp && band.topUp > 0) return { ok: true }; // top-up will cover it
  const upgrade = nextBandName(band);
  return {
    ok: false,
    reason:
      `Out of credits. Add $${band.topUp.toFixed(2)}, turn on auto top-up` +
      `${upgrade ? `, or upgrade to ${upgrade}` : ''}.`,
  };
}

/** The band above this one, for the upgrade prompt. Undefined at the top. */
export function nextBandName(band: Band): string | undefined {
  const i = BANDS.findIndex((b) => b.key === band.key);
  return i >= 0 ? BANDS[i + 1]?.name : undefined;
}
