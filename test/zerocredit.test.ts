import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import { MockConnector } from '../src/connectors/mock.js';

const CANNED = /Miles has no credits to work with yet/;
const TOKEN = /ctok_secret|pipedream\.com/;

describe('zero-credit chat still answers and keeps history', () => {
  const prev = process.env.BILLING_ENFORCE;
  process.env.BILLING_ENFORCE = '1';
  const store = new MemoryStore();
  const connector = new MockConnector();
  let modelCalls = 0;
  const app = buildServer({
    authStore: store,
    connector,
    chatModel: async () => {
      modelCalls += 1;
      return { text: 'The model should not run for these reads.', toolCalls: [] };
    },
  });
  let browser: Browser | undefined;

  afterAll(async () => {
    if (prev === undefined) delete process.env.BILLING_ENFORCE;
    else process.env.BILLING_ENFORCE = prev;
    await browser?.close();
    await app.close();
  });

  it('answers connection and credit questions from the account, and keeps them after reload', async () => {
    const signup = await app.inject({
      method: 'POST', url: '/auth/signup',
      payload: { email: 'helppaul@example.com', password: 'password1', name: 'Paul', tos: true },
    });
    const cookie = String(signup.headers['set-cookie']).split(';')[0];
    const id = signup.json().user.id as string;
    connector.connect(id, 'google_ads');
    const ask = (text: string) => app.inject({
      method: 'POST', url: '/api/chat/ask', headers: { cookie },
      payload: { messages: [{ role: 'user', text }] },
    });
    const connected = await ask('whats connected');
    const google = await ask('is google connected');
    expect(connected.statusCode).toBe(200);
    expect(google.statusCode).toBe(200);
    expect(connected.json().text).toMatch(/Google Ads is connected/);
    expect(connected.json().text).toMatch(/You have 1 of 3 tools connected: Google Ads/);
    expect(connected.json().text).toMatch(/Connect 2 more to unlock \$100/);
    expect(connected.json().text).not.toMatch(CANNED);
    expect(google.json().text).toMatch(/Google Ads is connected/);
    expect(google.json().text).toMatch(/Google Analytics is not connected/);
    expect(google.json().text).not.toMatch(CANNED);
    expect(modelCalls).toBe(0);
    const reloaded = await app.inject({ method: 'GET', url: '/api/chat', headers: { cookie } });
    const messages = reloaded.json().messages as { role: string; text: string }[];
    expect(messages).toHaveLength(4);
    expect(messages.map((row) => row.text)).toEqual([
      'whats connected',
      connected.json().text,
      'is google connected',
      google.json().text,
    ]);

    const credits = await ask('how many credits do I have');
    expect(credits.json().text).toMatch(/You have \$0 in credits/);
    expect(credits.json().text).toMatch(/1 of 3 tools connected: Google Ads/);
    expect(credits.json().text).not.toMatch(CANNED);

    const ads = await ask('write me some ads for drain cleaning');
    expect(ads.json().text).toMatch(/I can't write ads until there are credits to work with/);
    expect(ads.json().text).toMatch(/1 of 3 tools connected: Google Ads/);
    expect(ads.json().text).toMatch(/\$149 a month/);
    expect(ads.json().text).not.toMatch(CANNED);
    expect(modelCalls).toBe(0);

    const connect = await ask('connect google analytics');
    expect(connect.json().action).toEqual({ kind: 'connect', app: 'google_analytics', label: 'Connect Google Analytics' });
    expect(JSON.stringify(connect.json())).not.toMatch(TOKEN);
    const after = await app.inject({ method: 'GET', url: '/api/chat', headers: { cookie } });
    const saved = after.json().messages as { text: string; action?: { kind: string; app: string; label: string } }[];
    const button = saved.find((row) => row.action?.kind === 'connect');
    expect(button?.action).toEqual({ kind: 'connect', app: 'google_analytics', label: 'Connect Google Analytics' });
    expect(JSON.stringify(saved)).not.toMatch(TOKEN);
  });

  it('loads an old tokenized link scrubbed, and does not let an empty save delete history', async () => {
    const signup = await app.inject({
      method: 'POST', url: '/auth/signup',
      payload: { email: 'history@example.com', password: 'password1', name: 'Ada', tos: true },
    });
    const cookie = String(signup.headers['set-cookie']).split(';')[0];
    const put = await app.inject({
      method: 'PUT', url: '/api/chat', headers: { cookie },
      payload: { messages: [
        { role: 'user', text: 'where is the link' },
        { role: 'emp', text: 'Open https://pipedream.com/_static/connect.html?token=ctok_secret please' },
      ] },
    });
    expect(put.statusCode).toBe(200);
    const read = await app.inject({ method: 'GET', url: '/api/chat', headers: { cookie } });
    const messages = read.json().messages as { role: string; text: string }[];
    expect(messages).toHaveLength(2);
    expect(messages[0]?.text).toBe('where is the link');
    expect(messages[1]?.text).not.toMatch(TOKEN);
    expect(messages[1]?.text.length).toBeGreaterThan(0);
    const wipe = await app.inject({
      method: 'PUT', url: '/api/chat', headers: { cookie },
      payload: { messages: [] },
    });
    expect(wipe.statusCode).toBe(200);
    const kept = await app.inject({ method: 'GET', url: '/api/chat', headers: { cookie } });
    expect(kept.json().messages).toHaveLength(2);
  });
});

describe('chat page loads history on refresh', () => {
  const html = readFileSync(join(process.cwd(), 'web', 'index.html'), 'utf8');
  const prev = process.env.BILLING_ENFORCE;
  process.env.BILLING_ENFORCE = '1';
  const app = buildServer({
    authStore: new MemoryStore(),
    chatModel: async () => ({ text: 'model', toolCalls: [] }),
  });
  let browser: Browser | undefined;

  afterAll(async () => {
    if (prev === undefined) delete process.env.BILLING_ENFORCE;
    else process.env.BILLING_ENFORCE = prev;
    await browser?.close();
    await app.close();
  });

  it('paints both questions and both replies after a reload of #chat', async () => {
    process.env.BILLING_ENFORCE = '1';
    expect(html).toContain("if(id==='chat' && !CHAT_LOADED) loadChat();");
    await app.listen({ host: '127.0.0.1', port: 0 });
    const addr = app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`http://127.0.0.1:${port}/login`);
    await page.click('#tab-signup');
    await page.fill('#email', 'reload@example.com');
    await page.fill('#password', 'password1');
    await page.fill('#name', 'Ada');
    await page.check('#tos');
    await page.click('#submit');
    await page.waitForSelector('#overview-body', { timeout: 15000 });
    await page.locator('#onboard').evaluate((el) => el.classList.remove('on'));
    await page.evaluate(async () => {
      const g = globalThis as unknown as { send: (text: string) => Promise<void> };
      await g.send('whats connected');
      await g.send('is google connected');
    });
    await page.goto(`http://127.0.0.1:${port}/#chat`);
    await page.waitForFunction('document.querySelectorAll("#chat .row").length >= 4', undefined, { timeout: 15000 });
    const text = await page.locator('#chat').innerText();
    expect(text).toMatch(/whats connected/);
    expect(text).toMatch(/is google connected/);
    expect(text).toMatch(/Nothing is connected yet|Google Ads is not connected/);
    expect(text).not.toMatch(/Miles has no credits to work with yet/);
    expect(await page.locator('#chat .row').count()).toBe(4);
  });
});
