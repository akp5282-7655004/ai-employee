import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import { MockConnector } from '../src/connectors/mock.js';
import { answerChat } from '../src/chat/ask.js';
import type { ChatModel } from '../src/chat/model.js';
import { chatEmptyLine, chatSuggestions, fallbackAnswer, milesSystemPrompt } from '../src/chat/prompt.js';
import { buildAccountSnapshot, renderSnapshot, type AccountSnapshot, type ChatSources } from '../src/chat/snapshot.js';
import { runChatTool, type ChatReaders } from '../src/chat/tools.js';

function sources(over: Partial<ChatSources> = {}): ChatSources {
  return {
    tenantId: 'tenant-a',
    sampleConnector: false,
    profile: {
      businessName: 'Painters In Philly',
      industry: 'Painting',
      serviceAreas: 'Philadelphia, PA',
      services: 'House painting, Interior painting, Exterior painting',
      website: 'https://paintersinphilly.com',
      gbpUrl: 'https://maps.example/painters',
      phone: '267-333-2939',
    },
    completeness: { percent: 71, filled: 22, total: 31, missing: ['Tagline', 'Job photos'], gbp: 'https://maps.example/painters' },
    phase: 'running',
    mode: 'hybrid',
    caps: { dailyBudget: 40, maxChangePct: 20, monthlyCeiling: 900, paused: false },
    tracking: null,
    plan: {
      name: 'Painters In Philly Search',
      dailyBudget: 40,
      status: 'PAUSED',
      finalUrl: 'https://paintersinphilly.com',
      locations: ['Philadelphia, PA'],
      bidding: 'MAXIMIZE_CLICKS',
    },
    milesCampaign: {
      resource: 'customers/111/campaigns/7',
      status: 'paused',
      name: 'Painters In Philly Search',
      lastReadback: 'Google reports the campaign as PAUSED.',
    },
    journey: {
      ownerId: 'tenant-b',
      rows: [{ resource: 'customers/999/campaigns/42', name: 'Summit Roofing Search', status: 'ENABLED' }],
    },
    spendRows: [],
    spendReadAt: null,
    bookedFromJobs: 2,
    bookedFromDeals: null,
    google: { oauth: true, ready: false, customerId: null, note: 'Google is signed in. The ad customer id is not resolved.', error: null },
    ghl: { connected: false, detail: 'GoHighLevel is not connected. Replies stay drafts.' },
    speedToLead: { enabled: false, today: 0, total: 0, held: 0, canSend: false },
    social: { facebook: true, instagram: false, linkedin: false, gbp: true },
    automations: { noShow: false, onboarding: false },
    events: [{ ts: '2026-11-11T12:00:00.000Z', text: 'Setup saved. Mode hybrid.' }],
    changeLog: [{ ts: '2026-11-11T12:00:00.000Z', kind: 'action', title: 'Setup saved for Painters In Philly' }],
    inbox: [{ id: 'q1', kind: 'enable', title: 'Enable the Google campaign', reason: 'Hybrid mode. This waits for your approval.' }],
    leads: [{ name: 'Sarah Kim', service: 'Kitchen repaint', source: 'Website form', contacted: false }],
    ...over,
  };
}

function otherTenant(): ChatSources {
  return sources({
    tenantId: 'tenant-b',
    profile: {
      businessName: 'Summit Roofing',
      industry: 'Roofing',
      serviceAreas: 'Allentown, PA',
      services: 'Storm repair',
      website: 'https://summit.example',
      phone: '888-555-0199',
    },
    completeness: { percent: 40, filled: 8, total: 20, missing: ['Website'], gbp: '' },
    mode: 'manual',
    caps: { dailyBudget: 15, maxChangePct: 5, monthlyCeiling: 300, paused: true },
    plan: null,
    milesCampaign: { resource: 'customers/999/campaigns/42', status: 'enabled', name: 'Summit Roofing Search' },
    journey: { ownerId: 'tenant-b', rows: [{ resource: 'customers/999/campaigns/42', name: 'Summit Roofing Search', status: 'ENABLED' }] },
    bookedFromJobs: 0,
    google: { oauth: false, ready: false, customerId: null, note: 'Google Ads is not connected.', error: null },
    events: [],
    changeLog: [{ ts: '2026-11-01T00:00:00.000Z', kind: 'action', title: 'Summit Roofing kill switch' }],
    inbox: [],
    leads: [{ name: 'Roof Lead', service: 'Leak', source: 'Call', contacted: true }],
  });
}

const sampleSpend = sources({
  sampleConnector: true,
  spendRows: [
    { platform: 'google_ads', name: 'Emergency Plumbing', spend: 1240, leads: 38 },
    { platform: 'google_ads', name: 'AC Repair Search', spend: 980, leads: 26 },
  ],
  spendReadAt: '2026-11-11T12:00:00.000Z',
  leads: [{ name: 'Sarah Kim', service: 'Kitchen repaint', source: 'Google Ads', contacted: false }],
});

function blob(snapshot: AccountSnapshot): string {
  return `${JSON.stringify(snapshot)}\n${renderSnapshot(snapshot)}`;
}

describe('account snapshot', () => {
  it('keeps this tenant’s fields and drops the other tenant', () => {
    const painters = buildAccountSnapshot(sources());
    const roofing = buildAccountSnapshot(otherTenant());
    const text = blob(painters);
    expect(painters.tenantId).toBe('tenant-a');
    expect(painters.business.name).toBe('Painters In Philly');
    expect(painters.business.trade).toBe('Painting');
    expect(painters.business.location).toBe('Philadelphia, PA');
    expect(painters.business.services).toContain('House painting');
    expect(painters.business.website).toBe('https://paintersinphilly.com');
    expect(painters.business.gbp).toContain('maps.example/painters');
    expect(painters.business.phone).toBe('267-333-2939');
    expect(painters.business.completeness.percent).toBe(71);
    expect(painters.business.missing).toEqual(['Tagline', 'Job photos']);
    expect(painters.miles.mode).toBe('hybrid');
    expect(painters.miles.caps).toMatchObject({ dailyBudget: 40, maxChangePct: 20, monthlyCeiling: 900, paused: false });
    expect(painters.miles.tracking).toBeNull();
    expect(painters.miles.plan?.name).toBe('Painters In Philly Search');
    expect(painters.campaigns.map((row) => row.resource)).toEqual(['customers/111/campaigns/7']);
    expect(painters.campaigns[0]?.lastReadback).toMatch(/PAUSED/);
    expect(painters.performance.bookedJobs).toMatchObject({ value: 2, sample: false });
    expect(painters.inbox[0]?.title).toBe('Enable the Google campaign');
    expect(text).not.toContain('Summit Roofing');
    expect(text).not.toContain('customers/999/campaigns/42');
    expect(text).not.toContain('888-555-0199');
    expect(text).not.toContain('Roof Lead');
    expect(blob(roofing)).toContain('Summit Roofing');
    expect(blob(roofing)).toContain('customers/999/campaigns/42');
    expect(blob(roofing)).not.toContain('Painters In Philly');
    expect(blob(roofing)).not.toContain('267-333-2939');
    expect(blob(roofing)).not.toContain('customers/111/campaigns/7');
  });

  it('labels preview numbers as SAMPLE and leaves live numbers unlabeled', () => {
    const sample = buildAccountSnapshot(sampleSpend);
    const live = buildAccountSnapshot(sources({
      spendRows: [{ platform: 'google_ads', name: 'Painters In Philly Search', spend: 80, leads: 4 }],
      spendReadAt: '2026-11-11T12:00:00.000Z',
    }));
    expect(sample.performance.spend).toMatchObject({ value: 2220, sample: true });
    expect(sample.performance.leads).toMatchObject({ value: 64, sample: true });
    expect(sample.performance.cpl).toMatchObject({ value: 34.69, sample: true });
    expect(sample.leads[0]?.sample).toBe(true);
    const sampleText = renderSnapshot(sample);
    expect(sampleText).toMatch(/SAMPLE \$2220/);
    expect(sampleText).toMatch(/SAMPLE 64/);
    expect(sampleText).toMatch(/SAMPLE \$34\.69/);
    expect(sampleText).toMatch(/not this account's live ads/i);
    expect(sampleText).toMatch(/example rows, not a live CRM/i);
    const liveText = renderSnapshot(live);
    expect(live.performance.spend.sample).toBe(false);
    expect(liveText).not.toMatch(/SAMPLE/);
    expect(liveText).toContain('$80');
    expect(liveText).toContain('From the spend snapshot');
  });
});

describe('chat turn', () => {
  const readers: ChatReaders = {
    campaignStatus: async () => ({ onFile: 'customers/111/campaigns/7', liveRead: { sample: true, note: 'SAMPLE. Not a live Google read.' } }),
    integrations: async () => ({ google: 'signed in, customer id not resolved', ghl: 'not connected for Painters In Philly' }),
    leads: async () => ({ sample: true, leads: ['Sarah Kim'] }),
    changeLog: async () => ({ events: ['Setup saved for Painters In Philly'] }),
  };

  it('gives the mocked model this account snapshot and no other tenant', async () => {
    const snapshot = buildAccountSnapshot(sampleSpend);
    let seen = '';
    const model: ChatModel = async (req) => {
      seen = req.system;
      expect(req.tools.map((tool) => tool.name).sort()).toEqual(['campaign_status', 'change_log', 'integrations', 'leads']);
      return { text: 'Google Ads is signed in and the customer id is not resolved.', toolCalls: [] };
    };
    const out = await answerChat({
      snapshot,
      messages: [{ role: 'user', text: 'which one of my integrations are connected' }],
      model,
      readers,
    });
    expect(seen).toBe(milesSystemPrompt(snapshot));
    expect(seen).toContain('Painters In Philly');
    expect(seen).toContain('customers/111/campaigns/7');
    expect(seen).toContain('SAMPLE $2220');
    expect(seen).not.toContain('Summit Roofing');
    expect(seen).not.toContain('customers/999/campaigns/42');
    expect(seen).not.toMatch(/\u2014|\u2013/);
    expect(out.live).toBe(true);
    expect(out.text).toMatch(/customer id is not resolved/);
  });

  it('passes a read-only tool result back to the model and refuses writes', async () => {
    const snapshot = buildAccountSnapshot(sources());
    const prompts: string[] = [];
    let round = 0;
    const model: ChatModel = async (req) => {
      round += 1;
      prompts.push(req.messages.map((message) => message.content).join('\n'));
      if (round === 1) return { text: null, toolCalls: [{ id: 'c1', name: 'integrations', arguments: '{"tenantId":"tenant-b"}' }] };
      return { text: 'GoHighLevel is not connected for Painters In Philly.', toolCalls: [] };
    };
    const out = await answerChat({
      snapshot,
      messages: [{ role: 'user', text: 'which one of my integrations are connected' }],
      model,
      readers,
    });
    expect(prompts[1]).toContain('not connected for Painters In Philly');
    expect(prompts[1]).not.toContain('Summit Roofing');
    expect(out.text).toMatch(/GoHighLevel is not connected/);
    const refused = await runChatTool('pause_campaign', readers);
    expect(refused).toMatch(/read-only/i);
  });

  it('answers the three owner questions from the snapshot when the model is down', () => {
    const snapshot = buildAccountSnapshot(sampleSpend);
    const check = fallbackAnswer(snapshot, 'check campaign status');
    const role = fallbackAnswer(snapshot, 'what are you here to do');
    const integrations = fallbackAnswer(snapshot, 'which one of my integrations are connected');
    for (const text of [check, role, integrations]) {
      expect(text).toContain('Painters In Philly');
      expect(text).not.toMatch(/as an ai|don't have direct access|log into|navigate to settings|market analysis/i);
      expect(text).not.toMatch(/\u2014|\u2013/);
      expect(text).not.toContain('Summit Roofing');
    }
    expect(check).toMatch(/SAMPLE/);
    expect(check).toMatch(/not resolved/i);
    expect(check).toMatch(/paused/i);
    expect(role).toMatch(/Hybrid/);
    expect(role).not.toMatch(/\bautomate\b|\bhybrid\b/);
    expect(role).toMatch(/\$40\/day/);
    expect(integrations).toMatch(/GoHighLevel is not connected/);
    expect(integrations).toMatch(/coming later/i);
  });

  it('suggests questions from this account only', () => {
    const painters = buildAccountSnapshot(sampleSpend);
    const roofing = buildAccountSnapshot(otherTenant());
    expect(chatEmptyLine(painters)).toContain('Painters In Philly');
    expect(chatEmptyLine(painters)).not.toContain('Summit Roofing');
    expect(chatSuggestions(painters).map((row) => row.ask)).toEqual([
      'What are you here to do?',
      'Which of my integrations are connected?',
      'Check my campaign status.',
      'Are the spend numbers real?',
    ]);
    expect(chatSuggestions(roofing).map((row) => row.ask)).toContain('Why are you paused?');
    expect(JSON.stringify(chatSuggestions(painters))).not.toContain('Summit');
    expect(JSON.stringify(chatSuggestions(roofing))).not.toContain('Painters');
  });
});

describe('chat route', () => {
  it('sends the signed-in tenant snapshot to the model', async () => {
    const store = new MemoryStore();
    const connector = new MockConnector();
    const seen: { id: string; system: string }[] = [];
    const app = buildServer({
      authStore: store,
      connector,
      chatModel: async (req) => {
        seen.push({ id: req.system, system: req.system });
        return { text: 'Using the account snapshot.', toolCalls: [] };
      },
    });
    const session = async (email: string) => {
      const res = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email, password: 'password1', tos: true } });
      const body = res.json() as { user: { id: string } };
      const raw = res.headers['set-cookie'];
      const cookie = String(Array.isArray(raw) ? raw[0] : raw).split(';')[0] ?? '';
      return { id: body.user.id, cookie };
    };
    const painters = await session('painters@example.com');
    const roofing = await session('roofing@example.com');
    await app.inject({
      method: 'PUT', url: '/api/profile', headers: { cookie: painters.cookie },
      payload: { businessName: 'Painters In Philly', industry: 'Painting', serviceAreas: 'Philadelphia, PA', services: 'House painting', website: 'https://paintersinphilly.com', phone: '267-333-2939' },
    });
    await app.inject({
      method: 'PUT', url: '/api/profile', headers: { cookie: roofing.cookie },
      payload: { businessName: 'Summit Roofing', industry: 'Roofing', serviceAreas: 'Allentown, PA', services: 'Storm repair', phone: '888-555-0199' },
    });
    connector.connect(painters.id, 'google_ads');
    const ask = (cookie: string, text: string) => app.inject({
      method: 'POST', url: '/api/chat/ask', headers: { cookie },
      payload: { messages: [{ role: 'user', text }], mode: 'medium' },
    });
    const a = await ask(painters.cookie, 'check campaign status');
    const b = await ask(roofing.cookie, 'what are you here to do');
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(seen[0]?.system).toContain('Painters In Philly');
    expect(seen[0]?.system).toContain('House painting');
    expect(seen[0]?.system).toContain('267-333-2939');
    expect(seen[0]?.system).toMatch(/SAMPLE/);
    expect(seen[0]?.system).not.toContain('Summit Roofing');
    expect(seen[0]?.system).not.toContain('888-555-0199');
    expect(seen[1]?.system).toContain('Summit Roofing');
    expect(seen[1]?.system).toContain('Storm repair');
    expect(seen[1]?.system).not.toContain('Painters In Philly');
    expect(seen[1]?.system).not.toContain('267-333-2939');
    expect(seen[1]?.system).not.toContain('Emergency Plumbing');
    const starters = await app.inject({ method: 'GET', url: '/api/chat/starters', headers: { cookie: painters.cookie } });
    expect(starters.statusCode).toBe(200);
    const starterBody = starters.json() as { businessName: string; line: string; suggestions: { ask: string }[] };
    expect(starterBody.businessName).toBe('Painters In Philly');
    expect(starterBody.line).toContain('Painters In Philly');
    expect(starterBody.line).not.toContain('Summit Roofing');
    expect(starterBody.suggestions.map((row) => row.ask)).toContain('Which of my integrations are connected?');
    await app.close();
  });
});
