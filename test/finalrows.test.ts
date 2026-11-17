import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import type { Connector } from '../src/connectors/types.js';
import { buildCampaignSpec } from '../src/agents/campaign.js';
import { planFollowUp, rollupJobs } from '../src/agents/contractorloop.js';
import { feasibility } from '../src/agents/feasibility.js';
import { guardCopy } from '../src/playbooks/guard.js';
import { tradePlaybook } from '../src/playbooks/load.js';
import { accessOpen, applyRenewal, markCanceled } from '../src/billing/subscription.js';
import { launchChecks, summarize, type LaunchFacts } from '../src/ops/launchcheck.js';
import { dashboardRates } from '../src/reports/rates.js';

const TRADES = ['Roofing', 'HVAC', 'Plumbing', 'Electrical', 'Painting', 'Solar', 'Landscaping'];
const html = readFileSync('web/index.html', 'utf8');
const login = readFileSync('web/login.html', 'utf8');

describe('profile, trades, and rates', () => {
  it('loads each of the 7 playbooks and drafts one campaign per trade', () => {
    for (const trade of TRADES) {
      const book = tradePlaybook(trade);
      expect(book.label.toLowerCase()).toContain(trade.toLowerCase().slice(0, 4));
      const spec = buildCampaignSpec({ dailyBudget: 25 }, {
        business: `${trade} Co`, trade, city: 'Philadelphia', services: 'Repair', offers: '$50 off',
        radiusMiles: 12, hours: { startHour: 7, endHour: 19 },
      });
      expect(spec.name.toLowerCase()).toContain(trade.toLowerCase().slice(0, 4));
      expect(spec.locations.join(' ')).toMatch(/Philadelphia/);
      expect(spec.businessName).toMatch(/Co|Repair|Local/);
      expect(spec.targeting?.radiusMiles).toBe(12);
      expect(spec.targeting?.schedule).toMatchObject({ startHour: 7, endHour: 19 });
      const text = planFollowUp({ name: 'Dana', phone: '2155550100', businessName: `${trade} Co`, ghlConnected: false, automationEnabled: false });
      expect(text.body).toContain(`${trade} Co`);
    }
  });

  it('calls an over-ambitious budget unlikely and a looser budget in range', () => {
    const over = feasibility({ dailyBudget: 20, leadsPerDay: 2, trade: 'plumbing' });
    const under = feasibility({ dailyBudget: 400, leadsPerDay: 1, trade: 'plumbing' });
    expect(over.realistic).toBe('unlikely');
    expect(under.realistic).toBe('in_range');
  });

  it('rejects financing copy that has no terms, and keeps copy that states them', () => {
    expect(guardCopy('Financing available on a new roof').ok).toBe(false);
    expect(guardCopy('Financing available. APR and terms apply. Subject to credit.').ok).toBe(true);
  });

  it('drops canceled jobs from the ledger and stays finite at zero', () => {
    const roll = rollupJobs({
      spend: [{ channel: 'google', amount: 100 }],
      jobs: [
        { eventId: 'a', stage: 'won', jobValue: 500, channel: 'google' },
        { eventId: 'b', stage: 'canceled', jobValue: 900, channel: 'google' },
      ],
      sample: false,
    });
    expect(roll.byChannel[0]?.won).toBe(1);
    expect(roll.byChannel[0]?.leads).toBe(1);
    expect(roll.byChannel[0]?.jobValue).toBe(500);
    const rates = dashboardRates({ spend: 100, clicks: 0, leads: 0, booked: 0, revenue: 0 });
    expect(rates.cpc).toBeNull();
    expect(rates.costPerLead).toBeNull();
    expect(rates.costPerBookedJob).toBeNull();
    expect(rates.roas).toBe(0);
    expect(rates.roiPct).toBe(-100);
    expect(rates.clickToLead).toBeNull();
    expect(rates.leadToBooked).toBeNull();
    const live = dashboardRates({ spend: 100, clicks: 50, leads: 10, booked: 4, revenue: 400 });
    expect(live.cpc).toBe(2);
    expect(live.costPerLead).toBe(10);
    expect(live.costPerBookedJob).toBe(25);
    expect(live.roas).toBe(4);
    expect(live.roiPct).toBe(300);
    expect(live.clickToLead).toBe(0.2);
    expect(live.leadToBooked).toBe(0.4);
  });

  it('keeps access until the paid period ends, then a new subscription keeps the profile', () => {
    const data: Record<string, unknown> = { profile: { businessName: 'Painters In Philly' }, billing: { status: 'active', stripeSubscriptionId: 'sub_1', currentPeriodEnd: '2026-12-01T00:00:00.000Z' } };
    markCanceled(data, 'sub_1');
    expect(accessOpen({ status: 'canceled', currentPeriodEnd: '2026-12-01T00:00:00.000Z' }, Date.parse('2026-11-20T00:00:00.000Z'))).toBe(true);
    expect(accessOpen({ status: 'canceled', currentPeriodEnd: '2026-11-01T00:00:00.000Z' }, Date.parse('2026-11-20T00:00:00.000Z'))).toBe(false);
    applyRenewal(data, { invoiceId: 'in_2', customerId: 'cus', subscriptionId: 'sub_2', bandKey: 'starter', periodEnd: '2027-01-01T00:00:00.000Z', amountUsd: 149 });
    expect((data.profile as { businessName: string }).businessName).toBe('Painters In Philly');
    expect(accessOpen({ status: 'active' })).toBe(true);
  });

  it('lists sales tax as off unless STRIPE_TAX_ENABLED is 1', () => {
    const base = { env: { STRIPE_SECRET_KEY: 'sk_live_x', APP_URL: 'https://miles.example' }, durableStore: true, connectorLive: true, textAiReady: true, emailReady: true, billingEnforced: true, bandPrices: { starter: 149, growth: 397, scale: 797 } } as LaunchFacts;
    expect(launchChecks(base).find((row) => row.name === 'Sales tax')?.note).toMatch(/off/);
    expect(launchChecks({ ...base, env: { ...base.env, STRIPE_TAX_ENABLED: '1' } }).find((row) => row.name === 'Sales tax')?.note).toMatch(/on/);
    expect(summarize(launchChecks(base)).blockers).toBeGreaterThan(0);
  });
});

describe('two sessions, resume, and the screen', () => {
  it('refuses a stale profile save and resumes only when the mock reads the campaign back as enabled', async () => {
    const store = new MemoryStore();
    let readback = 'PAUSED';
    const connector = {
      name: 'live',
      listAccounts: async () => [],
      setGoogleCampaignStatus: async () => ({ ok: true, live: true, called: true, note: 'read back', readback: { campaign: readback, adGroups: [readback], ads: [readback] } }),
    } as unknown as Connector;
    const app = buildServer({ authStore: store, connector });
    const a = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'a@example.com', password: 'password1', tos: true } });
    const cookieA = String(a.headers['set-cookie']).split(';')[0];
    const again = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'a@example.com', password: 'password1' } });
    const cookieB = String(again.headers['set-cookie']).split(';')[0];
    const first = await app.inject({ method: 'PUT', url: '/api/profile', headers: { cookie: cookieA }, payload: { businessName: 'First', industry: 'Painting', serviceAreas: 'Philadelphia', services: 'Cabinet painting', phone: '2155550100' } });
    const stamp = first.json().profile.updatedAt as string;
    const second = await app.inject({ method: 'PUT', url: '/api/profile', headers: { cookie: cookieB }, payload: { businessName: 'Second', expectedUpdatedAt: stamp } });
    expect(second.statusCode).toBe(200);
    const clash = await app.inject({ method: 'PUT', url: '/api/profile', headers: { cookie: cookieA }, payload: { businessName: 'Third', expectedUpdatedAt: stamp } });
    expect(clash.statusCode).toBe(409);
    expect(clash.json().error).toMatch(/changed on another device/);

    const id = a.json().user.id as string;
    const data = await store.getUserData(id);
    data.miles = { ...(data.miles as object), campaignResource: 'customers/1/campaigns/1', activation: 'paused' };
    await store.setUserData(id, data);
    const held = await app.inject({ method: 'POST', url: '/api/miles/resume', headers: { cookie: cookieA }, payload: { confirm: true } });
    expect(held.statusCode).toBe(409);
    readback = 'ENABLED';
    const resumed = await app.inject({ method: 'POST', url: '/api/miles/resume', headers: { cookie: cookieA }, payload: { confirm: true } });
    expect(resumed.statusCode).toBe(200);
    expect(resumed.json().readback).toBe('ENABLED');

    const draft = await app.inject({ method: 'POST', url: '/api/campaign/draft', headers: { cookie: cookieA }, payload: { dailyBudget: 30 } });
    expect(draft.json().spec.locations.join(' ')).toMatch(/Philadelphia/);
    expect(JSON.stringify(draft.json().spec).toLowerCase()).toMatch(/cabinet|painting/);

    const zero = await app.inject({ method: 'GET', url: '/api/billing', headers: { cookie: cookieA } });
    expect(zero.json().zeroBalance).toBe(true);
    expect(zero.json().zeroMessage).toMatch(/\$0/);
    await app.close();
  });

  it('locks the dashboard order, hash restore, autocomplete, and the zero-balance sentence', () => {
    const headings = ['1 · Am I on track', '2 · What Miles did', '3 · Miles recommends', '4 · Leads', '5 · Your numbers', '6 · How do I compare', '7 · What is working', '8 · Running for you'];
    let at = -1;
    for (const heading of headings) {
      const next = html.indexOf(heading);
      expect(next).toBeGreaterThan(at);
      at = next;
    }
    expect(html).toMatch(/hashchange/);
    expect(html).toMatch(/Your credit balance is \$0/);
    expect(login).toMatch(/autocomplete="username"/);
    expect(login).toMatch(/autocomplete="name"/);
    expect(login).toMatch(/new-password/);
  });
});
