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
  /** Ceiling on auto top-up per calendar month. See BANDS below. */
  autoTopUpCeiling: number;
}

/**
 * The most auto top-up we will buy for an account in one calendar month.
 *
 * Set to the NEXT band's price, because past that point upgrading is genuinely
 * cheaper for them than topping up — so the honest thing is to stop and say
 * so rather than quietly bill it. Margin is not the reason for this cap
 * (top-ups run 77%+); a customer discovering a $30,000 auto-charge is.
 */
export const BANDS: Band[] = [
  { key: 'starter', name: 'Starter', monthlyPrice: 149, spendMin: 0, spendMax: 5000, monthlyCredits: 50, topUp: 25, autoTopUpCeiling: 397 },
  { key: 'growth', name: 'Growth', monthlyPrice: 397, spendMin: 5000, spendMax: 15000, monthlyCredits: 150, topUp: 50, autoTopUpCeiling: 797 },
  { key: 'scale', name: 'Scale', monthlyPrice: 797, spendMin: 15000, spendMax: null, monthlyCredits: 350, topUp: 100, autoTopUpCeiling: 1594 },
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

/**
 * Fair-use ceilings on the unlimited work, per calendar month.
 *
 * "Unlimited" is the promise and stays the promise: these are set roughly ten
 * times what a real account does, so no honest customer meets one. They exist
 * because unlimited-with-no-ceiling is the same class of bug as free video —
 * a loop, a bad retry, or a script turns a $0.0006 item into an unbounded
 * bill, and nothing in the system says stop.
 *
 * Hitting one pauses that item and asks the owner to get in touch. It does not
 * charge credits, because charging for something sold as unlimited is worse
 * than pausing it.
 *
 * At every cap simultaneously this costs about $2.75 a month to serve, which
 * is the point: the ceiling converts an unbounded tail into a rounding error.
 */
export const FAIR_USE: Record<string, number> = {
  text: 2000,
  email_send: 2000,
  skill_run: 500,
  ai_autofill: 500,
  campaign_build: 100,
  campaign_launch: 100,
  audit: 100,
  agent_design: 100,
  agent_run: 500,
  weekly_readout: 50,
};

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
  /** Calendar month the counters below belong to ('YYYY-MM'). */
  period: string;
  /** Dollars of auto top-up bought this month, against the band's ceiling. */
  toppedUpThisMonth: number;
  /** Per-item counts this month, for the fair-use ceilings. */
  usedThisMonth: Record<string, number>;
}

/** The calendar-month key for a date. Matches usage/meter.ts deliberately. */
export function creditPeriod(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
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

export function creditState(data: Record<string, unknown>, now = new Date()): CreditState {
  const raw = (data.credits ?? {}) as Partial<CreditState> & { ledger?: CreditLedgerEntry[] };
  const ledger = Array.isArray(raw.ledger) ? raw.ledger : [];
  const granted = typeof raw.granted === 'number' ? raw.granted : LAUNCH_GRANT;
  // Spend is a running total, NOT the sum of the ledger. The ledger is capped
  // at LEDGER_CAP entries for display, so deriving spend from it meant that
  // past 200 charges the oldest entry dropped off, the total stopped growing,
  // and the balance never depleted — an account could spend forever. Older
  // records with no stored total fall back to the ledger sum, which is the
  // best available answer for them and correct while they are under the cap.
  const spent =
    typeof raw.spent === 'number'
      ? Math.round(raw.spent * 100) / 100
      : Math.round(ledger.reduce((a, e) => a + (e.cost || 0), 0) * 100) / 100;
  // Monthly counters reset by rolling over, never by a scheduled job — a job
  // that fails to run would silently hand someone an unlimited month.
  const period = creditPeriod(now);
  const fresh = raw.period === period;
  return {
    granted,
    spent,
    remaining: Math.max(0, Math.round((granted - spent) * 100) / 100),
    ledger,
    launchOffer: raw.launchOffer !== false,
    autoTopUp: raw.autoTopUp === true, // opt-in: anything but an explicit yes is no
    topUps: typeof raw.topUps === 'number' ? raw.topUps : 0,
    period,
    toppedUpThisMonth: fresh && typeof raw.toppedUpThisMonth === 'number' ? raw.toppedUpThisMonth : 0,
    usedThisMonth: fresh && raw.usedThisMonth && typeof raw.usedThisMonth === 'object' ? raw.usedThisMonth : {},
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
  now = new Date(),
): ChargeResult {
  const before = creditState(data, now);
  const band = bandOf(data);
  const cost = WORK_COSTS[item];
  const fairUse = FAIR_USE[item];

  // Three states, and every action must be in exactly one: priced (media),
  // fair-use capped (the unlimited work), or never metered (monitoring). An
  // action in none of them is a bug, not a free tier.
  if (cost === undefined && fairUse === undefined) {
    return { state: before, blocked: false, toppedUp: 0 };
  }

  const used = (before.usedThisMonth[item] ?? 0) + 1;
  const persist = (patch: Partial<CreditState> & { ledger?: CreditLedgerEntry[] }) => {
    data.credits = {
      granted: patch.granted ?? before.granted,
      spent: patch.spent ?? before.spent,
      launchOffer: before.launchOffer,
      autoTopUp: before.autoTopUp,
      topUps: patch.topUps ?? before.topUps,
      ledger: patch.ledger ?? before.ledger,
      period: before.period,
      toppedUpThisMonth: patch.toppedUpThisMonth ?? before.toppedUpThisMonth,
      usedThisMonth: { ...before.usedThisMonth, [item]: used },
    };
  };

  // ── Unlimited work: free, but not infinite ──
  if (cost === undefined) {
    if (billingEnforced() && used > fairUse!) {
      return {
        state: before,
        blocked: true,
        toppedUp: 0,
        reason:
          `You've hit this month's fair-use limit for ${item.replace(/_/g, ' ')} ` +
          `(${fairUse}). It resets next month — get in touch if you need more.`,
      };
    }
    claimCostItem(item);
    persist({});
    return { state: creditState(data, now), blocked: false, toppedUp: 0 };
  }

  // ── Priced work: media, drawn from credits ──
  // Cost and revenue land on the same line: whatever this request has spent on
  // inference is what serving this billable item cost.
  claimCostItem(item);

  let granted = before.granted;
  let topUps = before.topUps;
  let toppedUpThisMonth = before.toppedUpThisMonth;
  let toppedUp = 0;

  // Short of the price? Buy top-ups until the balance covers it — but only
  // with the owner's standing consent, and never past the month's ceiling.
  if (before.remaining < cost && before.autoTopUp && band.topUp > 0) {
    while (Math.round((granted - before.spent) * 100) / 100 < cost) {
      if (toppedUpThisMonth + band.topUp > band.autoTopUpCeiling) break; // month's ceiling
      granted = Math.round((granted + band.topUp) * 100) / 100;
      topUps += 1;
      toppedUp = Math.round((toppedUp + band.topUp) * 100) / 100;
      toppedUpThisMonth = Math.round((toppedUpThisMonth + band.topUp) * 100) / 100;
      if (topUps - before.topUps >= MAX_AUTO_TOPUPS_PER_CHARGE) break; // per-charge ceiling
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
    const upgrade = nextBandName(band);
    const atCeiling = before.autoTopUp && toppedUpThisMonth + band.topUp > band.autoTopUpCeiling;
    return {
      state: before,
      blocked: true,
      toppedUp: 0,
      reason: atCeiling
        ? `You've reached this month's $${band.autoTopUpCeiling.toFixed(2)} auto top-up limit. ` +
          (upgrade ? `Upgrading to ${upgrade} costs less than topping up further.` : 'Get in touch to raise it.')
        : before.autoTopUp
          ? `Top-up limit reached. Add credit${upgrade ? ` or upgrade to ${upgrade}` : ''}.`
          : `Out of credits. Add $${band.topUp.toFixed(2)}, turn on auto top-up${upgrade ? `, or upgrade to ${upgrade}` : ''}.`,
    };
  }

  const ledger = [{ ts: now.toISOString(), item, cost, note }, ...before.ledger].slice(0, LEDGER_CAP);
  const spent = Math.round((before.spent + cost) * 100) / 100;
  persist({ granted, spent, topUps, toppedUpThisMonth, ledger });
  return { state: creditState(data, now), blocked: false, toppedUp };
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
