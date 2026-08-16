import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';

const ENV = ['RENDER', 'NODE_ENV', 'APP_URL'] as const;
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
beforeEach(() => { for (const k of ENV) delete process.env[k]; });
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const signup = async (app: ReturnType<typeof buildServer>, email = 'paul@example.com', password = 'password1') =>
  app.inject({ method: 'POST', url: '/auth/signup', payload: { email, password, tos: true } });

describe('sign-in throttling', () => {
  it('stops a password-guessing run against one account', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    await signup(app);
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) {
      const r = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'paul@example.com', password: 'wrong' } });
      codes.push(r.statusCode);
    }
    expect(codes).toContain(429); // it stops, rather than allowing every guess
    expect(codes.filter((c) => c === 401).length).toBeLessThanOrEqual(8);
    await app.close();
  });

  it('tells a locked-out person how long to wait, and how else to get in', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    await signup(app);
    let last = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'paul@example.com', password: 'x' } });
    for (let i = 0; i < 12 && last.statusCode !== 429; i++) {
      last = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'paul@example.com', password: 'x' } });
    }
    expect(last.statusCode).toBe(429);
    expect(last.headers['retry-after']).toBeDefined();
    expect(last.json().error).toMatch(/reset your password/i);
    await app.close();
  });

  it('throttles per account, so one target cannot lock everyone else out', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    await signup(app, 'victim@example.com');
    await signup(app, 'bystander@example.com', 'password2');
    for (let i = 0; i < 12; i++) {
      await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'victim@example.com', password: 'wrong' } });
    }
    const other = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'bystander@example.com', password: 'password2' } });
    expect(other.statusCode).toBe(200);
    await app.close();
  });
});

describe('security headers', () => {
  it('refuses to be framed — the app approves ad spend, clickjacking is not academic', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const res = await app.inject({ method: 'GET', url: '/login' });
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(String(res.headers['content-security-policy'])).toContain("frame-ancestors 'none'");
    await app.close();
  });

  it('sets the rest of the baseline', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const res = await app.inject({ method: 'GET', url: '/login' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    await app.close();
  });

  it('sends HSTS only where there is TLS to enforce', async () => {
    const plain = buildServer({ authStore: new MemoryStore() });
    expect((await plain.inject({ method: 'GET', url: '/login' })).headers['strict-transport-security']).toBeUndefined();
    await plain.close();

    process.env.RENDER = 'true';
    process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://unused';
    const hosted = buildServer({ authStore: new MemoryStore() });
    expect((await hosted.inject({ method: 'GET', url: '/login' })).headers['strict-transport-security']).toContain('max-age=');
    await hosted.close();
  });
});

describe('session cookie', () => {
  it('is HttpOnly and SameSite always, and Secure once served over TLS', async () => {
    const plain = buildServer({ authStore: new MemoryStore() });
    const local = String((await signup(plain)).headers['set-cookie']);
    expect(local).toContain('HttpOnly');
    expect(local).toContain('SameSite=Lax');
    expect(local).not.toContain('Secure'); // plain-HTTP dev: Secure would break sign-in
    await plain.close();

    process.env.RENDER = 'true';
    const hosted = buildServer({ authStore: new MemoryStore() });
    expect(String((await signup(hosted)).headers['set-cookie'])).toContain('Secure');
    await hosted.close();
  });
});

describe('not found and errors', () => {
  it('gives a browser a page, not a JSON blob', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const res = await app.inject({ method: 'GET', url: '/does-not-exist' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('Page not found');
    expect(res.body).toContain('Back to Miles');
    await app.close();
  });

  it('still gives API callers JSON, which is what they can parse', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Not found' });
    await app.close();
  });

  it('never leaks an internal message or route detail to the caller', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const res = await app.inject({ method: 'GET', url: '/does-not-exist' });
    expect(res.body).not.toMatch(/Route GET:/);
    expect(res.body).not.toMatch(/statusCode/);
    await app.close();
  });
});
