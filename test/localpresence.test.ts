import { describe, expect, it } from 'vitest';
import { buildLocalPresenceAudit, gbpChecks, lsaChecks, gbpCompletenessScore } from '../src/agents/localpresence.js';

describe('Local Presence audit', () => {
  it('builds GBP and LSA checks from the spec with weights', () => {
    expect(gbpChecks().length).toBeGreaterThanOrEqual(14);
    expect(lsaChecks().length).toBeGreaterThanOrEqual(12);
    gbpChecks().forEach((c) => expect([1, 2, 3]).toContain(c.weight));
  });

  it('unknown answers count as gaps — score only rises on yes', () => {
    const empty = buildLocalPresenceAudit({}, {});
    expect(empty.gbp.score).toBe(0);
    const some = buildLocalPresenceAudit({ 'gbp.claimed': 'yes', 'gbp.primary_category': 'yes' }, {});
    expect(some.gbp.score).toBe(6); // two weight-3 items
  });

  it('auto-answers website from the business profile', () => {
    const a = buildLocalPresenceAudit({}, { website: 'https://paintersinphilly.com' });
    expect(a.gbp.items.find((i) => i.key === 'gbp.website')!.answer).toBe('yes');
    const b = buildLocalPresenceAudit({}, { website: 'http://insecure.com' });
    expect(b.gbp.items.find((i) => i.key === 'gbp.website')!.answer).toBe('no');
  });

  it('owner answers override auto answers', () => {
    const a = buildLocalPresenceAudit({ 'gbp.website': 'no' }, { website: 'https://x.com' });
    expect(a.gbp.items.find((i) => i.key === 'gbp.website')!.answer).toBe('no');
  });

  it('priorities are the heaviest unfixed items, capped at 6', () => {
    const a = buildLocalPresenceAudit({}, {});
    expect(a.priorities.length).toBe(6);
    // every surfaced priority should be ranking-critical (weight 3) when nothing is done
    const w3keys = [...gbpChecks(), ...lsaChecks()].filter((c) => c.weight === 3).map((c) => c.key);
    a.priorities.forEach((p) => expect(w3keys).toContain(p.key));
  });

  it('completeness score is a 0-100 percent', () => {
    const none = buildLocalPresenceAudit({}, {});
    expect(gbpCompletenessScore(none)).toBe(0);
    const allYes: Record<string, 'yes'> = {};
    gbpChecks().forEach((c) => { allYes[c.key] = 'yes'; });
    expect(gbpCompletenessScore(buildLocalPresenceAudit(allYes, {}))).toBe(100);
  });
});
