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
