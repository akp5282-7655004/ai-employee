import { describe, expect, it } from 'vitest';
import { SKILL_CATALOG, findSkill, findPlay, catalogForClient } from '../src/skills/catalog.js';

describe('skill catalog', () => {
  it('every skill has real plays with system prompts', () => {
    expect(SKILL_CATALOG.length).toBeGreaterThanOrEqual(8);
    for (const s of SKILL_CATALOG) {
      expect(s.plays.length).toBeGreaterThan(0);
      for (const p of s.plays) expect(p.system.length).toBeGreaterThan(40);
    }
  });
  it('finds a skill and a play', () => {
    expect(findSkill('google-ads')!.name).toBe('Google Ads Toolkit');
    expect(findPlay('google-ads', 'rsa')!.play.label).toContain('RSA');
    expect(findPlay('google-ads', 'nope')).toBeUndefined();
    expect(findPlay('nope', 'rsa')).toBeUndefined();
  });
  it('the client catalog exposes plays but NOT the internal system prompts', () => {
    const c = catalogForClient();
    const ga = c.find((s) => s.id === 'google-ads')!;
    expect(ga.plays[0]).toHaveProperty('label');
    expect(JSON.stringify(c)).not.toContain('You are a Google Ads');
  });
});
