import type { CommandPack } from './types.js';

/**
 * The **dental pack** — the proof that a new vertical is a data file, not a
 * rewrite (docs/VISION.md §3). It shares the entire engine with home services and
 * only turns the four knobs:
 *
 *   1. Urgency  — dental is a *considered, scheduled* purchase (except true dental
 *      emergencies), so urgency is lower → the mix leans off LSA toward Search/social.
 *   2. Proximity — a destination-tolerant catchment, not a tight "near me" radius.
 *   3. Offers — new-patient exams, whitening, Invisalign consults.
 *   4. Economics + compliance — bigger tickets and budgets, plus health-claim rules
 *      (no promises of painlessness or guaranteed outcomes; HIPAA in ad content).
 */
export const dentalPack: CommandPack = {
  id: 'dental',
  label: 'Dental',
  description: 'Dental practices — general, cosmetic, ortho, implants — running $1k–$20k/mo.',

  // Knob 1 — urgency. Scheduled/considered, so lower than the trades; emergencies excepted.
  categories: [
    { id: 'emergency_dental', label: 'Emergency Dental', urgency: 0.85 },
    { id: 'general', label: 'General Dentistry', urgency: 0.45 },
    { id: 'cosmetic', label: 'Cosmetic', urgency: 0.35 },
    { id: 'orthodontics', label: 'Orthodontics', urgency: 0.3 },
    { id: 'implants', label: 'Implants', urgency: 0.3 },
    { id: 'other', label: 'Other', urgency: 0.4 },
  ],
  baseUrgency: 0.45,

  // Knob 2 — proximity. Patients travel for a practice; wider radius, not "near me now".
  proximity: { defaultRadiusMiles: 12, nearMeDominant: false },

  // Knob 3 — offer wording. Proven, compliant new-patient hooks.
  offerLibrary: [
    { id: 'dn-newpatient', headline: '$99 new-patient exam, cleaning & X-rays', season: 'year_round' },
    { id: 'dn-whitening', category: 'cosmetic', headline: 'Free whitening with new-patient exam', season: 'year_round' },
    { id: 'dn-invisalign', category: 'orthodontics', headline: 'Free Invisalign consult + scan', season: 'year_round' },
    { id: 'dn-implant', category: 'implants', headline: 'Complimentary implant consultation & 3D scan', season: 'year_round' },
    { id: 'dn-emergency', category: 'emergency_dental', headline: 'Same-day emergency appointments', season: 'year_round' },
  ],

  // Knob 4 — economics + compliance.
  economics: {
    // Considered purchase → Search + social carry more of the mix than LSA.
    budgetBands: { growth: 3000, scale: 8000 },
    bandWeights: {
      starter: { lsa: 0.3, search: 0.5, social: 0.2, managed_profile: 0 },
      growth: { lsa: 0.2, search: 0.45, social: 0.35, managed_profile: 0 },
      scale: { lsa: 0.15, search: 0.45, social: 0.4, managed_profile: 0 },
    },
    avgTicketRange: { low: 200, high: 6000 },
  },
  compliance: {
    // Health-outcome claims a dental ad must not make.
    bannedPatterns: [
      { pattern: /\bpain[- ]?(free|less)\b/i, reason: 'Health-outcome claim (cannot promise absence of pain)' },
      { pattern: /\bguaranteed results?\b/i, reason: 'Guaranteed treatment outcome' },
      { pattern: /\bcure(s|d)?\b/i, reason: 'Implies a medical cure' },
      { pattern: /\bbest dentist\b/i, reason: 'Unsupported superlative about a provider' },
    ],
    notes: [
      'HIPAA: never reference identifiable patients or their treatment in ads.',
      'State dental board advertising rules govern before/after imagery and specialist titles.',
      'No guarantees of clinical outcomes.',
    ],
  },
};
