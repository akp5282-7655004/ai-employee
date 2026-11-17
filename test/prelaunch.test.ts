import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';

/**
 * Found by running the pre-launch checklist against the live site on
 * 2026-11-17. Each of these was something a first customer would have hit.
 */
const signup = (app: ReturnType<typeof buildServer>, body: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/auth/signup', payload: { password: 'password1', tos: true, ...body } });
const text = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('sign-up refuses an address that could never receive a reset', () => {
  it('rejects malformed emails posted straight to the server', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    for (const email of ['not-an-email', ' spaced @example .com', 'a@b', '@example.com', 'x@', 'two@@example.com', `${'x'.repeat(250)}@example.com`]) {
      const r = await signup(app, { email });
      expect(r.statusCode, email).toBe(400);
      expect(r.json()).toMatchObject({ field: 'email' });
    }
    await app.close();
  });

  it('accepts real addresses, including plus tags and surrounding spaces', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    for (const email of ['owner@example.com', 'owner+test@example.co.uk', '  padded@example.com  ', "o'brien@example.com"]) {
      expect((await signup(app, { email })).statusCode, email).toBe(200);
    }
    // The padded address is stored trimmed, so it cannot be registered twice.
    expect((await signup(app, { email: 'padded@example.com' })).statusCode).toBe(409);
    await app.close();
  });
});

describe('the public legal pages are fit to be read by a customer', () => {
  const ENV = ['LEGAL_ENTITY', 'LEGAL_GOVERNING_LAW'] as const;
  const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  afterEach(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

  it('shows no drafting notes, blanks or raw markup on the terms page', async () => {
    delete process.env.LEGAL_ENTITY; delete process.env.LEGAL_GOVERNING_LAW;
    const app = buildServer({ authStore: new MemoryStore() });
    const r = await app.inject({ method: 'GET', url: '/terms' });
    expect(r.statusCode).toBe(200);
    const t = text(r.body);
    expect(t).toMatch(/Miles AI Terms of Service/);
    expect(t).toMatch(/Limitation of liability/);
    expect(t).not.toMatch(/\[[A-Z][^\]]*\]|\{\{|draft|lawyer|⚖|🤖|Build-side|Companion documents|\*\*|^#|\s#\s/i);
    expect(r.body).toContain('<h2>');
    await app.close();
  });

  it('names the company and the governing law once the operator sets them', async () => {
    process.env.LEGAL_ENTITY = 'Example Software LLC';
    process.env.LEGAL_GOVERNING_LAW = 'the laws of the State of Arkansas.';
    const app = buildServer({ authStore: new MemoryStore() });
    const t = text((await app.inject({ method: 'GET', url: '/terms' })).body);
    expect(t).toContain('Example Software LLC');
    expect(t).toContain('the laws of the State of Arkansas.');
    await app.close();
  });

  it('keeps the customer copy free of the notes that stay in the working draft', () => {
    const copy = readFileSync('docs/legal/terms-of-service.md', 'utf8');
    expect(copy).not.toMatch(/⚖|🤖|lawyer|Draft/);
    expect(copy.match(/\{\{[A-Z_]+\}\}/g)).toEqual(['{{VERSION}}', '{{ENTITY}}', '{{GOVERNING_LAW}}']);
  });

  it('states Google Limited Use on the privacy page, which app verification requires', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const t = text((await app.inject({ method: 'GET', url: '/privacy' })).body);
    expect(t).toMatch(/Google API Services User Data Policy/);
    expect(t).toMatch(/Limited Use/);
    expect(t).toMatch(/Delete your account/);
    await app.close();
  });
});

describe('bad input gets a clear answer, not a server error', () => {
  const account = async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const cookie = String((await signup(app, { email: 'o@example.com', name: 'Owner Name' })).headers['set-cookie']).split(';')[0]!;
    return { app, cookie };
  };

  it('answers malformed JSON with 400', async () => {
    const { app, cookie } = await account();
    const r = await app.inject({ method: 'PUT', url: '/api/profile', headers: { cookie, 'content-type': 'application/json' }, payload: '{"broken' });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatch(/not valid JSON/);
    await app.close();
  });

  it('does not erase the account name when a save carries none', async () => {
    const { app, cookie } = await account();
    const r = await app.inject({ method: 'PUT', url: '/api/account', headers: { cookie }, payload: { email: 'other@example.com' } });
    expect(r.statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } })).json().user.name).toBe('Owner Name');
    expect((await app.inject({ method: 'PUT', url: '/api/account', headers: { cookie }, payload: { name: '  New Name ' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } })).json().user.name).toBe('New Name');
    await app.close();
  });

  it('refuses to save an incomplete campaign draft', async () => {
    const { app, cookie } = await account();
    for (const spec of [{ kind: 'copy' }, { name: 'x' }, { name: 'x', adGroups: [{}] }]) {
      const r = await app.inject({ method: 'POST', url: '/api/campaign/drafts', headers: { cookie }, payload: { spec } });
      expect(r.statusCode).toBe(400);
    }
    await app.close();
  });
});

describe('empty values on the page read as empty, not as a stray comma', () => {
  it('has no comma used as a placeholder', () => {
    const html = readFileSync('web/index.html', 'utf8');
    const offenders = html.split('\n').filter((line) => /(\|\||[?:]) ?', ' *[)\];]/.test(line)).map((line) => line.trim().slice(0, 120));
    expect(offenders).toEqual([]);
    expect(html).toContain("o||'Select...'");
  });
});
