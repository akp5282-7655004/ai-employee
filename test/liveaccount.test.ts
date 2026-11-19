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
      // Jobs nobody tracks are not zero jobs.
      expect(text, `spend ${spend}`).not.toMatch(/\b0 booked jobs\b/i);
      expect(text, `spend ${spend}`).toMatch(/Booked jobs are not tracked yet/);
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

describe('the $100 launch credit says where it stands', () => {
  it('three counted tools: the dashboard and Integrations both say it is unlocked', async () => {
    const { page: p } = await page({ apps: ['google_ads', 'google_my_business'] });
    await go(p, 'overview', 1800);
    const line = p.locator('#credit-status-line');
    await line.waitFor();
    expect(await line.innerText()).toMatch(/3 of 3 connected\.\s*\$100 in credits is unlocked\./);
    await go(p, 'integrations', 1200);
    const card = p.locator('#credit-status-card');
    await card.waitFor();
    const text = await card.innerText();
    expect(text).toMatch(/3 of 3 connected\.\s*\$100 in credits is unlocked\./);
    expect(text).toMatch(/Counted: Google Ads, Google Business Profile, Website\./);
  }, 60_000);

  it('Google Analytics is connected and does not count, and the page says so', async () => {
    const { page: p } = await page({ apps: ['google_ads', 'google_analytics'] });
    await go(p, 'integrations', 1200);
    const card = p.locator('#credit-status-card');
    await card.waitFor();
    const text = await card.innerText();
    expect(text).toMatch(/2 of 3 connected\./);
    expect(text).toMatch(/Counted: Google Ads, Website\./);
    expect(text).toMatch(/not counted toward the 3: Google Analytics\./);
    expect(text).toMatch(/Still open: .*Google Business Profile/);
  }, 60_000);
});

describe('a decision on the dashboard can be undone', () => {
  it('Skip, then Undo, brings the recommendation back; Approve, then Undo, reverts it', async () => {
    const { page: p, account } = await page();
    const recent = async () => (await account.app.inject({ method: 'GET', url: '/api/recommendations/recent', headers: { cookie: account.cookie } })).json().decisions as { id: string; kind: string; title: string }[];
    await go(p, 'overview', 2000);
    const card = p.locator('.dv2-rec').first();
    await card.waitFor();
    const title = (await card.locator('h3').innerText()).trim();

    // Skip it. It leaves the list, and a row with Undo appears under What Miles did for you.
    await card.getByRole('button', { name: 'Skip' }).click();
    const skipped = p.locator('#dash-activity .md-crow', { hasText: 'Skipped: ' + title });
    await skipped.waitFor({ timeout: 15_000 });
    expect((await recent())[0]).toMatchObject({ kind: 'skipped', title });
    expect(await p.locator('.dv2-rec h3', { hasText: title }).count()).toBe(0);
    await skipped.getByRole('button', { name: 'Undo' }).click();
    await p.locator('.dv2-rec h3', { hasText: title }).first().waitFor({ timeout: 15_000 });
    expect((await recent())[0]).toMatchObject({ kind: 'undone' });

    // Approve it. Same row, same Undo, and the Change Log entry is marked reverted.
    await p.locator('.dv2-rec', { hasText: title }).first().getByRole('button', { name: 'Approve' }).click();
    const approved = p.locator('#dash-activity .md-crow', { hasText: 'Approved: ' });
    await approved.waitFor({ timeout: 15_000 });
    const id = (await recent())[0]!.id;
    expect((await recent())[0]).toMatchObject({ kind: 'approved' });
    await approved.getByRole('button', { name: 'Undo' }).click();
    await p.locator('#dash-activity .md-crow', { hasText: 'Undone: ' }).first().waitFor({ timeout: 15_000 });
    expect((await recent())[0]).toMatchObject({ id, kind: 'undone' });
    // Nothing left to undo: a second try is refused and changes nothing.
    const again = await account.app.inject({ method: 'POST', url: '/api/recommendations/undo', headers: { cookie: account.cookie, 'content-type': 'application/json' }, payload: JSON.stringify({ id }) });
    expect(again.statusCode).toBe(404);
  }, 90_000);
});

describe('Plan & Credits is never blank', () => {
  it('draws the plan when a value is missing, and falls back to the price list when the data is unusable', async () => {
    const { page: p } = await page();
    const errors: string[] = [];
    p.on('pageerror', (e) => errors.push(String(e)));

    // The credits block missing: this used to throw after the page had been cleared.
    await p.route('**/api/billing', async (route) => {
      const real = await route.fetch();
      const body = await real.json();
      delete body.credits;
      await route.fulfill({ response: real, json: body });
    });
    await go(p, 'billing', 1500);
    expect(await shown(p)).toMatch(/YOUR PLAN/);
    expect(await shown(p)).toMatch(/Starter/);

    // Data the page cannot draw at all: say so and still show the prices.
    await p.unroute('**/api/billing');
    await p.route('**/api/billing', async (route) => {
      const real = await route.fetch();
      const body = await real.json();
      body.bands = [null];
      await route.fulfill({ response: real, json: body });
    });
    await go(p, 'overview', 600);
    await go(p, 'billing', 1500);
    const text = await shown(p);
    expect(text).toMatch(/could not be shown\. Nothing was charged/);
    expect(text).toMatch(/\$149\/month/);
    expect(text.trim().length).toBeGreaterThan(200);
    expect(errors).toEqual([]);
  }, 60_000);
});
