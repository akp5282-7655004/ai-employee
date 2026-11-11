import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildCampaignSpec } from '../src/agents/campaign.js';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import type { Connector } from '../src/connectors/types.js';
import { formatSopLog, runSopGate, sopCoverage, SOP_INDEX, ungatedExecutorCalls } from '../src/agents/sopgate.js';

describe('SOP gate', () => {
  const spec = buildCampaignSpec(
    { dailyBudget: 20, finalUrl: 'https://paintersinphilly.com', locations: ['Philadelphia'] },
    { trade: 'Painting', city: 'Philadelphia', services: 'Interior painting', business: 'Painters In Philly' },
  );

  it('passes a Search create and records the rules', () => {
    const gate = runSopGate('campaign_create', { mode: 'automate', spec, city: 'Philadelphia', tracking: { ga4Linked: true } });
    expect(gate.disposition).toBe('execute');
    expect(gate.blocks).toEqual([]);
    expect(formatSopLog(gate)).toMatch(/sop147-not-sent/);
    expect(formatSopLog(gate)).toMatch(/warned:/);
  });

  it('blocks enable until a lead conversion is marked', () => {
    const gate = runSopGate('campaign_enable', { mode: 'automate', spec, tracking: {} });
    expect(gate.disposition).toBe('block');
    expect(gate.blocks.join(' ')).toMatch(/SOP 039/);
  });

  it('auto-fixes a paused create and blocks a negative that kills the service', () => {
    const broad = { ...spec, status: 'ENABLED' as const };
    const fixed = runSopGate('campaign_create', { mode: 'hybrid', spec: broad, city: 'Philadelphia' });
    expect(fixed.subject.spec?.status).toBe('PAUSED');
    expect(fixed.disposition).toBe('queue');
    const blocked = runSopGate('negative_add', { mode: 'automate', negative: 'interior painting', protectTerms: ['interior painting'] });
    expect(blocked.disposition).toBe('block');
    expect(blocked.blocks.join(' ')).toMatch(/SOP 129/);
  });

  it('blocks a GoHighLevel send with no recipient and an SEO page with no H1', () => {
    expect(runSopGate('ghl_send', { mode: 'automate', ghl: { message: 'We can help.' } }).blocks.join(' ')).toMatch(/SOP 076/);
    expect(runSopGate('seo_publish', { mode: 'manual', seo: { title: 'Interior painting', noindex: true } }).blocks.join(' ')).toMatch(/SOP 042|SOP 065/);
    expect(runSopGate('seo_publish', { mode: 'manual', seo: { title: 'Interior painting', h1: 'Interior painting', meta: 'Schedule interior painting in Philadelphia.', path: '/interior-painting' } }).disposition).toBe('show');
  });

  it('covers every captured SOP number once', () => {
    const rows = sopCoverage();
    expect(new Set(rows.map((row) => row.n)).size).toBe(145);
    expect(SOP_INDEX.length).toBe(145);
    expect(rows.every((row) => row.state.length > 0)).toBe(true);
  });

  it('fails if a server executor skips the gate', () => {
    const source = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
    expect(ungatedExecutorCalls(source)).toEqual([]);
  });
});

describe('tracking proof lets Automate enable', () => {
  it('stores the proof and the change log names the rule', async () => {
    const connector = {
      name: 'mock',
      async createConnectToken() { return { token: 't', expiresAt: '2099', connectUrl: 'https://example.com' }; },
      async listAccounts() { return []; },
      async runAction() { return { ok: false, actionId: 'x', app: 'x', output: null }; },
    } as unknown as Connector;
    const app = buildServer({ authStore: new MemoryStore(), connector });
    const signed = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'sop@example.com', password: 'password1', tos: true } });
    const headers = { cookie: String(signed.headers['set-cookie']).split(';')[0] };
    const saved = await app.inject({ method: 'POST', url: '/api/miles/tracking', headers, payload: { leadConversion: true, ga4Linked: false, method: 'thank_you' } });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().log).toMatch(/sop039-lead/);
    const page = await app.inject({ method: 'POST', url: '/api/miles/seo/publish', headers, payload: { title: 'Interior painting', h1: 'Interior painting', meta: 'Book interior painting.', path: '/interior-painting' } });
    expect(page.json().disposition).toBe('show');
  });
});
