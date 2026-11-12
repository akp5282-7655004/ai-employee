import { describe, expect, it } from 'vitest';
import { goalCheck } from '../src/agents/goalcheck.js';
import {
  expectationReadout,
  projectBudget,
  readExpectation,
  storeExpectation,
  tradeBookRate,
} from '../src/agents/budgetexpect.js';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import type { Connector } from '../src/connectors/types.js';

const painting = () => projectBudget({
  trade: 'Painting',
  city: 'Philadelphia',
  monthlyBudget: 608,
  channel: 'google_ads',
  now: new Date('2026-11-12T16:00:00Z'),
})!;

describe('budget projection math', () => {
  it('projects a $608 painting month in Philadelphia from the Google Ads blended and non-brand figures', () => {
    const projection = painting();
    expect(projection.benchmark.fallback).toBe(true);
    expect(projection.benchmark.estimateLabel).toMatch(/similar home-services trades/i);
    expect(projection.benchmark.sourceLabel).toBe('Industry benchmarks, aggregated from public sources');
    expect(projection.benchmark.highCpl).toMatchObject({ kind: 'non_brand', cpl: 149, bookRatePct: 37.6, costPerCustomer: 804 });
    expect(projection.benchmark.lowCpl).toMatchObject({ kind: 'blended', cpl: 104, bookRatePct: 41.7, costPerCustomer: 472 });
    expect(projection.benchmark.highCpl.leadsExact).toBeCloseTo(608 / 149, 6);
    expect(projection.benchmark.lowCpl.leadsExact).toBeCloseTo(608 / 104, 6);
    expect(projection.benchmark.highCpl.jobsExact).toBeCloseTo((608 / 149) * 0.376, 6);
    expect(projection.benchmark.lowCpl.jobsExact).toBeCloseTo((608 / 104) * 0.417, 6);
    expect(projection.range.leads).toEqual({ low: 4, high: 6 });
    expect(projection.range.jobs).toEqual({ low: 1.5, high: 2.4 });
    expect(projection.inputs).toMatchObject({ city: 'Philadelphia', monthlyBudget: 608, channel: 'google_ads' });
    expect(projection.computedAt).toBe('2026-11-12T16:00:00.000Z');
    expect(projection.copy).toMatch(/\$608/);
    expect(projection.copy).toMatch(/about 4 to 6 leads/);
    expect(projection.copy).toMatch(/1\.5 to 2\.4 booked jobs/);
    expect(projection.copy).toMatch(/similar home-services trades/);
    expect(projection.copy).toMatch(/Philadelphia/);
    expect(projection.copy).toMatch(/\$472 to \$804/);
    expect(projection.copy).not.toMatch(/\$40/);
    expect(projection.copy.toLowerCase()).not.toContain('searchlight');
    expect(projection.copy).not.toContain('\u2014');
    const check = goalCheck({ trade: 'Painting', city: 'Philadelphia', budgetAmount: 608, budgetPeriod: 'month', leadGoal: 2, leadPeriod: 'month' });
    expect(check.leads).toEqual({ low: 4, typical: 4, high: 6 });
    expect(check.leads && { low: check.leads.low, high: check.leads.high }).toEqual(projection.range.leads);
  });

  it('uses the plumbing Google Ads row, not the similar-trades fallback', () => {
    const projection = projectBudget({ trade: 'Plumbing', city: 'Philadelphia', monthlyBudget: 600 })!;
    expect(projection.benchmark.fallback).toBe(false);
    expect(projection.benchmark.highCpl.cpl).toBe(183);
    expect(projection.benchmark.lowCpl.cpl).toBe(168);
    expect(projection.benchmark.highCpl.bookRatePct).toBe(37.6);
    expect(tradeBookRate('Plumbing')).toBeNull();
    expect(projection.range.leads).toEqual({ low: 3, high: 4 });
    const check = goalCheck({ trade: 'Plumbing', city: 'Philadelphia', budgetAmount: 20, budgetPeriod: 'day', leadGoal: 3, leadPeriod: 'month' });
    expect(check.leads && { low: check.leads.low, high: check.leads.high }).toEqual(projection.range.leads);
    expect(projection.copy).toMatch(/does not list its own/);
    expect(projection.copy.toLowerCase()).not.toContain('searchlight');
  });

  it('uses the electrical book rate published on that row', () => {
    expect(tradeBookRate('Electrical')).toBe(41.2);
    const projection = projectBudget({ trade: 'Electrical', city: 'Austin', monthlyBudget: 600 })!;
    expect(projection.benchmark.highCpl.bookRatePct).toBe(41.2);
    expect(projection.benchmark.lowCpl.bookRatePct).toBe(41.2);
    expect(projection.benchmark.highCpl.cpl).toBe(163);
    expect(projection.benchmark.lowCpl.cpl).toBe(128);
    expect(projection.benchmark.highCpl.costPerCustomer).toBeNull();
    expect(projection.copy).toMatch(/\$804/);
    expect(projection.copy).toMatch(/not for Electrical alone/);
  });

  it('uses Local Services Ads figures only when that channel is the one being run', () => {
    const lsa = projectBudget({ trade: 'Plumbing', city: 'Philadelphia', monthlyBudget: 600, channel: 'lsa' })!;
    expect(lsa.benchmark.channel).toBe('lsa');
    expect(lsa.benchmark.fallback).toBe(false);
    expect(lsa.benchmark.highCpl.cpl).toBe(57);
    expect(lsa.benchmark.highCpl.bookRatePct).toBe(44.5);
    const paintingLsa = projectBudget({ trade: 'Painting', monthlyBudget: 608, channel: 'lsa' })!;
    expect(paintingLsa.benchmark.fallback).toBe(true);
    expect(paintingLsa.benchmark.highCpl).toMatchObject({ cpl: 53, bookRatePct: 43.9, costPerCustomer: 233 });
    expect(paintingLsa.copy).toMatch(/similar home-services trades/);
    expect(paintingLsa.copy).toMatch(/Local Services Ads/);
  });
});

describe('projection storage', () => {
  it('stores the projection and does not replace it once a campaign exists', () => {
    const data: Record<string, unknown> = {};
    const first = painting();
    expect(storeExpectation(data, first, false)).toEqual({ current: first, wrote: true });
    expect(readExpectation(data)?.inputs.monthlyBudget).toBe(608);
    const later = projectBudget({ trade: 'Plumbing', monthlyBudget: 9000, now: new Date('2026-12-01T00:00:00Z') })!;
    expect(storeExpectation(data, later, true)).toEqual({ current: first, wrote: false });
    expect(readExpectation(data)?.inputs.trade).toBe('Painting');
    const empty: Record<string, unknown> = {};
    expect(storeExpectation(empty, later, true)).toEqual({ current: null, wrote: false });
    expect(readExpectation(empty)).toBeNull();
  });
});

describe('live readout', () => {
  const stored = painting();

  it('does not treat sample spend or sample leads as real', () => {
    const readout = expectationReadout(stored, { live: true, sample: true, spend: 1240, leads: 38, liveDays: 10 });
    const text = `${readout.headline} ${readout.detail} ${readout.lines.map((line) => line.value).join(' ')}`;
    expect(readout.state).toBe('sample');
    expect(readout.lines).toEqual([]);
    expect(text).not.toMatch(/\$1,240|\$1240|\b38\b/);
    expect(text).toMatch(/example/i);
    expect(text).not.toContain('\u2014');
    expect(text.toLowerCase()).not.toContain('searchlight');
  });

  it('says so when the campaign is on and nothing has come back yet', () => {
    const readout = expectationReadout(stored, { live: true, sample: false, spend: 0, leads: 0, liveDays: 4 });
    expect(readout.state).toBe('waiting');
    expect(readout.headline).toMatch(/nothing to compare/i);
    expect(readout.detail).toMatch(/\$0 spent/);
    expect(readout.detail).toMatch(/0 tracked leads/);
    expect(readout.detail).toMatch(/about 4 to 6 leads/);
  });

  it('compares real spend and tracked leads with the saved projection', () => {
    const readout = expectationReadout(stored, { live: true, sample: false, spend: 180, leads: 3, liveDays: 40 });
    expect(readout.state).toBe('live');
    expect(readout.lines.map((line) => line.label)).toEqual(['Spent', 'Tracked leads', 'Cost per lead', 'Booked jobs from these leads']);
    expect(readout.lines[0]!.value).toBe('$180');
    expect(readout.lines[1]!.value).toBe('3');
    expect(readout.lines[2]!.value).toBe('$60');
    expect(readout.lines[3]!.value).toMatch(/1\.1 to 1\.3/);
    expect(readout.detail).toMatch(/behind the projection/);
    expect(readout.detail).toMatch(/\$608/);
    const partial = expectationReadout(stored, { live: true, sample: false, spend: 180, leads: 1, liveDays: 6 });
    expect(partial.detail).toMatch(/will not call a partial month/);
    const unknown = expectationReadout(null, { live: false, sample: false, spend: null, leads: null, liveDays: null });
    expect(unknown.state).toBe('empty');
    expect(unknown.detail).toMatch(/launch page/);
  });
});

describe('goal route stores the projection', () => {
  it('saves the painting projection before launch', async () => {
    const connector = {
      name: 'pipedream',
      async createConnectToken() { return { token: 't', expiresAt: '2099-01-01', connectUrl: 'https://connect.example' }; },
      async listAccounts() { return []; },
      async runAction() { return { ok: true, actionId: 'x', app: 'google_ads', output: null }; },
    } as unknown as Connector;
    const app = buildServer({ authStore: new MemoryStore(), connector });
    const signed = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'paint@example.com', password: 'password1', tos: true } });
    const headers = { cookie: String(signed.headers['set-cookie']).split(';')[0] };
    const html = '<html><head><title>Painters</title></head><body><p>Interior painting in Philadelphia, PA. Call 215-555-0199.</p></body></html>';
    await app.inject({ method: 'POST', url: '/api/miles/crawl', headers, payload: { businessName: 'Painters In Philly', location: 'Philadelphia, PA', website: 'https://painters.example', html } });
    const posted = await app.inject({ method: 'POST', url: '/api/miles/goal', headers, payload: { budgetAmount: 608, budgetPeriod: 'month', leadGoal: 2, leadPeriod: 'month' } });
    expect(posted.statusCode).toBe(200);
    expect(posted.json().check.projection.range.leads).toEqual({ low: 4, high: 6 });
    expect(posted.json().check.projection.copy).toMatch(/similar home-services trades/);
    expect(JSON.stringify(posted.json()).toLowerCase()).not.toContain('searchlight');
    const saved = await app.inject({ method: 'GET', url: '/api/miles/goal', headers });
    expect(saved.json().expectation.inputs.monthlyBudget).toBe(608);
    expect(saved.json().expectation.benchmark.highCpl.cpl).toBe(149);
    expect(saved.json().expectation.computedAt).toBeTruthy();
    await app.close();
  });
});
