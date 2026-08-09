import { describe, expect, it } from 'vitest';
import { parseIntake, type Intake } from '../src/intake.js';
import { planCampaign } from '../src/plan/planner.js';
import { featuredServices } from '../src/plan/copy.js';

const basePlumbing = {
  businessName: 'Rapid Response Plumbing',
  vertical: 'home_services',
  category: 'plumbing',
  services: ['drain cleaning', 'water heater', 'sewer line', 'faucet repair'],
  serviceArea: { cities: ['Chicago'] },
  monthlyBudget: 3000,
  goal: 'more_calls' as const,
  emergency: true,
  licensing: { licenseNumber: 'IL-055', licensedStates: ['IL'], yearsInBusiness: 14, insured: true },
  wantMoreOf: ['sewer line'],
  wantLessOf: ['faucet repair'],
};

describe('intake validation', () => {
  it('accepts a valid intake and defaults the vertical', () => {
    const i = parseIntake({ businessName: 'X', category: 'hvac', services: ['ac repair'], monthlyBudget: 2000 });
    expect(i.vertical).toBe('home_services');
    expect(i.emergency).toBe(false);
  });

  it('rejects a category that does not belong to the vertical', () => {
    expect(() =>
      parseIntake({ businessName: 'X', vertical: 'dental', category: 'plumbing', services: ['x'], monthlyBudget: 1000 }),
    ).toThrow(/Unknown category/);
  });
});

describe('planCampaign', () => {
  it('allocates the whole budget across paid channels and keeps the profile free', () => {
    const plan = planCampaign(parseIntake(basePlumbing));
    const profile = plan.allocations.find((a) => a.channel === 'managed_profile')!;
    expect(profile.monthlyBudget).toBe(0);
    const paidTotal = plan.allocations.reduce((s, a) => s + a.monthlyBudget, 0);
    expect(paidTotal).toBeGreaterThan(basePlumbing.monthlyBudget * 0.97);
    expect(paidTotal).toBeLessThanOrEqual(basePlumbing.monthlyBudget);
    expect(plan.drafts.length).toBeGreaterThan(0);
  });

  it('features want-more-of first and drops want-less-of', () => {
    const feat = featuredServices(parseIntake(basePlumbing));
    expect(feat[0]).toBe('sewer line');
    expect(feat).not.toContain('faucet repair');
  });

  it('every generated draft passes its claims check', () => {
    const plan = planCampaign(parseIntake(basePlumbing));
    expect(plan.drafts.every((d) => d.claims.ok)).toBe(true);
  });

  it('produces a vertical-appropriate mix: dental leads with Search, plumbing with LSA', () => {
    const hs = planCampaign(parseIntake({ ...basePlumbing, monthlyBudget: 5000 }));
    const dnIntake: Intake = parseIntake({
      businessName: 'Bright Smiles',
      vertical: 'dental',
      category: 'general',
      services: ['cleanings', 'crowns'],
      monthlyBudget: 5000,
      goal: 'more_calls',
    });
    const dn = planCampaign(dnIntake);
    const lead = (p: typeof hs) => p.allocations.filter((a) => a.monthlyBudget > 0)[0]!.channel;
    expect(lead(hs)).toBe('lsa');
    expect(lead(dn)).toBe('search');
  });
});
