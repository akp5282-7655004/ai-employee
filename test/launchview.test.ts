import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import type { Connector } from '../src/connectors/types.js';
import {
  buildLaunchView,
  launchBuildAction,
  launchBudgets,
  launchCopy,
  previewSpec,
  type LaunchInput,
} from '../src/dashboard/launch.js';

function painter(over: Partial<LaunchInput> = {}): LaunchInput {
  return {
    mode: 'hybrid',
    trade: 'Painting',
    market: 'Philadelphia',
    services: 'Interior painting',
    website: 'https://painters.example/interior-painting',
    phone: '215-555-0199',
    savedCap: 20,
    leadsPerDay: 1,
    averageJobValue: null,
    closeRate: null,
    financing: false,
    google: { oauth: false, ready: false, note: '' },
    businessName: 'Painters In Philly',
    now: new Date('2026-11-11T15:00:00Z'),
    ...over,
  };
}

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

describe('launch budget prefill', () => {
  it('selects the saved cap and does not show $0 a day', () => {
    const pills = launchBudgets(20);
    expect(pills.find((p) => p.selected)?.daily).toBe(20);
    expect(pills.find((p) => p.recommended)?.hint).toBe('Recommended');
    const view = buildLaunchView(painter());
    const text = launchCopy(view).join('\n');
    expect(view.selectedDaily).toBe(20);
    expect(text).not.toMatch(/\$0\/day|profile incomplete/i);
    expect(view.estimates.find((e) => e.label === 'Monthly spend')!.display).toBe('$600');
    expect(view.estimates.find((e) => e.label === 'Monthly spend')!.kind).toBe('estimate');
  });

  it('does not invent a saved cap when none is stored', () => {
    const view = buildLaunchView(painter({ savedCap: null }));
    expect(view.selectedDaily).toBeNull();
    expect(view.budgets.some((b) => b.selected)).toBe(false);
    expect(launchCopy(view).join('\n')).not.toMatch(/\$0\/day/);
  });
});

describe('launch honesty', () => {
  it('keeps Facebook and Local Services Ads from being a launch target', () => {
    const view = buildLaunchView(painter({ google: { oauth: true, ready: true, note: '' } }));
    const meta = view.channels.find((c) => c.id === 'meta')!;
    const lsa = view.channels.find((c) => c.id === 'lsa')!;
    expect(meta.selectable).toBe(false);
    expect(lsa.selectable).toBe(false);
    expect(meta.detail).toMatch(/Coming soon/);
    expect(lsa.detail).toMatch(/Coming soon/);
    expect(view.channels.find((c) => c.id === 'google')!.selectable).toBe(true);
  });

  it('does not mark Google ready when the customer id is unresolved', () => {
    const view = buildLaunchView(painter({
      google: { oauth: true, ready: false, note: 'Google is signed in. The ad customer id is not resolved, so Miles cannot read spend or create a campaign yet.' },
    }));
    const google = view.channels.find((c) => c.id === 'google')!;
    expect(google.selectable).toBe(false);
    expect(google.state).toBe('hold');
    expect(google.detail).toMatch(/not resolved/i);
  });

  it('does not invent the mock performance figures or a landing path', () => {
    const view = buildLaunchView(painter());
    const text = launchCopy(view).join('\n');
    expect(text).not.toMatch(/11,010|\$477|~24|~6/);
    expect(view.estimates.find((e) => e.label === 'Leads / mo')!.display).toBe('30');
    expect(view.estimates.find((e) => e.label === 'Leads / mo')!.kind).toBe('saved_goal');
    expect(view.estimates.find((e) => e.label === 'Booked jobs / mo')!.display).toBe('n/a');
    expect(view.estimates.find((e) => e.label === 'Revenue / mo')!.display).toBe('n/a');
    expect(view.breakEven).toBeNull();
    expect(view.landingPage).toBe('https://painters.example/interior-painting');
    expect(view.landingPage).not.toMatch(/paintersinphilly\.com\/interior$/);
    expect(view.jobValue).toBeNull();
    expect(view.financing).toBe(false);
    expect(text).not.toMatch(/\u2014/);
  });

  it('uses the seasonal line for the trade, not a painting line for every trade', () => {
    const painting = buildLaunchView(painter());
    expect(painting.goals.find((g) => g.id === 'slow_season')!.detail.toLowerCase()).toMatch(/interior painting/);
    const plumbing = buildLaunchView(painter({ trade: 'Plumbing', services: 'Drain cleaning', now: new Date('2026-11-11T15:00:00Z') }));
    expect(plumbing.goals.find((g) => g.id === 'slow_season')!.detail.toLowerCase()).not.toMatch(/interior painting/);
    expect(plumbing.services).toEqual(['Drain cleaning']);
  });

  it('counts the planned build instead of the mock totals', () => {
    const input = painter();
    const spec = previewSpec(input);
    const view = buildLaunchView(input, spec);
    expect(spec?.status).toBe('PAUSED');
    expect(view.counts.adGroups).toBe(spec!.adGroups.length);
    expect(view.counts.keywords).toBe(spec!.adGroups.reduce((n, g) => n + g.keywords.length, 0));
    expect(view.counts.blocked).toBe(spec!.negatives.length);
    expect(view.counts.ads).not.toBe(6);
    expect(view.counts.keywords).not.toBe(42);
    expect(view.counts.blocked).not.toBe(68);
  });
});

describe('launch build action', () => {
  it('queues in Hybrid, skips in Ask me first, and creates paused without enabling in Do everything', () => {
    expect(launchBuildAction({ mode: 'manual', selectedDaily: 20, savedCap: 20 }).action).toBe('skip');
    expect(launchBuildAction({ mode: 'hybrid', selectedDaily: 20, savedCap: 20 }).action).toBe('queue');
    const auto = launchBuildAction({ mode: 'automate', selectedDaily: 20, savedCap: 20 });
    expect(auto.action).toBe('create_paused');
    expect(auto.message).toMatch(/does not enable/);
    expect(launchBuildAction({ mode: 'automate', selectedDaily: 35, savedCap: 20 }).action).toBe('over_cap');
  });
});

describe('launch route', () => {
  it('prefills $20 from the saved setup cap when the profile budget is empty', async () => {
    const { app: server, calls } = app();
    const headers = { cookie: await cookie(server, 'launch@example.com') };
    const html = '<html><head><title>Painters</title></head><body><h2>Interior painting</h2><a href="https://painters.example/interior-painting">Interior</a></body></html>';
    await server.inject({ method: 'POST', url: '/api/miles/crawl', headers, payload: { html, businessName: 'Painters In Philly', location: 'Philadelphia', website: 'https://painters.example/interior-painting' } });
    await server.inject({ method: 'POST', url: '/api/miles/questions', headers, payload: { goal: 'more calls', dailyBudget: 20, leadsPerDay: 1, mode: 'hybrid' } });
    const res = await server.inject({ method: 'GET', url: '/api/launch/home', headers });
    expect(res.statusCode).toBe(200);
    const view = res.json().launch;
    expect(view.selectedDaily).toBe(20);
    expect(view.savedCap).toBe(20);
    expect(JSON.stringify(view)).not.toMatch(/\$0\/day|profile incomplete/i);
    expect(view.channels.find((c: { id: string }) => c.id === 'meta').selectable).toBe(false);
    expect(view.footer).toMatch(/paused/i);
    const plan = await server.inject({ method: 'POST', url: '/api/journey/plan', headers, payload: {} });
    expect(plan.json().plan.totalDaily).toBe(20);
    expect(JSON.stringify(plan.json().plan.channels)).not.toMatch(/\$0\/day/);
    expect(calls).not.toContain('launch');
    expect(calls).not.toContain('status');
    await server.close();
  });
});
