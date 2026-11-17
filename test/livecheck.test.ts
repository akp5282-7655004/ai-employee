import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import { sourceFrom, wonDealsFromLedger } from '../src/metrics/crmledger.js';
import type { Connector } from '../src/connectors/types.js';

/**
 * Found on the live site on 2026-11-17 (build 9cb6825) by sending a won deal
 * to an account's own webhook: the $4,200 was counted as revenue and the
 * campaign that came with it was thrown away.
 */
/** An ad account with one campaign that spent $600, tagged roof-repair-search. */
function withSpend(): Connector {
  return {
    name: 'mock',
    async createConnectToken() { return { token: 't', expiresAt: '2099-01-01', connectUrl: 'https://connect.example' }; },
    async listAccounts() { return []; },
    async runAction() { return { ok: false, actionId: 'x', app: 'x', output: null }; },
    async describeConnections() { return []; },
    async getAdSpend() { return [{ platform: 'google_ads', campaign: 'Roof Repair | Search', utm: 'roof-repair-search', spend: 600 }]; },
    async getDeals() { return []; },
  } as unknown as Connector;
}

async function account(connector?: Connector) {
  const app = buildServer({ authStore: new MemoryStore(), ...(connector ? { connector } : {}) });
  const s = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'owner@example.com', password: 'password1', tos: true } });
  const cookie = String(s.headers['set-cookie']).split(';')[0]!;
  const hooks = (await app.inject({ method: 'GET', url: '/api/automations', headers: { cookie } })).json();
  const dealHook = String(hooks.onboarding.webhook).replace(/^https?:\/\/[^/]+/, '');
  const post = (body: unknown) => app.inject({ method: 'POST', url: dealHook, headers: { 'content-type': 'application/json' }, payload: JSON.stringify(body) });
  const revenue = async () => (await app.inject({ method: 'GET', url: '/api/revenue', headers: { cookie } })).json();
  return { app, post, revenue };
}

describe('a won deal keeps the source the CRM sent with it', () => {
  it('shows the deal on the revenue page with its source and campaign', async () => {
    const a = await account();
    const r = await a.post({ id: 'opp_1', name: 'Dana Homeowner', amount: 4200, utm_source: 'google_ads', utm_campaign: 'roof-repair-search', gclid: 'ABC123' });
    expect(r.statusCode).toBe(200);
    const rev = await a.revenue();
    expect(rev.deals).toHaveLength(1);
    expect(rev.deals[0]).toMatchObject({ value: 4200, won: true, utmSource: 'google_ads', utmCampaign: 'roof-repair-search', gclid: 'ABC123' });
    expect(rev.connected).toBe(true);
    // No ad account is connected, so there is no campaign to tie it to yet.
    // It is reported as revenue that matched no campaign, not dropped.
    expect(rev.report.unattributedRevenue).toBe(4200);
    await a.app.close();
  });

  it('ties the deal to the campaign that produced it when that campaign has spend', async () => {
    const a = await account(withSpend());
    await a.post({ id: 'opp_1', amount: 4200, utm_source: 'google_ads', utm_campaign: 'Roof-Repair-Search' });
    const rev = await a.revenue();
    expect(rev.report).toMatchObject({ totalSpend: 600, attributedRevenue: 4200, wonDeals: 1, blendedRoas: 7, unattributedRevenue: 0 });
    expect(rev.report.byCampaign[0]).toMatchObject({ key: 'Roof Repair | Search', revenue: 4200, wonDeals: 1 });
    await a.app.close();
  });

  it('counts a replayed webhook once', async () => {
    const a = await account();
    const deal = { id: 'opp_2', amount: 900, utm_source: 'google_ads', utm_campaign: 'drain-cleaning' };
    await a.post(deal); await a.post(deal);
    expect((await a.revenue()).deals).toHaveLength(1);
    await a.app.close();
  });

  it('invents no source when the CRM sent none', async () => {
    const a = await account();
    await a.post({ id: 'opp_3', amount: 1500 });
    const [deal] = (await a.revenue()).deals;
    expect(deal.value).toBe(1500);
    expect(deal.utmSource).toBeUndefined();
    expect(deal.utmCampaign).toBeUndefined();
    await a.app.close();
  });

  it('reads the common field names and ignores blanks', () => {
    expect(sourceFrom({ utmSource: 'facebook', campaign_name: ' Spring Promo ', gclid: '' })).toEqual({ utmSource: 'facebook', utmCampaign: 'Spring Promo' });
    expect(sourceFrom({ source: 'Google LSA' })).toEqual({ utmSource: 'Google LSA' });
    expect(sourceFrom({ utm_source: '   ', amount: 5 })).toEqual({});
    expect(wonDealsFromLedger({ crmEvents: [{ type: 'lead', ts: '2026-11-01T00:00:00Z' }, { type: 'closed_won', ts: '2026-11-02T00:00:00Z', amount: 10 }] })).toHaveLength(1);
  });
});

describe('page rules found by walking the live site at phone width', () => {
  const html = readFileSync('web/index.html', 'utf8');

  it('hides the owner link from everyone else, despite .nav a setting display', () => {
    expect(html).toMatch(/\.nav a\[hidden\]\{display:none;\}/);
  });

  it('brings the header back on phones for the screens that hide it', () => {
    const phone = html.slice(html.lastIndexOf('@media (max-width:760px){'));
    expect(phone).toMatch(/body\.on-dash \.pagehead,body\.on-biz \.pagehead\{display:flex/);
    // The rule has to come after the ones that hide the header, or it loses.
    expect(html.lastIndexOf('body.on-dash .pagehead,body.on-biz .pagehead{display:flex')).toBeGreaterThan(html.indexOf('body.on-biz .pagehead{display:none;}'));
  });

  it('offers Manage billing and Cancel plan only on a paid plan', () => {
    expect(html).toContain('if(onPaidPlan) row.append(portal, cancel);');
  });
});

describe('what a customer is told about pricing', () => {
  it('does not state the markup or the model vendor on the billing page', async () => {
    // The unit-economics route is owner-only for this reason. The billing note
    // told every account "OpenRouter cost plus a 75% margin", and the plan
    // table said "at OpenRouter cost", which was not true either.
    const app = buildServer({ authStore: new MemoryStore() });
    const s = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'cust@example.com', password: 'password1', tos: true } });
    const cookie = String(s.headers['set-cookie']).split(';')[0]!;
    const bill = await app.inject({ method: 'GET', url: '/api/billing', headers: { cookie } });
    expect(bill.body).not.toMatch(/margin|OpenRouter/i);
    expect(bill.json().note).toMatch(/priced per run/);
    const html = readFileSync('web/index.html', 'utf8');
    expect(html).not.toMatch(/at OpenRouter cost/);
    await app.close();
  });
});
