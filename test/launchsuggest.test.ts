import { afterAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { resolveBenchmark } from '../src/benchmarks/resolve.js';
import { draftChatAction, type ActAccount } from '../src/chat/act.js';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import type { Connector } from '../src/connectors/types.js';

function account(extra: Partial<ActAccount> = {}): ActAccount {
  return {
    business: 'Northside Plumbing',
    trade: 'Plumbing',
    services: 'Drain cleaning, water heaters',
    serviceAreas: 'Philadelphia, PA',
    website: 'https://northside.example',
    phone: '2155550100',
    hours: 'Monday 8am to 5pm',
    mode: 'hybrid',
    kill: false,
    dailyCap: 80,
    monthlyCeiling: 3000,
    maxChangePct: 100,
    currentDaily: 0,
    campaignName: '',
    campaignResource: '',
    activation: 'none',
    trackingLead: true,
    protectTerms: [],
    imageUrl: 'https://cdn.example/van.jpg',
    ...extra,
  };
}

describe('benchmark resolver', () => {
  it('reads a stored trade figure and says when the lead type is not stored', () => {
    const hit = resolveBenchmark({ trade: 'plumbing', platform: 'lsa', metric: 'roas', leadType: 'repair' });
    expect(hit.value).toBe(6.85);
    expect(hit.sampleSize).toBe(230);
    expect(hit.label).toMatch(/Searchlight, Feb 2026/);
    expect(hit.label).toMatch(/Trade-level/);
    expect(hit.label).toMatch(/repair/);
    const cpl = resolveBenchmark({ trade: 'plumbing', platform: 'google', metric: 'cpl', leadType: 'repair' });
    expect(cpl.kind).toBe('searchlight');
    expect(cpl.value).toBe(183);
  });

  it('does not invent a figure when nothing is stored', () => {
    const tiktok = resolveBenchmark({ trade: 'plumbing', platform: 'tiktok', metric: 'cpl' });
    expect(tiktok.kind).toBe('none');
    expect(tiktok.value).toBeNull();
    expect(resolveBenchmark({ trade: 'solar', platform: 'google', metric: 'cpl' }).value).toBeNull();
    expect(resolveBenchmark({ trade: 'plumbing', platform: 'lsa', metric: 'roi' }).kind).toBe('none');
  });
});

describe('launch suggestion', () => {
  it('keeps a named Google request on the existing paused Google card', () => {
    const drafted = draftChatAction('Set up a Google Ads campaign for Philadelphia, $30/day, interior and exterior painting', account({ trade: 'Painting', services: 'Interior painting, exterior painting' }));
    expect(drafted.kind).toBe('card');
    if (drafted.kind !== 'card') return;
    expect(drafted.approval.kind).toBe('create_campaign');
    expect(drafted.approval.payload.spec?.status).toBe('PAUSED');
  });

  it('suggests only platforms with figures, then builds that split on yes', () => {
    const ask = 'Launch a $30/day campaign for a plumber with lots of repair leads';
    const drafted = draftChatAction(ask, account());
    expect(drafted.kind).toBe('suggest');
    if (drafted.kind !== 'suggest') return;
    expect(drafted.text).toMatch(/repair leads/);
    expect(drafted.text).toMatch(/Local Services Ads/);
    expect(drafted.text).toMatch(/Google Search/);
    expect(drafted.text).toMatch(/Searchlight, Feb 2026/);
    expect(drafted.text).toMatch(/Playbook estimate/);
    expect(drafted.text).toMatch(/Trade-level/);
    expect(drafted.text).toMatch(/Want to split the campaign across those/);
    expect(drafted.text).toMatch(/Meta/);
    expect(drafted.text).not.toMatch(/TikTok/);
    expect(drafted.text).not.toMatch(/\u2014/);
    const yes = draftChatAction('Yes', account(), [{ role: 'user', text: ask }, { role: 'emp', text: drafted.text }]);
    expect(yes.kind).toBe('card');
    if (yes.kind !== 'card') return;
    expect(yes.approval.kind).toBe('launch_plan');
    const slices = yes.approval.payload.launch || [];
    expect(slices.map((row) => row.id).sort()).toEqual(['google', 'lsa', 'meta']);
    expect(slices.reduce((sum, row) => sum + row.daily, 0)).toBe(30);
    expect(slices.find((row) => row.id === 'lsa')?.create).toBe(false);
    expect(slices.find((row) => row.id === 'google')?.spec?.status).toBe('PAUSED');
    expect(yes.approval.lines.join(' ')).toMatch(/Owner action needed/);
  });

  it('offers the quick picks after no, and a named Meta request skips the suggestion', () => {
    const ask = 'Launch a $30/day campaign for a plumber with lots of repair leads';
    const drafted = draftChatAction(ask, account());
    const no = draftChatAction('No', account(), [{ role: 'user', text: ask }, { role: 'emp', text: drafted.kind === 'suggest' ? drafted.text : '' }]);
    expect(no.kind).toBe('choose');
    if (no.kind !== 'choose') return;
    expect(no.picker.options.map((option) => option.label)).toEqual(['Google only', 'Meta only', 'TikTok only', 'Local Services Ads only', 'Multi-platform']);
    expect(no.picker.options.find((option) => option.id === 'multi')?.selected).toBe(true);
    const meta = draftChatAction('Launch a $30/day Meta campaign in Philadelphia for an HVAC replacement', account({ trade: 'HVAC', services: 'AC replacement' }));
    expect(meta.kind).toBe('card');
    if (meta.kind !== 'card') return;
    expect(meta.approval.kind).toBe('launch_plan');
    expect(meta.approval.payload.launch?.map((row) => row.id)).toEqual(['meta']);
    expect(meta.approval.payload.launch?.[0]?.metaPlan).toBeTruthy();
    expect(JSON.stringify(meta.approval.payload.launch?.[0]?.metaPlan)).toMatch(/"status":"PAUSED"/);
  });

  it('does not call a platform best when the trade has no figures', () => {
    const drafted = draftChatAction('Launch a $30/day campaign in Philadelphia for solar', account({ trade: 'Solar', services: 'Solar panels' }));
    expect(drafted.kind).toBe('choose');
    if (drafted.kind !== 'choose') return;
    expect(drafted.text).toMatch(/No platform is ranked as best/);
    expect(drafted.text).not.toMatch(/performing best/);
  });

  it('refuses a TikTok plan under the published minimum instead of raising it', () => {
    const drafted = draftChatAction('Launch a $30/day TikTok campaign in Philadelphia for plumbing', account());
    expect(drafted.kind).toBe('card');
    if (drafted.kind !== 'card') return;
    expect(drafted.approval.payload.launch?.[0]?.create).toBe(false);
    expect(drafted.approval.lines.join(' ')).toMatch(/\$50/);
  });
});

describe('paused create from the suggestion', () => {
  const calls: string[] = [];
  const connector = {
    name: 'pipedream',
    async createConnectToken() { return { token: 't', expiresAt: '2099', connectUrl: 'https://example.com' }; },
    async listAccounts() { return [{ id: 'acct', app: 'google_ads', externalUserId: 'u', healthy: true }]; },
    async runAction() { return { ok: false, actionId: 'x', app: 'google_ads', output: null }; },
    async listAdTargets() { return [{ id: '123', label: 'Northside' }]; },
    async launchCampaign() { calls.push('google'); return { ok: true, live: true, campaignResource: 'customers/1/campaigns/9', steps: [], note: 'Created paused.' }; },
    async launchMetaStructure() { calls.push('meta'); return { ok: true, live: true, status: 'PAUSED', note: 'Meta paused.', steps: [], campaignId: 'm1', adSetIds: ['s1'], adIds: ['a1'] }; },
    async setMetaTreeStatus(_id: string, args: { status: string }) { calls.push(`meta:${args.status}`); return { ok: true, live: true, status: 'PAUSED', note: 'Meta paused.', steps: [] }; },
    async launchTikTokStructure() { calls.push('tiktok'); return { ok: false, live: false, status: 'DISABLE', note: 'not used', steps: [] }; },
  } as unknown as Connector;
  const store = new MemoryStore();
  const app = buildServer({ authStore: store, connector });
  afterAll(async () => { await app.close(); });

  async function owner(email: string) {
    const signup = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email, password: 'password1', name: 'Ada', tos: true } });
    const cookie = String(signup.headers['set-cookie']).split(';')[0];
    const id = signup.json().user.id as string;
    await store.setUserData(id, {
      profile: { businessName: 'Northside Plumbing', industry: 'Plumbing', services: 'Drain cleaning', serviceAreas: 'Philadelphia, PA', website: 'https://northside.example', phone: '2155550100' },
      trackingProof: { leadConversion: true, method: 'call_or_form' },
      assets: { photos: [{ url: 'https://cdn.example/van.jpg' }] },
      miles: { phase: 'ready', activation: 'none', bundle: { setup: { mode: 'hybrid', businessName: 'Northside Plumbing', location: 'Philadelphia', website: 'https://northside.example', caps: { dailyBudget: 80, monthlyCeiling: 3000, maxChangePct: 100, paused: false } }, channels: [], profile: { industry: 'Plumbing', services: 'Drain cleaning' } } },
    });
    return { cookie, id };
  }

  it('creates the ranked platforms paused only after Approve, and does not create Local Services Ads', async () => {
    const { cookie, id } = await owner('suggest@example.com');
    const ask = await app.inject({
      method: 'POST', url: '/api/chat/ask', headers: { cookie },
      payload: { messages: [{ role: 'user', text: 'Launch a $30/day campaign for a plumber with lots of repair leads' }] },
    });
    expect(ask.statusCode).toBe(200);
    expect(ask.json().choices).toBe('suggest');
    expect(ask.json().text).toMatch(/Searchlight/);
    expect(calls).toEqual([]);
    const yes = await app.inject({
      method: 'POST', url: '/api/chat/ask', headers: { cookie },
      payload: {
        messages: [
          { role: 'user', text: 'Launch a $30/day campaign for a plumber with lots of repair leads' },
          { role: 'emp', text: ask.json().text },
          { role: 'user', text: 'Yes' },
        ],
        launchChoice: { accept: true },
      },
    });
    expect(yes.json().approval.kind).toBeUndefined();
    expect(yes.json().approval.title).toMatch(/paused/i);
    expect(calls).toEqual([]);
    const approved = await app.inject({
      method: 'POST', url: '/api/chat/act', headers: { cookie },
      payload: { id: yes.json().approval.id, decision: 'approve' },
    });
    expect(approved.statusCode).toBe(200);
    expect(calls).toEqual(['meta', 'google']);
    expect(approved.json().note).toMatch(/Owner action needed|paused/i);
    const undone = await app.inject({
      method: 'POST', url: '/api/activity/undo', headers: { cookie },
      payload: { id: yes.json().approval.id, source: 'automation' },
    });
    expect(undone.json().reason).toMatch(/Nothing was deleted|Paused/);
    const saved = await store.getUserData(id);
    expect(saved.launchPreference).toEqual(['lsa', 'meta', 'google']);
  });

  it('blocks a plan over the daily cap before any create call', async () => {
    const { cookie, id } = await owner('caplaunch@example.com');
    const data = await store.getUserData(id);
    const miles = data.miles as { bundle: { setup: { caps: { dailyBudget: number } } } };
    miles.bundle.setup.caps.dailyBudget = 20;
    await store.setUserData(id, data);
    const before = calls.length;
    const ask = await app.inject({
      method: 'POST', url: '/api/chat/ask', headers: { cookie },
      payload: { messages: [{ role: 'user', text: 'Launch a $30/day Meta campaign in Philadelphia for drain cleaning' }] },
    });
    expect(ask.json().approval).toBeNull();
    expect(ask.json().text).toMatch(/daily cap/);
    expect(calls.length).toBe(before);
  });
});

describe('suggestion buttons', () => {
  const store = new MemoryStore();
  const connector = {
    name: 'mock',
    async createConnectToken() { return { token: 't', expiresAt: '2099', connectUrl: 'https://example.com' }; },
    async listAccounts() { return []; },
    async runAction() { return { ok: false, actionId: 'x', app: 'x', output: null }; },
  } as unknown as Connector;
  const app = buildServer({ authStore: store, connector });
  let browser: Browser | undefined;
  afterAll(async () => { await browser?.close(); await app.close(); });

  it('shows the suggestion, then the platform buttons', async () => {
    await app.listen({ host: '127.0.0.1', port: 0 });
    const addr = app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`http://127.0.0.1:${port}/login`);
    await page.click('#tab-signup');
    await page.fill('#email', 'picker@example.com');
    await page.fill('#password', 'password1');
    await page.fill('#name', 'Ada');
    await page.check('#tos');
    await page.click('#submit');
    await page.waitForSelector('#overview-body', { timeout: 15000 });
    const user = await store.getUserByEmail('picker@example.com');
    const saved = await store.getUserData(user!.id);
    saved.profile = { businessName: 'Northside Plumbing', industry: 'Plumbing', services: 'Drain cleaning', serviceAreas: 'Philadelphia, PA', website: 'https://northside.example', phone: '2155550100' };
    saved.trackingProof = { leadConversion: true };
    saved.miles = { phase: 'ready', activation: 'none', bundle: { setup: { mode: 'hybrid', caps: { dailyBudget: 80, monthlyCeiling: 3000, maxChangePct: 100, paused: false } }, channels: [], profile: { industry: 'Plumbing' } } };
    await store.setUserData(user!.id, saved);
    await page.locator('#onboard').evaluate((el) => el.classList.remove('on'));
    await page.click('[data-ask]');
    await page.fill('#cinput', 'Launch a $30/day campaign for a plumber with lots of repair leads');
    await page.press('#cinput', 'Enter');
    const picker = page.locator('.chat-launch-picker');
    await picker.waitFor({ timeout: 15000 });
    await expect.poll(async () => page.locator('.bubble.md').last().innerText()).toContain('Searchlight');
    await picker.locator('button.ghost', { hasText: 'No, I will choose' }).click();
    await page.locator('.chat-launch-picker button', { hasText: 'Google only' }).waitFor({ timeout: 15000 });
    const labels = await page.locator('.chat-launch-picker').last().locator('button').allInnerTexts();
    expect(labels.join(' ')).toMatch(/Google only/);
    expect(labels.join(' ')).toMatch(/Meta only/);
    expect(labels.join(' ')).toMatch(/TikTok only/);
    expect(labels.join(' ')).toMatch(/Local Services Ads only/);
    expect(labels.join(' ')).toMatch(/Multi-platform/);
  }, 30000);
});
