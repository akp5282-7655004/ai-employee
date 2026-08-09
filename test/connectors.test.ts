import { describe, expect, it } from 'vitest';
import { MockConnector, getConnector } from '../src/connectors/index.js';
import { loadConfig, pipedreamReady } from '../src/config.js';

describe('connector selection', () => {
  it('defaults to the mock connector when Pipedream is not configured', () => {
    expect(getConnector(loadConfig()).name).toBe('mock');
  });

  it('only reports Pipedream ready when fully credentialed', () => {
    expect(pipedreamReady({ connector: 'pipedream', pipedream: { environment: 'development' } })).toBe(false);
    expect(
      pipedreamReady({
        connector: 'pipedream',
        pipedream: { environment: 'development', projectId: 'p', clientId: 'c', clientSecret: 's' },
      }),
    ).toBe(true);
    // Credentialed but driver still mock → not ready.
    expect(
      pipedreamReady({
        connector: 'mock',
        pipedream: { environment: 'development', projectId: 'p', clientId: 'c', clientSecret: 's' },
      }),
    ).toBe(false);
  });
});

describe('mock connector', () => {
  it('mints a connect token whose URL carries the token', async () => {
    const c = new MockConnector();
    const t = await c.createConnectToken('shop-1');
    expect(t.token).toContain('shop-1');
    expect(t.connectUrl).toContain(t.token);
    expect(Date.parse(t.expiresAt)).toBeGreaterThan(Date.now());
  });

  it('lists connected accounts and filters by app', async () => {
    const c = new MockConnector({ 'shop-1': ['google_ads', 'google_my_business'] });
    expect((await c.listAccounts('shop-1')).length).toBe(2);
    const ads = await c.listAccounts('shop-1', 'google_ads');
    expect(ads.length).toBe(1);
    expect(ads[0]!.app).toBe('google_ads');
    expect(await c.listAccounts('other-shop')).toEqual([]);
  });

  it('runs an action only when the app is connected', async () => {
    const c = new MockConnector({ 'shop-1': ['google_ads'] });
    const ok = await c.runAction({ externalUserId: 'shop-1', actionId: 'google_ads-create-campaign', configuredProps: { name: 'Spring' } });
    expect(ok.ok).toBe(true);
    expect((ok.output as { inputs: unknown }).inputs).toEqual({ name: 'Spring' });

    const denied = await c.runAction({ externalUserId: 'shop-1', actionId: 'facebook_pages-create-post' });
    expect(denied.ok).toBe(false);
    expect(denied.note).toMatch(/connect link/i);
  });
});
