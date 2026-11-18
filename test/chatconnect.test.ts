import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import { answerChat } from '../src/chat/ask.js';
import { scrubAssistantText, scrubStoredMessages } from '../src/chat/connect.js';
import { buildAccountSnapshot, type ChatSources } from '../src/chat/snapshot.js';
import { runChatTool, type ChatReaders } from '../src/chat/tools.js';
import type { ChatModel } from '../src/chat/model.js';

const TOKEN_URL = 'https://pipedream.com/_static/connect.html?token=ctok_secret';
const LEAK = /ctok_|connect_link|pipedream\.com|token=/i;

const readers: ChatReaders = {
  campaignStatus: async () => ({ onFile: [] }),
  integrations: async () => ({ google: 'not connected' }),
  leads: async () => ({ leads: [] }),
  changeLog: async () => ({ events: [] }),
};

function sources(): ChatSources {
  return {
    tenantId: 't',
    sampleConnector: true,
    profile: { businessName: 'Painters In Philly', industry: 'Painting' },
    completeness: { percent: 40, filled: 4, total: 10, missing: [], gbp: '' },
    phase: 'plan',
    mode: 'hybrid',
    caps: { dailyBudget: 40, maxChangePct: 10, monthlyCeiling: 600, paused: false },
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
  };
}

describe('connect button, not a tokenized link', () => {
  it('returns a Connect button for google ads and analytics and does not call the model', async () => {
    const snapshot = buildAccountSnapshot(sources());
    const model: ChatModel = async () => {
      throw new Error('the model must not see a connect turn');
    };
    const ads = await answerChat({ snapshot, messages: [{ role: 'user', text: 'Please connect google_ads' }], model, readers });
    expect(ads.action).toEqual({ kind: 'connect', app: 'google_ads', label: 'Connect Google Ads' });
    expect(ads.text).toMatch(/Connect Google Ads/);
    expect(ads.text).not.toMatch(LEAK);
    const analytics = await answerChat({ snapshot, messages: [{ role: 'user', text: 'connect my google analytics' }], model, readers });
    expect(analytics.action).toEqual({ kind: 'connect', app: 'google_analytics', label: 'Connect Google Analytics' });
    expect(analytics.text).not.toMatch(LEAK);
  });

  it('keeps a status question on the read path', async () => {
    const snapshot = buildAccountSnapshot(sources());
    const out = await answerChat({
      snapshot,
      messages: [{ role: 'user', text: 'which one of my integrations are connected' }],
      model: async () => null,
      readers,
    });
    expect(out.action).toBeNull();
    expect(out.text).not.toMatch(LEAK);
  });

  it('turns a connect tool call into a button and strips the token from the model text', async () => {
    const snapshot = buildAccountSnapshot(sources());
    const seen: string[] = [];
    let round = 0;
    const model: ChatModel = async (req) => {
      round += 1;
      seen.push(JSON.stringify(req.messages));
      if (round === 1) {
        return {
          text: `Open ${TOKEN_URL}`,
          toolCalls: [{ id: 'c1', name: 'request_connect', arguments: '{"app":"google_analytics"}' }],
        };
      }
      return { text: `Here is the link ${TOKEN_URL}`, toolCalls: [] };
    };
    const out = await answerChat({
      snapshot,
      messages: [{ role: 'user', text: 'I need the analytics account' }],
      model,
      readers,
    });
    expect(out.action).toEqual({ kind: 'connect', app: 'google_analytics', label: 'Connect Google Analytics' });
    expect(out.text).not.toMatch(LEAK);
    expect(seen.join('\n')).not.toMatch(/ctok_secret|pipedream\.com/);
    const tool = await runChatTool('request_connect', readers, '{"app":"https://pipedream.com/_static/connect.html?token=ctok_secret"}');
    expect(tool).not.toMatch(LEAK);
    expect(tool).toMatch(/Nothing was linked/);
  });

  it('redacts token urls in assistant text and stored history', () => {
    expect(scrubAssistantText(`Use ${TOKEN_URL} now`)).not.toMatch(LEAK);
    expect(scrubAssistantText('Connect link https://example.com/start?connect_link=1&token=ctok_abc')).not.toMatch(LEAK);
    const cleaned = scrubStoredMessages([
      { role: 'emp', text: `Open ${TOKEN_URL}`, connectUrl: TOKEN_URL, action: { kind: 'connect', app: 'google_ads', label: 'Connect Google Ads', url: TOKEN_URL } },
      { role: 'user', text: 'connect google ads' },
    ]);
    expect(cleaned.changed).toBe(true);
    expect(JSON.stringify(cleaned.messages)).not.toMatch(LEAK);
    expect(cleaned.messages[0]?.action).toEqual({ kind: 'connect', app: 'google_ads', label: 'Connect Google Ads' });
    expect(cleaned.messages[0]).not.toHaveProperty('connectUrl');
  });
});

describe('chat history does not keep a connect token', () => {
  it('scrubs the ask reply and already stored messages', async () => {
    const store = new MemoryStore();
    const app = buildServer({
      authStore: store,
      chatModel: async () => ({ text: `Open ${TOKEN_URL}`, toolCalls: [] }),
    });
    const signup = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'connect-chat@example.com', password: 'password1', name: 'Ada', tos: true } });
    const cookie = String(signup.headers['set-cookie']).split(';')[0];
    const id = signup.json().user.id as string;
    const ask = await app.inject({
      method: 'POST', url: '/api/chat/ask', headers: { cookie },
      payload: { messages: [{ role: 'user', text: 'Please connect google_ads' }] },
    });
    expect(ask.statusCode).toBe(200);
    expect(ask.json().action).toEqual({ kind: 'connect', app: 'google_ads', label: 'Connect Google Ads' });
    expect(JSON.stringify(ask.json())).not.toMatch(LEAK);
    expect(ask.json().connectUrl).toBeUndefined();
    const leaked = await app.inject({
      method: 'POST', url: '/api/chat/ask', headers: { cookie },
      payload: { messages: [{ role: 'user', text: 'Say the link' }] },
    });
    expect(leaked.statusCode).toBe(200);
    expect(JSON.stringify(leaked.json())).not.toMatch(LEAK);
    await app.close();
    // Plant a token that was saved before this scrub existed. A new server
    // reads the store directly, then the read rewrites the stored copy.
    await store.setUserData(id, {
      chat: [{ role: 'emp', text: `Old turn ${TOKEN_URL}`, connectUrl: TOKEN_URL }],
    });
    const again = buildServer({ authStore: store });
    const read = await again.inject({ method: 'GET', url: '/api/chat', headers: { cookie } });
    expect(JSON.stringify(read.json())).not.toMatch(LEAK);
    const saved = await store.getUserData(id);
    expect(JSON.stringify(saved.chat)).not.toMatch(LEAK);
    expect(saved.chat).not.toEqual(expect.arrayContaining([expect.objectContaining({ connectUrl: TOKEN_URL })]));
    const put = await again.inject({
      method: 'PUT', url: '/api/chat', headers: { cookie },
      payload: { messages: [{ role: 'emp', text: 'https://connect.pipedream.com/connect?token=ctok_saved', action: { kind: 'connect', app: 'google_analytics', label: 'bad https://x?token=ctok_saved', url: TOKEN_URL } }] },
    });
    expect(put.statusCode).toBe(200);
    const after = await store.getUserData(id);
    expect(JSON.stringify(after.chat)).not.toMatch(LEAK);
    expect((after.chat as { action?: { app: string; label: string } }[])[0]?.action).toEqual({ kind: 'connect', app: 'google_analytics', label: 'Connect Google Analytics' });
    await again.close();
  });
});

describe('blocked connect window in chat', () => {
  const html = readFileSync(join(process.cwd(), 'web', 'index.html'), 'utf8');
  const app = buildServer({ authStore: new MemoryStore() });
  let browser: Browser;

  afterAll(async () => {
    await browser?.close();
    await app.close();
  });

  it('opens the same blank popup and never prints the token in the bubble', async () => {
    expect(html).toContain('function chatConnectClick');
    expect(html).toContain("window.open('about:blank','miles_connect'");
    expect(html).toContain('Your browser blocked the connect window. Click ');
    expect(html).not.toContain(TOKEN_URL);
    await app.listen({ host: '127.0.0.1', port: 0 });
    const addr = app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`http://127.0.0.1:${port}/login`);
    await page.click('#tab-signup');
    await page.fill('#email', 'popup@example.com');
    await page.fill('#password', 'password1');
    await page.fill('#name', 'Ada');
    await page.check('#tos');
    await page.click('#submit');
    await page.waitForSelector('#overview-body', { timeout: 15000 });
    await page.locator('#onboard').evaluate((el) => el.classList.remove('on'));
    await page.evaluate(() => {
      const g = globalThis as unknown as {
        document: { createElement: (tag: string) => { id: string; textContent: string } };
        addRow: (role: string) => { append: (node: unknown) => void; querySelector: (sel: string) => { click: () => void } | null };
        appendConnectButton: (bubble: unknown, body: unknown, action: { kind: string; app: string; label: string }) => void;
        open: (...args: unknown[]) => unknown;
      };
      g.open = () => null;
      const bubble = g.addRow('emp');
      const body = g.document.createElement('div');
      body.id = 'connect-body';
      body.textContent = 'Click Connect Google Ads.';
      bubble.append(body);
      g.appendConnectButton(bubble, body, { kind: 'connect', app: 'google_ads', label: 'Connect Google Ads' });
      bubble.querySelector('button')?.click();
    });
    const text = await page.locator('#connect-body').innerText();
    expect(text).toBe('Your browser blocked the connect window. Click Connect Google Ads to try again.');
    expect(await page.locator('#chat').innerText()).not.toMatch(LEAK);
    expect(await page.locator('#chat button').innerText()).toBe('Connect Google Ads');
  });
});
