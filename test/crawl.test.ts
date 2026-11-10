import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import type { Connector } from '../src/connectors/types.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const page = '<html><head><title>Painters In Philly</title></head><body><h2>Interior painting</h2><p>Exterior painting in Philadelphia.</p><a href="tel:215-555-0199">215-555-0199</a></body></html>';

function app() {
  const connector = {
    name: 'mock',
    async createConnectToken() { return { token: 't', expiresAt: '2099-01-01', connectUrl: 'https://connect.example' }; },
    async listAccounts() { return []; },
    async runAction() { return { ok: false, actionId: 'x', app: 'google_ads', output: null }; },
  } as unknown as Connector;
  return buildServer({ authStore: new MemoryStore(), connector });
}

async function cookie(server: ReturnType<typeof buildServer>, email: string) {
  const r = await server.inject({ method: 'POST', url: '/auth/signup', payload: { email, password: 'password1', tos: true } });
  return String(r.headers['set-cookie']).split(';')[0] ?? '';
}

describe('crawl uses the saved website and reports fetch failures', () => {
  it('fetches the saved profile website when the form sends a blank one', async () => {
    const server = app();
    const headers = { cookie: await cookie(server, 'crawl-fallback@example.com') };
    await server.inject({ method: 'PUT', url: '/api/profile', headers, payload: { website: 'https://paintersinphilly.com', businessName: 'Painters In Philly', serviceAreas: 'Philadelphia, PA', email: 'owner@example.com', gbpUrl: 'https://maps.example/gbp', competitors: 'https://other.example' } });
    const seen: { url: string; ua: string; redirect: string } = { url: '', ua: '', redirect: '' };
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      seen.url = String(url);
      seen.ua = String((init?.headers as Record<string, string>)['user-agent'] || '');
      seen.redirect = String(init?.redirect || '');
      return new Response(page, { status: 200 });
    }) as typeof fetch;
    const crawled = await server.inject({ method: 'POST', url: '/api/miles/crawl', headers, payload: { website: '', businessName: '', location: '', email: '', gbpUrl: '', competitors: [] } });
    expect(crawled.statusCode).toBe(200);
    expect(seen.url).toBe('https://paintersinphilly.com');
    expect(seen.redirect).toBe('follow');
    expect(seen.ua).toMatch(/Mozilla/);
    const body = crawled.json();
    expect(body.found.pagesRead).toBe(1);
    expect(body.found.businessName).toMatch(/Painters/);
    expect(body.found.phone).toMatch(/215/);
    expect(body.found.services).toMatch(/Interior/);
    expect(body.audits[0].summary).toMatch(/Score/);
    expect(body.profile.website).toBe('https://paintersinphilly.com');
    expect(body.profile.gbpUrl).toBe('https://maps.example/gbp');
    const home = await server.inject({ method: 'GET', url: '/api/miles/home', headers });
    expect(home.json().profile.website).toBe('https://paintersinphilly.com');
    expect(home.json().profile.businessName).toMatch(/Painters/);
    expect(home.json().found.pagesRead).toBe(1);
    expect(home.json().phase).toBe('questions');
  });

  it('reports a timeout instead of a generic empty audit', async () => {
    const server = app();
    const headers = { cookie: await cookie(server, 'crawl-timeout@example.com') };
    globalThis.fetch = (async () => {
      const err = new Error('The operation was aborted due to timeout');
      err.name = 'TimeoutError';
      throw err;
    }) as typeof fetch;
    const crawled = await server.inject({ method: 'POST', url: '/api/miles/crawl', headers, payload: { website: 'https://paintersinphilly.com' } });
    expect(crawled.statusCode).toBe(200);
    expect(crawled.json().found.pagesRead).toBe(0);
    expect(crawled.json().audits[0].summary).toMatch(/timed out after 10 seconds/);
    expect(crawled.json().audits[0].summary).not.toMatch(/Paste a website/);
  });

  it('reports the HTTP status when the site refuses the page', async () => {
    const server = app();
    const headers = { cookie: await cookie(server, 'crawl-status@example.com') };
    globalThis.fetch = (async () => new Response('no', { status: 403 })) as typeof fetch;
    const crawled = await server.inject({ method: 'POST', url: '/api/miles/crawl', headers, payload: { website: 'paintersinphilly.com' } });
    expect(crawled.json().audits[0].summary).toMatch(/HTTP 403/);
    expect(crawled.json().found.fetchNote).toMatch(/https:\/\/paintersinphilly.com/);
  });
});
