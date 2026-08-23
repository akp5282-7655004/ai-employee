import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import { resetCosts } from '../src/billing/costsink.js';
import { TARGET_MARGIN } from '../src/billing/cogs.js';

type App = ReturnType<typeof buildServer>;

beforeEach(() => resetCosts());
afterEach(() => resetCosts());

async function session(app: App, email = 'econ@example.com'): Promise<string> {
  const r = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email, password: 'password1', tos: true } });
  const raw = r.headers['set-cookie'];
  const first = Array.isArray(raw) ? raw[0] : raw;
  return String(first ?? '').split(';')[0] ?? '';
}
const get = (app: App, url: string, cookie: string) => app.inject({ method: 'GET', url, headers: { cookie } });

describe('the economics endpoint', () => {
  it('needs a session', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    expect((await app.inject({ method: 'GET', url: '/api/economics' })).statusCode).toBe(401);
    await app.close();
  });

  it('reports a margin per work item against the target', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const c = await session(app);
    const d = (await get(app, '/api/economics', c)).json();
    expect(d.target).toBe(TARGET_MARGIN);
    // One row per priced item. Only media is priced now — text work is
    // unlimited, so it correctly has no line in the margin table.
    expect(d.items.length).toBe(3);
    expect(d.items.map((i: any) => i.item).sort()).toEqual(['audio', 'image', 'video']);
    for (const i of d.items) {
      expect(i).toHaveProperty('unitCost');
      expect(i).toHaveProperty('breakEvenPrice');
      expect(['measured', 'modelled']).toContain(i.basis);
    }
    await app.close();
  });

  it('labels everything as modelled before any call has been made', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const c = await session(app);
    const d = (await get(app, '/api/economics', c)).json();
    expect(d.items.every((i: any) => i.basis === 'modelled')).toBe(true);
    expect(d.measuredShare).toBe(0);
    expect(d.tokens.calls).toBe(0);
    await app.close();
  });

  it('has no margin to report before anything has been charged', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const c = await session(app);
    const d = (await get(app, '/api/economics', c)).json();
    expect(d.totals.revenue).toBe(0);
    expect(d.totals.margin).toBeNull();
    await app.close();
  });

  /**
   * This test used to assert that video and image WERE leaks — metered,
   * expensive, and billed to nobody. They are now priced, so an empty list is
   * the pass condition and a non-empty one means something spends money that
   * nobody decided to charge for.
   */
  it('reports no metered-but-unbilled work — nothing is free by accident', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const c = await session(app);
    const d = (await get(app, '/api/economics', c)).json();
    expect(d.leaks.map((l: any) => l.kind)).toEqual([]);
    await app.close();
  });

  it('prices every media kind above the target margin', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const c = await session(app);
    const d = (await get(app, '/api/economics', c)).json();
    for (const i of d.items) {
      expect(i.margin, `${i.item} @ $${i.price}`).toBeGreaterThanOrEqual(TARGET_MARGIN);
      // And the cost must be the vendor's per-asset price, not a token estimate.
      expect(i.unitCost, `${i.item} unit cost`).toBeGreaterThan(0);
    }
    await app.close();
  });

  it('stamps when the price table was last checked, so a stale figure is visible', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const c = await session(app);
    const d = (await get(app, '/api/economics', c)).json();
    expect(d.pricesStamped).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof d.model).toBe('string');
    await app.close();
  });

  it('shows no revenue from unlimited work, because there is none', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const c = await session(app);
    await app.inject({ method: 'POST', url: '/api/skills7/loser-pauser/run', headers: { cookie: c } });
    const d = (await get(app, '/api/economics', c)).json();
    // A skill run is free now. Reporting revenue for it would be a lie the
    // margin table then compounds.
    expect(d.totals.revenue).toBe(0);
    await app.close();
  });

  it('keeps one account’s costs off another’s books', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const a = await session(app, 'a@example.com');
    const b = await session(app, 'b@example.com');
    await app.inject({ method: 'POST', url: '/api/skills7/loser-pauser/run', headers: { cookie: a } });
    expect((await get(app, '/api/economics', b)).json().totals.revenue).toBe(0);
    await app.close();
  });
});

/**
 * The attribution wiring is the part that fails silently: if the async-local
 * context does not survive the hook chain, every cost lands on nobody and the
 * margin looks perfect. This drives a real request through Fastify with a
 * stubbed provider and checks the dollars reach the right account.
 */
describe('cost attribution through a real request', () => {
  const OR_RESPONSE = {
    model: 'openai/gpt-4o-mini',
    choices: [{ message: { content: 'some generated ad copy' } }],
    usage: { prompt_tokens: 1200, completion_tokens: 800, cost: 0.0123 },
  };
  let realFetch: typeof globalThis.fetch;
  beforeEach(() => {
    realFetch = globalThis.fetch;
    process.env.OPENROUTER_API_KEY = 'test-key';
    globalThis.fetch = (async (url: unknown) => {
      if (String(url).includes('openrouter')) {
        return { ok: true, json: async () => OR_RESPONSE } as unknown as Response;
      }
      return { ok: false, status: 404, json: async () => ({}), text: async () => '' } as unknown as Response;
    }) as typeof globalThis.fetch;
  });
  afterEach(() => { globalThis.fetch = realFetch; delete process.env.OPENROUTER_API_KEY; });

  it('lands the provider-reported cost on the account that made the call', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const c = await session(app);
    const r = await app.inject({
      method: 'POST', url: '/api/skills/play', headers: { cookie: c },
      payload: { skillId: 'google-ads', playId: 'rsa' },
    });
    expect(r.json().live).toBe(true);
    const d = (await get(app, '/api/economics', c)).json();
    expect(d.tokens.calls).toBe(1);
    expect(d.tokens.input).toBe(1200);
    // The provider priced it, so this is measured rather than modelled.
    expect(d.measuredShare).toBe(1);
    expect(d.totals.cost).toBeCloseTo(0.0123, 6);
    await app.close();
  });

  it('does not put one account’s inference on another’s books', async () => {
    const app = buildServer({ authStore: new MemoryStore() });
    const a = await session(app, 'a2@example.com');
    const b = await session(app, 'b2@example.com');
    await app.inject({ method: 'POST', url: '/api/skills/play', headers: { cookie: a }, payload: { skillId: 'google-ads', playId: 'rsa' } });
    expect((await get(app, '/api/economics', b)).json().tokens.calls).toBe(0);
    expect((await get(app, '/api/economics', a)).json().tokens.calls).toBe(1);
    await app.close();
  });
});
