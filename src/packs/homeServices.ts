import type { CommandPack } from './types.js';

/**
 * The **home-services pack** — the first vertical and the deepest playbook (docs/
 * VISION.md §4: the moat). Trades win on high-intent, "near me" channels: lead
 * with Local Services Ads + a managed profile, add Search once LSA saturates, add
 * social only at real budget for demand-gen — never the first dollar.
 */
export const homeServicesPack: CommandPack = {
  id: 'home_services',
  label: 'Home Services',
  description: 'Trades and home-service shops (plumbing, HVAC, electrical, roofing, …) running $500–$10k/mo.',

  // Knob 1 — urgency.
  categories: [
    { id: 'plumbing', label: 'Plumbing', urgency: 0.9 },
    { id: 'hvac', label: 'HVAC', urgency: 0.85 },
    { id: 'water_damage', label: 'Water Damage / Restoration', urgency: 0.95 },
    { id: 'electrical', label: 'Electrical', urgency: 0.8 },
    { id: 'garage_door', label: 'Garage Door', urgency: 0.7 },
    { id: 'roofing', label: 'Roofing', urgency: 0.55 },
    { id: 'pest_control', label: 'Pest Control', urgency: 0.6 },
    { id: 'landscaping', label: 'Landscaping', urgency: 0.4 },
    { id: 'remodeling', label: 'Remodeling', urgency: 0.3 },
    { id: 'other', label: 'Other', urgency: 0.6 },
  ],
  baseUrgency: 0.6,

  // Knob 2 — proximity. Trades win on "near me"; radius is tight.
  proximity: { defaultRadiusMiles: 25, nearMeDominant: true },

  // Knob 3 — offer wording. A starter library of proven, compliant offers.
  offerLibrary: [
    { id: 'hs-diagnostic', headline: 'Same-day diagnostic visit, waived with repair', season: 'year_round' },
    { id: 'hs-drain', category: 'plumbing', headline: '$49 drain clearing, same-day', season: 'year_round' },
    { id: 'hs-tuneup', category: 'hvac', headline: '$79 AC tune-up before summer', season: 'spring' },
    { id: 'hs-furnace', category: 'hvac', headline: '$89 furnace safety check before winter', season: 'fall' },
    { id: 'hs-panel', category: 'electrical', headline: 'Free electrical panel safety inspection', season: 'year_round' },
    { id: 'hs-roof', category: 'roofing', headline: 'Free roof inspection + storm-damage report', season: 'year_round' },
  ],

  // Knob 4 — economics + compliance.
  economics: {
    budgetBands: { growth: 1500, scale: 4000 },
    // The managed profile is run at $0 everywhere; paid weights sum to 1.
    bandWeights: {
      starter: { lsa: 0.8, search: 0.2, social: 0.0, managed_profile: 0 },
      growth: { lsa: 0.55, search: 0.3, social: 0.15, managed_profile: 0 },
      scale: { lsa: 0.4, search: 0.35, social: 0.25, managed_profile: 0 },
    },
    avgTicketRange: { low: 150, high: 1200 },
  },
  compliance: {
    // Home services adds nothing beyond the universal checklist; licensing/insurance
    // claims are gated on verified intake facts by the engine.
    bannedPatterns: [],
    notes: ['State/local contractor licensing governs "licensed" claims — gate on verified facts.'],
  },
};
