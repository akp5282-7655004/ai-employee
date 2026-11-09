import { describe, expect, it } from 'vitest';
import { buildCampaignSpec, deriveServiceLines, shortBrand } from '../src/agents/campaign.js';
import { judgeSearchLaunch } from '../src/agents/googlelaunch.js';
import { buildBundle } from '../src/agents/journey.js';

const html = `<!doctype html><html><head><title>Painters In Philly | Philadelphia</title>
<meta name="description" content="Interior and exterior house painting, cabinet painting, and commercial painting in Philadelphia. Call 215-555-0199.">
<meta name="theme-color" content="#1a365d">
</head><body>
<h1>House painters in Philadelphia</h1>
<p>Interior painting, exterior painting, cabinet painting, and commercial painting. Licensed and insured. Open Monday 8am to 5pm.</p>
<a href="tel:215-555-0199">215-555-0199</a>
<a href="https://facebook.com/paintersinphilly">Facebook</a>
</body></html>`;

describe('search copy rules', () => {
  const spec = buildCampaignSpec(
    { dailyBudget: 2, finalUrl: 'https://paintersinphilly.com', locations: ['Philadelphia, PA'] },
    { business: "Philadelphia's #1 Painters, Painters In Philly", trade: 'Painting', city: 'Philadelphia', services: 'FREE CUSTOM QUOTE' },
  );

  it('drops offer phrases and keeps painting service lines', () => {
    expect(deriveServiceLines('FREE CUSTOM QUOTE', 'Painting').join(' ')).not.toMatch(/free|quote/i);
    expect(spec.adGroups.map((g) => g.name).join(' ')).toMatch(/Interior|Exterior|House/);
    expect(spec.adGroups.map((g) => g.name).join(' ')).not.toMatch(/FREE|QUOTE/i);
  });

  it('stays inside Google limits and off the other networks', () => {
    expect(spec.name).toBe('Painting | Philadelphia | Search | Planned');
    expect(spec.networks).toEqual(['Google Search']);
    expect(spec.businessName).toBe('Painters In Philly');
    expect(shortBrand("Philadelphia's #1 Painters, Painters In Philly", 'Painting', 'Philadelphia')).toBe('Painters In Philly');
    for (const group of spec.adGroups) {
      for (const h of group.rsa.headlines) expect(h).toBe(h.replace(/[A-Z]{4,}/g, ''));
      for (const h of group.rsa.headlines) expect(h.length).toBeLessThanOrEqual(30);
      for (const d of group.rsa.descriptions) expect(d.length).toBeLessThanOrEqual(90);
      expect(group.keywords.some((k) => k.match === 'broad')).toBe(false);
      expect(group.keywords.some((k) => k.text.includes('free'))).toBe(false);
    }
  });

  it('does not call a launch successful when one ad failed', () => {
    const judged = judgeSearchLaunch([
      { step: 'Create daily budget ($2)', ok: true, resource: 'customers/1/campaignBudgets/1' },
      { step: 'Create campaign "Painting" (PAUSED)', ok: true, resource: 'customers/1/campaigns/2' },
      { step: 'Create ad group "Interior painting"', ok: true, resource: 'customers/1/adGroups/3' },
      { step: 'Add 3 keywords to "Interior painting"', ok: true },
      { step: 'Create responsive search ad in "Interior painting"', ok: false, error: 'CAPITALIZATION' },
      { step: 'Create ad group "Exterior painting"', ok: true, resource: 'customers/1/adGroups/4' },
      { step: 'Add 3 keywords to "Exterior painting"', ok: true },
      { step: 'Create responsive search ad in "Exterior painting"', ok: true },
    ]);
    expect(judged.ok).toBe(false);
    expect(judged.adsMissing.map((a) => a.name)).toContain('Interior painting');
  });
});

describe('crawl bundle', () => {
  it('fills the profile from the page and keeps missing facts missing', () => {
    const bundle = buildBundle({
      businessName: "Philadelphia's #1 Painters",
      location: 'Philadelphia, PA',
      email: 'owner@example.com',
      website: 'https://paintersinphilly.com',
      gbpUrl: 'https://maps.google.com/?cid=1',
      competitors: ['https://otherpainters.example'],
      html,
      goal: 'get me painting leads',
      dailyBudget: 20,
      leadsPerDay: 2,
      googleShare: 1,
      mode: 'automate',
      now: new Date('2026-04-15T12:00:00Z'),
    });
    expect(bundle.profile.industry).toBe('Painting');
    expect(bundle.profile.phone).toMatch(/215/);
    expect(bundle.hours).toMatch(/Hours are mentioned/);
    expect(bundle.license).toMatch(/Licensed/i);
    expect(bundle.setup.gbpNote).toMatch(/does not read ratings/);
    expect(bundle.audits.find((a) => a.id === 'competitor')!.summary).toMatch(/not available/);
    expect(bundle.channels.find((c) => c.id === 'meta')!.status).toBe('coming_later');
    expect(bundle.channels.find((c) => c.id === 'tiktok')!.status).toBe('coming_later');
    expect(bundle.channels.find((c) => c.id === 'lsa')!.status).toBe('coming_later');
    expect(bundle.seo.length).toBeGreaterThan(0);
    expect(bundle.social.every((p) => p.status === 'needs_approval')).toBe(true);
    expect(bundle.spec.status).toBe('PAUSED');
  });
});
