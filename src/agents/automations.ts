/**
 * Two more event-driven GHL plays Miles runs natively:
 *  #7  No-Show Recovery — appointment marked no-show → a warm rebook text with the
 *      calendar link (30–50% of no-shows rebook if contacted within the hour).
 *  #23 New Customer Onboarding — deal marked Closed Won → a welcome text AND the
 *      critical stop-the-prospect-nurtures step (nothing kills trust like a "still
 *      thinking about it?" SMS after they've paid).
 *
 * Pure, testable core: templates + state. The webhook runners live in server.ts.
 */

export interface AutoCtx {
  business?: string;
  trade?: string;
}

export interface AutoLog {
  name: string;
  phone?: string;
  at: string;
}
export interface AutomationsState {
  noShow: { enabled: boolean; calendarUrl?: string; log: AutoLog[] };
  onboarding: { enabled: boolean; log: AutoLog[] };
}

export function emptyAutomationsState(): AutomationsState {
  return { noShow: { enabled: false, log: [] }, onboarding: { enabled: false, log: [] } };
}

/** #7 — the warm rebook text sent when an appointment is marked no-show. */
export function noShowText(c: AutoCtx, name?: string, calendarUrl?: string): string {
  const biz = c.business || 'our team';
  const first = name && name.trim() ? name.trim().split(' ')[0] + ', ' : '';
  const link = calendarUrl && calendarUrl.trim() ? ` Grab a new time here: ${calendarUrl.trim()}` : ' Reply here and we’ll grab you a new time.';
  return `Hey ${first}looks like we missed each other for your ${biz} appointment.${link}`;
}

/** #23 — the welcome text sent when a deal is marked Closed Won. */
export function onboardingText(c: AutoCtx, name?: string): string {
  const biz = c.business || 'our team';
  const first = name && name.trim() ? name.trim().split(' ')[0] : 'there';
  return `Welcome aboard, ${first}! Thanks for choosing ${biz}. We’ll confirm your schedule and keep you posted every step of the way — reply here anytime with questions.`;
}
