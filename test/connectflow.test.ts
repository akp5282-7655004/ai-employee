import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import { Agent, newSession, type Session } from '../src/agent/index.js';
import { MockConnector } from '../src/connectors/index.js';

describe('connect window stays on the page', () => {
  const html = readFileSync(join(process.cwd(), 'web', 'index.html'), 'utf8');

  it('does not send a blocked connect into chat or print the token URL', () => {
    expect(html).toContain('function beginConnect');
    expect(html).toContain("window.open('about:blank','miles_connect'");
    expect(html).toContain('Open connect window');
    expect(html).not.toContain('open it manually');
    expect(html).not.toContain('blocked the pop-up');
  });

  it('does not put the connect link in the chat reply', async () => {
    const agent = new Agent({ connector: new MockConnector() });
    const res = await agent.handle(newSession('shop') as Session, 'connect my google ads');
    expect(res.reply.connectUrl).toBeTruthy();
    expect(res.reply.text).toMatch(/Integrations page/);
    expect(res.reply.text).not.toMatch(/https?:|token=/);
  });
});

describe('blocked connect card', () => {
  const app = buildServer({ authStore: new MemoryStore() });
  let browser: Browser;

  afterAll(async () => {
    await browser?.close();
    await app.close();
  });

  it('stays on the current page and offers a button without the token', async () => {
    await app.listen({ host: '127.0.0.1', port: 0 });
    const addr = app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`http://127.0.0.1:${port}/login`);
    await page.click('#tab-signup');
    await page.fill('#email', 'connect@example.com');
    await page.fill('#password', 'password1');
    await page.fill('#name', 'Ada');
    await page.check('#tos');
    await page.click('#submit');
    await page.waitForSelector('#overview-body', { timeout: 15000 });
    await page.locator('#onboard').evaluate((el) => el.classList.remove('on'));
    await page.evaluate(() => {
      const g = globalThis as unknown as {
        CONN: { hub: { ready: boolean }; connectedApps: string[] };
        open: (...args: unknown[]) => unknown;
        fetch: (url: unknown, opts?: unknown) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;
        beginConnect: (slug: string) => void;
      };
      g.CONN = { hub: { ready: true }, connectedApps: [] };
      g.open = () => null;
      const orig = g.fetch;
      g.fetch = async (url, opts) => {
        if (String(url).includes('/api/connect-token')) {
          return { ok: true, json: async () => ({ connectUrl: 'https://pipedream.com/_static/connect.html?token=ctok_secret' }) };
        }
        return orig(url, opts);
      };
      g.beginConnect('google_analytics');
    });
    await page.waitForSelector('#connect-card');
    const text = await page.locator('#connect-card').innerText();
    expect(text).toMatch(/Open connect window/);
    expect(text).not.toMatch(/ctok_secret|connect\.html|pipedream\.com/);
    expect(await page.locator('#page-chat.on').count()).toBe(0);
    expect(await page.locator('#ptitle').innerText()).not.toMatch(/Chat/);
  });
});
