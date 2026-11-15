import { afterAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';

describe('business profile card save status', () => {
  const app = buildServer({ authStore: new MemoryStore() });
  let browser: Browser;

  afterAll(async () => {
    await browser?.close();
    await app.close();
  });

  it('shows Saving, then Saved, on the card being edited, and Done leaves edit mode', async () => {
    await app.listen({ host: '127.0.0.1', port: 0 });
    const addr = app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`http://127.0.0.1:${port}/login`);
    await page.click('#tab-signup');
    await page.fill('#email', 'save-status@example.com');
    await page.fill('#password', 'password1');
    await page.fill('#name', 'Paul');
    await page.check('#tos');
    await page.click('#submit');
    await page.waitForSelector('#overview-body', { timeout: 15000 });
    await page.locator('#onboard').evaluate((el) => el.classList.remove('on'));
    await page.evaluate((id) => {
      (globalThis as unknown as { setPage: (pageId: string) => void }).setPage(id);
    }, 'profile');
    await page.waitForSelector('#yb-basics .yb-edit', { timeout: 10000 });
    await page.click('#yb-basics .yb-edit');
    expect(await page.locator('#yb-basics .yb-edit').innerText()).toMatch(/done/i);
    await page.fill('#yb-basics [data-biz="phone"]', '215-555-0199');
    const status = page.locator('#yb-basics [data-bizstat]');
    const waitStatus = async (text: string) => {
      const start = Date.now();
      let got = '';
      while (Date.now() - start < 5000) {
        got = (await status.innerText().catch(() => '')).trim();
        if (got === text) return;
        await page.waitForTimeout(80);
      }
      throw new Error('status stayed ' + JSON.stringify(got));
    };
    await waitStatus('Saving...');
    await waitStatus('Saved ✓');
    await page.click('#yb-basics .yb-edit');
    expect(await page.locator('#yb-basics .yb-input').count()).toBe(0);
    expect(await page.locator('#yb-basics').innerText()).toContain('215-555-0199');
  });
});
