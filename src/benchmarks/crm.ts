/**
 * CRM outcome adapters.
 *
 * GoHighLevel is already ingested into the crmEvents ledger and deal reads.
 * This maps those records to counts. HubSpot, ServiceTitan, and Jobber have
 * no verified Pipedream action key in src/connectors/pipedreamCatalog.ts
 * (catalog read 2026-11-07). Their readers are stubs: they do not call the
 * network. The mappers exist so a future action can be wired without putting
 * a name, phone, email, or address on a benchmark row.
 */
import type { CrmEvent } from '../metrics/crmledger.js';
import type { Deal } from '../revenue/attribution.js';
import type { Platform } from './types.js';
import { platformOf } from './trades.js';

export interface CrmCounts {
  leads: number;
  bookedJobs: number;
  revenue: number;
}

export interface CrmDay {
  byPlatform: Partial<Record<Platform, CrmCounts>>;
  unattributed: CrmCounts;
}

export interface CrmAdapter {
  id: 'gohighlevel' | 'hubspot' | 'servicetitan' | 'jobber';
  /** Verified Pipedream action key, when the catalog lists one. */
  pipedreamAction: string | null;
  available: boolean;
  /** Shown in admin and docs until a real action exists. */
  todo: string | null;
}

export const GHL_ADAPTER: CrmAdapter = {
  id: 'gohighlevel',
  pipedreamAction: 'highlevel_oauth-upsert-contact',
  available: true,
  todo: null,
};

export const HUBSPOT_ADAPTER: CrmAdapter = {
  id: 'hubspot',
  pipedreamAction: null,
  available: false,
  todo: 'TODO: No verified Pipedream action key for HubSpot deals or revenue is listed in src/connectors/pipedreamCatalog.ts (catalog read 2026-11-07). Do not call HubSpot until an action key is confirmed on the Pipedream app page.',
};

export const SERVICETITAN_ADAPTER: CrmAdapter = {
  id: 'servicetitan',
  pipedreamAction: null,
  available: false,
  todo: 'TODO: No verified Pipedream action key for ServiceTitan jobs or invoices is listed in src/connectors/pipedreamCatalog.ts (catalog read 2026-11-07). Do not call ServiceTitan until an action key is confirmed.',
};

export const JOBBER_ADAPTER: CrmAdapter = {
  id: 'jobber',
  pipedreamAction: null,
  available: false,
  todo: 'TODO: No verified Pipedream action key for Jobber jobs or invoices is listed in src/connectors/pipedreamCatalog.ts (catalog read 2026-11-07). Do not call Jobber until an action key is confirmed.',
};

export const CRM_ADAPTERS: CrmAdapter[] = [GHL_ADAPTER, HUBSPOT_ADAPTER, SERVICETITAN_ADAPTER, JOBBER_ADAPTER];

const EMPTY: CrmCounts = { leads: 0, bookedJobs: 0, revenue: 0 };

function bucket(day: CrmDay, platform: Platform | null): CrmCounts {
  if (!platform) return day.unattributed;
  const existing = day.byPlatform[platform];
  if (existing) return existing;
  const next = { ...EMPTY };
  day.byPlatform[platform] = next;
  return next;
}

function dayKey(iso: string | undefined): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  return new Date(t).toISOString().slice(0, 10);
}

/** Counts only. The person's name, phone, and email are dropped. */
export function crmDayFromLedger(events: CrmEvent[], deals: Deal[], day: string): CrmDay {
  const out: CrmDay = { byPlatform: {}, unattributed: { ...EMPTY } };
  for (const event of events) {
    if (!event || dayKey(event.ts) !== day) continue;
    const platform = platformOf(event.utmSource);
    const row = bucket(out, platform);
    if (event.type === 'lead' || event.type === 'missed_call') row.leads += 1;
    if (event.type === 'closed_won' || event.type === 'job_complete') {
      row.bookedJobs += 1;
      if (event.type === 'closed_won' && event.amount && event.amount > 0) row.revenue += event.amount;
    }
  }
  for (const deal of deals) {
    if (!deal || !deal.won) continue;
    const when = dayKey(deal.wonAt || deal.createdAt);
    if (when && when !== day) continue;
    if (!when && day) continue;
    const platform = platformOf(deal.utmSource);
    const row = bucket(out, platform);
    row.bookedJobs += 1;
    if (deal.value > 0) row.revenue += deal.value;
  }
  return out;
}

/**
 * Read one CRM. Stubs never call `fetchAction`.
 * GoHighLevel does not use this path: the ledger is already in user data.
 */
export async function readCrmAdapter(
  adapter: CrmAdapter,
  fetchAction: (actionKey: string) => Promise<unknown>,
): Promise<{ jobs: CrmCounts; todo: string | null; called: boolean }> {
  if (!adapter.available || !adapter.pipedreamAction || adapter.id !== 'gohighlevel') {
    return { jobs: { ...EMPTY }, todo: adapter.todo, called: false };
  }
  await fetchAction(adapter.pipedreamAction);
  return { jobs: { ...EMPTY }, todo: null, called: true };
}

/** Shape-only mapper for a future HubSpot deals payload. Drops contact fields. */
export function mapHubspotDeals(raw: unknown): { bookedJobs: number; revenue: number } {
  const rows = Array.isArray(raw) ? raw : [];
  let bookedJobs = 0;
  let revenue = 0;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const deal = row as { stage?: string; amount?: number; properties?: { dealstage?: string; amount?: string } };
    const stage = (deal.stage || deal.properties?.dealstage || '').toLowerCase();
    if (stage !== 'closedwon' && stage !== 'closed_won' && stage !== 'won') continue;
    bookedJobs += 1;
    const amount = typeof deal.amount === 'number' ? deal.amount : Number(deal.properties?.amount);
    if (Number.isFinite(amount) && amount > 0) revenue += amount;
  }
  return { bookedJobs, revenue: Math.round(revenue * 100) / 100 };
}

/** Shape-only mapper for a future ServiceTitan jobs payload. Drops address and customer. */
export function mapServiceTitanJobs(raw: unknown): { bookedJobs: number; revenue: number } {
  const rows = Array.isArray(raw) ? raw : [];
  let bookedJobs = 0;
  let revenue = 0;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const job = row as { status?: string; total?: number; invoiceTotal?: number };
    const status = (job.status || '').toLowerCase();
    if (status !== 'completed' && status !== 'done' && status !== 'won') continue;
    bookedJobs += 1;
    const amount = job.invoiceTotal ?? job.total ?? 0;
    if (amount > 0) revenue += amount;
  }
  return { bookedJobs, revenue: Math.round(revenue * 100) / 100 };
}
