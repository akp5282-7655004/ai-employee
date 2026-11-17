import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';

describe('login and onboarding in the browser', () => {
  const app = buildServer({ authStore: new MemoryStore() });
  let browser: Browser;
  let base = '';

  beforeAll(async () => {
    await app.listen({ host: '127.0.0.1', port: 0 });
    const addr = app.server.address();
    base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
    browser = await chromium.launch({ headless: true });
  });
  afterAll(async () => {
    await browser?.close();
    await app.close();
  });

  it('/signup and #signup open the Sign up tab', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/signup`);
    expect(page.url()).toContain('/login?signup=1');
    expect(await page.locator('#tab-signup').getAttribute('class')).toContain('on');
    expect(await page.locator('#submit').innerText()).toMatch(/create account/i);
    await page.goto(`${base}/login#signup`);
    expect(await page.locator('#tab-signup').getAttribute('class')).toContain('on');
    await page.goto(`${base}/login`);
    expect(await page.locator('#tab-login').getAttribute('class')).toContain('on');
    await page.close();
  });

  it('shows a weak-password error under the password field', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/login?signup=1`);
    await page.fill('#email', 'weak@example.com');
    await page.fill('#password', 'aaaaaaaaa');
    await page.check('#tos');
    await page.click('#submit');
    await page.locator('#password-err').filter({ hasText: /\S/ }).waitFor({ timeout: 10000 });
    expect(await page.locator('#password-err').innerText()).toMatch(/repeated/i);
    expect(await page.locator('#err').innerText()).toBe('');
    await page.close();
  });

  it('keeps the onboarding draft when the sheet is closed and reopened', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${base}/login?signup=1`);
    await page.fill('#email', 'draft@example.com');
    await page.fill('#password', 'password1');
    await page.check('#tos');
    await page.click('#submit');
    await page.waitForSelector('#onboard.on [data-k="businessName"]', { timeout: 15000 });
    await page.fill('#onboard-form [data-k="businessName"]', 'Draft Roofing Co');
    await page.fill('#ob-website', 'draftroofing.example');
    await page.reload();
    await page.waitForSelector('#onboard.on [data-k="businessName"]', { timeout: 15000 });
    expect(await page.inputValue('#onboard-form [data-k="businessName"]')).toBe('Draft Roofing Co');
    expect(await page.inputValue('#ob-website')).toBe('draftroofing.example');
    await page.click('#onboard-save');
    await page.waitForSelector('#onboard:not(.on)', { state: 'attached', timeout: 10000 });
    const left = await page.evaluate<string[]>("Object.keys(localStorage).filter((k) => k.startsWith('miles.onboardDraft.'))");
    expect(left).toEqual([]);
    await page.close();
  }, 40_000);
});
