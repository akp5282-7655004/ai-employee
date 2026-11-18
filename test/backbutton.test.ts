import { afterAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';

/**
 * Checklist row 109. Moving between pages rewrote the address without adding
 * a history entry, so the browser's Back button left the app and showed the
 * login form to an owner who was still signed in, and Refresh always went
 * back to the Dashboard.
 */
let browser: Browser | undefined;
afterAll(async () => { await browser?.close(); });

type W = { setPage: (x: string) => void; location: { hash: string } };
const PASSWORD = 'Harbor-Lantern-42';

describe('Back, Forward and Refresh inside the app', () => {
  it('Back returns to the previous page, Forward redoes it, Refresh stays put', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const base = await app.listen({ port: 0, host: '127.0.0.1' });
    await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'back@example.com', password: PASSWORD, tos: true } });
    browser = await chromium.launch();
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    const current = () => page.locator('.page.on').first().getAttribute('id');

    // Sign in through the form, as an owner does.
    await page.goto(base + '/login');
    await page.fill('#email', 'back@example.com');
    await page.fill('#password', PASSWORD);
    await page.click('#submit');
    await page.waitForSelector('#nav', { state: 'attached' });
    await expect.poll(() => page.evaluate(() => (globalThis as unknown as W).location.hash)).toBe('#overview');
    await page.locator('#onboard').evaluate((el) => el.classList.remove('on'));

    await page.evaluate(() => (globalThis as unknown as W).setPage('library'));
    await page.evaluate(() => (globalThis as unknown as W).setPage('settings'));
    await expect.poll(current).toBe('page-settings');

    await page.goBack();
    await expect.poll(current).toBe('page-library');
    await page.goBack();
    await expect.poll(current).toBe('page-overview');
    await page.goForward();
    await expect.poll(current).toBe('page-library');
    await page.goForward();
    await expect.poll(current).toBe('page-settings');

    await page.reload();
    await page.waitForSelector('#nav', { state: 'attached' });
    await expect.poll(current).toBe('page-settings');
    expect(await page.evaluate(() => (globalThis as unknown as W).location.hash)).toBe('#settings');

    // Back from the first page of the app does not show a login form to a signed-in owner.
    await page.goBack(); // library
    await page.goBack(); // overview
    await page.goBack(); // whatever came before the app
    expect(page.url()).not.toMatch(/\/login/);
    await app.close();
  }, 60_000);

  it('a normal account cannot open the owner page by typing its address', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const base = await app.listen({ port: 0, host: '127.0.0.1' });
    const s = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'plain@example.com', password: PASSWORD, tos: true } });
    const [name, value] = String(s.headers['set-cookie']).split(';')[0]!.split('=');
    browser ??= await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addCookies([{ name: name!, value: value!, url: base }]);
    const page = await ctx.newPage();
    await page.goto(base + '/#owneradmin');
    await page.waitForSelector('#nav', { state: 'attached' });
    await expect.poll(() => page.locator('.page.on').first().getAttribute('id')).toBe('page-overview');
    await app.close();
  }, 60_000);
});
