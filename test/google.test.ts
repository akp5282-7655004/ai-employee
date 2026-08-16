import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { googleAuthUrl, googleReady, googleRedirectUri, parseIdToken } from '../src/auth/google.js';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';

const ENV = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'APP_URL', 'RENDER_EXTERNAL_URL'] as const;
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
beforeEach(() => { for (const k of ENV) delete process.env[k]; });
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const CLIENT = 'client-123.apps.googleusercontent.com';
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
/** An ID token shaped exactly like Google's, for claim-checking. */
const token = (claims: Record<string, unknown>) =>
  `${b64({ alg: 'RS256' })}.${b64({
    iss: 'https://accounts.google.com', aud: CLIENT, sub: '10769150350006150715',
    email: 'paul@example.com', email_verified: true, name: 'Akhil Paul',
    exp: Math.floor(Date.now() / 1000) + 3600, nonce: 'the-nonce', ...claims,
  })}.signature`;

const OK = { clientId: CLIENT, nonce: 'the-nonce' };

describe('Google ID token claims', () => {
  it('accepts a well-formed token and reads the identity', () => {
    const who = parseIdToken(token({}), OK);
    expect(who).toMatchObject({ email: 'paul@example.com', emailVerified: true, sub: '10769150350006150715', name: 'Akhil Paul' });
  });

  it('rejects a token issued for a different application', () => {
    expect(() => parseIdToken(token({ aud: 'someone-elses-client' }), OK)).toThrow(/different application/);
  });

  it('rejects a token that did not come from Google', () => {
    expect(() => parseIdToken(token({ iss: 'https://evil.example' }), OK)).toThrow(/not issued by Google/);
  });

  it('rejects an expired token', () => {
    expect(() => parseIdToken(token({ exp: Math.floor(Date.now() / 1000) - 10 }), OK)).toThrow(/expired/);
  });

  it('rejects a token minted for a different sign-in attempt (replay)', () => {
    expect(() => parseIdToken(token({ nonce: 'someone-elses-nonce' }), OK)).toThrow(/does not match this sign-in/);
  });

  it('reports an unverified email as unverified rather than quietly trusting it', () => {
    expect(parseIdToken(token({ email_verified: false }), OK).emailVerified).toBe(false);
  });

  it('refuses malformed input instead of half-reading it', () => {
    for (const bad of ['', 'not-a-jwt', 'a.b', `${b64({})}.%%%.sig`]) {
      expect(() => parseIdToken(bad, OK)).toThrow();
    }
  });

  it('lowercases the email, so linking cannot be dodged with capitals', () => {
    expect(parseIdToken(token({ email: 'Paul@Example.COM' }), OK).email).toBe('paul@example.com');
  });
});

describe('Google configuration', () => {
  it('is off until both halves of the credential are present', () => {
    expect(googleReady()).toBe(false);
    process.env.GOOGLE_CLIENT_ID = CLIENT;
    expect(googleReady()).toBe(false); // id alone is not enough
    process.env.GOOGLE_CLIENT_SECRET = 'shh';
    expect(googleReady()).toBe(true);
  });

  it('builds the consent URL with the claims the callback will check', () => {
    process.env.GOOGLE_CLIENT_ID = CLIENT;
    const url = new URL(googleAuthUrl({ base: 'https://miles.example.com', state: 'st', nonce: 'no' }));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('state')).toBe('st');
    expect(url.searchParams.get('nonce')).toBe('no');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toContain('email');
    expect(url.searchParams.get('redirect_uri')).toBe('https://miles.example.com/auth/google/callback');
  });

  it('derives one redirect URI, trailing slash or not', () => {
    expect(googleRedirectUri('https://x.com/')).toBe('https://x.com/auth/google/callback');
    expect(googleRedirectUri('https://x.com')).toBe('https://x.com/auth/google/callback');
  });
});

describe('the sign-in routes', () => {
  const configured = () => {
    process.env.GOOGLE_CLIENT_ID = CLIENT;
    process.env.GOOGLE_CLIENT_SECRET = 'shh';
    process.env.RENDER_EXTERNAL_URL = 'https://miles.example.com';
    return buildServer({ authStore: new MemoryStore() });
  };

  it('hides the button until Google is configured', async () => {
    const off = buildServer({ authStore: new MemoryStore() });
    expect((await off.inject({ method: 'GET', url: '/auth/providers' })).json()).toEqual({ google: false });
    await off.close();
    const on = configured();
    expect((await on.inject({ method: 'GET', url: '/auth/providers' })).json()).toEqual({ google: true });
    await on.close();
  });

  it('sends an unconfigured server back with a reason instead of to Google', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const res = await app.inject({ method: 'GET', url: '/auth/google' });
    expect(res.headers.location).toBe('/login?error=google_off');
    await app.close();
  });

  it('starts the flow with a one-shot state cookie', async () => {
    const app = configured();
    const res = await app.inject({ method: 'GET', url: '/auth/google' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('accounts.google.com');
    const c = String(res.headers['set-cookie']);
    expect(c).toContain('miles_oauth=');
    expect(c).toContain('HttpOnly');
    expect(c).toContain('SameSite=Lax'); // Strict would be withheld on the return trip
    await app.close();
  });

  it('refuses a callback with no state cookie — the CSRF case', async () => {
    const app = configured();
    const res = await app.inject({ method: 'GET', url: '/auth/google/callback?code=abc&state=whatever' });
    expect(res.headers.location).toBe('/login?error=google_state');
    await app.close();
  });

  it('refuses a callback whose state does not match the cookie', async () => {
    const app = configured();
    const start = await app.inject({ method: 'GET', url: '/auth/google' });
    const cookie = String(start.headers['set-cookie']).split(';')[0]!;
    const res = await app.inject({ method: 'GET', url: '/auth/google/callback?code=abc&state=forged', headers: { cookie } });
    expect(res.headers.location).toBe('/login?error=google_state');
    await app.close();
  });

  it('reports a cancelled consent screen as cancelled, not as a failure', async () => {
    const app = configured();
    const res = await app.inject({ method: 'GET', url: '/auth/google/callback?error=access_denied' });
    expect(res.headers.location).toBe('/login?error=google_cancelled');
    await app.close();
  });
});
