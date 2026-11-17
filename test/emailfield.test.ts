import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import { parseEmail } from '../src/identity/fields.js';
import { normalizeLead } from '../src/agents/plumberloop.js';

describe('parseEmail', () => {
  it('accepts a normal address and a plus address', () => {
    expect(parseEmail(' You+Test@Gmail.com ')).toEqual({ ok: true, value: 'you+test@gmail.com' });
    expect(parseEmail('')).toEqual({ ok: true, value: '' });
    expect(parseEmail(undefined)).toEqual({ ok: true, value: '' });
  });

  it('rejects a missing @, a missing domain, and a required blank', () => {
    expect(parseEmail('not-an-email').ok).toBe(false);
    expect(parseEmail('ada@').ok).toBe(false);
    expect(parseEmail('ada@gmail').ok).toBe(false);
    expect(parseEmail('@gmail.com').ok).toBe(false);
    expect(parseEmail('ada @gmail.com').ok).toBe(false);
    expect(parseEmail('', { required: true }).ok).toBe(false);
  });
});

describe('email fields on the server', () => {
  it('rejects an invalid address on every route that stores or looks one up', async () => {
    const store = new MemoryStore();
    const app = buildServer({ authStore: store });
    const bad = { email: 'not-an-email', password: 'password1', tos: true };

    const signup = await app.inject({ method: 'POST', url: '/auth/signup', payload: bad });
    expect(signup.statusCode).toBe(400);
    expect(signup.json().field).toBe('email');
    expect(await store.getUserByEmail('not-an-email')).toBeNull();

    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'ada@', password: 'password1' } });
    expect(login.statusCode).toBe(400);
    expect(login.json().error).toMatch(/you@business.com/);

    const forgot = await app.inject({ method: 'POST', url: '/auth/forgot', payload: { email: 'nope' } });
    expect(forgot.statusCode).toBe(400);

    const resend = await app.inject({ method: 'POST', url: '/auth/confirm/resend', payload: { email: 'ada@gmail' } });
    expect(resend.statusCode).toBe(400);
    expect(resend.body).toMatch(/you@business.com/);

    const ok = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'owner@example.com', password: 'password1', name: 'Ada', tos: true } });
    expect(ok.statusCode).toBe(200);
    const cookie = String(ok.headers['set-cookie']).split(';')[0];

    const profile = await app.inject({ method: 'PUT', url: '/api/profile', headers: { cookie }, payload: { email: 'not an email' } });
    expect(profile.statusCode).toBe(400);
    expect(profile.json().field).toBe('email');

    const blank = await app.inject({ method: 'PUT', url: '/api/profile', headers: { cookie }, payload: { email: '' } });
    expect(blank.statusCode).toBe(200);

    const team = await app.inject({ method: 'PUT', url: '/api/team', headers: { cookie }, payload: { team: [{ email: 'boss@', role: 'Owner' }] } });
    expect(team.statusCode).toBe(400);

    const crawl = await app.inject({ method: 'POST', url: '/api/miles/crawl', headers: { cookie }, payload: { email: 'ada@gmail', businessName: 'Ada Painting' } });
    expect(crawl.statusCode).toBe(400);

    const compose = await app.inject({ method: 'POST', url: '/api/email/compose', headers: { cookie }, payload: { to: 'not-an-email', request: 'hello' } });
    expect(compose.statusCode).toBe(400);

    const send = await app.inject({ method: 'POST', url: '/api/email/send', headers: { cookie }, payload: { to: 'ada@gmail', subject: 'Hi', body: 'Hello', confirm: true } });
    expect(send.statusCode).toBe(400);

    expect(normalizeLead({ eventId: 'e1', name: 'Dana', email: 'dana@' }).error).toMatch(/you@business.com/);
    expect(normalizeLead({ eventId: 'e2', name: 'Dana', email: 'dana@example.com' }).lead?.email).toBe('dana@example.com');

    process.env.ADMIN_EMAIL = 'owner@example.com';
    process.env.ADMIN_RESET_SECRET = 'reset-secret';
    try {
      const invite = await app.inject({ method: 'POST', url: '/api/admin/invite', headers: { cookie }, payload: { email: 'not-an-email' } });
      expect(invite.statusCode).toBe(400);
      const settings = await app.inject({ method: 'PUT', url: '/api/admin/settings', headers: { cookie }, payload: { allowed: ['ok@example.com', 'bad'] } });
      expect(settings.statusCode).toBe(400);
      const emergency = await app.inject({ method: 'GET', url: '/admin/emergency-reset?secret=reset-secret&email=not-an-email&password=password1' });
      expect(emergency.statusCode).toBe(400);
    } finally {
      delete process.env.ADMIN_EMAIL;
      delete process.env.ADMIN_RESET_SECRET;
    }

    await app.close();
  });

  it('still accepts a plus address at signup', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const res = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'you+test@gmail.com', password: 'password1', tos: true } });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe('you+test@gmail.com');
    await app.close();
  });
});
