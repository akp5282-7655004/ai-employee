/**
 * Speed-to-Lead — the keystone home-services play: 78% of homeowners hire whoever
 * answers first, so the money is in the 5-minute window. Unlike the daily lead
 * follow-up agent, this responder runs on every scheduler tick: the moment a new
 * lead appears it drafts a personalized first touch (SMS + email) and — when the
 * CRM is connected — sends it, then hands the lead off to the nurture sequence.
 *
 * This module is the pure, testable core: state, dedup, the reply prompt, a
 * demo-safe fallback, and the rollup. The runner + connector live in server.ts.
 */
import type { Lead } from '../connectors/types.js';

export interface AgentCtx {
  business?: string;
  trade?: string;
  city?: string;
  services?: string;
  offers?: string;
}

/** One recorded instant response — what was sent, to whom, and how fast. */
export interface ResponderLog {
  key: string;
  name: string;
  service?: string;
  source?: string;
  /** ISO instant we responded. */
  at: string;
  /** Channels actually sent (e.g. ['sms','email']); empty when held for connect. */
  channels: string[];
  /** True when nothing was connected, so the draft is ready but unsent. */
  held: boolean;
  /** Seconds from lead arrival to our response, when the lead's arrival is known. */
  responseSec?: number;
}

export interface SpeedToLeadState {
  enabled: boolean;
  /** Keys of leads already handled — the dedup ledger so no one is texted twice. */
  contacted: string[];
  /** Recent instant responses, newest first (capped). */
  log: ResponderLog[];
  /** Secret in the per-user inbound webhook URL (GHL posts lead/missed-call events). */
  webhookSecret?: string;
  /** Quiet-hours guard: hold SMS outside 8 AM–8 PM local (playbook global rule #2). */
  quietHours?: { enabled: boolean; tzOffsetMinutes: number };
}

export function emptyState(): SpeedToLeadState {
  return { enabled: false, contacted: [], log: [] };
}

const who = (c: AgentCtx): string =>
  `${c.business || 'a local business'}${c.trade ? ` (${c.trade})` : ''}${c.city ? `, ${c.city}` : ''}`;

/** A stable identity for a lead — the CRM id when present, else its content. */
export function leadKey(l: Lead): string {
  if (l.id) return `id:${String(l.id).trim()}`;
  return [l.name, l.service, l.source, l.createdAt]
    .map((x) => (x ?? '').toString().trim().toLowerCase())
    .join('|');
}

/**
 * New leads we haven't answered yet: skip ones the CRM already marked contacted,
 * skip anything already in our ledger, dedup within the batch, and cap per tick so
 * a backlog can't fan out into a burst of sends.
 */
export function selectNewLeads(leads: Lead[], contacted: string[], cap = 10): Lead[] {
  const seen = new Set(contacted);
  const out: Lead[] = [];
  for (const l of leads) {
    if (l.contacted) continue;
    const k = leadKey(l);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(l);
    if (out.length >= cap) break;
  }
  return out;
}

/** The LLM prompt for the very first outreach to one hot lead. */
export function instantReplyAgent(lead: Lead, c: AgentCtx): { system: string; user: string } {
  return {
    system:
      'You are the instant first-responder for a local-service business. A new lead just came in seconds ago — speed and warmth win the job. Produce EXACTLY two labeled parts and nothing else:\n' +
      'TEXT: one SMS under 160 characters — friendly and human, reference what they asked about, and ask ONE easy question to start a conversation (like the best time for a quick call). No links unless essential.\n' +
      'EMAIL: a short email — a "Subject:" line then a 3-4 sentence body with a clear next step, signed as the business.\n' +
      'Plain text, no preamble.',
    user:
      `Business: ${who(c)}.${c.services ? ` Services: ${c.services}.` : ''}${c.offers ? ` Current offer: ${c.offers}.` : ''}\n` +
      `New lead: ${lead.name || 'a homeowner'} — asked about ${lead.service || 'your services'} (via ${lead.source || 'your website'}).` +
      (lead.message ? ` Their message: "${lead.message}"` : ''),
  };
}

/** The 30-second missed-call text-back (recipe #2) — the highest-ROI local play. */
export function missedCallText(c: AgentCtx, callerName?: string): string {
  const biz = c.business || 'our team';
  const name = callerName && callerName.trim() ? callerName.trim().split(' ')[0] + ', ' : '';
  return `Sorry we missed your call! ${name}this is ${biz}. How can we help — reply here or we'll call you right back.`;
}

/** Demo-safe first touch when no LLM key is set. */
export function fallbackInstantReply(lead: Lead, c: AgentCtx): string {
  const name = lead.name || 'there';
  const svc = lead.service || 'your project';
  const biz = c.business || 'our team';
  return (
    `TEXT: Hi ${name}, this is ${biz} — thanks for reaching out about ${svc}! ` +
    `What's the best time to give you a quick call today?\n\n` +
    `EMAIL:\nSubject: Quick reply about ${svc}\n` +
    `Hi ${name},\nThanks for contacting ${biz} about ${svc}. We'd love to help and can usually get you a fast quote. ` +
    `When's a good time for a 5-minute call?\n— ${biz}`
  );
}

/** Pull just the SMS line out of a TEXT:/EMAIL: reply, for sending over SMS. */
export function smsFromReply(reply: string): string {
  const m = reply.match(/TEXT:\s*([\s\S]*?)(?:\n\s*\n|\nEMAIL:|$)/i);
  const sms = (m?.[1] ?? reply).trim();
  return sms.length > 320 ? sms.slice(0, 317) + '…' : sms;
}

/** Seconds from a lead's arrival to now, when the arrival time is known. */
export function responseSeconds(lead: Lead, nowISO: string): number | undefined {
  if (!lead.createdAt) return undefined;
  const t = Date.parse(lead.createdAt);
  const n = Date.parse(nowISO);
  if (Number.isNaN(t) || Number.isNaN(n)) return undefined;
  return Math.max(0, Math.round((n - t) / 1000));
}

/** Append one handled lead to the state — ledger + log, both capped. */
export function recordContact(
  state: SpeedToLeadState,
  lead: Lead,
  nowISO: string,
  channels: string[],
  held: boolean,
  responseSec?: number,
): SpeedToLeadState {
  const key = leadKey(lead);
  const entry: ResponderLog = {
    key,
    name: lead.name || 'New lead',
    service: lead.service,
    source: lead.source,
    at: nowISO,
    channels,
    held,
    ...(responseSec != null ? { responseSec } : {}),
  };
  return {
    ...state,
    contacted: [...state.contacted, key].slice(-1000),
    log: [entry, ...state.log].slice(0, 100),
  };
}

function fmtDuration(sec: number): string {
  if (sec < 120) return `${sec}s`;
  const m = Math.round(sec / 60);
  return m < 90 ? `${m} min` : `${Math.round(m / 60)} hr`;
}

/**
 * Rollup for the dashboard: whether it's on, today's instant-response count, the
 * average response time (when timing is known), and whether anything is being held
 * because no CRM is connected.
 */
export function responderStats(
  state: SpeedToLeadState | undefined,
  nowISO: string,
): { enabled: boolean; today: number; total: number; avgResponse: string | null; held: number } {
  const s = state ?? emptyState();
  const today = nowISO.slice(0, 10);
  const todays = s.log.filter((e) => e.at.slice(0, 10) === today);
  const timed = s.log.filter((e) => typeof e.responseSec === 'number');
  const avgSec = timed.length ? Math.round(timed.reduce((a, e) => a + (e.responseSec || 0), 0) / timed.length) : null;
  return {
    enabled: !!s.enabled,
    today: todays.length,
    total: s.log.length,
    avgResponse: avgSec != null ? fmtDuration(avgSec) : null,
    held: todays.filter((e) => e.held).length,
  };
}
