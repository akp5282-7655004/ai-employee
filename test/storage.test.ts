import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildServer } from '../src/server.js';
import { MemoryStore, makeStore, storageStatus, PostgresStore } from '../src/db/index.js';

const ENV_KEYS = ['DATABASE_URL', 'RENDER', 'NODE_ENV', 'ALLOW_EPHEMERAL_STORE'] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
const clear = () => { for (const k of ENV_KEYS) delete process.env[k]; };

describe('durable storage is not optional in production', () => {
  it('uses Postgres whenever DATABASE_URL is set', () => {
    clear();
    process.env.DATABASE_URL = 'postgres://user:pw@localhost:5432/miles';
    expect(makeStore()).toBeInstanceOf(PostgresStore);
  });

  it('refuses to start a hosted deploy with no database rather than eating accounts', () => {
    clear();
    process.env.RENDER = 'true';
    expect(() => makeStore()).toThrow(/DATABASE_URL/);
    // The message has to be actionable at 4am, not just correct.
    expect(() => makeStore()).toThrow(/Environment/);
  });

  it('treats NODE_ENV=production the same as Render', () => {
    clear();
    process.env.NODE_ENV = 'production';
    expect(() => makeStore()).toThrow(/DATABASE_URL/);
  });

  it('allows temporary storage when it is asked for explicitly', () => {
    clear();
    process.env.RENDER = 'true';
    process.env.ALLOW_EPHEMERAL_STORE = '1';
    expect(makeStore()).toBeInstanceOf(MemoryStore);
  });

  it('still runs on memory locally, where losing data costs nothing', () => {
    clear();
    expect(makeStore()).toBeInstanceOf(MemoryStore);
  });

  it('reports durability honestly for each store', () => {
    expect(storageStatus({ name: 'memory' })).toMatchObject({ durable: false });
    expect(storageStatus({ name: 'memory' }).note).toMatch(/erased/i);
    expect(storageStatus({ name: 'postgres' })).toMatchObject({ durable: true });
  });
});

describe('/api/storage', () => {
  it('answers without a session — the people who need it cannot sign in', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const res = await app.inject({ method: 'GET', url: '/api/storage' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ store: 'memory', durable: false });
    await app.close();
  });

  it('leaks nothing about any account', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'paul@example.com', password: 'password1', tos: true } });
    const body = (await app.inject({ method: 'GET', url: '/api/storage' })).body;
    expect(body).not.toMatch(/paul@example.com/);
    expect(Object.keys((await app.inject({ method: 'GET', url: '/api/storage' })).json())).toEqual(['store', 'durable', 'note']);
    await app.close();
  });
});

describe('the login form can be saved by a password manager', () => {
  const html = readFileSync(join(process.cwd(), 'web/login.html'), 'utf8');

  it('marks the identifier as a username, not an address', () => {
    // autocomplete="email" makes browsers treat the field as address autofill
    // and never pair it with the password — nothing is offered to save.
    expect(html).toMatch(/id="email"[^>]*autocomplete="username"/);
    expect(html).not.toMatch(/id="email"[^>]*autocomplete="email"/);
  });

  it('gives the credential fields name attributes', () => {
    expect(html).toMatch(/id="email"[^>]*name="username"/);
    expect(html).toMatch(/id="password"[^>]*name="password"/);
  });

  it('hands the credential to the password manager, since submit never navigates', () => {
    expect(html).toContain('navigator.credentials.store');
    expect(html).toContain('new PasswordCredential');
    // Called on the success path of both log in and sign up.
    expect(html).toMatch(/await saveCredential\(body\.email, body\.password/);
  });

  it('warns before signup when the server cannot keep the account', () => {
    expect(html).toContain("fetch('/api/storage')");
    expect(html).toMatch(/durable === false/);
  });
});
