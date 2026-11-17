/**
 * CRM event ledger — the unified record every inbound webhook appends to,
 * regardless of whether an automation fired an SMS. This is what turns the
 * dashboard's crm.* metrics from sample data into the business's real
 * numbers: leads in, calls missed, jobs completed, deals won (with revenue).
 *
 * Stored additively in user data under `crmEvents` (capped); nothing about
 * the existing per-feature states (speedToLead, reviewRequest, automations)
 * changes.
 */

export type CrmEventType = 'lead' | 'missed_call' | 'job_complete' | 'no_show' | 'closed_won';

export interface CrmEvent {
  type: CrmEventType;
  ts: string; // ISO timestamp
  name?: string;
  amount?: number; // closed_won: the deal/job value when the CRM sends one
  /** The CRM's own id for this event, when it sends one. A repeat of type+id is skipped. */
  id?: string;
}

const CAP = 1200; // ~90 days of events for an active account; the dashboard reads 30

/** Append an event to the ledger inside a user-data object (mutates `data`). */
export function appendCrmEvent(data: Record<string, unknown>, ev: CrmEvent): boolean {
  const list = Array.isArray(data.crmEvents) ? (data.crmEvents as CrmEvent[]) : [];
  // A CRM retries webhooks. The same event (type + the CRM's id) counts once.
  if (ev.id && list.some((row) => row && row.type === ev.type && row.id === ev.id)) return false;
  if (!ev.id) delete ev.id;
  list.unshift(ev);
  data.crmEvents = list.slice(0, CAP);
  return true;
}

/** The CRM's id for a webhook event. Event-specific ids win over a generic id. */
export function crmEventIdFrom(b: Record<string, unknown>, keys: string[] = []): string | undefined {
  for (const k of [...keys, 'event_id', 'eventId', 'id']) {
    const v = b[k];
    if ((typeof v === 'string' && v.trim()) || (typeof v === 'number' && Number.isFinite(v))) return String(v).trim().slice(0, 200);
  }
  return undefined;
}

/**
 * When the event happened, from the payload's own timestamp when it sends one,
 * so a late or retried webhook lands on the right day. Falls back to now; a
 * time in the future is treated as now.
 */
export function crmEventTsFrom(b: Record<string, unknown>, nowMs: number = Date.now()): string {
  for (const k of ['timestamp', 'event_time', 'eventTime', 'date_created', 'dateAdded', 'date_added', 'created_at', 'createdAt']) {
    const v = b[k];
    if (v == null || v === '') continue;
    const ms = typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(String(v));
    if (Number.isFinite(ms) && ms > 0) return new Date(Math.min(ms, nowMs)).toISOString();
  }
  return new Date(nowMs).toISOString();
}

/** Pull a dollar amount out of a CRM webhook body — GHL and common aliases. */
export function amountFrom(b: Record<string, unknown>): number | undefined {
  for (const k of ['amount', 'value', 'monetary_value', 'monetaryValue', 'opportunity_value', 'deal_value', 'price', 'total']) {
    const v = b[k];
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[^0-9.]/g, '')) : NaN;
    if (Number.isFinite(n) && n > 0) return Math.round(n * 100) / 100;
  }
  return undefined;
}

/**
 * Compute live values for the metric keys the ledger can answer, over the
 * last `days`. Returns {} when the ledger has never seen an event — sample
 * data stays clearly sample until real events exist; once ANY event has
 * arrived, zeros are real zeros and every ledger metric goes live.
 */
export function crmLiveValues(data: Record<string, unknown>, days: number): Record<string, number> {
  const all = Array.isArray(data.crmEvents) ? (data.crmEvents as CrmEvent[]) : [];
  if (!all.length) return {};
  const cutoff = Date.now() - days * 86_400_000;
  const inRange = all.filter((e) => Date.parse(e.ts) >= cutoff);
  const count = (t: CrmEventType) => inRange.filter((e) => e.type === t).length;
  const leads = count('lead');
  const missed = count('missed_call');
  const completed = count('job_complete');
  const won = count('closed_won');
  const revenue = inRange.filter((e) => e.type === 'closed_won').reduce((a, e) => a + (e.amount ?? 0), 0);
  const out: Record<string, number> = {
    'crm.leads_created': leads + missed, // a missed call is still a lead that arrived
    'calls.missed': missed,
    'crm.completed_jobs': completed,
    'crm.estimates_won': won,
    // Best available proxy until a booking event exists: a won deal is a booked job.
    'crm.booked_jobs': won,
    'crm.job_revenue': revenue,
  };
  // A real zero denominator is live with no value (NaN), never a sample fallback.
  out['crm.avg_ticket'] = won > 0 && revenue > 0 ? Math.round((revenue / won) * 100) / 100 : NaN;
  out['crm.lead_to_book_rate'] = leads + missed > 0 ? Math.round((won / (leads + missed)) * 1000) / 10 : NaN;
  return out;
}

/**
 * Live values from a direct CRM deals read (GHL opportunities) — authoritative
 * for won/revenue when present, because it reflects the whole pipeline rather
 * than only events that fired webhooks. Returns {} when no deals exist.
 */
export function dealsLiveValues(deals: { value: number; won: boolean; createdAt?: string; wonAt?: string }[], days: number): Record<string, number> {
  if (!deals.length) return {};
  const cutoff = Date.now() - days * 86_400_000;
  const inRange = (d: { createdAt?: string; wonAt?: string }, key: 'createdAt' | 'wonAt') => {
    const t = Date.parse(d[key] ?? '');
    return Number.isFinite(t) ? t >= cutoff : true; // undated deals count — better than dropping them silently
  };
  const won = deals.filter((d) => d.won && inRange(d, 'wonAt'));
  const open = deals.filter((d) => !d.won);
  const revenue = Math.round(won.reduce((a, d) => a + (d.value || 0), 0) * 100) / 100;
  const out: Record<string, number> = {
    'crm.estimates_won': won.length,
    'crm.booked_jobs': won.length,
    'crm.job_revenue': revenue,
    'crm.pipeline_value': Math.round(open.reduce((a, d) => a + (d.value || 0), 0) * 100) / 100,
  };
  if (won.length > 0 && revenue > 0) out['crm.avg_ticket'] = Math.round((revenue / won.length) * 100) / 100;
  return out;
}

/**
 * Blend live CRM values with live ad spend into the calc.* money metrics.
 * A calc metric goes live only when every input it needs is live — mixed
 * real+sample math is never shown as real.
 */
export function calcLiveValues(crm: Record<string, number>, adSpend: number | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (adSpend !== undefined) {
    // Blended = every paid platform Miles can see; unconnected platforms
    // contribute nothing (and their own cards stay sample-labeled).
    out['calc.blended_spend'] = Math.round(adSpend * 100) / 100;
  }
  const leads = crm['crm.leads_created'];
  const booked = crm['crm.booked_jobs'];
  const revenue = crm['crm.job_revenue'];
  if (leads !== undefined) out['calc.blended_leads'] = leads;
  // When every input is live but the denominator is 0, the value is NaN:
  // live, with no number to show. The card shows a dash, never a sample.
  if (adSpend !== undefined && leads !== undefined) out['calc.blended_cpl'] = leads > 0 ? Math.round((adSpend / leads) * 100) / 100 : NaN;
  if (adSpend !== undefined && booked !== undefined) out['calc.cost_per_booked'] = booked > 0 ? Math.round((adSpend / booked) * 100) / 100 : NaN;
  if (adSpend !== undefined && revenue !== undefined) {
    out['calc.blended_roas'] = adSpend > 0 ? Math.round((revenue / adSpend) * 100) / 100 : NaN;
    out['calc.marketing_pct_revenue'] = revenue > 0 ? Math.round((adSpend / revenue) * 1000) / 10 : NaN;
  }
  return out;
}
