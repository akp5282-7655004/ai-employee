import type { CommandPack } from './types.js';

/**
 * The **roofing pack** — storm/insurance-driven, high-ticket, considered. The mix
 * leans Search + Social (storm-damage creative, hail-claim funnels) over LSA, and
 * compliance forbids promising insurance outcomes (docs/VISION.md §3).
 */
export const roofingPack: CommandPack = {
  id: 'roofing',
  label: 'Roofing',
  description: 'Roofing & restoration — replacement, storm/hail claims, repairs — running $2k–$30k/mo.',

  categories: [
    { id: 'storm_damage', label: 'Storm / Hail Damage', urgency: 0.8 },
    { id: 'replacement', label: 'Roof Replacement', urgency: 0.45 },
    { id: 'repair', label: 'Roof Repair', urgency: 0.6 },
    { id: 'inspection', label: 'Inspection', urgency: 0.5 },
    { id: 'other', label: 'Other', urgency: 0.5 },
  ],
  baseUrgency: 0.5,
  proximity: { defaultRadiusMiles: 40, nearMeDominant: false },

  offerLibrary: [
    { id: 'rf-inspect', headline: 'Free roof inspection + storm-damage report', season: 'year_round' },
    { id: 'rf-claim', category: 'storm_damage', headline: 'Free hail-claim assistance & drone audit', season: 'summer' },
    { id: 'rf-finance', category: 'replacement', headline: '$0-down financing on a new roof', season: 'year_round' },
  ],

  economics: {
    budgetBands: { growth: 4000, scale: 12000 },
    bandWeights: {
      starter: { lsa: 0.35, search: 0.45, social: 0.2, managed_profile: 0 },
      growth: { lsa: 0.25, search: 0.45, social: 0.3, managed_profile: 0 },
      scale: { lsa: 0.2, search: 0.45, social: 0.35, managed_profile: 0 },
    },
    avgTicketRange: { low: 8000, high: 30000 },
    cpaBenchmark: { low: 90, median: 145, high: 220 },
  },
  compliance: {
    bannedPatterns: [
      { pattern: /\bfree roof\b/i, reason: 'Implies insurance fraud / a free roof' },
      { pattern: /\bwe('| wi)ll (get|win) your claim\b/i, reason: 'Guaranteed insurance-claim outcome' },
      { pattern: /\bwaive (your )?deductible\b/i, reason: 'Waiving deductibles is illegal in many states' },
    ],
    notes: [
      'Never promise an insurance claim will be approved.',
      'Waiving or absorbing deductibles is illegal in many states.',
      'State contractor licensing governs "licensed" claims.',
    ],
  },
};
