/**
 * Post-Job Review Request (GHL recipe #14) — the reputation flywheel, event-driven.
 * When a job is marked complete, Miles texts a 1–10 ask. The reply is gated: 9–10
 * ("promoters") get the direct Google review link; 1–8 ("detractors") are routed to
 * a private service-recovery task and NEVER handed the public link. This keeps
 * unhappy customers off Google and turns happy ones into 5-star reviews.
 *
 * Pure, testable core: templates, rating parse, routing, and state. The webhook
 * runner + connector live in server.ts.
 */

export interface ReviewCtx {
  business?: string;
  trade?: string;
}

export interface ReviewPending {
  phone: string;
  name?: string;
  at: string; // ISO — when we sent the 1–10 ask
}
export interface ReviewLog {
  name: string;
  phone?: string;
  rating?: number;
  outcome: 'asked' | 'promoter' | 'detractor';
  at: string;
}
export interface ReviewRequestState {
  enabled: boolean;
  googleReviewUrl?: string;
  pending: ReviewPending[];
  log: ReviewLog[];
}

export function emptyReviewState(): ReviewRequestState {
  return { enabled: false, pending: [], log: [] };
}

/** Step 1 — the 1–10 ask, sent when a job is marked complete. */
export function reviewAskText(c: ReviewCtx): string {
  const biz = c.business || 'our team';
  return `Thanks for choosing ${biz}! Quick one — how did we do on a scale of 1-10? (Just reply with a number.)`;
}

/** Pull a 1–10 rating out of a free-text SMS reply. Returns null if none found. */
export function parseRating(message: string): number | null {
  const m = (message || '').match(/\b(10|[0-9])\b/);
  if (!m || m[1] === undefined) return null;
  const n = Number(m[1]);
  if (n < 1 || n > 10) return null;
  return n;
}

/** 9–10 → promoter (send the Google link); 1–8 → detractor (private recovery). */
export function routeRating(rating: number): 'promoter' | 'detractor' {
  return rating >= 9 ? 'promoter' : 'detractor';
}

/** Step 2a — promoter: hand them the direct Google review link. */
export function promoterText(c: ReviewCtx, googleReviewUrl?: string): string {
  const link = googleReviewUrl ? ` ${googleReviewUrl}` : '';
  return `Amazing — that means a lot! Would you mind sharing it on Google? Takes 30 seconds:${link}`.trim();
}

/** Step 2b — detractor: an apology; a manager follows up. NEVER a public link. */
export function detractorText(c: ReviewCtx): string {
  const biz = c.business || 'our team';
  return `Thank you for the honest feedback — we want to make this right. Someone from ${biz} will reach out shortly.`;
}

/** The internal recovery task text queued for the team on a low score. */
export function recoveryTask(name: string | undefined, rating: number): string {
  return `Service recovery call — ${name || 'customer'} rated us ${rating}/10. Call to make it right before it becomes a public review.`;
}
