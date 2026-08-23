import { describe, expect, it } from 'vitest';
import { BANDS, WORK_COSTS, FAIR_USE, UNLIMITED_ITEMS, chargeCredits, creditState } from '../src/billing/credits.js';
import { planMargin, SERVE_ASSUMPTIONS, TARGET_MARGIN } from '../src/billing/cogs.js';
import { MEDIA_KINDS, mediaCost } from '../src/billing/media.js';
import { CREDIT_COST } from '../src/usage/meter.js';

/**
 * The margin floor, enforced by the build rather than by anyone's arithmetic.
 *
 * The business runs to 75%. Every number that could break it — a media price,
 * a credit bundle, a plan price, a fair-use ceiling, a cost assumption — is
 * reachable from here, so changing any of them without re-checking the floor
 * fails CI instead of quietly shipping.
 */
const FLOOR = 0.75;

describe('the 75% floor', () => {
  it('holds on every band, worst case', () => {
    for (const band of BANDS) {
      const m = planMargin(band, WORK_COSTS);
      expect(
        m.margin,
        `${band.name} $${band.monthlyPrice}: ${m.worstCaseUnits} ${m.worstCaseKind}s, ` +
          `cost $${m.cost}, margin ${(m.margin * 100).toFixed(1)}%`,
      ).toBeGreaterThanOrEqual(FLOOR);
    }
  });

  it('is the target the rest of the code is checked against', () => {
    expect(TARGET_MARGIN).toBe(FLOOR);
  });

  it('holds per media unit, not just per plan', () => {
    for (const kind of MEDIA_KINDS) {
      const price = WORK_COSTS[kind]!;
      const margin = (price - mediaCost(kind)) / price;
      expect(margin, `${kind} at $${price} vs $${mediaCost(kind)}`).toBeGreaterThanOrEqual(FLOOR);
    }
  });

  /**
   * Auto top-up can only improve margin — it sells more of the same units at
   * the same rate. If that ever stops being true the ceiling logic becomes a
   * margin control rather than a bill-shock control, which is a different
   * design and should not happen silently.
   */
  it('holds even when a customer tops up to the month ceiling', () => {
    for (const band of BANDS) {
      const topped = planMargin(
        { ...band, monthlyCredits: band.monthlyCredits + band.autoTopUpCeiling },
        WORK_COSTS,
      );
      const revenue = band.monthlyPrice + band.autoTopUpCeiling;
      const margin = (revenue - topped.cost) / revenue;
      expect(
        margin,
        `${band.name} topped up to $${band.autoTopUpCeiling}: ${(margin * 100).toFixed(1)}%`,
      ).toBeGreaterThanOrEqual(FLOOR);
    }
  });

  it('states its cost assumptions rather than hiding them', () => {
    // Support is the assumption that actually decides this. If it is ever zero
    // the floor is meaningless, so the guard refuses to pretend.
    expect(SERVE_ASSUMPTIONS.supportPerAccount).toBeGreaterThan(0);
    expect(SERVE_ASSUMPTIONS.infraPerAccount).toBeGreaterThan(0);
    expect(SERVE_ASSUMPTIONS.stripePct).toBeGreaterThan(0);
  });

  /** What actually breaks the floor, documented as a test rather than a comment. */
  it('breaks when support runs long — which is the real risk, not compute', () => {
    const starter = BANDS[0]!;
    const withHeavySupport = { ...SERVE_ASSUMPTIONS, supportPerAccount: 40 }; // 1 hour
    const mediaSpend = starter.monthlyCredits * (mediaCost('video') / WORK_COSTS.video!);
    const cost =
      mediaSpend +
      starter.monthlyPrice * withHeavySupport.stripePct + withHeavySupport.stripeFixed +
      withHeavySupport.infraPerAccount + withHeavySupport.supportPerAccount + withHeavySupport.fairUseWorstCase;
    const margin = (starter.monthlyPrice - cost) / starter.monthlyPrice;
    expect(margin).toBeLessThan(FLOOR); // an hour of support per customer breaks Starter
  });
});

describe('every action has a ceiling', () => {
  it('is priced, fair-use capped, or never metered — never undefined', () => {
    for (const kind of Object.keys(CREDIT_COST)) {
      const priced = WORK_COSTS[kind] !== undefined;
      const capped = FAIR_USE[kind] !== undefined;
      expect(priced || capped, `${kind} has neither a price nor a fair-use cap`).toBe(true);
    }
  });

  it('caps every unlimited item', () => {
    for (const item of UNLIMITED_ITEMS) {
      expect(FAIR_USE[item], `${item} is unlimited with no ceiling`).toBeGreaterThan(0);
    }
  });

  it('costs little even with every fair-use ceiling hit at once', () => {
    // The ceilings exist to bound an unbounded tail, not to save money — this
    // asserts the bound is where we think it is.
    expect(SERVE_ASSUMPTIONS.fairUseWorstCase).toBeLessThan(5);
  });
});

describe('fair-use enforcement', () => {
  const withEnforcement = (fn: () => void) => {
    process.env.BILLING_ENFORCE = '1';
    try { fn(); } finally { delete process.env.BILLING_ENFORCE; }
  };

  it('pauses an unlimited item at its ceiling instead of charging for it', () => {
    withEnforcement(() => {
      const data: Record<string, unknown> = {};
      const cap = FAIR_USE.weekly_readout!;
      for (let i = 0; i < cap; i++) {
        expect(chargeCredits(data, 'weekly_readout').blocked).toBe(false);
      }
      const over = chargeCredits(data, 'weekly_readout');
      expect(over.blocked).toBe(true);
      expect(over.reason).toMatch(/fair.?use/i);
      // Sold as unlimited, so hitting the ceiling must never take credits.
      expect(creditState(data).spent).toBe(0);
    });
  });

  it('never blocks unlimited work while enforcement is off', () => {
    const data: Record<string, unknown> = {};
    for (let i = 0; i < FAIR_USE.weekly_readout! + 10; i++) {
      expect(chargeCredits(data, 'weekly_readout').blocked).toBe(false);
    }
  });

  it('resets on the calendar month rather than by a scheduled job', () => {
    withEnforcement(() => {
      const data: Record<string, unknown> = {};
      const aug = new Date('2026-08-15T00:00:00Z');
      const sep = new Date('2026-09-01T00:00:00Z');
      for (let i = 0; i < FAIR_USE.weekly_readout!; i++) chargeCredits(data, 'weekly_readout', undefined, aug);
      expect(chargeCredits(data, 'weekly_readout', undefined, aug).blocked).toBe(true);
      expect(chargeCredits(data, 'weekly_readout', undefined, sep).blocked).toBe(false);
    });
  });
});

describe('auto top-up ceiling', () => {
  it('stops at the month ceiling instead of billing without limit', () => {
    process.env.BILLING_ENFORCE = '1';
    try {
      const band = BANDS[0]!;
      const data: Record<string, unknown> = { credits: { granted: 0, ledger: [], autoTopUp: true } };
      let toppedUp = 0;
      let blocked = false;
      // Far more video than any ceiling allows.
      for (let i = 0; i < 2000 && !blocked; i++) {
        const r = chargeCredits(data, 'video');
        toppedUp += r.toppedUp;
        blocked = r.blocked;
      }
      expect(blocked, 'must eventually stop').toBe(true);
      expect(toppedUp).toBeLessThanOrEqual(band.autoTopUpCeiling);
      expect(creditState(data).toppedUpThisMonth).toBeLessThanOrEqual(band.autoTopUpCeiling);
    } finally {
      delete process.env.BILLING_ENFORCE;
    }
  });

  it('points at the upgrade, because past the ceiling it is genuinely cheaper', () => {
    for (const band of BANDS.slice(0, -1)) {
      const next = BANDS[BANDS.indexOf(band) + 1]!;
      expect(band.autoTopUpCeiling).toBe(next.monthlyPrice);
    }
  });
});
