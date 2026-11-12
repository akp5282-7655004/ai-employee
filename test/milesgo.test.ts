import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import type { Connector } from '../src/connectors/types.js';

const html = '<html><head><title>Painters In Philly</title></head><body><p>Interior painting in Philadelphia. Call 215-555-0199.</p></body></html>';

const enabledRead = { campaign: 'ENABLED' as const, adGroups: ['ENABLED' as const], ads: ['ENABLED' as const], note: 'Read from the account list.' };

function steps(okAd = true) {
  return [
    { step: 'Create daily budget ($20)', ok: true, resource: 'customers/1/campaignBudgets/1' },
    { step: 'Create campaign "Painting" (PAUSED)', ok: true, resource: 'customers/1/campaigns/9' },
    { step: 'Create ad group "Interior painting"', ok: true, resource: 'customers/1/adGroups/3' },
    { step: 'Add 3 keywords to "Interior painting"', ok: true },
    { step: 'Create responsive search ad in "Interior painting"', ok: okAd, resource: okAd ? 'customers/1/ads/8' : undefined, error: okAd ? undefined : 'Google rejected the ad for capitalization.' },
    { step: 'Add location targeting', ok: true },
  ];
}

function appFor(opts?: { delayLaunch?: boolean; missingOnPause?: boolean; listName?: () => string }) {
  const calls: string[] = [];
  let release: () => void = () => undefined;
  const gate = opts?.delayLaunch ? new Promise<void>((resolve) => { release = resolve; }) : Promise.resolve();
  let started: () => void = () => undefined;
  const startedP = new Promise<void>((resolve) => { started = resolve; });
  const connector = {
    name: 'pipedream',
    async createConnectToken() { return { token: 't', expiresAt: '2099-01-01', connectUrl: 'https://connect.example' }; },
    async listAccounts() { return [{ id: 'acct', app: 'google_ads', externalUserId: 'u', healthy: true }]; },
    async runAction() { return { ok: true, actionId: 'x', app: 'google_ads', output: null }; },
    async listAdTargets() { return [{ id: '9013698905', label: 'Painters' }]; },
    async readGoogleCampaignStatus() {
      const name = opts?.listName?.();
      return {
        called: true, live: true, sample: false, note: 'Read from Google Ads just now.',
        campaigns: name ? [{ id: '42', name, status: 'PAUSED' as const }] : [],
      };
    },
    async launchCampaign() {
      calls.push('launch');
      started();
      await gate;
      return {
        ok: true, live: true, campaignResource: 'customers/1/campaigns/9',
        steps: steps(true),
        note: 'Paused campaign created.',
      };
    },
    async setGoogleCampaignStatus(_id: string, args: { status: string }) {
      calls.push('status:' + args.status);
      if (opts?.missingOnPause && args.status === 'PAUSED') {
        return { ok: false, live: true, called: true, missing: true, note: 'That campaign is no longer in the Google Ads account. Miles cleared the saved campaign. Nothing was changed.' };
      }
      return { ok: true, live: true, called: true, note: 'Google reports the campaign, its ad groups, and its ads as enabled.', readback: enabledRead };
    },
  } as unknown as Connector;
  const app = buildServer({ authStore: new MemoryStore(), connector });
  return { app, calls, release, started: startedP };
}

async function ready(app: ReturnType<typeof buildServer>, email: string) {
  const signed = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email, password: 'password1', tos: true } });
  const headers = { cookie: String(signed.headers['set-cookie']).split(';')[0] };
  await app.inject({ method: 'POST', url: '/api/miles/crawl', headers, payload: { businessName: 'Painters In Philly', location: 'Philadelphia, PA', website: 'https://paintersinphilly.com', html } });
  const planned = await app.inject({ method: 'POST', url: '/api/miles/questions', headers, payload: { goal: 'get me leads', dailyBudget: 20, leadsPerDay: 1, mode: 'automate' } });
  await app.inject({ method: 'POST', url: '/api/miles/tracking', headers, payload: { leadConversion: true, method: 'call_or_form' } });
  return { headers, name: planned.json().bundle.spec.name as string, spec: planned.json().bundle.spec };
}

describe('one Start does not create two campaigns', () => {
  it('joins a second /api/miles/go while the first is still creating', async () => {
    const { app, calls, release, started } = appFor({ delayLaunch: true });
    const { headers, spec } = await ready(app, 'double@example.com');
    const first = app.inject({ method: 'POST', url: '/api/miles/go', headers, payload: { confirm: true, plan: spec } });
    await started;
    const second = app.inject({ method: 'POST', url: '/api/miles/go', headers, payload: { confirm: true, plan: spec } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(calls.filter((call) => call === 'launch')).toHaveLength(1);
    expect(a.json().created).toBe(true);
    expect(b.json().created).toBe(true);
    expect(b.json().campaignResource).toBe(a.json().campaignResource);
  });

  it('enables the paused campaign on file instead of creating another', async () => {
    const { app, calls } = appFor();
    const { headers, spec } = await ready(app, 'reuse@example.com');
    const first = await app.inject({ method: 'POST', url: '/api/miles/go', headers, payload: { confirm: true, plan: spec } });
    expect(first.json().created).toBe(true);
    expect(first.json().enabled).toBe(true);
    const second = await app.inject({ method: 'POST', url: '/api/miles/go', headers, payload: { confirm: true } });
    expect(second.json().reused).toBe(true);
    expect(second.json().created).toBe(false);
    expect(second.json().enabled).toBe(true);
    expect(second.json().note).toMatch(/enabled/);
    expect(calls.filter((call) => call === 'launch')).toHaveLength(1);
    expect(calls.filter((call) => call === 'status:ENABLED').length).toBeGreaterThan(1);
    const home = await app.inject({ method: 'GET', url: '/api/miles/home', headers });
    expect(home.json().goNote).toMatch(/enabled/);
  });

  it('adopts a same-named paused campaign and does not create a second one', async () => {
    let name = '';
    const { app, calls } = appFor({ listName: () => name });
    const readyPlan = await ready(app, 'adopt@example.com');
    name = readyPlan.name;
    const started = await app.inject({ method: 'POST', url: '/api/miles/go', headers: readyPlan.headers, payload: { confirm: true } });
    expect(calls).not.toContain('launch');
    expect(started.json().reused).toBe(true);
    expect(started.json().enabled).toBe(true);
    expect(started.json().note).toMatch(/enabled/);
  });

  it('records a partial create in plain words and reuses that campaign', async () => {
    const calls: string[] = [];
    const connector = {
      name: 'pipedream',
      async createConnectToken() { return { token: 't', expiresAt: '2099-01-01', connectUrl: 'https://connect.example' }; },
      async listAccounts() { return [{ id: 'acct', app: 'google_ads', externalUserId: 'u', healthy: true }]; },
      async runAction() { return { ok: true, actionId: 'x', app: 'google_ads', output: null }; },
      async listAdTargets() { return [{ id: '1', label: 'Painters' }]; },
      async launchCampaign() {
        calls.push('launch');
        return {
          ok: false, live: true, campaignResource: 'customers/1/campaigns/9',
          steps: steps(false),
          note: 'A paused campaign was created, but it is not complete.',
        };
      },
      async setGoogleCampaignStatus() {
        calls.push('status');
        return { ok: true, live: true, called: true, note: 'ok', readback: enabledRead };
      },
    } as unknown as Connector;
    const app = buildServer({ authStore: new MemoryStore(), connector });
    const { headers, spec } = await ready(app, 'partial@example.com');
    const started = await app.inject({ method: 'POST', url: '/api/miles/go', headers, payload: { confirm: true, plan: spec } });
    expect(started.json().created).toBe(true);
    expect(started.json().enabled).toBe(false);
    expect(started.json().note).toMatch(/capitalization/);
    expect(started.json().note).toMatch(/Create responsive search ad/);
    const again = await app.inject({ method: 'POST', url: '/api/miles/go', headers, payload: { confirm: true } });
    expect(again.json().reused).toBe(true);
    expect(calls.filter((call) => call === 'launch')).toHaveLength(1);
  });

  it('clears a stale campaign when Google says it is gone', async () => {
    const { app, calls } = appFor({ missingOnPause: true });
    const { headers, spec } = await ready(app, 'missing@example.com');
    await app.inject({ method: 'POST', url: '/api/miles/go', headers, payload: { confirm: true, plan: spec } });
    const reverted = await app.inject({ method: 'POST', url: '/api/miles/revert', headers, payload: { confirm: true } });
    expect(reverted.statusCode).toBe(200);
    expect(reverted.json().cleared).toBe(true);
    expect(reverted.json().note).toMatch(/no longer in the Google Ads account/);
    expect(reverted.json().note).toMatch(/cleared/);
    const home = await app.inject({ method: 'GET', url: '/api/miles/home', headers });
    expect(home.json().activation).toBe('none');
    expect(home.json().goNote).toMatch(/cleared/);
    const again = await app.inject({ method: 'POST', url: '/api/miles/go', headers, payload: { confirm: true } });
    expect(again.json().created).toBe(true);
    expect(calls.filter((call) => call === 'launch')).toHaveLength(2);
  });
});

describe('Run and Start show the result', () => {
  it('keeps the buttons disabled while a start is pending and prints the note', () => {
    const page = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
    expect(page).toContain('milesGoBusy');
    expect(page).toContain('[data-miles-go]');
    expect(page).toContain('startMilesGo');
    expect(page).toContain('goResultText');
    expect(page).toContain('milesGoLabel');
    expect(page).toContain("dataset.role='miles-go-note'");
    expect(page).toContain("btn.type='button'");
    const play = page.slice(page.indexOf('function runPlaybook'), page.indexOf('async function actDecision'));
    expect(play).toContain('startMilesGo');
    expect(page).toContain('Confirm and launch');
    expect(page).toContain('See details');
    expect(page).toContain('Miles will build and launch Google Search for you.');
    expect(page).toContain('openCampaignPlan');
    expect(page).toContain("md-ghost','Cancel'");
    expect(play).not.toContain("r.enabled?'Enabled inside your caps.'");
    const plan = page.slice(page.indexOf("sect-label','GOOGLE PLAN'"), page.indexOf("sect-label','GOOGLE PLAN'") + 1800);
    expect(plan).toContain('startMilesGo');
    expect(plan).toContain('milesGoLabel');
  });
});
