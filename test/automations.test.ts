import { describe, expect, it } from 'vitest';
import { noShowText, onboardingText, emptyAutomationsState } from '../src/agents/automations.js';

describe('automations templates', () => {
  it('no-show text uses the first name, business, and calendar link when set', () => {
    const t = noShowText({ business: 'Philly Roofing Co' }, 'Dana Smith', 'https://cal.link/x');
    expect(t).toContain('Dana,');
    expect(t).toContain('Philly Roofing Co');
    expect(t).toContain('https://cal.link/x');
  });

  it('no-show text falls back to "reply here" without a calendar link', () => {
    expect(noShowText({ business: 'Acme' }, 'Sam').toLowerCase()).toContain('reply here');
  });

  it('onboarding text welcomes by first name and names the business', () => {
    const t = onboardingText({ business: 'Acme Roofing' }, 'Chris Lee');
    expect(t).toContain('Chris');
    expect(t).toContain('Acme Roofing');
    expect(t.toLowerCase()).toContain('welcome');
  });

  it('empty state has both plays off', () => {
    const s = emptyAutomationsState();
    expect(s.noShow.enabled).toBe(false);
    expect(s.onboarding.enabled).toBe(false);
  });
});
