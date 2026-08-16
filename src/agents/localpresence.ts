/**
 * Local Presence audit — scores a contractor's Google Business Profile and
 * Local Services Ads setup against the master spec (specs/lsa_gbp.json,
 * docs/specs/lsa-gbp-specs-master.md) and produces a prioritized fix list.
 *
 * No live GBP/LSA API connection exists yet, so this runs as a guided
 * audit: answers come from the owner (yes / no / unknown), with a few
 * pre-checked from the business profile. Honest by design — "unknown"
 * counts against the score, because an unverified item is an unmanaged one.
 */
import { loadSpec } from '../specs/index.js';

export type AuditAnswer = 'yes' | 'no' | 'unknown';

export interface AuditCheck {
  key: string;
  label: string;
  why: string;
  weight: 1 | 2 | 3; // 3 = ranking-critical per the spec
  auto?: boolean; // answered from the business profile, not the owner
}

export interface AuditItem extends AuditCheck {
  answer: AuditAnswer;
}

export interface LocalPresenceAudit {
  gbp: { items: AuditItem[]; score: number; max: number };
  lsa: { items: AuditItem[]; score: number; max: number };
  priorities: { key: string; label: string; why: string; area: 'GBP' | 'LSA' }[];
}

export function gbpChecks(): AuditCheck[] {
  const g = loadSpec('lsa_gbp').gbp.profile;
  return [
    { key: 'gbp.claimed', label: 'Profile claimed and verified', why: 'Nothing else matters until you control the listing.', weight: 3 },
    { key: 'gbp.name_clean', label: 'Real-world business name only (no keywords/city stuffed in)', why: 'Keyword-stuffed names risk suspension.', weight: 3 },
    { key: 'gbp.primary_category', label: 'Correct primary category (most specific trade match)', why: 'The single strongest local ranking input.', weight: 3 },
    { key: 'gbp.secondary_categories', label: `Additional categories set (up to ${g.additional_categories.max_count})`, why: 'Each legitimate category widens the searches you can rank for.', weight: 2 },
    { key: 'gbp.sab_hidden', label: 'Service-area business: address hidden, service areas set', why: 'Most contractors must hide the address and define areas served.', weight: 2 },
    { key: 'gbp.phone_match', label: 'Primary phone matches website, LSA, and citations (NAP)', why: 'Mismatched numbers erode local trust signals.', weight: 3, auto: true },
    { key: 'gbp.website', label: 'Website linked (HTTPS)', why: 'Landing relevance feeds ranking.', weight: 2, auto: true },
    { key: 'gbp.hours', label: 'Hours complete, including special/holiday hours', why: 'Ranking input and customer trust.', weight: 2 },
    { key: 'gbp.description', label: `Description written (≤${g.description.max_chars} chars, trade + area, no URLs/promos)`, why: 'First ~250 chars show — make them count.', weight: 1 },
    { key: 'gbp.services', label: `${g.services.min_count_primary}+ services under the primary category, each described`, why: 'Services map your profile to more searches.', weight: 2 },
    { key: 'gbp.photos', label: `${g.photos.min_total}+ real photos (logo + cover + work), new ones monthly`, why: 'Photo volume and recency are prominence signals.', weight: 2 },
    { key: 'gbp.posts', label: `Posting every ${g.posts.cadence_days[0]}–${g.posts.cadence_days[1]} days`, why: 'Activity signal; posts surface in the profile carousel.', weight: 1 },
    { key: 'gbp.reviews_replied', label: 'Replying to 100% of reviews within 48h', why: 'Review engagement drives rating trust and LSA rank.', weight: 3 },
    { key: 'gbp.review_flow', label: 'Review request flow live (link sent after every job)', why: 'Velocity of new reviews beats total count.', weight: 3 },
    { key: 'gbp.qa_seeded', label: `${g.qa.seed_min}–${g.qa.seed_max} Q&A pairs seeded and monitored`, why: 'You answer the questions before a competitor does.', weight: 1 },
    { key: 'gbp.attributes', label: 'All applicable attributes on (veteran-owned, estimates, payments…)', why: 'Free differentiation chips in the profile.', weight: 1 },
  ];
}

export function lsaChecks(): AuditCheck[] {
  const l = loadSpec('lsa_gbp').lsa;
  return [
    { key: 'lsa.eligible', label: 'Category + metro supported (checked the LSA eligibility tool)', why: 'Nothing serves outside supported category/geo pairs.', weight: 3 },
    { key: 'lsa.verified', label: 'License, insurance, background checks submitted', why: `Approval takes ${l.eligibility.approval_weeks[0]}–${l.eligibility.approval_weeks[1]} weeks — start early.`, weight: 3 },
    { key: 'lsa.badge', label: 'Google Guaranteed badge live', why: 'The badge is what makes LSA convert.', weight: 3 },
    { key: 'lsa.name_match', label: 'Business name exactly matches GBP and license', why: 'Mismatches stall verification and confuse customers.', weight: 2 },
    { key: 'lsa.job_types', label: 'Every offered job type ON, everything else OFF', why: 'Unchecked jobs = missed leads; wrong ones = disputed leads.', weight: 3 },
    { key: 'lsa.service_areas', label: 'Service areas match the real dispatch footprint', why: 'Leads outside your area still cost money until disputed.', weight: 2 },
    { key: 'lsa.hours', label: 'Hours complete and accurate (24/7 only if answered live)', why: 'Hours affect both ranking and when leads arrive.', weight: 2 },
    { key: 'lsa.photos', label: `${l.profile.photos.min_count}+ real photos (team, trucks, work — no stock)`, why: 'Profiles with real photos win more clicks.', weight: 1 },
    { key: 'lsa.phone_answered', label: 'Phone answered live during business hours', why: 'Responsiveness is a top ranking lever — and missed calls are still charged.', weight: 3 },
    { key: 'lsa.lead_marking', label: `Every lead marked (booked / not booked / spam) within ${l.lead_management.mark_status_within_hours}h`, why: 'Unmarked leads hurt ranking.', weight: 2 },
    { key: 'lsa.disputes', label: `Invalid leads disputed within the ${l.lead_management.dispute_window_days}-day window`, why: 'Spam and out-of-area leads are refundable as budget credit.', weight: 2 },
    { key: 'lsa.budget', label: 'Weekly budget set from target lead volume (not a guess)', why: 'Underfunded budgets stop serving mid-week.', weight: 2 },
    { key: 'lsa.reviews', label: 'GBP review flow feeding the LSA rating', why: 'GBP is upstream of LSA — its reviews are the LSA rating.', weight: 3 },
  ];
}

/** Pre-answer the auto checks from the business profile. */
export function autoAnswers(profile: Record<string, string>): Record<string, AuditAnswer> {
  const out: Record<string, AuditAnswer> = {};
  out['gbp.website'] = /^https:\/\//.test(profile.website ?? '') ? 'yes' : (profile.website ? 'no' : 'unknown');
  out['gbp.phone_match'] = profile.phone ? 'unknown' : 'no'; // a number exists; matching is for the owner to confirm
  return out;
}

export function buildLocalPresenceAudit(answers: Record<string, AuditAnswer>, profile: Record<string, string>): LocalPresenceAudit {
  const auto = autoAnswers(profile);
  const materialize = (checks: AuditCheck[]): AuditItem[] =>
    checks.map((c) => ({ ...c, answer: answers[c.key] ?? auto[c.key] ?? 'unknown' }));
  const score = (items: AuditItem[]) => ({
    score: items.reduce((a, i) => a + (i.answer === 'yes' ? i.weight : 0), 0),
    max: items.reduce((a, i) => a + i.weight, 0),
  });
  const gbpItems = materialize(gbpChecks());
  const lsaItems = materialize(lsaChecks());
  const priorities = [
    ...gbpItems.filter((i) => i.answer !== 'yes').map((i) => ({ key: i.key, label: i.label, why: i.why, weight: i.weight, area: 'GBP' as const })),
    ...lsaItems.filter((i) => i.answer !== 'yes').map((i) => ({ key: i.key, label: i.label, why: i.why, weight: i.weight, area: 'LSA' as const })),
  ]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 6)
    .map(({ key, label, why, area }) => ({ key, label, why, area }));
  return { gbp: { items: gbpItems, ...score(gbpItems) }, lsa: { items: lsaItems, ...score(lsaItems) }, priorities };
}

/** 0–100 completeness for the gbp.completeness_score dashboard metric. */
export function gbpCompletenessScore(audit: LocalPresenceAudit): number {
  return audit.gbp.max ? Math.round((audit.gbp.score / audit.gbp.max) * 100) : 0;
}
