import { describe, expect, it } from 'vitest';
import { appendApproval, approvalLog, defaultAutonomy, normalizeAutonomy, TOS_VERSION } from '../src/agents/approvallog.js';

describe('Approval Log', () => {
  it('appends newest-first and reads back', () => {
    const data: Record<string, unknown> = {};
    appendApproval(data, { id: 'a', ts: '2026-08-16T10:00:00Z', kind: 'proposal', actor: 'miles', source: 'loser-pauser', title: 'Pause X' });
    appendApproval(data, { id: 'b', ts: '2026-08-16T10:05:00Z', kind: 'approval', actor: 'paul@smbhacker.com', source: 'loser-pauser', title: 'Approved' });
    const log = approvalLog(data);
    expect(log.length).toBe(2);
    expect(log[0]!.kind).toBe('approval');
    expect(log[1]!.actor).toBe('miles');
  });

  it('caps the log without dropping the newest entries', () => {
    const data: Record<string, unknown> = {};
    for (let i = 0; i < 2100; i++) appendApproval(data, { id: String(i), ts: '2026-01-01T00:00:00Z', kind: 'action', actor: 'miles', source: 't', title: `e${i}` });
    const log = approvalLog(data);
    expect(log.length).toBe(2000);
    expect(log[0]!.title).toBe('e2099');
  });
});

describe('Autonomy Settings', () => {
  it('defaults to proposal mode with sane caps', () => {
    const d = defaultAutonomy();
    expect(d.perSkill).toEqual({});
    expect(d.caps.maxDailyMovePct).toBe(20);
    expect(d.caps.floorDailyBudget).toBe(5);
  });

  it('normalizes untrusted input — bad values fall back, bounds clamp', () => {
    const n = normalizeAutonomy({ perSkill: { 'budget-shifter': 'auto', evil: 'delete-everything' }, caps: { maxDailyMovePct: 500, floorDailyBudget: -3, monthlyCeiling: 'x' } });
    expect(n.perSkill['budget-shifter']).toBe('auto');
    expect(n.perSkill.evil).toBeUndefined();
    expect(n.caps.maxDailyMovePct).toBe(100); // clamped
    expect(n.caps.floorDailyBudget).toBe(0); // clamped
    expect(n.caps.monthlyCeiling).toBe(0); // fallback
    expect(normalizeAutonomy(null)).toEqual(defaultAutonomy());
  });

  it('exposes a ToS version for account stamping', () => {
    expect(TOS_VERSION).toMatch(/^v\d/);
  });
});
