import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import type { Connector } from '../src/connectors/types.js';

function appFor(targets: { id: string; label: string }[]) {
  const calls: string[] = [];
  const connector = {
    name: 'pipedream',
    async createConnectToken() { return { token: 't', expiresAt: '2099-01-01', connectUrl: 'https://connect.example' }; },
    async listAccounts() { return targets.length ? [{ id: 'acct', app: 'google_ads', externalUserId: 'u', healthy: true }] : []; },
    async runAction() { return { ok: true, actionId: 'x', app: 'google_ads', output: null }; },
    async listAdTargets() { calls.push('targets'); return targets; },
    async launchCampaign() {
      calls.push('launch');
      return {
        ok: true, live: true, campaignResource: 'customers/1/campaigns/9',
        steps: [
          { step: 'Create daily budget ($20)', ok: true, resource: 'customers/1/campaignBudgets/1' },
          { step: 'Create campaign "Painting" (PAUSED)', ok: true, resource: 'customers/1/campaigns/9' },
          { step: 'Create ad group "Interior painting"', ok: true, resource: 'customers/1/adGroups/3' },
          { step: 'Add 3 keywords to "Interior painting"', ok: true },
          { step: 'Create responsive search ad in "Interior painting"', ok: true, resource: 'customers/1/ads/8' },
          { step: 'Add location targeting', ok: true },
        ],
      };
    },
    async setGoogleCampaignStatus(_id: string, args: { status: string }) {
      calls.push('status:' + args.status);
      return { ok: true, live: true, called: true, note: 'Status set to ' + args.status, readback: { campaign: 'ENABLED', adGroups: ['ENABLED'], ads: ['ENABLED'], note: 'Read back from the account.' } };
    },
  } as unknown as Connector;
  const app = buildServer({ authStore: new MemoryStore(), connector });
  return { app, calls };
}

async function cookie(app: ReturnType<typeof buildServer>, email: string) {
  const r = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email, password: 'password1', tos: true } });
  return String(r.headers['set-cookie']).split(';')[0] ?? '';
}

const html = '<html><head><title>Painters In Philly</title><meta name="description" content="Interior and exterior painting in Philadelphia. Call 215-555-0199."></head><body><p>Interior painting and exterior painting. Licensed. Monday 8am to 5pm.</p><a href="tel:215-555-0199">215-555-0199</a></body></html>';

describe('Google path at $20 a day', () => {
  it('crawls, plans, and enables inside automate caps', async () => {
    const { app, calls } = appFor([{ id: '9013698905', label: 'Painters' }]);
    const c = await cookie(app, 'paint-auto@example.com');
    const headers = { cookie: c };
    const crawled = await app.inject({ method: 'POST', url: '/api/miles/crawl', headers, payload: { businessName: 'Painters In Philly', location: 'Philadelphia, PA', email: 'paint-auto@example.com', website: 'https://paintersinphilly.com', gbpUrl: 'https://maps.example/gbp', competitors: ['https://other.example'], html } });
    expect(crawled.statusCode).toBe(200);
    expect(crawled.json().gbpNote).toMatch(/does not read ratings/);
    expect(crawled.json().audits[1].summary).toMatch(/not available/);
    const planned = await app.inject({ method: 'POST', url: '/api/miles/questions', headers, payload: { goal: 'get me leads', dailyBudget: 20, leadsPerDay: 1, googleShare: 1, mode: 'automate' } });
    expect(planned.statusCode).toBe(200);
    expect(planned.json().bundle.playbook.title).toMatch(/painting playbook/i);
    expect(planned.json().bundle.spec.status).toBe('PAUSED');
    expect(planned.json().bundle.channels.find((ch: { id: string }) => ch.id === 'meta').status).toBe('coming_later');
    await app.inject({ method: 'POST', url: '/api/miles/tracking', headers, payload: { leadConversion: true, ga4Linked: true, method: 'thank_you' } });
    const started = await app.inject({ method: 'POST', url: '/api/miles/go', headers, payload: { confirm: true, plan: planned.json().bundle.spec } });
    expect(started.statusCode).toBe(200);
    expect(started.json().created).toBe(true);
    expect(started.json().enabled).toBe(true);
    expect(calls).toContain('launch');
    expect(calls).toContain('status:ENABLED');
    const home = await app.inject({ method: 'GET', url: '/api/miles/home', headers });
    expect(home.json().ghl.connected).toBe(false);
    expect(home.json().ghl.setup).toMatch(/not connected/);
    expect(home.json().jobs.booked).toBe(0);
    const marked = await app.inject({ method: 'POST', url: '/api/jobs/mark', headers, payload: { eventId: 'lead-1', stage: 'booked', jobValue: 2500, channel: 'google' } });
    expect(marked.statusCode).toBe(200);
    const again = await app.inject({ method: 'GET', url: '/api/miles/home', headers });
    expect(again.json().jobs.booked).toBe(1);
  });

  it('hybrid queues the create and does not call Google', async () => {
    const { app, calls } = appFor([{ id: '1', label: 'Painters' }]);
    const c = await cookie(app, 'paint-hybrid@example.com');
    const headers = { cookie: c };
    await app.inject({ method: 'POST', url: '/api/miles/crawl', headers, payload: { businessName: 'Painters In Philly', location: 'Philadelphia, PA', website: 'https://paintersinphilly.com', html } });
    await app.inject({ method: 'POST', url: '/api/miles/questions', headers, payload: { goal: 'get me leads', dailyBudget: 20, leadsPerDay: 1, mode: 'hybrid' } });
    const started = await app.inject({ method: 'POST', url: '/api/miles/go', headers, payload: { confirm: true } });
    expect(started.statusCode).toBe(400);
    expect(started.json().needsPlan).toBe(true);
    expect(started.json().created).toBe(false);
    expect(calls).not.toContain('launch');
  });

  it('manual does not create', async () => {
    const { app, calls } = appFor([{ id: '1', label: 'Painters' }]);
    const c = await cookie(app, 'paint-manual@example.com');
    const headers = { cookie: c };
    await app.inject({ method: 'POST', url: '/api/miles/questions', headers, payload: { goal: 'get me leads', dailyBudget: 20, leadsPerDay: 1, mode: 'manual' } });
    const started = await app.inject({ method: 'POST', url: '/api/miles/go', headers, payload: { confirm: true } });
    expect(started.json().created).toBe(false);
    expect(calls).not.toContain('launch');
    const home = await app.inject({ method: 'GET', url: '/api/miles/home', headers });
    expect(home.json().inbox.filter((i: { status: string }) => i.status === 'queued')).toEqual([]);
  });
});
