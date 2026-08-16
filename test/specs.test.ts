import { describe, expect, it } from 'vitest';
import { SPEC_PLATFORMS, loadSpec, searchSpecCheck } from '../src/specs/index.js';
import { buildCampaignSpec } from '../src/agents/campaign.js';

const ctx = { business: 'Painters In Philly', trade: 'Painting', city: 'Philadelphia', services: 'Interior painting, exterior painting, cabinet refinishing', offers: 'Free color consult' };

describe('platform spec registry', () => {
  it('loads all three platform specs as structured data', () => {
    for (const p of SPEC_PLATFORMS) {
      const spec = loadSpec(p);
      expect(spec).toBeTruthy();
      expect(spec.$schema_version).toBe('1.0');
    }
  });

  it('google_ads spec carries the RSA limits Miles validates against', () => {
    const rsa = loadSpec('google_ads').campaign_types.search.ad_units.responsive_search_ad;
    expect(rsa.headlines.max_count).toBe(15);
    expect(rsa.headlines.max_chars).toBe(30);
    expect(rsa.descriptions.max_count).toBe(4);
    expect(rsa.descriptions.max_chars).toBe(90);
  });

  it('meta spec knows leads is the home-services default objective', () => {
    expect(loadSpec('meta_ads').campaign.objective.home_services_default).toBe('leads');
  });

  it('lsa_gbp spec carries the GBP completeness rules', () => {
    const gbp = loadSpec('lsa_gbp').gbp.profile;
    expect(gbp.description.max_chars).toBe(750);
    expect(gbp.photos.min_total).toBe(20);
  });
});

describe('searchSpecCheck — audit against Google launch checklist', () => {
  const spec = buildCampaignSpec({ finalUrl: 'https://paintersinphilly.com', dailyBudget: 25 }, ctx);
  const items = searchSpecCheck(spec);
  const byItem = (frag: string) => items.find((i) => i.item.toLowerCase().includes(frag));

  it('a Miles-built campaign has no missing items', () => {
    expect(items.filter((i) => i.status === 'missing')).toEqual([]);
  });

  it('marks builder-covered items ok (final URL, keywords, sitelinks, negatives)', () => {
    expect(byItem('final url')!.status).toBe('ok');
    expect(byItem('keywords')!.status).toBe('ok');
    expect(byItem('sitelinks')!.status).toBe('ok');
    expect(byItem('negative')!.status).toBe('ok');
    expect(byItem('headlines')!.status).toBe('ok'); // generator now fills all 15
  });

  it('flags UI-only assets as manual, never pretending Miles created them', () => {
    const manual = items.filter((i) => i.status === 'manual').map((i) => i.item);
    expect(manual.join(' ')).toMatch(/logo/i);
    expect(manual.join(' ')).toMatch(/image/i);
    expect(manual.join(' ')).toMatch(/call/i);
    expect(manual.join(' ')).toMatch(/location/i);
  });

  it('reports missing keywords as missing', () => {
    const bare = { ...spec, adGroups: [{ ...spec.adGroups[0]!, keywords: [] }] };
    expect(searchSpecCheck(bare).find((i) => /keywords/i.test(i.item))!.status).toBe('missing');
  });
});
