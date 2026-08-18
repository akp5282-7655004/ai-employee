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

/** Retail credit cost per work item, in dollars. Monitoring items are absent
 *  on purpose — they must never appear here. */
export const WORK_COSTS: Record<string, number> = {
  campaign_build: 2.5, // full campaign build (Google or Meta)
  campaign_launch: 2.5, // live write-chain execution
  ai_autofill: 1.0, // LLM copy generation
  skill_run: 0.5, // one of the seven skills producing a proposal/readout
  weekly_readout: 0.5,
  email_send: 0.25,
  creative_generation: 1.0,
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
}

const LAUNCH_GRANT = 100;
const LEDGER_CAP = 200; // the page shows 50

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
  };
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
export function chargeCredits(data: Record<string, unknown>, item: string, note?: string): { state: CreditState; blocked: boolean } {
  const cost = WORK_COSTS[item];
  const before = creditState(data);
  if (!cost) return { state: before, blocked: false }; // monitoring — never metered
  // Cost and revenue land on the same line: whatever this request has spent on
  // inference is what serving this billable item cost.
  claimCostItem(item);
  if (billingEnforced() && before.remaining <= 0) return { state: before, blocked: true };
  const ledger = [{ ts: new Date().toISOString(), item, cost, note }, ...before.ledger].slice(0, LEDGER_CAP);
  data.credits = { granted: before.granted, launchOffer: before.launchOffer, ledger };
  return { state: creditState(data), blocked: false };
}
