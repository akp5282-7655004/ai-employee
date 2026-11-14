import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import { adSpendAllowed } from '../src/billing/gate.js';
import { setupProgress } from '../src/onboarding/tools.js';
import { buildAdminBusiness } from '../src/admin/business.js';

describe('signup credits', () => {
  it('gives every new account $100 with no card', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const first = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'a@example.com', password: 'password1', tos: true, utmSource: 'newsletter', utmCampaign: 'launch', referrer: 'https://example.com' } });
    const second = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'b@example.com', password: 'password1', tos: true } });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    const cookie = String(second.headers['set-cookie']).split(';')[0];
    const billing = await app.inject({ method: 'GET', url: '/api/billing', headers: { cookie } });
    expect(billing.json().credits).toMatchObject({ granted: 100, remaining: 100 });
    expect(billing.json().launchOffer).toBe(true);
    await app.close();
  });

  it('lets a free account with credits use tools, and blocks one with none', () => {
    process.env.BILLING_ENFORCE = '1';
    try {
      expect(adSpendAllowed({ credits: { granted: 100, spent: 10, launchOffer: true }, billing: { status: 'active', band: 'launch', grantedInvoices: [] } }).ok).toBe(true);
      expect(adSpendAllowed({ credits: { granted: 0, spent: 0, launchOffer: false }, billing: { status: 'none', grantedInvoices: [] } }).ok).toBe(false);
    } finally {
      delete process.env.BILLING_ENFORCE;
    }
  });
});

describe('setup tools', () => {
  it('counts 2 of 3 and stays locked until a third tool connects', () => {
    const early = setupProgress({ apps: ['google_ads', 'gohighlevel'], website: '' });
    expect(early.headline).toBe('2 of 3 connected');
    expect(early.ready).toBe(false);
    expect(early.detail).toMatch(/pull real data/);
    expect(early.detail).not.toMatch(/\u2014|searchlight/i);
    const done = setupProgress({ apps: ['google_ads', 'facebook_pages'], website: 'https://painters.example' });
    expect(done.ready).toBe(true);
    expect(done.connected).toBe(3);
  });
});

describe('admin business view', () => {
  it('uses stored accounts and does not invent Stripe or OpenRouter dollars', () => {
    const view = buildAdminBusiness([
      {
        id: 'u1',
        email: 'owner@example.com',
        name: 'Paul',
        createdAt: '2026-11-10T12:00:00.000Z',
        apps: ['google_ads', 'gohighlevel'],
        now: '2026-11-14T12:00:00.000Z',
        data: {
          profile: { businessName: 'Painters In Philly', industry: 'Painting', website: 'https://painters.example' },
          credits: { granted: 100, spent: 85, launchOffer: true, ledger: [] },
          billing: { status: 'active', band: 'launch', grantedInvoices: [] },
          signupSource: { utmSource: 'newsletter', utmCampaign: 'launch', referrer: 'https://example.com' },
          lastActiveAt: '2026-11-01T12:00:00.000Z',
          crmEvents: [{ type: 'lead', ts: '2026-11-08T00:00:00.000Z' }, { type: 'closed_won', ts: '2026-11-09T00:00:00.000Z' }],
          snapshot: { adSpend: 21.01, campaigns: [{ status: 'PAUSED', spend: 21.01 }] },
          miles: { activation: 'paused', campaignResource: 'customers/1/campaigns/9', events: [{ text: 'Google Ads could not be read.' }] },
        },
      },
    ], { now: '2026-11-14T12:00:00.000Z', stripeReady: false });
    expect(view.billing).toBe('Not connected');
    expect(view.totals.paying).toBe('Not connected');
    expect(view.totals.mrr).toBe('Not connected');
    expect(view.totals.openRouterCost).toBe('Not connected');
    expect(view.totals.signups).toBe(1);
    const row = view.accounts[0]!;
    expect(row.businessName).toBe('Painters In Philly');
    expect(row.status).toBe('free credits');
    expect(row.freeCreditsUsed).toBe(85);
    expect(row.freeCreditsRemaining).toBe(15);
    expect(row.nearCreditEnd).toBe(true);
    expect(row.toolsConnected).toBe(3);
    expect(row.launched).toBe(true);
    expect(row.signupSource.utmSource).toBe('newsletter');
    expect(row.leads).toBe(1);
    expect(row.bookedJobs).toBe(1);
    expect(row.adSpendManaged).toBe(21.01);
    expect(row.errors.googleReads).toBe(1);
    expect(row.profit).toBe('Not connected');
    expect(view.sources[0]).toEqual({ source: 'newsletter', count: 1 });
    expect(view.funnel.map((step) => step.step)).toEqual(['Signed up', 'Setup done', '3 tools', 'Launched', 'Paid']);
  });
});
