import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildAdminBusiness } from '../src/admin/business.js';
import { accountMoney, daysLabel, upcomingRenewals } from '../src/admin/money.js';
import { chargeCredits } from '../src/billing/credits.js';
import { applyRenewal, recordRefund } from '../src/billing/subscription.js';
import { MemoryStore } from '../src/db/index.js';
import { buildServer } from '../src/server.js';

const NOW = '2026-11-14T12:00:00.000Z';

describe('owner money math', () => {
  it('subtracts refunds, keeps unknown cost unknown, and falls back to lifetime text only for all time', () => {
    const month = accountMoney({
      payments: [{ at: '2026-11-02T00:00:00.000Z', usd: 149 }, { at: '2026-10-02T00:00:00.000Z', usd: 149 }],
      refunds: [{ at: '2026-11-03T00:00:00.000Z', usd: 20 }],
      textCosts: [],
      mediaCosts: [],
      lifetimeTextUsd: 4,
      stripeReady: false,
      period: 'month',
      now: NOW,
      otherMonthlyUsd: 0,
    });
    expect(month.revenue).toBe(129);
    expect(month.text).toBe('no data');
    expect(month.media).toBe('no data');
    expect(month.cost).toBe('no data');
    expect(month.profit).toBe('no data');
    expect(month.margin).toBe('-');

    const all = accountMoney({
      payments: [{ at: '2026-10-02T00:00:00.000Z', usd: 149 }],
      refunds: [],
      textCosts: [],
      mediaCosts: [{ at: '2026-11-01T00:00:00.000Z', usd: 0.35 }],
      lifetimeTextUsd: 4,
      stripeReady: true,
      period: 'all',
      now: NOW,
      otherMonthlyUsd: 10,
    });
    expect(all.revenue).toBe(149);
    expect(all.text).toBe(4);
    expect(all.media).toBe(0.35);
    expect(all.other).toBe(20);
    expect(all.cost).toBe(24.35);
    expect(all.profit).toBe(124.65);
    expect(all.margin).toBeCloseTo(83.66, 1);
  });

  it('says Not connected only when Stripe has never reported a payment', () => {
    const empty = accountMoney({
      payments: [], refunds: [], textCosts: [], mediaCosts: [],
      stripeReady: false, period: 'month', now: NOW, otherMonthlyUsd: 0,
    });
    expect(empty.revenue).toBe('Not connected');
    expect(empty.profit).toBe('Not connected');
    const zero = accountMoney({
      payments: [], refunds: [], textCosts: [{ at: NOW, usd: 1 }], mediaCosts: [],
      stripeReady: true, period: 'month', now: NOW, otherMonthlyUsd: 0,
    });
    expect(zero.revenue).toBe(0);
    expect(zero.cost).toBe(1);
    expect(zero.profit).toBe(-1);
    expect(zero.margin).toBe('-');
  });

  it('sorts renewals soonest first and names each state', () => {
    expect(upcomingRenewals([], NOW, false)).toBe('Connect Stripe to see renewals');
    const rows = upcomingRenewals([
      { id: 'late', businessName: 'Late', email: 'a@x.com', plan: 'scale', status: 'active', renewsAt: '2026-12-01T00:00:00.000Z', amount: 797 },
      { id: 'soon', businessName: 'Soon', email: 'b@x.com', plan: 'starter', status: 'active', renewsAt: '2026-11-16T00:00:00.000Z', amount: 149, cancelAtPeriodEnd: true },
      { id: 'due', businessName: 'Due', email: 'c@x.com', plan: 'growth', status: 'past_due', renewsAt: '2026-11-10T00:00:00.000Z' },
      { id: 'free', businessName: 'Free', email: 'd@x.com', plan: 'launch', status: 'none' },
    ], NOW, true);
    expect(Array.isArray(rows) && rows.map((row) => row.id)).toEqual(['due', 'soon', 'late']);
    if (!Array.isArray(rows)) return;
    expect(rows[0]!.state).toBe('past_due');
    expect(rows[0]!.amount).toBe('Not connected');
    expect(rows[0]!.daysLabel).toBe('overdue');
    expect(rows[1]!.state).toBe('cancels');
    expect(rows[1]!.daysLabel).toBe('in 2 days');
    expect(rows[2]!.state).toBe('renews');
    expect(daysLabel(1)).toBe('in 1 day');
    expect(daysLabel(0)).toBe('today');
  });

  it('rolls company money once for other costs and keeps a renewal on the account', () => {
    const paying: Record<string, unknown> = {
      profile: { businessName: 'Peak Painting' },
      openRouterCostUsd: 2,
      serveLog: [{ at: '2026-11-10T00:00:00.000Z', kind: 'text', usd: 1.25 }, { at: '2026-11-11T00:00:00.000Z', kind: 'media', usd: 0.35 }],
    };
    applyRenewal(paying, {
      invoiceId: 'in_1', customerId: 'cus_1', subscriptionId: 'sub_1', bandKey: 'growth',
      periodEnd: '2026-11-20T00:00:00.000Z', amountUsd: 397, paidAt: '2026-11-01T00:00:00.000Z',
    });
    applyRenewal(paying, {
      invoiceId: 'in_1', customerId: 'cus_1', subscriptionId: 'sub_1', bandKey: 'growth',
      periodEnd: '2026-11-20T00:00:00.000Z', amountUsd: 397, paidAt: '2026-11-01T00:00:00.000Z',
    });
    recordRefund(paying, { id: 're_1', amount: 50, at: '2026-11-05T00:00:00.000Z' });
    recordRefund(paying, { id: 're_1', amount: 50, at: '2026-11-05T00:00:00.000Z' });
    const quiet: Record<string, unknown> = { profile: { businessName: 'Quiet HVAC' } };
    const view = buildAdminBusiness([
      { id: 'u1', email: 'a@example.com', createdAt: '2026-11-01T00:00:00.000Z', apps: [], data: paying },
      { id: 'u2', email: 'b@example.com', createdAt: '2026-11-01T00:00:00.000Z', apps: [], data: quiet },
    ], { now: NOW, stripeReady: true, period: 'month', otherMonthlyUsd: 30 });
    expect(view.money.revenue).toBe(347);
    expect(view.money.text).toBe(1.25);
    expect(view.money.media).toBe(0.35);
    expect(view.money.other).toBe(30);
    expect(view.money.cost).toBe(31.6);
    expect(view.money.profit).toBe(315.4);
    expect(view.accounts[0]!.periodRevenue).toBe(347);
    expect(view.accounts[0]!.renewState).toBe('renews');
    expect(view.accounts[1]!.periodRevenue).toBe(0);
    expect(view.accounts[1]!.renewState).toBeNull();
    expect(Array.isArray(view.renewals) && view.renewals[0]!.businessName).toBe('Peak Painting');
    const off = buildAdminBusiness([
      { id: 'u2', email: 'b@example.com', createdAt: '2026-11-01T00:00:00.000Z', apps: [], data: quiet },
    ], { now: NOW, stripeReady: false, period: 'month' });
    expect(off.money.revenue).toBe('Not connected');
    expect(off.renewals).toBe('Connect Stripe to see renewals');
  });

  it('logs dated text and media cost only after a charge lands', () => {
    process.env.BILLING_ENFORCE = '1';
    try {
      const empty: Record<string, unknown> = { credits: { granted: 0, spent: 0, ledger: [] } };
      const blocked = chargeCredits(empty, 'image', 'nope', new Date(NOW));
      expect(blocked.blocked).toBe(true);
      expect(empty.serveLog).toBeUndefined();
      const data: Record<string, unknown> = { credits: { granted: 100, spent: 0, ledger: [] } };
      chargeCredits(data, 'image', 'roof', new Date(NOW));
      const log = data.serveLog as { kind: string; usd: number }[];
      expect(log.some((row) => row.kind === 'media' && row.usd > 0)).toBe(true);
    } finally {
      delete process.env.BILLING_ENFORCE;
    }
  });
});

describe('owner money route', () => {
  it('keeps the money page owner-only and stores other monthly cost without wiping invites', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const app = buildServer({ authStore: new MemoryStore() });
    const signup = async (email: string) => {
      const res = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email, password: 'password1', tos: true } });
      return { cookie: String(res.headers['set-cookie']).split(';')[0], id: res.json().user.id as string };
    };
    const owner = await signup('owner@example.com');
    const other = await signup('painter@example.com');
    process.env.ADMIN_EMAIL = 'owner@example.com';
    try {
      const refused = await app.inject({ method: 'GET', url: '/api/admin/business?period=all', headers: { cookie: other.cookie } });
      expect(refused.statusCode).toBe(403);
      const saved = await app.inject({
        method: 'PUT', url: '/api/admin/settings', headers: { cookie: owner.cookie },
        payload: { inviteOnly: true, allowed: ['friend@example.com'], otherMonthlyUsd: 40 },
      });
      expect(saved.statusCode).toBe(200);
      const kept = await app.inject({
        method: 'PUT', url: '/api/admin/settings', headers: { cookie: owner.cookie },
        payload: { otherMonthlyUsd: 25 },
      });
      expect(kept.statusCode).toBe(200);
      const view = await app.inject({ method: 'GET', url: '/api/admin/business?period=month', headers: { cookie: owner.cookie } });
      expect(view.statusCode).toBe(200);
      expect(view.json().otherMonthlyUsd).toBe(25);
      expect(view.json().renewals).toBe('Connect Stripe to see renewals');
      const settings = await app.inject({ method: 'GET', url: '/api/admin', headers: { cookie: owner.cookie } });
      expect(settings.json().settings.inviteOnly).toBe(true);
      expect(settings.json().settings.allowed).toContain('friend@example.com');
      const html = readFileSync(join(process.cwd(), 'web', 'index.html'), 'utf8');
      expect(html).toContain('UPCOMING RENEWALS');
      expect(html).toContain('Connect Stripe to see renewals');
      expect(html).toContain('RENEWS');
      expect(html).toContain('const profitRaw=figures.profit;');
      expect(html).toContain("bothMissing?'Revenue and profit show once Stripe and your AI cost source report real numbers. ':'");
      expect(html).not.toContain('connect AI costs');
      expect(html).not.toMatch(/UPCOMING RENEWALS[\s\S]{0,80}\u2014/);
    } finally {
      delete process.env.ADMIN_EMAIL;
      await app.close();
    }
  });
});
