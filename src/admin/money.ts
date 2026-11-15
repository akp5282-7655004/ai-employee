/**
 * Owner money math. Every dollar comes from a stored payment, a stored
 * serve-cost line, or the monthly other-cost setting. Missing sources stay
 * missing. Nothing here invents a Stripe charge or an AI bill.
 */

export type MoneyPeriod = 'month' | '30' | 'all';

export interface DatedAmount {
  at: string;
  usd: number;
  id?: string;
}

export interface AccountMoneyInput {
  payments: DatedAmount[];
  refunds: DatedAmount[];
  /** Dated OpenRouter serve cost. */
  textCosts: DatedAmount[];
  /** Dated media vendor cost. */
  mediaCosts: DatedAmount[];
  /** Lifetime OpenRouter total when no dated text lines exist. */
  lifetimeTextUsd?: number | null;
  stripeReady: boolean;
  period: MoneyPeriod;
  now: string;
  otherMonthlyUsd: number;
}

export type MoneyNumber = number | 'Not connected' | 'no data';

export interface AccountMoney {
  revenue: number | 'Not connected';
  text: number | 'no data';
  media: number | 'no data';
  other: number;
  /** Months of other cost included. 1 for this month and last 30 days. */
  otherMonths: number;
  cost: number | 'no data';
  profit: number | 'Not connected' | 'no data';
  /** Percent, or '-' when revenue is 0 or unknown. */
  margin: number | '-';
}

const DAY = 86_400_000;

export function inPeriod(at: string, period: MoneyPeriod, now: string): boolean {
  const ts = Date.parse(at);
  const end = Date.parse(now);
  if (!Number.isFinite(ts) || !Number.isFinite(end)) return false;
  if (period === 'all') return ts <= end;
  if (period === '30') return ts <= end && end - ts <= 30 * DAY;
  const cursor = new Date(end);
  const start = Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1);
  return ts >= start && ts <= end;
}

function sum(rows: DatedAmount[], period: MoneyPeriod, now: string): number {
  return Math.round(rows.filter((row) => inPeriod(row.at, period, now)).reduce((total, row) => total + (row.usd || 0), 0) * 100) / 100;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function accountMoney(input: AccountMoneyInput): AccountMoney {
  const hasPayments = input.payments.length > 0 || input.refunds.length > 0;
  let revenue: number | 'Not connected';
  if (!input.stripeReady && !hasPayments) revenue = 'Not connected';
  else revenue = round2(sum(input.payments, input.period, input.now) - sum(input.refunds, input.period, input.now));

  const datedText = input.textCosts.length > 0;
  let text: number | 'no data';
  if (datedText) text = sum(input.textCosts, input.period, input.now);
  else if (input.period === 'all' && typeof input.lifetimeTextUsd === 'number') text = round2(input.lifetimeTextUsd);
  else text = 'no data';

  const media: number | 'no data' = input.mediaCosts.length > 0 ? sum(input.mediaCosts, input.period, input.now) : 'no data';

  const otherMonthly = Number.isFinite(input.otherMonthlyUsd) && input.otherMonthlyUsd > 0 ? input.otherMonthlyUsd : 0;
  const otherMonths = input.period === 'all' ? monthsSpanned(input.now, input.payments, input.textCosts, input.mediaCosts) : 1;
  const other = round2(otherMonthly * otherMonths);

  const parts = [text, media].filter((part): part is number => typeof part === 'number');
  const cost: number | 'no data' = parts.length === 0 && other === 0 ? 'no data' : round2(parts.reduce((total, part) => total + part, 0) + other);

  let profit: AccountMoney['profit'];
  if (revenue === 'Not connected' || cost === 'no data') profit = revenue === 'Not connected' ? 'Not connected' : 'no data';
  else profit = round2(revenue - cost);

  const margin: number | '-' = typeof revenue === 'number' && revenue > 0 && typeof profit === 'number'
    ? round2((profit / revenue) * 100)
    : '-';

  return { revenue, text, media, other, otherMonths, cost, profit, margin };
}

function monthsSpanned(now: string, ...groups: DatedAmount[][]): number {
  const stamps = groups.flat().map((row) => Date.parse(row.at)).filter((ts) => Number.isFinite(ts));
  const end = Date.parse(now);
  if (!stamps.length || !Number.isFinite(end)) return 1;
  const start = new Date(Math.min(...stamps));
  const finish = new Date(end);
  return Math.max(1, (finish.getUTCFullYear() - start.getUTCFullYear()) * 12 + (finish.getUTCMonth() - start.getUTCMonth()) + 1);
}

export interface RenewalInput {
  id: string;
  businessName: string;
  email: string;
  plan?: string;
  status?: string;
  renewsAt?: string;
  amount?: number;
  cancelAtPeriodEnd?: boolean;
}

export interface RenewalRow {
  id: string;
  businessName: string;
  email: string;
  plan: string;
  renewsAt: string;
  days: number;
  daysLabel: string;
  amount: number | 'Not connected';
  state: 'renews' | 'cancels' | 'past_due';
}

const PAID = new Set(['starter', 'growth', 'scale']);

export function upcomingRenewals(rows: RenewalInput[], now: string, stripeReady: boolean): RenewalRow[] | 'Connect Stripe to see renewals' {
  if (!stripeReady) return 'Connect Stripe to see renewals';
  const end = Date.parse(now);
  return rows
    .filter((row) => PAID.has(String(row.plan || '')) && row.renewsAt && (row.status === 'active' || row.status === 'trialing' || row.status === 'past_due'))
    .map((row) => {
      const renewsAt = row.renewsAt as string;
      const days = Number.isFinite(end) ? Math.ceil((Date.parse(renewsAt) - end) / DAY) : 0;
      const state: RenewalRow['state'] = row.status === 'past_due' ? 'past_due' : row.cancelAtPeriodEnd ? 'cancels' : 'renews';
      const amount: number | 'Not connected' = typeof row.amount === 'number' ? row.amount : 'Not connected';
      const item: RenewalRow = {
        id: row.id,
        businessName: row.businessName,
        email: row.email,
        plan: String(row.plan),
        renewsAt,
        days,
        daysLabel: daysLabel(days),
        amount,
        state,
      };
      return item;
    })
    .sort((a, b) => Date.parse(a.renewsAt) - Date.parse(b.renewsAt));
}

/** Company totals. Other cost is added once, not once per account. */
export function rollMoney(rows: AccountMoney[], otherMonthlyUsd: number, otherMonths: number): AccountMoney {
  const revenueValues = rows.map((row) => row.revenue).filter((value): value is number => typeof value === 'number');
  const revenue: AccountMoney['revenue'] = revenueValues.length === 0 && rows.every((row) => row.revenue === 'Not connected')
    ? 'Not connected'
    : round2(revenueValues.reduce((total, value) => total + value, 0));
  const textValues = rows.map((row) => row.text).filter((value): value is number => typeof value === 'number');
  const text: AccountMoney['text'] = textValues.length ? round2(textValues.reduce((total, value) => total + value, 0)) : 'no data';
  const mediaValues = rows.map((row) => row.media).filter((value): value is number => typeof value === 'number');
  const media: AccountMoney['media'] = mediaValues.length ? round2(mediaValues.reduce((total, value) => total + value, 0)) : 'no data';
  const other = round2(Math.max(0, otherMonthlyUsd) * Math.max(1, otherMonths));
  const parts = [text, media].filter((part): part is number => typeof part === 'number');
  const cost: AccountMoney['cost'] = parts.length === 0 && other === 0 ? 'no data' : round2(parts.reduce((total, part) => total + part, 0) + other);
  const profit: AccountMoney['profit'] = revenue === 'Not connected' ? 'Not connected' : cost === 'no data' ? 'no data' : round2(revenue - cost);
  const margin: AccountMoney['margin'] = typeof revenue === 'number' && revenue > 0 && typeof profit === 'number' ? round2((profit / revenue) * 100) : '-';
  return { revenue, text, media, other, otherMonths: Math.max(1, otherMonths), cost, profit, margin };
}

export function daysLabel(days: number): string {
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  if (days === 1) return 'in 1 day';
  return `in ${days} days`;
}
