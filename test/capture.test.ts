import { describe, expect, it } from 'vitest';
import { parseCapturedAds, readCaptured, writeCaptured, CAPTURE_CAP } from '../src/research/capture.js';

const NOW = Date.parse('2026-08-17T00:00:00Z');

describe('parsing ads pasted out of the Ad Library', () => {
  it('reads advertiser, run length and copy out of a normal block', () => {
    const { ads } = parseCapturedAds(
      `Austin Orthodontics
Sponsored · running 37 days
Why families choose Austin Orthodontics: flexible payments and a free consultation.`,
      NOW,
    );
    expect(ads).toHaveLength(1);
    expect(ads[0]).toMatchObject({ page: 'Austin Orthodontics', daysRunning: 37 });
    expect(ads[0]!.body).toContain('flexible payments');
    expect(ads[0]!.body).not.toMatch(/sponsored/i); // status lines are not ad copy
  });

  it('converts a start date into a run length', () => {
    const { ads } = parseCapturedAds(
      `Elite Dentistry
Started running on Jul 18, 2026
Austin teeth for $8,999 all-on-4 per arch.`,
      NOW,
    );
    expect(ads[0]!.daysRunning).toBe(30);
    expect(ads[0]!.started).toBe('2026-07-18T00:00:00.000Z');
  });

  it('expands Meta\'s "· N ads" into variants — that count is the replication signal', () => {
    const { ads } = parseCapturedAds(
      `Smile Doctors
Sponsored · running 18 days · 4 ads
Save up to $500 on braces or aligners.`,
      NOW,
    );
    expect(ads).toHaveLength(4);
    expect(new Set(ads.map((a) => a.page))).toEqual(new Set(['Smile Doctors']));
    expect(ads.every((a) => a.daysRunning === 18)).toBe(true);
  });

  it('handles several ads separated by blank lines', () => {
    const { ads } = parseCapturedAds(
      `Acme Roofing
running 40 days
0% APR financing on a new roof.

Bravo Exteriors
running 12 days
Free roof inspection after the storm.`,
      NOW,
    );
    expect(ads.map((a) => a.page)).toEqual(['Acme Roofing', 'Bravo Exteriors']);
  });

  it('records no run length rather than inventing one, and says how many', () => {
    const { ads, undated } = parseCapturedAds(
      `Acme Roofing
0% APR financing on a new roof.`,
      NOW,
    );
    expect(ads[0]!.daysRunning).toBeUndefined();
    expect(undated).toBe(1);
  });

  it('refuses a stray year masquerading as a day count', () => {
    const { ads } = parseCapturedAds(
      `Acme Roofing
Started running on 2026
Free estimate today.`,
      NOW,
    );
    expect(ads[0]!.daysRunning).toBeUndefined();
  });

  it('ignores a future start date instead of producing negative days', () => {
    const { ads } = parseCapturedAds(
      `Acme Roofing
Started running on Dec 1, 2027
Free estimate today.`,
      NOW,
    );
    expect(ads[0]!.daysRunning).toBeUndefined();
  });

  it('skips a block with a name but no ad copy, and reports the skip', () => {
    const { ads, skipped } = parseCapturedAds(
      `Acme Roofing
Sponsored · running 40 days

Bravo Exteriors
running 12 days
Free roof inspection.`,
      NOW,
    );
    expect(ads.map((a) => a.page)).toEqual(['Bravo Exteriors']);
    expect(skipped).toBe(1);
  });

  it('drops Ad Library chrome that is not ad copy', () => {
    const { ads } = parseCapturedAds(
      `Acme Roofing
Sponsored · running 40 days
Library ID: 1234567890
See ad details
0% APR financing on a new roof.`,
      NOW,
    );
    expect(ads[0]!.body).toBe('0% APR financing on a new roof.');
  });

  it('returns nothing for empty or junk input rather than a phantom ad', () => {
    expect(parseCapturedAds('', NOW).ads).toEqual([]);
    expect(parseCapturedAds('   \n\n  ', NOW).ads).toEqual([]);
  });
});

describe('storing captured ads', () => {
  it('reads back what was written', () => {
    const data: Record<string, unknown> = {};
    const { ads } = parseCapturedAds('Acme Roofing\nrunning 40 days\n0% APR financing.', NOW);
    writeCaptured(data, ads);
    expect(readCaptured(data)).toHaveLength(1);
  });

  it('caps the set, because it lives in the blob every request parses', () => {
    const data: Record<string, unknown> = {};
    const many = Array.from({ length: CAPTURE_CAP + 50 }, (_, i) => ({
      id: `x${i}`, page: 'P', body: 'b', platforms: ['facebook'],
    }));
    writeCaptured(data, many);
    expect(readCaptured(data)).toHaveLength(CAPTURE_CAP);
  });

  it('reads an empty list from an account that has captured nothing', () => {
    expect(readCaptured({})).toEqual([]);
    expect(readCaptured({ capturedAds: 'nonsense' })).toEqual([]);
  });
});
