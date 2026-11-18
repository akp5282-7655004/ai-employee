import { afterAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';

/**
 * On a phone the sidebar is a drawer and the button that opens it sits in the
 * page header. Five screens hide that header, the Dashboard among them, so a
 * new account landed with no menu and no way to log out. This drives a real
 * 390px browser because the bug was two CSS rules agreeing with each other.
 */
let browser: Browser | undefined;
afterAll(async () => { await browser?.close(); });

describe('phone navigation', () => {
  it('can open the menu, reach another page, and log out from the dashboard', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const base = await app.listen({ port: 0, host: '127.0.0.1' });
    const s = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'phone@example.com', password: 'password1', tos: true } });
    const [name, value] = String(s.headers['set-cookie']).split(';')[0]!.split('=');
    browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await ctx.addCookies([{ name: name!, value: value!, url: base }]);
    const page = await ctx.newPage();
    await page.goto(base + '/');
    await page.waitForSelector('#nav', { state: 'attached' });
    await page.locator('#onboard').evaluate((el) => el.classList.remove('on'));

    for (const id of ['overview', 'launch', 'library', 'reports', 'profile', 'billing']) {
      await page.evaluate((p) => (globalThis as unknown as { setPage: (x: string) => void }).setPage(p), id);
      await page.waitForTimeout(250);
      expect(await page.locator('#navtoggle').isVisible(), `menu button on ${id}`).toBe(true);
      expect(await page.locator('#header-logout').isVisible(), `log out on ${id}`).toBe(true);
      // Every header control is inside the screen, not pushed off the right edge.
      const off = await page.$$eval('.pagehead > *', (els) => els.filter((e) => {
        const r = (e as { getBoundingClientRect(): { width: number; right: number } }).getBoundingClientRect();
        return r.width > 0 && r.right > 391;
      }).length);
      expect(off, `header overflow on ${id}`).toBe(0);
    }

    // The dashboard's lead inputs are tall enough to tap.
    await page.evaluate(() => (globalThis as unknown as { setPage: (x: string) => void }).setPage('overview'));
    await page.waitForSelector('#lead-search');
    const inputs = await page.$$eval('#lead-search, #lead-name, #lead-phone', (els) =>
      els.map((e) => (e as { getBoundingClientRect(): { height: number } }).getBoundingClientRect().height));
    expect(inputs.length).toBe(3);
    for (const h of inputs) expect(h).toBeGreaterThanOrEqual(24);

    // A lead search with no match says so, and clearing it takes the message away.
    await page.evaluate(async () => { await fetch('/api/leads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Dana Homeowner', phone: '(501) 555-0177' }) }); });
    await page.reload();
    await page.waitForSelector('#lead-search');
    await page.locator('#onboard').evaluate((el) => el.classList.remove('on'));
    await page.fill('#lead-search', 'zzzz');
    await expect.poll(() => page.locator('#lead-nomatch').innerText()).toMatch(/No leads match "zzzz"/);
    await page.fill('#lead-search', 'dana');
    await expect.poll(() => page.locator('#lead-nomatch').isVisible()).toBe(false);

    // Stand-alone text links are tall enough to tap (24px minimum).
    await page.evaluate(() => (globalThis as unknown as { setPage: (x: string) => void }).setPage('settings'));
    await page.waitForSelector('#page-settings a.taplink');
    const heights = await page.$$eval('#page-settings a.taplink', (els) =>
      els.map((e) => (e as { getBoundingClientRect(): { height: number } }).getBoundingClientRect().height));
    expect(heights.length).toBe(2);
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(24);

    await page.evaluate(() => (globalThis as unknown as { setPage: (x: string) => void }).setPage('overview'));
    await page.locator('#navtoggle').tap();
    await expect.poll(() => page.locator('.side.open').count()).toBe(1);
    // A normal account never sees the owner's link.
    expect(await page.locator('#nav-admin').isVisible()).toBe(false);
    await page.locator('#nav a[data-page="integrations"]').evaluate((el) => (el as unknown as { click(): void }).click());
    await expect.poll(() => page.locator('.page.on').first().getAttribute('id')).toMatch(/^page-int/);

    await page.locator('#header-logout').tap();
    await page.waitForURL(/\/login/);
    await app.close();
  }, 60_000);
});
