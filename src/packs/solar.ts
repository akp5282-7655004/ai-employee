import type { CommandPack } from './types.js';

/**
 * The **solar pack** — the highest-ticket, most-considered vertical here. Long
 * sales cycle, heavy on Search + Social demand-gen, and compliance forbids
 * unqualified savings/ tax-credit promises (docs/VISION.md §3).
 */
export const solarPack: CommandPack = {
  id: 'solar',
  label: 'Solar',
  description: 'Solar & energy storage — residential, battery, commercial — running $3k–$50k/mo.',

  categories: [
    { id: 'residential', label: 'Residential Solar', urgency: 0.4 },
    { id: 'battery_storage', label: 'Battery Storage', urgency: 0.4 },
    { id: 'commercial', label: 'Commercial Solar', urgency: 0.3 },
    { id: 'other', label: 'Other', urgency: 0.35 },
  ],
  baseUrgency: 0.35,
  proximity: { defaultRadiusMiles: 60, nearMeDominant: false },

  offerLibrary: [
    { id: 'sl-quote', headline: 'Free solar savings estimate for your home', season: 'year_round' },
    { id: 'sl-zero', category: 'residential', headline: '$0-down solar with battery backup', season: 'year_round' },
    { id: 'sl-bill', category: 'residential', headline: 'See your new bill before you commit', season: 'year_round' },
  ],

  economics: {
    budgetBands: { growth: 6000, scale: 15000 },
    bandWeights: {
      starter: { lsa: 0.2, search: 0.5, social: 0.3, managed_profile: 0 },
      growth: { lsa: 0.15, search: 0.45, social: 0.4, managed_profile: 0 },
      scale: { lsa: 0.1, search: 0.45, social: 0.45, managed_profile: 0 },
    },
    avgTicketRange: { low: 12000, high: 45000 },
    cpaBenchmark: { low: 70, median: 110, high: 180 },
  },
  compliance: {
    bannedPatterns: [
      { pattern: /\bfree solar\b/i, reason: 'Solar is not free — implies a false claim' },
      { pattern: /\beliminate your (power|electric) bill\b/i, reason: 'Unqualified savings guarantee' },
      { pattern: /\bguaranteed (tax credit|savings)\b/i, reason: 'Tax-credit eligibility varies by customer' },
    ],
    notes: [
      'Savings and tax-credit eligibility vary by household — never guarantee them.',
      '"$0 down" refers to financing, not free — keep that clear.',
      'State + utility interconnection rules apply.',
    ],
  },
};
