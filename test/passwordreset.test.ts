import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import { RateLimiter } from '../src/ratelimit.js';

const ENV = ['APP_URL', 'RENDER_EXTERNAL_URL', 'RESEND_API_KEY'] as const;
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
beforeEach(() => { for (const k of ENV) delete process.env[k]; });
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

async function signedUp(store: MemoryStore) {
  const app = buildServer({ authStore: store });
  const res = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'paul@example.com', password: 'password1', tos: true } });
  expect(res.statusCode).toBe(200);
  return { app, cookie: res.headers['set-cookie'] as string };
}

describe('rate limiter', () => {
  it('allows up to the cap, then refuses with a retry hint', () => {
    const rl = new RateLimiter(3, 1000);
    expect(rl.check('a', 0).allowed).toBe(true);
    expect(rl.check('a', 10).allowed).toBe(true);
    expect(rl.check('a', 20).allowed).toBe(true);
    const blocked = rl.check('a', 30);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it('keeps separate counts per key and reopens after the window', () => {
    const rl = new RateLimiter(1, 1000);
    expect(rl.check('a', 0).allowed).toBe(true);
    expect(rl.check('b', 0).allowed).toBe(true); // different key, unaffected
    expect(rl.check('a', 500).allowed).toBe(false);
    expect(rl.check('a', 1500).allowed).toBe(true); // window rolled over
  });
});

describe('forgot password', () => {
  it('never reveals whether an email is registered', async () => {
    const { app } = await signedUp(new MemoryStore());
    const known = await app.inject({ method: 'POST', url: '/auth/forgot', payload: { email: 'paul@example.com' } });
    const unknown = await app.inject({ method: 'POST', url: '/auth/forgot', payload: { email: 'nobody@example.com' } });
    expect(known.statusCode).toBe(unknown.statusCode);
    expect(known.body).toBe(unknown.body);
    await app.close();
  });

  it('answers identically once throttled, so the limit cannot be used to probe', async () => {
    const { app } = await signedUp(new MemoryStore());
    const bodies = new Set<string>();
    for (let i = 0; i < 6; i++) {
      bodies.add((await app.inject({ method: 'POST', url: '/auth/forgot', payload: { email: 'paul@example.com' } })).body);
    }
    expect(bodies.size).toBe(1);
    await app.close();
  });

  it('refuses to mail a link built from a forged Host header', async () => {
    process.env.RESEND_API_KEY = 'test-key'; // delivery on
    const store = new MemoryStore();
    const { app } = await signedUp(store);
    const res = await app.inject({
      method: 'POST', url: '/auth/forgot',
      headers: { host: 'attacker.example' },
      payload: { email: 'paul@example.com' },
    });
    // No trusted base is configured, so nothing is sent and no token is minted —
    // a forged host must never receive a working reset link.
    expect(res.json().emailConfigured).toBe(false);
    const user = await store.getUserByEmail('paul@example.com');
    expect((await store.getUserData(user!.id)).resetToken).toBeUndefined();
    await app.close();
  });

  it('uses the configured address, not the request, when one is set', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    process.env.RENDER_EXTERNAL_URL = 'https://miles.example.com';
    const store = new MemoryStore();
    const { app } = await signedUp(store);
    const res = await app.inject({ method: 'POST', url: '/auth/forgot', headers: { host: 'attacker.example' }, payload: { email: 'paul@example.com' } });
    expect(res.json().emailConfigured).toBe(true);
    const user = await store.getUserByEmail('paul@example.com');
    expect((await store.getUserData(user!.id)).resetToken).toBeDefined();
    await app.close();
  });
});

describe('completing a reset', () => {
  // The base URL is read once when the server is built, so configure before that.
  beforeEach(() => {
    process.env.RENDER_EXTERNAL_URL = 'https://miles.example.com';
    process.env.RESEND_API_KEY = 'test-key';
  });

  /** Mint a real reset token the way the emailed link does. */
  async function tokenFor(store: MemoryStore, app: Awaited<ReturnType<typeof signedUp>>['app'], email: string) {
    await app.inject({ method: 'POST', url: '/auth/forgot', payload: { email } });
    const user = await store.getUserByEmail(email);
    const rt = (await store.getUserData(user!.id)).resetToken as { token: string } | undefined;
    if (!rt) throw new Error('no reset token was minted');
    return { uid: user!.id, token: rt.token };
  }

  it('signs every other device out, so a reset actually locks an intruder out', async () => {
    const store = new MemoryStore();
    const { app, cookie } = await signedUp(store);
    // The original session works before the reset.
    expect((await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } })).statusCode).toBe(200);

    const { uid, token } = await tokenFor(store, app, 'paul@example.com');
    const done = await app.inject({ method: 'POST', url: '/auth/reset', payload: { uid, token, password: 'brand-new-pw' } });
    expect(done.statusCode).toBe(200);

    // ...and is dead after it.
    expect((await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie } })).statusCode).toBe(401);
    await app.close();
  });

  it('burns the token — a reset link works exactly once', async () => {
    const store = new MemoryStore();
    const { app } = await signedUp(store);
    const { uid, token } = await tokenFor(store, app, 'paul@example.com');
    expect((await app.inject({ method: 'POST', url: '/auth/reset', payload: { uid, token, password: 'first-change' } })).statusCode).toBe(200);
    const replay = await app.inject({ method: 'POST', url: '/auth/reset', payload: { uid, token, password: 'second-change' } });
    expect(replay.statusCode).toBe(400);
    await app.close();
  });

  it('rejects a wrong token, and one of the wrong length', async () => {
    const store = new MemoryStore();
    const { app } = await signedUp(store);
    const { uid, token } = await tokenFor(store, app, 'paul@example.com');
    for (const bad of ['', 'short', token.slice(0, -1) + '0', token + 'x']) {
      const res = await app.inject({ method: 'POST', url: '/auth/reset', payload: { uid, token: bad, password: 'attempted-pw' } });
      expect(res.statusCode).toBe(400);
    }
    // The real one still works afterwards.
    expect((await app.inject({ method: 'POST', url: '/auth/reset', payload: { uid, token, password: 'real-change' } })).statusCode).toBe(200);
    await app.close();
  });

  it('the new password is the one that works', async () => {
    const store = new MemoryStore();
    const { app } = await signedUp(store);
    const { uid, token } = await tokenFor(store, app, 'paul@example.com');
    await app.inject({ method: 'POST', url: '/auth/reset', payload: { uid, token, password: 'the-new-one' } });
    const old = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'paul@example.com', password: 'password1' } });
    expect(old.statusCode).not.toBe(200);
    const fresh = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'paul@example.com', password: 'the-new-one' } });
    expect(fresh.statusCode).toBe(200);
    await app.close();
  });
});
