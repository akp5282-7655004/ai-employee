import { afterEach, describe, expect, it, vi } from 'vitest';

// Email delivery is mocked so no test ever reaches a real provider. Each test
// decides whether the provider "accepts" the mail.
const sendResult = { ok: false, note: 'Email provider returned 500.' };
vi.mock('../src/delivery/send.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/delivery/send.js')>();
  return {
    ...real,
    deliveryStatus: () => ({ email: true, sms: false }),
    sendEmail: vi.fn(async () => ({ ok: sendResult.ok, channel: 'email' as const, note: sendResult.note })),
  };
});

import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import { checkClaims, financingWarnings, getPack } from '../src/packs/index.js';
import { appendCrmEvent, calcLiveValues, crmEventTsFrom, crmLiveValues } from '../src/metrics/crmledger.js';
import { getMetric, liveFacts } from '../src/metrics/resolver.js';
import { approveChange, guardAction, LOGGED_ONLY } from '../src/automation/engine.js';
import { DEFAULT_CAPS } from '../src/agents/policy.js';

type App = ReturnType<typeof buildServer>;

async function signedUp(app: App, email: string): Promise<{ cookie: string; id: string }> {
  const res = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email, password: 'password1', name: 'Owner', tos: true } });
  expect(res.statusCode).toBe(200);
  return { cookie: String(res.headers['set-cookie']).split(';')[0] ?? '', id: res.json().user.id as string };
}

afterEach(() => {
  delete process.env.ADMIN_EMAIL;
  sendResult.ok = false;
});

describe('budget caps keep the safety floor', () => {
  it('rejects a negative or zero cap and an out-of-range max change on /api/miles/mode, and changes nothing', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const { cookie } = await signedUp(app, 'caps@example.com');
    const headers = { cookie };
    await app.inject({ method: 'POST', url: '/api/miles/questions', headers, payload: { goal: 'get me leads', dailyBudget: 20, leadsPerDay: 1 } });
    const home = async () => (await app.inject({ method: 'POST', url: '/api/miles/mode', headers, payload: {} })).json().setup?.caps;
    const before = await home();
    expect(before.dailyBudget).toBeGreaterThan(0);

    for (const [field, value] of [['dailyBudget', -50], ['monthlyCeiling', -100], ['dailyBudget', 0], ['dailyBudget', 'lots'], ['maxChangePct', -5], ['maxChangePct', 0], ['maxChangePct', 150]] as const) {
      const res = await app.inject({ method: 'POST', url: '/api/miles/mode', headers, payload: { mode: 'automate', [field]: value } });
      expect(res.statusCode, `${field}=${value}`).toBe(400);
      expect(res.json().field).toBe(field);
    }
    const after = await home();
    expect(after).toEqual(before);

    const good = await app.inject({ method: 'POST', url: '/api/miles/mode', headers, payload: { dailyBudget: 35, monthlyCeiling: 900, maxChangePct: 15 } });
    expect(good.statusCode).toBe(200);
    expect(good.json().setup.caps).toMatchObject({ dailyBudget: 35, monthlyCeiling: 900, maxChangePct: 15 });
    await app.close();
  });

  it('returns a field error for a typed negative budget on the Meta and Google builders', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const { cookie } = await signedUp(app, 'builders@example.com');
    const headers = { cookie };
    const meta = await app.inject({ method: 'POST', url: '/api/meta/build', headers, payload: { dailyBudget: -20 } });
    expect(meta.statusCode).toBe(400);
    expect(meta.json()).toMatchObject({ field: 'dailyBudget' });
    const google = await app.inject({ method: 'POST', url: '/api/campaign/draft', headers, payload: { dailyBudget: -20 } });
    expect(google.statusCode).toBe(400);
    expect(google.json()).toMatchObject({ field: 'dailyBudget' });
    const fine = await app.inject({ method: 'POST', url: '/api/campaign/draft', headers, payload: { dailyBudget: 25 } });
    expect(fine.statusCode).toBe(200);
    expect(fine.json().spec.dailyBudget).toBe(25);
    await app.close();
  });

  it('profile save rejects a blank business name over a saved one, caps text and drops unknown keys', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const { cookie } = await signedUp(app, 'profile@example.com');
    const headers = { cookie };
    const first = await app.inject({ method: 'PUT', url: '/api/profile', headers, payload: { businessName: 'Roof Co', isAdmin: true, credits: 9999 } });
    expect(first.statusCode).toBe(200);
    expect(first.json().profile.businessName).toBe('Roof Co');
    expect(first.json().profile.isAdmin).toBeUndefined();
    expect(first.json().profile.credits).toBeUndefined();
    const blank = await app.inject({ method: 'PUT', url: '/api/profile', headers, payload: { businessName: '   ' } });
    expect(blank.statusCode).toBe(400);
    expect(blank.json().field).toBe('businessName');
    const huge = await app.inject({ method: 'PUT', url: '/api/profile', headers, payload: { description: 'x'.repeat(500_000) } });
    expect(huge.statusCode).toBe(400);
    expect(huge.json().field).toBe('description');
    const saved = await app.inject({ method: 'GET', url: '/api/profile', headers });
    expect(saved.json().profile.businessName).toBe('Roof Co');
    expect(saved.json().profile.description).toBeUndefined();
    await app.close();
  });
});

describe('success messages are honest', () => {
  it('does not say Sent when the email provider fails, and says so when it works', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const { cookie } = await signedUp(app, 'mailer@example.com');
    const payload = { to: 'customer@example.com', subject: 'Hi', body: 'Hello there', confirm: true };
    const failed = await app.inject({ method: 'POST', url: '/api/email/send', headers: { cookie }, payload });
    expect(failed.statusCode).toBe(502);
    expect(failed.json().ok).toBe(false);
    expect(JSON.stringify(failed.json())).not.toMatch(/Sent to/);
    sendResult.ok = true;
    const sent = await app.inject({ method: 'POST', url: '/api/email/send', headers: { cookie }, payload });
    expect(sent.statusCode).toBe(200);
    expect(sent.json()).toMatchObject({ ok: true, via: 'provider' });
    await app.close();
  });

  it('marks an approved email draft emailed only when it really sent, and never says deployed', async () => {
    const store = new MemoryStore();
    const app = buildServer({ authStore: store });
    const { cookie, id } = await signedUp(app, 'review@example.com');
    const data = await store.getUserData(id);
    data.reviewQueue = [{ id: 'rq1', kind: 'email', title: 'Fall promo', body: 'Subject: Fall promo\nHello', status: 'pending' }];
    data.deploy = { auto: true, queue: [] };
    await store.setUserData(id, data);
    const res = await app.inject({ method: 'POST', url: '/api/review/approve', headers: { cookie }, payload: { id: 'rq1' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, emailed: false, pushed: false });
    expect(res.json().note).toMatch(/Nothing was pushed/);
    await app.close();
  });

  it('feedback with no owner set up says it was not sent', async () => {
    delete process.env.ADMIN_EMAIL;
    const app = buildServer({ authStore: new MemoryStore() });
    const { cookie } = await signedUp(app, 'tester@example.com');
    const res = await app.inject({ method: 'POST', url: '/api/feedback', headers: { cookie }, payload: { message: 'Love it' } });
    expect(res.statusCode).toBe(503);
    expect(res.json().ok).toBe(false);
    expect(res.json().error).toMatch(/not set up/i);
    await app.close();
  });

  it('labels an applied daily-read change as logged only', () => {
    const decided = guardAction(
      { mode: 'automate', paused: false, creditsLeft: 10, dailyBudget: 50, monthlyCeiling: 1500, maxChangePct: DEFAULT_CAPS.maxChangePct, spentToday: 0, spentMonth: 0 },
      { kind: 'optimize', title: 'Add negatives', before: '', after: 'jobs, free', spend: 0 },
    );
    expect(decided.effect).toBe('applied');
    expect(decided.reason).toContain(LOGGED_ONLY);
    const approved = approveChange([{ id: 'a', ts: '', skill: 's', title: 't', effect: 'queued', before: '', after: '', reason: '' }], 'a');
    expect(approved.reason).toContain('Google Ads was not changed');
  });
});

describe('financing claims need a terms line', () => {
  it('warns on 0%, APR, $X/mo, $0 down and no interest without terms', () => {
    for (const text of ['0% financing on a new roof', 'Low APR available', 'Just $99/mo', 'New HVAC for $149 a month', '$0 down installs', 'No interest for 12 months']) {
      expect(financingWarnings(text), text).toHaveLength(1);
    }
    expect(financingWarnings('0% financing with approved credit. See terms.')).toEqual([]);
    expect(financingWarnings('10% off interior painting')).toEqual([]);
    expect(financingWarnings('100% satisfaction')).toEqual([]);
  });

  it('rides on the claims check as a warning the owner sees, not a hidden pass', () => {
    const pack = getPack();
    const check = checkClaims(pack!, 'Just $99/mo for a new furnace');
    expect(check.warnings[0]).toMatch(/Financing claim without terms/);
    const clean = checkClaims(pack!, 'Fast furnace repair');
    expect(clean.warnings).toEqual([]);
  });

  it('shows the warning on the Facebook plan before approval', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const { cookie } = await signedUp(app, 'finance@example.com');
    await app.inject({ method: 'PUT', url: '/api/profile', headers: { cookie }, payload: { businessName: 'Roof Co', industry: 'Roofing', serviceAreas: 'Philadelphia' } });
    const built = await app.inject({ method: 'POST', url: '/api/meta/build', headers: { cookie }, payload: { offer: '0% financing, just $99/mo' } });
    expect(built.statusCode).toBe(200);
    expect(built.json().spec.ad.headline).toMatch(/0%/);
    expect(built.json().warnings.join(' ')).toMatch(/Financing claim without terms: "0%", "\$99\/mo"/);
    await app.close();
  });
});

describe('CRM ledger counts an event once', () => {
  it('skips a repeat of the same type and id, and keeps different ids', () => {
    const data: Record<string, unknown> = {};
    const ts = new Date().toISOString();
    expect(appendCrmEvent(data, { type: 'closed_won', ts, amount: 5000, id: 'opp-1' })).toBe(true);
    expect(appendCrmEvent(data, { type: 'closed_won', ts, amount: 5000, id: 'opp-1' })).toBe(false);
    expect(appendCrmEvent(data, { type: 'job_complete', ts, id: 'opp-1' })).toBe(true);
    appendCrmEvent(data, { type: 'closed_won', ts, amount: 3000, id: 'opp-2' });
    appendCrmEvent(data, { type: 'lead', ts });
    appendCrmEvent(data, { type: 'lead', ts });
    const v = crmLiveValues(data, 30);
    expect(v['crm.estimates_won']).toBe(2);
    expect(v['crm.job_revenue']).toBe(8000);
    expect(v['crm.leads_created']).toBe(2); // no id: cannot tell them apart, both count
  });

  it('uses the payload timestamp and never a future one', () => {
    const now = Date.parse('2026-11-17T12:00:00.000Z');
    expect(crmEventTsFrom({ timestamp: '2026-11-10T09:00:00.000Z' }, now)).toBe('2026-11-10T09:00:00.000Z');
    expect(crmEventTsFrom({ created_at: '2027-01-01T00:00:00.000Z' }, now)).toBe('2026-11-17T12:00:00.000Z');
    expect(crmEventTsFrom({}, now)).toBe('2026-11-17T12:00:00.000Z');
  });

  it('a retried webhook or an already-handled lead is not double counted', async () => {
    const store = new MemoryStore();
    const app = buildServer({ authStore: store });
    const { id } = await signedUp(app, 'hooks@example.com');
    const secret = 'b'.repeat(24);
    const data = await store.getUserData(id);
    data.speedToLead = { enabled: false, webhookSecret: secret, contacted: ['id:lead-handled'], log: [] };
    await store.setUserData(id, data);
    const token = `${id}.${secret}`;
    const lead = { id: 'lead-1', name: 'Dana', phone: '2155550100' };
    await app.inject({ method: 'POST', url: `/api/hooks/lead/${token}`, payload: lead });
    await app.inject({ method: 'POST', url: `/api/hooks/lead/${token}`, payload: lead });
    const handled = await app.inject({ method: 'POST', url: `/api/hooks/lead/${token}`, payload: { id: 'lead-handled', name: 'Old', phone: '2155550101' } });
    expect(handled.json().reason).toMatch(/Already handled/);
    const deal = { id: 'opp-9', name: 'Dana', amount: 5000 };
    await app.inject({ method: 'POST', url: `/api/hooks/deal/${token}`, payload: deal });
    await app.inject({ method: 'POST', url: `/api/hooks/deal/${token}`, payload: deal });
    const after = await store.getUserData(id);
    const v = crmLiveValues(after, 30);
    expect(v['crm.leads_created']).toBe(1);
    expect(v['crm.estimates_won']).toBe(1);
    expect(v['crm.job_revenue']).toBe(5000);
    await app.close();
  });
});

describe('cost per lead never mixes ranges', () => {
  it('uses 30-day snapshot spend only for a 30-day range', async () => {
    const store = new MemoryStore();
    const app = buildServer({ authStore: store });
    const { cookie, id } = await signedUp(app, 'ranges@example.com');
    const data = await store.getUserData(id);
    data.snapshot = { ts: new Date().toISOString(), campaigns: [{ platform: 'google', campaign: 'Search', spend: 300 }], adSpend: 300, deals: [], searchTerms: [], leads: [], reviews: [], social: null };
    const ts = new Date().toISOString();
    data.crmEvents = [{ type: 'lead', ts }, { type: 'lead', ts }, { type: 'lead', ts }];
    await store.setUserData(id, data);
    const resolve = async (days: number) => {
      const res = await app.inject({ method: 'POST', url: '/api/metrics/resolve', headers: { cookie }, payload: { keys: ['calc.blended_cpl', 'calc.blended_spend'], days } });
      return Object.fromEntries((res.json().results as { key: string; value: number; source: string }[]).map((r) => [r.key, r]));
    };
    const month = await resolve(30);
    expect(month['calc.blended_cpl']).toMatchObject({ value: 100, source: 'live' });
    const week = await resolve(7);
    expect(week['calc.blended_cpl']!.source).toBe('sample');
    expect(week['calc.blended_spend']!.source).toBe('sample');
    expect(week['calc.blended_cpl']!.value).not.toBe(100);
    await app.close();
  });
});

describe('a real zero denominator shows no number', () => {
  it('marks cost per lead and ROAS as live with no value instead of falling back to sample', async () => {
    const calc = calcLiveValues({ 'crm.leads_created': 0, 'crm.booked_jobs': 0, 'crm.job_revenue': 0 }, 0);
    const cpl = await getMetric('calc.blended_cpl', 30, { values: calc });
    expect(cpl).toMatchObject({ source: 'live', noValue: true });
    const roas = await getMetric('calc.blended_roas', 30, { values: calc });
    expect(roas).toMatchObject({ source: 'live', noValue: true });
    expect(liveFacts([cpl!, roas!])).toEqual({});
  });
});
