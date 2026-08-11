/**
 * Model Router (spec v2) — vendor-agnostic routing. For each task: score its
 * complexity, read the account's intake context, set a required quality bar from
 * the two (equal weight), then pick the cheapest tier that clears the bar. A
 * one-way safety floor keeps money-moving actions off the cheapest tier.
 *
 * This module is the pure, tested decision core. The live pieces (OpenRouter
 * pricing, per-model learned trust, credit metering) plug in on top of it — the
 * tier a route resolves to maps to a registry of candidate models per vendor.
 */

export type QualitySetting = 'value' | 'balanced' | 'max';
export type Tier = 'value' | 'balanced' | 'max';

/** The five complexity signals (spec §3), each in its own range. */
export interface ComplexitySignals {
  reasoning: number; // 0–4
  tools: number; // 0–3
  context: number; // 0–2
  stakes: number; // 0–3
  ambiguity: number; // 0–2
}

export interface IntakeContext {
  premiumBrand?: boolean; // premium/established vs budget/scrappy
  autonomy?: number; // 10 | 20 | 50 | 100
}

export interface RouteInput {
  taskShape: string;
  signals: ComplexitySignals;
  quality: QualitySetting;
  intake?: IntakeContext;
  /** Spends budget / launches / pauses campaigns → the high-stakes safety floor. */
  moneyAction?: boolean;
}

export interface RouteDecision {
  taskShape: string;
  complexity: number; // 0–14
  qualityBar: number; // 0–1
  tier: Tier;
  escalated: boolean; // safety floor bumped it up
  reason: string;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Sum the five signals into a 0–14 complexity score (spec §3). */
export function scoreComplexity(s: ComplexitySignals): number {
  const v =
    clamp(s.reasoning, 0, 4) + clamp(s.tools, 0, 3) + clamp(s.context, 0, 2) + clamp(s.stakes, 0, 3) + clamp(s.ambiguity, 0, 2);
  return Math.round(v);
}

const QUALITY_MULT: Record<QualitySetting, number> = { value: 0.72, balanced: 1, max: 1.32 };

/**
 * The required quality bar (0–1): complexity floor and intake context carry equal
 * weight; the customer's Value/Balanced/Max setting shifts the whole bar (spec §4/§7).
 */
export function qualityBar(complexity: number, quality: QualitySetting, intake: IntakeContext = {}): number {
  const complexityPart = complexity / 14; // 0–1 floor from raw capability needed
  const intakePart = intake.premiumBrand ? 0.7 : 0.4; // brand raises the customer-facing bar
  const base = (complexityPart + intakePart) / 2; // equal weight
  return clamp(base * QUALITY_MULT[quality], 0, 1);
}

/**
 * Pick the cheapest tier that clears the bar; a money-moving action can never run
 * below the `balanced` tier regardless of the customer's setting (spec §7 safety floor).
 */
export function route(input: RouteInput): RouteDecision {
  const complexity = scoreComplexity(input.signals);
  const bar = qualityBar(complexity, input.quality, input.intake);
  let tier: Tier = bar < 0.33 ? 'value' : bar < 0.66 ? 'balanced' : 'max';
  let escalated = false;
  if (input.moneyAction && tier === 'value') {
    tier = 'balanced';
    escalated = true;
  }
  const reason = escalated
    ? 'Money-moving action — escalated off the cheapest tier by the safety floor.'
    : `Cheapest tier that clears a quality bar of ${bar.toFixed(2)} (complexity ${complexity}/14${input.intake?.premiumBrand ? ', premium brand' : ''}).`;
  return { taskShape: input.taskShape, complexity, qualityBar: Math.round(bar * 100) / 100, tier, escalated, reason };
}

/** Representative candidate models per tier (config-driven; real ids come from the OpenRouter registry). */
export const TIER_MODELS: Record<Tier, string[]> = {
  value: ['open-source / cheap (DeepSeek, Qwen, Llama, Haiku-class)'],
  balanced: ['mid-tier (GPT-class, Sonnet-class, Gemini-class)'],
  max: ['frontier reasoners (Opus/Fable-class, GPT top-tier)'],
};

/** Relative credit burn per customer setting (spec §7), for the tradeoff display. */
export const BURN: Record<QualitySetting, string> = { value: '~1x', balanced: '~1.5–2x', max: '~3–5x' };
