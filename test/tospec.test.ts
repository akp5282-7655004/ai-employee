import { describe, expect, it } from 'vitest';
import { buildMetaAssets, buildSearchAssets, checkMetaPack, checkSearchPack } from '../src/creative/tospec.js';
import { loadSpec } from '../src/specs/index.js';

const INPUT = {
  trade: 'painting',
  city: 'Philadelphia',
  businessName: 'Painters In Philly',
  offer: 'Free estimates',
  services: ['interior painting', 'exterior painting', 'cabinet refinishing'],
};

const g = loadSpec('google_ads');
const RSA = g.campaign_types.search.ad_units.responsive_search_ad;
const m = loadSpec('meta_ads');

describe('Google Search asset pack', () => {
  it('fills the recommended counts the spec asks for, not a token three', () => {
    const p = buildSearchAssets(INPUT);
    expect(p.headlines).toHaveLength(RSA.headlines.max_count);   // 15
    expect(p.descriptions).toHaveLength(RSA.descriptions.max_count); // 4
    expect(p.sitelinks.length).toBeGreaterThanOrEqual(g.assets_library.sitelink.recommended_min);
    expect(p.callouts.length).toBeGreaterThanOrEqual(g.assets_library.callout.min_to_serve);
    expect(p.shortfalls).toEqual([]);
  });

  it('never emits anything over a character limit', () => {
    const p = buildSearchAssets(INPUT);
    for (const h of p.headlines) expect(h.length, h).toBeLessThanOrEqual(RSA.headlines.max_chars);
    for (const d of p.descriptions) expect(d.length, d).toBeLessThanOrEqual(RSA.descriptions.max_chars);
    for (const s of p.sitelinks) {
      expect(s.text.length, s.text).toBeLessThanOrEqual(g.assets_library.sitelink.fields.link_text.max_chars);
      if (s.desc1) expect(s.desc1.length).toBeLessThanOrEqual(g.assets_library.sitelink.fields.description_1.max_chars);
    }
    for (const c of p.callouts) expect(c.length, c).toBeLessThanOrEqual(g.assets_library.callout.fields.text.max_chars);
    for (const v of p.snippet.values) expect(v.length, v).toBeLessThanOrEqual(g.assets_library.structured_snippet.fields.values.max_chars);
    for (const dp of p.displayPaths) expect(dp.length).toBeLessThanOrEqual(RSA.display_path.max_chars);
  });

  it('drops an over-long candidate rather than truncating it mid-word', () => {
    const p = buildSearchAssets({ ...INPUT, offer: 'Twenty five percent off every interior repaint this month only' });
    // The offer is far past 30 chars, so it must not appear as a headline at all.
    expect(p.headlines.some((h) => h.startsWith('Twenty five percent'))).toBe(false);
    expect(p.headlines.every((h) => !h.endsWith('…'))).toBe(true);
    expect(p.headlines).toHaveLength(RSA.headlines.max_count); // still filled from other candidates
  });

  it('obeys Google\'s own per-item rules', () => {
    const checks = checkSearchPack(buildSearchAssets(INPUT));
    const byItem = Object.fromEntries(checks.map((c) => [c.item, c.status]));
    expect(byItem['Keyword in ≥2 headlines']).toBe('ok');
    expect(byItem['Varied headline lengths']).toBe('ok');
  });

  it('produces no duplicates', () => {
    const p = buildSearchAssets(INPUT);
    const lower = (a: string[]) => a.map((s) => s.toLowerCase());
    expect(new Set(lower(p.headlines)).size).toBe(p.headlines.length);
    expect(new Set(lower(p.callouts)).size).toBe(p.callouts.length);
    expect(new Set(p.sitelinks.map((s) => s.text.toLowerCase())).size).toBe(p.sitelinks.length);
  });

  it('uses the owner\'s own offer verbatim when it fits — it is their promise', () => {
    const p = buildSearchAssets({ ...INPUT, offer: '0% for 12 months' });
    expect(p.headlines).toContain('0% for 12 months');
  });

  it('reports a shortfall plainly instead of padding to hit a number', () => {
    // No city, no services, no offer — fewer usable candidates.
    const p = buildSearchAssets({ trade: 'x' });
    if (p.headlines.length < RSA.headlines.max_count) {
      expect(p.shortfalls.join(' ')).toMatch(/headlines/);
      expect(p.shortfalls.join(' ')).toMatch(new RegExp(String(RSA.headlines.max_chars)));
    }
    expect(p.snippet.values.length).toBeGreaterThanOrEqual(3); // falls back to generic service names
  });

  it('picks a structured-snippet header from the enum Google allows', () => {
    const p = buildSearchAssets(INPUT);
    expect(g.assets_library.structured_snippet.fields.header.values).toContain(p.snippet.header);
  });
});

describe('Meta asset pack', () => {
  it('fills every variation slot the spec allows', () => {
    const p = buildMetaAssets(INPUT);
    expect(p.primaryTexts).toHaveLength(m.ad_text.primary_text.variations_max);
    expect(p.headlines).toHaveLength(m.ad_text.headline.variations_max);
    expect(p.descriptions).toHaveLength(m.ad_text.description.variations_max);
    expect(p.shortfalls).toEqual([]);
  });

  it('stays inside the VISIBLE budget, not the hard maximum', () => {
    const p = buildMetaAssets(INPUT);
    // 2200 is what Meta accepts; 125 is what a person actually reads before
    // "See more". Writing to the hard max would technically pass and be useless.
    for (const t of p.primaryTexts) expect(t.length, t).toBeLessThanOrEqual(m.ad_text.primary_text.visible_chars);
    for (const h of p.headlines) expect(h.length, h).toBeLessThanOrEqual(m.ad_text.headline.safe_chars);
    for (const d of p.descriptions) expect(d.length, d).toBeLessThanOrEqual(m.ad_text.description.safe_chars);
  });

  it('uses the spec\'s home-services call to action rather than a guess', () => {
    expect(buildMetaAssets(INPUT).cta).toBe(m.ad_text.cta.home_services_default);
    expect(m.ad_text.cta.values).toContain(buildMetaAssets(INPUT).cta);
  });
});

describe('the checkers prove compliance rather than assert it', () => {
  it('passes a well-built pack', () => {
    expect(checkSearchPack(buildSearchAssets(INPUT)).some((c) => c.status === 'bad')).toBe(false);
    expect(checkMetaPack(buildMetaAssets(INPUT)).some((c) => c.status === 'bad')).toBe(false);
  });

  it('catches an over-long headline that a generator regression let through', () => {
    const bad = buildSearchAssets(INPUT);
    bad.headlines = [...bad.headlines.slice(0, 14), 'A headline far longer than Google will ever accept'];
    const c = checkSearchPack(bad).find((x) => x.item.startsWith('Headlines'))!;
    expect(c.status).toBe('bad');
    expect(c.detail).toMatch(/over the limit/);
  });

  it('catches a pack that is merely legal but thin', () => {
    const thin = buildSearchAssets(INPUT);
    thin.headlines = thin.headlines.slice(0, 3); // the bare minimum Google serves on
    const c = checkSearchPack(thin).find((x) => x.item.startsWith('Headline count'))!;
    expect(c.status).toBe('warn');
    expect(c.detail).toBe('3/15.');
  });
});
