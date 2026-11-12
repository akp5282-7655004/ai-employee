import { describe, expect, it } from 'vitest';
import { buildMetaCampaignSpec, validateMetaCampaignSpec } from '../src/agents/metacampaign.js';

describe('buildMetaCampaignSpec', () => {
  it('builds a complete, paused, playbook-driven Meta campaign', () => {
    const spec = buildMetaCampaignSpec(
      { offer: '$500 off a new roof', website: 'phillyroofingco.com', financing: true, imageUrl: 'https://cdn.example/roof.jpg' },
      { business: 'Philly Roofing Co', industry: 'Roofing', serviceAreas: 'Philadelphia, 19116, 19115', city: 'Philadelphia' },
    );
    expect(spec.status).toBe('PAUSED');
    expect(spec.objective).toBe('OUTCOME_LEADS');
    expect(spec.optimizationGoal).toBe('LEAD_GENERATION');
    expect(spec.placements).toEqual(['facebook', 'instagram']);
    expect(spec.name).not.toMatch(/\u2014|\u2013/);
    expect(spec.ad.primaryText).not.toMatch(/\u2014|\u2013/);
    expect(spec.ad.headline).not.toMatch(/\u2014|\u2013/);
    expect(spec.dailyBudget).toBeGreaterThan(0);
    expect(spec.geo.zips).toEqual(['19116', '19115']); // parsed from service areas
    expect(spec.website).toBe('https://phillyroofingco.com'); // normalized
    expect(spec.ad.primaryText).toContain('$500 off a new roof');
    expect(spec.ad.cta).toBe('GET_QUOTE'); // roofing → quote
    expect(validateMetaCampaignSpec(spec)).toEqual([]); // ready to launch
  });

  it('normalizes an already-qualified URL and keeps it', () => {
    const spec = buildMetaCampaignSpec({ website: 'https://acme.com/roofs' }, { industry: 'Roofing' });
    expect(spec.website).toBe('https://acme.com/roofs');
  });

  it('flags missing website and no local geo as launch issues', () => {
    const spec = buildMetaCampaignSpec({ offer: 'Free estimate' }, { industry: 'Plumbing' });
    const issues = validateMetaCampaignSpec(spec);
    expect(issues.some((i) => /website/i.test(i))).toBe(true);
    expect(issues.some((i) => /ZIP|cities|local/i.test(i))).toBe(true);
  });

  it('respects an explicit daily budget override', () => {
    const spec = buildMetaCampaignSpec({ website: 'x.com', dailyBudget: 75 }, { industry: 'HVAC', serviceAreas: '30301' });
    expect(spec.dailyBudget).toBe(75);
    expect(spec.geo.zips).toEqual(['30301']);
  });
});
