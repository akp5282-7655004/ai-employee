import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import { repairCampaignUrls, validateCampaignSpec, type CampaignSpec } from '../src/agents/campaign.js';
import type { Connector } from '../src/connectors/types.js';

const html = `<!doctype html><html><head><title>Painters In Philly</title>
<meta name="description" content="Interior and exterior house painting and cabinet painting in Philadelphia. Call 215-555-0199.">
</head><body>
<h2>HOUSE PAINTING</h2>
<h2>FREE CUSTOM QUOTE</h2>
<h2>Slide title</h2>
<h2>LOCATION</h2>
<h2>Interior painting</h2>
<h2>Exterior painting</h2>
<h2>Cabinet painting</h2>
<p>Licensed and insured. Monday 8am to 5pm.</p>
<a href="tel:215-555-0199">215-555-0199</a>
<a href="/interior-painting/">Interior painting</a>
<a href="/about-us/">About Us</a>
<a href="/contact/">Contact Us</a>
</body></html>`;

function appFor() {
  const calls: { op: string; budget?: number; finalUrl?: string; groupUrls?: string[]; status?: string; keywords?: string[] }[] = [];
  const connector = {
    name: 'mock',
    async createConnectToken() { return { token: 't', expiresAt: '2099-01-01', connectUrl: 'https://connect.example' }; },
    async listAccounts() { return [{ id: 'acct', app: 'google_ads', externalUserId: 'u', healthy: true }]; },
    async runAction() { return { ok: true, actionId: 'x', app: 'google_ads', output: null }; },
    async listAdTargets() { return [{ id: '9013698905', label: 'Painters' }]; },
    async launchCampaign(_id: string, spec: CampaignSpec) {
      calls.push({
        op: 'launch',
        budget: spec.dailyBudget,
        finalUrl: spec.finalUrl,
        groupUrls: spec.adGroups.map((g) => g.finalUrl || spec.finalUrl),
        keywords: spec.adGroups.flatMap((g) => [...g.keywords.map((k) => k.text), ...g.rsa.headlines, ...g.rsa.descriptions, g.name]),
        status: spec.status,
      });
      return {
        ok: true,
        live: false,
        campaignResource: 'customers/DEMO/campaigns/2',
        steps: [
          { step: 'Create daily budget ($20)', ok: true, resource: 'customers/DEMO/campaignBudgets/1' },
          { step: 'Create campaign "Painting" (PAUSED)', ok: true, resource: 'customers/DEMO/campaigns/2' },
          { step: 'Create ad group "Interior Painting"', ok: true, resource: 'customers/DEMO/adGroups/3' },
          { step: 'Add 3 keywords to "Interior Painting"', ok: true },
          { step: 'Create responsive search ad in "Interior Painting"', ok: true, resource: 'customers/DEMO/ads/8' },
        ],
      };
    },
    async setGoogleCampaignStatus(_id: string, args: { status: string }) {
      calls.push({ op: 'status', status: args.status });
      return { ok: true, live: false, called: true, note: 'Status set to ' + args.status, readback: { campaign: 'ENABLED', adGroups: ['ENABLED'], ads: ['ENABLED'], note: 'Read back from the account.' } };
    },
  } as unknown as Connector;
  return { app: buildServer({ authStore: new MemoryStore(), connector }), calls };
}

async function cookie(app: ReturnType<typeof buildServer>, email: string) {
  const r = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email, password: 'password1', tos: true } });
  return String(r.headers['set-cookie']).split(';')[0] ?? '';
}

describe('plan URLs come from the crawl', () => {
  it('repairs a saved plan that has labels where the URLs should be', () => {
    const broken = {
      name: 'Painting | Philadelphia | Search | Planned',
      dailyBudget: 20,
      biddingStrategy: 'MAXIMIZE_CLICKS' as const,
      networks: ['Google Search'],
      locations: ['Philadelphia'],
      language: 'English',
      finalUrl: '',
      adGroups: [
        { name: 'Interior Painting', keywords: [{ text: 'interior painting philadelphia', match: 'phrase' as const }], rsa: { headlines: ['Interior Painting', 'Local Crew', 'Book A Visit'], descriptions: ['Interior painting in Philadelphia.', 'Call to schedule a visit.'] } },
        { name: 'Exterior Painting', keywords: [{ text: 'exterior painting philadelphia', match: 'phrase' as const }], rsa: { headlines: ['Exterior Painting', 'Local Crew', 'Book A Visit'], descriptions: ['Exterior painting in Philadelphia.', 'Call to schedule a visit.'] } },
      ],
      negatives: ['free'],
      status: 'PAUSED' as const,
      sitelinks: [
        { text: 'Interior Painting', url: '' },
        { text: 'Exterior Painting', url: 'Exterior Painting' },
        { text: 'Request A Visit', url: '' },
        { text: 'About Us', url: '' },
        { text: 'Contact Us', url: '' },
      ],
    };
    const repaired = repairCampaignUrls(broken, {
      website: 'https://paintersinphilly.com/',
      links: [
        { href: 'https://paintersinphilly.com/interior-painting/', text: 'Interior painting' },
        { href: 'https://paintersinphilly.com/about-us/', text: 'About Us' },
        { href: 'https://paintersinphilly.com/contact/', text: 'Contact Us' },
      ],
    });
    expect(validateCampaignSpec(repaired)).toEqual([]);
    expect(repaired.finalUrl).toBe('https://paintersinphilly.com/');
    expect(repaired.adGroups.find((g) => g.name === 'Interior Painting')?.finalUrl).toBe('https://paintersinphilly.com/interior-painting/');
    expect(repaired.adGroups.find((g) => g.name === 'Exterior Painting')?.finalUrl).toBe('https://paintersinphilly.com/');
    expect(repaired.sitelinks?.map((s) => `${s.text} ${s.url}`)).toEqual([
      'Interior Painting https://paintersinphilly.com/interior-painting/',
      'About Us https://paintersinphilly.com/about-us/',
      'Contact Us https://paintersinphilly.com/contact/',
    ]);
    expect(repaired.sitelinks?.some((s) => !/^https:\/\//.test(s.url))).toBe(false);
  });

  it('automate creates the repaired plan at $20/day and enables it on the mock connector', async () => {
    const { app, calls } = appFor();
    const headers = { cookie: await cookie(app, 'urls-auto@example.com') };
    const crawled = await app.inject({ method: 'POST', url: '/api/miles/crawl', headers, payload: { businessName: 'Painters In Philly', location: 'Philadelphia, PA', website: 'paintersinphilly.com', html } });
    expect(crawled.json().profile.website).toBe('https://paintersinphilly.com/');
    const planned = await app.inject({ method: 'POST', url: '/api/miles/questions', headers, payload: { goal: 'get me leads', dailyBudget: 20, leadsPerDay: 1, mode: 'automate' } });
    const spec = planned.json().bundle.spec as CampaignSpec;
    expect(validateCampaignSpec(spec)).toEqual([]);
    expect(spec.dailyBudget).toBe(20);
    expect(spec.finalUrl).toBe('https://paintersinphilly.com/');
    const copy = spec.adGroups.flatMap((g) => [g.name, ...g.keywords.map((k) => k.text), ...g.rsa.headlines]).join(' ');
    expect(copy).not.toMatch(/free custom quote|slide title|\blocation\b/i);
    await app.inject({ method: 'POST', url: '/api/miles/tracking', headers, payload: { leadConversion: true, ga4Linked: true, method: 'thank_you' } });
    const started = await app.inject({ method: 'POST', url: '/api/miles/go', headers, payload: { confirm: true } });
    expect(started.statusCode).toBe(200);
    expect(started.json().created).toBe(true);
    expect(started.json().enabled).toBe(true);
    expect(calls.find((c) => c.op === 'launch')).toMatchObject({ budget: 20, finalUrl: 'https://paintersinphilly.com/', status: 'PAUSED' });
    expect(calls.find((c) => c.op === 'status')?.status).toBe('ENABLED');
  });

  it('repairs the live-style plan on load, then Start uses those URLs', async () => {
    const calls: { op: string; finalUrl?: string; status?: string }[] = [];
    const store = new MemoryStore();
    const connector = {
      name: 'mock',
      async createConnectToken() { return { token: 't', expiresAt: '2099-01-01', connectUrl: 'https://connect.example' }; },
      async listAccounts() { return [{ id: 'acct', app: 'google_ads', externalUserId: 'u', healthy: true }]; },
      async runAction() { return { ok: true, actionId: 'x', app: 'google_ads', output: null }; },
      async listAdTargets() { return [{ id: '9013698905', label: 'Painters' }]; },
      async launchCampaign(_id: string, spec: CampaignSpec) {
        calls.push({ op: 'launch', finalUrl: spec.finalUrl });
        return {
          ok: true, live: false, campaignResource: 'customers/DEMO/campaigns/2',
          steps: [
            { step: 'Create daily budget ($20)', ok: true, resource: 'customers/DEMO/campaignBudgets/1' },
            { step: 'Create campaign "Painting" (PAUSED)', ok: true, resource: 'customers/DEMO/campaigns/2' },
            { step: 'Create ad group "Interior Painting"', ok: true, resource: 'customers/DEMO/adGroups/3' },
            { step: 'Add 3 keywords to "Interior Painting"', ok: true },
            { step: 'Create responsive search ad in "Interior Painting"', ok: true, resource: 'customers/DEMO/ads/8' },
          ],
        };
      },
      async setGoogleCampaignStatus() { calls.push({ op: 'status', status: 'ENABLED' }); return { ok: true, live: false, called: true, note: 'ok', readback: { campaign: 'ENABLED', adGroups: ['ENABLED'], ads: ['ENABLED'], note: 'Read back from the account.' } }; },
    } as unknown as Connector;
    const app = buildServer({ authStore: store, connector });
    const headers = { cookie: await cookie(app, 'urls-repair@example.com') };
    const signed = await app.inject({ method: 'GET', url: '/auth/me', headers });
    const id = signed.json().user.id as string;
    await app.inject({ method: 'POST', url: '/api/miles/crawl', headers, payload: { businessName: 'Painters In Philly', location: 'Philadelphia, PA', website: 'https://paintersinphilly.com/', html } });
    await app.inject({ method: 'POST', url: '/api/miles/questions', headers, payload: { goal: 'get me leads', dailyBudget: 20, leadsPerDay: 1, mode: 'automate' } });
    const saved = await store.getUserData(id);
    const miles = saved.miles as { bundle: { spec: CampaignSpec } };
    miles.bundle.spec.finalUrl = '';
    miles.bundle.spec.sitelinks = [
      { text: 'Interior Painting', url: '' },
      { text: 'Exterior Painting', url: '' },
      { text: 'Request A Visit', url: '' },
      { text: 'About Us', url: '' },
      { text: 'Contact Us', url: '' },
    ];
    const loaded = await app.inject({ method: 'GET', url: '/api/miles/home', headers });
    expect(loaded.json().bundle.spec.finalUrl).toBe('https://paintersinphilly.com/');
    expect(validateCampaignSpec(loaded.json().bundle.spec)).toEqual([]);
    await app.inject({ method: 'POST', url: '/api/miles/tracking', headers, payload: { leadConversion: true, ga4Linked: true, method: 'thank_you' } });
    const started = await app.inject({ method: 'POST', url: '/api/miles/go', headers, payload: { confirm: true } });
    expect(started.statusCode).toBe(200);
    expect(calls.find((c) => c.op === 'launch')?.finalUrl).toBe('https://paintersinphilly.com/');
    expect(calls.find((c) => c.op === 'status')?.status).toBe('ENABLED');
  });

  it('hybrid queues and manual does nothing', async () => {
    const hybrid = appFor();
    const h = { cookie: await cookie(hybrid.app, 'urls-hybrid@example.com') };
    await hybrid.app.inject({ method: 'POST', url: '/api/miles/crawl', headers: h, payload: { businessName: 'Painters In Philly', location: 'Philadelphia, PA', website: 'https://paintersinphilly.com', html } });
    await hybrid.app.inject({ method: 'POST', url: '/api/miles/questions', headers: h, payload: { goal: 'get me leads', dailyBudget: 20, leadsPerDay: 1, mode: 'hybrid' } });
    const queued = await hybrid.app.inject({ method: 'POST', url: '/api/miles/go', headers: h, payload: { confirm: true } });
    expect(queued.json().created).toBe(false);
    expect(hybrid.calls).toEqual([]);
    const manual = appFor();
    const m = { cookie: await cookie(manual.app, 'urls-manual@example.com') };
    await manual.app.inject({ method: 'POST', url: '/api/miles/questions', headers: m, payload: { goal: 'get me leads', dailyBudget: 20, leadsPerDay: 1, mode: 'manual' } });
    const skipped = await manual.app.inject({ method: 'POST', url: '/api/miles/go', headers: m, payload: { confirm: true } });
    expect(skipped.json().created).toBe(false);
    expect(skipped.json().error || '').not.toMatch(/Sitelink/);
    expect(manual.calls).toEqual([]);
  });

  it('says to crawl when the website was never saved', async () => {
    const { app } = appFor();
    const headers = { cookie: await cookie(app, 'urls-missing@example.com') };
    await app.inject({ method: 'POST', url: '/api/miles/questions', headers, payload: { goal: 'get me leads', dailyBudget: 20, leadsPerDay: 1, mode: 'automate' } });
    const started = await app.inject({ method: 'POST', url: '/api/miles/go', headers, payload: { confirm: true } });
    expect(started.statusCode).toBe(400);
    expect(started.json().error).toMatch(/Crawl your website first/);
    expect(started.json().error).not.toMatch(/Sitelink/);
  });
});
