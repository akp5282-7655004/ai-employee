import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import { MockConnector } from '../src/connectors/mock.js';
import { PipedreamConnector } from '../src/connectors/pipedream.js';
import { healthyAccount, splitByHealth } from '../src/connectors/health.js';
import type { Config } from '../src/config.js';

async function session(app: ReturnType<typeof buildServer>, email: string) {
  const r = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email, password: 'password1', tos: true } });
  const raw = r.headers['set-cookie'];
  return { cookie: String(Array.isArray(raw) ? raw[0] : raw).split(';')[0] ?? '', id: r.json().user.id as string };
}

describe('revoked connections (row 33)', () => {
  it('never picks an unhealthy account, and splits apps by health', () => {
    expect(healthyAccount([{ healthy: false }])).toBeUndefined();
    expect(healthyAccount([{ healthy: false, id: 'a' }, { healthy: true, id: 'b' }])?.id).toBe('b');
    const split = splitByHealth([
      { app: 'google_ads', healthy: false },
      { app: 'gmail', healthy: true },
      { app: 'gohighlevel', healthy: false },
      { app: 'gohighlevel', healthy: true },
    ]);
    expect(split.connectedApps.sort()).toEqual(['gmail', 'gohighlevel']);
    expect(split.needsReconnect).toEqual(['google_ads']);
  });

  it('/api/connections leaves a revoked app out of connectedApps and lists it under needsReconnect', async () => {
    const connector = new MockConnector();
    const app = buildServer({ authStore: new MemoryStore(), connector });
    const { cookie, id } = await session(app, 'revoked@example.com');
    connector.connect(id, 'gmail');
    const ads = connector.connect(id, 'google_ads');
    ads.healthy = false;
    const r = (await app.inject({ method: 'GET', url: '/api/connections', headers: { cookie } })).json();
    expect(r.connectedApps).toEqual(['gmail']);
    expect(r.needsReconnect).toEqual(['google_ads']);
    await app.close();
  });

  it('the Pipedream connector does not fall back to a revoked account', async () => {
    const cfg = { connector: 'pipedream', pipedream: { environment: 'production', projectId: 'p', clientId: 'c', clientSecret: 's' } } as Config;
    let ran = 0;
    const client = {
      accounts: { list: async () => ({ data: [{ id: 'apn_dead', app: { nameSlug: 'google_ads' }, healthy: false }] }) },
      actions: {
        list: async () => ({ data: [{ key: 'google_ads-create-report', name: 'Create report' }] }),
        retrieve: async () => ({ data: { configurableProps: [] } }),
        run: async () => { ran++; return { ret: [] }; },
      },
    };
    const connector = new PipedreamConnector(cfg);
    (connector as unknown as { client: unknown }).client = client;
    expect(await connector.listAdTargets('owner')).toEqual([]);
    const task = await connector.runAppTask({ externalUserId: 'owner', app: 'google_ads', query: 'create report', params: {} });
    expect(task.ok).toBe(false);
    expect(task.note).toMatch(/Reconnect Google Ads/);
    const details = await connector.describeConnections('owner');
    expect(details.find((d) => d.app === 'google_ads')).toMatchObject({ connected: false, needsReconnect: true });
    expect(ran).toBe(0);
  });
});
