import { describe, expect, it } from 'vitest';
import { DEFAULT_CAPS, decidePolicy, type PolicyInput } from '../src/agents/policy.js';
import { planGo } from '../src/agents/milesrun.js';

function input(over: Partial<PolicyInput> = {}): PolicyInput {
  return {
    mode: 'automate',
    caps: { ...DEFAULT_CAPS },
    spentToday: 0,
    spentMonth: 0,
    action: { area: 'ppc', kind: 'enable', spend: 20, canPush: true },
    ...over,
  };
}

describe('approval policy', () => {
  it('auto-applies inside the caps the owner set', () => {
    const d = decidePolicy(input());
    expect(d.effect).toBe('apply');
    expect(d.reason).toMatch(/Inside the daily budget/);
  });

  it('queues an automate action that would pass the daily or monthly cap or the percent cap', () => {
    expect(decidePolicy(input({ spentToday: 10, action: { area: 'ppc', kind: 'optimize', spend: 15, canPush: true } })).effect).toBe('queue');
    expect(decidePolicy(input({ spentMonth: 590, action: { area: 'ppc', kind: 'enable', spend: 20, canPush: true } })).effect).toBe('queue');
    expect(decidePolicy(input({ action: { area: 'ppc', kind: 'optimize', changePct: 25, spend: 0, canPush: true } })).effect).toBe('queue');
  });

  it('hybrid always queues, even inside the caps', () => {
    const d = decidePolicy(input({ mode: 'hybrid' }));
    expect(d.effect).toBe('queue');
  });

  it('manual never acts', () => {
    expect(decidePolicy(input({ mode: 'manual' })).effect).toBe('skip');
    expect(decidePolicy(input({ mode: 'manual', action: { area: 'ppc', kind: 'optimize', spend: 0, canPush: true } })).effect).toBe('skip');
  });

  it('lets one area override the account mode', () => {
    const d = decidePolicy(input({ mode: 'automate', areaModes: { social: 'hybrid' }, action: { area: 'social', kind: 'publish', spend: 0, canPush: true } }));
    expect(d.effect).toBe('queue');
    expect(d.mode).toBe('hybrid');
  });

  it('holds a channel that has no verified push', () => {
    const d = decidePolicy(input({ action: { area: 'ppc', kind: 'create', spend: 0, canPush: false } }));
    expect(d.effect).toBe('hold');
    expect(d.reason).toMatch(/no verified way to push/);
  });

  it('kill switch stops every mode', () => {
    const caps = { ...DEFAULT_CAPS, paused: true };
    expect(decidePolicy(input({ caps })).effect).toBe('skip');
    expect(decidePolicy(input({ mode: 'hybrid', caps })).effect).toBe('skip');
  });

  it('starts a $20 Google campaign inside automate caps and queues hybrid', () => {
    const caps = { ...DEFAULT_CAPS, dailyBudget: 20, monthlyCeiling: 600 };
    const auto = planGo({ mode: 'automate', caps, spentToday: 0, spentMonth: 0, dailySpend: 20 });
    expect(auto.create.effect).toBe('apply');
    expect(auto.enable.effect).toBe('apply');
    const hybrid = planGo({ mode: 'hybrid', caps, spentToday: 0, spentMonth: 0, dailySpend: 20 });
    expect(hybrid.create.effect).toBe('queue');
    expect(hybrid.enable.effect).toBe('skip');
    const manual = planGo({ mode: 'manual', caps, spentToday: 0, spentMonth: 0, dailySpend: 20 });
    expect(manual.create.effect).toBe('skip');
    const over = planGo({ mode: 'automate', caps, spentToday: 5, spentMonth: 0, dailySpend: 20 });
    expect(over.create.effect).toBe('apply');
    expect(over.enable.effect).toBe('queue');
    const approved = planGo({ mode: 'hybrid', caps, spentToday: 0, spentMonth: 0, dailySpend: 20, explicitCreate: true });
    const again = planGo({ mode: 'automate', caps, spentToday: 0, spentMonth: 0, dailySpend: 20, campaignOnFile: true });
    expect(again.create.effect).toBe('skip');
    expect(again.create.reason).toMatch(/will not create another/);
    expect(again.enable.effect).toBe('apply');
    expect(approved.create.effect).toBe('apply');
    expect(approved.enable.effect).toBe('queue');
  });
});
