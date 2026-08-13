/**
 * Your Marketing Team — Miles's capabilities presented as a team of named
 * specialists who hand off to each other. Ask for a campaign and the Strategist
 * sets the angle first; the Content, Social and Ads specialists then each produce
 * their piece *from that same angle*, so the whole campaign is coherent instead of
 * a pile of disconnected outputs.
 *
 * This module is the pure core: the roster, the per-specialist prompt builders,
 * and templated fallbacks. The orchestration (running the LLM chain) lives in
 * server.ts, the same seam every other agent uses.
 */
export interface Specialist {
  id: string;
  name: string;
  role: string;
  blurb: string;
  skills: string[];
  /** Deep-link to the Miles surface that does this specialist's work for real. */
  tool: { label: string; page: string };
}

export const TEAM: Specialist[] = [
  {
    id: 'strategist',
    name: 'Marcus',
    role: 'Marketing Strategist',
    blurb: 'Sharpens your positioning and sets the angle every campaign runs on — so every other specialist writes from the same offer, voice, and value.',
    skills: ['Positioning', 'Offer & angle', 'Competitive read', 'Audience', 'Campaign brief', 'Talk tracks'],
    tool: { label: 'See recommendations', page: 'recs' },
  },
  {
    id: 'content',
    name: 'Paige',
    role: 'Content Strategist',
    blurb: 'Turns one idea into a content engine — blog posts, SEO, email sequences and landing copy that move a homeowner from curious to booked.',
    skills: ['Blog writing', 'SEO briefs', 'Email sequences', 'Landing copy', 'Case studies', 'Content plan'],
    tool: { label: 'Open Creative Studio', page: 'studio' },
  },
  {
    id: 'social',
    name: 'Maven',
    role: 'Social Media Manager',
    blurb: 'Runs your social like a newsroom — planning the calendar, writing posts, and shipping scroll-stopping creative that sounds like you.',
    skills: ['Post creation', 'Content calendar', 'Social creative', 'Community replies', 'Hashtags', 'Recaps'],
    tool: { label: 'Open Content Calendar', page: 'calendar' },
  },
  {
    id: 'ads',
    name: 'Ella',
    role: 'Ads & Creative Lead',
    blurb: 'Builds the paid campaigns and the creative behind them — benchmarked against the ads your local competitors are actually running.',
    skills: ['Ad concepts', 'Ad copywriting', 'Creative direction', 'Competitor angles', 'Budget split', 'Offer tests'],
    tool: { label: 'Open Ad Studio', page: 'adstudio' },
  },
  {
    id: 'reception',
    name: 'Rosa',
    role: 'Front Desk',
    blurb: 'Answers every new lead within a minute, follows up, and handles reviews — so the leads your ads win actually turn into booked jobs.',
    skills: ['Speed-to-Lead', 'Lead follow-up', 'Review responses', 'Appointment nudges', 'Missed-call text-back'],
    tool: { label: 'Set up Speed-to-Lead', page: 'overview' },
  },
];

export interface TeamCtx {
  business?: string;
  trade?: string;
  city?: string;
  services?: string;
  offers?: string;
  voice?: string;
}

function who(c: TeamCtx): string {
  return `${c.business || 'a local home-services business'}${c.trade ? ` (${c.trade})` : ''}${c.city ? ` in ${c.city}` : ''}`;
}
function contextBlock(c: TeamCtx): string {
  return [
    `Business: ${who(c)}.`,
    c.services ? `Services: ${c.services}.` : '',
    c.offers ? `Current offer: ${c.offers}.` : '',
    c.voice ? `Brand voice: ${c.voice}.` : '',
  ].filter(Boolean).join(' ');
}

/** The Strategist goes first and produces the angle everyone else works from. */
export function strategistPrompt(goal: string, c: TeamCtx): { system: string; user: string } {
  return {
    system: `You are Marcus, a sharp marketing strategist for home-services businesses. Reply in tight Markdown. Produce: a one-line CAMPAIGN ANGLE, 3 KEY MESSAGES (bullets), the TARGET CUSTOMER (one line), and the PRIMARY OFFER to lead with (one line). No fluff, no preamble. This brief is what the content, social, and ads specialists will build from, so make it concrete and specific to this business.`,
    user: `${contextBlock(c)}\n\nGoal: ${goal}\n\nWrite the campaign brief.`,
  };
}

/** Downstream specialists all receive the Strategist's angle and must build on it. */
function downstream(role: string, instruction: string, goal: string, angle: string, c: TeamCtx): { system: string; user: string } {
  return {
    system: `You are part of ${who(c)}'s marketing team. ${role} Reply in tight Markdown, no preamble. Build directly on the strategist's angle below — reference the same offer, messages, and voice so the whole campaign is consistent. ${instruction}`,
    user: `${contextBlock(c)}\n\nGoal: ${goal}\n\nStrategist's brief to build from:\n${angle}\n\nNow produce your part.`,
  };
}
export function contentPrompt(goal: string, angle: string, c: TeamCtx) {
  return downstream('You are Paige, a content strategist.', 'Deliver a short content plan: one blog title + 2-sentence outline, and a 3-email nurture sequence (subject + one line each) that carries the offer.', goal, angle, c);
}
export function socialPrompt(goal: string, angle: string, c: TeamCtx) {
  return downstream('You are Maven, a social media manager.', 'Deliver 5 ready-to-post social posts for this campaign (platform + caption each), consistent with the angle and offer.', goal, angle, c);
}
export function adsPrompt(goal: string, angle: string, c: TeamCtx) {
  return downstream('You are Ella, an ads & creative lead.', 'Deliver 3 ad concepts (headline + primary text + suggested visual each) and a one-line budget/targeting suggestion, all built on the angle and offer.', goal, angle, c);
}

// ── Templated fallbacks (used when no language model is configured) ──
export function fallbackStrategist(goal: string, c: TeamCtx): string {
  const offer = c.offers || 'your current offer';
  return `**Campaign angle:** ${c.business || 'You'} — the ${c.trade || 'local'} pros ${c.city ? `${c.city} ` : ''}homeowners trust.\n\n**Key messages:**\n- Fast, reliable, and local\n- ${offer}\n- Real reviews from real neighbors\n\n**Target:** homeowners nearby who need ${c.services || 'your services'} soon.\n\n**Lead offer:** ${offer}.`;
}
export function fallbackContribution(spec: Specialist, goal: string, c: TeamCtx): string {
  const offer = c.offers || 'your offer';
  if (spec.id === 'content') return `**Blog:** "5 things to check before you hire a ${c.trade || 'pro'}" — build trust, end with ${offer}.\n\n**Emails:** 1) Welcome + ${offer}. 2) Proof (reviews, photos). 3) Last call on the offer.`;
  if (spec.id === 'social') return `1) Facebook — before/after photo + ${offer}. 2) Instagram — 15s job clip. 3) Facebook — a 5-star review. 4) Instagram — meet the crew. 5) Facebook — "${offer}, this week only."`;
  if (spec.id === 'ads') return `1) "${offer}" — book online in 60s. 2) "${c.city || 'Local'}'s top-rated ${c.trade || 'pros'}" — social proof. 3) "Need it fast?" — same-week service. Budget: start $20/day on the best performer.`;
  return `${spec.name} is ready to help with ${goal}.`;
}
