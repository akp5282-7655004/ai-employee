/**
 * A **command pack** — the unit that turns the horizontal AI-employee engine into
 * a named specialist (docs/VISION.md §3). The engine (the agent loop, the
 * connectors, the honesty guardrails) is universal; a pack is the vertical
 * knowledge layered on top. A new vertical is a data file, not a rewrite — and
 * this same shape is the surface a marketplace creator authors a skill against
 * (§6).
 *
 * A pack only turns the **four knobs** the vision calls out:
 *   1. Urgency            → `baseUrgency` + per-`categories` urgency
 *   2. Location/proximity → `proximity`
 *   3. Offer wording      → `offerLibrary`
 *   4. Economics + compliance → `economics` + `compliance`
 */
export interface CommandPack {
  /** Stable id used to select the pack (the "door" a customer entered through). */
  id: string;
  /** Human label shown in the picker ("Home Services", "Dental"). */
  label: string;
  /** One line on who this pack is for. */
  description: string;
  /** Sub-categories a customer picks within the vertical. */
  categories: PackCategory[];

  // ── Knob 1: urgency ──────────────────────────────────────────────────────
  /** Fallback "call-me-now" urgency (0–1) when a category has none set. */
  baseUrgency: number;

  // ── Knob 2: location / proximity ─────────────────────────────────────────
  proximity: {
    /** Default service radius when the customer doesn't specify one. */
    defaultRadiusMiles: number;
    /** true → a tight "near me" radius dominates (emergency trades); false → wider catchment. */
    nearMeDominant: boolean;
  };

  // ── Knob 3: offer wording ────────────────────────────────────────────────
  /** Proven offers customers choose from — they can't type a weak one (§5). */
  offerLibrary: Offer[];

  // ── Knob 4: economics + compliance ───────────────────────────────────────
  economics: {
    /** Budget-band thresholds in $/mo: < growth = starter, < scale = growth, else scale. */
    budgetBands: { growth: number; scale: number };
    /** Channel-mix doctrine per band. Paid weights; the free managed channel is always 0. */
    bandWeights: Record<BudgetBand, Record<Channel, number>>;
    /** Typical average-ticket range ($) — feeds benchmarks and the trust meters (§5). */
    avgTicketRange: { low: number; high: number };
    /** Cost-per-lead benchmark ($) for this vertical — powers the CPA meter + intake validator (§5). */
    cpaBenchmark: { low: number; median: number; high: number };
  };
  /** Extra ad-claim rules on top of the universal checklist (HIPAA, board rules, …). */
  compliance: ComplianceProfile;
}

/** Marketing channels the employee can run. The map channel is managed but unpaid. */
export type Channel = 'lsa' | 'managed_profile' | 'search' | 'social';

export const PAID_CHANNELS: Channel[] = ['lsa', 'search', 'social'];

export interface PackCategory {
  /** The category id a customer selects. */
  id: string;
  label: string;
  /** 0–1, higher → more weight to high-intent channels (LSA + Search). */
  urgency: number;
}

export type BudgetBand = 'starter' | 'growth' | 'scale';

export interface Offer {
  id: string;
  /** Category id this offer suits, or omitted = fits the whole vertical. */
  category?: string;
  /** The customer-facing offer line, e.g. "$49 drain clearing, same-day". */
  headline: string;
  season?: 'spring' | 'summer' | 'fall' | 'winter' | 'year_round';
}

export interface ComplianceProfile {
  /** Patterns banned for THIS vertical beyond the universal claims checklist. */
  bannedPatterns: { pattern: RegExp; reason: string }[];
  /** Human-readable regulatory context surfaced to operators. */
  notes: string[];
}
