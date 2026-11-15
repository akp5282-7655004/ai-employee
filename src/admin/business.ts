/**
 * Admin business view. Numbers come from stored accounts and, when the
 * caller passes them, live connected apps. Missing billing is "Not connected",
 * never a guessed dollar amount.
 */
import { LAUNCH_GRANT, creditState } from '../billing/credits.js';
import { billingState } from '../billing/subscription.js';

export type AccountStatus = 'free credits' | 'trial' | 'active' | 'past due' | 'canceled' | 'credits exhausted';

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
  serveCost: number | 'Not connected';
  riskReasons: string[];
  paused: boolean;
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
    signupsToday: number;
    signupsThisWeek: number;
    signups30d: number;
    onFreeCredits: number;
    trials: number | 'Not connected';
    paying: number | 'Not connected';
    pastDue: number | 'Not connected';
    canceled: number | 'Not connected';
    revenueThisMonth: number | 'Not connected';
    profit: number | 'Not connected';
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
    atRiskAccounts: { id: string; businessName: string; email: string; reasons: string[] }[];
  sources: { source: string; count: number }[];
  accounts: AdminAccountRow[];
}

const WEEK_MS = 7 * 86_400_000;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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
  const remaining = Math.max(0, Math.round((credits.remaining) * 100) / 100);
  const used = Math.max(0, Math.round(credits.spent * 100) / 100);
  let status: AccountStatus = 'free credits';
  if (billing.status === 'trialing') status = 'trial';
  else if (billing.status === 'past_due') status = 'past due';
  else if (billing.status === 'canceled') status = 'canceled';
  else if (paying) status = 'active';
  else if (remaining <= 0 && used > 0) status = 'credits exhausted';
  const monthlyPaid: number | 'Not connected' = typeof billing.mrr === 'number' ? billing.mrr : (paying ? 'Not connected' : 0);
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
  const snap = (data.snapshot ?? {}) as { campaigns?: { status?: string; spend?: number }[]; adSpend?: number };
  const nearCreditEnd = status === 'free credits' && remaining > 0 && remaining <= 20;
  const leads = Array.isArray(data.crmEvents) ? (data.crmEvents as { type?: string }[]).filter((event) => event.type === 'lead' || event.type === 'missed_call').length : 0;
  const bookedJobs = Array.isArray(data.crmEvents) ? (data.crmEvents as { type?: string }[]).filter((event) => event.type === 'closed_won').length : 0;
  const adSpend = typeof snap.adSpend === 'number' ? snap.adSpend : (snap.campaigns ? snap.campaigns.reduce((sum, row) => sum + (row.spend || 0), 0) : 'Not connected' as const);
  const found = (miles as { found?: { fetchNote?: string } }).found;
  const errors = {
    googleReads: countEvents(data, /could not be read|could not read campaign/i),
    launches: countEvents(data, /nothing was created|create failed/i),
    crawls: /fail|could not/i.test(found?.fetchNote || '') ? 1 : 0,
  };
  const riskReasons: string[] = [];
  if (remaining < 10) riskReasons.push('low credits');
  if (idle) riskReasons.push('no login 7 days');
  if (status === 'past due') riskReasons.push('payment failed');
  if (errors.googleReads + errors.launches + errors.crawls >= 3) riskReasons.push('errors spike');
  if (launched && leads === 0) riskReasons.push('no leads after launch');
  const openRouter = typeof data.openRouterCostUsd === 'number' ? data.openRouterCostUsd : null;
  const revenue = typeof monthlyPaid === 'number' ? monthlyPaid : null;
  const profit = revenue != null && openRouter != null ? Math.round((revenue - openRouter) * 1e6) / 1e6 : 'Not connected';
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
    errors,
    serveCost: openRouter == null ? 'Not connected' : openRouter,
    paused: data.accountPaused === true,
    riskReasons,
    atRisk: riskReasons.length > 0,
    nearCreditEnd,
  };
}

export function buildAdminBusiness(rows: AdminAccountInput[], opts?: { now?: string; stripeReady?: boolean }): AdminBusinessView {
  const nowMs = opts?.now ? Date.parse(opts.now) : Date.now();
  const accounts = rows.map((row) => accountRow({ ...row, now: opts?.now }));
  const dayStart = nowMs - 86_400_000;
  const weekStart = nowMs - WEEK_MS;
  const monthStart = nowMs - 30 * 86_400_000;
  const signed = (since: number) => accounts.filter((row) => Date.parse(row.signupDate) >= since).length;
  const stripeReady = opts?.stripeReady === true;
  const payingCount = accounts.filter((row) => row.status === 'active').length;
  const reached = accounts.filter((row) => typeof row.toolsConnected === 'number' && row.toolsConnected >= 3).length;
  const launched = accounts.filter((row) => row.launched).length;
  const funnelCounts = [accounts.length, reached, launched, stripeReady ? payingCount : 0];
  const steps = ['Signed up', 'Connected 3 tools', 'Launched first campaign', 'Became paying'];
  const funnel = steps.map((step, index) => ({
    step,
    count: stripeReady || index < 3 ? funnelCounts[index]! : 0,
    dropOff: index === 0 ? 0 : Math.max(0, funnelCounts[index - 1]! - funnelCounts[index]!),
  }));
  if (!stripeReady) funnel[3] = { step: 'Became paying', count: 0, dropOff: 0 };
  const sourceMap = new Map<string, number>();
  for (const row of accounts) sourceMap.set(row.signupSource.utmSource, (sourceMap.get(row.signupSource.utmSource) || 0) + 1);
  const creditsConsumed = Math.round(accounts.reduce((sum, row) => sum + row.freeCreditsUsed, 0) * 100) / 100;
  const openRouterKnown = rows.some((row) => typeof row.data.openRouterCostUsd === 'number');
  const openRouterCost = openRouterKnown
    ? Math.round(rows.reduce((sum, row) => sum + (typeof row.data.openRouterCostUsd === 'number' ? row.data.openRouterCostUsd : 0), 0) * 1e6) / 1e6
    : 'Not connected' as const;
  const mrrNumbers = accounts.filter((row) => row.status === 'active' && typeof row.monthlyPaid === 'number').map((row) => row.monthlyPaid as number);
  const activeMissingMrr = accounts.some((row) => row.status === 'active' && row.monthlyPaid === 'Not connected');
  const mrr = !stripeReady || activeMissingMrr ? 'Not connected' as const : Math.round(mrrNumbers.reduce((sum, n) => sum + n, 0) * 100) / 100;
  const nowDate = new Date(nowMs);
  const revenueNumbers: number[] = [];
  let revenueKnown = false;
  for (const row of rows) {
    const billing = (row.data.billing ?? {}) as { lastPayment?: { amount?: number; at?: string } };
    const pay = billing.lastPayment;
    if (typeof pay?.amount === 'number' && typeof pay.at === 'string') {
      revenueKnown = true;
      const at = new Date(pay.at);
      if (at.getUTCFullYear() === nowDate.getUTCFullYear() && at.getUTCMonth() === nowDate.getUTCMonth()) revenueNumbers.push(pay.amount);
    }
  }
  const revenueThisMonth = !stripeReady || !revenueKnown ? 'Not connected' as const : Math.round(revenueNumbers.reduce((sum, n) => sum + n, 0) * 100) / 100;
  const profit = typeof revenueThisMonth === 'number' && typeof openRouterCost === 'number'
    ? Math.round((revenueThisMonth - openRouterCost) * 100) / 100
    : 'Not connected' as const;
  return {
    billing: stripeReady ? 'connected' : 'Not connected',
    totals: {
      signups: accounts.length,
      signupsToday: signed(dayStart),
      signupsThisWeek: signed(weekStart),
      signups30d: signed(monthStart),
      onFreeCredits: accounts.filter((row) => row.status === 'free credits').length,
      trials: stripeReady ? accounts.filter((row) => row.status === 'trial').length : 'Not connected',
      paying: stripeReady ? payingCount : 'Not connected',
      pastDue: stripeReady ? accounts.filter((row) => row.status === 'past due').length : 'Not connected',
      canceled: stripeReady ? accounts.filter((row) => row.status === 'canceled').length : 'Not connected',
      freeToPaidRate: stripeReady ? (accounts.length ? Math.round((payingCount / accounts.length) * 1000) / 10 : 0) : 'Not connected',
      mrr,
      revenueThisMonth,
      creditsConsumed,
      openRouterCost,
      profit,
      reachedThreeTools: reached,
      launched,
      nearCreditEnd: accounts.filter((row) => row.nearCreditEnd).length,
      atRisk: accounts.filter((row) => row.atRisk).length,
    },
    funnel,
    atRiskAccounts: accounts.filter((row) => row.atRisk).map((row) => ({ id: row.id, businessName: row.businessName, email: row.email, reasons: row.riskReasons })),
    sources: [...sourceMap.entries()].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count),
    accounts,
  };
}
