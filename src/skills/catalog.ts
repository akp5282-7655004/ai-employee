/**
 * The skill catalog — what the Marketplace actually installs. A skill is a small
 * pack of "plays": concrete, expert deliverables Miles produces on demand from the
 * customer's business profile (campaign blueprints, ad headlines, review templates,
 * nurture sequences). Each play carries a real system prompt; running one calls the
 * LLM (server.ts) and returns usable output — not a placeholder. Counts reflect the
 * real number of plays, so the storefront never claims more than it delivers.
 */
export interface SkillPlay {
  id: string;
  label: string;
  /** The expert instruction the LLM follows to produce this deliverable. */
  system: string;
}

export interface Skill {
  id: string;
  name: string;
  category: string;
  featured?: boolean;
  desc: string;
  /** One line describing what installing this actually gives you. */
  expertise: string;
  plays: SkillPlay[];
}

const P = (id: string, label: string, system: string): SkillPlay => ({ id, label, system });

export const SKILL_CATALOG: Skill[] = [
  {
    id: 'google-ads',
    name: 'Google Ads Toolkit',
    category: 'Advertising',
    featured: true,
    desc: 'Search & PMax campaign blueprints, responsive search ads, and negative-keyword lists tuned for local service.',
    expertise: 'Google Ads best practices for local-service businesses — tight ad groups, high-intent keywords, budget pacing.',
    plays: [
      P('search-blueprint', 'Search campaign blueprint', 'You are a Google Ads strategist for local-service businesses. Produce a ready-to-build Search campaign: 2-3 ad groups (themed), 8-12 high-intent keywords each with match types, a suggested daily budget split, and 3 negative keywords. Plain text, clearly structured.'),
      P('rsa', '15 RSA headlines + 4 descriptions', 'You are a Google Ads copywriter. Write 15 responsive search ad headlines (≤30 chars each) and 4 descriptions (≤90 chars each) for the business. Benefit-led, include calls to action and trust signals. Number them. Plain text.'),
      P('negatives', 'Negative keyword list', 'You are a Google Ads specialist. Produce a practical negative-keyword list (25-40 terms) to stop wasted spend for this trade — job-seekers, DIY, free, wrong services. Group by theme. Plain text.'),
    ],
  },
  {
    id: 'meta-ads',
    name: 'Meta Ads Toolkit',
    category: 'Advertising',
    featured: true,
    desc: 'Meta campaign structures, audience strategy, and scroll-stopping ad variations for Facebook & Instagram.',
    expertise: 'Meta Ads strategy — audience targeting, campaign budget optimization, creative angles that convert for the trades.',
    plays: [
      P('structure', 'Campaign structure + audiences', 'You are a Meta Ads strategist for local-service businesses. Produce a campaign structure: objective, 2-3 audiences (interests/geo/lookalike), budget split, and placements. Plain text, structured.'),
      P('variations', '3 ad variations', 'You are a Meta Ads copywriter. Write 3 complete ad variations (primary text ~3 sentences, a headline, and a description) with different angles — urgency, trust, offer. Plain text, numbered.'),
    ],
  },
  {
    id: 'lsa',
    name: 'Local Services Ads Pack',
    category: 'Advertising',
    desc: 'Google LSA setup checklist, lead-dispute scripts, and budget pacing for the trades.',
    expertise: 'Google Local Services Ads — Google Guaranteed setup, lead disputes, and weekly budget pacing.',
    plays: [
      P('setup', 'LSA setup checklist', 'You are a Google Local Services Ads expert. Produce a step-by-step LSA setup checklist for this trade — verification, service areas, categories, budget, and review strategy. Plain text, numbered.'),
      P('dispute', 'Lead dispute script', 'You are an LSA specialist. Write a concise, effective lead-dispute message template to Google for a bad/unqualified LSA lead, plus the 3 dispute reasons most likely to be approved. Plain text.'),
    ],
  },
  {
    id: 'seo-local',
    name: 'Local SEO & Google Business Profile',
    category: 'SEO',
    desc: 'GBP optimization checklists and ready-to-post Google Business Profile content for map-pack ranking.',
    expertise: 'Local SEO — Google Business Profile optimization, citations, and map-pack ranking factors.',
    plays: [
      P('gbp-checklist', 'GBP optimization checklist', 'You are a local SEO expert. Produce a prioritized Google Business Profile optimization checklist for this business — categories, services, photos, posts, Q&A, and review velocity — with why each matters. Plain text, numbered.'),
      P('gbp-posts', '5 Google Business posts', 'You are a local SEO copywriter. Write 5 Google Business Profile posts for this month — offers, tips, and seasonal hooks — each with a short CTA. Plain text, numbered.'),
    ],
  },
  {
    id: 'reviews',
    name: 'Review Booster',
    category: 'Reputation',
    desc: 'Review-request templates and owner responses to protect and grow your reputation.',
    expertise: 'Reputation management — review generation and professional responses to good and bad reviews.',
    plays: [
      P('requests', 'Review-request templates', 'You are a reputation expert. Write review-request templates: 2 SMS (short) and 1 email, sent after a completed job, that ethically maximize 5-star reviews. Include a placeholder for the review link. Plain text.'),
      P('responses', 'Responses to a 5-star & 1-star review', 'You are a business-owner voice coach. Write a warm response to a 5-star review and a calm, professional, de-escalating response to a 1-star review for this business. Plain text.'),
    ],
  },
  {
    id: 'weather',
    name: 'Weather-Triggered Ads',
    category: 'Automation',
    desc: 'Turn weather into demand — trigger ideas for heat, cold, and storms tuned to your trade.',
    expertise: 'Weather-driven demand — mapping conditions to the services people urgently need.',
    plays: [
      P('triggers', 'Weather trigger plan', 'You are a demand-marketing strategist. For this trade, list 5 weather triggers (condition → the service in demand → the ad angle → suggested budget move). Plain text, structured.'),
    ],
  },
  {
    id: 'email-sms',
    name: 'Email & SMS Nurture',
    category: 'CRM',
    desc: 'Win-back sequences, appointment reminders, and seasonal offers across email and text.',
    expertise: 'Lifecycle marketing — nurture, win-back, and reminder sequences across email and SMS.',
    plays: [
      P('nurture', '3-email nurture sequence', 'You are an email-marketing expert for local-service businesses. Write a 3-email nurture sequence (each: Subject, one-line preview, short body, one CTA) that turns a new lead into a booked job. Plain text, clearly separated.'),
      P('reminders', 'Appointment reminder templates', 'You write appointment reminders. Produce SMS (T-1 day, T-2 hours) and one email reminder template with reschedule/confirm options. Plain text.'),
    ],
  },
  {
    id: 'call-recovery',
    name: 'Call Tracking & Lead Recovery',
    category: 'CRM',
    desc: 'Missed-call text-back and lead-recovery sequences so no lead slips away.',
    expertise: 'Speed-to-lead — missed-call recovery and follow-up that books jobs from lost calls.',
    plays: [
      P('textback', 'Missed-call text-back templates', 'You are a speed-to-lead expert. Write 3 missed-call text-back templates (sent seconds after a missed call) that book the job, with a scheduling CTA. Plain text, numbered.'),
      P('recovery', 'Lead-recovery sequence', 'You write follow-up sequences. Produce a 4-touch lead-recovery sequence (SMS + email mix, over 7 days) for a lead who called but did not book. Plain text, labeled by day/channel.'),
    ],
  },
];

export function findSkill(id: string): Skill | undefined {
  return SKILL_CATALOG.find((s) => s.id === id);
}
export function findPlay(skillId: string, playId: string): { skill: Skill; play: SkillPlay } | undefined {
  const skill = findSkill(skillId);
  const play = skill?.plays.find((p) => p.id === playId);
  return skill && play ? { skill, play } : undefined;
}

/** The catalog trimmed for the client (no server-only prompt text). */
export function catalogForClient() {
  return SKILL_CATALOG.map((s) => ({
    id: s.id,
    name: s.name,
    cat: s.category,
    featured: !!s.featured,
    desc: s.desc,
    expertise: s.expertise,
    plays: s.plays.map((p) => ({ id: p.id, label: p.label })),
  }));
}
