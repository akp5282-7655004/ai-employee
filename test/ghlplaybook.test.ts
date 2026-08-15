import { describe, expect, it } from 'vitest';
import { buildGhlPlaybook } from '../src/agents/ghlplaybook.js';

describe('buildGhlPlaybook', () => {
  it('returns all 32 recipes across the eight sections', () => {
    const pb = buildGhlPlaybook({ business: 'Philly Roofing Co', trade: 'Roofing' });
    expect(pb.recipes.length).toBe(32);
    expect(pb.sections.length).toBe(8);
    expect(pb.recipes.every((r) => r.trigger && r.steps.length > 0)).toBe(true);
  });

  it('tailors [Company] and [service] to the business and trade', () => {
    const pb = buildGhlPlaybook({ business: 'Philly Roofing Co', trade: 'Roofing' });
    const r2 = pb.recipes.find((r) => r.n === 2)!; // missed-call text-back
    expect(r2.steps.join(' ')).toContain('Philly Roofing Co');
    expect(r2.steps.join(' ')).not.toContain('[Company]');
    const r5 = pb.recipes.find((r) => r.n === 5)!;
    expect(r5.steps.join(' ').toLowerCase()).toContain('roofing');
  });

  it('flags the recipes Miles runs natively', () => {
    const pb = buildGhlPlaybook({ trade: 'HVAC' });
    expect(pb.milesRunsCount).toBeGreaterThan(0);
    expect(pb.recipes.find((r) => r.n === 1)!.milesRuns).toBe(true); // speed to lead
    expect(pb.recipes.find((r) => r.n === 14)!.milesRuns).toBe(true); // review request
    expect(pb.recipes.find((r) => r.n === 3)!.milesRuns).toBeFalsy(); // web chat bridge — not native
  });

  it('sets a build order and trade-specific season', () => {
    expect(buildGhlPlaybook({ trade: 'Roofing' }).season.peak).toMatch(/storm/i);
    expect(buildGhlPlaybook({ trade: 'HVAC' }).season.peak).toMatch(/AC|heat/i);
    const bo = buildGhlPlaybook({ trade: 'Plumbing' }).buildOrder;
    expect(bo[0]!.recipes).toContain(2); // week 1 leads with missed-call text-back
  });

  it('falls back cleanly with no business/trade', () => {
    const pb = buildGhlPlaybook({});
    expect(pb.recipes.length).toBe(32);
    expect(pb.business).toBe('your company');
  });
});
