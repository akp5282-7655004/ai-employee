/**
 * Admin business view. Numbers come from stored accounts and, when the
 * caller passes them, live connected apps. Missing billing is "Not connected",
 * never a guessed dollar amount.
 */
import { BANDS, LAUNCH_GRANT, creditState } from '../billing/credits.js';
import { billingState } from '../billing/subscription.js';

export type AccountStatus = 'free credits' | 'paying' | 'credits exhausted' | 'churned';

export interface AdminAccountInput {
  id: string;
  email: string;
  name?: string;
  createdAt: string;
  data: Record<string, unknown>;
  /** null when the connector could not list apps. */
  apps: string[] | null;
  now?: string;
}

export interface AdminAccountRow {
  id: string;
  businessName: string;
  email: string;
  signupDate: string;
  plan: string;
  status: AccountStatus;
  monthlyPaid: number | 'Not connected';
  freeCreditsUsed: number;
  freeCreditsRemaining: number;
  freeCreditsGrant: number;
  paidUsage: number | 'Not connected';
  toolsConnected: number | 'Not connected';
  tools: string[];
  setupProgress: string;
  launched: boolean;
  lastActive: string | null;
  signupSource: { utmSource: string; utmCampaign: string; referrer: string };
  profit: number | 'Not connected';
  unprofitable: boolean | 'Not connected';
  leads: number;
  bookedJobs: number;
  adSpendManaged: number | 'Not connected';
  errors: { googleReads: number; launches: number; crawls: number };
  atRisk: boolean;
  nearCreditEnd: boolean;
}

export interface AdminBusinessView {
  billing: 'connected' | 'Not connected';
  totals: {
    signups: number;
    signupsThisWeek: number;
    paying: number | 'Not connected';
    freeToPaidRate: number | 'Not connected';
    mrr: number | 'Not connected';
    creditsConsumed: number;
    openRouterCost: number | 'Not connected';
    reachedThreeTools: number;
    launched: number;
    nearCreditEnd: number;
    atRisk: number;
  };
  funnel: { step: string; count: number; dropOff: number }[];
  sources: { source: string; count: number }[];
  accounts: AdminAccountRow[];
}

const WEEK_MS = 7 * 86_400_000;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function bandPrice(key: string | undefined): number | null {
  const band = BANDS.find((row) => row.key === key);
  return band ? band.monthlyPrice : null;
}

function countEvents(data: Record<string, unknown>, pattern: RegExp): number {
  const miles = (data.miles ?? {}) as { events?: { text?: string }[] };
  const events = Array.isArray(miles.events) ? miles.events : [];
  return events.filter((event) => pattern.test(event.text || '')).length;
}

export function accountRow(input: AdminAccountInput): AdminAccountRow {
  const now = input.now ? Date.parse(input.now) : Date.now();
  const data = input.data || {};
  const profile = (data.profile ?? {}) as Record<string, string>;
  const credits = creditState(data);
  const billing = billingState(data);
  const paying = billing.status === 'active' && (billing.band === 'starter' || billing.band === 'growth' || billing.band === 'scale');
  const churned = billing.status === 'canceled' || data.accountPaused === true;
  const remaining = Math.max(0, Math.round((credits.remaining) * 100) / 100);
  const used = Math.max(0, Math.round(credits.spent * 100) / 100);
  let status: AccountStatus = 'free credits';
  if (churned) status = 'churned';
  else if (paying) status = 'paying';
  else if (remaining <= 0 && used > 0) status = 'credits exhausted';
  const price = paying ? bandPrice(billing.band) : 0;
  const monthlyPaid: number | 'Not connected' = paying && price == null ? 'Not connected' : (paying ? price! : 0);
  const apps = input.apps;
  const website = text(profile.website);
  const toolNames = apps == null ? [] : [...apps];
  if (website) toolNames.push('website');
  const toolCount = apps == null && !website ? 'Not connected' as const : toolNames.length;
  const numericTools = typeof toolCount === 'number' ? toolCount : 0;
  const miles = (data.miles ?? {}) as { campaignResource?: string; activation?: string };
  const launched = !!(miles.campaignResource || (miles.activation && miles.activation !== 'none'));
  const source = (data.signupSource ?? {}) as { utmSource?: string; utmCampaign?: string; referrer?: string };
  const lastActive = text(data.lastActiveAt) || null;
  const idle = !lastActive || (Number.isFinite(now) && now - Date.parse(lastActive) > WEEK_MS);
  const googleOff = apps != null && !apps.includes('google_ads');
  const metaOff = apps != null && !apps.some((app) => /facebook|instagram/i.test(app));
  const snap = (data.snapshot ?? {}) as { campaigns?: { status?: string; spend?: number }[]; adSpend?: number };
  const pausedCampaign = (snap.campaigns || []).some((row) => String(row.status || '').toUpperCase() === 'PAUSED');
  const atRisk = !!(idle || googleOff || metaOff || pausedCampaign);
  const nearCreditEnd = status === 'free credits' && remaining > 0 && remaining <= 20;
  const leads = Array.isArray(data.crmEvents) ? (data.crmEvents as { type?: string }[]).filter((event) => event.type === 'lead' || event.type === 'missed_call').length : 0;
  const bookedJobs = Array.isArray(data.crmEvents) ? (data.crmEvents as { type?: string }[]).filter((event) => event.type === 'closed_won').length : 0;
  const adSpend = typeof snap.adSpend === 'number' ? snap.adSpend : (snap.campaigns ? snap.campaigns.reduce((sum, row) => sum + (row.spend || 0), 0) : 'Not connected' as const);
  const found = (miles as { found?: { fetchNote?: string } }).found;
  const openRouter = typeof data.openRouterCostUsd === 'number' ? data.openRouterCostUsd : null;
  const revenue = typeof monthlyPaid === 'number' ? monthlyPaid : null;
  const profit = revenue != null && openRouter != null ? Math.round((revenue - openRouter) * 100) / 100 : 'Not connected';
  return {
    id: input.id,
    businessName: text(profile.businessName) || text(input.name) || 'Untitled',
    email: input.email,
    signupDate: input.createdAt,
    plan: paying ? (billing.band || 'paying') : 'free',
    status,
    monthlyPaid,
    freeCreditsUsed: Math.min(used, LAUNCH_GRANT),
    freeCreditsRemaining: remaining,
    freeCreditsGrant: LAUNCH_GRANT,
    paidUsage: paying ? used : (billing.stripeCustomerId ? used : 'Not connected'),
    toolsConnected: toolCount,
    tools: toolNames,
    setupProgress: `${Math.min(numericTools, 3)} of 3`,
    launched,
    lastActive,
    signupSource: {
      utmSource: text(source.utmSource) || 'direct',
      utmCampaign: text(source.utmCampaign),
      referrer: text(source.referrer),
    },
    profit,
    unprofitable: typeof profit === 'number' ? profit < 0 : 'Not connected',
    leads,
    bookedJobs,
    adSpendManaged: adSpend,
    errors: {
      googleReads: countEvents(data, /could not be read|could not read campaign/i),
      launches: countEvents(data, /nothing was created|create failed/i),
      crawls: /fail|could not/i.test(found?.fetchNote || '') ? 1 : 0,
    },
    atRisk,
    nearCreditEnd,
  };
}

export function buildAdminBusiness(rows: AdminAccountInput[], opts?: { now?: string; stripeReady?: boolean }): AdminBusinessView {
  const nowMs = opts?.now ? Date.parse(opts.now) : Date.now();
  const accounts = rows.map((row) => accountRow({ ...row, now: opts?.now }));
  const weekStart = nowMs - WEEK_MS;
  const signupsThisWeek = accounts.filter((row) => Date.parse(row.signupDate) >= weekStart).length;
  const stripeReady = opts?.stripeReady === true;
  const payingCount = accounts.filter((row) => row.status === 'paying').length;
  const reached = accounts.filter((row) => typeof row.toolsConnected === 'number' && row.toolsConnected >= 3).length;
  const launched = accounts.filter((row) => row.launched).length;
  const setupDone = accounts.filter((row) => {
    const data = rows.find((item) => item.id === row.id)?.data || {};
    const profile = (data.profile ?? {}) as Record<string, string>;
    return !!(profile.businessName && profile.industry);
  }).length;
  const funnelCounts = [accounts.length, setupDone, reached, launched, stripeReady ? payingCount : 0];
  const steps = ['Signed up', 'Setup done', '3 tools', 'Launched', 'Paid'];
  const funnel = steps.map((step, index) => ({
    step,
    count: stripeReady || index < 4 ? funnelCounts[index]! : 0,
    dropOff: index === 0 ? 0 : Math.max(0, funnelCounts[index - 1]! - funnelCounts[index]!),
  }));
  if (!stripeReady) funnel[4] = { step: 'Paid', count: 0, dropOff: 0 };
  const sourceMap = new Map<string, number>();
  for (const row of accounts) sourceMap.set(row.signupSource.utmSource, (sourceMap.get(row.signupSource.utmSource) || 0) + 1);
  const creditsConsumed = Math.round(accounts.reduce((sum, row) => sum + row.freeCreditsUsed, 0) * 100) / 100;
  return {
    billing: stripeReady ? 'connected' : 'Not connected',
    totals: {
      signups: accounts.length,
      signupsThisWeek,
      paying: stripeReady ? payingCount : 'Not connected',
      freeToPaidRate: stripeReady ? (accounts.length ? Math.round((payingCount / accounts.length) * 1000) / 10 : 0) : 'Not connected',
      mrr: stripeReady ? accounts.reduce((sum, row) => sum + (typeof row.monthlyPaid === 'number' ? row.monthlyPaid : 0), 0) : 'Not connected',
      creditsConsumed,
      openRouterCost: 'Not connected',
      reachedThreeTools: reached,
      launched,
      nearCreditEnd: accounts.filter((row) => row.nearCreditEnd).length,
      atRisk: accounts.filter((row) => row.atRisk).length,
    },
    funnel,
    sources: [...sourceMap.entries()].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count),
    accounts,
  };
}
