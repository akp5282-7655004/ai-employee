import { describe, expect, it } from 'vitest';
import { applyMeter, summarizeUsage, periodOf, CREDIT_COST, MONTHLY_ALLOWANCE } from '../src/usage/meter.js';
import { aggregateNetwork } from '../src/usage/network.js';
import { deliveryStatus, smsExcerpt } from '../src/delivery/send.js';

describe('credit metering', () => {
  const aug = new Date('2026-08-12T10:00:00Z');
  it('accumulates counts and credits within a month', () => {
    let u = applyMeter(undefined, 'image', aug);
    u = applyMeter(u, 'image', aug);
    u = applyMeter(u, 'text', aug);
    expect(u.actions.image).toBe(2);
    expect(u.actions.text).toBe(1);
    expect(u.credits).toBe(CREDIT_COST.image * 2 + CREDIT_COST.text);
    expect(u.period).toBe('2026-08');
  });
  it('resets cleanly when the month rolls over', () => {
    const july = applyMeter(undefined, 'video', new Date('2026-07-31T23:00:00Z'));
    const rolled = applyMeter(july, 'text', aug);
    expect(rolled.period).toBe('2026-08');
    expect(rolled.actions.video).toBeUndefined();
    expect(rolled.credits).toBe(CREDIT_COST.text);
  });
  it('summarizes into a bar + breakdown, only non-zero rows', () => {
    const u = applyMeter(applyMeter(undefined, 'audit', aug), 'agent_run', aug);
    const s = summarizeUsage(u, aug);
    expect(s.allowance).toBe(MONTHLY_ALLOWANCE);
    expect(s.rows.map((r) => r.kind).sort()).toEqual(['agent_run', 'audit']);
    expect(s.pct).toBe(Math.round((s.credits / MONTHLY_ALLOWANCE) * 100));
  });
  it('reports zero for a stale (previous-month) record', () => {
    const s = summarizeUsage(applyMeter(undefined, 'image', new Date('2026-06-01T00:00:00Z')), aug);
    expect(s.credits).toBe(0);
    expect(s.rows).toHaveLength(0);
  });
  it('breakdown rows reconcile with the total when a model overrides the flat cost', () => {
    // A premium image model costs 12 (not the flat 5); the row must reflect the
    // real charge so the breakdown sums to the credit total shown above it.
    let u = applyMeter(undefined, 'image', aug, 1, 12); // flux-pro
    u = applyMeter(u, 'image', aug); // a default image at flat 5
    const s = summarizeUsage(u, aug);
    const imageRow = s.rows.find((r) => r.kind === 'image')!;
    expect(imageRow.count).toBe(2);
    expect(imageRow.credits).toBe(17); // 12 + 5, not 2 × 5
    expect(s.rows.reduce((a, r) => a + r.credits, 0)).toBe(s.credits); // rows sum to total
  });
  it('periodOf formats YYYY-MM', () => {
    expect(periodOf(new Date('2026-01-05T00:00:00Z'))).toBe('2026-01');
  });
});

describe('network learning', () => {
  const signals = [
    { trade: 'Plumbing', agentTasks: ['email_tasklist', 'review_responder'], targetCpa: 85, agentRuns: 10 },
    { trade: 'Plumbing', agentTasks: ['email_tasklist'], targetCpa: 95, agentRuns: 4 },
    { trade: 'Roofing', agentTasks: ['seo_agent'], targetCpa: 120, agentRuns: 2 },
  ];
  it('aggregates counts, top agents, and a median CPA — no PII', () => {
    const n = aggregateNetwork(signals, 'Plumbing');
    expect(n.workspaces).toBe(3);
    expect(n.byTrade[0]).toEqual({ trade: 'Plumbing', count: 2 });
    expect(n.topAgents[0]).toEqual({ task: 'email_tasklist', count: 2 });
    expect(n.totalAgentsDeployed).toBe(4);
    expect(n.totalAgentRuns).toBe(16);
    expect(n.medianTargetCpa).toBe(95);
    expect(n.yourTrade).toBe('Plumbing');
    expect(n.yourTradeCount).toBe(2);
  });
  it('is honest and empty with no workspaces', () => {
    const n = aggregateNetwork([]);
    expect(n.workspaces).toBe(0);
    expect(n.medianTargetCpa).toBeNull();
  });
});

describe('delivery', () => {
  it('reports channels off when no provider keys are set', () => {
    const prev = { r: process.env.RESEND_API_KEY, s: process.env.TWILIO_ACCOUNT_SID };
    delete process.env.RESEND_API_KEY;
    delete process.env.TWILIO_ACCOUNT_SID;
    const st = deliveryStatus();
    expect(st.email).toBe(false);
    expect(st.sms).toBe(false);
    if (prev.r) process.env.RESEND_API_KEY = prev.r;
    if (prev.s) process.env.TWILIO_ACCOUNT_SID = prev.s;
  });
  it('smsExcerpt keeps it short and points to the dashboard', () => {
    const x = smsExcerpt('Morning task list — Monday', 'line1\nline2\nline3\nline4\nline5\nline6');
    expect(x).toContain('Morning task list');
    expect(x).toContain('Miles');
    expect(x.length).toBeLessThanOrEqual(1500);
  });
});
