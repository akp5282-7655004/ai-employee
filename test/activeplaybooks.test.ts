import { describe, expect, it } from 'vitest';
import { activePlaybooks } from '../src/agents/activeplaybooks.js';
import { asksMode, fallbackAnswer, modeAnswer, spendLeadAnswer } from '../src/chat/prompt.js';
import { buildAccountSnapshot, type ChatSources } from '../src/chat/snapshot.js';

describe('active playbooks', () => {
  it('names the painting Google Search playbook and speed-to-lead with real fields', () => {
    const rows = activePlaybooks({
      trade: 'Painting',
      business: 'Painters In Philly',
      planTitle: 'Painting in Philadelphia',
      activation: 'paused',
      dailyBudget: 20,
      monthlyCeiling: 600,
      spend: 0,
      leads: 0,
      speedOn: true,
      speedToday: 2,
      speedTotal: 5,
    });
    expect(rows.map((row) => row.id)).toEqual(['google-search', 'speed-to-lead']);
    const google = rows[0]!;
    expect(google.title).toBe('Google Search painting playbook');
    expect(google.status).toBe('Paused');
    expect(google.budget).toBe('$20 a day, $600 a month');
    expect(google.results).toMatch(/\$0 spend and 0 leads/);
    expect(google.runs).toMatch(/Painters In Philly/);
    expect(google.runs).toMatch(/paused Google Search/);
    const speed = rows[1]!;
    expect(speed.title).toBe('Speed-to-lead');
    expect(speed.status).toBe('On');
    expect(speed.results).toMatch(/2 answered today, 5 in total/);
    for (const row of rows) {
      expect(row.runs.length).toBeGreaterThan(20);
      expect(row.budget.length).toBeGreaterThan(0);
      expect(row.results.length).toBeGreaterThan(0);
      expect(row.status).not.toMatch(/automate/);
    }
  });
});

describe('chat mode and spend wording', () => {
  const sources: ChatSources = {
    tenantId: 't',
    sampleConnector: false,
    profile: { businessName: 'Painters In Philly', industry: 'Painting' },
    completeness: { percent: 80, filled: 8, total: 10, missing: [], gbp: '' },
    phase: 'ready',
    mode: 'automate',
    caps: { dailyBudget: 20, maxChangePct: 10, monthlyCeiling: 600, paused: false },
    tracking: null,
    plan: null,
    milesCampaign: null,
    journey: null,
    spendRows: [],
    spendReadAt: null,
    bookedFromJobs: null,
    bookedFromDeals: null,
    google: { oauth: true, ready: true, customerId: '9013698905', note: '', error: null },
    ghl: { connected: false, detail: 'GoHighLevel is not connected.' },
    speedToLead: { enabled: false, canSend: false, today: 0, total: 0, held: 0 },
    social: { facebook: false, instagram: false, linkedin: false, gbp: false },
    automations: { noShow: false, onboarding: false },
    events: [],
    changeLog: [],
    inbox: [],
    leads: [],
  };

  it('answers the mode with the label the owner sees', () => {
    const snapshot = buildAccountSnapshot(sources);
    expect(asksMode('what mode are you in')).toBe(true);
    const text = modeAnswer(snapshot);
    expect(text).toBe('The mode is Do everything.');
    expect(text).not.toMatch(/\bautomate\b/);
    expect(fallbackAnswer(snapshot, 'what mode are you in')).toBe(text);
  });

  it('states the period on a live spend read and does not add filler', () => {
    const text = spendLeadAnswer({ connected: true, sample: false, period: 'the last 30 days', readOk: true, spend: 0, leads: 0 });
    expect(text).toMatch(/the last 30 days/);
    expect(text).toMatch(/\$0 spend and 0 leads/);
    expect(text.toLowerCase()).not.toMatch(/feel free to ask/);
    const missed = spendLeadAnswer({ connected: true, sample: false, period: 'the last 30 days', readOk: false, spend: null, leads: null });
    expect(missed).toMatch(/will not guess/);
  });
});
