import { describe, expect, it } from 'vitest';
import {
  BANDS, bandForSpend, creditState, chargeCredits, WORK_COSTS, billingEnforced,
  canAfford, setAutoTopUp, bandOf, UNLIMITED_ITEMS,
} from '../src/billing/credits.js';
import { MEDIA_KINDS, mediaCost } from '../src/billing/media.js';
import { TARGET_MARGIN } from '../src/billing/cogs.js';

describe('pricing bands (pricing-model-v1)', () => {
  it('locks the three bands at $149/$397/$797 with the doc thresholds', () => {
    expect(bandForSpend(0).monthlyPrice).toBe(149); // zero-spend lands on Starter
    expect(bandForSpend(4999).key).toBe('starter');
    expect(bandForSpend(5000).key).toBe('growth');
    expect(bandForSpend(14999).monthlyPrice).toBe(397);
    expect(bandForSpend(15000).key).toBe('scale');
    expect(bandForSpend(80000).monthlyPrice).toBe(797);
    expect(BANDS.map((b) => b.monthlyCredits)).toEqual([50, 150, 350]);
  });
});

describe('credit metering', () => {
  it('starts on the $100 launch grant', () => {
    const s = creditState({});
    expect(s.granted).toBe(100);
    expect(s.remaining).toBe(100);
    expect(s.launchOffer).toBe(true);
  });

  it('media draws credits; the ledger records them', () => {
    const data: Record<string, unknown> = {};
    chargeCredits(data, 'video', 'Ad clip');
    chargeCredits(data, 'image');
    const s = creditState(data);
    expect(s.spent).toBe(WORK_COSTS.video! + WORK_COSTS.image!);
    expect(s.remaining).toBe(100 - s.spent);
    expect(s.ledger[0]!.item).toBe('image');
  });

  it('monitoring is NEVER metered — unknown items charge nothing', () => {
    const data: Record<string, unknown> = {};
    chargeCredits(data, 'dashboard_view');
    chargeCredits(data, 'metric_pull');
    expect(creditState(data).spent).toBe(0);
  });

  /**
   * The regression this whole change exists for. Video was priced in
   * usage/meter.ts and billed from billing/credits.ts, two tables that never
   * met — so every video was free on every plan and nobody had decided that.
   */
  it('every media kind is billable — none is free by omission', () => {
    for (const kind of MEDIA_KINDS) {
      expect(WORK_COSTS[kind], `${kind} must have a price`).toBeGreaterThan(0);
      const data: Record<string, unknown> = {};
      chargeCredits(data, kind);
      expect(creditState(data).spent, `${kind} must draw credits`).toBeGreaterThan(0);
    }
  });

  it('text work is unlimited — it charges nothing, on purpose', () => {
    const data: Record<string, unknown> = {};
    for (const item of UNLIMITED_ITEMS) chargeCredits(data, item);
    expect(creditState(data).spent).toBe(0);
    // And no unlimited item may quietly reappear in the price table.
    for (const item of UNLIMITED_ITEMS) expect(WORK_COSTS[item]).toBeUndefined();
  });

  it('every priced item clears the target margin against its real cost', () => {
    for (const kind of MEDIA_KINDS) {
      const margin = (WORK_COSTS[kind]! - mediaCost(kind)) / WORK_COSTS[kind]!;
      expect(margin, `${kind} at ${WORK_COSTS[kind]}`).toBeGreaterThanOrEqual(TARGET_MARGIN);
    }
  });

  it('no monitoring item ever appears in the work-cost table', () => {
    for (const k of Object.keys(WORK_COSTS)) {
      expect(k).not.toMatch(/monitor|dashboard|metric|pacing|alert|read$/);
    }
  });

  it('enforcement is OFF by default (ships off, flipped when there are customers)', () => {
    expect(billingEnforced()).toBe(false);
    const data: Record<string, unknown> = { credits: { granted: 0.1, ledger: [] } };
    chargeCredits(data, 'video'); // overdraws
    const after = chargeCredits(data, 'video');
    expect(after.blocked).toBe(false); // not enforced → never blocks
  });

  it('blocks media on an empty balance only when BILLING_ENFORCE=1', () => {
    process.env.BILLING_ENFORCE = '1';
    try {
      const data: Record<string, unknown> = { credits: { granted: 1, ledger: [] } };
      const first = chargeCredits(data, 'video'); // $1.50 > $1 but balance was positive
      expect(first.blocked).toBe(false);
      const second = chargeCredits(data, 'video');
      expect(second.blocked).toBe(true); // balance now empty → paused
      expect(second.reason).toMatch(/upgrade|top.?up/i);
    } finally {
      delete process.env.BILLING_ENFORCE;
    }
  });
});

describe('auto top-up', () => {
  it('is OFF unless the owner explicitly turned it on', () => {
    expect(creditState({}).autoTopUp).toBe(false);
    // A truthy-looking but non-true value must not count as consent.
    expect(creditState({ credits: { autoTopUp: 'yes' } }).autoTopUp).toBe(false);
    const data: Record<string, unknown> = {};
    expect(setAutoTopUp(data, true).autoTopUp).toBe(true);
    expect(setAutoTopUp(data, false).autoTopUp).toBe(false);
  });

  it('does not buy credit for an account that never opted in', () => {
    process.env.BILLING_ENFORCE = '1';
    try {
      const data: Record<string, unknown> = { credits: { granted: 0, ledger: [] } };
      const r = chargeCredits(data, 'video');
      expect(r.blocked).toBe(true);
      expect(r.toppedUp).toBe(0);
      expect(creditState(data).granted).toBe(0); // no money spent on their behalf
    } finally {
      delete process.env.BILLING_ENFORCE;
    }
  });

  it('buys one increment and lets the work through once opted in', () => {
    process.env.BILLING_ENFORCE = '1';
    try {
      const data: Record<string, unknown> = { credits: { granted: 0, ledger: [], autoTopUp: true } };
      const r = chargeCredits(data, 'video');
      expect(r.blocked).toBe(false);
      expect(r.toppedUp).toBe(25); // Starter increment
      expect(creditState(data).topUps).toBe(1);
      expect(creditState(data).remaining).toBe(25 - WORK_COSTS.video!);
    } finally {
      delete process.env.BILLING_ENFORCE;
    }
  });

  it('honours the band when sizing a top-up', () => {
    process.env.BILLING_ENFORCE = '1';
    try {
      const data: Record<string, unknown> = {
        credits: { granted: 0, ledger: [], autoTopUp: true },
        billing: { band: 'scale' },
      };
      expect(bandOf(data).topUp).toBe(100);
      expect(chargeCredits(data, 'video').toppedUp).toBe(100);
    } finally {
      delete process.env.BILLING_ENFORCE;
    }
  });
});

describe('affordability check (pure, no ledger write)', () => {
  it('passes everything while enforcement is off', () => {
    const broke: Record<string, unknown> = { credits: { granted: 0, ledger: [] } };
    expect(canAfford(broke, 'video').ok).toBe(true);
  });

  it('refuses media on an empty balance and says what to do about it', () => {
    process.env.BILLING_ENFORCE = '1';
    try {
      const broke: Record<string, unknown> = { credits: { granted: 0, ledger: [] } };
      const v = canAfford(broke, 'video');
      expect(v.ok).toBe(false);
      expect(v.reason).toMatch(/Growth/); // names the upgrade, not just the refusal
      // Unlimited work is never refused, however empty the balance.
      expect(canAfford(broke, 'skill_run').ok).toBe(true);
    } finally {
      delete process.env.BILLING_ENFORCE;
    }
  });

  it('does not write to the ledger', () => {
    const data: Record<string, unknown> = {};
    canAfford(data, 'video');
    expect(creditState(data).spent).toBe(0);
  });
});
