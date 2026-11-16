import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import { parseActionIntent } from '../src/chat/intent.js';
import { runChatTool, type ChatReaders } from '../src/chat/tools.js';
import { answerChat } from '../src/chat/ask.js';
import { buildAccountSnapshot } from '../src/chat/snapshot.js';
import type { ChatModel } from '../src/chat/model.js';
import { retailFromServe } from '../src/billing/textprice.js';

const readers: ChatReaders = {
  campaignStatus: async () => ({ onFile: [] }),
  integrations: async () => ({ google: 'not connected' }),
  leads: async () => ({ leads: [{ name: 'Ada' }] }),
  changeLog: async () => ({ events: [] }),
};

describe('action intent', () => {
  it('parses a Google Ads setup and does not require a second question', () => {
    const intent = parseActionIntent('Set up Google Ads for Fishtown at $30 a day for interior and cabinet painting');
    expect(intent).toMatchObject({
      channel: 'google_ads',
      locations: ['Fishtown'],
      dailyBudget: 30,
      services: ['interior painting', 'cabinet painting'],
      missing: null,
    });
  });

  it('asks one question when the budget is missing', () => {
    const intent = parseActionIntent('Set up Google Ads for Fishtown for interior painting');
    expect(intent?.missing).toBe('budget');
    expect(intent?.suggestion).toMatch(/\$30/);
  });
});

describe('read-only agent', () => {
  it('refuses a write tool and bills a live turn at four times the serve cost', async () => {
    expect(await runChatTool('launch_campaign', readers)).toMatch(/read-only/i);
    expect(await runChatTool('pause_campaign', readers)).toMatch(/Nothing was spent/);
    const store = new MemoryStore();
    const app = buildServer({
      authStore: store,
      chatModel: async () => ({ text: 'Your ads are an example until Google Ads is connected.', toolCalls: [], usage: { model: 'openai/gpt-4o-mini', inputTokens: 10, outputTokens: 8, serveUsd: 0.01 } }),
    });
    const signup = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'agent@example.com', password: 'password1', name: 'Ada', tos: true } });
    const cookie = String(signup.headers['set-cookie']).split(';')[0];
    const id = signup.json().user.id as string;
    const ask = await app.inject({ method: 'POST', url: '/api/chat/ask', headers: { cookie }, payload: { messages: [{ role: 'user', text: 'How are my ads doing this month?' }] } });
    expect(ask.statusCode).toBe(200);
    expect(ask.json().text).toMatch(/example|not connected|SAMPLE|no spend/i);
    const data = await store.getUserData(id);
    const credits = data.credits as { spent?: number };
    expect(credits.spent).toBeCloseTo(retailFromServe(0.01), 6);
    expect(data.openRouterCostUsd).toBeCloseTo(0.01, 6);
    await app.close();
  });

  it('keeps each account on its own leads and stores a plan without launching', async () => {
    const store = new MemoryStore();
    const calls: string[] = [];
    const app = buildServer({
      authStore: store,
      chatModel: (async (req) => {
        const tool = req.messages.find((message) => message.role === 'tool');
        if (!tool) return { text: null, toolCalls: [{ id: 'c1', name: 'get_leads', arguments: '{"status":"new"}' }] };
        calls.push(tool.content);
        return { text: 'I read this account only.', toolCalls: [] };
      }) as ChatModel,
    });
    const session = async (email: string) => {
      const res = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email, password: 'password1', tos: true } });
      return { id: res.json().user.id as string, cookie: String(res.headers['set-cookie']).split(';')[0] };
    };
    const a = await session('a@example.com');
    const b = await session('b@example.com');
    await app.inject({ method: 'POST', url: '/api/leads', headers: { cookie: a.cookie }, payload: { name: 'Dana', phone: '2155550148' } });
    await app.inject({ method: 'POST', url: '/api/leads', headers: { cookie: b.cookie }, payload: { name: 'Bea', phone: '2155550199' } });
    await app.inject({ method: 'POST', url: '/api/chat/ask', headers: { cookie: a.cookie }, payload: { messages: [{ role: 'user', text: 'Show my leads' }] } });
    expect(calls[0]).toContain('Dana');
    expect(calls[0]).not.toContain('Bea');
    const plan = await app.inject({
      method: 'POST', url: '/api/chat/ask', headers: { cookie: a.cookie },
      payload: { messages: [{ role: 'user', text: 'Set up Google Ads for Fishtown at $30 a day for interior and cabinet painting' }] },
    });
    expect(plan.json().plan.dailyBudget).toBe(30);
    expect(plan.json().plan.locations).toEqual(['Fishtown']);
    expect(plan.json().text).toMatch(/Building actions arrives in the next update/);
    expect(plan.json().text).toMatch(/Nothing was created/);
    const saved = await store.getUserData(a.id);
    expect((saved.agentIntents as { dailyBudget: number }[])[0]?.dailyBudget).toBe(30);
    expect(saved.miles).toBeUndefined();
    await app.close();
  });

  it('answers from the snapshot when the model is down and does not invent a live spend', async () => {
    const snapshot = buildAccountSnapshot({
      tenantId: 't',
      sampleConnector: true,
      profile: { businessName: 'Painters In Philly', industry: 'Painting' },
      completeness: { percent: 40, filled: 4, total: 10, missing: [], gbp: '' },
      phase: 'plan',
      mode: 'hybrid',
      caps: { dailyBudget: 40, maxChangePct: 10, monthlyCeiling: 600, paused: false },
      tracking: null,
      plan: null,
      milesCampaign: null,
      journey: null,
      spendRows: [],
      spendReadAt: null,
      bookedFromJobs: null,
      bookedFromDeals: null,
      google: { oauth: false, ready: false, customerId: null, note: 'Not connected', error: null },
      ghl: { connected: false, detail: 'Not connected' },
      speedToLead: { enabled: false, today: 0, total: 0, held: 0, canSend: false },
      social: { facebook: false, instagram: false, linkedin: false, gbp: false },
      automations: { noShow: false, onboarding: false },
      events: [],
      changeLog: [],
      inbox: [],
      leads: [],
    });
    const out = await answerChat({
      snapshot,
      messages: [{ role: 'user', text: 'How are my ads doing this month?' }],
      model: async () => null,
      readers,
    });
    expect(out.text).toMatch(/Painters In Philly/);
    expect(out.text).toMatch(/No spend has been read/);
    expect(out.text).toMatch(/not connected/i);
    expect(out.plan).toBeNull();
  });
});
