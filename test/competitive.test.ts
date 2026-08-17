import { describe, expect, it } from 'vitest';
import { areaScore, CHANNELS, compareAreas, normalizeUrl, MAX_COMPETITORS, type SiteAudit } from '../src/research/competitive.js';
import type { AuditResult, AuditFinding, AuditArea, AuditStatus } from '../src/research/audit.js';

const f = (area: AuditArea, status: AuditStatus, weight = 10): AuditFinding =>
  ({ id: `${area}-${status}-${weight}`, area, label: area, status, found: '', fix: '', weight });

const site = (url: string, findings: AuditFinding[]): AuditResult => ({
  url, finalUrl: url, score: 0, grade: 'C', findings,
  stats: { words: 0, images: 0, imagesWithAlt: 0 }, pagesCrawled: 1,
});

const audit = (url: string, role: SiteAudit['role'], findings: AuditFinding[]): SiteAudit =>
  ({ url, role, ok: true, result: site(url, findings) });

describe('scoring one area', () => {
  it('weights findings, with a warning worth half of a pass', () => {
    expect(areaScore(site('a', [f('SEO', 'good')]), 'SEO')).toBe(100);
    expect(areaScore(site('a', [f('SEO', 'bad')]), 'SEO')).toBe(0);
    expect(areaScore(site('a', [f('SEO', 'warn')]), 'SEO')).toBe(50);
    expect(areaScore(site('a', [f('SEO', 'good'), f('SEO', 'bad')]), 'SEO')).toBe(50);
  });

  it('respects weight, so a heavy failure outranks a light pass', () => {
    const r = site('a', [f('SEO', 'good', 1), f('SEO', 'bad', 9)]);
    expect(areaScore(r, 'SEO')).toBe(10);
  });

  it('returns null for an area with nothing measured rather than a misleading zero', () => {
    expect(areaScore(site('a', [f('SEO', 'good')]), 'Mobile')).toBeNull();
    expect(areaScore(site('a', []), 'SEO')).toBeNull();
  });
});

describe('comparing you to your market', () => {
  it('measures against the BEST competitor, not the average', () => {
    // An owner is not trying to beat the mean of their market — they are trying
    // to beat whoever is currently taking the jobs.
    const gaps = compareAreas([
      audit('you.com', 'you', [f('SEO', 'bad')]),                 // 0
      audit('weak.com', 'competitor', [f('SEO', 'bad')]),         // 0
      audit('strong.com', 'competitor', [f('SEO', 'good')]),      // 100
    ]);
    const seo = gaps.find((g) => g.area === 'SEO')!;
    expect(seo.best).toBe(100);
    expect(seo.bestBy).toBe('strong.com');
    expect(seo.average).toBe(50);
    expect(seo.behindBy).toBe(100);
    expect(seo.verdict).toBe('behind');
  });

  it('calls a few points either way level, because a checklist score is not that precise', () => {
    const gaps = compareAreas([
      audit('you.com', 'you', [f('SEO', 'good'), f('SEO', 'warn')]),        // 75
      audit('rival.com', 'competitor', [f('SEO', 'good'), f('SEO', 'warn')]), // 75
    ]);
    expect(gaps.find((g) => g.area === 'SEO')!.verdict).toBe('level');
  });

  it('reports where you are ahead, not only where you trail', () => {
    const gaps = compareAreas([
      audit('you.com', 'you', [f('Trust', 'good')]),
      audit('rival.com', 'competitor', [f('Trust', 'bad')]),
    ]);
    const t = gaps.find((g) => g.area === 'Trust')!;
    expect(t.verdict).toBe('ahead');
    expect(t.behindBy).toBe(-100);
  });

  it('says unknown when nothing can be compared, instead of implying parity', () => {
    const gaps = compareAreas([audit('you.com', 'you', [f('SEO', 'good')])]);
    expect(gaps.find((g) => g.area === 'SEO')!.verdict).toBe('unknown');
    const noSelf = compareAreas([audit('rival.com', 'competitor', [f('SEO', 'good')])]);
    expect(noSelf.every((g) => g.verdict === 'unknown')).toBe(true);
  });

  it('ignores a competitor whose audit failed rather than scoring it zero', () => {
    const gaps = compareAreas([
      audit('you.com', 'you', [f('SEO', 'good')]),
      { url: 'broken.com', role: 'competitor', ok: false, error: 'blocked' },
    ]);
    expect(gaps.find((g) => g.area === 'SEO')!.verdict).toBe('unknown');
  });

  it('covers every audited area, so nothing silently drops out of the table', () => {
    const gaps = compareAreas([audit('you.com', 'you', [f('SEO', 'good')])]);
    expect(gaps.map((g) => g.area)).toEqual(['Trust', 'SEO', 'Conversion', 'Mobile', 'Local', 'AI Search', 'Content']);
  });
});

describe('channel coverage is declared, not implied', () => {
  it('states how competitor data for each channel is obtained', () => {
    for (const c of CHANNELS) {
      expect(['crawl', 'capture', 'none']).toContain(c.coverage);
      expect(c.note.length).toBeGreaterThan(20); // an owner must be able to read why
    }
  });

  it('admits email has no source at all', () => {
    const email = CHANNELS.find((c) => c.id === 'email')!;
    expect(email.coverage).toBe('none');
    expect(email.note).toMatch(/no public or licensed source/i);
  });

  it('marks the ad channels as capture — none of them expose a usable API', () => {
    for (const id of ['google_ads', 'meta', 'tiktok', 'youtube']) {
      expect(CHANNELS.find((c) => c.id === id)!.coverage).toBe('capture');
    }
  });

  it('marks only genuinely crawlable channels as crawl', () => {
    expect(CHANNELS.filter((c) => c.coverage === 'crawl').map((c) => c.id)).toEqual(['seo', 'local']);
  });
});

describe('accepting a typed-in domain', () => {
  it('adds a scheme and keeps the path', () => {
    expect(normalizeUrl('acme.com')).toBe('https://acme.com');
    expect(normalizeUrl('  acme.com/painting ')).toBe('https://acme.com/painting');
    expect(normalizeUrl('http://acme.com')).toBe('http://acme.com');
  });

  it('rejects what is not a domain instead of fetching nonsense', () => {
    for (const bad of ['', '   ', 'not a url', 'localhost']) expect(normalizeUrl(bad)).toBeNull();
  });

  it('caps the competitor list at five', () => {
    expect(MAX_COMPETITORS).toBe(5);
  });
});
