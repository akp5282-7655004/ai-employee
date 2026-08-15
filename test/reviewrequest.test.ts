import { describe, expect, it } from 'vitest';
import { reviewAskText, parseRating, routeRating, promoterText, detractorText, recoveryTask } from '../src/agents/reviewrequest.js';

describe('reviewrequest', () => {
  it('asks 1-10 with the business name', () => {
    const t = reviewAskText({ business: 'Philly Roofing Co' });
    expect(t).toContain('Philly Roofing Co');
    expect(t).toMatch(/1-10/);
  });

  it('parses a rating out of free text and rejects out-of-range', () => {
    expect(parseRating('9')).toBe(9);
    expect(parseRating("I'd say a 10, great job")).toBe(10);
    expect(parseRating('8/10')).toBe(8);
    expect(parseRating('no number here')).toBeNull();
    expect(parseRating('11')).toBeNull(); // 1 matched? guard: "11" → \b(10|[0-9])\b won't match 11 as 10; matches '1'? boundary — no, 11 has no standalone 1
  });

  it('routes 9-10 to promoter, 1-8 to detractor', () => {
    expect(routeRating(10)).toBe('promoter');
    expect(routeRating(9)).toBe('promoter');
    expect(routeRating(8)).toBe('detractor');
    expect(routeRating(1)).toBe('detractor');
  });

  it('promoter text includes the Google link; detractor never does', () => {
    const link = 'https://g.page/r/abc/review';
    expect(promoterText({ business: 'Acme' }, link)).toContain(link);
    const det = detractorText({ business: 'Acme' });
    expect(det).not.toContain('http');
    expect(det.toLowerCase()).toContain('make this right');
  });

  it('recovery task names the score', () => {
    expect(recoveryTask('Dana', 4)).toContain('4/10');
    expect(recoveryTask(undefined, 6)).toContain('customer');
  });
});
