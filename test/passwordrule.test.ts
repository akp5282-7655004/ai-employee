import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';

/**
 * Sign-up asks for 8 characters and refuses the most common passwords. The
 * reset link and the Settings form asked for 6 and refused nothing, so an
 * owner could step down to a password a new account is not allowed to pick.
 */
const cookieOf = (res: { headers: Record<string, unknown> }) => {
  const raw = res.headers['set-cookie'];
  return String((Array.isArray(raw) ? raw[0] : raw) ?? '').split(';')[0] ?? '';
};

describe('one password rule everywhere', () => {
  it('Settings refuses a new password that sign-up would refuse', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const cookie = cookieOf(await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'rule@example.com', password: 'Harbor-Lantern-42', tos: true } }));
    const change = (next: unknown) => app.inject({ method: 'POST', url: '/auth/change-password', headers: { cookie }, payload: { current: 'Harbor-Lantern-42', next } });
    for (const weak of ['short7!', 'password', 'aaaaaaaaaa', '', undefined]) {
      const r = await change(weak);
      expect(r.statusCode, String(weak)).toBe(400);
      expect(r.json()).toMatchObject({ field: 'password' });
    }
    // Still the old password: nothing was changed by the refusals.
    expect((await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'rule@example.com', password: 'Harbor-Lantern-42' } })).statusCode).toBe(200);
    expect((await change('Meadow-Kettle-77')).statusCode).toBe(200);
    await app.close();
  });

  it('the reset link refuses one too, before looking at the link', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    for (const weak of ['sixsix', 'password123', '']) {
      const r = await app.inject({ method: 'POST', url: '/auth/reset', payload: { uid: 'u_any', token: 'any', password: weak } });
      expect(r.statusCode, weak).toBe(400);
      expect(r.json()).toMatchObject({ field: 'password' });
    }
    await app.close();
  });

  it('the Settings form states the real minimum', () => {
    const html = readFileSync('web/index.html', 'utf8');
    expect(html).toContain('at least 8 characters');
    expect(html).not.toContain('at least 6 characters');
  });
});
