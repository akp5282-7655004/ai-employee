/**
 * Miles as CMO — one AI employee who runs the whole marketing function. Not a
 * team of separate people: Miles handles strategy, content, social, and ads
 * himself. When you ask for a campaign, Miles sets the angle first, then builds
 * the content, social, and ads from that same angle — one coherent plan, one
 * voice.
 *
 * This module is the pure core: the areas Miles covers, the per-stage prompt
 * builders, and templated fallbacks. The orchestration (running the LLM chain)
 * lives in server.ts, the same seam every other agent uses.
 */
export interface Capability {
  id: string;
  title: string;
  blurb: string;
  skills: string[];
  /** Deep-link to the Miles surface that does this work for real. */
  tool: { label: string; page: string };
}

/** The areas Miles covers as your CMO — one employee, many jobs. */
export const CMO_AREAS: Capability[] = [
  {
    id: 'strategist',
    title: 'Strategy & Positioning',
    blurb: 'Sets your angle, offer and competitive edge — the brief every other piece of the campaign is built on.',
    skills: ['Positioning', 'Offer & angle', 'Competitive read', 'Audience', 'Campaign brief'],
    tool: { label: 'See recommendations', page: 'recs' },
  },
  {
    id: 'content',
    title: 'Content & SEO',
    blurb: 'Turns one idea into blogs, email sequences and landing copy that move a homeowner from curious to booked.',
    skills: ['Blog writing', 'SEO briefs', 'Email sequences', 'Landing copy', 'Case studies'],
    tool: { label: 'Open Creative Studio', page: 'studio' },
  },
  {
    id: 'social',
    title: 'Social',
    blurb: 'Plans the calendar, writes the posts, and ships scroll-stopping creative that sounds like you.',
    skills: ['Post creation', 'Content calendar', 'Social creative', 'Community replies', 'Hashtags'],
    tool: { label: 'Open Content Calendar', page: 'calendar' },
  },
  {
    id: 'ads',
    title: 'Ads & Creative',
    blurb: 'Builds the paid campaigns and creative — benchmarked against the ads your local competitors are running.',
    skills: ['Ad concepts', 'Ad copywriting', 'Creative direction', 'Competitor angles', 'Budget split'],
    tool: { label: 'Open Ad Studio', page: 'adstudio' },
  },
  {
    id: 'reception',
    title: 'Front Desk & Follow-up',
    blurb: 'Answers every new lead within a minute, follows up, and handles reviews — so won leads become booked jobs.',
    skills: ['Speed-to-Lead', 'Lead follow-up', 'Review responses', 'Appointment nudges', 'Missed-call text-back'],
    tool: { label: 'Set up Speed-to-Lead', page: 'overview' },
  },
];

/** Section titles for a campaign's parts (all authored by Miles). */
export const AREA_TITLE: Record<string, string> = {
  content: 'Content & SEO',
  social: 'Social',
  ads: 'Ads & Creative',
};

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

/** Miles sets the angle first — the brief the rest of the campaign is built on. */
export function strategistPrompt(goal: string, c: TeamCtx): { system: string; user: string } {
  return {
    system: `You are Miles, the AI CMO for ${who(c)}. Reply in tight Markdown. Set the campaign brief: a one-line CAMPAIGN ANGLE, 3 KEY MESSAGES (bullets), the TARGET CUSTOMER (one line), and the PRIMARY OFFER to lead with (one line). No fluff, no preamble. You'll build the content, social, and ads from this brief yourself, so make it concrete and specific to this business.`,
    user: `${contextBlock(c)}\n\nGoal: ${goal}\n\nWrite the campaign brief.`,
  };
}

/** Miles then produces each part of the campaign from his own brief. */
function stage(instruction: string, goal: string, angle: string, c: TeamCtx): { system: string; user: string } {
  return {
    system: `You are Miles, the AI CMO for ${who(c)}. Reply in tight Markdown, no preamble. Build directly on your own campaign brief below — keep the same offer, messages, and voice so the whole campaign is consistent. ${instruction}`,
    user: `${contextBlock(c)}\n\nGoal: ${goal}\n\nYour campaign brief:\n${angle}\n\nNow produce this part.`,
  };
}
export function contentPrompt(goal: string, angle: string, c: TeamCtx) {
  return stage('Deliver a short content plan: one blog title + 2-sentence outline, and a 3-email nurture sequence (subject + one line each) that carries the offer.', goal, angle, c);
}
export function socialPrompt(goal: string, angle: string, c: TeamCtx) {
  return stage('Deliver 5 ready-to-post social posts for this campaign (platform + caption each), consistent with the angle and offer.', goal, angle, c);
}
export function adsPrompt(goal: string, angle: string, c: TeamCtx) {
  return stage('Deliver 3 ad concepts (headline + primary text + suggested visual each) and a one-line budget/targeting suggestion, all built on the angle and offer.', goal, angle, c);
}

// ── Templated fallbacks (used when no language model is configured) ──
export function fallbackStrategist(goal: string, c: TeamCtx): string {
  const offer = c.offers || 'your current offer';
  return `**Campaign angle:** ${c.business || 'You'} — the ${c.trade || 'local'} pros ${c.city ? `${c.city} ` : ''}homeowners trust.\n\n**Key messages:**\n- Fast, reliable, and local\n- ${offer}\n- Real reviews from real neighbors\n\n**Target:** homeowners nearby who need ${c.services || 'your services'} soon.\n\n**Lead offer:** ${offer}.`;
}
export function fallbackContribution(id: string, goal: string, c: TeamCtx): string {
  const offer = c.offers || 'your offer';
  if (id === 'content') return `**Blog:** "5 things to check before you hire a ${c.trade || 'pro'}" — build trust, end with ${offer}.\n\n**Emails:** 1) Welcome + ${offer}. 2) Proof (reviews, photos). 3) Last call on the offer.`;
  if (id === 'social') return `1) Facebook — before/after photo + ${offer}. 2) Instagram — 15s job clip. 3) Facebook — a 5-star review. 4) Instagram — meet the crew. 5) Facebook — "${offer}, this week only."`;
  if (id === 'ads') return `1) "${offer}" — book online in 60s. 2) "${c.city || 'Local'}'s top-rated ${c.trade || 'pros'}" — social proof. 3) "Need it fast?" — same-week service. Budget: start $20/day on the best performer.`;
  return `Miles is ready to help with ${goal}.`;
}
