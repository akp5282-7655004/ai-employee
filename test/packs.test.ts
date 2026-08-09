import { describe, expect, it } from 'vitest';
import {
  getPack,
  listPacks,
  DEFAULT_PACK_ID,
  PACKS,
  channelWeights,
  budgetBand,
  suggestOffers,
  checkClaims,
} from '../src/packs/index.js';

describe('pack registry', () => {
  it('defaults to home services and falls back for unknown ids', () => {
    expect(getPack().id).toBe('home_services');
    expect(getPack('dental').id).toBe('dental');
    expect(getPack('nope').id).toBe(DEFAULT_PACK_ID);
    expect(listPacks().length).toBe(Object.keys(PACKS).length);
  });

  it('every pack is internally consistent (band weights sum to 1 over paid channels)', () => {
    for (const pack of listPacks()) {
      for (const band of ['starter', 'growth', 'scale'] as const) {
        const w = pack.economics.bandWeights[band];
        expect(w.lsa + w.search + w.social).toBeCloseTo(1, 5);
        expect(w.managed_profile).toBe(0);
      }
      expect(pack.categories.length).toBeGreaterThan(0);
    }
  });
});

describe('the four knobs move the plan', () => {
  it('paid weights always renormalize to 1', () => {
    for (const budget of [800, 5000, 12000]) {
      const w = channelWeights(getPack('home_services'), { category: 'plumbing', monthlyBudget: budget, goal: 'more_calls' });
      expect(w.lsa + w.search + w.social).toBeCloseTo(1, 5);
    }
  });

  it('dental leans off LSA toward Search vs. home services at the same budget', () => {
    const hs = channelWeights(getPack('home_services'), { category: 'plumbing', monthlyBudget: 5000, goal: 'more_calls' });
    const dn = channelWeights(getPack('dental'), { category: 'general', monthlyBudget: 5000, goal: 'more_calls' });
    expect(hs.lsa).toBeGreaterThan(hs.search); // trades lead with LSA
    expect(dn.search).toBeGreaterThan(dn.lsa); // dental leads with Search
    expect(dn.lsa).toBeLessThan(hs.lsa);
    expect(dn.social).toBeGreaterThan(hs.social);
  });

  it('banding follows each pack\'s own thresholds', () => {
    expect(budgetBand(getPack('home_services'), 1000)).toBe('starter'); // < 1500
    expect(budgetBand(getPack('dental'), 1000)).toBe('starter'); // < 3000
    expect(budgetBand(getPack('dental'), 2500)).toBe('starter'); // dental growth starts at 3000
    expect(budgetBand(getPack('home_services'), 2500)).toBe('growth'); // hs growth starts at 1500
  });

  it('suggests offers scoped to the category first', () => {
    const offers = suggestOffers(getPack('dental'), 'cosmetic');
    expect(offers.length).toBeGreaterThan(0);
    expect(offers[0]!.headline).toMatch(/whitening/i);
  });
});

describe('claims checklist (honesty guardrail)', () => {
  it('enforces the universal rules in every vertical', () => {
    expect(checkClaims(getPack('home_services'), 'We guarantee the #1 lowest price').ok).toBe(false);
    expect(checkClaims(getPack('dental'), 'Only 3 slots left!').ok).toBe(false);
  });

  it('dental blocks health-outcome claims that home services never sees', () => {
    const text = 'Gentle, pain-free dentistry for the whole family';
    expect(checkClaims(getPack('home_services'), text).ok).toBe(true); // no such rule for trades
    const dn = checkClaims(getPack('dental'), text);
    expect(dn.ok).toBe(false);
    expect(dn.violations.join(' ')).toMatch(/pain/i);
  });

  it('passes clean copy', () => {
    expect(checkClaims(getPack('home_services'), 'Same-day drain clearing in your area. Book online.').ok).toBe(true);
  });
});
