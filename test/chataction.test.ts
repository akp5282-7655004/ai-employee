import { afterAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import type { Connector } from '../src/connectors/types.js';
import { buildSearchPlan } from '../src/agents/campaignplan.js';
import { reviewSearchPlan } from '../src/agents/prelaunch.js';
import { draftBudget, draftChatAction, draftCreate, draftNegatives, draftPause, draftResume, type ActAccount } from '../src/chat/act.js';

function account(extra: Partial<ActAccount> = {}): ActAccount {
  return {
    business: 'Painters In Philly',
    trade: 'Painting',
    services: 'Interior painting, exterior painting',
    serviceAreas: 'Philadelphia, PA',
    website: 'https://paintersinphilly.com',
    phone: '2155550199',
    hours: 'Monday 8am to 5pm',
    mode: 'hybrid',
    kill: false,
    dailyCap: 50,
    monthlyCeiling: 1500,
    maxChangePct: 100,
    currentDaily: 30,
    campaignName: 'Painting | Philadelphia | Search',
    campaignResource: '',
    activation: 'none',
    trackingLead: true,
    protectTerms: ['interior painting', 'exterior painting'],
    ...extra,
  };
}

describe('SOP 147 review and each chat action', () => {
  it('passes a shared Launch plan only when the lead is confirmed', () => {
    const plan = buildSearchPlan({
      businessName: 'Painters In Philly',
      trade: 'Painting',
      services: 'Interior painting, exterior painting',
      serviceAreas: 'Philadelphia, PA',
      website: 'https://paintersinphilly.com',
      phone: '2155550199',
      dailyBudget: 30,
    });
    expect(plan.sopReview.ready).toBe(false);
    expect(plan.sopReview.rows.find((row) => row.area === 'Goals')?.result).toBe('unknown');
    const ready = reviewSearchPlan(plan.spec, { trackingLead: true, dailyCap: 50, requestedDaily: 30 });
    expect(ready.ready).toBe(true);
    expect(ready.rows.every((row) => row.result === 'pass')).toBe(true);
    for (const group of plan.spec.adGroups) {
      expect(group.rsa.headlines.length).toBeGreaterThanOrEqual(8);
      expect(group.rsa.headlines.length).toBeLessThanOrEqual(10);
      expect(new Set(group.keywords.map((row) => row.text)).size).toBe(group.keywords.length);
    }
  });

  it('builds a create card from the same plan and refuses a budget over the cap', () => {
    const created = draftCreate('Set up a Google Ads campaign for Philadelphia, $30/day, interior and exterior painting', account());
    expect(created.kind).toBe('card');
    if (created.kind !== 'card') return;
    expect(created.approval.payload.spec?.status).toBe('PAUSED');
    expect(created.approval.payload.spec?.dailyBudget).toBe(30);
    expect(created.approval.lines.join('\n')).toMatch(/Keywords/);
    expect(created.approval.lines.join('\n')).toMatch(/Negative/);
    const held = draftCreate('Set up a Google Ads campaign for Philadelphia, $30/day, interior and exterior painting', account({ trackingLead: false }));
    expect(held.kind).toBe('ask');
    const over = draftBudget('raise my budget to $40/day', account({ dailyCap: 20, currentDaily: 20 }));
    expect(over.kind).toBe('refuse');
    if (over.kind === 'refuse') expect(over.text).toMatch(/daily cap/);
    const paused = draftPause(account({ campaignResource: 'customers/1/campaigns/9', activation: 'enabled' }));
    expect(paused.kind).toBe('card');
    const live = draftResume(account({ campaignResource: 'customers/1/campaigns/9', activation: 'paused', trackingLead: false }));
    expect(live.kind).toBe('refuse');
    if (live.kind === 'refuse') expect(live.text).toMatch(/SOP 039/);
    const negatives = draftNegatives('add "free" and "jobs" as negative keywords', account({ campaignResource: 'customers/1/campaigns/9' }));
    expect(negatives.kind).toBe('card');
    if (negatives.kind === 'card') expect(negatives.approval.payload.keywords).toEqual(['free', 'jobs']);
    const unsafe = draftNegatives('add "interior painting" as a negative keyword', account({ campaignResource: 'customers/1/campaigns/9' }));
    expect(unsafe.kind).toBe('refuse');
    const month = draftCreate('Set up a Google Ads campaign for Philadelphia, $608 a month, interior and exterior painting', account());
    expect(month.kind).toBe('card');
    if (month.kind === 'card') expect(month.approval.payload.dailyBudget).toBe(20);
    const clicks = draftCreate('Set up a Google Ads campaign for Philadelphia, $30/day, interior painting, as a traffic test', account());
    expect(clicks.kind).toBe('card');
    if (clicks.kind === 'card') expect(clicks.approval.payload.spec?.biddingStrategy).toBe('MAXIMIZE_CLICKS');
  });
});

describe('approval gate, caps, and undo', () => {
  const calls: string[] = [];
  const connector = {
    name: 'pipedream',
    async createConnectToken() { return { token: 't', expiresAt: '2099', connectUrl: 'https://example.com' }; },
    async listAccounts() { return [{ id: 'acct', app: 'google_ads', externalUserId: 'u', healthy: true }]; },
    async runAction() { return { ok: false, actionId: 'x', app: 'google_ads', output: null }; },
    async listAdTargets() { return [{ id: '123', label: 'Painters' }]; },
    async launchCampaign() {
      calls.push('launch');
      return { ok: true, live: true, campaignResource: 'customers/1/campaigns/9', steps: [], note: 'Created paused.' };
    },
    async setGoogleCampaignStatus(_id: string, args: { status: string }) {
      calls.push(`status:${args.status}`);
      return { ok: true, live: true, called: true, note: `Google reports the campaign as ${args.status}.` };
    },
    async updateGoogleDailyBudget(_id: string, args: { dailyBudget: number }) {
      calls.push(`budget:${args.dailyBudget}`);
      return { ok: true, live: true, called: true, note: `Google daily budget is now $${args.dailyBudget}.` };
    },
    async addGoogleNegativeKeywords(_id: string, args: { keywords: string[]; remove?: boolean }) {
      calls.push(`${args.remove ? 'remove' : 'add'}:${args.keywords.join(',')}`);
      return { ok: true, live: true, called: true, note: 'Google updated the negatives.' };
    },
  } as unknown as Connector;
  const store = new MemoryStore();
  const app = buildServer({ authStore: store, connector });
  afterAll(async () => { await app.close(); });

  async function owner(email: string) {
    const signup = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email, password: 'password1', name: 'Ada', tos: true } });
    const cookie = String(signup.headers['set-cookie']).split(';')[0];
    const id = signup.json().user.id as string;
    await store.setUserData(id, {
      profile: { businessName: 'Painters In Philly', industry: 'Painting', services: 'Interior painting, exterior painting', serviceAreas: 'Philadelphia, PA', website: 'https://paintersinphilly.com', phone: '2155550199' },
      trackingProof: { leadConversion: true, method: 'call_or_form' },
      miles: {
        phase: 'ready',
        activation: 'enabled',
        campaignResource: 'customers/1/campaigns/9',
        bundle: {
          setup: { mode: 'hybrid', businessName: 'Painters In Philly', location: 'Philadelphia', website: 'https://paintersinphilly.com', caps: { dailyBudget: 50, monthlyCeiling: 1500, maxChangePct: 100, paused: false } },
          channels: [{ id: 'google', daily: 30 }],
          spec: { name: 'Painting', dailyBudget: 30, adGroups: [{ name: 'Interior Painting', keywords: [{ text: 'interior painting', match: 'phrase' }] }] },
          profile: { industry: 'Painting', services: 'Interior painting' },
        },
      },
    });
    return { cookie, id };
  }

  it('does not call Google before Approve, then pauses and undoes', async () => {
    const { cookie, id } = await owner('pause@example.com');
    const ask = await app.inject({
      method: 'POST', url: '/api/chat/ask', headers: { cookie },
      payload: { messages: [{ role: 'user', text: 'pause my campaign' }] },
    });
    expect(ask.statusCode).toBe(200);
    expect(ask.json().approval.title).toMatch(/Pause/);
    expect(ask.json().approval.before).toBe('Enabled');
    expect(ask.json().approval.after).toBe('Paused');
    expect(calls).toEqual([]);
    const approved = await app.inject({
      method: 'POST', url: '/api/chat/act', headers: { cookie },
      payload: { id: ask.json().approval.id, decision: 'approve' },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().note).toMatch(/PAUSED/);
    expect(calls).toEqual(['status:PAUSED']);
    const data = await store.getUserData(id);
    const log = (data.automation as { log: { title: string; effect: string }[] }).log;
    expect(log[0]?.title).toMatch(/Pause/);
    expect(log[0]?.effect).toBe('applied');
    const undone = await app.inject({
      method: 'POST', url: '/api/activity/undo', headers: { cookie },
      payload: { id: ask.json().approval.id, source: 'automation' },
    });
    expect(undone.statusCode).toBe(200);
    expect(calls).toEqual(['status:PAUSED', 'status:ENABLED']);
    const after = await store.getUserData(id);
    expect((after.automation as { log: { effect: string }[] }).log[0]?.effect).toBe('reverted');
  });

  it('refuses a budget over the cap without a Google call', async () => {
    const { cookie, id } = await owner('cap@example.com');
    await store.setUserData(id, {
      ...(await store.getUserData(id)),
      miles: {
        ...(await store.getUserData(id)).miles as object,
        bundle: {
          ...((await store.getUserData(id)).miles as { bundle: object }).bundle,
          setup: { mode: 'hybrid', caps: { dailyBudget: 20, monthlyCeiling: 600, maxChangePct: 10, paused: false } },
        },
      },
    });
    const before = calls.length;
    const ask = await app.inject({
      method: 'POST', url: '/api/chat/ask', headers: { cookie },
      payload: { messages: [{ role: 'user', text: 'raise my budget to $40/day' }] },
    });
    expect(ask.json().approval).toBeNull();
    expect(ask.json().text).toMatch(/daily cap|change cap/);
    expect(calls.length).toBe(before);
  });

  it('adds negatives only after Approve', async () => {
    const { cookie } = await owner('neg@example.com');
    const before = calls.length;
    const ask = await app.inject({
      method: 'POST', url: '/api/chat/ask', headers: { cookie },
      payload: { messages: [{ role: 'user', text: 'add "free" and "jobs" as negative keywords' }] },
    });
    expect(ask.json().approval.lines.join(' ')).toMatch(/Phrase match/);
    expect(calls.length).toBe(before);
    const approved = await app.inject({
      method: 'POST', url: '/api/chat/act', headers: { cookie },
      payload: { id: ask.json().approval.id, decision: 'approve' },
    });
    expect(approved.json().note).toMatch(/negative/i);
    expect(calls.at(-1)).toBe('add:free,jobs');
  });

  it('creates a paused campaign from chat only after Approve', async () => {
    const { cookie, id } = await owner('create@example.com');
    const saved = await store.getUserData(id);
    const miles = saved.miles as { campaignResource?: string; activation: string };
    miles.campaignResource = undefined;
    miles.activation = 'none';
    await store.setUserData(id, saved);
    const before = calls.length;
    const ask = await app.inject({
      method: 'POST', url: '/api/chat/ask', headers: { cookie },
      payload: { messages: [{ role: 'user', text: 'Set up a Google Ads campaign for Philadelphia, $30/day, interior and exterior painting' }] },
    });
    expect(ask.statusCode).toBe(200);
    expect(ask.json().approval?.title).toMatch(/paused/i);
    expect(ask.json().approval.lines.join('\n')).toMatch(/Budget/);
    expect(calls.length).toBe(before);
    const approved = await app.inject({
      method: 'POST', url: '/api/chat/act', headers: { cookie },
      payload: { id: ask.json().approval.id, decision: 'approve' },
    });
    expect(approved.json().note).toMatch(/paused|Created/i);
    expect(calls.slice(before)).toEqual(['launch']);
    const after = await store.getUserData(id);
    expect((after.miles as { activation?: string }).activation).toBe('paused');
  });
});

describe('approval card in the browser', () => {
  const store = new MemoryStore();
  const connector = {
    name: 'mock',
    async createConnectToken() { return { token: 't', expiresAt: '2099', connectUrl: 'https://example.com' }; },
    async listAccounts() { return []; },
    async runAction() { return { ok: false, actionId: 'x', app: 'x', output: null }; },
  } as unknown as Connector;
  const app = buildServer({ authStore: store, connector });
  let browser: Browser | undefined;

  afterAll(async () => {
    await browser?.close();
    await app.close();
  });

  it('shows Approve and Cancel, and does not change Google before Approve', async () => {
    await app.listen({ host: '127.0.0.1', port: 0 });
    const addr = app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`http://127.0.0.1:${port}/login`);
    await page.click('#tab-signup');
    await page.fill('#email', 'card@example.com');
    await page.fill('#password', 'password1');
    await page.fill('#name', 'Ada');
    await page.check('#tos');
    await page.click('#submit');
    await page.waitForSelector('#overview-body', { timeout: 15000 });
    await page.locator('#onboard').evaluate((el) => el.classList.remove('on'));
    await page.click('[data-ask]');
    await page.fill('#cinput', 'raise my budget to $40 a day');
    await page.press('#cinput', 'Enter');
    const card = page.locator('.chat-approval');
    await card.waitFor({ timeout: 15000 });
    const before = await card.innerText();
    expect(before).toContain('Before:');
    expect(before).toContain('After:');
    expect(before).toContain('$40/day');
    expect(before).toContain('Approve');
    await card.locator('button.go').click();
    await page.waitForFunction("() => /Google Ads was not changed|Saved \\$40/.test(document.querySelector('.chat-approval')?.textContent || '')", undefined, { timeout: 15000 });
  });
});

describe('draft routing', () => {
  it('ignores an ordinary question', () => {
    expect(draftChatAction('What should the homepage headline say?', account()).kind).toBe('none');
  });
});
