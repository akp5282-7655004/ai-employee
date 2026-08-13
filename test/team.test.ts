import { describe, it, expect } from 'vitest';
import { CMO_AREAS, strategistPrompt, contentPrompt, socialPrompt, adsPrompt, fallbackStrategist, fallbackContribution, type TeamCtx } from '../src/agents/team.js';

const ctx: TeamCtx = { business: 'Rapid Painting Co', trade: 'Painting', city: 'Philadelphia', services: 'interior painting', offers: '10% off' };

describe('Miles as CMO', () => {
  it('covers the full marketing function, each area with skills and a tool link', () => {
    expect(CMO_AREAS.length).toBeGreaterThanOrEqual(5);
    for (const a of CMO_AREAS) {
      expect(a.title && a.blurb).toBeTruthy();
      expect(a.skills.length).toBeGreaterThan(0);
      expect(a.tool.page).toBeTruthy();
    }
    expect(CMO_AREAS.map((a) => a.id)).toContain('strategist');
  });

  it('every prompt is authored by Miles (one voice), carrying business + goal', () => {
    const { system, user } = strategistPrompt('launch a spring promo', ctx);
    expect(system).toContain('Miles');
    expect(user).toContain('Rapid Painting Co');
    expect(user).toContain('launch a spring promo');
  });

  it('each campaign part builds from the same angle, still as Miles', () => {
    const angle = 'ANGLE: the trusted local painters';
    for (const build of [contentPrompt, socialPrompt, adsPrompt]) {
      const { system, user } = build('goal', angle, ctx);
      expect(system).toContain('Miles');
      expect(user).toContain(angle);
    }
  });

  it('fallbacks produce non-empty templated output', () => {
    expect(fallbackStrategist('goal', ctx).length).toBeGreaterThan(10);
    for (const id of ['content', 'social', 'ads']) expect(fallbackContribution(id, 'goal', ctx).length).toBeGreaterThan(5);
  });
});
