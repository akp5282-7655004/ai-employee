import { describe, expect, it } from 'vitest';
import { STATUS_NOT_READ, statusWords } from '../src/agents/enablecheck.js';
import { buildAccountSnapshot, type ChatSources } from '../src/chat/snapshot.js';
import { answerChat } from '../src/chat/ask.js';
import type { ChatModel } from '../src/chat/model.js';
import type { ChatReaders } from '../src/chat/tools.js';

/**
 * UNKNOWN is how the code marks a status read that did not come back. It was
 * handed to chat as is, so Miles told the owner the campaign's status was
 * "UNKNOWN", which reads like something Google said.
 */
function sources(over: Partial<ChatSources> = {}): ChatSources {
  return {
    tenantId: 't',
    sampleConnector: false,
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
    google: { oauth: true, ready: true, customerId: '5550001111', note: 'Connected', error: null },
    ghl: { connected: false, detail: 'Not connected' },
    speedToLead: { enabled: false, today: 0, total: 0, held: 0, canSend: false },
    social: { facebook: false, instagram: false, linkedin: false, gbp: false },
    automations: { noShow: false, onboarding: false },
    events: [],
    changeLog: [],
    inbox: [],
    leads: [],
    ...over,
  } as ChatSources;
}

describe('a campaign status in words', () => {
  it('never prints UNKNOWN, and keeps the statuses Google does report', () => {
    for (const raw of ['UNKNOWN', 'unknown', '', undefined, null, 'UNSPECIFIED']) expect(statusWords(raw), String(raw)).toBe(STATUS_NOT_READ);
    expect(statusWords('ENABLED')).toBe('enabled');
    expect(statusWords('PAUSED')).toBe('paused');
    expect(statusWords('created_paused')).toBe('created paused');
  });

  it('the account snapshot chat reads from carries words, for every place a status is stored', () => {
    const snapshot = buildAccountSnapshot(sources({
      milesCampaign: { resource: 'customers/1/campaigns/2233', status: 'UNKNOWN', name: 'Painters In Philly | Search', lastReadback: 'Could not read status, retrying.' },
      journey: { ownerId: 't', rows: [{ resource: 'customers/1/campaigns/9', name: 'Older campaign', status: 'UNKNOWN' }, { resource: 'customers/1/campaigns/10', name: 'Paused one', status: 'PAUSED' }] },
    }));
    expect(snapshot.campaigns.map((c) => c.status)).toEqual([STATUS_NOT_READ, STATUS_NOT_READ, 'paused']);
    expect(JSON.stringify(snapshot.campaigns)).not.toMatch(/UNKNOWN|"unknown"/);
  });

  it('Miles answers a campaign question without the word', async () => {
    const snapshot = buildAccountSnapshot(sources({
      milesCampaign: { resource: 'customers/1/campaigns/2233', status: 'UNKNOWN', name: 'Painters In Philly | Search' },
    }));
    const readers: ChatReaders = {
      campaignStatus: async () => ({ onFile: snapshot.campaigns }),
      integrations: async () => ({}),
      leads: async () => ({ leads: [] }),
      changeLog: async () => ({ events: [] }),
    };
    // With no model reply, chat falls back to the answer it builds from the snapshot.
    const model: ChatModel = async () => { throw new Error('model unavailable'); };
    const reply = await answerChat({ snapshot, messages: [{ role: 'user', text: 'Do I have a campaign on file?' }], model, readers });
    expect(reply.text).toMatch(/Painters In Philly \| Search is on file/);
    expect(reply.text).toMatch(/has not been read from Google yet/);
    expect(reply.text).not.toMatch(/unknown/i);
  });
});
