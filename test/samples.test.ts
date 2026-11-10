import { describe, expect, it } from 'vitest';
import { getMetrics, liveFacts } from '../src/metrics/resolver.js';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import type { Connector } from '../src/connectors/types.js';
import { runSevenSkill } from '../src/skills/seven.js';

const KEYS = ['calc.blended_leads', 'calc.blended_spend', 'crm.booked_jobs', 'crm.job_revenue', 'calc.blended_cpl', 'calc.cost_per_booked', 'google_ads.impressions', 'google_ads.clicks'];

describe('dashboard placeholders', () => {
  it('shows the labeled sample strip when nothing is connected', async () => {
    const rows = await getMetrics(KEYS, 30, {});
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by['calc.blended_leads']!).toMatchObject({ value: 86, source: 'sample' });
    expect(by['calc.blended_spend']!.value).toBeCloseTo(1751.49);
    expect(by['crm.booked_jobs']!).toMatchObject({ value: 22, source: 'sample' });
    expect(by['crm.job_revenue']!.value).toBeCloseTo(40370.28);
    expect(by['calc.blended_cpl']!.value).toBe(20.88);
    expect(by['calc.cost_per_booked']!.value).toBe(83.25);
    expect(by['google_ads.impressions']!.value).toBe(11571);
    expect(by['google_ads.clicks']!.value).toBe(170);
    expect(rows.every((r) => r.source === 'sample')).toBe(true);
    expect(liveFacts(rows)).toEqual({});
  });

  it('replaces booked jobs with a marked job and does not mix that into the sample cost per lead', async () => {
    const connector = {
      name: 'mock',
      async createConnectToken() { return { token: 't', expiresAt: '2099-01-01', connectUrl: 'https://connect.example' }; },
      async listAccounts() { return []; },
      async runAction() { return { ok: false, actionId: 'x', app: 'google_ads', output: null }; },
    } as unknown as Connector;
    const app = buildServer({ authStore: new MemoryStore(), connector });
    const signed = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'sample@example.com', password: 'password1', tos: true } });
    const headers = { cookie: String(signed.headers['set-cookie']).split(';')[0] };
    const before = await app.inject({ method: 'POST', url: '/api/metrics/resolve', headers, payload: { keys: KEYS, days: 30 } });
    expect(before.json().results.find((r: { key: string }) => r.key === 'crm.booked_jobs').source).toBe('sample');
    await app.inject({ method: 'POST', url: '/api/jobs/mark', headers, payload: { eventId: 'job-1', stage: 'booked', channel: 'google' } });
    const after = await app.inject({ method: 'POST', url: '/api/metrics/resolve', headers, payload: { keys: KEYS, days: 30 } });
    const rows = after.json().results as { key: string; value: number; source: string }[];
    const booked = rows.find((r) => r.key === 'crm.booked_jobs');
    const cpl = rows.find((r) => r.key === 'calc.blended_cpl');
    expect(booked).toMatchObject({ value: 1, source: 'live' });
    expect(cpl?.source).toBe('sample');
    expect(cpl?.value).toBe(20.88);
    expect(liveFacts(rows.map((r) => ({ ...r, source: r.source === 'live' ? 'live' as const : 'sample' as const })))['calc.blended_spend']).toBeUndefined();
    const home = await app.inject({ method: 'GET', url: '/api/miles/home', headers });
    expect(home.json().brief).not.toMatch(/1,751|40,370|\$20\.88/);
    expect(home.json().jobs.booked).toBe(1);
  });

  it('does not hand sample dollars to a skill', async () => {
    const run = await runSevenSkill('loser-pauser', { business: 'Painters', trade: 'painting', city: 'Philadelphia', services: 'interior', zips: [], live: { values: {} }, spendRows: [], searchTerms: [] });
    expect(run.summary).not.toMatch(/1,751|40,370/);
    expect(run.details.join(' ')).not.toMatch(/1,751/);
  });
});
