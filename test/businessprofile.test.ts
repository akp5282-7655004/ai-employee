import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import type { Connector } from '../src/connectors/types.js';
import {
  buildBusinessProfile,
  businessCopy,
  type BusinessProfileInput,
  type BusinessProfileView,
} from '../src/profile/business.js';

function input(over: Partial<BusinessProfileInput> = {}): BusinessProfileInput {
  return {
    profile: {},
    brand: {},
    photos: [],
    caps: null,
    profileDaily: null,
    goal: '',
    hasBundle: false,
    leadsPerDay: null,
    mode: null,
    paused: false,
    market: '',
    found: null,
    crawlFound: {},
    websiteAudit: null,
    google: { oauth: false, ready: false, note: '' },
    ghlConnected: false,
    ghlDetail: 'GoHighLevel is not connected. Replies stay drafts. Connect it under Integrations.',
    gbpConnected: false,
    facebookConnected: false,
    instagramConnected: false,
    linkedinConnected: false,
    ...over,
  };
}

function field(view: BusinessProfileView, id: string) {
  for (const section of view.sections) {
    const hit = section.fields.find((f) => f.id === id);
    if (hit) return hit;
  }
  throw new Error(`missing field ${id}`);
}

function section(view: BusinessProfileView, id: string) {
  const hit = view.sections.find((s) => s.id === id);
  if (!hit) throw new Error(`missing section ${id}`);
  return hit;
}

const painter = input({
  profile: {
    businessName: 'Painters In Philly',
    industry: 'Painting',
    phone: '267-333-2939',
    email: 'paul@paintersinphilly.com',
    website: 'https://paintersinphilly.com',
    description: 'Interior and exterior painting across Philadelphia. Residential and commercial.',
    city: 'Philadelphia',
    state: 'PA',
    zip: '19149',
    serviceAreas: 'Philadelphia, PA',
    services: 'House painting, Interior painting, Exterior painting',
    avgTicket: '2500',
    goal: 'More calls & leads',
    targetCpa: '50',
    idealCustomer: 'Homeowners in Philadelphia',
    runningAds: 'None yet',
    gbpUrl: 'https://maps.example/painters',
    facebook: 'https://facebook.com/paintersinphilly',
    instagram: 'https://instagram.com/painters_in_philly',
  },
  brand: {
    logoUrl: 'https://example.com/logo.png',
    colors: ['#1f8a6e', '#111111'],
    voice: 'Local & trustworthy',
    audience: 'Homeowners in Philadelphia',
    fonts: 'Poppins',
    avoid: 'no emojis',
  },
  caps: { dailyBudget: 20, monthlyCeiling: 600, maxChangePct: 10, paused: false },
  hasBundle: true,
  goal: 'More calls & leads',
  leadsPerDay: 1,
  mode: 'automate',
  market: 'Philadelphia',
  found: {
    pagesRead: 1,
    businessName: 'Painters In Philly',
    phone: '267-333-2939',
    services: 'House painting',
    website: 'https://paintersinphilly.com',
    crawledAt: '2026-11-09T15:00:00.000Z',
  },
  crawlFound: { logo: 'https://example.com/logo.png', brandColors: '#1f8a6e' },
});

describe('business profile completeness', () => {
  it('counts only real empty fields and does not hardcode 72 percent', () => {
    const empty = buildBusinessProfile(input());
    expect(empty.percent).toBe(0);
    expect(empty.filledCount).toBe(0);
    expect(empty.percent).toBe(Math.round((100 * empty.filledCount) / empty.totalCount));
    expect(empty.missingChips).toEqual([
      'Most profitable jobs',
      'Current offer',
      'Main competitors',
      'Tagline',
      'Job photos',
      'Year founded',
      'Business name',
      'Trade',
      'Phone',
      'Website',
      'Service area',
      'Services',
      'Goal',
      'Daily budget',
      'Leads you want',
    ]);
    expect(empty.missingChips).not.toContain('Email');
    expect(field(empty, 'dailyBudget').value).toBe('');
    expect(field(empty, 'fonts').value).toBe('');
    expect(field(empty, 'fonts').hint).not.toMatch(/Matched to your website/);
    expect(field(empty, 'avoid').value).toBe('');
    expect(field(empty, 'audience').value).toBe('');
    expect(empty.websiteCheck.score).toBeNull();
    expect(empty.websiteCheck.line).not.toMatch(/80/);
    expect(empty.preview.offer).toBe('');
    expect(JSON.stringify(empty.preview)).not.toMatch(/Winter Interiors|Special Offer/);

    const view = buildBusinessProfile(painter);
    expect(view.missingChips).toEqual([
      'Most profitable jobs',
      'Current offer',
      'Main competitors',
      'Tagline',
      'Job photos',
      'Year founded',
    ]);
    expect(view.percent).toBe(Math.round((100 * view.filledCount) / view.totalCount));
    expect(view.percent).not.toBe(72);
    expect(view.percent).toBeGreaterThan(0);
    expect(view.percent).toBeLessThan(100);
    expect(section(view, 'basics').badge).toBe('1 to add');
    expect(section(view, 'basics').emptyCount).toBe(1);
    expect(section(view, 'brand').badge).toBe('1 to add');
    expect(section(view, 'work').badge).toBe('2 to add');
    expect(section(view, 'goals').badge).toBe('Complete');
    expect(section(view, 'photos').badge).toBe('1 to add');
    expect(section(view, 'presence').badge).toBe('1 to add');
    for (const sec of view.sections) {
      expect(sec.badge).toBe(sec.emptyCount === 0 ? 'Complete' : `${sec.emptyCount} to add`);
    }
    expect(field(view, 'dailyBudget').value).toBe('$20/day · $600/mo');
    expect(field(view, 'yearStarted').filled).toBe(false);
    expect(field(view, 'businessName').filled).toBe(true);
    expect(view.websiteRead.lastRead).toBe('Nov 9');
    expect(view.websiteRead.found).toEqual(['name', 'phone', 'services', 'logo', 'colors']);
    expect(view.websiteRead.host).toBe('paintersinphilly.com');
    expect(view.setupLine).toMatch(/Painting/);
    expect(view.setupLine).toMatch(/Philadelphia/);
    expect(view.setupLine).toMatch(/\$20\/day/);
    expect(view.setupLine).toMatch(/10% max daily change/);
  });

  it('does not turn a service area into a talk-to line or a saved year', () => {
    const view = buildBusinessProfile(input({ profile: { serviceAreas: 'Philadelphia, PA' } }));
    expect(field(view, 'audience').filled).toBe(false);
    expect(field(view, 'audience').value).toBe('');
    expect(field(view, 'yearStarted').value).toBe('');
    expect(field(view, 'serviceAreas').filled).toBe(true);
    expect(view.missingChips).not.toContain('Service area');
    expect(view.missingChips).toContain('Year founded');
  });

  it('shows a saved cap and hides the daily chip once that cap exists', () => {
    const saved = buildBusinessProfile(input({
      caps: { dailyBudget: 20, monthlyCeiling: 600, maxChangePct: 10, paused: false },
      profile: { businessName: 'Painters In Philly' },
    }));
    expect(field(saved, 'dailyBudget').value).toBe('$20/day · $600/mo');
    expect(saved.missingChips).not.toContain('Daily budget');
    expect(field(saved, 'dailyBudget').value).not.toMatch(/SAMPLE/);
  });
});

describe('business profile honesty', () => {
  it('keeps connection pills and the website score on real status', () => {
    const empty = buildBusinessProfile(input());
    expect(empty.accounts.google).toEqual({ pill: 'Not connected', detail: 'Not connected.', fix: false, connect: true });
    expect(empty.accounts.ghl.pill).toBe('Not connected');
    expect(empty.accounts.ghl.connect).toBe(true);
    expect(empty.accounts.meta).toEqual({ pill: 'Coming soon', detail: 'Coming soon. A Facebook Page is not an ad account.' });
    expect(empty.social).toEqual({ pill: 'Not connected', detail: 'Not connected.', connectSlug: 'facebook_pages' });

    const unresolved = buildBusinessProfile(input({
      google: { oauth: true, ready: false, note: 'Google is signed in. The ad customer id is not resolved, so Miles cannot read spend or create a campaign yet.' },
    }));
    expect(unresolved.accounts.google.fix).toBe(true);
    expect(unresolved.accounts.google.pill).toBe('Customer ID not found');
    expect(unresolved.accounts.google.connect).toBe(false);
    expect(unresolved.accounts.google.detail).toMatch(/customer id is not resolved/i);

    const otherBlock = buildBusinessProfile(input({
      google: { oauth: true, ready: false, note: 'Pipedream refused to run tools in the production environment.' },
    }));
    expect(otherBlock.accounts.google.fix).toBe(false);
    expect(otherBlock.accounts.google.pill).toBe('Not ready');

    const ready = buildBusinessProfile(input({
      google: { oauth: true, ready: true, note: '' },
      ghlConnected: true,
      ghlDetail: 'GoHighLevel is connected. Speed to lead sends when it is on and the lead has a phone.',
    }));
    expect(ready.accounts.google.fix).toBe(false);
    expect(ready.accounts.google.pill).toBe('Connected');
    expect(ready.accounts.ghl.pill).toBe('Connected');

    const partialSocial = buildBusinessProfile(input({ facebookConnected: true }));
    expect(partialSocial.social.pill).toBe('Partly connected');
    expect(partialSocial.social.connectSlug).toBe('instagram');
    expect(partialSocial.social.detail).toMatch(/Facebook connected/);
    expect(partialSocial.social.detail).toMatch(/Instagram and LinkedIn are not/);

    const scored = buildBusinessProfile(input({
      websiteAudit: { summary: 'Score 64/100 (D). First fixes: Page title, Meta description.' },
    }));
    expect(scored.websiteCheck.score).toBe(64);
    expect(scored.websiteCheck.fixes).toEqual(['Page title', 'Meta description']);
    expect(scored.websiteCheck.line).toBe('2 quick fixes: Page title, Meta description');
    expect(scored.websiteCheck.line).not.toMatch(/80|alt text/);

    const failed = buildBusinessProfile(input({
      websiteAudit: { summary: 'Could not read the site. The request timed out after 10 seconds.' },
    }));
    expect(failed.websiteCheck.score).toBeNull();
    expect(failed.websiteCheck.checked).toBe(false);
    expect(failed.websiteCheck.line).toMatch(/timed out/);

    const copy = businessCopy(buildBusinessProfile(painter)).join('\n');
    expect(copy).not.toMatch(/\u2014/);
    expect(copy).not.toMatch(/\b72%/);
    expect(copy).not.toMatch(/80\/100/);
    expect(copy).not.toMatch(/Winter Interiors|Special Offer|Stock-photo/);
  });

  it('leaves the live account nav in place', () => {
    const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
    expect(html).toContain('data-group="account"');
    expect(html).toContain('Account &amp; setup');
    expect(html).toContain('data-group="marketing"');
    expect(html).toContain('data-group="insights"');
    expect(html).not.toContain('data-group="run"');
    expect(html).not.toContain('data-group="compete"');
    expect(html).not.toContain('data-group="know"');
    expect(html).toContain('id="biz-body"');
    expect(html).toContain('YOUR BUSINESS');
  });
});

function app(accounts: { app: string; externalUserId?: string }[] = []) {
  const connector = {
    name: 'mock',
    async createConnectToken() { return { token: 't', expiresAt: '2099-01-01', connectUrl: 'https://connect.example' }; },
    async listAccounts() { return accounts; },
    async runAction() { return { ok: false, actionId: 'x', app: 'google_ads', output: null }; },
  } as unknown as Connector;
  return buildServer({ authStore: new MemoryStore(), connector });
}

describe('business profile route', () => {
  it('serves an empty account without a fake connection or a fake score', async () => {
    const server = app();
    const signed = await server.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'biz-empty@example.com', password: 'password1', tos: true, name: 'Paul' } });
    const headers = { cookie: String(signed.headers['set-cookie']).split(';')[0] };
    const res = await server.inject({ method: 'GET', url: '/api/profile/business', headers });
    expect(res.statusCode).toBe(200);
    const view = res.json().business as BusinessProfileView;
    expect(view.percent).toBe(0);
    expect(view.accounts.google.fix).toBe(false);
    expect(view.accounts.google.pill).toBe('Not connected');
    expect(view.accounts.ghl.pill).toBe('Not connected');
    expect(view.accounts.meta.pill).toBe('Coming soon');
    expect(view.websiteCheck.score).toBeNull();
    expect(view.missingChips).toContain('Job photos');
    expect(businessCopy(view).join('\n')).not.toMatch(/\u2014/);
    const home = await server.inject({ method: 'GET', url: '/api/miles/home', headers });
    expect(home.json().activation).toBe('none');
    await server.close();
  });

  it('shows the saved cap and a real crawl score, and FIX only when Google is signed in without a customer id', async () => {
    const server = app([{ app: 'google_ads', externalUserId: 'user' }]);
    const signed = await server.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'biz-cap@example.com', password: 'password1', tos: true, name: 'Paul' } });
    const headers = { cookie: String(signed.headers['set-cookie']).split(';')[0] };
    await server.inject({ method: 'PUT', url: '/api/profile', headers, payload: { businessName: 'Painters In Philly', industry: 'Painting', serviceAreas: 'Philadelphia, PA', website: 'https://paintersinphilly.com' } });
    const questions = await server.inject({ method: 'POST', url: '/api/miles/questions', headers, payload: { goal: 'More calls & leads', dailyBudget: 20, leadsPerDay: 1, mode: 'hybrid' } });
    expect(questions.statusCode).toBe(200);
    const crawled = await server.inject({
      method: 'POST',
      url: '/api/miles/crawl',
      headers,
      payload: { html: '<html><head><title>Painters</title></head><body><h1>Interior painting</h1><a href="tel:215-555-0199">215-555-0199</a></body></html>', website: 'https://paintersinphilly.com' },
    });
    expect(crawled.statusCode).toBe(200);
    const res = await server.inject({ method: 'GET', url: '/api/profile/business', headers });
    const view = res.json().business as BusinessProfileView;
    expect(field(view, 'dailyBudget').value).toBe('$20/day · $600/mo');
    expect(view.missingChips).not.toContain('Daily budget');
    expect(view.missingChips).not.toContain('Business name');
    expect(view.accounts.google.fix).toBe(true);
    expect(view.accounts.google.pill).toBe('Customer ID not found');
    expect(view.accounts.google.detail).toMatch(/Demo mode|customer id/i);
    expect(view.accounts.ghl.pill).toBe('Not connected');
    expect(view.accounts.meta.pill).toBe('Coming soon');
    expect(view.websiteCheck.score).not.toBeNull();
    expect(view.websiteCheck.score).not.toBe(80);
    expect(view.websiteCheck.line).not.toMatch(/SAMPLE/);
    expect(view.mode).toBe('hybrid');
    const home = await server.inject({ method: 'GET', url: '/api/miles/home', headers });
    expect(home.json().activation).toBe('none');
    expect(home.json().mode).toBe('hybrid');
    await server.close();
  });

  it('marks GoHighLevel connected only when that account is linked', async () => {
    const server = app([{ app: 'gohighlevel', externalUserId: 'user' }]);
    const signed = await server.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'biz-ghl@example.com', password: 'password1', tos: true } });
    const headers = { cookie: String(signed.headers['set-cookie']).split(';')[0] };
    const view = (await server.inject({ method: 'GET', url: '/api/profile/business', headers })).json().business as BusinessProfileView;
    expect(view.accounts.ghl.pill).toBe('Connected');
    expect(view.accounts.ghl.connect).toBe(false);
    expect(view.accounts.google.pill).toBe('Not connected');
    expect(view.accounts.google.fix).toBe(false);
    await server.close();
  });
});
