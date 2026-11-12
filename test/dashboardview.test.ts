import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import type { Connector } from '../src/connectors/types.js';
import {
  MODE_PILLS,
  buildOperatorView,
  modeFromPill,
  operatorCopy,
  type OperatorInput,
  type OperatorView,
} from '../src/dashboard/operator.js';

function base(over: Partial<OperatorInput> = {}): OperatorInput {
  return {
    mode: null,
    trade: '',
    market: '',
    dailyBudget: null,
    maxChangePct: null,
    leadsPerDay: null,
    targetCpa: null,
    sampleConnector: true,
    google: { oauth: false, ready: false, note: '' },
    ghlConnected: false,
    ghlDetail: 'GoHighLevel is not connected. Replies stay drafts. Connect it under Integrations.',
    socialConnected: false,
    gbpConnected: false,
    gbpHasData: false,
    paused: false,
    hasBundle: false,
    playbook: null,
    reviewOn: false,
    speedOn: false,
    metrics: [
      { key: 'crm.booked_jobs', value: 22, prior_value: 22, source: 'sample' },
      { key: 'calc.cost_per_booked', value: 83, prior_value: 84, source: 'sample' },
      { key: 'crm.job_revenue', value: 40370, prior_value: 37000, source: 'sample' },
      { key: 'calc.blended_spend', value: 1831, prior_value: 1800, source: 'sample' },
      { key: 'calc.blended_leads', value: 86, prior_value: 78, source: 'sample' },
    ],
    campaigns: [],
    recommendations: [],
    inbox: [],
    ...over,
  };
}

function copy(view: OperatorView): string {
  return operatorCopy(view).join('\n');
}

describe('mode pills', () => {
  it('maps the three labels onto the existing modes and no fourth mode', () => {
    expect(MODE_PILLS.map((p) => p.id)).toEqual(['manual', 'hybrid', 'automate']);
    expect(modeFromPill('Ask me first')).toBe('manual');
    expect(modeFromPill('Hybrid')).toBe('hybrid');
    expect(modeFromPill('Do everything')).toBe('automate');
    expect(modeFromPill('Autopilot')).toBeNull();
  });
});

describe('operator honesty', () => {
  it('tags sample job math and does not invent a 25-job or $100 goal', () => {
    const view = buildOperatorView(base());
    const text = copy(view);
    expect(view.onTrack.bookedSample).toBe(true);
    expect(view.onTrack.costSample).toBe(true);
    expect(view.onTrack.bookedGoal).toBeNull();
    expect(view.onTrack.costGoal).toBeNull();
    expect(view.money.tone).toBe('sample');
    expect(view.money.headline.startsWith('SAMPLE.')).toBe(true);
    expect(text).not.toMatch(/25 goal|\$100/);
    expect(text).not.toMatch(/\u2014/);
    expect(text.toLowerCase()).not.toContain('searchlight');
  });

  it('shows the lead goal against actual leads only when a count is running', () => {
    const hidden = buildOperatorView(base({ leadGoalCount: 8, leadGoalPeriod: 'month' }));
    expect(hidden.onTrack.leadPace).toBeNull();
    const shown = buildOperatorView(base({ leadGoalCount: 8, leadGoalPeriod: 'month', runningLeads: 4 }));
    expect(shown.onTrack.leadPace?.actual).toBe('4');
    expect(shown.onTrack.leadPace?.goal).toBe('8 a month');
    expect(shown.onTrack.leadPace?.headline).toMatch(/4 leads in the last 30 days/);
    expect(shown.onTrack.leadPace?.headline).toMatch(/8 leads a month/);
    expect(shown.onTrack.leadPace?.headline).not.toMatch(/\u2014/);
    const week = buildOperatorView(base({ leadGoalCount: 2, leadGoalPeriod: 'week', runningLeads: 4 }));
    expect(week.onTrack.leadPace?.headline).toMatch(/not one week/);
  });

  it('derives a lead goal from saved leads per day and a cost goal only when saved', () => {
    const view = buildOperatorView(base({
      sampleConnector: false,
      leadsPerDay: 1,
      dailyBudget: 20,
      maxChangePct: 10,
      targetCpa: 80,
      trade: 'Painting',
      market: 'Philadelphia',
      metrics: [
        { key: 'crm.booked_jobs', value: 4, prior_value: 0, source: 'live' },
        { key: 'calc.cost_per_booked', value: 70, prior_value: 0, source: 'live' },
        { key: 'crm.job_revenue', value: 2000, prior_value: 0, source: 'live' },
        { key: 'calc.blended_spend', value: 400, prior_value: 0, source: 'live' },
        { key: 'calc.blended_leads', value: 10, prior_value: 0, source: 'live' },
      ],
    }));
    expect(view.onTrack.bookedGoal).toBe('30 lead goal');
    expect(view.onTrack.costGoal).toBe('under $80 goal');
    expect(view.onTrack.bookedSample).toBe(false);
    expect(view.onTrack.explain).toMatch(/lead goal, not a booked-job target/);
    expect(view.setupLine).toMatch(/Painting/);
    expect(view.setupLine).toMatch(/\$20\/day/);
    expect(view.money.tone).toBe('positive');
    expect(copy(view)).not.toMatch(/\u2014/);
  });

  it('leaves Meta, LSA, and an unresolved Google customer ungraded', () => {
    const view = buildOperatorView(base({
      google: { oauth: true, ready: false, note: 'Google is signed in. The ad customer id is not resolved, so Miles cannot read spend or create a campaign yet.' },
      campaigns: [{ platform: 'facebook', name: 'Spring repaint offer', spend: 389, leads: 18 }],
    }));
    const byId = Object.fromEntries(view.channels.map((c) => [c.id, c]));
    expect(byId.google!.state).toBe('hold');
    expect(byId.google!.grade).toBeNull();
    expect(byId.google!.jobs).toBeNull();
    expect(byId.lsa!.state).toBe('later');
    expect(byId.meta!.state).toBe('later');
    expect(byId.meta!.verdict).toMatch(/not connected/i);
    expect(byId.gbp!.verdict).toMatch(/Not connected/);
    expect(view.breakdown.rows).toEqual([]);
    expect(view.breakdown.empty).toMatch(/customer id is not resolved/i);
    const meta = view.connections.find((c) => c.name === 'Meta');
    expect(meta?.state).toBe('later');
    expect(copy(view)).not.toMatch(/\$389|Spring repaint/);
    expect(view.compare.rows.every((r) => r.you === 'n/a' && r.verdict === 'Not connected')).toBe(true);
    expect(view.compare.headline).not.toMatch(/better than/i);
    expect(view.compare.sourceLine).toMatch(/888/);
    expect(view.compare.sourceLine).not.toMatch(/searchlight/i);
  });

  it('labels preview Google rows as SAMPLE and does not call leads booked jobs', () => {
    const view = buildOperatorView(base({
      google: { oauth: true, ready: false, note: 'Demo mode.' },
      campaigns: [{ platform: 'google_ads', name: 'Emergency Plumbing', spend: 1240, leads: 38 }],
    }));
    const google = view.channels.find((c) => c.id === 'google')!;
    expect(google.state).toBe('sample');
    expect(google.grade).toBeNull();
    expect(google.jobs).toBeNull();
    expect(google.foot.startsWith('SAMPLE.')).toBe(true);
    expect(view.breakdown.sample).toBe(true);
    expect(view.breakdown.rows[0]!.jobs).toBe('n/a');
    expect(view.breakdown.note).toMatch(/SAMPLE/);
  });

  it('does not invent a budget shift when nothing is waiting', () => {
    const view = buildOperatorView(base());
    expect(view.decisions).toEqual([]);
    expect(view.onTrack.action).toBeNull();
    const text = copy(view);
    expect(text).not.toMatch(/Move \$200|Meta to Google/);
  });

  it('keeps a real recommendation and strips em dashes from its title', () => {
    const view = buildOperatorView(base({
      recommendations: [{
        id: 'ads:dead:2026-11-11',
        category: 'ads',
        severity: 'high',
        title: 'Google Ads spent $80 with no leads',
        why: 'Google Ads has spent $80 this period and produced 0 conversions.',
        action: 'Pause Google Ads until the ads are fixed.',
        apply: { kind: 'queue_change', label: 'Pause Google Ads' },
      }],
    }));
    expect(view.decisions).toHaveLength(1);
    expect(view.decisions[0]!.impact).toBe('$80');
    expect(view.onTrack.action?.decisionId).toBe('ads:dead:2026-11-11');
    expect(copy(view)).not.toMatch(/\u2014/);
  });

  it('playbook run kinds stay honest about channels this build cannot launch', () => {
    const view = buildOperatorView(base({ hasBundle: true, dailyBudget: 20 }));
    const kinds = view.playbooks.map((p) => p.runKind);
    expect(kinds).toEqual(['google_plan', 'review', 'speed', 'unavailable']);
    const later = view.playbooks.find((p) => p.id === 'later')!;
    expect(later.runnable).toBe(false);
    expect(later.body).toMatch(/cannot launch Local Services Ads or Meta/);
    expect(view.playbookNote).toMatch(/Hybrid/);
    expect(copy(view)).not.toMatch(/\+4 jobs|\$300\/mo|\$150\/mo/);
  });
});

describe('operator route', () => {
  it('serves the honest empty dashboard for a new account', async () => {
    const connector = {
      name: 'mock',
      async createConnectToken() { return { token: 't', expiresAt: '2099-01-01', connectUrl: 'https://connect.example' }; },
      async listAccounts() { return []; },
      async runAction() { return { ok: false, actionId: 'x', app: 'google_ads', output: null }; },
    } as unknown as Connector;
    const app = buildServer({ authStore: new MemoryStore(), connector });
    const signed = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'dash@example.com', password: 'password1', tos: true, name: 'Paul' } });
    const headers = { cookie: String(signed.headers['set-cookie']).split(';')[0] };
    const res = await app.inject({ method: 'GET', url: '/api/dashboard/operator', headers });
    expect(res.statusCode).toBe(200);
    const view = res.json().operator as OperatorView;
    expect(view.modes.map((m) => m.label)).toEqual(['Ask me first', 'Hybrid', 'Do everything']);
    expect(view.channels.find((c) => c.id === 'meta')!.state).toBe('later');
    expect(view.channels.find((c) => c.id === 'lsa')!.state).toBe('later');
    expect(view.connections.find((c) => c.name === 'Google Ads')!.state).toBe('off');
    expect(view.connections.find((c) => c.name === 'GoHighLevel')!.detail).toMatch(/not connected/i);
    expect(view.money.tone).toBe('sample');
    expect(copy(view)).not.toMatch(/\u2014|searchlight/i);
    expect(copy(view)).not.toMatch(/\$100 goal|25 goal/);
    await app.close();
  });
});
