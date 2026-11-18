import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';

/**
 * Changing the sign-in email (checklist row 82).
 *
 * The address is where the password reset goes, so it is the account. These
 * tests hold the two promises that matter: nothing changes until the new
 * address proves it can receive mail, and nobody but the owner can start it.
 */
type Mail = { to: string; subject: string; text: string };
let mail: Mail[] = [];
const ENV = ['RESEND_API_KEY', 'APP_URL', 'SUPPORT_EMAIL'] as const;
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));

beforeEach(() => {
  process.env.RESEND_API_KEY = 're_test';
  process.env.APP_URL = 'https://miles.example.com';
  process.env.SUPPORT_EMAIL = 'help@miles.example.com';
  mail = [];
  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
    const url = String(typeof input === 'string' ? input : (input as { url?: string })?.url ?? input);
    if (url.includes('api.resend.com')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as { to?: string | string[]; subject?: string; text?: string };
      mail.push({ to: String(Array.isArray(body.to) ? body.to[0] : body.to), subject: String(body.subject), text: String(body.text) });
      return new Response(JSON.stringify({ id: 'email_1' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

const PASSWORD = 'Harbor-Lantern-42';
const cookieOf = (res: { headers: Record<string, unknown> }) => {
  const raw = res.headers['set-cookie'];
  return String((Array.isArray(raw) ? raw[0] : raw) ?? '').split(';')[0] ?? '';
};

async function account(email = 'owner@example.com') {
  const store = new MemoryStore();
  const app = buildServer({ authStore: store });
  const signup = (address: string) => app.inject({ method: 'POST', url: '/auth/signup', payload: { email: address, password: PASSWORD, tos: true } });
  const cookie = cookieOf(await signup(email));
  mail = []; // drop the sign-up emails
  const change = (body: unknown, as = cookie) =>
    app.inject({ method: 'POST', url: '/api/account/email', headers: { cookie: as, 'content-type': 'application/json' }, payload: JSON.stringify(body) });
  const login = (address: string) => app.inject({ method: 'POST', url: '/auth/login', payload: { email: address, password: PASSWORD } });
  const me = async (as = cookie) => app.inject({ method: 'GET', url: '/auth/me', headers: { cookie: as } });
  /** The path of the confirmation link in the last email sent to `to`. */
  const linkTo = (to: string) => {
    const sent = [...mail].reverse().find((m) => m.to === to && /auth\/email-change/.test(m.text));
    const url = sent?.text.match(/https:\/\/miles\.example\.com(\/auth\/email-change\?[^\s]+)/)?.[1];
    return url ?? '';
  };
  return { app, store, cookie, signup, change, login, me, linkTo };
}

describe('changing the sign-in email', () => {
  it('changes nothing until the new address opens its link, then switches over', async () => {
    const a = await account();
    const r = await a.change({ email: 'New.Owner@Example.com', password: PASSWORD });
    expect(r.statusCode).toBe(200);
    expect(r.json().note).toMatch(/stays owner@example\.com until you open it/);

    // Still the old address, on the account and at the door.
    expect((await a.me()).json().user.email).toBe('owner@example.com');
    expect((await a.login('owner@example.com')).statusCode).toBe(200);
    expect((await a.login('new.owner@example.com')).statusCode).toBe(401);

    // One email, to the new address only.
    expect(mail.map((m) => m.to)).toEqual(['new.owner@example.com']);
    const link = a.linkTo('new.owner@example.com');
    expect(link).toMatch(/^\/auth\/email-change\?uid=.+&token=.+/);

    const done = await a.app.inject({ method: 'GET', url: link });
    expect(done.statusCode).toBe(200);
    expect(done.body).toMatch(/Email changed/);

    expect((await a.login('new.owner@example.com')).statusCode).toBe(200);
    expect((await a.login('owner@example.com')).statusCode).toBe(401);
    // Every device signs in again.
    expect((await a.me()).statusCode).toBe(401);
    // And the old address is told, in case it was not the owner.
    const notice = mail.find((m) => m.to === 'owner@example.com');
    expect(notice?.subject).toMatch(/sign-in email was changed/);
    expect(notice?.text).toContain('help@miles.example.com');
    await a.app.close();
  });

  it('works once: the link cannot be replayed', async () => {
    const a = await account();
    await a.change({ email: 'second@example.com', password: PASSWORD });
    const link = a.linkTo('second@example.com');
    expect((await a.app.inject({ method: 'GET', url: link })).statusCode).toBe(200);
    const again = await a.app.inject({ method: 'GET', url: link });
    expect(again.statusCode).toBe(400);
    expect(again.body).toMatch(/This link expired/);
    await a.app.close();
  });

  it('needs the current password', async () => {
    const a = await account();
    for (const password of ['wrong-password', '', undefined]) {
      const r = await a.change({ email: 'thief@example.com', password });
      expect(r.statusCode).toBe(401);
      expect(r.json()).toMatchObject({ field: 'password' });
    }
    expect(mail).toEqual([]);
    expect((await a.me()).json().user.email).toBe('owner@example.com');
    await a.app.close();
  });

  it('refuses a malformed address and the address already in use', async () => {
    const a = await account();
    for (const email of ['not-an-email', '', 'two@@example.com']) {
      expect((await a.change({ email, password: PASSWORD })).statusCode, email).toBe(400);
    }
    expect((await a.change({ email: 'OWNER@example.com', password: PASSWORD })).statusCode).toBe(400);
    expect(mail).toEqual([]);
    await a.app.close();
  });

  it('does not reveal that another account has the address, and sends that address nothing', async () => {
    const a = await account();
    await a.signup('taken@example.com');
    mail = [];
    const r = await a.change({ email: 'taken@example.com', password: PASSWORD });
    expect(r.statusCode).toBe(200); // the same answer as for a free address
    expect(mail).toEqual([]);
    expect((await a.me()).json().user.email).toBe('owner@example.com');
    await a.app.close();
  });

  it('does not hand over an address someone registered after the link was sent', async () => {
    const a = await account();
    await a.change({ email: 'race@example.com', password: PASSWORD });
    const link = a.linkTo('race@example.com');
    await a.signup('race@example.com');
    const r = await a.app.inject({ method: 'GET', url: link });
    expect(r.statusCode).toBe(409);
    expect(r.body).toMatch(/still owner@example\.com/);
    expect((await a.login('owner@example.com')).statusCode).toBe(200);
    await a.app.close();
  });

  it('rejects a wrong or missing token and leaves the account alone', async () => {
    const a = await account();
    await a.change({ email: 'next@example.com', password: PASSWORD });
    const uid = (await a.me()).json().user.id as string;
    for (const url of [`/auth/email-change?uid=${uid}&token=wrong`, `/auth/email-change?uid=${uid}`, '/auth/email-change?uid=u_nope&token=x', '/auth/email-change']) {
      expect((await a.app.inject({ method: 'GET', url })).statusCode, url).toBe(400);
    }
    expect((await a.me()).json().user.email).toBe('owner@example.com');
    await a.app.close();
  });

  it('needs a signed-in owner', async () => {
    const a = await account();
    const r = await a.app.inject({ method: 'POST', url: '/api/account/email', payload: { email: 'x@example.com', password: PASSWORD } });
    expect(r.statusCode).toBe(401);
    await a.app.close();
  });

  it('says so, and changes nothing, when the server cannot send email', async () => {
    delete process.env.RESEND_API_KEY;
    const a = await account();
    const r = await a.change({ email: 'next@example.com', password: PASSWORD });
    expect(r.statusCode).toBe(503);
    expect(r.json().error).toMatch(/Nothing was changed/);
    await a.app.close();
  });

  it('stops after three requests in an hour', async () => {
    const a = await account();
    for (let i = 0; i < 3; i++) expect((await a.change({ email: `try${i}@example.com`, password: PASSWORD })).statusCode).toBe(200);
    expect((await a.change({ email: 'try4@example.com', password: PASSWORD })).statusCode).toBe(429);
    await a.app.close();
  });
});

describe('the Settings page around it', () => {
  const html = readFileSync('web/index.html', 'utf8');

  it('has the form, and keeps the current email read-only', () => {
    expect(html).toContain('id="set-email-new"');
    expect(html).toContain('id="set-email-pw"');
    expect(html).toContain("fetch('/api/account/email'");
    expect(html).toMatch(/<input id="set-email" disabled>/);
  });

  it('does not treat a wrong current password, or a Log out, as an expired session', () => {
    expect(html).toMatch(/\(login\|signup\|forgot\|reset\|change-password\)\|\\\/api\\\/account\\\/email/);
    expect(html).toContain('!window.__signingOut');
    expect(html).toContain('window.__signingOut=true;');
  });
});
