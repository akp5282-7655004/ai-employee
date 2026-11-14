import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import { buildAdminBusiness } from '../src/admin/business.js';
import { applyRenewal } from '../src/billing/subscription.js';

const ADMIN_ROUTES: { method: 'GET' | 'POST' | 'PUT'; url: string; payload?: unknown }[] = [
  { method: 'GET', url: '/api/admin' },
  { method: 'GET', url: '/api/admin/business' },
  { method: 'GET', url: '/api/admin/audit' },
  { method: 'GET', url: '/api/admin/google-ads' },
  { method: 'POST', url: '/api/admin/credits', payload: { id: 'x', amount: 25 } },
  { method: 'POST', url: '/api/admin/trial', payload: { id: 'x', days: 14 } },
  { method: 'POST', url: '/api/admin/pause', payload: { id: 'x', paused: true } },
  { method: 'POST', url: '/api/admin/impersonate', payload: { id: 'x' } },
  { method: 'POST', url: '/api/admin/billing', payload: { id: 'x', action: 'cancel' } },
  { method: 'POST', url: '/api/admin/invite', payload: { email: 'a@example.com' } },
  { method: 'POST', url: '/api/admin/invite/revoke', payload: { token: 'nope' } },
  { method: 'POST', url: '/api/admin/remove', payload: { id: 'x' } },
  { method: 'POST', url: '/api/admin/reset-link', payload: { id: 'x' } },
  { method: 'PUT', url: '/api/admin/settings', payload: { inviteOnly: false } },
];

describe('owner admin dashboard', () => {
  it('hides the admin nav until the signed-in user is the owner', () => {
    const html = readFileSync(join(process.cwd(), 'web', 'index.html'), 'utf8');
    expect(html).toMatch(/id="nav-admin"[^>]*hidden/);
    expect(html).toContain("location.pathname==='/admin' && IS_ADMIN");
    expect(html).not.toMatch(/nav-admin[^>]*>[^<]*\u2014/);
  });

  it('gives a non-admin 403 on every admin endpoint and the normal app at /admin', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const signup = async (email: string) => {
      const res = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email, password: 'password1', tos: true } });
      return String(res.headers['set-cookie']).split(';')[0];
    };
    const owner = await signup('owner@example.com');
    const other = await signup('painter@example.com');
    process.env.ADMIN_EMAIL = 'owner@example.com';
    try {
      for (const route of ADMIN_ROUTES) {
        const refused = await app.inject({ method: route.method, url: route.url, headers: { cookie: other }, payload: route.payload as Record<string, unknown> | undefined });
        expect(refused.statusCode, route.url).toBe(403);
      }
      const page = await app.inject({ method: 'GET', url: '/admin', headers: { cookie: other } });
      expect(page.statusCode).toBe(200);
      expect(page.headers['content-type']).toMatch(/text\/html/);
      expect(page.body).toContain('id="nav-admin"');
      expect(page.body).not.toContain('"mrr"');
      const allowed = await app.inject({ method: 'GET', url: '/api/admin/business', headers: { cookie: owner } });
      expect(allowed.statusCode).toBe(200);
    } finally {
      delete process.env.ADMIN_EMAIL;
      await app.close();
    }
  });

  it('refuses plan changes until Stripe is connected, and requires a typed confirm', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const app = buildServer({ authStore: new MemoryStore() });
    const res = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'owner@example.com', password: 'password1', tos: true } });
    const cookie = String(res.headers['set-cookie']).split(';')[0];
    const id = res.json().user.id as string;
    process.env.ADMIN_EMAIL = 'owner@example.com';
    try {
      const missing = await app.inject({ method: 'POST', url: '/api/admin/billing', headers: { cookie }, payload: { id, action: 'cancel_now' } });
      expect(missing.statusCode).toBe(400);
      expect(missing.json().error).toMatch(/CANCEL NOW/);
      const blocked = await app.inject({ method: 'POST', url: '/api/admin/billing', headers: { cookie }, payload: { id, action: 'cancel_now', confirm: 'CANCEL NOW' } });
      expect(blocked.statusCode).toBe(503);
      expect(blocked.json().error).toBe('Stripe not connected');
      const audit = await app.inject({ method: 'GET', url: '/api/admin/audit', headers: { cookie } });
      expect(audit.json().entries).toEqual([]);
    } finally {
      delete process.env.ADMIN_EMAIL;
      await app.close();
    }
  });
});

describe('stored Stripe amounts', () => {
  it('uses the invoice amount Stripe reported, not a plan list price', () => {
    const data: Record<string, unknown> = {};
    const first = applyRenewal(data, {
      invoiceId: 'in_1', customerId: 'cus_1', subscriptionId: 'sub_1', bandKey: 'starter',
      periodEnd: '2026-12-14T00:00:00.000Z', amountUsd: 149, paidAt: '2026-11-14T00:00:00.000Z',
    });
    const again = applyRenewal(data, {
      invoiceId: 'in_1', customerId: 'cus_1', subscriptionId: 'sub_1', bandKey: 'starter',
      periodEnd: '2026-12-14T00:00:00.000Z', amountUsd: 149, paidAt: '2026-11-14T00:00:00.000Z',
    });
    expect(first.applied).toBe(true);
    expect(again.applied).toBe(false);
    const view = buildAdminBusiness([{
      id: 'u1', email: 'a@example.com', createdAt: '2026-11-14T00:00:00.000Z', apps: ['google_ads'],
      now: '2026-11-14T12:00:00.000Z',
      data: { ...data, profile: { businessName: 'Painters', industry: 'Painting' }, openRouterCostUsd: 2 },
    }], { now: '2026-11-14T12:00:00.000Z', stripeReady: true });
    expect(view.accounts[0]!.monthlyPaid).toBe(149);
    expect(view.accounts[0]!.status).toBe('active');
    expect(view.totals.mrr).toBe(149);
    expect(view.totals.revenueThisMonth).toBe(149);
    expect(view.totals.profit).toBe(147);
    expect(view.billing).toBe('connected');
  });
});
