import { describe, expect, it } from 'vitest';
import { recordSnapshot, buildSocialReport, type DailySnapshot } from '../src/agents/social_report.js';

describe('recordSnapshot', () => {
  it('adds one snapshot per day, latest wins, and caps history', () => {
    let h: DailySnapshot[] = [];
    h = recordSnapshot(h, { impressions: 100, clicks: 5, likes: 3, followers: 1000 }, '2026-08-10T09:00:00Z');
    h = recordSnapshot(h, { impressions: 200, clicks: 8, likes: 6, followers: 1005 }, '2026-08-10T18:00:00Z'); // same day → replace
    h = recordSnapshot(h, { impressions: 150, clicks: 6, likes: 4, followers: 1010 }, '2026-08-11T09:00:00Z');
    expect(h).toHaveLength(2);
    expect(h[0]!.impressions).toBe(200); // latest for Aug 10
  });
  it('ignores null metrics (nothing connected)', () => {
    expect(recordSnapshot([], null, '2026-08-10T00:00:00Z')).toHaveLength(0);
  });
});

describe('buildSocialReport', () => {
  it('is honest and empty with no history', () => {
    const r = buildSocialReport([], '2026-08-12T00:00:00Z');
    expect(r.rows).toHaveLength(0);
    expect(r.body.toLowerCase()).toContain('connect');
  });
  it('totals the trailing 30 days, CTR, follower change, and best day', () => {
    const hist: DailySnapshot[] = [
      { date: '2026-08-10', impressions: 1000, clicks: 50, likes: 20, followers: 1000 },
      { date: '2026-08-11', impressions: 3000, clicks: 90, likes: 40, followers: 1050 },
      { date: '2026-07-01', impressions: 999999, clicks: 1, likes: 1, followers: 1 }, // outside 30d window
    ];
    const r = buildSocialReport(hist, '2026-08-12T00:00:00Z');
    expect(r.rows).toHaveLength(2); // July 1 excluded
    expect(r.body).toContain('4,000 impressions');
    expect(r.body).toContain('Best day: 2026-08-11');
    expect(r.body).toContain('+50 followers');
    expect(r.body).toContain('Daily dataset:');
  });
});
