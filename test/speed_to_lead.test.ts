import { describe, expect, it } from 'vitest';
import {
  emptyState,
  leadKey,
  selectNewLeads,
  instantReplyAgent,
  fallbackInstantReply,
  smsFromReply,
  responseSeconds,
  recordContact,
  responderStats,
  missedCallText,
  type SpeedToLeadState,
} from '../src/agents/speed_to_lead.js';
import type { Lead } from '../src/connectors/types.js';

describe('leadKey', () => {
  it('prefers a stable CRM id', () => {
    expect(leadKey({ id: 'abc', name: 'Jo' })).toBe('id:abc');
  });
  it('falls back to content and is case-insensitive', () => {
    const a = leadKey({ name: 'Jo Smith', service: 'AC repair', source: 'Web' });
    const b = leadKey({ name: 'jo smith', service: 'ac repair', source: 'web' });
    expect(a).toBe(b);
  });
});

describe('selectNewLeads', () => {
  const leads: Lead[] = [
    { id: '1', name: 'A' },
    { id: '2', name: 'B', contacted: true }, // CRM already handled
    { id: '3', name: 'C' },
    { id: '1', name: 'A' }, // duplicate in same batch
  ];
  it('skips contacted, already-known, and in-batch duplicates', () => {
    const fresh = selectNewLeads(leads, ['id:3']);
    expect(fresh.map((l) => l.id)).toEqual(['1']); // 2 contacted, 3 known, 4 dup of 1
  });
  it('caps per tick to avoid a send burst', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ id: String(i) }));
    expect(selectNewLeads(many, [], 10)).toHaveLength(10);
  });
});

describe('instantReplyAgent', () => {
  it('references the lead and demands TEXT + EMAIL', () => {
    const { system, user } = instantReplyAgent(
      { name: 'Dana', service: 'water heater', source: 'Google', message: 'no hot water' },
      { business: 'Rivera Plumbing', city: 'Austin' },
    );
    expect(system).toContain('TEXT:');
    expect(system).toContain('EMAIL:');
    expect(user).toContain('Dana');
    expect(user).toContain('water heater');
    expect(user).toContain('no hot water');
  });
});

describe('missedCallText', () => {
  it('personalizes with the first name and business, and says we missed the call', () => {
    const t = missedCallText({ business: 'Philly Roofing Co' }, 'Dana Smith');
    expect(t).toContain('Philly Roofing Co');
    expect(t).toContain('Dana,');
    expect(t.toLowerCase()).toContain('missed your call');
  });
  it('works with no caller name', () => {
    expect(missedCallText({ business: 'Acme' })).toContain('Acme');
  });
});

describe('smsFromReply', () => {
  it('extracts only the SMS line', () => {
    const reply = 'TEXT: Hi Dana, thanks for reaching out!\n\nEMAIL:\nSubject: Hello\nBody here.';
    expect(smsFromReply(reply)).toBe('Hi Dana, thanks for reaching out!');
  });
  it('handles a reply with no EMAIL block', () => {
    expect(smsFromReply('TEXT: Just a text')).toBe('Just a text');
  });
  it('truncates a very long SMS', () => {
    const long = 'TEXT: ' + 'x'.repeat(400);
    expect(smsFromReply(long).length).toBeLessThanOrEqual(320);
    expect(smsFromReply(long).endsWith('…')).toBe(true);
  });
});

describe('fallbackInstantReply', () => {
  it('is personalized and demo-safe', () => {
    const out = fallbackInstantReply({ name: 'Sam', service: 'AC tune-up' }, { business: 'CoolAir' });
    expect(out).toContain('Sam');
    expect(out).toContain('AC tune-up');
    expect(out).toContain('CoolAir');
    expect(out).toContain('TEXT:');
  });
});

describe('responseSeconds', () => {
  it('measures arrival → response, floored at 0', () => {
    expect(responseSeconds({ createdAt: '2026-08-12T10:00:00Z' }, '2026-08-12T10:02:00Z')).toBe(120);
    expect(responseSeconds({ createdAt: '2026-08-12T10:05:00Z' }, '2026-08-12T10:00:00Z')).toBe(0);
  });
  it('returns undefined without an arrival time', () => {
    expect(responseSeconds({}, '2026-08-12T10:00:00Z')).toBeUndefined();
  });
});

describe('recordContact + responderStats', () => {
  it('logs, dedups the ledger, and rolls up today + average', () => {
    let s: SpeedToLeadState = { ...emptyState(), enabled: true };
    s = recordContact(s, { id: '1', name: 'A' }, '2026-08-12T10:00:00Z', ['sms'], false, 60);
    s = recordContact(s, { id: '2', name: 'B' }, '2026-08-12T10:01:00Z', [], true, 180);
    s = recordContact(s, { id: '3', name: 'C' }, '2026-08-11T10:00:00Z', ['sms', 'email'], false, 30);
    expect(s.contacted).toEqual(['id:1', 'id:2', 'id:3']);
    const stats = responderStats(s, '2026-08-12T12:00:00Z');
    expect(stats.enabled).toBe(true);
    expect(stats.today).toBe(2); // Aug 12 entries
    expect(stats.total).toBe(3);
    expect(stats.held).toBe(1); // B was held
    expect(stats.avgResponse).toBe('90s'); // (60+180+30)/3 = 90
  });
  it('is honest and empty by default', () => {
    const stats = responderStats(undefined, '2026-08-12T12:00:00Z');
    expect(stats).toEqual({ enabled: false, today: 0, total: 0, avgResponse: null, held: 0 });
  });
});
