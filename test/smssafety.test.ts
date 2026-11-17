import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import type { Connector, Lead } from '../src/connectors/types.js';
import { addOptOut, effectiveQuietHours, inQuietHours, isOptedOut, isStopMessage, payloadOptsOut } from '../src/agents/smsguard.js';

/** 15:00 UTC (9 AM US Central): inside the default 8 AM–8 PM window. */
const DAY = new Date('2026-11-17T15:00:00Z');
/** 03:00 UTC (9 PM US Central): inside quiet hours. */
const NIGHT = new Date('2026-11-17T03:00:00Z');

function harness() {
  const sms: { phone?: string; message?: string; query?: string }[] = [];
  let sendOk = true;
  const leads: Lead[] = [];
  const connector = {
    name: 'pipedream',
    async createConnectToken(id: string) { return { token: 't', expiresAt: '2099', connectUrl: 'https://connect.example/' + id }; },
    async listAccounts(id: string) { return [{ id: 'ghl', app: 'highlevel_oauth', externalUserId: id, healthy: true }]; },
    async runAction(req: { actionId: string }) { return { ok: true, actionId: req.actionId, app: 'highlevel_oauth', output: { id: 'c1' } }; },
    async runAppTask(req: { query: string; params: Record<string, string> }) {
      sms.push({ phone: req.params.phone, message: req.params.message, query: req.query });
      return { ok: sendOk, app: 'highlevel_oauth', summary: sendOk ? 'sent' : 'rejected' };
    },
    async getLeads() { return leads; },
  } as unknown as Connector;
  return { connector, sms, leads, failSends() { sendOk = false; }, okSends() { sendOk = true; } };
}

async function setup(opts: { email?: string; review?: boolean; automations?: boolean } = {}) {
  const h = harness();
  const store = new MemoryStore();
  const app = buildServer({ authStore: store, connector: h.connector });
  const signup = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: opts.email ?? 'roofer@example.com', password: 'password1', name: 'Pat', tos: true } });
  const cookie = String(signup.headers['set-cookie']).split(';')[0] ?? '';
  const id = signup.json().user.id as string;
  const data = await store.getUserData(id);
  const secret = 's'.repeat(24);
  data.speedToLead = { enabled: true, webhookSecret: secret, contacted: [], log: [] };
  data.profile = { businessName: 'Ozark Roofing', industry: 'roofing' };
  if (opts.review) data.reviewRequest = { enabled: true, googleReviewUrl: 'https://g.page/r/x/review', pending: [], log: [] };
  if (opts.automations) data.automations = { noShow: { enabled: true, log: [] }, onboarding: { enabled: true, log: [] } };
  await store.setUserData(id, data);
  const token = `${id}.${secret}`;
  const post = (url: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url, payload });
  return { h, app, store, id, token, cookie, post };
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(DAY); });
afterEach(() => { vi.useRealTimers(); delete process.env.ADMIN_EMAIL; });

describe('sms guard helpers', () => {
  it('reads STOP and its synonyms only as the whole message', () => {
    for (const t of ['STOP', 'stop', ' Unsubscribe ', 'cancel', 'END', 'quit.', 'Stop!']) expect(isStopMessage(t), t).toBe(true);
    for (const t of ['please stop by tuesday', 'stopper', '', 'I want to cancel my appointment']) expect(isStopMessage(t), t).toBe(false);
  });
  it('keeps opt-outs in E.164 and matches any typed form', () => {
    const data: Record<string, unknown> = {};
    expect(addOptOut(data, '(479) 555-0101')).toBe(true);
    expect(data.smsOptOuts).toEqual(['+14795550101']);
    expect(isOptedOut(data, '479.555.0101')).toBe(true);
    expect(isOptedOut(data, '+1 479 555 0102')).toBe(false);
    expect(addOptOut(data, '12')).toBe(false);
  });
  it('reads CRM opt-out flags', () => {
    expect(payloadOptsOut({ dnd: true })).toBe(true);
    expect(payloadOptsOut({ opt_out: true })).toBe(true);
    expect(payloadOptsOut({ optOut: 'true' })).toBe(true);
    expect(payloadOptsOut({ consent: false })).toBe(true);
    expect(payloadOptsOut({ consent: true })).toBe(false);
  });
  it('enforces 8 AM to 8 PM by default, in the owner offset when known', () => {
    expect(effectiveQuietHours({})).toEqual({ enabled: true, tzOffsetMinutes: -360 });
    // Saved schedules store getTimezoneOffset() minutes (Central is +360), so the sign flips.
    expect(effectiveQuietHours({ schedules: [{ tzOffset: 360 }] })).toEqual({ enabled: true, tzOffsetMinutes: -360 });
    expect(inQuietHours({ enabled: true, tzOffsetMinutes: 0 }, NIGHT.getTime())).toBe(true);
    expect(inQuietHours({ enabled: true, tzOffsetMinutes: 0 }, DAY.getTime())).toBe(false);
    expect(inQuietHours({ enabled: false, tzOffsetMinutes: 0 }, NIGHT.getTime())).toBe(false);
  });
});

describe('opt-outs are kept per account and every text path refuses them', () => {
  it('remembers an opted-out lead and the review, no-show and welcome texts refuse that number', async () => {
    const s = await setup({ review: true, automations: true });
    const first = await s.post(`/api/hooks/lead/${s.token}`, { id: 'L1', name: 'Dana', phone: '479-555-0101', dnd: true });
    expect(first.json().sent).toBe(false);
    expect(first.json().status).toBe('opted_out');
    expect(s.h.sms).toEqual([]);
    expect((await s.store.getUserData(s.id)).smsOptOuts).toEqual(['+14795550101']);

    const job = await s.post(`/api/hooks/job/${s.token}`, { id: 'J1', name: 'Dana', phone: '(479) 555-0101' });
    expect(job.json().sent).toBe(false);
    expect(job.json().status).toBe('opted_out');
    const noShow = await s.post(`/api/hooks/appointment/${s.token}`, { id: 'A1', name: 'Dana', phone: '4795550101' });
    expect(noShow.json().status).toBe('opted_out');
    const deal = await s.post(`/api/hooks/deal/${s.token}`, { id: 'D1', name: 'Dana', phone: '+1 479 555 0101' });
    expect(deal.json().status).toBe('opted_out');
    expect(s.h.sms).toEqual([]);
    const runs = (await s.store.getUserData(s.id)).agentRuns as { body: string }[] | undefined;
    expect(JSON.stringify(runs ?? [])).not.toMatch(/Sent via GoHighLevel/);
    await s.app.close();
  });

  it('opts a number out on a STOP review reply, sends no second ask, and refuses later texts', async () => {
    const s = await setup({ review: true });
    const ask = await s.post(`/api/hooks/job/${s.token}`, { id: 'J1', name: 'Sam', phone: '4795550111' });
    expect(ask.json().sent).toBe(true);
    expect(s.h.sms).toHaveLength(1);
    expect(s.h.sms[0]!.phone).toBe('+14795550111');

    const rated = await s.post(`/api/hooks/job/${s.token}?event=reply`, { name: 'Sam', phone: '4795550111', message: '9, great job' });
    expect(rated.json().rating).toBe(9);
    expect(rated.json().sent).toBe(false);
    expect(s.h.sms).toHaveLength(1); // the reply is logged, not answered with another ask
    const rs = (await s.store.getUserData(s.id)).reviewRequest as { log: { rating?: number; outcome: string }[] };
    expect(rs.log[0]).toMatchObject({ rating: 9, outcome: 'rated' });

    const stop = await s.post(`/api/hooks/job/${s.token}?event=reply`, { name: 'Sam', phone: '4795550111', message: 'STOP' });
    expect(stop.json().optedOut).toBe(true);
    expect(s.h.sms).toHaveLength(1);
    const again = await s.post(`/api/hooks/job/${s.token}`, { id: 'J2', name: 'Sam', phone: '479-555-0111' });
    expect(again.json().sent).toBe(false);
    expect(again.json().status).toBe('opted_out');
    expect(s.h.sms).toHaveLength(1);
    await s.app.close();
  });

  it('refuses a lead whose message is STOP, and the journey hook remembers missing consent', async () => {
    const s = await setup();
    const stop = await s.post(`/api/hooks/lead/${s.token}`, { id: 'L9', name: 'Kim', phone: '4795550122', message: 'stop' });
    expect(stop.json().status).toBe('opted_out');
    const journey = await s.post(`/api/journey/leads/${s.token}`, { eventId: 'evt-1', name: 'Lee', phone: '4795550133', consent: false });
    expect(journey.json().followedUp).toBe(false);
    const next = await s.post(`/api/journey/leads/${s.token}`, { eventId: 'evt-2', name: 'Lee', phone: '(479) 555-0133', consent: true });
    expect(next.json().followedUp).toBe(false);
    expect(s.h.sms).toEqual([]);
    expect((await s.store.getUserData(s.id)).smsOptOuts).toEqual(expect.arrayContaining(['+14795550122', '+14795550133']));
    await s.app.close();
  });

  it('skips an opted-out lead in the scheduled Speed-to-Lead run', async () => {
    const s = await setup();
    const data = await s.store.getUserData(s.id);
    data.smsOptOuts = ['+14795550144'];
    await s.store.setUserData(s.id, data);
    s.h.leads.push({ id: 'g1', name: 'Rae', phone: '479 555 0144', service: 'roof leak' }, { id: 'g2', name: 'Ty', phone: '4795550145', service: 'gutters' });
    const run = await s.app.inject({ method: 'POST', url: '/api/speed-to-lead/run', headers: { cookie: s.cookie } });
    expect(run.statusCode).toBe(200);
    expect(s.h.sms.map((m) => m.phone)).toEqual(['+14795550145']);
    expect(run.json().run.body).toMatch(/Rae: not sent\. This number opted out/);
    await s.app.close();
  });
});

describe('quiet hours are on by default and enforced everywhere', () => {
  it('reports and enforces the default, holding lead, review, no-show and welcome texts', async () => {
    vi.setSystemTime(NIGHT);
    const s = await setup({ review: true, automations: true });
    const cfg = await s.app.inject({ method: 'GET', url: '/api/speed-to-lead', headers: { cookie: s.cookie } });
    expect(cfg.json().quietHours).toEqual({ enabled: true, tzOffsetMinutes: -360 });
    const lead = await s.post(`/api/hooks/lead/${s.token}`, { id: 'L1', name: 'Dana', phone: '4795550101' });
    expect(lead.json()).toMatchObject({ sent: false, held: true, status: 'quiet_hours' });
    const job = await s.post(`/api/hooks/job/${s.token}`, { id: 'J1', name: 'Dana', phone: '4795550101' });
    expect(job.json()).toMatchObject({ sent: false, status: 'quiet_hours' });
    const noShow = await s.post(`/api/hooks/appointment/${s.token}`, { id: 'A1', name: 'Dana', phone: '4795550101' });
    expect(noShow.json()).toMatchObject({ sent: false, status: 'quiet_hours' });
    const deal = await s.post(`/api/hooks/deal/${s.token}`, { id: 'D1', name: 'Dana', phone: '4795550101' });
    expect(deal.json()).toMatchObject({ sent: false, status: 'quiet_hours' });
    expect(s.h.sms).toEqual([]);
    const runs = JSON.stringify((await s.store.getUserData(s.id)).agentRuns ?? []);
    expect(runs).not.toMatch(/Sent via GoHighLevel/);
    expect(runs).toMatch(/Held for quiet hours/);
    await s.app.close();
  });

  it('holds the scheduled run until morning without marking the leads handled', async () => {
    vi.setSystemTime(NIGHT);
    const s = await setup();
    s.h.leads.push({ id: 'g1', name: 'Rae', phone: '4795550144', service: 'roof leak' });
    const night = await s.app.inject({ method: 'POST', url: '/api/speed-to-lead/run', headers: { cookie: s.cookie } });
    expect(night.json().ran).toBe(false);
    expect(s.h.sms).toEqual([]);
    vi.setSystemTime(DAY);
    const day = await s.app.inject({ method: 'POST', url: '/api/speed-to-lead/run', headers: { cookie: s.cookie } });
    expect(day.json().ran).toBe(true);
    expect(s.h.sms).toHaveLength(1);
    await s.app.close();
  });

  it('sends when the owner turns quiet hours off', async () => {
    vi.setSystemTime(NIGHT);
    const s = await setup();
    await s.app.inject({ method: 'POST', url: '/api/speed-to-lead', headers: { cookie: s.cookie }, payload: { quietHours: { enabled: false, tzOffsetMinutes: 0 } } });
    const lead = await s.post(`/api/hooks/lead/${s.token}`, { id: 'L1', name: 'Dana', phone: '4795550101' });
    expect(lead.json().sent).toBe(true);
    await s.app.close();
  });
});

describe('a paused account texts nobody and cannot sign in', () => {
  it('ends sessions, refuses login with a plain message, and its hooks and scheduler send nothing', async () => {
    process.env.ADMIN_EMAIL = 'owner@example.com';
    const s = await setup({ review: true, automations: true });
    const ownerSignup = await s.app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'owner@example.com', password: 'password1', tos: true } });
    const owner = String(ownerSignup.headers['set-cookie']).split(';')[0];
    const paused = await s.app.inject({ method: 'POST', url: '/api/admin/pause', headers: { cookie: owner }, payload: { id: s.id, paused: true } });
    expect(paused.json().paused).toBe(true);

    const me = await s.app.inject({ method: 'GET', url: '/auth/me', headers: { cookie: s.cookie } });
    expect(me.statusCode).toBe(401);
    const login = await s.app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'roofer@example.com', password: 'password1' } });
    expect(login.statusCode).toBe(403);
    expect(login.json().error).toMatch(/This account is paused/);
    expect(login.headers['set-cookie']).toBeUndefined();

    const phone = '4795550101';
    for (const url of [`/api/hooks/lead/${s.token}`, `/api/hooks/job/${s.token}`, `/api/hooks/appointment/${s.token}`, `/api/hooks/deal/${s.token}`]) {
      const r = await s.post(url, { id: 'E1', name: 'Dana', phone });
      expect(r.json().sent, url).toBe(false);
      expect(r.json().reason, url).toMatch(/paused/);
    }
    const journey = await s.post(`/api/journey/leads/${s.token}`, { eventId: 'evt-1', name: 'Dana', phone, consent: true });
    expect(journey.json().followedUp).toBe(false);
    expect(journey.json().upserted).toBe(false);

    s.h.leads.push({ id: 'g1', name: 'Rae', phone: '4795550144' });
    await (s.app as unknown as { runDueSchedules: () => Promise<void> }).runDueSchedules();
    expect(s.h.sms).toEqual([]);

    await s.app.inject({ method: 'POST', url: '/api/admin/pause', headers: { cookie: owner }, payload: { id: s.id, paused: false } });
    const back = await s.app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'roofer@example.com', password: 'password1' } });
    expect(back.statusCode).toBe(200);
    await s.app.close();
  });
});

describe('CRM phones, households, failed sends and replays', () => {
  it('normalizes webhook phones before dedupe and send, and skips a phone that does not parse', async () => {
    const s = await setup();
    const a = await s.post(`/api/hooks/lead/${s.token}`, { name: 'Dana', phone: '(479) 555-0101' });
    expect(a.json().sent).toBe(true);
    expect(s.h.sms[0]!.phone).toBe('+14795550101');
    const b = await s.post(`/api/hooks/lead/${s.token}`, { name: 'Dana', phone: '479.555.0101' });
    expect(b.json().reason).toMatch(/Already handled/);
    const bad = await s.post(`/api/hooks/lead/${s.token}`, { name: 'Lou', phone: '555-01' });
    expect(bad.json()).toMatchObject({ sent: false, status: 'bad_phone' });
    expect(s.h.sms).toHaveLength(1);
    await s.app.close();
  });

  it('answers two household members on one phone when the CRM sends no lead id', async () => {
    const s = await setup();
    const maria = await s.post(`/api/hooks/lead/${s.token}`, { name: 'Maria Lopez', phone: '479-555-0300' });
    const carlos = await s.post(`/api/hooks/lead/${s.token}`, { name: 'Carlos Lopez', phone: '479-555-0300' });
    expect(maria.json().sent).toBe(true);
    expect(carlos.json().sent).toBe(true);
    const again = await s.post(`/api/hooks/lead/${s.token}`, { name: 'maria lopez', phone: '4795550300' });
    expect(again.json().reason).toMatch(/Already handled/);
    expect(s.h.sms).toHaveLength(2);
    await s.app.close();
  });

  it('records a failed send as failed, not contacted, and lets a retry send once', async () => {
    const s = await setup();
    s.h.failSends();
    const fail = await s.post(`/api/hooks/lead/${s.token}`, { id: 'L1', name: 'Dana', phone: '4795550101' });
    expect(fail.json()).toMatchObject({ sent: false, failed: true, held: false, status: 'failed' });
    const data = await s.store.getUserData(s.id);
    const st = data.speedToLead as { contacted: string[]; log: { failed?: boolean; held: boolean }[] };
    expect(st.contacted).not.toContain('id:L1');
    expect(st.log[0]).toMatchObject({ failed: true, held: false });
    expect(JSON.stringify(data.agentRuns)).toMatch(/Failed, not sent/);
    const stats = await s.app.inject({ method: 'GET', url: '/api/speed-to-lead', headers: { cookie: s.cookie } });
    expect(stats.json().stats.failed).toBe(1);
    s.h.okSends();
    const retry = await s.post(`/api/hooks/lead/${s.token}`, { id: 'L1', name: 'Dana', phone: '4795550101' });
    expect(retry.json().sent).toBe(true);
    const replay = await s.post(`/api/hooks/lead/${s.token}`, { id: 'L1', name: 'Dana', phone: '4795550101' });
    expect(replay.json().reason).toMatch(/Already handled/);
    expect(s.h.sms).toHaveLength(2);
    await s.app.close();
  });

  it('shows Failed, not sent in the scheduled run and leaves the lead for a retry', async () => {
    const s = await setup();
    s.h.failSends();
    s.h.leads.push({ id: 'g1', name: 'Rae', phone: '4795550144', service: 'roof leak' });
    const run = await s.app.inject({ method: 'POST', url: '/api/speed-to-lead/run', headers: { cookie: s.cookie } });
    expect(run.json().run.body).toMatch(/Failed, not sent/);
    expect(run.json().run.body).not.toMatch(/drafted, ready to send/);
    expect(((await s.store.getUserData(s.id)).speedToLead as { contacted: string[] }).contacted).not.toContain('id:g1');
    await s.app.close();
  });

  it('does not text twice when the review, no-show or welcome webhook is replayed', async () => {
    const s = await setup({ review: true, automations: true });
    for (const url of [`/api/hooks/job/${s.token}`, `/api/hooks/appointment/${s.token}`, `/api/hooks/deal/${s.token}`]) {
      const first = await s.post(url, { id: 'E1', name: 'Dana', phone: '4795550101' });
      expect(first.json().sent, url).toBe(true);
      const replay = await s.post(url, { id: 'E1', name: 'Dana', phone: '4795550101' });
      expect(replay.json().sent, url).toBe(false);
      expect(replay.json().duplicate, url).toBe(true);
    }
    expect(s.h.sms).toHaveLength(3);
    await s.app.close();
  });

  it('marks a failed review ask as failed and lets the same event retry', async () => {
    const s = await setup({ review: true });
    s.h.failSends();
    const fail = await s.post(`/api/hooks/job/${s.token}`, { id: 'J1', name: 'Dana', phone: '4795550101' });
    expect(fail.json()).toMatchObject({ sent: false, status: 'failed' });
    expect(JSON.stringify((await s.store.getUserData(s.id)).agentRuns)).toMatch(/Failed, not sent/);
    s.h.okSends();
    const retry = await s.post(`/api/hooks/job/${s.token}`, { id: 'J1', name: 'Dana', phone: '4795550101' });
    expect(retry.json().sent).toBe(true);
    await s.app.close();
  });
});

describe('the approval log keeps every SMS send', () => {
  it('keeps the sop-gate entry written by the shared sender after the hook saves', async () => {
    const s = await setup({ review: true, automations: true });
    await s.post(`/api/hooks/lead/${s.token}`, { id: 'L1', name: 'Dana', phone: '4795550101' });
    await s.post(`/api/hooks/job/${s.token}`, { id: 'J1', name: 'Dana', phone: '4795550101' });
    await s.post(`/api/hooks/appointment/${s.token}`, { id: 'A1', name: 'Dana', phone: '4795550101' });
    await s.post(`/api/hooks/deal/${s.token}`, { id: 'D1', name: 'Dana', phone: '4795550101' });
    expect(s.h.sms).toHaveLength(4);
    const log = (await s.store.getUserData(s.id)).approvalLog as { title: string; source: string }[];
    expect(log.filter((e) => e.title === 'ghl_send' && e.source === 'sop-gate')).toHaveLength(4);
    await s.app.close();
  });
});
