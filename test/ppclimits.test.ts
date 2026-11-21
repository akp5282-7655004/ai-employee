import { describe, expect, it } from 'vitest';
import { buildCampaignSpec } from '../src/agents/campaign.js';
import { applyPpcLimits, planTierOf } from '../src/agents/ppclimits.js';

function specWith(count: number) {
  const services = Array.from({ length: count }, (_, index) => `Service ${index + 1}`).join(', ');
  return buildCampaignSpec(
    { dailyBudget: 20, finalUrl: 'https://paintersinphilly.com', locations: ['Philadelphia'] },
    { business: 'Painters In Philly', trade: 'Custom', city: 'Philadelphia', services },
  );
}

describe('PPC plan limits', () => {
  it('defaults an unknown plan to Starter', () => {
    expect(planTierOf(undefined)).toBe('starter');
    expect(planTierOf('launch')).toBe('starter');
    expect(planTierOf('growth')).toBe('growth');
  });

  it('keeps a Starter draft to 5 ad groups and still adds the branded campaign', () => {
    const fit = applyPpcLimits(specWith(6), 'starter', 'Painters In Philly');
    expect(fit.spec.adGroups).toHaveLength(5);
    expect(fit.note).toMatch(/Left off this draft: Service 6/);
    expect(fit.brand?.adGroups).toHaveLength(1);
    expect(fit.brand?.adGroups[0]?.keywords.every((row) => row.match === 'exact')).toBe(true);
    expect(fit.checklist.join(' ')).toMatch(/Display and retargeting are not on this plan/);
    expect(fit.checklist.join(' ')).toMatch(/A\/B ad testing is not on this plan/);
    expect(fit.spec.adGroups.every((group) => !group.rsaVariant)).toBe(true);
  });

  it('lets Growth include Display and Scale include a second ad', () => {
    const growth = applyPpcLimits(specWith(6), 'growth', 'Painters In Philly');
    expect(growth.spec.adGroups).toHaveLength(6);
    expect(growth.checklist.join(' ')).toMatch(/Display and retargeting are on this plan/);
    expect(growth.spec.adGroups.every((group) => !group.rsaVariant)).toBe(true);
    const scale = applyPpcLimits(specWith(2), 'scale', 'Painters In Philly');
    expect(scale.spec.adGroups.every((group) => (group.rsaVariant?.headlines.length || 0) > 1)).toBe(true);
    expect(scale.checklist.join(' ')).toMatch(/second responsive ad/);
  });

  it('skips the branded campaign when there is no brand name', () => {
    const fit = applyPpcLimits(specWith(1), 'starter', '  ');
    expect(fit.brand).toBeNull();
  });
});
