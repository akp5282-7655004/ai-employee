import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import { MockConnector } from '../src/connectors/mock.js';
import { claimableGhlAccount } from '../src/connectors/ghlstatus.js';
import type { Connector } from '../src/connectors/types.js';

describe('claimable GoHighLevel accounts', () => {
  it('takes the only healthy account when this is the only login', () => {
    expect(claimableGhlAccount({
      selfId: 'u_me',
      otherUserIds: [],
      accounts: [{ app: 'highlevel_oauth', externalId: 'legacy', healthy: true }],
    })).toEqual({ externalId: 'legacy', slug: 'highlevel_oauth' });
  });

  it('does not take an account that belongs to another Miles login', () => {
    expect(claimableGhlAccount({
      selfId: 'u_me',
      otherUserIds: ['u_other'],
      accounts: [{ app: 'highlevel_oauth', externalId: 'u_other', healthy: true }],
    })).toBeUndefined();
  });

  it('does not guess when two GoHighLevel accounts exist', () => {
    expect(claimableGhlAccount({
      selfId: 'u_me',
      otherUserIds: [],
      accounts: [
        { app: 'highlevel_oauth', externalId: 'a', healthy: true },
        { app: 'highlevel_oauth', externalId: 'b', healthy: true },
      ],
    })).toBeUndefined();
  });
});

describe('every surface reads the same GoHighLevel status', () => {
  it('finds highlevel_oauth stored under a different external id', async () => {
    const connector = new MockConnector();
    connector.connect('u_ignored', 'google_ads');
    connector.addProjectAccount({ id: 'ghl1', app: 'highlevel_oauth', name: 'GHL', externalUserId: 'legacy', healthy: true });
    const server = buildServer({ authStore: new MemoryStore(), connector: connector as unknown as Connector });
    const signed = await server.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'ghl@example.com', password: 'password1', name: 'Owner', tos: true } });
    const headers = { cookie: String(signed.headers['set-cookie']).split(';')[0] ?? '' };
    const userId = signed.json().user.id as string;
    connector.connect(userId, 'google_ads');
    const home = await server.inject({ method: 'GET', url: '/api/miles/home', headers });
    const health = await server.inject({ method: 'GET', url: '/api/health', headers });
    const dash = await server.inject({ method: 'GET', url: '/api/dashboard', headers });
    expect(home.json().ghl.connected).toBe(true);
    expect(home.json().ghl.setup).toMatch(/GoHighLevel is connected/);
    expect(health.json().summary.ghl).toBe(true);
    expect(dash.json().leads.connected).toBe(true);
  });

  it('counts only dated agent runs inside the selected window', async () => {
    const connector = new MockConnector();
    const store = new MemoryStore();
    const server = buildServer({ authStore: store, connector: connector as unknown as Connector });
    const signed = await server.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'range@example.com', password: 'password1', tos: true } });
    const headers = { cookie: String(signed.headers['set-cookie']).split(';')[0] ?? '' };
    const id = signed.json().user.id as string;
    const data = await store.getUserData(id);
    const recent = new Date().toISOString();
    const old = new Date(Date.now() - 20 * 86400000).toISOString();
    data.agentRuns = [
      { id: 'a', agentId: '1', task: 't', ts: recent, title: 'new', body: '' },
      { id: 'b', agentId: '1', task: 't', ts: old, title: 'old', body: '' },
      { id: 'c', agentId: '1', task: 't', ts: '', title: 'undated', body: '' },
    ];
    data.schedules = [{ id: '1' }, { id: '2' }];
    data.deploy = { queue: [{ status: 'pending' }, { status: 'pending' }, { status: 'live' }] };
    const week = await server.inject({ method: 'GET', url: '/api/dashboard?range=LAST_7_DAYS', headers });
    const month = await server.inject({ method: 'GET', url: '/api/dashboard?range=LAST_30_DAYS', headers });
    expect(week.json().kpis.agentRuns).toBe(1);
    expect(month.json().kpis.agentRuns).toBe(2);
    expect(week.json().kpis.pendingApprovals).toBe(2);
    expect(week.json().kpis.agentsDeployed).toBe(2);
    expect(week.json().kpis.accountCounts).toBe(true);
    expect(week.json().range).toBe('LAST_7_DAYS');
  });
});
