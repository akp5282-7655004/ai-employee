/**
 * Unit economics — the cost half of the pricing model.
 *
 * Credits are sold in retail dollars (billing/credits.ts) but nothing recorded
 * what a work item actually costs to serve, so gross margin was unknowable.
 * This module supplies the other side of the ledger: what a generation costs in
 * inference, what each work item therefore costs, and whether its retail price
 * clears the margin the business is run to.
 *
 * Two rules keep the numbers trustworthy:
 *
 *  - MEASURED BEATS MODELLED, ALWAYS. When the provider reports what a call
 *    cost, that figure is used and the item is marked `measured`. Modelled
 *    figures come from the token assumptions below and are marked `modelled`
 *    so a projection can never be read as a measurement.
 *
 *  - LIST PRICES ARE INPUTS, NOT FACTS. The table below is what these models
 *    were published at on PRICES_STAMPED; vendors change them. Override any
 *    row with MODEL_PRICES_JSON rather than trusting a hardcoded number
 *    forever, and re-check the stamp before quoting a margin to anyone.
 */

export interface ModelPrice {
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
}

/** When the table below was last checked against vendor pricing pages. */
export const PRICES_STAMPED = '2026-08-18';

const BUILTIN_PRICES: Record<string, ModelPrice> = {
  'openai/gpt-4o-mini': { input: 0.15, output: 0.6 },
  'openai/gpt-4o': { input: 2.5, output: 10 },
  'openai/gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'anthropic/claude-haiku-4.5': { input: 1, output: 5 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'anthropic/claude-sonnet-4.5': { input: 3, output: 15 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'meta-llama/llama-3.1-8b-instruct': { input: 0.02, output: 0.03 },
};

/** The fallback when a model is not in the table — deliberately pessimistic,
 *  so an unknown model shows margin as worse than it is, never better. */
export const UNKNOWN_MODEL_PRICE: ModelPrice = { input: 3, output: 15 };

let priceOverrides: Record<string, ModelPrice> | undefined;

/** Operator-supplied prices, read once from MODEL_PRICES_JSON. */
function overrides(): Record<string, ModelPrice> {
  if (priceOverrides) return priceOverrides;
  priceOverrides = {};
  try {
    const raw = JSON.parse(process.env.MODEL_PRICES_JSON ?? '{}') as Record<string, unknown>;
    for (const [k, v] of Object.entries(raw)) {
      const o = v as Record<string, unknown>;
      const input = Number(o?.input), output = Number(o?.output);
      if (Number.isFinite(input) && Number.isFinite(output) && input >= 0 && output >= 0) {
        priceOverrides[k] = { input, output };
      }
    }
  } catch { /* a malformed override never takes the pricing table down */ }
  return priceOverrides;
}

/** For tests and for a config reload. */
export function resetPriceCache(): void { priceOverrides = undefined; }

export function priceFor(model: string): { price: ModelPrice; known: boolean } {
  const key = (model || '').trim();
  const o = overrides()[key] ?? BUILTIN_PRICES[key];
  if (o) return { price: o, known: true };
  // "openrouter/anthropic/claude-haiku-4.5" and friends — try the tail.
  const tail = key.split('/').slice(-2).join('/');
  const t = overrides()[tail] ?? BUILTIN_PRICES[tail];
  if (t) return { price: t, known: true };
  return { price: UNKNOWN_MODEL_PRICE, known: false };
}

/** What one generation cost, in dollars, from its token counts. */
export function tokenCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const { price } = priceFor(model);
  const inTok = Math.max(0, Number(inputTokens) || 0);
  const outTok = Math.max(0, Number(outputTokens) || 0);
  return round6((inTok / 1_000_000) * price.input + (outTok / 1_000_000) * price.output);
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The margin the business is run to. Set from what comparable AI-employee
 * products appear to run at — an estimate from public credit pricing against
 * known token costs, not a figure any of them published. Treat it as this
 * business's target, not as an observed industry fact.
 */
export const TARGET_MARGIN = 0.7;
/** Below this, an item is losing money on volume and needs repricing. */
export const THIN_MARGIN = 0.5;

/** Gross margin as a fraction. Zero revenue has no margin — not 100%, not -∞. */
export function marginPct(revenue: number, cost: number): number | null {
  if (!Number.isFinite(revenue) || revenue <= 0) return null;
  return round6((revenue - cost) / revenue);
}

/** The retail price that would hit a target margin at this cost. */
export function priceForMargin(cost: number, target = TARGET_MARGIN): number {
  if (target >= 1) return Infinity;
  return round2(cost / (1 - target));
}

export type Health = 'healthy' | 'thin' | 'underwater' | 'unmeasured';

export function health(margin: number | null): Health {
  if (margin === null) return 'unmeasured';
  if (margin < 0) return 'underwater';
  if (margin < THIN_MARGIN) return 'thin';
  return margin >= TARGET_MARGIN ? 'healthy' : 'thin';
}

/**
 * How much work a given item typically does, used only when nothing has been
 * measured yet. These are deliberate, stated assumptions — the maxTokens the
 * call sites request plus a prompt allowance — not observations.
 */
export const MODELLED_TOKENS: Record<string, { input: number; output: number }> = {
  campaign_build: { input: 2500, output: 1800 },
  campaign_launch: { input: 1200, output: 600 },
  ai_autofill: { input: 1500, output: 900 },
  skill_run: { input: 1200, output: 700 },
  weekly_readout: { input: 1800, output: 700 },
  email_send: { input: 600, output: 300 },
  creative_generation: { input: 1200, output: 900 },
};

export interface ItemCost {
  /** Total measured spend on this item, in dollars. */
  costUsd: number;
  /** How many times it ran. */
  runs: number;
}

export interface ItemEconomics {
  item: string;
  /** Retail price charged per run. */
  price: number;
  /** Cost to serve one run. */
  unitCost: number;
  /** 'measured' when it comes from real provider-reported usage. */
  basis: 'measured' | 'modelled';
  runs: number;
  margin: number | null;
  health: Health;
  /** What the price would have to be to hit the target margin. */
  breakEvenPrice: number;
}

/**
 * Per-item economics. Measured cost is used wherever any run has been
 * recorded; everything else falls back to the stated model, clearly labelled.
 */
export function itemEconomics(
  retail: Record<string, number>,
  measured: Record<string, ItemCost>,
  model: string,
): ItemEconomics[] {
  return Object.entries(retail).map(([item, price]) => {
    const m = measured[item];
    const useMeasured = !!m && m.runs > 0 && m.costUsd > 0;
    const tokens = MODELLED_TOKENS[item];
    const unitCost = useMeasured
      ? round6(m!.costUsd / m!.runs)
      : tokens ? tokenCostUsd(model, tokens.input, tokens.output) : 0;
    const margin = marginPct(price, unitCost);
    return {
      item,
      price,
      unitCost,
      basis: useMeasured ? ('measured' as const) : ('modelled' as const),
      runs: m?.runs ?? 0,
      margin,
      health: health(margin),
      breakEvenPrice: priceForMargin(unitCost),
    };
  }).sort((a, b) => (a.margin ?? 1) - (b.margin ?? 1));
}

/**
 * Actions the product meters but never charges a dollar for. Every one of these
 * consumes a paid API and returns no revenue, so they are the place margin
 * actually leaks — far more than a text generation priced at 99% ever will.
 * Media is called out separately because an image or a video is orders of
 * magnitude dearer than a paragraph of copy.
 */
export const COSTLY_UNPRICED = new Set(['image', 'video', 'audio']);

/**
 * Metered actions that a priced work item already bills for. The meter and the
 * credit ledger use different vocabularies, so a naive key diff reports text
 * generation as unbilled when ai_autofill and creative_generation are exactly
 * what bills it. Anything not listed here has no billing path at all.
 */
export const BILLED_THROUGH: Record<string, string> = {
  text: 'ai_autofill',
  agent_run: 'skill_run',
};

export interface Leak {
  kind: string;
  label: string;
  /** How many times it ran this period. */
  runs: number;
  /** True when this action calls a paid media API, not just text. */
  media: boolean;
}

export function unpricedWork(
  meterCosts: Record<string, unknown>,
  labels: Record<string, string>,
  retail: Record<string, number>,
  runs: Record<string, number> = {},
): Leak[] {
  return Object.keys(meterCosts)
    .filter((kind) => retail[kind] === undefined)
    .filter((kind) => {
      const via = BILLED_THROUGH[kind];
      return !(via && retail[via] !== undefined);
    })
    .map((kind) => ({ kind, label: labels[kind] ?? kind, runs: runs[kind] ?? 0, media: COSTLY_UNPRICED.has(kind) }))
    .sort((a, b) => Number(b.media) - Number(a.media) || b.runs - a.runs);
}

export interface MarginRollup {
  revenue: number;
  cost: number;
  gross: number;
  margin: number | null;
  health: Health;
  /** How much of the cost figure came from real provider numbers. */
  measuredCost: number;
  runs: number;
}

/**
 * Account-level margin: credits drawn against what serving them cost.
 *
 * `unclaimed` is inference that no billable item claimed — a free preview, a
 * retry, a feature that generates without charging. It is spent money and
 * belongs in the total: leaving it out is exactly how a margin figure flatters
 * itself, since the work that bills nothing is the work most likely to be
 * unprofitable.
 */
export function rollup(revenue: number, items: ItemEconomics[], unclaimed = 0): MarginRollup {
  let cost = 0, measuredCost = 0, runs = 0;
  for (const i of items) {
    const c = i.unitCost * i.runs;
    cost += c; runs += i.runs;
    if (i.basis === 'measured') measuredCost += c;
  }
  const extra = Math.max(0, unclaimed);
  cost = round6(cost + extra);
  measuredCost = round6(measuredCost + extra); // unclaimed cost is always observed
  // With nothing costed at all, a margin figure would be revenue over a cost of
  // zero — arithmetically 100% and evidentially nothing. Say unmeasured instead.
  const nothingCosted = runs === 0 && extra === 0;
  const margin = nothingCosted ? null : marginPct(revenue, cost);
  return {
    revenue: round2(revenue), cost, gross: round2(revenue - cost), margin,
    health: nothingCosted ? 'unmeasured' : health(margin),
    measuredCost, runs,
  };
}
