import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';

describe('dashboard v2', () => {
  it('keeps the full dashboard visible and names the mockup sections', () => {
    const html = readFileSync(join(process.cwd(), 'web', 'index.html'), 'utf8');
    expect(html).toContain('1 · Am I on track?');
    expect(html).toContain('2 · What Miles did for you');
    expect(html).toContain('3 · Miles recommends');
    expect(html).toContain('4 · Leads');
    expect(html).toContain('5 · Your numbers');
    expect(html).toContain('6 · How do I compare?');
    expect(html).toContain('7 · What is working?');
    expect(html).toContain('8 · Running for you');
    expect(html).toContain("card.id='dash-findings'");
    expect(html).toContain('Open Integrations');
    expect(html).toContain('renderOverview(d, miles, op, setup)');
  });

  it('returns the change log without running a new read', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const signup = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'dash@example.com', password: 'password1', name: 'Ada Owner', tos: true } });
    const cookie = String(signup.headers['set-cookie']).split(';')[0];
    const log = await app.inject({ method: 'GET', url: '/api/automation/log', headers: { cookie } });
    expect(log.statusCode).toBe(200);
    expect(Array.isArray(log.json().log)).toBe(true);
    expect(log.json().findings).toEqual([]);
    await app.close();
  });
});
