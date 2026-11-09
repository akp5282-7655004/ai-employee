import { describe, expect, it } from 'vitest';
import { classifyGadsAccounts } from '../src/connectors/gadsAccess.js';
import { PipedreamConnector } from '../src/connectors/pipedream.js';
import type { Config } from '../src/config.js';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import { mergeCredits } from '../src/billing/merge.js';
import { adSpendAllowed } from '../src/billing/gate.js';

describe('Google customer id resolution', () => {
  it('says when the login has no ad accounts', () => {
    const access = classifyGadsAccounts({ logins: [], clientsByLogin: {} });
    expect(access.kind).toBe('none');
    expect(access.reason).toMatch(/no accessible Google Ads customer ids/);
  });

  it('says when the login is only a manager account', () => {
    const access = classifyGadsAccounts({
      logins: [{ id: '1111111111', manager: true, name: 'MCC' }],
      clientsByLogin: { '1111111111': [{ id: '1111111111', manager: true }] },
    });
    expect(access.kind).toBe('manager_only');
    expect(access.loginCustomerId).toBe('1111111111');
    expect(access.customers).toEqual([]);
    expect(access.reason).toMatch(/login-customer-id/);
  });

  it('asks for a pick when several client accounts are accessible and keeps the choice', () => {
    const open = classifyGadsAccounts({
      logins: [{ id: '1111111111', manager: true }],
      clientsByLogin: {
        '1111111111': [
          { id: '2222222222', name: 'Paint Co' },
          { id: '3333333333', name: 'Other' },
        ],
      },
    });
    expect(open.kind).toBe('choose');
    expect(open.customers.map((c) => c.id)).toEqual(['2222222222', '3333333333']);
    const picked = classifyGadsAccounts({
      logins: [{ id: '1111111111', manager: true }],
      clientsByLogin: { '1111111111': [{ id: '2222222222', name: 'Paint Co' }, { id: '3333333333' }] },
      selectedId: '3333333333',
    });
    expect(picked.kind).toBe('ready');
    expect(picked.selectedId).toBe('3333333333');
  });

  it('does not show a blank customer id when the tool result is empty', async () => {
    const calls: string[] = [];
    const client = {
      accounts: { list: async () => ({ data: [{ id: 'apn_QPhAdBo', app: { nameSlug: 'google_ads' }, healthy: true, name: 'Google' }] }) },
      actions: {
        list: async () => ({ data: [
          { key: 'google_ads-list-account-id-options', configurableProps: [{ type: 'app', name: 'googleAds' }] },
          { key: 'google_ads-list-customer-clients', configurableProps: [{ type: 'app', name: 'googleAds' }, { name: 'accountId' }] },
        ] }),
        run: async (opts: { id?: string }) => {
          calls.push(opts.id || '');
          return { ret: [] };
        },
      },
    };
    const connector = new PipedreamConnector({ connector: 'pipedream', pipedream: { environment: 'production', projectId: 'p', clientId: 'c', clientSecret: 's' } } as Config);
    (connector as unknown as { client: unknown }).client = client;
    const details = await connector.describeConnections('u_d626ba2b024cc548');
    const google = details.find((d) => d.app === 'google_ads');
    expect(calls).toContain('google_ads-list-account-id-options');
    expect(google?.rows?.find((r) => r.k === 'Ad account (customer) ID')?.v).toBe('None');
    expect(google?.note).toMatch(/no accessible/);
    expect(google?.ready).toBe(false);
  });

  it('persists the customer the owner picks and then shows that id', async () => {
    const client = {
      accounts: { list: async () => ({ data: [{ id: 'apn_QPhAdBo', app: { nameSlug: 'google_ads' }, healthy: true }] }) },
      actions: {
        list: async () => ({ data: [
          { key: 'google_ads-list-account-id-options', configurableProps: [{ type: 'app', name: 'googleAds' }] },
          { key: 'google_ads-list-customer-clients', configurableProps: [{ type: 'app', name: 'googleAds' }, { name: 'accountId' }] },
        ] }),
        run: async (opts: { id?: string }) => {
          if (opts.id === 'google_ads-list-account-id-options') return { ret: [{ value: '1111111111', manager: true }] };
          return { ret: [{ id: '2222222222', descriptiveName: 'Paint Co' }, { id: '3333333333', descriptiveName: 'Other' }] };
        },
      },
    };
    const connector = new PipedreamConnector({ connector: 'pipedream', pipedream: { environment: 'production', projectId: 'p', clientId: 'c', clientSecret: 's' } } as Config);
    (connector as unknown as { client: unknown }).client = client;
    const store = new MemoryStore();
    const app = buildServer({ authStore: store, connector });
    const signup = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'paint@example.com', password: 'password1', tos: true } });
    const cookie = String(signup.headers['set-cookie']).split(';')[0] ?? '';
    const id = signup.json().user.id as string;
    const before = await app.inject({ method: 'GET', url: '/api/connections/detail', headers: { cookie } });
    const card = before.json().details.find((d: { app: string }) => d.app === 'google_ads');
    expect(card.rows.find((r: { k: string }) => r.k === 'Ad account (customer) ID').v).toBe('Choose one');
    expect(card.choices).toHaveLength(2);
    const save = await app.inject({ method: 'POST', url: '/api/google-ads/customer', headers: { cookie }, payload: { customerId: '3333333333' } });
    expect(save.statusCode).toBe(200);
    const after = await app.inject({ method: 'GET', url: '/api/connections/detail', headers: { cookie } });
    const next = after.json().details.find((d: { app: string }) => d.app === 'google_ads');
    expect(next.rows.find((r: { k: string }) => r.k === 'Ad account (customer) ID').v).toBe('333-333-3333');
    expect((await store.getUserData(id)).googleAdsCustomerId).toBe('3333333333');
    const foreign = await app.inject({ method: 'POST', url: '/api/google-ads/customer', headers: { cookie }, payload: { customerId: '9999999999' } });
    expect(foreign.statusCode).toBe(400);
    await app.close();
  });
});

describe('credit merges do not double-count', () => {
  it('keeps a grant and a debit that started from the same balance', () => {
    const stored = { credits: { granted: 100, spent: 0, ledger: [] }, billing: { status: 'active', band: 'launch', grantedInvoices: [], grantKeys: [] } };
    const grant = { credits: { granted: 150, spent: 0, baseGranted: 100, baseSpent: 0, ledger: [] }, billing: { grantAmounts: { in_1: 50 }, grantKeys: ['in_1'], grantedInvoices: ['in_1'], baseInvoices: [] } };
    const once = mergeCredits(stored.credits, grant.credits, stored.billing, grant.billing);
    expect(once.credits.granted).toBe(150);
    const again = mergeCredits(once.credits, grant.credits, once.billing, grant.billing);
    expect(again.credits.granted).toBe(150);
  });

  it('drops a second debit once the balance is already empty', () => {
    const stored = { credits: { granted: 1, spent: 1.5, ledger: [] }, billing: {} };
    const incoming = { credits: { granted: 1, spent: 1.5, baseGranted: 1, baseSpent: 0, ledger: [] }, billing: {} };
    const merged = mergeCredits(stored.credits, incoming.credits, stored.billing, incoming.billing);
    expect(merged.credits.spent).toBe(1.5);
    expect((merged.credits.granted ?? 0) - (merged.credits.spent ?? 0)).toBeGreaterThanOrEqual(-0.5);
  });
});

describe('ad spend gate', () => {
  it('blocks create and enable without a plan or credits, and not when enforcement is off', () => {
    expect(adSpendAllowed({ credits: { granted: 0, spent: 0, launchOffer: false }, billing: { status: 'none', grantedInvoices: [] } }).ok).toBe(true);
    process.env.BILLING_ENFORCE = '1';
    try {
      expect(adSpendAllowed({ credits: { granted: 0, spent: 0, launchOffer: false }, billing: { status: 'none', grantedInvoices: [] } }).ok).toBe(false);
      expect(adSpendAllowed({ credits: { granted: 100, spent: 0, launchOffer: true }, billing: { status: 'active', band: 'launch', grantedInvoices: [] } }).ok).toBe(true);
      expect(adSpendAllowed({ credits: { granted: 100, spent: 100, launchOffer: true }, billing: { status: 'active', band: 'launch', grantedInvoices: [] } }).ok).toBe(false);
    } finally {
      delete process.env.BILLING_ENFORCE;
    }
  });
});
