/**
 * "Miles, do this for me." Turns a plain-language request (typed or spoken) into a
 * finished, on-brand work-product that lands in the owner's review queue. Miles
 * picks the right workflow from the request, builds the deliverable using the
 * brand, and hands it back for a one-click review → deploy.
 *
 * Pure core: classify the request, build the prompt for each workflow, and
 * templated fallbacks. The LLM calls + persistence live in server.ts.
 */
import type { TeamCtx } from './team.js';

export type WorkKind = 'email' | 'social' | 'ads' | 'campaign';

export const KIND_LABEL: Record<WorkKind, string> = {
  email: 'Email campaign',
  social: 'Social posts',
  ads: 'Ad campaign',
  campaign: 'Full campaign',
};

/** Pick the workflow from the request. Falls back to a full campaign. */
export function classifyRequest(text: string): WorkKind {
  const t = (text || '').toLowerCase();
  if (/\b(email|newsletter|e-?mail|sequence|drip|inbox)\b/.test(t)) return 'email';
  if (/\b(ad|ads|google ads|meta ads|ppc|paid|campaign budget)\b/.test(t) && !/\bemail\b/.test(t)) return 'ads';
  if (/\b(social|post|posts|instagram|facebook|tiktok|reel|story)\b/.test(t)) return 'social';
  return 'campaign';
}

/** A short human title for the review card. */
export function titleFor(kind: WorkKind, request: string): string {
  const short = (request || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return `${KIND_LABEL[kind]} — ${short}${request.length > 60 ? '…' : ''}`;
}

function who(c: TeamCtx): string {
  return `${c.business || 'a local home-services business'}${c.trade ? ` (${c.trade})` : ''}${c.city ? ` in ${c.city}` : ''}`;
}
function ctxLine(c: TeamCtx): string {
  return [
    `Business: ${who(c)}.`,
    c.services ? `Services: ${c.services}.` : '',
    c.offers ? `Standing offer: ${c.offers}.` : '',
    c.voice ? `Brand voice: ${c.voice}.` : '',
  ].filter(Boolean).join(' ');
}

export function emailPrompt(request: string, c: TeamCtx) {
  return {
    system: `You are Miles, the AI CMO for ${who(c)}. Write a ready-to-send email marketing campaign in the brand voice, built around the exact offer and details in the request (dates, discount, limited slots, audience). Reply in Markdown with: SUBJECT LINE, PREVIEW TEXT, then the full EMAIL BODY with a clear call to action. If the request implies a sequence, give 3 emails. No preamble.`,
    user: `${ctxLine(c)}\n\nRequest: ${request}\n\nWrite the campaign.`,
  };
}
export function socialPrompt(request: string, c: TeamCtx) {
  return {
    system: `You are Miles, the AI CMO for ${who(c)}. Produce 5 ready-to-post social posts (platform + caption each) for the request, in the brand voice and carrying the exact offer/details. Markdown, no preamble.`,
    user: `${ctxLine(c)}\n\nRequest: ${request}\n\nWrite the posts.`,
  };
}
export function adsPrompt(request: string, c: TeamCtx) {
  return {
    system: `You are Miles, the AI CMO for ${who(c)}. Produce 3 ad concepts (headline + primary text + suggested visual each) and a one-line budget/targeting suggestion for the request, in the brand voice with the exact offer/details. Markdown, no preamble.`,
    user: `${ctxLine(c)}\n\nRequest: ${request}\n\nWrite the ads.`,
  };
}

export function fallbackWork(kind: WorkKind, request: string, c: TeamCtx): string {
  const offer = c.offers || 'our current offer';
  const biz = c.business || 'Your Company';
  if (kind === 'email')
    return `**Subject:** ${offer} — book your ${c.trade || 'service'} this month\n\n**Preview:** Limited spots — new customers save now.\n\nHi there,\n\n${biz} is offering ${offer} to new customers. We book fast and show up on time — and spots are limited. Reply or tap below to claim yours.\n\n**[Claim your spot →]**\n\n— ${biz}`;
  if (kind === 'social')
    return `1) Facebook — "${offer} for new customers this month." + before/after photo.\n2) Instagram — 15s job clip + the offer.\n3) Facebook — a 5-star review.\n4) Instagram — meet the crew.\n5) Facebook — "Spots are filling up — ${offer}."`;
  if (kind === 'ads')
    return `1) "${offer}" — new customers, book in 60s.\n2) "${c.city || 'Local'}'s top-rated ${c.trade || 'pros'}" — social proof.\n3) "Spots are limited" — urgency.\nBudget: start $20/day on the best performer.`;
  return `**Angle:** ${biz} — the ${c.trade || 'local'} pros homeowners trust.\n\n**Email, social and ads** all built around ${offer}. Connect a language model to generate the full copy.`;
}
