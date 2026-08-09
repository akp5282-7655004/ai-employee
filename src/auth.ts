import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/** Password hashing with Node's built-in scrypt — no external dependency. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const test = scryptSync(password, salt, 64);
  const orig = Buffer.from(hash, 'hex');
  return orig.length === test.length && timingSafeEqual(orig, test);
}

export const newToken = (): string => randomBytes(32).toString('hex');
export const newUserId = (): string => 'u_' + randomBytes(8).toString('hex');

/** Parse a Cookie header into a map. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
