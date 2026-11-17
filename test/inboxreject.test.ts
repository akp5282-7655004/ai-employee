import { describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import { MockConnector } from '../src/connectors/mock.js';
import { recIsOpen, stableRecId } from '../src/agents/recommend.js';

async function setup(email: string) {
  const store = new MemoryStore();
  const app = buildServer({ authStore: store, connector: new MockConnector() });
  const r = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email, password: 'password1', tos: true } });
  const raw = r.headers['set-cookie'];
  const cookie = String(Array.isArray(raw) ? raw[0] : raw).split(';')[0] ?? '';
  return { store, app, cookie, uid: r.json().user.id as string };
}

const post = (app: ReturnType<typeof buildServer>, cookie: string, url: string, payload: unknown) =>
  app.inject({ method: 'POST', url, headers: { cookie }, payload: payload as Record<string, unknown> });

async function seedInbox(store: MemoryStore, uid: string) {
  const data = await store.getUserData(uid);
  data.miles = {
    inbox: [
      { id: 'inb_skip', kind: 'skill', title: 'Pause the loser keyword', reason: 'No leads in 30 days.', status: 'queued', queuedAt: new Date().toISOString(), skill: 'loser-pauser' },
      { id: 'inb_ok', kind: 'skill', title: 'Shift $5 to the winner', reason: 'Lower cost per lead.', status: 'queued', queuedAt: new Date().toISOString(), skill: 'budget-shifter' },
    ],
  };
  await store.setUserData(uid, data);
}

describe('rejecting inbox decisions (row 47)', () => {
  it('skips a waiting decision, logs it, and it no longer waits', async () => {
    const { store, app, cookie, uid } = await setup('skip@example.com');
    await seedInbox(store, uid);
    const op = (await app.inject({ method: 'GET', url: '/api/dashboard/operator', headers: { cookie } })).json();
    const dec = op.operator.decisions.find((d: { id: string }) => d.id === 'inb_skip');
    expect(dec.canSkip).toBe(true);

    const r = await post(app, cookie, '/api/miles/reject', { id: 'inb_skip' });
    expect(r.statusCode).toBe(200);
    expect(r.json().note).toMatch(/Nothing was changed/);
    const data = await store.getUserData(uid);
    const item = (data.miles as { inbox: { id: string; status: string }[] }).inbox.find((row) => row.id === 'inb_skip');
    expect(item?.status).toBe('skipped');
    const log = data.approvalLog as { kind: string; title: string }[];
    expect(log.find((e) => /Skipped, Pause the loser keyword/.test(e.title))?.kind).toBe('dismissal');

    const after = (await app.inject({ method: 'GET', url: '/api/dashboard/operator', headers: { cookie } })).json();
    expect(after.operator.decisions.some((d: { id: string }) => d.id === 'inb_skip')).toBe(false);
    // Once skipped, it cannot be approved or skipped again.
    expect((await post(app, cookie, '/api/miles/approve', { id: 'inb_skip', confirm: true })).statusCode).toBe(404);
    expect((await post(app, cookie, '/api/miles/reject', { id: 'inb_skip' })).statusCode).toBe(404);
    await app.close();
  });

  it('approving a skill proposal says it was recorded and Google and Meta were not changed (row 46)', async () => {
    const { store, app, cookie, uid } = await setup('approve-honest@example.com');
    await seedInbox(store, uid);
    const r = (await post(app, cookie, '/api/miles/approve', { id: 'inb_ok', confirm: true })).json();
    expect(r).toMatchObject({ ok: true, pushed: false, recorded: true });
    expect(r.note).toMatch(/Google Ads and Meta were not changed/);
    await app.close();
  });
});

describe('dismissed recommendations stay dismissed across days (row 47)', () => {
  it('keys the dismissal on the issue, not the day', () => {
    expect(stableRecId('ads:dead:google_ads:2026-11-16')).toBe('ads:dead:google_ads');
    expect(stableRecId('speed:off')).toBe('speed:off');
    const st = { dismissed: { 'ads:dead:google_ads': '2026-11-16T10:00:00Z' } };
    expect(recIsOpen(st, 'ads:dead:google_ads:2026-11-17')).toBe(false);
    expect(recIsOpen(st, 'ads:cpa-high:google_ads:2026-11-17')).toBe(true);
    // An older record keyed on the dated id still hides that day's card.
    expect(recIsOpen({ dismissed: { 'leads:x:2026-11-16': 'x' } }, 'leads:x:2026-11-16')).toBe(false);
  });

  it('the dismiss route stores the stable id, so tomorrow’s card with the same issue stays hidden', async () => {
    const { store, app, cookie, uid } = await setup('dismiss@example.com');
    const r = await post(app, cookie, '/api/recommendations/dismiss', { id: 'ads:dead:google_ads:2026-11-16' });
    expect(r.statusCode).toBe(200);
    const st = (await store.getUserData(uid)).recState as { dismissed: Record<string, string> };
    expect(Object.keys(st.dismissed)).toEqual(['ads:dead:google_ads']);
    expect(recIsOpen(st, 'ads:dead:google_ads:2026-11-17')).toBe(false);
    await app.close();
  });

  it('approving a recommendation says it was recorded, not pushed (row 46)', async () => {
    const { app, cookie } = await setup('rec-honest@example.com');
    const rec = { id: 'ads:dead:google_ads:2026-11-17', category: 'ads', severity: 'high', title: 'Pause dead spend', why: 'No leads.', action: 'Pause it.', apply: { kind: 'queue_change', label: 'Pause' } };
    const r = (await post(app, cookie, '/api/recommendations/apply', { rec })).json();
    expect(r).toMatchObject({ ok: true, pushed: false, recorded: true });
    expect(r.note).toMatch(/Google Ads and Meta were not changed/);
    await app.close();
  });
});
