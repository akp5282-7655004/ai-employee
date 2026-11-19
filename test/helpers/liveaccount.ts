import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/server.js';
import { MemoryStore } from '../../src/db/index.js';
import { MockConnector } from '../../src/connectors/mock.js';

/**
 * An account the way a real customer's looks, for tests that drive the page.
 *
 * Most tests here run on the preview connector, where every number is a
 * labelled sample. The bugs owners actually report show up on the other kind
 * of account: Google Ads connected, real spend coming back, and no CRM yet.
 * This builds that account without a network: the connector answers to the
 * live connector's name and returns real-shaped Google rows.
 */
export interface LiveAccount {
  app: FastifyInstance;
  base: string;
  cookie: string;
  cookieName: string;
  cookieValue: string;
}

export interface LiveAccountOptions {
  /** Spend Google reports for the window. 0 means connected with nothing spent. */
  spend?: number;
  /** Status Google reports for the one campaign. */
  campaignStatus?: 'ENABLED' | 'PAUSED' | 'UNKNOWN';
  /** Apps connected through the connector. */
  apps?: string[];
  /** Saved on the business profile. */
  website?: string;
}

const day = (ago: number) => new Date(Date.now() - ago * 86_400_000).toISOString().slice(0, 10);

export async function liveAccount(options: LiveAccountOptions = {}): Promise<LiveAccount> {
  const spend = options.spend ?? 1183;
  const status = options.campaignStatus ?? 'ENABLED';
  const connector = new MockConnector({ '*': options.apps ?? ['google_ads', 'google_analytics'] });
  const live = connector as unknown as Record<string, unknown>;
  live.name = 'pipedream';
  live.readMarketingAds = async (_uid: string, q: { startDate: string; endDate: string }) => {
    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < 30 && spend > 0; i++) {
      const date = day(i);
      if (date < q.startDate || date > q.endDate) continue;
      rows.push({ level: 'campaign', date, campaign: 'Painters In Philly | Search', impressions: 400 + i, clicks: 12 + (i % 5), conversions: 0, spend: Math.round((spend / 30) * 100) / 100, status });
    }
    return {
      google: { connected: true, note: `Read from Google Ads for ${q.startDate} to ${q.endDate}.`, rows },
      meta: { connected: false, note: '', rows: [] },
    };
  };
  live.getAdSpend = async () => (spend > 0
    ? [{ platform: 'google_ads', campaign: 'Painters In Philly | Search', utm: 'painters_search', spend, clicks: 402, impressions: 12400, conversions: 0, id: '2233', status }]
    : []);
  live.getDeals = async () => [];
  live.getLeads = async () => [];
  live.readGoogleCampaignStatus = async () => ({ live: true, called: true, sample: false, note: 'Read from Google Ads just now.', campaigns: [{ id: '2233', name: 'Painters In Philly | Search', status }] });
  live.listAdTargets = async () => [{ id: '5550001111', login: '5550001111', name: 'Painters In Philly', label: 'Painters In Philly (555-000-1111)' }];

  const app = buildServer({ authStore: new MemoryStore(), connector });
  const base = await app.listen({ port: 0, host: '127.0.0.1' });
  const signup = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'owner@example.com', password: 'Harbor-Lantern-42', name: 'Casey', tos: true } });
  const cookie = String(signup.headers['set-cookie']).split(';')[0]!;
  const [cookieName, cookieValue] = cookie.split('=') as [string, string];
  const saved = (await app.inject({ method: 'GET', url: '/api/profile', headers: { cookie } })).json().profile ?? {};
  await app.inject({
    method: 'PUT',
    url: '/api/profile',
    headers: { cookie, 'content-type': 'application/json' },
    payload: JSON.stringify({ ...saved, businessName: 'Painters In Philly', industry: 'Painting', phone: '(215) 555-0142', website: options.website ?? 'https://example.com', city: 'Philadelphia', state: 'PA', services: 'Interior painting, exterior painting', dailyBudget: 40 }),
  });
  return { app, base, cookie, cookieName, cookieValue };
}

/**
 * Runs in the page. Every visible piece of text whose color is within `minRatio`
 * of the color behind it, as "ratio tag.class text". Text the same color as its
 * background has a ratio of 1; WCAG asks for 4.5 on body text and 3 on large.
 */
export const LOW_CONTRAST = `(minRatio) => {
  const rgb = (c) => { const m = c.match(/[\\d.]+/g); return m ? m.slice(0, 4).map(Number) : [0, 0, 0, 0]; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const behind = (e) => { while (e) { const c = rgb(getComputedStyle(e).backgroundColor); if (c.length < 4 || c[3] > 0.5) return c; e = e.parentElement; } return [255, 255, 255]; };
  const page = document.querySelector('.page.on'); if (!page) return ['no page is showing'];
  const found = []; const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const text = (node.textContent || '').trim(); if (text.length < 2) continue;
    const e = node.parentElement; if (!e.offsetParent && getComputedStyle(e).position !== 'fixed') continue;
    if (!(page.contains(e) || e.closest('.pagehead,.side,.askbar,#pagetabs,.subtabs'))) continue;
    const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
    const fg = lum(rgb(cs.color)); const bg = lum(behind(e));
    const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
    if (ratio >= minRatio) continue;
    const key = e.tagName + '|' + e.className + '|' + cs.color; if (seen.has(key)) continue; seen.add(key);
    found.push(ratio.toFixed(1) + ' ' + e.tagName.toLowerCase() + '.' + String(e.className).slice(0, 30) + ' "' + text.slice(0, 30) + '"');
  }
  return found;
}`;
