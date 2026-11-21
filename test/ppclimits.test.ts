import { describe, expect, it } from 'vitest';
import { buildCampaignSpec } from '../src/agents/campaign.js';
import { includeBuildElements } from '../src/agents/ppclimits.js';

function specWith(count: number) {
  const services = Array.from({ length: count }, (_, index) => `Service ${index + 1}`).join(', ');
  return buildCampaignSpec(
    { dailyBudget: 20, finalUrl: 'https://paintersinphilly.com', locations: ['Philadelphia'] },
    { business: 'Painters In Philly', trade: 'Custom', city: 'Philadelphia', services },
  );
}

describe('build elements, not tier caps', () => {
  it('keeps every named service and adds a branded campaign', () => {
    const built = specWith(6);
    const fit = includeBuildElements(built, 'Painters In Philly');
    expect(fit.spec.adGroups).toHaveLength(built.adGroups.length);
    expect(fit.spec.adGroups).toHaveLength(6);
    expect(fit.note).not.toMatch(/Starter|Growth|Scale|left off/i);
    expect(fit.brand?.adGroups).toHaveLength(1);
    expect(fit.brand?.adGroups[0]?.keywords.every((row) => row.match === 'exact')).toBe(true);
    expect(fit.spec.adGroups.every((group) => (group.rsaVariant?.headlines.length || 0) > 1)).toBe(true);
    expect(fit.checklist.join(' ')).toMatch(/not a plan tier/);
  });

  it('skips the branded campaign when there is no brand name', () => {
    const fit = includeBuildElements(specWith(1), '  ');
    expect(fit.brand).toBeNull();
  });
});
