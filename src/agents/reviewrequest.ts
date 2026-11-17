/**
 * Post-Job Review Request (GHL recipe #14) — the reputation flywheel, event-driven.
 * When a job is marked complete, Miles texts every customer the same ask with the
 * Google review link when one is saved. There is no score gate: a customer's reply
 * is only logged with its rating, and no second text is sent. A STOP reply puts
 * the number on the account's opt-out list.
 *
 * Pure, testable core: templates, rating parse, and state. The webhook runner +
 * connector live in server.ts.
 */

export interface ReviewCtx {
  business?: string;
  trade?: string;
  googleReviewUrl?: string;
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
  outcome: 'asked' | 'promoter' | 'detractor' | 'rated' | 'opted_out';
  at: string;
  /** The CRM's event id, when it sent one, so a replayed webhook does not text twice. */
  eventId?: string;
  /** What happened to the text: sent, failed, opted_out, quiet_hours, not_connected, … */
  status?: string;
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

/** Sent to every completed job. The review link is included for everyone. No coupon and no score gate. */
export function reviewAskText(c: ReviewCtx): string {
  const biz = c.business || 'our team';
  const link = c.googleReviewUrl ? ` If you have a minute, a Google review helps: ${c.googleReviewUrl}` : '';
  return `Thanks for choosing ${biz}! How did the job go?${link}`;
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
