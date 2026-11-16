import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import { parseBudget, toE164, sameBusiness, businessIdentity } from '../src/identity/fields.js';
import { maybeGrantLaunchCredit } from '../src/billing/launchcredit.js';
import { addLead, setLeadStatus } from '../src/crm/leads.js';
import { creditState } from '../src/billing/credits.js';

async function signedUp(app: ReturnType<typeof buildServer>, email: string) {
  const res = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email, password: 'password1', name: 'Owner', tos: true } });
  expect(res.statusCode).toBe(200);
  const cookie = String(res.headers['set-cookie']).split(';')[0];
  return cookie;
}

describe('field checks', () => {
  it('rejects a negative or absurd budget and keeps a normal one', () => {
    expect(parseBudget(-50).ok).toBe(false);
    expect(parseBudget(0).ok).toBe(false);
    expect(parseBudget(0, { allowZero: true })).toEqual({ ok: true, value: 0 });
    expect(parseBudget('  40 ')).toEqual({ ok: true, value: 40 });
    expect(parseBudget(5_000_000).ok).toBe(false);
  });

  it('turns a typed phone into E.164', () => {
    expect(toE164('  (215) 555-0148 ')).toEqual({ ok: true, value: '+12155550148' });
    expect(toE164('not a phone').ok).toBe(false);
  });
});

describe('launch credit', () => {
  it('holds $100 until three tools, then grants it once per business', () => {
    const first: Record<string, unknown> = { profile: { businessName: 'Philly Roofing', phone: '+12155550148', website: 'https://www.phillyroofing.com' } };
    expect(maybeGrantLaunchCredit(first, false, []).status).toBe('pending');
    expect(creditState(first).granted).toBe(0);
    expect(maybeGrantLaunchCredit(first, true, []).status).toBe('granted');
    expect(creditState(first).granted).toBe(100);
    const second: Record<string, unknown> = { profile: { businessName: 'Other Name', phone: '2155550148', website: '' } };
    const id = businessIdentity((first.profile ?? {}) as { website?: string; phone?: string; businessName?: string });
    const dup = maybeGrantLaunchCredit(second, true, [id]);
    expect(dup.status).toBe('duplicate');
    expect(creditState(second).granted).toBe(0);
    expect(sameBusiness(businessIdentity({ businessName: 'A' }), businessIdentity({ businessName: 'B' }))).toBe(false);
  });
});

describe('leads', () => {
  it('does not merge a different name on the same phone without confirmation', () => {
    const first = addLead([], { name: 'Ada', phone: '+12155550100' }, '2026-11-16T00:00:00.000Z');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const clash = addLead(first.leads, { name: 'Bea', phone: '+12155550100' }, '2026-11-16T00:00:00.000Z');
    expect(clash.ok).toBe(false);
    const confirmed = addLead(first.leads, { name: 'Bea', phone: '+12155550100', confirm: true }, '2026-11-16T00:00:00.000Z');
    expect(confirmed.ok && confirmed.leads).toHaveLength(2);
    if (!confirmed.ok || !confirmed.leads[0]) return;
    const lost = setLeadStatus(confirmed.leads, confirmed.leads[0].id, 'lost', '');
    expect(lost).toEqual({ error: 'Add a reason when a lead is lost.' });
  });
});

describe('account pages', () => {
  it('serves privacy, a friendly 404, and blocks a bad profile save', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const privacy = await app.inject({ method: 'GET', url: '/privacy' });
    expect(privacy.statusCode).toBe(200);
    expect(privacy.body).toContain('Google Ads');
    expect(privacy.body).toContain('Meta');
    expect(privacy.body).not.toContain('\u2014');
    const missing = await app.inject({ method: 'GET', url: '/no-such-page' });
    expect(missing.statusCode).toBe(404);
    expect(missing.body).toContain('Back to sign in');
    const cookie = await signedUp(app, 'owner@example.com');
    const bad = await app.inject({ method: 'PUT', url: '/api/profile', headers: { cookie }, payload: { dailyBudget: -20, phone: '(215) 555-0148' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().field).toBe('dailyBudget');
    const good = await app.inject({ method: 'PUT', url: '/api/profile', headers: { cookie }, payload: { dailyBudget: 40, phone: '(215) 555-0148', businessName: '  Roof Co  ' } });
    expect(good.statusCode).toBe(200);
    expect(good.json().profile.phone).toBe('+12155550148');
    expect(good.json().profile.businessName).toBe('Roof Co');
    expect(good.json().profile.dailyBudget).toBe(40);
    await app.close();
  });

  it('deletes only the signed-in account and refuses another user', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const a = await signedUp(app, 'a@example.com');
    const b = await signedUp(app, 'b@example.com');
    const remove = await app.inject({ method: 'POST', url: '/api/admin/remove', headers: { cookie: a }, payload: { id: 'someone' } });
    expect(remove.statusCode).toBe(403);
    const early = await app.inject({ method: 'POST', url: '/api/account/delete', headers: { cookie: a }, payload: { confirm: 'no' } });
    expect(early.statusCode).toBe(400);
    const gone = await app.inject({ method: 'POST', url: '/api/account/delete', headers: { cookie: a }, payload: { confirm: 'DELETE', id: 'not-me' } });
    expect(gone.statusCode).toBe(200);
    const me = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie: a } });
    expect(me.statusCode).toBe(401);
    const still = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie: b } });
    expect(still.statusCode).toBe(200);
    await app.close();
  });

  it('signs out other sessions when the password changes', async () => {
    const store = new MemoryStore();
    const app = buildServer({ authStore: store });
    const first = await signedUp(app, 'c@example.com');
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'c@example.com', password: 'password1' } });
    const second = String(login.headers['set-cookie']).split(';')[0];
    const changed = await app.inject({ method: 'POST', url: '/auth/change-password', headers: { cookie: first }, payload: { current: 'password1', next: 'password2' } });
    expect(changed.statusCode).toBe(200);
    const old = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie: second } });
    expect(old.statusCode).toBe(401);
    const kept = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie: String(changed.headers['set-cookie']).split(';')[0] } });
    expect(kept.statusCode).toBe(200);
    await app.close();
  });

  it('saves alert toggles and lead status on the account', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const cookie = await signedUp(app, 'd@example.com');
    const notes = await app.inject({ method: 'PUT', url: '/api/notifications', headers: { cookie }, payload: { leads: false, decisions: true, weekly: false, billing: true } });
    expect(notes.json().notify.leads).toBe(false);
    const lead = await app.inject({ method: 'POST', url: '/api/leads', headers: { cookie }, payload: { name: 'Ada', phone: '2155550100' } });
    expect(lead.statusCode).toBe(200);
    expect(lead.json().counts.new).toBe(1);
    const id = lead.json().leads[0].id;
    const lost = await app.inject({ method: 'POST', url: '/api/leads', headers: { cookie }, payload: { id, status: 'lost' } });
    expect(lost.statusCode).toBe(400);
    const booked = await app.inject({ method: 'POST', url: '/api/leads', headers: { cookie }, payload: { id, status: 'booked' } });
    expect(booked.json().counts.booked).toBe(1);
    await app.close();
  });
});
