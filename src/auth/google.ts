/**
 * Sign in with Google — OpenID Connect authorization-code flow.
 *
 * One button does both jobs: an unknown email creates an account, a known one
 * signs in. That is deliberate. A separate "sign up with Google" and "sign in
 * with Google" is a distinction only the developer can see — the person just
 * wants in, and picking the wrong one produces a confusing error.
 *
 * On verifying the ID token: it is fetched by this server directly from
 * Google's token endpoint over TLS, so its origin is already established and
 * OIDC §3.1.3.7 does not require checking the signature. The claims still have
 * to be checked, and are: issuer, audience, expiry, and the nonce minted for
 * this specific attempt. Nothing here trusts a token handed to it by a browser.
 *
 * Configure with GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET. Without both, the
 * button is not shown and the routes report the feature as off — the same
 * honest-degradation rule the rest of the delivery layer follows.
 */

export interface GoogleIdentity {
  /** Google's stable account id. Never changes, unlike an email address. */
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
}

export function googleReady(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/** Where Google sends the browser back. Must match the Console entry exactly. */
export function googleRedirectUri(base: string): string {
  return `${base.replace(/\/$/, '')}/auth/google/callback`;
}

export function googleAuthUrl(opts: { base: string; state: string; nonce: string }): string {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? '',
    redirect_uri: googleRedirectUri(opts.base),
    response_type: 'code',
    scope: 'openid email profile',
    state: opts.state,
    nonce: opts.nonce,
    // Ask Google to show the picker rather than silently reusing whichever
    // account the browser happens to be signed into.
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

function decodeSegment(seg: string): Record<string, unknown> {
  const json = Buffer.from(seg.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  return JSON.parse(json) as Record<string, unknown>;
}

const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

/**
 * Read an ID token and check every claim that matters. Throws with a plain
 * reason rather than returning a half-trusted identity.
 */
export function parseIdToken(idToken: string, expect: { clientId: string; nonce: string; now?: number }): GoogleIdentity {
  const parts = idToken.split('.');
  if (parts.length !== 3 || !parts[1]) throw new Error('Malformed ID token.');
  let claims: Record<string, unknown>;
  try {
    claims = decodeSegment(parts[1]);
  } catch {
    throw new Error('Unreadable ID token.');
  }
  const now = Math.floor((expect.now ?? Date.now()) / 1000);
  if (!ISSUERS.has(String(claims.iss))) throw new Error('ID token was not issued by Google.');
  if (String(claims.aud) !== expect.clientId) throw new Error('ID token was issued for a different application.');
  if (typeof claims.exp !== 'number' || claims.exp <= now) throw new Error('ID token has expired.');
  // The nonce binds this token to the sign-in attempt that started in THIS
  // browser; without it a token captured elsewhere could be replayed here.
  if (String(claims.nonce) !== expect.nonce) throw new Error('ID token does not match this sign-in attempt.');
  const email = String(claims.email ?? '').toLowerCase();
  if (!email) throw new Error('Google did not return an email address.');
  return {
    sub: String(claims.sub ?? ''),
    email,
    // Google Workspace can issue accounts whose email is not verified. Treating
    // one as proof of ownership would let somebody take over an existing Miles
    // account by claiming its address, so the caller must refuse those.
    emailVerified: claims.email_verified === true || claims.email_verified === 'true',
    name: typeof claims.name === 'string' ? claims.name : undefined,
    picture: typeof claims.picture === 'string' ? claims.picture : undefined,
  };
}

/** Trade the one-time code for an ID token, then validate it. */
export async function exchangeCode(opts: { code: string; base: string; nonce: string }): Promise<GoogleIdentity> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Google sign-in is not configured.');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: opts.code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: googleRedirectUri(opts.base),
      grant_type: 'authorization_code',
    }).toString(),
  });
  if (!res.ok) throw new Error(`Google rejected the sign-in (${res.status}).`);
  const body = (await res.json()) as { id_token?: string };
  if (!body.id_token) throw new Error('Google did not return an ID token.');
  return parseIdToken(body.id_token, { clientId, nonce: opts.nonce });
}
