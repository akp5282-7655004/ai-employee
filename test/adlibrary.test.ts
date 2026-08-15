import { describe, expect, it } from 'vitest';
import {
  groupAngles,
  advertiserPostures,
  buildDeepLinks,
  readingChecklist,
  competitorAdReport,
  type CompetitorAd,
} from '../src/research/adlibrary.js';

function ad(page: string, body: string, daysRunning?: number): CompetitorAd {
  return { id: Math.random().toString(36).slice(2), page, body, platforms: [], daysRunning };
}

describe('groupAngles', () => {
  it('clusters near-identical creative into one angle and flags a scaling bet', () => {
    // Replication = the same creative text rebuilt as variants (trailing tweaks only).
    const base = 'New roof? Get $500 off your full replacement booked by month end. Licensed insured';
    const ads = [
      ad('Acme Roofing', base + ' local crew.', 40),
      ad('Acme Roofing', base + ' — call today! 🏠', 12),
      ad('Acme Roofing', base + '!!!', 5),
      ad('Acme Roofing', base + ' Financing available.', 3),
    ];
    const angles = groupAngles(ads);
    expect(angles.length).toBe(1);
    expect(angles[0]!.variants).toBe(4);
    expect(angles[0]!.signal).toBe('scaling-bet');
    expect(angles[0]!.maxDaysRunning).toBe(40); // longest-running variant surfaces
  });

  it('ranks replicated angles above lone long-runners', () => {
    const ads = [
      ad('A', 'lonely evergreen ad that has run forever', 300),
      ad('B', 'tested angle variant one two three', 10),
      ad('B', 'tested angle variant one two three!!', 8),
    ];
    const angles = groupAngles(ads);
    expect(angles[0]!.page).toBe('B'); // 2 variants beats a single 300-day ad
    expect(angles[0]!.signal).toBe('testing');
  });
});

describe('advertiserPostures', () => {
  it('reads active-ad count as maintenance / testing / scaling', () => {
    const make = (page: string, n: number) => Array.from({ length: n }, (_, i) => ad(page, page + ' ad ' + i));
    const ads = [...make('Solo', 2), ...make('Tester', 7), ...make('Scaler', 16)];
    const p = advertiserPostures(ads);
    expect(p.find((x) => x.page === 'Solo')!.mode).toBe('maintenance');
    expect(p.find((x) => x.page === 'Tester')!.mode).toBe('testing');
    expect(p.find((x) => x.page === 'Scaler')!.mode).toBe('scaling');
    expect(p[0]!.page).toBe('Scaler'); // sorted by volume
  });
});

describe('buildDeepLinks', () => {
  it('builds web-UI links with country, keyword, and a per-competitor link', () => {
    const links = buildDeepLinks('roofing philadelphia', 'US', ['Big Roof Co']);
    expect(links[0]!.url).toContain('facebook.com/ads/library');
    expect(links[0]!.url).toContain('country=US');
    expect(links[0]!.url).toContain('roofing');
    expect(links.some((l) => l.label.includes('Big Roof Co'))).toBe(true);
  });
});

describe('competitorAdReport (no token)', () => {
  it('degrades honestly: no ads, but always returns links + checklist for US', async () => {
    const prev = process.env.META_AD_LIBRARY_TOKEN;
    delete process.env.META_AD_LIBRARY_TOKEN;
    try {
      const r = await competitorAdReport('roofing philadelphia', 'US', []);
      expect(r.ready).toBe(false);
      expect(r.apiCovers).toBe(false); // US commercial not covered by the API
      expect(r.ads).toEqual([]);
      expect(r.deepLinks.length).toBeGreaterThan(0);
      expect(r.checklist.length).toBe(readingChecklist().length);
      expect(r.note).toMatch(/web UI/i);
    } finally {
      if (prev !== undefined) process.env.META_AD_LIBRARY_TOKEN = prev;
    }
  });
});
