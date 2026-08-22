import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/memory.js';

/**
 * Regression: signing in appeared to fail while the session was perfectly valid.
 *
 * '/' serves two different documents from one URL — the dashboard when signed in,
 * the login page when not. The onSend compression cache keyed encoded bodies on
 * the request path, so whichever document was compressed first was replayed to
 * every later caller of '/'. In practice an anonymous visitor populated the cache
 * with the login page, and from then on every signed-in load of '/' got the login
 * page back: correct cookie, correct session, login screen anyway — and enough
 * retries to trip the sign-in rate limiter.
 *
 * The request must be made with an accept-encoding the compressor acts on,
 * otherwise the caching path never runs and the test proves nothing.
 */
const GZIP = { 'accept-encoding': 'gzip' };

describe('the / document is not cached across sessions', () => {
  it('serves the dashboard to a signed-in caller after an anonymous caller primed the cache', async () => {
    const app = buildServer({ authStore: new MemoryStore() });

    // 1. Anonymous hit — this is what used to poison the cache under key '/'.
    const anon = await app.inject({ method: 'GET', url: '/', headers: GZIP });
    expect(anon.statusCode).toBe(200);

    // 2. Real account, real session.
    await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'paul@example.com', password: 'password1', tos: true } });
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'paul@example.com', password: 'password1' } });
    expect(login.statusCode).toBe(200);
    const cookie = String(login.headers['set-cookie']).split(';')[0];
    expect(cookie).toMatch(/^miles_session=/);

    // 3. The signed-in load of '/' must not be the anonymous body.
    const signedIn = await app.inject({ method: 'GET', url: '/', headers: { ...GZIP, cookie } });
    expect(signedIn.statusCode).toBe(200);
    expect(signedIn.rawPayload.equals(anon.rawPayload)).toBe(false);
  });

  it('marks / as uncacheable and varying on cookie', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const r = await app.inject({ method: 'GET', url: '/', headers: GZIP });
    expect(String(r.headers['cache-control'])).toContain('no-store');
    expect(String(r.headers['vary'])).toMatch(/cookie/i);
    // Compression still has to advertise itself.
    expect(String(r.headers['vary'])).toMatch(/accept-encoding/i);
  });
});
