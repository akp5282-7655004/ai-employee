import type { BudgetBand, Channel, CommandPack, Offer } from './types.js';
import { PAID_CHANNELS } from './types.js';

/**
 * The universal pack math — the shared engine that turns a pack's four knobs into
 * concrete behavior. This is deliberately independent of any surface (Slack, web,
 * email) or connector: give it a pack + a request, get a channel mix, an offer
 * shortlist, or a compliance verdict. The vertical knowledge lives in the pack;
 * the strategy lives here (docs/VISION.md §3).
 */

export interface PackRequest {
  /** Category id within the vertical (e.g. 'plumbing', 'cosmetic'). */
  category: string;
  /** Total monthly ad budget in whole dollars. */
  monthlyBudget: number;
  /** Primary goal — biases the mix toward intent vs. demand-gen. */
  goal?: 'more_calls' | 'higher_ticket' | 'fill_schedule' | 'awareness';
  /** Whether the business runs true emergencies (24/7). */
  emergency?: boolean;
}

/** Resolve a request's urgency from its pack + chosen category, with a fallback. */
export function resolveUrgency(pack: CommandPack, category: string): number {
  return pack.categories.find((c) => c.id === category)?.urgency ?? pack.baseUrgency;
}

export function budgetBand(pack: CommandPack, monthlyBudget: number): BudgetBand {
  const { growth, scale } = pack.economics.budgetBands;
  if (monthlyBudget < growth) return 'starter';
  if (monthlyBudget < scale) return 'growth';
  return 'scale';
}

/**
 * Produce the paid-channel weights for a request: the pack's band baseline,
 * adjusted by category urgency and goal, then renormalized to sum to 1 over the
 * paid channels (the managed profile is excluded — it's unpaid).
 */
export function channelWeights(pack: CommandPack, req: PackRequest): Record<Channel, number> {
  const band = budgetBand(pack, req.monthlyBudget);
  const base = { ...pack.economics.bandWeights[band] };
  const urgency = resolveUrgency(pack, req.category);

  // Urgency pulls dollars toward the high-intent channels (LSA + Search).
  const intentBoost = (urgency - 0.5) * 0.4; // −0.2..+0.2
  base.lsa += intentBoost * 0.6;
  base.search += intentBoost * 0.4;
  base.social -= intentBoost;

  switch (req.goal) {
    case 'awareness':
      base.social += 0.15;
      base.lsa -= 0.1;
      base.search -= 0.05;
      break;
    case 'higher_ticket':
      base.search += 0.1;
      base.social += 0.05;
      base.lsa -= 0.15;
      break;
    case 'fill_schedule':
    case 'more_calls':
      base.lsa += 0.1;
      base.social -= 0.1;
      break;
  }

  if (req.emergency) {
    base.lsa += 0.05;
    base.search += 0.05;
    base.social -= 0.1;
  }

  for (const c of PAID_CHANNELS) base[c] = Math.max(0, base[c]);
  const total = PAID_CHANNELS.reduce((s, c) => s + base[c], 0) || 1;
  for (const c of PAID_CHANNELS) base[c] = base[c] / total;
  base.managed_profile = 0;
  return base;
}

/** Pick offers that fit the chosen category (or the whole vertical), best-first. */
export function suggestOffers(pack: CommandPack, category: string, limit = 4): Offer[] {
  const scoped = pack.offerLibrary.filter((o) => o.category === category);
  const general = pack.offerLibrary.filter((o) => o.category === undefined);
  return [...scoped, ...general].slice(0, limit);
}

export interface IntakeValidation {
  /** Implied cost per lead = budget ÷ target leads. */
  cpl: number;
  low: number;
  median: number;
  high: number;
  status: 'ok' | 'tight' | 'unrealistic';
  /** Budget that would hit the target at the market median CPL. */
  recommendedBudget: number;
  message: string;
}

/**
 * The intake math validator (docs/VISION.md §5, feature #14). Checks a budget +
 * lead-goal against the vertical's real cost-per-lead benchmark and pushes back on
 * impossible asks — "1,000 leads at $100 isn't possible."
 */
export function validateIntake(pack: CommandPack, monthlyBudget: number, targetLeads: number): IntakeValidation {
  const { low, median, high } = pack.economics.cpaBenchmark;
  const cpl = targetLeads > 0 ? Math.round((monthlyBudget / targetLeads) * 100) / 100 : 0;
  const recommendedBudget = Math.round(targetLeads * median);
  const status: IntakeValidation['status'] = cpl >= median ? 'ok' : cpl >= low ? 'tight' : 'unrealistic';
  const message =
    status === 'ok'
      ? `$${cpl}/lead is on-market for ${pack.label} (median ~$${median}). This plan is achievable.`
      : status === 'tight'
        ? `$${cpl}/lead is tight for ${pack.label} ($${low}–$${high} range) — possible, but expect a slower ramp.`
        : `$${cpl}/lead is below the $${low}–$${high} range for ${pack.label}. For ${targetLeads} leads, budget ~$${recommendedBudget.toLocaleString()} (at the $${median} median).`;
  return { cpl, low, median, high, status, recommendedBudget, message };
}

export interface ClaimsCheck {
  ok: boolean;
  violations: string[];
}

/** Universal claims that no vertical may make. */
const UNIVERSAL_BANNED = [
  { pattern: /\bguarantee(d|s)?\b/i, reason: 'Unsupported guarantee' },
  { pattern: /\b100%\b/, reason: 'Absolute claim' },
  { pattern: /\bbest in (the )?(state|country|city|world)\b/i, reason: 'Unsupported superlative' },
  { pattern: /\b#1\b/, reason: 'Unsupported ranking claim' },
  { pattern: /\bcheapest\b/i, reason: 'Unsupported price superlative' },
  { pattern: /\bonly \d+ (spots|slots) left\b/i, reason: 'Fabricated urgency' },
  { pattern: /\btoday only\b/i, reason: 'Fabricated urgency' },
];

/**
 * The claims checklist — the honesty guardrail (docs/VISION.md §5/§6). Runs the
 * universal rules plus the pack's own compliance patterns. This is what lets the
 * marketplace rank skills by *measured* lift instead of seller-typed hype.
 */
export function checkClaims(pack: CommandPack, text: string): ClaimsCheck {
  const violations: string[] = [];
  for (const { pattern, reason } of UNIVERSAL_BANNED) {
    if (pattern.test(text)) violations.push(`${reason}: "${pattern.exec(text)?.[0] ?? ''}"`);
  }
  for (const { pattern, reason } of pack.compliance.bannedPatterns) {
    if (pattern.test(text)) violations.push(`${reason}: "${pattern.exec(text)?.[0] ?? ''}"`);
  }
  return { ok: violations.length === 0, violations };
}
