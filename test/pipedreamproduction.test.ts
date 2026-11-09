import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import { explainPipedreamError } from '../src/connectors/pipedreamErrors.js';
import { PipedreamConnector } from '../src/connectors/pipedream.js';
import { categoryForIndustry } from '../src/brand/trade.js';
import type { Config } from '../src/config.js';
import type { Connector } from '../src/connectors/types.js';

const PRODUCTION_400 = 'BadRequestError Status code: 400 Body: { "error": "Tool calling via Pipedream Connect in production is not available on this workspace." }';

describe('Pipedream production tool-call errors', () => {
  it('keeps the full sentence and does not suggest another environment or tenant', () => {
    const failure = explainPipedreamError(new Error(`${PRODUCTION_400} Authorization: Bearer sk_live_secretvalue`));
    expect(failure.kind).toBe('connect_production_unavailable');
    expect(failure.providerMessage).toContain('not available on this workspace');
    expect(failure.providerMessage.length).toBeGreaterThan(120);
    expect(failure.providerMessage).not.toContain('sk_live_secretvalue');
    expect(failure.message).toContain('google_ads-list-account-id-options');
    expect(failure.message).toContain('Do not point Miles at the development');
    expect(failure.message).not.toMatch(/use user u_/);
  });
});

describe('platform readiness is per account and not implied by OAuth', () => {
  it('does not call Google ready or Meta connected from a healthy Google login', async () => {
    const seen: string[] = [];
    const blocks = new Map<string, { kind: string; message: string; providerMessage: string }>();
    const connector = {
      name: 'pipedream',
      async createConnectToken() { return { token: 't', expiresAt: '2099', connectUrl: 'https://connect.example' }; },
      async listAccounts(id: string) {
        seen.push(id);
        return [{ id: 'apn_current', app: 'google_ads', externalUserId: id, healthy: true }];
      },
      async listAdTargets(id: string) {
        seen.push('targets:' + id);
        return [];
      },
      googleAdsBlock(id: string) { return blocks.get(id) ?? null; },
      async runAction() { return { ok: false, actionId: 'x', app: 'google_ads', output: null }; },
    } as unknown as Connector;
    const app = buildServer({ authStore: new MemoryStore(), connector });
    const a = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'a@example.com', password: 'password1', tos: true } });
    const b = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'b@example.com', password: 'password1', tos: true } });
    const cookieA = String(a.headers['set-cookie']).split(';')[0] ?? '';
    const cookieB = String(b.headers['set-cookie']).split(';')[0] ?? '';
    const idA = a.json().user.id as string;
    const idB = b.json().user.id as string;
    blocks.set(idA, explainPipedreamError(new Error(PRODUCTION_400)));
    const dash = await app.inject({ method: 'GET', url: '/api/dashboard', headers: { cookie: cookieA } });
    const marketing = dash.json().marketing;
    expect(marketing.platforms.googleAds.oauth).toBe(true);
    expect(marketing.platforms.googleAds.ready).toBe(false);
    expect(marketing.platforms.googleAds.customerResolved).toBe(false);
    expect(marketing.platforms.metaAds.ready).toBe(false);
    expect(marketing.connected).toBe(false);
    expect(marketing.platforms.googleAds.note).toContain('not available on this workspace');
    expect(marketing.platforms.googleAds.note).not.toContain(idB);
    expect(seen.filter((s) => s === idB || s === 'targets:' + idB)).toEqual([]);
    const other = await app.inject({ method: 'GET', url: '/api/dashboard', headers: { cookie: cookieB } });
    expect(other.json().marketing.platforms.googleAds.note || '').not.toContain('not available on this workspace');
    const ads = await app.inject({ method: 'GET', url: '/api/ads/campaigns', headers: { cookie: cookieA } });
    expect(ads.json().metaAds).toBe(false);
    expect(ads.json().googleReady).toBe(false);
    expect(ads.json().googleNote).toContain('not available on this workspace');
    const growth = await app.inject({ method: 'GET', url: '/api/growth/plan', headers: { cookie: cookieA } });
    expect(growth.json().metaAds).toBe(false);
    expect(growth.json().googleReady).toBe(false);
    expect(growth.json().connected).toBe(true);
    await app.close();
  });
});

describe('production tool calls stay on the signed-in user', () => {
  it('does not reuse another external user or keep calling tools after the entitlement error', async () => {
    const runs: { externalUserId?: string; id?: string }[] = [];
    const client = {
      accounts: {
        list: async ({ externalUserId, app }: { externalUserId: string; app?: string }) => ({
          data: externalUserId === 'u_current' && (!app || app === 'google_ads')
            ? [{ id: 'apn_QPhAdBo', app: { nameSlug: 'google_ads' }, healthy: true, name: 'Google' }]
            : externalUserId === 'u_other'
              ? [{ id: 'apn_V1hW91M', app: { nameSlug: 'google_ads' }, healthy: true, name: 'Other Google' }]
              : [],
        }),
      },
      actions: {
        list: async () => ({
          data: [
            { key: 'google_ads-list-account-id-options', configurableProps: [{ type: 'app', name: 'googleAds' }] },
            { key: 'google_ads-list-customer-clients', configurableProps: [{ type: 'app', name: 'googleAds' }, { name: 'accountId' }] },
            { key: 'google_ads-create-campaign-report', configurableProps: [{ type: 'app', name: 'googleAds' }] },
          ],
        }),
        run: async (opts: { externalUserId?: string; id?: string }) => {
          runs.push(opts);
          if (opts.externalUserId === 'u_other') return { ret: 'customers/1111111111' };
          throw new Error(PRODUCTION_400);
        },
      },
    };
    const cfg = { connector: 'pipedream', pipedream: { environment: 'production', projectId: 'proj_4GsLLKJ', clientId: 'id', clientSecret: 'secret' } } as Config;
    const connector = new PipedreamConnector(cfg);
    (connector as unknown as { client: unknown }).client = client;
    const targets = await connector.listAdTargets('u_current');
    expect(targets).toEqual([]);
    expect(runs.map((r) => r.externalUserId)).toEqual(['u_current']);
    expect(runs[0]?.id).toBe('google_ads-list-account-id-options');
    const beforeSpend = runs.length;
    expect(await connector.getAdSpend?.('u_current')).toEqual([]);
    expect(runs.length).toBe(beforeSpend);
    const details = await connector.describeConnections('u_current');
    const google = details.find((d) => d.app === 'google_ads');
    expect(google?.connected).toBe(true);
    expect(google?.ready).toBe(false);
    expect(google?.note).toContain('not available on this workspace');
    expect(google?.note).not.toContain('1111111111');
    expect(details.find((d) => d.app === 'meta_ads')?.connected).toBe(false);
    const other = await connector.listAdTargets('u_other');
    expect(other.map((t) => t.id)).toContain('1111111111');
    expect(connector.googleAdsBlock('u_current')?.providerMessage).toContain('not available on this workspace');
    expect(connector.googleAdsBlock('u_other')).toBeNull();
    expect(cfg.pipedream.environment).toBe('production');
  });
});

describe('ad copy screen does not claim Meta from a Google login', () => {
  it('selects the profile trade and does not say Google and Meta are connected', () => {
    const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
    expect(html).toContain('function tradeCategory');
    expect(html).toContain('Signed in — not ready to read or create');
    expect(html).not.toContain('Google Ads / Meta');
  });
});

describe('ad copy follows the profile trade', () => {
  it('maps a painting company to painting, not plumbing', () => {
    expect(categoryForIndustry('Painting')).toBe('painting');
    expect(categoryForIndustry('Painting')).not.toBe('plumbing');
  });
});
