import { describe, expect, it } from 'vitest';
import { dueSkills, periodKey } from '../src/agents/skillclock.js';

describe('skill clocks', () => {
  const now = new Date('2026-11-09T15:00:00Z');

  it('gives each skill its own period', () => {
    expect(periodKey('loser-pauser', now)).toBe('2026-11-09');
    expect(periodKey('search-term-gold-miner', now)).toMatch(/^2026-W/);
    expect(periodKey('service-area-audience-builder', now)).toBe('2026-11');
  });

  it('is idempotent inside a period and due again after it', () => {
    const first = dueSkills({}, now);
    expect(first).toContain('budget-shifter');
    const last = Object.fromEntries(first.map((s) => [s, periodKey(s, now)]));
    expect(dueSkills(last, now)).toEqual([]);
    expect(dueSkills(last, new Date('2026-11-10T15:00:00Z'))).toContain('loser-pauser');
    expect(dueSkills(last, new Date('2026-11-10T15:00:00Z'))).not.toContain('search-term-gold-miner');
  });
});
