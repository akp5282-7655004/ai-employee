/**
 * The checks every customer text goes through before it leaves Miles:
 * a per-account opt-out list (STOP and its synonyms, CRM opt-out flags) and
 * quiet hours. Pure and testable; the shared sender in server.ts calls these
 * so no SMS path can skip them.
 */
import { toE164 } from '../identity/fields.js';
import type { SpeedToLeadState } from './speed_to_lead.js';
import { isOptOutMessage, isQuietHour, offsetMinutes, zoneForLead } from '../qa/ownerrows.js';

/** Whole-message opt-out keywords (carrier standard), case-insensitive. */
const STOP_WORDS = new Set(['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit']);

/** True when the whole reply is an opt-out keyword ("STOP", "stop.", " Quit "). */
export function isStopMessage(text: unknown): boolean {
  if (typeof text !== 'string') return false;
  const word = text.trim().replace(/[.!\s]+$/g, '').toLowerCase();
  return STOP_WORDS.has(word) || isOptOutMessage(text);
}

/** A phone in E.164, or '' when it is missing or does not parse. */
export function e164(phone: unknown): string {
  const r = toE164(phone);
  return r.ok ? r.value : '';
}

/** True when a CRM payload marks the person as not wanting texts. */
export function payloadOptsOut(b: Record<string, unknown>): boolean {
  const yes = (v: unknown) => v === true || v === 'true' || v === 1 || v === '1';
  return yes(b.optOut) || yes(b.opt_out) || yes(b.dnd) || b.consent === false || b.consent === 'false';
}

/** The account's opted-out phones in E.164. Also reads the older `optOutPhones`
 *  list (raw phones), so a number on either list is never texted. */
export function readOptOuts(data: Record<string, unknown>): string[] {
  const list = Array.isArray(data.smsOptOuts) ? (data.smsOptOuts as unknown[]).filter((p): p is string => typeof p === 'string') : [];
  const older = Array.isArray(data.optOutPhones) ? (data.optOutPhones as unknown[]).map((p) => e164(p)).filter((p) => p && !list.includes(p)) : [];
  return older.length ? [...list, ...older] : list;
}

/** Remember an opted-out phone on the account. Returns false when the phone does not parse. */
export function addOptOut(data: Record<string, unknown>, phone: unknown): boolean {
  const p = e164(phone);
  if (!p) return false;
  const list = readOptOuts(data);
  if (!list.includes(p)) data.smsOptOuts = [p, ...list].slice(0, 5000);
  return true;
}

export function isOptedOut(data: Record<string, unknown>, phone: unknown): boolean {
  const p = e164(phone);
  return !!p && readOptOuts(data).includes(p);
}

export interface QuietHours { enabled: boolean; tzOffsetMinutes: number }

/** US Central standard time, used when the owner has never told us their offset. */
export const DEFAULT_TZ_OFFSET_MINUTES = -360;

/**
 * The quiet hours that are actually enforced. With nothing saved this is the
 * documented default: on, 8 AM to 8 PM. The offset is the owner's, taken from
 * their saved schedules when there are any (those store getTimezoneOffset()
 * minutes, so the sign flips), else US Central. Miles is US-only at launch,
 * and a UTC default would hold every text from mid-afternoon US time.
 */
export function effectiveQuietHours(data: Record<string, unknown>): QuietHours {
  const saved = (data.speedToLead as SpeedToLeadState | undefined)?.quietHours;
  if (saved) return { enabled: !!saved.enabled, tzOffsetMinutes: Number(saved.tzOffsetMinutes) || 0 };
  const agents = Array.isArray(data.schedules) ? (data.schedules as { tzOffset?: number }[]) : [];
  const withTz = agents.find((a) => typeof a?.tzOffset === 'number' && a.tzOffset !== 0);
  return { enabled: true, tzOffsetMinutes: withTz ? -Number(withTz.tzOffset) : DEFAULT_TZ_OFFSET_MINUTES };
}

/** True when a text would land outside 8 AM to 8 PM in the given offset. */
export function inQuietHours(q: QuietHours, nowMs: number): boolean {
  if (!q.enabled) return false;
  const h = new Date(nowMs + (q.tzOffsetMinutes || 0) * 60_000).getUTCHours();
  return h < 8 || h >= 20;
}

/**
 * The one quiet-hours rule for a text to one person. Quiet when it is outside
 * 8 AM to 8 PM for the owner (the enforced setting above), or, when the lead's
 * area code or ZIP shows a time zone, outside 8 AM to 8 PM where the lead is.
 * Either one holds the text. Turning quiet hours off turns both off.
 */
export function quietForLead(data: Record<string, unknown>, nowMs: number, phone?: string, zip?: string): boolean {
  const q = effectiveQuietHours(data);
  if (!q.enabled) return false;
  if (inQuietHours(q, nowMs)) return true;
  const zone = zoneForLead(phone, zip);
  return !!zone && isQuietHour(new Date(nowMs), offsetMinutes(zone, new Date(nowMs)));
}

/** Why a text did or did not go out. Only 'sent' means it reached the CRM. */
export type SmsStatus = 'sent' | 'failed' | 'not_connected' | 'opted_out' | 'quiet_hours' | 'no_phone' | 'bad_phone' | 'blocked' | 'paused';

export interface SmsResult { sent: boolean; status: SmsStatus; reason: string }

export function smsResult(status: SmsStatus): SmsResult {
  const reasons: Record<SmsStatus, string> = {
    sent: 'Sent via GoHighLevel.',
    failed: 'Failed, not sent. GoHighLevel did not accept the text.',
    not_connected: 'Drafted, not sent. Connect GoHighLevel to send automatically.',
    opted_out: 'Not sent. This number opted out of texts.',
    quiet_hours: 'Held for quiet hours (8 AM to 8 PM local). Not sent.',
    no_phone: 'Not sent. No phone number.',
    bad_phone: 'Not sent. The phone number does not parse.',
    blocked: 'Not sent. Held by the safety check.',
    paused: 'Not sent. This account is paused.',
  };
  return { sent: status === 'sent', status, reason: reasons[status] };
}

/** The first line of a run body that says honestly what happened to a text. */
export function smsRunHead(r: SmsResult): string {
  if (r.sent) return 'Sent via GoHighLevel:\n';
  if (r.status === 'not_connected') return 'Drafted (connect GoHighLevel to auto-send):\n';
  return `${r.reason}\n`;
}
