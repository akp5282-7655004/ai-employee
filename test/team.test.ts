import { describe, it, expect } from 'vitest';
import { TEAM, strategistPrompt, contentPrompt, socialPrompt, adsPrompt, fallbackStrategist, fallbackContribution, type TeamCtx } from '../src/agents/team.js';

const ctx: TeamCtx = { business: 'Rapid Painting Co', trade: 'Painting', city: 'Philadelphia', services: 'interior painting', offers: '10% off' };

describe('marketing team', () => {
  it('ships a full roster with roles, skills, and a tool link each', () => {
    expect(TEAM.length).toBeGreaterThanOrEqual(5);
    for (const s of TEAM) {
      expect(s.name && s.role && s.blurb).toBeTruthy();
      expect(s.skills.length).toBeGreaterThan(0);
      expect(s.tool.page).toBeTruthy();
    }
    expect(TEAM.map((s) => s.id)).toContain('strategist');
  });

  it('the strategist prompt carries the business and the goal', () => {
    const { system, user } = strategistPrompt('launch a spring promo', ctx);
    expect(system.toLowerCase()).toContain('strateg');
    expect(user).toContain('Rapid Painting Co');
    expect(user).toContain('launch a spring promo');
  });

  it('downstream specialists build from the strategist angle', () => {
    const angle = 'ANGLE: the trusted local painters';
    for (const build of [contentPrompt, socialPrompt, adsPrompt]) {
      const { user } = build('goal', angle, ctx);
      expect(user).toContain(angle);
      expect(user).toContain('Rapid Painting Co');
    }
  });

  it('fallbacks produce non-empty templated output for every specialist', () => {
    expect(fallbackStrategist('goal', ctx).length).toBeGreaterThan(10);
    for (const s of TEAM) expect(fallbackContribution(s, 'goal', ctx).length).toBeGreaterThan(5);
  });
});
