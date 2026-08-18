import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  health, itemEconomics, marginPct, priceFor, priceForMargin, resetPriceCache, rollup,
  TARGET_MARGIN, THIN_MARGIN, tokenCostUsd, UNKNOWN_MODEL_PRICE, unpricedWork,
} from '../src/billing/cogs.js';
import {
  applyCosts, claimCostItem, closeCostContext, costLedger, drainCosts, emptyLedger, openCostContext,
  pendingAccounts, recordCost, resetCosts, setCostAccount, UNCLAIMED, withCostAccount,
} from '../src/billing/costsink.js';
import { WORK_COSTS } from '../src/billing/credits.js';

beforeEach(() => { resetCosts(); resetPriceCache(); delete process.env.MODEL_PRICES_JSON; });
afterEach(() => { resetCosts(); resetPriceCache(); delete process.env.MODEL_PRICES_JSON; });

describe('token pricing', () => {
  it('prices a call from its token counts', () => {
    // 1M in + 1M out on gpt-4o-mini = $0.15 + $0.60
    expect(tokenCostUsd('openai/gpt-4o-mini', 1_000_000, 1_000_000)).toBeCloseTo(0.75, 6);
  });
  it('prices a realistic generation in fractions of a cent', () => {
    const c = tokenCostUsd('openai/gpt-4o-mini', 1500, 900);
    expect(c).toBeGreaterThan(0);
    expect(c).toBeLessThan(0.01);
  });
  it('resolves a vendor-prefixed model name', () => {
    expect(priceFor('openrouter/anthropic/claude-haiku-4.5').known).toBe(true);
  });
  it('assumes an unknown model is expensive rather than free', () => {
    const p = priceFor('some-model-we-have-never-seen');
    expect(p.known).toBe(false);
    expect(p.price).toEqual(UNKNOWN_MODEL_PRICE);
    expect(tokenCostUsd('some-model-we-have-never-seen', 1000, 1000)).toBeGreaterThan(0);
  });
  it('lets the operator override a stale list price', () => {
    process.env.MODEL_PRICES_JSON = JSON.stringify({ 'openai/gpt-4o-mini': { input: 99, output: 99 } });
    resetPriceCache();
    expect(tokenCostUsd('openai/gpt-4o-mini', 1_000_000, 0)).toBeCloseTo(99, 6);
  });
  it('survives a malformed override instead of taking pricing down', () => {
    process.env.MODEL_PRICES_JSON = '{not json';
    resetPriceCache();
    expect(priceFor('openai/gpt-4o-mini').known).toBe(true);
  });
  it('never returns a negative cost', () => {
    expect(tokenCostUsd('openai/gpt-4o-mini', -500, -500)).toBe(0);
  });
});

describe('margin arithmetic', () => {
  it('computes gross margin', () => {
    expect(marginPct(100, 30)).toBeCloseTo(0.7, 6);
  });
  it('reports no margin on no revenue rather than 100%', () => {
    expect(marginPct(0, 5)).toBeNull();
  });
  it('goes negative when cost exceeds price', () => {
    expect(marginPct(1, 2)).toBeCloseTo(-1, 6);
  });
  it('inverts to the price that would hit the target', () => {
    expect(priceForMargin(0.3, 0.7)).toBeCloseTo(1, 2);
    expect(priceForMargin(30, 0.7)).toBeCloseTo(100, 2);
  });
  it('grades health against the target', () => {
    expect(health(0.8)).toBe('healthy');
    expect(health(TARGET_MARGIN)).toBe('healthy');
    expect(health(THIN_MARGIN + 0.05)).toBe('thin');
    expect(health(-0.2)).toBe('underwater');
    expect(health(null)).toBe('unmeasured');
  });
});

describe('per-item economics', () => {
  it('models a cost when nothing has been measured, and says so', () => {
    const e = itemEconomics({ skill_run: 0.5 }, {}, 'openai/gpt-4o-mini');
    expect(e[0]!.basis).toBe('modelled');
    expect(e[0]!.runs).toBe(0);
    expect(e[0]!.unitCost).toBeGreaterThan(0);
  });
  it('prefers measured cost the moment there is any', () => {
    const e = itemEconomics({ skill_run: 0.5 }, { skill_run: { costUsd: 0.4, runs: 4 } }, 'openai/gpt-4o-mini');
    expect(e[0]!.basis).toBe('measured');
    expect(e[0]!.unitCost).toBeCloseTo(0.1, 6);
    expect(e[0]!.margin).toBeCloseTo(0.8, 6);
    expect(e[0]!.health).toBe('healthy');
  });
  it('flags an item that is underwater and says what it would have to cost', () => {
    const e = itemEconomics({ skill_run: 0.5 }, { skill_run: { costUsd: 6, runs: 4 } }, 'openai/gpt-4o-mini');
    expect(e[0]!.health).toBe('underwater');
    expect(e[0]!.breakEvenPrice).toBeCloseTo(5, 2);
  });
  it('sorts the worst margin first, where the attention is needed', () => {
    const e = itemEconomics(
      { good: 10, bad: 0.1 },
      { good: { costUsd: 0.1, runs: 1 }, bad: { costUsd: 0.09, runs: 1 } },
      'openai/gpt-4o-mini',
    );
    expect(e[0]!.item).toBe('bad');
  });

  /** The guardrail: shipped pricing has to clear the target at modelled cost. */
  it('every priced work item clears the target margin as modelled', () => {
    const e = itemEconomics(WORK_COSTS, {}, 'openai/gpt-4o-mini');
    const failing = e.filter((i) => (i.margin ?? 0) < TARGET_MARGIN);
    expect(failing.map((f) => `${f.item} @ ${f.margin}`)).toEqual([]);
  });
  it('still clears the target on a model an order of magnitude dearer', () => {
    const e = itemEconomics(WORK_COSTS, {}, 'anthropic/claude-sonnet-4.5');
    expect(e.filter((i) => (i.margin ?? 0) < TARGET_MARGIN)).toEqual([]);
  });
});

describe('account rollup', () => {
  it('totals cost across items and reports the blended margin', () => {
    const items = itemEconomics(
      { skill_run: 0.5, ai_autofill: 1 },
      { skill_run: { costUsd: 0.2, runs: 4 }, ai_autofill: { costUsd: 0.3, runs: 2 } },
      'openai/gpt-4o-mini',
    );
    const r = rollup(4, items); // 4 runs @ .5 + 2 @ 1 = $4 charged
    expect(r.cost).toBeCloseTo(0.5, 6);
    expect(r.gross).toBeCloseTo(3.5, 2);
    expect(r.margin).toBeCloseTo(0.875, 3);
    expect(r.runs).toBe(6);
  });
  it('separates measured cost from the modelled part of the total', () => {
    const items = itemEconomics(
      { skill_run: 0.5, ai_autofill: 1 },
      { skill_run: { costUsd: 0.2, runs: 4 } },
      'openai/gpt-4o-mini',
    );
    const r = rollup(2, items);
    expect(r.measuredCost).toBeCloseTo(0.2, 6);
  });
  it('has no margin to report before anything has been sold', () => {
    expect(rollup(0, []).margin).toBeNull();
    expect(rollup(0, []).health).toBe('unmeasured');
  });
});

describe('cost attribution', () => {
  const ev = (cost: number) => ({ model: 'openai/gpt-4o-mini', inputTokens: 100, outputTokens: 50, costUsd: cost, providerReported: true });

  it('charges a request’s generations to the item it billed for', () => {
    openCostContext(() => {
      setCostAccount('u1');
      recordCost(ev(0.01));
      claimCostItem('skill_run');
      closeCostContext();
    });
    const d = drainCosts('u1');
    expect(d.skill_run!.costUsd).toBeCloseTo(0.01, 6);
    expect(d.skill_run!.runs).toBe(1);
    expect(d.skill_run!.providerReported).toBe(1);
  });

  it('does not let two items in one request absorb each other’s cost', () => {
    openCostContext(() => {
      setCostAccount('u1');
      recordCost(ev(0.01));
      claimCostItem('skill_run');
      recordCost(ev(0.05));
      claimCostItem('campaign_build');
      closeCostContext();
    });
    const d = drainCosts('u1');
    expect(d.skill_run!.costUsd).toBeCloseTo(0.01, 6);
    expect(d.campaign_build!.costUsd).toBeCloseTo(0.05, 6);
  });

  it('keeps concurrent requests for one account apart', async () => {
    const run = (item: string, cost: number, delay: number) =>
      new Promise<void>((resolve) => openCostContext(async () => {
        setCostAccount('u1');
        await new Promise((r) => setTimeout(r, delay));
        recordCost(ev(cost));
        claimCostItem(item);
        closeCostContext();
        resolve();
      }));
    await Promise.all([run('skill_run', 0.01, 20), run('campaign_build', 0.05, 5)]);
    const d = drainCosts('u1');
    expect(d.skill_run!.costUsd).toBeCloseTo(0.01, 6);
    expect(d.campaign_build!.costUsd).toBeCloseTo(0.05, 6);
  });

  it('keeps cost that no work item claimed, rather than hiding it', () => {
    openCostContext(() => { setCostAccount('u1'); recordCost(ev(0.02)); closeCostContext(); });
    expect(drainCosts('u1')[UNCLAIMED]!.costUsd).toBeCloseTo(0.02, 6);
  });

  it('attributes unattended work through withCostAccount', () => {
    withCostAccount('u2', 'skill_run', () => { recordCost(ev(0.03)); });
    expect(drainCosts('u2').skill_run!.costUsd).toBeCloseTo(0.03, 6);
  });

  it('lists the accounts with costs waiting, and clears them once drained', () => {
    withCostAccount('u3', 'skill_run', () => { recordCost(ev(0.01)); });
    expect(pendingAccounts()).toEqual(['u3']);
    drainCosts('u3');
    expect(pendingAccounts()).toEqual([]);
  });

  it('charges nothing to an account that made no calls', () => {
    openCostContext(() => { setCostAccount('u4'); closeCostContext(); });
    expect(drainCosts('u4')).toEqual({});
  });
});

describe('the persisted ledger', () => {
  it('accumulates across flushes', () => {
    const data: Record<string, unknown> = {};
    withCostAccount('u1', 'skill_run', () => recordCost({ model: 'm', inputTokens: 10, outputTokens: 5, costUsd: 0.01, providerReported: true }));
    applyCosts(data, drainCosts('u1'));
    withCostAccount('u1', 'skill_run', () => recordCost({ model: 'm', inputTokens: 10, outputTokens: 5, costUsd: 0.02, providerReported: false }));
    applyCosts(data, drainCosts('u1'));
    const led = costLedger(data);
    expect(led.items.skill_run!.costUsd).toBeCloseTo(0.03, 6);
    expect(led.items.skill_run!.runs).toBe(2);
    expect(led.calls).toBe(2);
    expect(led.providerReported).toBe(1);
  });
  it('reads back an empty account as an empty ledger', () => {
    expect(costLedger({})).toMatchObject(emptyLedger());
  });
  it('drops corrupt rows instead of poisoning the margin', () => {
    const led = costLedger({ cogs: { items: { good: { costUsd: 1, runs: 1 }, bad: { costUsd: -5, runs: 'x' } }, calls: 'nope' } });
    expect(Object.keys(led.items)).toEqual(['good']);
    expect(led.calls).toBe(0);
  });
});

describe('honesty guards', () => {
  it('reports no margin when no run has ever been costed, rather than 100%', () => {
    const items = itemEconomics({ skill_run: 0.5 }, {}, 'openai/gpt-4o-mini');
    const r = rollup(1.5, items); // charged $1.50, nothing measured
    expect(r.margin).toBeNull();
    expect(r.health).toBe('unmeasured');
  });
  it('reports a margin as soon as one run has been costed', () => {
    const items = itemEconomics({ skill_run: 0.5 }, { skill_run: { costUsd: 0.05, runs: 1 } }, 'openai/gpt-4o-mini');
    expect(rollup(0.5, items).margin).toBeCloseTo(0.9, 6);
  });
  it('does not call text generation unbilled when a work item bills it', () => {
    const leaks = unpricedWork({ text: 1, video: 20, audit: 2 }, { text: 'Copy', video: 'Videos', audit: 'Audits' }, WORK_COSTS);
    expect(leaks.map((l) => l.kind)).not.toContain('text');
    expect(leaks.map((l) => l.kind)).toEqual(expect.arrayContaining(['video', 'audit']));
  });
  it('puts the expensive media leaks first', () => {
    const leaks = unpricedWork({ audit: 2, video: 20 }, { audit: 'Audits', video: 'Videos' }, WORK_COSTS);
    expect(leaks[0]!.kind).toBe('video');
    expect(leaks[0]!.media).toBe(true);
  });
});

describe('unclaimed inference in the rollup', () => {
  it('counts cost that billed nothing against the margin', () => {
    const items = itemEconomics({ skill_run: 0.5 }, { skill_run: { costUsd: 0.05, runs: 1 } }, 'openai/gpt-4o-mini');
    const withOut = rollup(0.5, items);
    const withIn = rollup(0.5, items, 0.2);
    expect(withIn.cost).toBeGreaterThan(withOut.cost);
    expect(withIn.margin!).toBeLessThan(withOut.margin!);
    expect(withIn.cost).toBeCloseTo(0.25, 6);
  });
  it('can drive an account underwater on free work alone', () => {
    const r = rollup(0.5, [], 2);
    expect(r.margin).toBeLessThan(0);
    expect(r.health).toBe('underwater');
  });
  it('treats unclaimed cost as measured, because it was observed', () => {
    expect(rollup(1, [], 0.3).measuredCost).toBeCloseTo(0.3, 6);
  });
});
