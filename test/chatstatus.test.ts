import { afterAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import { MockConnector } from '../src/connectors/mock.js';
import { ownerStatusAnswer } from '../src/chat/account.js';
import { scrubAssistantText } from '../src/chat/connect.js';
import { buildAccountSnapshot, type ChatSources } from '../src/chat/snapshot.js';

const TOKEN_URL = 'https://pipedream.com/_static/connect.html?connectLink=true&token=ctok_secret';

function sources(extra: Partial<ChatSources> = {}): ChatSources {
  return {
    tenantId: 't',
    sampleConnector: false,
    profile: { businessName: 'Painters In Philly', website: 'https://painters.example' },
    completeness: { percent: 40, filled: 4, total: 10, missing: [], gbp: '' },
    phase: 'plan',
    mode: 'hybrid',
    caps: null,
    tracking: null,
    plan: null,
    milesCampaign: null,
    journey: null,
    spendRows: [],
    spendReadAt: null,
    bookedFromJobs: null,
    bookedFromDeals: null,
    google: { oauth: false, ready: false, customerId: null, note: 'Not connected', error: null },
    ghl: { connected: false, detail: 'Not connected' },
    speedToLead: { enabled: false, today: 0, total: 0, held: 0, canSend: false },
    social: { facebook: false, instagram: false, linkedin: false, gbp: false },
    automations: { noShow: false, onboarding: false },
    events: [],
    changeLog: [],
    inbox: [],
    leads: [],
    connectedApps: ['google_analytics', 'google_ads', 'gohighlevel'],
    creditsRemaining: 40,
    launchGranted: true,
    ...extra,
  };
}

function countLine(text: string): string {
  return text.match(/You have \d+ of \d+ tools connected:[^.]*\./)?.[0] || '';
}

describe('one connection list', () => {
  it('gives whats connected and is google connected the same tools and count', () => {
    const snapshot = buildAccountSnapshot(sources());
    expect(snapshot.integrations.google.oauth).toBe(false);
    const listed = ownerStatusAnswer(snapshot, 'whats connected');
    const google = ownerStatusAnswer(snapshot, 'is google connected');
    expect(countLine(listed)).toBe('You have 3 of 3 tools connected: Google Ads, GoHighLevel, Website.');
    expect(countLine(google)).toBe(countLine(listed));
    expect(listed).toMatch(/Google Analytics, Google Ads, GoHighLevel and Website are connected/);
    expect(google).toMatch(/Google Ads is connected/);
    expect(google).toMatch(/Google Analytics is connected/);
    expect(google).toMatch(/Google Business Profile is not connected/);
    expect(listed).not.toMatch(/unlock/);
    expect(google).not.toMatch(/unlock/);
  });
});

describe('chat history is stored once and connect links stay out of the bubble', () => {
  const store = new MemoryStore();
  const connector = new MockConnector();
  const app = buildServer({
    authStore: store,
    connector,
    chatModel: async () => ({ text: `Open ${TOKEN_URL}`, toolCalls: [] }),
  });
  let browser: Browser | undefined;

  afterAll(async () => {
    await browser?.close();
    await app.close();
  });

  it('keeps each owner message once after a save and a reload', async () => {
    const signup = await app.inject({
      method: 'POST', url: '/auth/signup',
      payload: { email: 'painters@example.com', password: 'password1', name: 'Paul', tos: true },
    });
    const cookie = String(signup.headers['set-cookie']).split(';')[0];
    const id = signup.json().user.id as string;
    connector.connect(id, 'google_ads');
    connector.connect(id, 'google_analytics');
    connector.connect(id, 'gohighlevel');
    await app.inject({
      method: 'PUT', url: '/api/profile', headers: { cookie },
      payload: { businessName: 'Painters In Philly', website: 'https://painters.example' },
    });
    const ask = (text: string) => app.inject({
      method: 'POST', url: '/api/chat/ask', headers: { cookie },
      payload: { messages: [{ role: 'user', text }] },
    });
    // The browser saves the owner line before the reply is stored. That must not duplicate it.
    await app.inject({
      method: 'PUT', url: '/api/chat', headers: { cookie },
      payload: { messages: [{ role: 'user', text: 'whats connected' }] },
    });
    const listed = await ask('whats connected');
    const google = await ask('is google connected');
    expect(countLine(listed.json().text)).toBe(countLine(google.json().text));
    expect(google.json().text).toMatch(/Google Ads is connected/);
    const read = await app.inject({ method: 'GET', url: '/api/chat', headers: { cookie } });
    const messages = read.json().messages as { role: string; text: string }[];
    const owners = messages.filter((row) => row.role === 'user').map((row) => row.text);
    expect(owners.filter((text) => text === 'whats connected')).toHaveLength(1);
    expect(owners.filter((text) => text === 'is google connected')).toHaveLength(1);
    expect(messages.filter((row) => row.role === 'emp')).toHaveLength(2);
  });

  it('scrubs a connect token when the bubble is drawn and when history is read', async () => {
    expect(scrubAssistantText(`Open ${TOKEN_URL}`)).toBe('Open [connect link removed]');
    expect(scrubAssistantText(`Open ${TOKEN_URL}`)).not.toMatch(/ctok_secret|pipedream\.com/);
    const signup = await app.inject({
      method: 'POST', url: '/auth/signup',
      payload: { email: 'link@example.com', password: 'password1', name: 'Ada', tos: true },
    });
    const cookie = String(signup.headers['set-cookie']).split(';')[0];
    await app.inject({
      method: 'PUT', url: '/api/chat', headers: { cookie },
      payload: { messages: [{ role: 'emp', text: `Old link ${TOKEN_URL}` }] },
    });
    const read = await app.inject({ method: 'GET', url: '/api/chat', headers: { cookie } });
    const text = (read.json().messages as { text: string }[])[0]?.text || '';
    expect(text).toMatch(/\[connect link removed\]/);
    expect(text).not.toMatch(/ctok_secret|pipedream\.com/);
    const again = await store.getUserData(signup.json().user.id as string);
    expect(JSON.stringify(again.chat)).not.toMatch(/ctok_secret|pipedream\.com/);

    await app.listen({ host: '127.0.0.1', port: 0 });
    const addr = app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/login`);
    await page.click('#tab-signup');
    await page.fill('#email', 'render@example.com');
    await page.fill('#password', 'password1');
    await page.fill('#name', 'Ada');
    await page.check('#tos');
    await page.click('#submit');
    await page.waitForSelector('#overview-body', { timeout: 15000 });
    const html = await page.evaluate((url: string) => {
      const g = globalThis as unknown as { mdToHtml: (md: string) => string };
      return g.mdToHtml(`Open ${url}`);
    }, TOKEN_URL);
    expect(html).toContain('[connect link removed]');
    expect(html).not.toMatch(/ctok_secret|pipedream\.com/);
  });
});
