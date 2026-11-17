import { describe, expect, it } from 'vitest';
import { isOptedOut, isStopMessage, quietForLead } from '../src/agents/smsguard.js';
import { accessOpen } from '../src/billing/subscription.js';
import { recIsOpen } from '../src/agents/recommend.js';

describe('one rule where both launch fixes overlapped', () => {
  it('treats either opt-out list and either STOP word list as an opt-out', () => {
    expect(isOptedOut({ optOutPhones: ['(215) 555-0100'] }, '2155550100')).toBe(true);
    expect(isOptedOut({ smsOptOuts: ['+12155550100'] }, '215-555-0100')).toBe(true);
    expect(isStopMessage('STOPALL')).toBe(true);
    expect(isStopMessage('stop please call')).toBe(false);
  });

  it('holds a text when it is quiet for the owner or where the lead is', () => {
    // 01:30 UTC: 7:30 PM US Central (owner default, not quiet), 8:30 PM Eastern.
    const at = Date.parse('2026-11-17T01:30:00.000Z');
    expect(quietForLead({}, at, '4795550101')).toBe(false);
    expect(quietForLead({}, at, '2155550100')).toBe(true);
    expect(quietForLead({ speedToLead: { quietHours: { enabled: false, tzOffsetMinutes: 0 } } }, at, '2155550100')).toBe(false);
  });

  it('keeps a paid-up canceled plan to period end, stops an unpaid one now, and keeps the grace', () => {
    const now = Date.parse('2026-11-20T00:00:00.000Z');
    expect(accessOpen({ status: 'canceled', currentPeriodEnd: '2026-12-01T00:00:00.000Z', accessEndsAt: '2026-11-19T00:00:00.000Z' }, now)).toBe(false);
    expect(accessOpen({ status: 'past_due', pastDueSince: '2026-11-18T00:00:00.000Z' }, now)).toBe(true);
    expect(accessOpen({ status: 'past_due', pastDueSince: '2026-11-01T00:00:00.000Z' }, now)).toBe(false);
    expect(accessOpen({})).toBe(false);
  });

  it('hides a dismissed recommendation until its reason changes', () => {
    const st = { dismissed: { 'budget-low': 'Spend is under target' } };
    expect(recIsOpen(st, 'budget-low:2026-11-20', 'Spend is under target')).toBe(false);
    expect(recIsOpen(st, 'budget-low:2026-11-21', 'Leads fell 40%')).toBe(true);
    expect(recIsOpen({ dismissed: { 'x': '2026-11-20T10:00:00.000Z' } }, 'x:2026-11-21', 'anything')).toBe(false);
  });
});
