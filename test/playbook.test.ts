import { describe, expect, it } from 'vitest';
import { buildPlaybook } from '../src/agents/playbook.js';

describe('buildPlaybook', () => {
  it('works backwards from the job: ticket → gross profit → allowable CAC', () => {
    const pb = buildPlaybook({ ticket: 14000 }, { trade: 'Roofing', business: 'Philly Roofing Co' });
    expect(pb.trade).toBe('roofing');
    expect(pb.economics.ticket).toBe(14000);
    expect(pb.economics.grossProfit).toBe(14000 * 0.4);
    // allowable CAC is ~30% of gross profit
    expect(pb.economics.allowableCac).toBe(Math.round(14000 * 0.4 * 0.3));
    // leads-per-sold derived from the speed-to-lead funnel, never fabricated
    expect(pb.economics.funnel.leadsPerSold).toBeGreaterThan(1);
    expect(pb.economics.testBudgetDaily).toBeGreaterThan(0);
  });

  it('detects the trade from free-text industry and falls back to roofing', () => {
    expect(buildPlaybook({}, { trade: 'HVAC & Cooling' }).trade).toBe('hvac');
    expect(buildPlaybook({}, { trade: 'Painting' }).trade).toBe('painting');
    expect(buildPlaybook({}, { trade: 'something unknown' }).trade).toBe('roofing');
  });

  it('engineers the offer with a deadline, reason-why and risk reversal — never a naked discount', () => {
    const pb = buildPlaybook({ offer: '$500 off a new roof', financing: true }, { trade: 'roofing' });
    expect(pb.offer.engineered).toContain('$500 off a new roof');
    expect(pb.offer.engineered).toMatch(/booked by/i);
    expect(pb.offer.reasonWhy.length).toBeGreaterThan(10);
    expect(pb.offer.riskReversal.length).toBeGreaterThan(0);
    expect(pb.offer.financing).toMatch(/mo/); // monthly-payment reframe present when financing on
  });

  it('splits roofing into pitched + flat ad sets plus retargeting', () => {
    const pb = buildPlaybook({}, { trade: 'roofing' });
    expect(pb.architecture.prospecting.length).toBe(2);
    expect(pb.architecture.retargeting.segment).toMatch(/viewers|engagers|abandon/i);
  });

  it('uses a single prospecting ad set for non-segmented trades', () => {
    const pb = buildPlaybook({}, { trade: 'plumbing' });
    expect(pb.architecture.prospecting.length).toBe(1);
  });

  it('always produces a full, runnable plan (form, cadence, scorecard)', () => {
    const pb = buildPlaybook({}, { trade: 'solar', channel: 'meta' });
    expect(pb.instantForm.questions.length).toBeGreaterThanOrEqual(4);
    expect(pb.cadence.launchChecklist.length).toBeGreaterThan(0);
    expect(pb.cadence.scorecard).toContain('ROAS');
    expect(pb.channel).toBe('meta');
  });
});
