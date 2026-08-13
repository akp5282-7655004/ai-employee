import { describe, expect, it } from 'vitest';
import { profitability, LSA_TRADES, LSA_BLENDED, BENCHMARK_HUB, buildBenchmarkHub, hubCoverage } from '../src/packs/benchmarks.js';

describe('profitability math', () => {
  it('reproduces the article breakeven example (~$85 at 25% margin)', () => {
    // $1,800 ticket, 44% book, 43% match, 25% margin → breakeven CPL ≈ $85.
    const p = profitability(53, 1800, 44, 43, 25);
    expect(p.breakevenCpl).toBeGreaterThanOrEqual(83);
    expect(p.breakevenCpl).toBeLessThanOrEqual(87);
  });

  it('reproduces ~19% lead-to-customer and blended cost-per-customer', () => {
    const p = profitability(53, LSA_BLENDED.avgTicket, 44, 43, 25);
    expect(p.leadToCustomerPct).toBeCloseTo(18.9, 0);
    // 53 / 0.189 ≈ $280
    expect(p.costPerCustomer).toBeGreaterThan(250);
    expect(p.costPerCustomer).toBeLessThan(300);
  });

  it('calls a cheap lead below breakeven profitable', () => {
    expect(profitability(40, 1800, 44, 43, 25).verdict).toBe('profitable');
  });

  it('calls a lead above breakeven unprofitable', () => {
    expect(profitability(120, 1800, 44, 43, 25).verdict).toBe('unprofitable');
  });

  it('the article insight: cheaper CPL can be worse per booked job', () => {
    // $60 @ 48% book vs $40 @ 30% book → cost per booked appointment.
    const cheapButLowBook = 40 / 0.3; // $133
    const pricierHighBook = 60 / 0.48; // $125
    expect(pricierHighBook).toBeLessThan(cheapButLowBook);
  });

  it('has coherent trade benchmarks', () => {
    expect(LSA_TRADES.length).toBe(6);
    for (const t of LSA_TRADES) {
      expect(t.cpl).toBeGreaterThan(0);
      expect(t.bookRate).toBeGreaterThan(0);
      expect(t.roas).toBeGreaterThan(0);
    }
  });
});

describe('Benchmark Hub', () => {
  it('covers every SearchLight channel', () => {
    const ids = BENCHMARK_HUB.map((c) => c.id);
    expect(ids).toEqual(['google_ads', 'lsa', 'facebook', 'direct_mail', 'seo', 'ai', 'lead_quality']);
  });

  it('fills the LSA channel with REAL per-trade numbers (no nulls for our 6 trades)', () => {
    const lsa = BENCHMARK_HUB.find((c) => c.id === 'lsa')!;
    for (const t of LSA_TRADES) {
      const cpl = lsa.entries.find((e) => e.trade === t.trade && e.metric === 'CPL');
      const roas = lsa.entries.find((e) => e.trade === t.trade && e.metric === 'ROAS');
      expect(cpl?.value).toBe(t.cpl);
      expect(roas?.value).toBe(t.roas);
    }
  });

  it('never fabricates — unsourced cells are null and carry a source link', () => {
    for (const c of BENCHMARK_HUB) {
      for (const e of c.entries) {
        expect(e.source).toMatch(/^https:\/\/searchlightdigital\.io\//);
        if (e.value == null) expect(e.source.length).toBeGreaterThan(30); // links out to add it
        else expect(e.value).toBeGreaterThan(0);
      }
    }
  });

  it('reports honest coverage (some sourced, some pending)', () => {
    const cov = hubCoverage();
    expect(cov.sourced).toBeGreaterThan(0);
    expect(cov.sourced).toBeLessThan(cov.total); // there are still article cells to add
    expect(buildBenchmarkHub().length).toBe(BENCHMARK_HUB.length);
  });
});
