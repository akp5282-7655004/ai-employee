import { describe, expect, it } from 'vitest';
import { BANDS, bandForSpend, creditState, chargeCredits, WORK_COSTS, billingEnforced } from '../src/billing/credits.js';

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

  it('work items draw credits; the ledger records them', () => {
    const data: Record<string, unknown> = {};
    chargeCredits(data, 'campaign_launch', 'Google Ads — Test');
    chargeCredits(data, 'skill_run');
    const s = creditState(data);
    expect(s.spent).toBe(WORK_COSTS.campaign_launch! + WORK_COSTS.skill_run!);
    expect(s.remaining).toBe(100 - s.spent);
    expect(s.ledger[0]!.item).toBe('skill_run');
  });

  it('monitoring is NEVER metered — unknown items charge nothing', () => {
    const data: Record<string, unknown> = {};
    chargeCredits(data, 'dashboard_view');
    chargeCredits(data, 'metric_pull');
    expect(creditState(data).spent).toBe(0);
  });

  it('no monitoring item ever appears in the work-cost table', () => {
    for (const k of Object.keys(WORK_COSTS)) {
      expect(k).not.toMatch(/monitor|dashboard|metric|pacing|alert|read$/);
    }
  });

  it('enforcement is OFF by default (no payment processor connected)', () => {
    expect(billingEnforced()).toBe(false);
    const data: Record<string, unknown> = { credits: { granted: 0.1, ledger: [] } };
    chargeCredits(data, 'campaign_launch'); // overdraws
    const after = chargeCredits(data, 'campaign_launch');
    expect(after.blocked).toBe(false); // not enforced → never blocks
  });

  it('blocks work items on empty balance only when BILLING_ENFORCE=1', () => {
    process.env.BILLING_ENFORCE = '1';
    try {
      const data: Record<string, unknown> = { credits: { granted: 1, ledger: [] } };
      const first = chargeCredits(data, 'campaign_launch'); // 2.50 > 1 but balance was positive
      expect(first.blocked).toBe(false);
      const second = chargeCredits(data, 'campaign_launch');
      expect(second.blocked).toBe(true); // balance now empty → paused
    } finally {
      delete process.env.BILLING_ENFORCE;
    }
  });
});
