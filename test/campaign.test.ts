import { describe, expect, it } from 'vitest';
import { buildCampaignSpec, validateCampaignSpec, SNIPPET_HEADERS } from '../src/agents/campaign.js';

const ctx = { business: 'Smoky Mtn Yellow Labs', trade: 'Dog Breeder', city: 'Sevierville', services: 'English Labrador puppies, health-tested litters', offers: 'Reserve a 2026 puppy' };

describe('buildCampaignSpec — full Search assets', () => {
  const spec = buildCampaignSpec({ finalUrl: 'https://smokymtnyellowlabs.com', dailyBudget: 20 }, ctx);

  it('includes a business name within 25 chars', () => {
    expect(spec.businessName).toBeTruthy();
    expect(spec.businessName!.length).toBeLessThanOrEqual(25);
  });

  it('includes two display paths ≤15 chars', () => {
    expect(spec.displayPaths!.length).toBeGreaterThan(0);
    spec.displayPaths!.forEach((p) => expect(p.length).toBeLessThanOrEqual(15));
  });

  it('includes 4+ sitelinks, each with distinct URL and ≤25/≤35 limits', () => {
    expect(spec.sitelinks!.length).toBeGreaterThanOrEqual(4);
    const urls = new Set(spec.sitelinks!.map((s) => s.url));
    expect(urls.size).toBe(spec.sitelinks!.length); // all distinct
    spec.sitelinks!.forEach((s) => {
      expect(s.text.length).toBeLessThanOrEqual(25);
      expect((s.desc1 || '').length).toBeLessThanOrEqual(35);
      expect(s.url).toMatch(/^https?:\/\//);
    });
  });

  it('includes 4+ callouts ≤25 chars', () => {
    expect(spec.callouts!.length).toBeGreaterThanOrEqual(4);
    spec.callouts!.forEach((c) => expect(c.length).toBeLessThanOrEqual(25));
  });

  it('includes a structured snippet with a valid header and 3+ values ≤25', () => {
    expect(SNIPPET_HEADERS).toContain(spec.structuredSnippet!.header);
    expect(spec.structuredSnippet!.values.length).toBeGreaterThanOrEqual(3);
    spec.structuredSnippet!.values.forEach((v) => expect(v.length).toBeLessThanOrEqual(25));
  });

  it('passes validation as built', () => {
    expect(validateCampaignSpec(spec)).toEqual([]);
  });
});

describe('validateCampaignSpec — asset limits', () => {
  const base = buildCampaignSpec({ finalUrl: 'https://x.com' }, ctx);
  it('flags an over-long business name', () => {
    expect(validateCampaignSpec({ ...base, businessName: 'x'.repeat(26) }).some((e) => /Business name/.test(e))).toBe(true);
  });
  it('flags a bad structured-snippet header and too-few values', () => {
    expect(validateCampaignSpec({ ...base, structuredSnippet: { header: 'Nonsense', values: ['a'] } }).some((e) => /snippet header|3 values/.test(e))).toBe(true);
  });
  it('flags an over-long callout', () => {
    expect(validateCampaignSpec({ ...base, callouts: ['x'.repeat(26)] }).some((e) => /Callout too long/.test(e))).toBe(true);
  });
});
