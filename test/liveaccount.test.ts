import { afterAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { liveAccount, LOW_CONTRAST, type LiveAccount, type LiveAccountOptions } from './helpers/liveaccount.js';

/**
 * What an owner with a real connected account sees, checked on the real page.
 *
 * Each case here passed its unit tests and was still wrong in the browser,
 * because the unit tests ran on the preview connector or asserted on a route's
 * JSON. These load the page as a connected customer and read what is on it.
 */
let browser: Browser | undefined;
const open: LiveAccount[] = [];
afterAll(async () => {
  await browser?.close();
  for (const account of open) await account.app.close();
});

type W = { setPage: (id: string) => void; TITLES?: Record<string, string> };

async function page(options: LiveAccountOptions = {}, theme: 'light' | 'dark' = 'light'): Promise<{ page: Page; ctx: BrowserContext; account: LiveAccount }> {
  const account = await liveAccount(options);
  open.push(account);
  browser ??= await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([{ name: account.cookieName, value: account.cookieValue, url: account.base }]);
  // The theme is read from storage before first paint, the way a returning owner gets it.
  await ctx.addInitScript(`try { localStorage.setItem('miles-theme', '${theme}'); } catch (e) {}`);
  const p = await ctx.newPage();
  await p.goto(account.base + '/');
  await p.waitForSelector('#nav', { state: 'attached' });
  await p.waitForFunction('typeof setPage === "function" && !!document.querySelector(".page.on")');
  await p.locator('#onboard').evaluate((el) => el.classList.remove('on'));
  return { page: p, ctx, account };
}

const go = async (p: Page, id: string, settle = 900) => {
  await p.evaluate((target) => (globalThis as unknown as W).setPage(target), id);
  await p.waitForTimeout(settle);
};
const shown = (p: Page) => p.locator('.page.on').first().innerText();
/** Visible SAMPLE badges on the open page. */
const sampleBadges = (p: Page) => p.locator('.page.on .md-sample:visible, .page.on .rep-sample:visible').count();

describe('a connected account never sees a sample number', () => {
  it('Reports shows live spend, and Not tracked yet where nothing is tracked', async () => {
    const { page: p } = await page();
    await go(p, 'reports', 1500);
    const text = await shown(p);
    // About $1,183 over the window, straight from the Google rows.
    expect(text).toMatch(/Spend\s+✓ LIVE\s+\$1,1\d\d/i);
    expect(text).toMatch(/Not tracked yet/);
    expect(text).not.toMatch(/sample/i);
    expect(await sampleBadges(p)).toBe(0);
  }, 60_000);

  it('the Dashboard does not call a connected account an example, with spend or without', async () => {
    for (const spend of [1183, 0]) {
      const { page: p, ctx } = await page({ spend });
      await go(p, 'overview', 1800);
      const text = await shown(p);
      expect(text, `spend ${spend}`).not.toMatch(/figures are examples|These numbers are an example|Example math/i);
      expect(await sampleBadges(p), `spend ${spend}`).toBe(0);
      // Revenue nobody tracks is not a loss.
      expect(text, `spend ${spend}`).not.toMatch(/\$0 back for every \$1/);
      expect(text, `spend ${spend}`).not.toMatch(/REVENUE MINUS COST[^$]{0,20}-\$/i);
      await go(p, 'launch', 1200);
      expect(await shown(p), `spend ${spend}`).not.toMatch(/SAMPLE = example numbers/);
      await ctx.close();
    }
  }, 90_000);
});

describe('text can be read in both themes', () => {
  for (const theme of ['dark', 'light'] as const) {
    it(`${theme}: no text closer than 3:1 to what is behind it, on every page`, async () => {
      const { page: p } = await page({}, theme);
      expect(await p.evaluate('document.documentElement.getAttribute("data-theme")')).toBe(theme);
      // business-profile is an address that opens the profile page, not a page of its own.
      const ids = (await p.evaluate('Object.keys(TITLES).filter((id) => id !== "owneradmin" && id !== "business-profile")')) as string[];
      expect(ids.length).toBeGreaterThan(30);
      const bad: string[] = [];
      for (const id of ids) {
        await go(p, id, 450);
        const found = (await p.evaluate(`(${LOW_CONTRAST})(3)`)) as string[];
        for (const item of found) bad.push(`${id}: ${item}`);
      }
      expect(bad).toEqual([]);
    }, 180_000);
  }
});

describe('the page header', () => {
  it('shows no stray divider when there is no support address, and no browser-blue links', async () => {
    const { page: p } = await page();
    await go(p, 'billing');
    const header = (await p.evaluate(`(() => {
      const addr = document.getElementById('help-addr');
      const help = document.getElementById('help-mail');
      const ink = getComputedStyle(document.querySelector('#ptitle')).color;
      return { addrHidden: addr.hidden, addrWidth: addr.getBoundingClientRect().width, helpColor: getComputedStyle(help).color, ink };
    })()`)) as { addrHidden: boolean; addrWidth: number; helpColor: string; ink: string };
    // A hidden element takes no room. Before, its margin, padding and border still drew.
    if (header.addrHidden) expect(header.addrWidth).toBe(0);
    expect(header.helpColor).toBe(header.ink);
  }, 60_000);
});
