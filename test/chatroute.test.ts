import { afterAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import type { Connector } from '../src/connectors/types.js';
import type { ChatModel } from '../src/chat/model.js';
import { fallbackAnswer } from '../src/chat/prompt.js';
import { buildAccountSnapshot, renderSnapshot } from '../src/chat/snapshot.js';
import { sources } from './chatsnapshot.test.js';

describe('chat routes launches before the interpreter', () => {
  const modelCalls: string[] = [];
  const chatModel: ChatModel = async () => {
    modelCalls.push('model');
    return {
      text: 'This account is for a painting service. I cannot show the changes to the daily budget as there is no spend data currently tracked.',
      toolCalls: [],
      usage: { model: 'openrouter-test', inputTokens: 10, outputTokens: 10, serveUsd: 0.01 },
    };
  };
  const connector = {
    name: 'pipedream',
    async createConnectToken() { return { token: 't', expiresAt: '2099', connectUrl: 'https://example.com' }; },
    async listAccounts() { return [{ id: 'acct', app: 'google_ads', healthy: true }]; },
    async runAction() { return { ok: false, actionId: 'x', app: 'google_ads', output: null }; },
  } as unknown as Connector;
  const store = new MemoryStore();
  const app = buildServer({ authStore: store, connector, chatModel });
  afterAll(async () => { await app.close(); });

  async function owner(email: string) {
    const signup = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email, password: 'password1', name: 'Ada', tos: true } });
    const cookie = String(signup.headers['set-cookie']).split(';')[0];
    const id = signup.json().user.id as string;
    await store.setUserData(id, {
      profile: { businessName: 'Painters In Philly', industry: 'Painting', services: 'Interior painting', serviceAreas: 'Philadelphia, PA', website: 'https://painters.example', phone: '2155550199' },
      trackingProof: { leadConversion: true },
      miles: {
        phase: 'ready',
        activation: 'paused',
        campaignResource: 'customers/1/campaigns/9',
        bundle: {
          setup: { mode: 'hybrid', businessName: 'Painters In Philly', location: 'Philadelphia', website: 'https://painters.example', caps: { dailyBudget: 40, monthlyCeiling: 1200, maxChangePct: 100, paused: false }, googleShare: 1 },
          channels: [{ id: 'google', daily: 20 }],
          spec: { name: 'Painting', dailyBudget: 20, status: 'PAUSED', adGroups: [] },
          profile: { industry: 'Painting', services: 'Interior painting' },
        },
      },
    });
    return cookie;
  }

  it('shows platform picks for a launch that does not name a budget, without calling the model', async () => {
    const cookie = await owner('launch@example.com');
    const ask = await app.inject({
      method: 'POST', url: '/api/chat/ask', headers: { cookie },
      payload: { messages: [{ role: 'user', text: 'Launch a campaign for me' }] },
    });
    expect(ask.statusCode).toBe(200);
    expect(modelCalls).toEqual([]);
    expect(ask.json().text).not.toBe('What daily budget should I use? I would use $30 a day.');
    expect(ask.json().choices).toBe('suggest');
    expect(ask.json().picker.options.map((row: { label: string }) => row.label)).toEqual(['Google only', 'Meta only', 'TikTok only', 'Local Services Ads only', 'Multi-platform']);
    expect(ask.json().text).toMatch(/I'll use \$20 a day/);
    expect(ask.json().text).toMatch(/LocaliQ 2025/);
  });

  it('ranks platforms from the stated trade, with the resolver source, and does not call the model', async () => {
    const cookie = await owner('plumb@example.com');
    const before = modelCalls.length;
    const ask = await app.inject({
      method: 'POST', url: '/api/chat/ask', headers: { cookie },
      payload: { messages: [{ role: 'user', text: "I'm a plumber and want repair leads, what platforms should I run?" }] },
    });
    expect(ask.json().choices).toBe('suggest');
    expect(ask.json().text).toMatch(/Plumbing/);
    expect(ask.json().text).toMatch(/Searchlight/);
    expect(ask.json().text).toMatch(/Trade-level/);
    expect(ask.json().text).toMatch(/Want to split the campaign across those/);
    expect(ask.json().text).not.toMatch(/painting service/i);
    expect(modelCalls.length).toBe(before);
  });

  it('uses the account trade when the question does not name one', async () => {
    const cookie = await owner('paint@example.com');
    const ask = await app.inject({
      method: 'POST', url: '/api/chat/ask', headers: { cookie },
      payload: { messages: [{ role: 'user', text: 'What platforms should I run?' }] },
    });
    expect(ask.json().text).toMatch(/Painting/);
    expect(ask.json().text).not.toMatch(/Plumbing/);
    expect(modelCalls).not.toContain('model');
  });

  it('returns a budget approval card without spend data and without the model', async () => {
    const cookie = await owner('budget@example.com');
    const before = modelCalls.length;
    const ask = await app.inject({
      method: 'POST', url: '/api/chat/ask', headers: { cookie },
      payload: { messages: [{ role: 'user', text: 'Show me what changing my daily budget to $25/day would look like' }] },
    });
    expect(ask.json().approval.title).toMatch(/daily budget/i);
    expect(ask.json().approval.before).toMatch(/\$20\/day/);
    expect(ask.json().approval.after).toBe('$25/day');
    expect(ask.json().approval.dailyCost).toMatch(/\$25\/day/);
    expect(ask.json().text).not.toMatch(/no spend data/i);
    expect(modelCalls.length).toBe(before);
  });

  it('shows a suggested Facebook budget when the saved Google split leaves Facebook at $0', async () => {
    const cookie = await owner('meta@example.com');
    const built = await app.inject({ method: 'POST', url: '/api/meta/build', headers: { cookie }, payload: {} });
    expect(built.statusCode).toBe(200);
    expect(built.json().spec.dailyBudget).toBeGreaterThan(0);
    expect(built.json().spec.dailyBudget).toBe(40);
    expect(built.json().budgetNote).toMatch(/suggestion/i);
  });
});

describe('connection status uses one snapshot', () => {
  it('does not say Google Ads is disconnected when the account list includes it', () => {
    const snapshot = buildAccountSnapshot(sources({
      google: { oauth: false, ready: false, customerId: null, note: 'The ad customer id is not resolved.', error: null },
      connectedApps: ['google_ads'],
    }));
    const rendered = renderSnapshot(snapshot);
    const status = fallbackAnswer(snapshot, 'check campaign status');
    expect(rendered).toMatch(/Google Ads: connected/);
    expect(status).not.toMatch(/Google Ads is not connected/);
    expect(fallbackAnswer(snapshot, 'which one of my integrations are connected')).not.toMatch(/Google Ads is not connected/);
  });
});
