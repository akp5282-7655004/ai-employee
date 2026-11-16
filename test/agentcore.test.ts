import { describe, expect, it, vi } from 'vitest';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import { parseActionIntent } from '../src/chat/intent.js';
import { runChatTool, type ChatReaders } from '../src/chat/tools.js';
import { answerChat } from '../src/chat/ask.js';
import { fallbackAnswer } from '../src/chat/prompt.js';
import { buildAccountSnapshot, type ChatSources } from '../src/chat/snapshot.js';
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
    expect(out.text).toMatch(/^Google Ads is not connected yet, so I cannot see spend or leads this month\./);
    expect(out.text).not.toMatch(/a company|this business/);
    expect(out.text.match(/No campaign is on file/g) || []).toHaveLength(0);
    expect(out.steps).toContain('Checking campaigns...');
    expect(out.next).toEqual({ label: 'Connect Google Ads', page: 'integrations' });
    expect(out.plan).toBeNull();
  });

  it('does not repeat the campaign line or dump more than 3 missing items', () => {
    const snapshot = buildAccountSnapshot({
      tenantId: 't',
      sampleConnector: true,
      profile: { businessName: '', industry: '' },
      completeness: { percent: 0, filled: 0, total: 10, missing: ['Name', 'Trade', 'Phone', 'Website', 'Services', 'City'], gbp: '' },
      phase: 'plan',
      mode: null,
      caps: null,
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
    const ads = fallbackAnswer(snapshot, 'How are my ads doing this month?');
    expect(ads.startsWith('Google Ads is not connected yet')).toBe(true);
    expect((ads.match(/No campaign is on file/g) || []).length).toBe(0);
    expect(ads).not.toMatch(/Website|Services|City/);
    const role = fallbackAnswer(snapshot, 'what are you here to do');
    expect(role).not.toMatch(/a company/);
    expect(role).toMatch(/this account/);
    expect(role).toMatch(/Name, Trade, Phone/);
    expect(role).toMatch(/3 more/);
    expect(role).not.toMatch(/Website/);
  });

  it('shows Checking campaigns when the model reads campaigns', async () => {
    const out = await answerChat({
      snapshot: buildAccountSnapshot({
        tenantId: 't',
        sampleConnector: false,
        profile: { businessName: 'Painters In Philly', industry: 'Painting' },
        completeness: { percent: 50, filled: 5, total: 10, missing: [], gbp: '' },
        phase: 'plan',
        mode: 'hybrid',
        caps: null,
        tracking: null,
        plan: null,
        milesCampaign: null,
        journey: null,
        spendRows: [],
        spendReadAt: null,
        bookedFromJobs: null,
        bookedFromDeals: null,
        google: { oauth: true, ready: true, customerId: '111', note: 'Ready', error: null },
        ghl: { connected: false, detail: 'Not connected' },
        speedToLead: { enabled: false, today: 0, total: 0, held: 0, canSend: false },
        social: { facebook: false, instagram: false, linkedin: false, gbp: false },
        automations: { noShow: false, onboarding: false },
        events: [],
        changeLog: [],
        inbox: [],
        leads: [],
      }),
      messages: [{ role: 'user', text: 'How are my ads doing this month?' }],
      model: async (req) => {
        if (!req.messages.some((message) => message.role === 'tool')) {
          return { text: null, toolCalls: [{ id: 'c1', name: 'get_campaigns', arguments: '{}' }] };
        }
        return { text: 'Google Ads is connected. No spend has been read this month.', toolCalls: [] };
      },
      readers,
    });
    expect(out.steps).toContain('Checking campaigns...');
    expect(out.text.startsWith('Google Ads is connected')).toBe(true);
    expect(out.live).toBe(true);
  });
});

function groundSnapshot(over: Partial<ChatSources> = {}) {
  return buildAccountSnapshot({
    tenantId: 'tenant-ground',
    sampleConnector: true,
    profile: { businessName: 'Secret Painters', industry: 'Painting' },
    completeness: { percent: 40, filled: 4, total: 10, missing: [], gbp: '' },
    phase: 'plan',
    mode: 'hybrid',
    caps: null,
    tracking: null,
    plan: { name: 'Search', dailyBudget: 40, status: 'PAUSED', finalUrl: 'https://example.com', locations: ['Philadelphia'], bidding: 'MAXIMIZE_CLICKS' },
    milesCampaign: { status: 'paused', name: 'Search' },
    journey: null,
    spendRows: [{ platform: 'google', name: 'Search', spend: 80, leads: 4 }],
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
    ...over,
  });
}

describe('grounded chat numbers', () => {
  it('retries an invented cost per lead and the final answer drops it', async () => {
    const warns: string[] = [];
    const spy = vi.spyOn(console, 'warn').mockImplementation((message?: unknown) => { warns.push(String(message)); });
    let calls = 0;
    const model: ChatModel = async (req) => {
      calls += 1;
      const retry = req.messages.some((message) => message.content.includes('not in the tool results'));
      if (!retry) return { text: 'Your cost per lead is $42.', toolCalls: [] };
      return { text: 'Cost per lead is not in the tool data.', toolCalls: [] };
    };
    const out = await answerChat({
      snapshot: groundSnapshot(),
      messages: [{ role: 'user', text: 'What is my cost per lead?' }],
      model,
      readers,
    });
    spy.mockRestore();
    expect(calls).toBe(2);
    expect(out.text).not.toMatch(/42/);
    expect(out.text).toMatch(/not in the tool data/);
    const logged = warns.join('\n');
    expect(logged).toContain('ungrounded_chat_number');
    expect(logged).toContain('tenant-ground');
    expect(logged).toContain('$42');
    expect(logged).not.toContain('Secret Painters');
  });

  it('keeps a grounded dollar, percent, and shorthand figure', async () => {
    let calls = 0;
    const model: ChatModel = async (req) => {
      calls += 1;
      if (!req.messages.some((message) => message.role === 'tool')) {
        return { text: null, toolCalls: [{ id: 'c1', name: 'get_metrics', arguments: '{}' }] };
      }
      return { text: 'Spend is $1,234.50, the close rate is 12%, and impressions are 1.2k.', toolCalls: [] };
    };
    const out = await answerChat({
      snapshot: groundSnapshot(),
      messages: [{ role: 'user', text: 'Read the metrics.' }],
      model,
      readers: { ...readers, metrics: async () => ({ spend: 1234.5, rate: 0.12, impressions: 1200 }) },
    });
    expect(calls).toBe(2);
    expect(out.text).toContain('$1,234.50');
    expect(out.text).toContain('12%');
    expect(out.text).toContain('1.2k');
  });

  it('keeps a number the owner already typed', async () => {
    let calls = 0;
    const model: ChatModel = async () => {
      calls += 1;
      return { text: 'I will plan around your $30.', toolCalls: [] };
    };
    const out = await answerChat({
      snapshot: groundSnapshot(),
      messages: [
        { role: 'user', text: 'My budget is $30 a day.' },
        { role: 'assistant', text: 'Got it.' },
        { role: 'user', text: 'Use that budget.' },
      ],
      model,
      readers,
    });
    expect(calls).toBe(1);
    expect(out.text).toContain('$30');
  });

  it('says not tracked yet when no tool data supports a number', async () => {
    const model: ChatModel = async () => ({ text: 'CPL is $42.', toolCalls: [] });
    const invented = await answerChat({
      snapshot: groundSnapshot(),
      messages: [{ role: 'user', text: 'What is my cost per lead?' }],
      model,
      readers,
    });
    expect(invented.text).toMatch(/not tracked yet/);
    expect(invented.text).not.toMatch(/\d/);

    const offline = await answerChat({
      snapshot: groundSnapshot(),
      messages: [{ role: 'user', text: 'Check campaign status.' }],
      model: async () => null,
      readers,
    });
    expect(offline.text).toMatch(/not tracked yet/);
    expect(offline.text).not.toMatch(/\d/);
    expect(offline.text).not.toContain('80');
    expect(offline.text).not.toContain('42');
  });
});
