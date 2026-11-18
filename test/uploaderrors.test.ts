import { afterAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';

/**
 * Checklist row 145. A wrong-type, empty or damaged file answered "Could not
 * save, Retry", which tells the owner to repeat something that cannot work.
 * The Brand Guidelines logo stored the raw file with no check at all.
 */
let browser: Browser | undefined;
afterAll(async () => { await browser?.close(); });

// A real 1x1 PNG, and the same bytes cut short so the header is right and the image is not.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

describe('uploading a logo', () => {
  it('names the problem for a wrong-type, empty or damaged file, and still takes a good one', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const base = await app.listen({ port: 0, host: '127.0.0.1' });
    const s = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'upload@example.com', password: 'Harbor-Lantern-42', tos: true } });
    const [name, value] = String(s.headers['set-cookie']).split(';')[0]!.split('=');
    browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addCookies([{ name: name!, value: value!, url: base }]);
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(base + '/');
    await page.waitForSelector('#nav', { state: 'attached' });
    await page.locator('#onboard').evaluate((el) => el.classList.remove('on'));
    await page.evaluate(() => (globalThis as unknown as { setPage: (x: string) => void }).setPage('assets'));
    await page.waitForSelector('#logo-input', { state: 'attached' });
    const note = () => page.locator('#assets-note').innerText();

    await page.setInputFiles('#logo-input', { name: 'price-list.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 not an image') });
    await expect.poll(note).toMatch(/not an image/i);

    await page.setInputFiles('#logo-input', { name: 'empty.png', mimeType: 'image/png', buffer: Buffer.alloc(0) });
    await expect.poll(note).toMatch(/empty/i);

    await page.setInputFiles('#logo-input', { name: 'damaged.png', mimeType: 'image/png', buffer: PNG.subarray(0, 20) });
    await expect.poll(note).toMatch(/could not be read/i);

    await page.setInputFiles('#logo-input', { name: 'logo.png', mimeType: 'image/png', buffer: PNG });
    await expect.poll(note).toMatch(/Saved/);
    const saved = await app.inject({ method: 'GET', url: '/api/assets', headers: { cookie: `${name}=${value}` } });
    expect(JSON.stringify(saved.json())).toContain('data:image/png');

    expect(errors).toEqual([]);
    await app.close();
  }, 60_000);
});

/**
 * The dashboard charts loaded Chart.js from an outside host. Where that host
 * is blocked the owner saw "Chart.js did not load." in place of a chart.
 */
describe('the chart library', () => {
  it('is served by this app, and the page asks no outside host for a script', async () => {
    const { readFileSync } = await import('node:fs');
    const html = readFileSync('web/index.html', 'utf8') + readFileSync('web/login.html', 'utf8');
    expect(html.match(/<script[^>]+src="https?:\/\//g) ?? []).toEqual([]);
    const app = buildServer({ authStore: new MemoryStore() });
    for (const file of ['chart.umd.js', 'chartjs-chart-funnel.umd.min.js']) {
      const r = await app.inject({ method: 'GET', url: '/vendor/chart/' + file });
      expect(r.statusCode, file).toBe(200);
      expect(String(r.headers['content-type'])).toMatch(/javascript/);
      expect(r.body.length).toBeGreaterThan(40_000);
    }
    await app.close();
  });

  it('loads in the browser, so the dashboard can draw', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const base = await app.listen({ port: 0, host: '127.0.0.1' });
    const s = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'chart@example.com', password: 'Harbor-Lantern-42', tos: true } });
    const [name, value] = String(s.headers['set-cookie']).split(';')[0]!.split('=');
    browser ??= await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addCookies([{ name: name!, value: value!, url: base }]);
    const page = await ctx.newPage();
    const refused: string[] = [];
    page.on('requestfailed', (r) => refused.push(r.url()));
    await page.goto(base + '/');
    await page.waitForSelector('#nav', { state: 'attached' });
    expect(await page.evaluate(() => typeof (globalThis as unknown as { Chart?: unknown }).Chart)).toBe('function');
    expect(await page.locator('body').innerText()).not.toMatch(/chart could not load|Chart\.js did not load/i);
    expect(refused.filter((u) => /\.js(\?|$)/.test(u))).toEqual([]);
    await app.close();
  }, 60_000);
});
