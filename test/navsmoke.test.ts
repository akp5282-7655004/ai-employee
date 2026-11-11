import { afterAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import type { Connector } from '../src/connectors/types.js';

function server() {
  const calls: string[] = [];
  const connector = {
    name: 'mock',
    async createConnectToken() { return { token: 't', expiresAt: '2099-01-01', connectUrl: 'https://connect.example' }; },
    async listAccounts() { return []; },
    async runAction() { calls.push('run'); return { ok: false, actionId: 'x', app: 'google_ads', output: null }; },
    async launchCampaign() { calls.push('launch'); return { ok: false, live: false, steps: [] }; },
    async setGoogleCampaignStatus() { calls.push('status'); return { ok: false, live: false, called: false, note: 'no' }; },
    async describeConnections() { return []; },
  } as unknown as Connector;
  return { app: buildServer({ authStore: new MemoryStore(), connector }), calls };
}

function watch(page: Page, base: string) {
  const errors: string[] = [];
  const failed: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 300)));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text().slice(0, 300)); });
  page.on('response', (res) => {
    const url = res.url();
    if (!url.startsWith(base) || url.includes('favicon')) return;
    if (res.status() >= 400) failed.push(res.status() + ' ' + url.replace(base, ''));
  });
  return { errors, failed };
}

async function walk(page: Page) {
  const ids = await page.$$eval('#nav a[data-pages]', (els) => {
    const out: string[] = [];
    for (const a of els) {
      const pages = (a as { dataset?: { pages?: string } }).dataset?.pages || '';
      for (const p of pages.split(',')) if (p && !out.includes(p)) out.push(p);
    }
    return out;
  });
  ids.push('chat');
  const show = (pid: string) => page.evaluate((id) => {
    (globalThis as unknown as { setPage: (pageId: string) => void }).setPage(id);
  }, pid);
  for (const id of ids) {
    await show(id);
    await page.waitForTimeout(200);
    const on = await page.locator('.page.on').count();
    expect(on, id).toBe(1);
  }
  return ids;
}

describe('every nav tab loads', () => {
  const { app, calls } = server();
  let browser: Browser;
  let base = '';

  afterAll(async () => {
    await browser?.close();
    await app.close();
  });

  it('walks pre-setup, post-setup, and all three modes without console errors', async () => {
    await app.listen({ host: '127.0.0.1', port: 0 });
    const addr = app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    base = `http://127.0.0.1:${port}`;
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(base + '/login');
    await page.click('#tab-signup');
    await page.fill('#email', `nav-${Date.now()}@example.com`);
    await page.fill('#password', 'password1');
    await page.fill('#name', 'Nav Smoke');
    await page.check('#tos');
    await page.click('#submit');
    await page.waitForSelector('#overview-body', { timeout: 15000 });
    const nav = await page.locator('#nav').innerText();
    expect(nav).toMatch(/DASHBOARD/i);
    expect(nav).toMatch(/MARKETING/i);
    expect(nav).toMatch(/INSIGHTS/i);
    expect(nav).toMatch(/ACCOUNT & SETUP/i);
    const pages = await page.locator('#nav a[data-pages]').evaluateAll((els) => els.map((el) => (el as { dataset?: { pages?: string } }).dataset?.pages || '').join(','));
    expect(pages).toContain('launch');
    expect(pages).toContain('skills');
    expect(pages).toContain('profile');

    const seen = watch(page, base);
    const ids = await walk(page);
    expect(ids.length).toBeGreaterThan(20);
    expect(seen.errors, seen.errors.join('\n')).toEqual([]);
    expect(seen.failed, seen.failed.join('\n')).toEqual([]);

    await page.evaluate(() => { (globalThis as unknown as { setPage: (id: string) => void }).setPage('fblaunch'); });
    await page.locator('#page-fblaunch').getByText('Coming later').waitFor();
    await page.evaluate(() => { (globalThis as unknown as { setPage: (id: string) => void }).setPage('integrations'); });
    const intro = await page.locator('#page-int').innerText();
    expect(intro).not.toMatch(/runs across all/i);
    expect(intro).toMatch(/coming later/i);
    await page.evaluate(() => { (globalThis as unknown as { setPage: (id: string) => void }).setPage('overview'); });
    await page.locator('#overview-body').getByText('SAMPLE').first().waitFor();
    const dash = await page.locator('#overview-body').innerText();
    expect(dash).toMatch(/Coming later/);
    expect(dash).not.toMatch(/\$100 goal|25 goal/);
    expect(dash.toLowerCase()).not.toContain('searchlight');
    expect(dash).not.toContain('\u2014');

    const seeded = await page.evaluate(async () => {
      const html = '<html><head><title>Painters</title></head><body><h2>Interior painting</h2></body></html>';
      const crawl = await fetch('/api/miles/crawl', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ html, businessName: 'Painters', location: 'Philadelphia' }) });
      const questions = await fetch('/api/miles/questions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ goal: 'more booked jobs', dailyBudget: 20, leadsPerDay: 1 }) });
      return { crawl: crawl.status, questions: questions.status };
    });
    expect(seeded).toEqual({ crawl: 200, questions: 200 });
    await page.reload();
    await page.waitForSelector('#overview-body');
    const errAt = seen.errors.length;
    const failAt = seen.failed.length;
    await walk(page);
    expect(seen.errors.slice(errAt), seen.errors.join('\n')).toEqual([]);
    expect(seen.failed.slice(failAt), seen.failed.join('\n')).toEqual([]);

    await page.evaluate(() => { (globalThis as unknown as { setPage: (id: string) => void }).setPage('overview'); });
    await page.getByRole('button', { name: 'Ask me first', exact: true }).first().waitFor();
    for (const [label, blurb] of [['Ask me first', 'Ask me first is on'], ['Hybrid', 'Hybrid is on'], ['Do everything', 'Do everything is on']] as const) {
      await page.getByRole('button', { name: label, exact: true }).first().click();
      await page.locator('#miles-mode-note').getByText(blurb).waitFor();
    }
    expect(calls).not.toContain('launch');
    expect(calls).not.toContain('status');
  }, 90000);
});
