import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import { decidePolicy, DEFAULT_CAPS } from '../src/agents/policy.js';
import { guardCopy } from '../src/playbooks/guard.js';
import { feasibility } from '../src/agents/feasibility.js';
import { answerChat } from '../src/chat/ask.js';
import { buildAccountSnapshot } from '../src/chat/snapshot.js';
import { normalizeLead } from '../src/agents/plumberloop.js';
import { readFileSync } from 'node:fs';
import {
  blockedClaim, cancelQueued, claimOnce, contradictoryAsk, createFingerprint, hideDismissed,
  isOptOutMessage, isQuietHour, leadOffset, localDates, marketingFooter, sameCreate, scrubSecrets,
} from '../src/qa/ownerrows.js';

describe('launch row checks', () => {
  it('treats STOP and UNSUBSCRIBE as opt-out and drops queued texts', () => {
    expect(isOptOutMessage('STOP')).toBe(true);
    expect(isOptOutMessage('Unsubscribe.')).toBe(true);
    expect(isOptOutMessage('hello')).toBe(false);
    expect(normalizeLead({ eventId: 'e', name: 'Dana', phone: '2155550100', message: 'STOP' }).lead?.optOut).toBe(true);
    expect(cancelQueued([{ phone: '+1 (215) 555-0100', id: 'a' }, { phone: '3125550100', id: 'b' }], '2155550100')).toEqual([{ phone: '3125550100', id: 'b' }]);
  });

  it('holds a 2am Eastern lead and uses the area code before the owner clock', () => {
    const at = new Date('2026-11-16T07:00:00.000Z');
    const offset = leadOffset(at, '2155550100', '19103', 0);
    expect(offset).toBe(-300);
    expect(isQuietHour(at, offset)).toBe(true);
    expect(isQuietHour(new Date('2026-11-16T15:00:00.000Z'), 0)).toBe(false);
  });

  it('does not double a calendar day across the November and March clock changes', () => {
    const fall = localDates(new Date('2026-10-31T12:00:00Z'), new Date('2026-11-02T12:00:00Z'), 'America/New_York');
    const spring = localDates(new Date('2027-03-13T12:00:00Z'), new Date('2027-03-15T12:00:00Z'), 'America/New_York');
    expect(fall).toEqual(['2026-10-31', '2026-11-01', '2026-11-02']);
    expect(spring).toEqual(['2027-03-13', '2027-03-14', '2027-03-15']);
    expect(new Set(fall).size).toBe(fall.length);
  });

  it('claims a send once and a fast campaign create once', () => {
    const first = claimOnce([], 'lead:1');
    expect(first.first).toBe(true);
    expect(claimOnce(first.seen, 'lead:1').first).toBe(false);
    const key = createFingerprint({ name: 'Search', dailyBudget: 30, locations: ['Philly'] });
    expect(sameCreate(key, new Date().toISOString(), key, Date.now())).toBe(true);
    expect(sameCreate(key, new Date(Date.now() - 300_000).toISOString(), key, Date.now())).toBe(false);
  });

  it('scrubs keys, blocks fake claims, and asks when the brief disagrees', () => {
    expect(scrubSecrets('failed sk_live_abc123 and Bearer tokenvalue')).not.toMatch(/sk_live|tokenvalue/);
    expect(guardCopy('We are the #1 roofer').ok).toBe(false);
    expect(blockedClaim('guaranteed results')).toMatch(/will not write/);
    expect(contradictoryAsk('Use $30 and also $80')).toMatch(/Which one should I use/);
    expect(hideDismissed('same why', 'same why')).toBe(true);
    expect(hideDismissed('new why', 'same why')).toBe(false);
  });

  it('never applies an action in Ask me first', () => {
    const decision = decidePolicy({
      mode: 'manual',
      caps: DEFAULT_CAPS,
      spentToday: 0,
      spentMonth: 0,
      action: { area: 'ppc', kind: 'optimize', canPush: true, spend: 0 },
    });
    expect(decision.effect).not.toBe('apply');
  });

  it('does not say Searchlight to the owner', () => {
    const text = feasibility({ dailyBudget: 20, leadsPerDay: 2, trade: 'plumbing' }).message;
    expect(text.toLowerCase()).not.toContain('searchlight');
    expect(text).toMatch(/not a reasonable expectation/);
  });

  it('asks one question instead of guessing two budgets', async () => {
    const out = await answerChat({
      snapshot: buildAccountSnapshot({
        tenantId: 't', sampleConnector: false, profile: { businessName: 'Ada', industry: 'Painting' },
        completeness: { percent: 10, filled: 1, total: 10, missing: [], gbp: '' },
        phase: 'plan', mode: 'hybrid', caps: null, tracking: null, plan: null, milesCampaign: null, journey: null,
        spendRows: [], spendReadAt: null, bookedFromJobs: null, bookedFromDeals: null,
        google: { oauth: false, ready: false, customerId: null, note: '', error: null },
        ghl: { connected: false, detail: '' }, speedToLead: { enabled: false, today: 0, total: 0, held: 0, canSend: false },
        social: { facebook: false, instagram: false, linkedin: false, gbp: false },
        automations: { noShow: false, onboarding: false }, events: [], changeLog: [], inbox: [], leads: [],
      }),
      messages: [{ role: 'user', text: 'Spend $30 and also $80' }],
      model: async () => { throw new Error('should not run'); },
      readers: { campaignStatus: async () => ({}), integrations: async () => ({}), leads: async () => ({}), changeLog: async () => ({}) },
    });
    expect(out.text).toMatch(/Which one should I use/);
  });
});

describe('deactivated login and drafts', () => {
  it('tells a paused account it is deactivated and edits a draft', async () => {
    const store = new MemoryStore();
    const app = buildServer({ authStore: store });
    const signup = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'ada@example.com', password: 'password1', tos: true } });
    const cookie = String(signup.headers['set-cookie']).split(';')[0];
    const id = signup.json().user.id as string;
    const data = await store.getUserData(id);
    data.accountPaused = true;
    data.followUpDrafts = [{ id: 'd1', eventId: 'd1', body: 'Hello', phone: '2155550100' }];
    await store.setUserData(id, data);
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'ada@example.com', password: 'password1' } });
    expect(login.statusCode).toBe(403);
    expect(login.json().error).toMatch(/deactivated/);
    data.accountPaused = false;
    await store.setUserData(id, data);
    const again = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'ada@example.com', password: 'password1' } });
    const session = String(again.headers['set-cookie']).split(';')[0];
    const edited = await app.inject({ method: 'POST', url: '/api/drafts', headers: { cookie: session }, payload: { id: 'd1', action: 'edit', text: 'Updated draft' } });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().draft.body).toBe('Updated draft');
    const support = await app.inject({ method: 'GET', url: '/api/support' });
    expect(support.json().site).toMatch(/pathhackers/);
    expect(readFileSync('web/index.html', 'utf8')).toMatch(/header-logout/);
    expect(readFileSync('web/index.html', 'utf8')).toMatch(/That took too long/);
    expect(readFileSync('web/index.html', 'utf8')).toMatch(/Coming soon/);
    expect(readFileSync('web/index.html', 'utf8')).toMatch(/Sync stopped/);
    expect(readFileSync('web/index.html', 'utf8')).toMatch(/focus-visible/);
    expect(readFileSync('web/index.html', 'utf8')).toMatch(/min-height:24px/);
    expect(readFileSync('web/index.html', 'utf8')).toMatch(/beforeunload/);
    expect(marketingFooter('https://miles.example')).toMatch(/unsubscribe/);
    await app.close();
    expect(cookie).toBeTruthy();
  });
});
