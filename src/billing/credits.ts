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
 * Enforcement is on for a production deploy unless BILLING_ENFORCE=0.
 * Local tests and dev stay off unless BILLING_ENFORCE=1.
 * Auto top-up records a pending charge. Credits are added only after
 * settleTopUp sees a succeeded payment id.
 */

import { claimCostItem } from './costsink.js';
import { textQuote } from './textprice.js';

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
 * Media has a fixed retail price. Text, chat, campaign builds, audits,
 * skills, and agent runs are priced per run from OpenRouter tokens
 * (see textprice.ts) at a 75% margin. Monitoring is absent on purpose
 * and must never appear here.
 */
export const WORK_COSTS: Record<string, number> = {
  video: 1.5, // ~$0.35 to serve — 77% margin
  image: 0.1, // ~$0.0005 to serve — 99% margin
  audio: 0.5, // ~$0.03 to serve — 94% margin
};

/**
 * Text work billed from the credit balance. Kept as a named list so a new
 * caller cannot become free by being omitted from WORK_COSTS.
 * UNLIMITED_ITEMS stays empty: nothing in this list is free.
 */
export const TEXT_ITEMS = [
  'text',
  'chat',
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

export const UNLIMITED_ITEMS = [] as const;

/**
 * Work that produces output, priced or not — everything in WORK_COSTS plus
 * everything in TEXT_ITEMS.
 *
 * This is the line an empty balance stops at. Unpriced output is still output:
 * it costs tokens to generate, so it is free as part of a paid plan, not free
 * to an account that has run its plan out and declined to top up.
 *
 * Monitoring is deliberately in neither table and so is never gated. An
 * account whose credits ran out still has ad spend running, and the one thing
 * worse than pausing their work is quietly stopping watching their money.
 */
export function isOutputWork(item: string): boolean {
  return WORK_COSTS[item] !== undefined || (TEXT_ITEMS as readonly string[]).includes(item);
}

/**
 * Fair-use ceilings on the unlimited work, per calendar month.
 *
 * Abuse ceilings on text work, per calendar month. Each run still draws
 * credits. The ceiling stops a loop from burning the balance in one day.
 *
 * At every cap simultaneously this costs about $2.75 a month to serve, which
 * is the point: the ceiling converts an unbounded tail into a rounding error.
 */
export const FAIR_USE: Record<string, number> = {
  text: 2000,
  chat: 2000,
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
  /** A card charge that has not granted credits yet. */
  pendingTopUp?: { status: 'awaiting_payment' | 'failed' | 'succeeded' | 'declined'; amount: number; paymentId?: string; detail?: string } | null;
}

/** The calendar-month key for a date. Matches usage/meter.ts deliberately. */
export function creditPeriod(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export const LAUNCH_GRANT = 100;
export const LAUNCH_OFFER_ACCOUNTS = 100;
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
      ? Math.round(raw.spent * 1e6) / 1e6
      : Math.round(ledger.reduce((a, e) => a + (e.cost || 0), 0) * 1e6) / 1e6;
  // Monthly counters reset by rolling over, never by a scheduled job — a job
  // that fails to run would silently hand someone an unlimited month.
  const period = creditPeriod(now);
  const fresh = raw.period === period;
  return {
    granted,
    spent,
    remaining: Math.max(0, Math.round((granted - spent) * 1e6) / 1e6),
    ledger,
    launchOffer: raw.launchOffer !== false,
    autoTopUp: raw.autoTopUp === true, // opt-in: anything but an explicit yes is no
    topUps: typeof raw.topUps === 'number' ? raw.topUps : 0,
    period,
    toppedUpThisMonth: fresh && typeof raw.toppedUpThisMonth === 'number' ? raw.toppedUpThisMonth : 0,
    usedThisMonth: fresh && raw.usedThisMonth && typeof raw.usedThisMonth === 'object' ? raw.usedThisMonth : {},
    pendingTopUp: raw.pendingTopUp && typeof raw.pendingTopUp === 'object' ? raw.pendingTopUp : null,
  };
}

/**
 * The ONLY place that writes `data.credits`. Every field is carried forward
 * from the current state unless the patch names it, so a caller that cares
 * about one field cannot silently drop the other eight.
 *
 * That is not hypothetical. `data.credits` is a free-form blob, so a writer
 * that rebuilt it by hand kept the fields its author had in mind and erased
 * the rest. A subscription renewal rebuilt it with three, which reset `spent`
 * to zero — and since `spent` falls back to the ledger sum, which is capped
 * at LEDGER_CAP entries, that silently re-opened the spend-forever hole the
 * running total exists to close. It also switched off the customer's auto
 * top-up and cleared the month's fair-use counters.
 *
 * `??` rather than `||`: `false`, `0` and `''` are real values to patch in
 * here and must not fall through to the previous one.
 */
export function writeCredits(
  data: Record<string, unknown>,
  patch: Partial<Omit<CreditState, 'remaining'>> = {},
  now = new Date(),
): CreditState {
  const before = creditState(data, now);
  const prev = (data.credits ?? {}) as CreditState & { baseGranted?: number; baseSpent?: number };
  const baseGranted = typeof prev.baseGranted === 'number' ? prev.baseGranted : before.granted;
  const baseSpent = typeof prev.baseSpent === 'number' ? prev.baseSpent : before.spent;
  data.credits = {
    granted: patch.granted ?? before.granted,
    spent: patch.spent ?? before.spent,
    ledger: patch.ledger ?? before.ledger,
    launchOffer: patch.launchOffer ?? before.launchOffer,
    autoTopUp: patch.autoTopUp ?? before.autoTopUp,
    topUps: patch.topUps ?? before.topUps,
    period: patch.period ?? before.period,
    toppedUpThisMonth: patch.toppedUpThisMonth ?? before.toppedUpThisMonth,
    usedThisMonth: patch.usedThisMonth ?? before.usedThisMonth,
    pendingTopUp: patch.pendingTopUp !== undefined ? patch.pendingTopUp : before.pendingTopUp,
    baseGranted,
    baseSpent,
  };
  return creditState(data, now);
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
  return writeCredits(data, { autoTopUp: on });
}

/**
 * Production enforces an empty balance. Set BILLING_ENFORCE=0 to turn the
 * wall off (a local demo). Set BILLING_ENFORCE=1 to enforce outside production.
 * Render sets RENDER, which counts as production even if NODE_ENV is unset.
 */
export function billingEnforced(): boolean {
  const v = (process.env.BILLING_ENFORCE ?? '').trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'off') return false;
  if (v === '1' || v === 'true' || v === 'on') return true;
  return process.env.NODE_ENV === 'production' || !!process.env.RENDER;
}

export interface TopUpSettlement {
  grantedNow: number;
  status: 'succeeded' | 'failed' | 'declined' | 'duplicate';
  detail: string;
}

/** Add credits only after a payment id is confirmed. A repeat id grants nothing. */
export function settleTopUp(
  data: Record<string, unknown>,
  args: { paymentId: string; amount: number; status: 'succeeded' | 'failed'; detail?: string },
  now = new Date(),
): TopUpSettlement {
  const before = creditState(data, now);
  const billing = (data.billing ?? {}) as { grantAmounts?: Record<string, number>; grantKeys?: string[]; baseInvoices?: string[] };
  const amounts = billing.grantAmounts ?? {};
  if (!billing.baseInvoices) billing.baseInvoices = [...((billing.grantKeys ?? []))];
  if (amounts[args.paymentId] != null || (billing.grantKeys ?? []).includes(args.paymentId)) {
    return { grantedNow: 0, status: 'duplicate', detail: 'This payment was already applied.' };
  }
  if (args.status !== 'succeeded') {
    writeCredits(data, { pendingTopUp: { status: 'failed', amount: args.amount, paymentId: args.paymentId, detail: args.detail || 'The card charge failed. No credits were added.' } }, now);
    data.billing = billing;
    return { grantedNow: 0, status: 'failed', detail: 'The card charge failed. No credits were added.' };
  }
  const band = bandOf(data);
  if (before.toppedUpThisMonth + args.amount > band.autoTopUpCeiling + 0.001) {
    writeCredits(data, { pendingTopUp: { status: 'declined', amount: args.amount, paymentId: args.paymentId, detail: `This month's auto top-up ceiling is $${band.autoTopUpCeiling.toFixed(2)}.` } }, now);
    data.billing = billing;
    return { grantedNow: 0, status: 'declined', detail: `This month's auto top-up ceiling is $${band.autoTopUpCeiling.toFixed(2)}. No credits were added.` };
  }
  billing.grantAmounts = { ...amounts, [args.paymentId]: args.amount };
  billing.grantKeys = [...(billing.grantKeys ?? []), args.paymentId].slice(-5000);
  data.billing = billing;
  writeCredits(data, {
    granted: Math.round((before.granted + args.amount) * 100) / 100,
    topUps: before.topUps + 1,
    toppedUpThisMonth: Math.round((before.toppedUpThisMonth + args.amount) * 100) / 100,
    pendingTopUp: { status: 'succeeded', amount: args.amount, paymentId: args.paymentId },
  }, now);
  return { grantedNow: args.amount, status: 'succeeded', detail: `Added $${args.amount.toFixed(2)} after payment ${args.paymentId}.` };
}

/**
 * Draw credits for a work item (mutates `data`). Unknown items are treated
 * as monitoring and never charged. Returns the post-charge state plus
 * whether the item should be BLOCKED (only when enforcement is on and the
 * balance was already empty).
 */
export interface TokenUse {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  /** Measured OpenRouter dollars for this call. Wins over a token estimate. */
  serveUsd?: number;
}

function addOpenRouter(data: Record<string, unknown>, serveUsd: number): void {
  if (!(serveUsd > 0)) return;
  const prev = typeof data.openRouterCostUsd === 'number' ? data.openRouterCostUsd : 0;
  data.openRouterCostUsd = Math.round((prev + serveUsd) * 1e6) / 1e6;
}

export function chargeCredits(
  data: Record<string, unknown>,
  item: string,
  note?: string,
  now = new Date(),
  usage?: TokenUse,
): ChargeResult {
  const before = creditState(data, now);
  const band = bandOf(data);
  const quote = (TEXT_ITEMS as readonly string[]).includes(item) ? textQuote(item, usage) : null;
  const cost = WORK_COSTS[item] ?? (quote && quote.retailUsd > 0 ? quote.retailUsd : undefined);
  const fairUse = FAIR_USE[item];

  // Priced (media or text), fair-use capped, or never metered (monitoring).
  if (cost === undefined && fairUse === undefined) {
    return { state: before, blocked: false, toppedUp: 0 };
  }

  const used = (before.usedThisMonth[item] ?? 0) + 1;
  const persist = (patch: Partial<Omit<CreditState, 'remaining'>>) => {
    writeCredits(data, { ...patch, usedThisMonth: { ...before.usedThisMonth, [item]: used } }, now);
  };

  if (fairUse !== undefined && billingEnforced() && used > fairUse) {
    return {
      state: before,
      blocked: true,
      toppedUp: 0,
      reason:
        `You've hit this month's fair-use limit for ${item.replace(/_/g, ' ')} ` +
        `(${fairUse}). It resets next month. Get in touch if you need more.`,
    };
  }

  if (cost === undefined) {
    claimCostItem(item);
    persist({});
    return { state: creditState(data, now), blocked: false, toppedUp: 0 };
  }

  claimCostItem(item);

  let granted = before.granted;
  let topUps = before.topUps;
  let toppedUpThisMonth = before.toppedUpThisMonth;
  const toppedUp = 0;

  // Short of the price and the owner opted into auto top-up: do not invent
  // credits. A later confirmed payment is the only thing that grants them.
  if (before.remaining < cost && before.autoTopUp && band.topUp > 0) {
    const amount = band.topUp;
    const atCeiling = before.toppedUpThisMonth + amount > band.autoTopUpCeiling;
    writeCredits(data, {
      pendingTopUp: {
        status: atCeiling ? 'declined' : 'awaiting_payment',
        amount,
        detail: atCeiling
          ? `This month's auto top-up ceiling is $${band.autoTopUpCeiling.toFixed(2)}. No credits were added.`
          : `Auto top-up of $${amount.toFixed(2)} is waiting for a successful card charge. No credits were added.`,
      },
    }, now);
    return {
      state: creditState(data, now),
      blocked: true,
      toppedUp: 0,
      reason: atCeiling
        ? `This month's auto top-up ceiling is $${band.autoTopUpCeiling.toFixed(2)}. No credits were added.`
        : `Auto top-up of $${amount.toFixed(2)} is waiting for a successful card charge. No credits were added.`,
    };
  }

  const remaining = Math.round((granted - before.spent) * 1e6) / 1e6;

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
          : `Out of credits. Automation is paused. You can still view your reports and data. Add $${band.topUp.toFixed(2)}, turn on auto top-up${upgrade ? `, or upgrade to ${upgrade}` : ''}.`,
    };
  }

  if (quote?.serveUsd) addOpenRouter(data, quote.serveUsd);
  const ledger = [{ ts: now.toISOString(), item, cost, note }, ...before.ledger].slice(0, LEDGER_CAP);
  const spent = Math.round((before.spent + cost) * 1e6) / 1e6;
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
  if (!isOutputWork(item)) return { ok: true }; // monitoring — never gated
  if (!billingEnforced()) return { ok: true }; // meter runs, wall is off
  const state = creditState(data);
  if (state.remaining > 0) return { ok: true }; // a positive balance always passes
  const band = bandOf(data);
  // A pending card charge is not credits. Work waits until the payment succeeds.
  const upgrade = nextBandName(band);
  return {
    ok: false,
    reason:
      `Out of credits. Automation is paused. You can still view your reports and data. Add $${band.topUp.toFixed(2)}, turn on auto top-up` +
      `${upgrade ? `, or upgrade to ${upgrade}` : ''}.`,
  };
}

/** The band above this one, for the upgrade prompt. Undefined at the top. */
export function nextBandName(band: Band): string | undefined {
  const i = BANDS.findIndex((b) => b.key === band.key);
  return i >= 0 ? BANDS[i + 1]?.name : undefined;
}
