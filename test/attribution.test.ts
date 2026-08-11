import { describe, expect, it } from 'vitest';
import { attributeRevenue, type CampaignSpend, type Deal } from '../src/revenue/attribution.js';

const spend: CampaignSpend[] = [
  { platform: 'google_ads', campaign: 'Emergency Plumbing', utm: 'gads_plumbing', spend: 1000 },
  { platform: 'facebook', campaign: 'AC Tune-up', utm: 'meta_ac', spend: 500 },
];
const deals: Deal[] = [
  { id: '1', value: 4200, won: true, utmSource: 'google_ads', utmCampaign: 'gads_plumbing' },
  { id: '2', value: 1800, won: true, utmSource: 'google_ads', utmCampaign: 'gads_plumbing' },
  { id: '3', value: 900, won: false, utmSource: 'facebook', utmCampaign: 'meta_ac' },
  { id: '4', value: 2500, won: true, utmSource: 'facebook', utmCampaign: 'meta_ac' },
  { id: '5', value: 3000, won: true, utmCampaign: 'unknown_source' }, // unattributed
];

describe('attributeRevenue', () => {
  const r = attributeRevenue(spend, deals);

  it('computes blended ROAS on attributed won revenue', () => {
    // won attributed = 4200 + 1800 + 2500 = 8500 ; spend = 1500 → 5.67x
    expect(r.attributedRevenue).toBe(8500);
    expect(r.totalSpend).toBe(1500);
    expect(r.blendedRoas).toBeCloseTo(5.67, 1);
  });

  it('rolls up per-campaign ROAS and cost per customer', () => {
    const plumbing = r.byCampaign.find((x) => x.key === 'Emergency Plumbing')!;
    expect(plumbing.revenue).toBe(6000); // 4200 + 1800
    expect(plumbing.wonDeals).toBe(2);
    expect(plumbing.roas).toBe(6); // 6000 / 1000
    expect(plumbing.costPerCustomer).toBe(500); // 1000 / 2
  });

  it('excludes lost deals from revenue but counts them as deals', () => {
    const ac = r.byCampaign.find((x) => x.key === 'AC Tune-up')!;
    expect(ac.deals).toBe(2); // one won, one lost
    expect(ac.wonDeals).toBe(1);
    expect(ac.revenue).toBe(2500);
  });

  it('flags revenue whose UTM matched no campaign', () => {
    expect(r.unattributedRevenue).toBe(3000);
  });

  it('rolls up by platform', () => {
    const g = r.byPlatform.find((x) => x.platform === 'google_ads')!;
    expect(g.revenue).toBe(6000);
    expect(g.roas).toBe(6);
  });

  it('handles no data without dividing by zero', () => {
    const empty = attributeRevenue([], []);
    expect(empty.blendedRoas).toBe(0);
    expect(empty.costPerCustomer).toBe(0);
    expect(empty.byCampaign).toHaveLength(0);
  });
});
