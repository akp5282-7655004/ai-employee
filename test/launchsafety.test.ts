import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import type { Connector } from '../src/connectors/types.js';
import { decidePolicy, overDailyCap, DEFAULT_CAPS } from '../src/agents/policy.js';
import { planGo } from '../src/agents/milesrun.js';
import { monthSpendOf } from '../src/metrics/snapshot.js';
import { launchEmailKey } from '../src/billing/launchcredit.js';
import { buildCampaignSpec, claimsFromText, type CampaignSpec } from '../src/agents/campaign.js';
import { enforceRulebook } from '../src/agents/rulebook.js';
import { buildMetaCampaignSpec } from '../src/agents/metacampaign.js';
import { generateText } from '../src/llm/text.js';
import { readFileSync } from 'node:fs';

const html = '<html><head><title>Painters In Philly</title></head><body><p>Interior painting in Philadelphia. Call 215-555-0199.</p></body></html>';
const enabledRead = { campaign: 'ENABLED' as const, adGroups: ['ENABLED' as const], ads: ['ENABLED' as const], note: 'Read from the account list.' };
const steps = [
  { step: 'Create daily budget ($20)', ok: true, resource: 'customers/1/campaignBudgets/1' },
  { step: 'Create campaign "Painting" (PAUSED)', ok: true, resource: 'customers/1/campaigns/9' },
  { step: 'Create ad group "Interior painting"', ok: true, resource: 'customers/1/adGroups/3' },
  { step: 'Add 3 keywords to "Interior painting"', ok: true },
  { step: 'Create responsive search ad in "Interior painting"', ok: true, resource: 'customers/1/ads/8' },
  { step: 'Add location targeting', ok: true },
];

/** A live-looking Google connector. `spend` is this month's read spend; undefined means none can be read. */
function appFor(opts: { spend?: number; apps?: string[] } = {}) {
  const calls: string[] = [];
  const connector: Record<string, unknown> = {
    name: 'pipedream',
    async createConnectToken() { return { token: 't', expiresAt: '2099-01-01', connectUrl: 'https://connect.example' }; },
    async listAccounts() { return (opts.apps ?? ['google_ads']).map((app, i) => ({ id: `acct${i}`, app, externalUserId: 'u', healthy: true })); },
    async runAction() { return { ok: true, actionId: 'x', app: 'google_ads', output: null }; },
    async listAdTargets() { return [{ id: '9013698905', label: 'Painters' }]; },
    async readGoogleCampaignStatus() { return { called: true, live: true, sample: false, note: 'Read.', campaigns: [] }; },
    async launchCampaign(_id: string, spec: CampaignSpec) {
      calls.push(`launch:${spec.dailyBudget}`);
      return { ok: true, live: true, campaignResource: 'customers/1/campaigns/9', steps, note: 'Paused campaign created.' };
    },
    async setGoogleCampaignStatus(_id: string, args: { status: string }) {
      calls.push('status:' + args.status);
      return { ok: true, live: true, called: true, note: 'Google reports the campaign as enabled.', readback: enabledRead };
    },
  };
  if (opts.spend !== undefined) {
    connector.getAdSpend = async () => [{ platform: 'google_ads', campaign: 'Painting', utm: 'painting', spend: opts.spend }];
  }
  const app = buildServer({ authStore: new MemoryStore(), connector: connector as unknown as Connector });
  return { app, calls };
}

async function signup(app: ReturnType<typeof buildServer>, email: string) {
  const signed = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email, password: 'password1', tos: true } });
  expect(signed.statusCode).toBe(200);
  return { cookie: String(signed.headers['set-cookie']).split(';')[0] ?? '' };
}

async function automate(app: ReturnType<typeof buildServer>, email: string) {
  const headers = await signup(app, email);
  await app.inject({ method: 'POST', url: '/api/miles/crawl', headers, payload: { businessName: 'Painters In Philly', location: 'Philadelphia, PA', website: 'https://paintersinphilly.com', html } });
  const planned = await app.inject({ method: 'POST', url: '/api/miles/questions', headers, payload: { goal: 'get me leads', dailyBudget: 20, leadsPerDay: 1, mode: 'automate' } });
  await app.inject({ method: 'POST', url: '/api/miles/tracking', headers, payload: { leadConversion: true, method: 'call_or_form' } });
  return { headers, spec: planned.json().bundle.spec as CampaignSpec };
}

describe('the daily cap is a hard floor', () => {
  it('refuses a $5000/day plan on a $20/day automate account and calls nothing in Google', async () => {
    const { app, calls } = appFor({ spend: 100 });
    const { headers, spec } = await automate(app, 'cap@example.com');
    const go = await app.inject({ method: 'POST', url: '/api/miles/go', headers, payload: { confirm: true, plan: { ...spec, dailyBudget: 5000 } } });
    expect(go.statusCode).toBe(400);
    expect(go.json().created).toBe(false);
    expect(go.json().error).toMatch(/\$5000\/day, above your \$20\/day daily cap/);
    expect(calls).toEqual([]);
    const approvals = await app.inject({ method: 'GET', url: '/api/approvals', headers });
    if (approvals.statusCode === 200) expect(JSON.stringify(approvals.json())).not.toContain('Approved Google Search plan');
    // A plan inside the cap still goes through.
    const ok = await app.inject({ method: 'POST', url: '/api/miles/go', headers, payload: { confirm: true, plan: spec } });
    expect(ok.json().created).toBe(true);
    expect(calls).toContain('launch:20');
    await app.close();
  });

  it('refuses an over-cap spec on the manual launcher', async () => {
    const { app, calls } = appFor({ spend: 100 });
    const { headers, spec } = await automate(app, 'cap-launch@example.com');
    const launch = await app.inject({ method: 'POST', url: '/api/campaign/launch', headers, payload: { confirm: true, spec: { ...spec, dailyBudget: 5000 } } });
    expect(launch.statusCode).toBe(400);
    expect(launch.json().error).toMatch(/daily cap/);
    expect(calls.some((c) => c.startsWith('launch'))).toBe(false);
    await app.close();
  });

  it('overDailyCap only refuses above a set cap', () => {
    expect(overDailyCap(5000, 20)).toMatch(/above your \$20\/day daily cap/);
    expect(overDailyCap(20, 20)).toBeNull();
    expect(overDailyCap(19.5, 20)).toBeNull();
    expect(overDailyCap(50, 0)).toBeNull();
  });
});

describe('the monthly ceiling uses real month spend', () => {
  it('holds enable for approval when this month\'s spend cannot be read', async () => {
    const { app, calls } = appFor();
    const { headers, spec } = await automate(app, 'nospend@example.com');
    const go = await app.inject({ method: 'POST', url: '/api/miles/go', headers, payload: { confirm: true, plan: spec } });
    expect(go.json().created).toBe(true);
    expect(go.json().enabled).toBe(false);
    expect(go.json().note).toMatch(/could not read this month's ad spend/);
    expect(calls).not.toContain('status:ENABLED');
    await app.close();
  });

  it('holds enable when the month spend already sits at the ceiling', async () => {
    const { app, calls } = appFor({ spend: 595 });
    const { headers, spec } = await automate(app, 'fullmonth@example.com');
    const go = await app.inject({ method: 'POST', url: '/api/miles/go', headers, payload: { confirm: true, plan: spec } });
    expect(go.json().created).toBe(true);
    expect(go.json().enabled).toBe(false);
    expect(go.json().note).toMatch(/monthly ceiling/);
    expect(calls).not.toContain('status:ENABLED');
    await app.close();
  });

  it('enables inside the ceiling when spend is known', async () => {
    const { app, calls } = appFor({ spend: 100 });
    const { headers, spec } = await automate(app, 'okmonth@example.com');
    const go = await app.inject({ method: 'POST', url: '/api/miles/go', headers, payload: { confirm: true, plan: spec } });
    expect(go.json().enabled).toBe(true);
    expect(calls).toContain('status:ENABLED');
    await app.close();
  });

  it('policy queues spend when month spend is unknown and never treats it as zero', () => {
    const base = { mode: 'automate' as const, caps: DEFAULT_CAPS, spentToday: 0 };
    expect(decidePolicy({ ...base, spentMonth: null, action: { area: 'ppc', kind: 'enable', spend: 20, canPush: true } }).effect).toBe('queue');
    expect(decidePolicy({ ...base, spentMonth: null, action: { area: 'ppc', kind: 'create', spend: 0, canPush: true } }).effect).toBe('apply');
    expect(decidePolicy({ ...base, spentMonth: 100, action: { area: 'ppc', kind: 'enable', spend: 20, canPush: true } }).effect).toBe('apply');
    const go = planGo({ mode: 'automate', caps: DEFAULT_CAPS, spentToday: 0, spentMonth: null, dailySpend: 20 });
    expect(go.create.effect).toBe('apply');
    expect(go.enable.effect).toBe('queue');
    const now = Date.now();
    expect(monthSpendOf(undefined)).toBeNull();
    expect(monthSpendOf({ ts: new Date(now).toISOString(), campaigns: [], deals: [], searchTerms: [], leads: [], reviews: [], social: null })).toBeNull();
    expect(monthSpendOf({ ts: new Date(now).toISOString(), campaigns: [], adSpend: 42, deals: [], searchTerms: [], leads: [], reviews: [], social: null }, now)).toBe(42);
    expect(monthSpendOf({ ts: new Date(now - 2 * 86_400_000).toISOString(), campaigns: [], adSpend: 42, deals: [], searchTerms: [], leads: [], reviews: [], social: null }, now)).toBeNull();
  });
});

describe('approving twice does nothing twice', () => {
  it('approves a review item once and applies a recommendation once', async () => {
    const { app } = appFor({ spend: 0 });
    const { cookie } = await signup(app, 'twice@example.com');
    const headers = { cookie };
    const task = await app.inject({ method: 'POST', url: '/api/miles/task', headers, payload: { request: 'Write an email about spring tune-ups' } });
    const id = task.json().id as string;
    const first = await app.inject({ method: 'POST', url: '/api/review/approve', headers, payload: { id } });
    expect(first.json().ok).toBe(true);
    expect(first.json().already).toBeUndefined();
    const second = await app.inject({ method: 'POST', url: '/api/review/approve', headers, payload: { id } });
    expect(second.json()).toMatchObject({ ok: true, already: true, emailed: false });
    const rec = { id: 'rec-1', title: 'Pause the losing keyword', why: 'It spent and booked nothing.' };
    await app.inject({ method: 'POST', url: '/api/recommendations/apply', headers, payload: { rec } });
    const again = await app.inject({ method: 'POST', url: '/api/recommendations/apply', headers, payload: { rec } });
    expect(again.json()).toMatchObject({ ok: true, already: true });
    const deploy = (await app.inject({ method: 'GET', url: '/api/deploy', headers })).json().deploy;
    expect(deploy.queue.filter((row: { id: string }) => row.id === id)).toHaveLength(1);
    expect(deploy.queue.filter((row: { id: string }) => row.id === 'rec-1')).toHaveLength(1);
    await app.close();
  });

  it('does not approve a dismissed draft', async () => {
    const { app } = appFor({ spend: 0 });
    const { cookie } = await signup(app, 'dismissed@example.com');
    const headers = { cookie };
    const id = (await app.inject({ method: 'POST', url: '/api/miles/task', headers, payload: { request: 'Write a Facebook post' } })).json().id as string;
    await app.inject({ method: 'POST', url: '/api/review/dismiss', headers, payload: { id } });
    const approved = await app.inject({ method: 'POST', url: '/api/review/approve', headers, payload: { id } });
    expect(approved.statusCode).toBe(409);
    const deploy = (await app.inject({ method: 'GET', url: '/api/deploy', headers })).json().deploy;
    expect((deploy.queue ?? []).some((row: { id: string }) => row.id === id)).toBe(false);
    await app.close();
  });
});

describe('the deploy log is written by the server', () => {
  it('ignores entries the browser invents but lets the owner approve a logged one', async () => {
    const { app } = appFor({ spend: 0 });
    const { cookie } = await signup(app, 'deploylog@example.com');
    const headers = { cookie };
    const id = (await app.inject({ method: 'POST', url: '/api/miles/task', headers, payload: { request: 'Write an email about fall gutter cleaning' } })).json().id as string;
    await app.inject({ method: 'POST', url: '/api/review/approve', headers, payload: { id } });
    const put = await app.inject({
      method: 'PUT', url: '/api/deploy', headers,
      payload: { deploy: { auto: false, queue: [
        { id: 'made-up', label: 'Fabricated live change', status: 'live', ts: '2020-01-01T00:00:00.000Z' },
        { id, label: 'Rewritten label', status: 'live' },
      ] } },
    });
    expect(put.json()).toMatchObject({ ok: true, ignored: 1 });
    const deploy = (await app.inject({ method: 'GET', url: '/api/deploy', headers })).json().deploy;
    expect(deploy.queue.some((row: { id: string }) => row.id === 'made-up')).toBe(false);
    const row = deploy.queue.find((r: { id: string }) => r.id === id);
    expect(row.status).toBe('live');
    expect(row.label).not.toBe('Rewritten label');
    expect(row.approvedBy).toBe('deploylog@example.com');
    await app.close();
  });
});

describe('the launch credit is granted once per email', () => {
  const tools = ['google_ads', 'google_my_business', 'facebook_pages'];
  const credits = async (app: ReturnType<typeof buildServer>, cookie: string) => (await app.inject({ method: 'GET', url: '/api/billing', headers: { cookie } })).json();

  it('does not grant it again after delete and re-signup, even with a blank profile or an alias', async () => {
    const { app } = appFor({ apps: tools });
    const first = await signup(app, 'Owner@Example.com');
    const one = await credits(app, first.cookie);
    expect(one.launchCredit).toBe('granted');
    expect(one.credits.granted).toBe(100);
    const deleted = await app.inject({ method: 'POST', url: '/api/account/delete', headers: { cookie: first.cookie }, payload: { confirm: 'DELETE' } });
    expect(deleted.json().ok).toBe(true);

    const again = await signup(app, 'owner@example.com');
    const two = await credits(app, again.cookie);
    expect(two.launchCredit).toBe('duplicate');
    expect(two.credits.granted).toBe(0);
    await app.inject({ method: 'POST', url: '/api/account/delete', headers: { cookie: again.cookie }, payload: { confirm: 'DELETE' } });

    const alias = await signup(app, 'owner+2@example.com');
    expect((await credits(app, alias.cookie)).launchCredit).toBe('duplicate');

    // A different person with an equally blank profile still gets theirs.
    const other = await signup(app, 'someone-else@example.com');
    expect((await credits(app, other.cookie)).launchCredit).toBe('granted');
    await app.close();
  });

  it('normalizes email aliases', () => {
    expect(launchEmailKey(' Owner+promo@Example.com ')).toBe('owner@example.com');
    expect(launchEmailKey('j.doe+x@googlemail.com')).toBe('jdoe@gmail.com');
    expect(launchEmailKey('j.doe@company.com')).toBe('j.doe@company.com');
  });
});

describe('ad copy makes only claims the business backs up', () => {
  const ctx = { business: 'Painters In Philly', trade: 'painting', city: 'Philadelphia', services: 'Interior painting, Exterior painting' };
  const text = (spec: CampaignSpec) => JSON.stringify([spec.adGroups.map((g) => g.rsa), spec.callouts, spec.sitelinks]);

  it('leaves out licensed, insured, experienced and locally owned without proof', () => {
    const spec = buildCampaignSpec({ dailyBudget: 20, finalUrl: 'https://paintersinphilly.com' }, ctx);
    const ruled = enforceRulebook(spec, { trade: 'painting', city: 'Philadelphia' }).spec;
    for (const s of [spec, ruled]) {
      expect(text(s)).not.toMatch(/licensed|insured|experienced crew|locally owned/i);
      expect(s.callouts!.length).toBeGreaterThanOrEqual(4);
    }
    const meta = buildMetaCampaignSpec({ dailyBudget: 20, website: 'https://paintersinphilly.com' }, { business: 'Painters In Philly', industry: 'roofing', city: 'Philadelphia' });
    expect(JSON.stringify(meta)).not.toMatch(/licensed and insured/i);
  });

  it('includes them when the crawled site says so', () => {
    const claims = claimsFromText('Fully licensed and insured. Locally owned. 20 years of experience. License #PA12345.');
    expect(claims).toEqual({ licensed: true, insured: true, experienced: true, locallyOwned: true });
    expect(claimsFromText('We are not licensed here.').licensed).toBe(false);
    const spec = buildCampaignSpec({ dailyBudget: 20, finalUrl: 'https://paintersinphilly.com' }, { ...ctx, claims });
    expect(spec.callouts).toContain('Licensed And Insured');
    expect(spec.callouts).toContain('Experienced Crew');
  });

  it('roofing ships no placeholder negative keyword', () => {
    const roofing = JSON.parse(readFileSync(new URL('../src/playbooks/data/roofing.json', import.meta.url), 'utf8'));
    expect(roofing.negatives).not.toContain('unwanted roof types');
  });
});

describe('credit copy matches what is charged', () => {
  it('does not tell owners campaigns and skill runs are free of credits', () => {
    const page = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
    expect(page).not.toContain('campaigns, and skill runs do not use these credits');
    expect(page).toContain('skill runs, and agent runs also draw from these credits');
  });
});

describe('text generation has a deadline', () => {
  const saved = process.env.OPENROUTER_API_KEY;
  afterEach(() => {
    vi.unstubAllGlobals();
    if (saved === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = saved;
  });

  it('passes an abort signal to the model call and falls back when it fires', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', (_url: string, init: { signal?: AbortSignal }) => {
      signal = init.signal;
      return Promise.reject(new DOMException('The operation was aborted.', 'TimeoutError'));
    });
    expect(await generateText({ system: 's', user: 'u' })).toBeNull();
    expect(signal).toBeInstanceOf(AbortSignal);
  });
});
