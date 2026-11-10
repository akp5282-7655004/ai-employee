import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import type { Connector } from '../src/connectors/types.js';
import { setupPlacement } from '../src/agents/journey.js';

function app() {
  const calls: string[] = [];
  const connector = {
    name: 'mock',
    async createConnectToken() { return { token: 't', expiresAt: '2099-01-01', connectUrl: 'https://connect.example' }; },
    async listAccounts() { return []; },
    async runAction() { calls.push('run'); return { ok: false, actionId: 'x', app: 'google_ads', output: null }; },
    async launchCampaign() { calls.push('launch'); return { ok: false, live: false, steps: [] }; },
    async setGoogleCampaignStatus() { calls.push('status'); return { ok: false, live: false, called: false, note: 'no' }; },
  } as unknown as Connector;
  return { app: buildServer({ authStore: new MemoryStore(), connector }), calls };
}

async function cookie(server: ReturnType<typeof buildServer>, email: string) {
  const r = await server.inject({ method: 'POST', url: '/auth/signup', payload: { email, password: 'password1', tos: true } });
  return String(r.headers['set-cookie']).split(';')[0] ?? '';
}

const html = '<html><head><title>Painters In Philly</title></head><body><h2>Interior painting</h2><a href="tel:215-555-0199">215-555-0199</a></body></html>';

describe('mode can be chosen before a plan exists', () => {
  it('saves automate with no bundle and questions keep that mode', async () => {
    const { app: server, calls } = app();
    const headers = { cookie: await cookie(server, 'mode@example.com') };
    const picked = await server.inject({ method: 'POST', url: '/api/miles/mode', headers, payload: { mode: 'automate' } });
    expect(picked.statusCode).toBe(200);
    expect(picked.json()).toMatchObject({ ok: true, mode: 'automate', created: false, enabled: false });
    expect(calls).not.toContain('launch');
    expect(calls).not.toContain('status');
    const home = await server.inject({ method: 'GET', url: '/api/miles/home', headers });
    expect(home.json().mode).toBe('automate');
    expect(home.json().placement).toEqual({ setupComplete: false, dashboard: 'full', profile: false });
    const planned = await server.inject({ method: 'POST', url: '/api/miles/questions', headers, payload: { goal: 'get me leads', dailyBudget: 20, leadsPerDay: 1 } });
    expect(planned.json().bundle.setup.mode).toBe('automate');
    expect(calls).not.toContain('launch');
  });

  it('keeps setup cards on the dashboard until crawl and questions are both saved', async () => {
    expect(setupPlacement({ pagesRead: 0, hasBundle: false })).toEqual({ setupComplete: false, dashboard: 'full', profile: false });
    expect(setupPlacement({ pagesRead: 1, hasBundle: false })).toEqual({ setupComplete: false, dashboard: 'full', profile: false });
    expect(setupPlacement({ pagesRead: 0, hasBundle: true })).toEqual({ setupComplete: false, dashboard: 'full', profile: false });
    expect(setupPlacement({ pagesRead: 1, hasBundle: true })).toEqual({ setupComplete: true, dashboard: 'compact', profile: true });
    const { app: server } = app();
    const headers = { cookie: await cookie(server, 'place@example.com') };
    await server.inject({ method: 'POST', url: '/api/miles/crawl', headers, payload: { businessName: 'Painters In Philly', location: 'Philadelphia, PA', html } });
    const mid = await server.inject({ method: 'GET', url: '/api/miles/home', headers });
    expect(mid.json().placement.dashboard).toBe('full');
    await server.inject({ method: 'POST', url: '/api/miles/questions', headers, payload: { goal: 'get me leads', dailyBudget: 20, leadsPerDay: 1, mode: 'hybrid' } });
    const done = await server.inject({ method: 'GET', url: '/api/miles/home', headers });
    expect(done.json().placement).toEqual({ setupComplete: true, dashboard: 'compact', profile: true });
    expect(done.json().mode).toBe('hybrid');
  });
});
