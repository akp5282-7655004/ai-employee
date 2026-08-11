import { describe, expect, it } from 'vitest';
import { scoreComplexity, qualityBar, route, type ComplexitySignals } from '../src/router/router.js';

const sig = (o: Partial<ComplexitySignals>): ComplexitySignals => ({ reasoning: 0, tools: 0, context: 0, stakes: 0, ambiguity: 0, ...o });

describe('scoreComplexity', () => {
  it('sums signals to 0–14 and clamps each range', () => {
    expect(scoreComplexity(sig({ reasoning: 4, tools: 3, context: 2, stakes: 3, ambiguity: 2 }))).toBe(14);
    expect(scoreComplexity(sig({ reasoning: 99 }))).toBe(4); // clamped
    expect(scoreComplexity(sig({}))).toBe(0);
  });
});

describe('qualityBar', () => {
  it('raises the bar for a premium brand at equal complexity', () => {
    const budget = qualityBar(4, 'balanced', { premiumBrand: false });
    const premium = qualityBar(4, 'balanced', { premiumBrand: true });
    expect(premium).toBeGreaterThan(budget);
  });
  it('the customer setting shifts the whole bar', () => {
    expect(qualityBar(7, 'value')).toBeLessThan(qualityBar(7, 'balanced'));
    expect(qualityBar(7, 'max')).toBeGreaterThan(qualityBar(7, 'balanced'));
  });
});

describe('route', () => {
  it('sends a trivial low-stakes task to the value tier', () => {
    const d = route({ taskShape: 'social_post', signals: sig({ reasoning: 1 }), quality: 'value' });
    expect(d.tier).toBe('value');
  });
  it('a simple post for a premium brand can demand a higher tier than a startup', () => {
    const startup = route({ taskShape: 'social_post', signals: sig({ reasoning: 1 }), quality: 'balanced', intake: { premiumBrand: false } });
    const premium = route({ taskShape: 'social_post', signals: sig({ reasoning: 1 }), quality: 'balanced', intake: { premiumBrand: true } });
    expect(premium.qualityBar).toBeGreaterThan(startup.qualityBar);
  });
  it('hard strategy work lands on max', () => {
    const d = route({ taskShape: 'strategy', signals: sig({ reasoning: 4, tools: 3, context: 2, ambiguity: 2 }), quality: 'max', intake: { premiumBrand: true } });
    expect(d.tier).toBe('max');
  });
  it('safety floor: a money-moving action never runs on the value tier', () => {
    const d = route({ taskShape: 'launch_campaign', signals: sig({ reasoning: 0 }), quality: 'value', moneyAction: true });
    expect(d.tier).toBe('balanced');
    expect(d.escalated).toBe(true);
  });
  it('non-money value tasks are not escalated', () => {
    const d = route({ taskShape: 'reformat', signals: sig({}), quality: 'value', moneyAction: false });
    expect(d.escalated).toBe(false);
  });
});
