/**
 * Marketing report for a home-services owner.
 *
 * Layout follows the sections those agency templates use (overview, paid
 * ads, calls, a written summary) without their branding or wording.
 * Every number comes from the inputs. A preview connector cannot turn
 * sample rows into real results.
 */
import type { BudgetExpectation } from '../agents/budgetexpect.js';
import type { AdsPerformanceRow } from '../connectors/gadsread.js';
import type { CrmEvent } from '../metrics/crmledger.js';
import type { ResponderLog } from '../agents/speed_to_lead.js';

export type ReportRangeId = '7' | '30' | '90' | 'mtd' | 'last_month';

export interface ReportWindow {
  id: ReportRangeId;
  label: string;
  start: string;
  end: string;
  previousStart: string;
  previousEnd: string;
  days: number;
  googleRange: string;
  metaPreset: string;
}

export interface ReportKpi {
  label: string;
  value: string;
  compare: string;
}

export interface ReportTableRow {
  name: string;
  extra?: string;
  spend: string;
  impressions: string;
  clicks: string;
  ctr: string;
  cpc: string;
  conversions: string;
  conversionRate: string;
  costPerConversion: string;
}

export interface ReportChannel {
  title: string;
  connected: boolean;
  note: string;
  tiles: ReportKpi[];
  trend: { date: string; spend: number; clicks: number; impressions: number }[];
  campaigns: ReportTableRow[];
  groups: ReportTableRow[];
  groupLabel: string;
  keywords: ReportTableRow[];
  terms: ReportTableRow[];
  termLabel: string;
  footnote: string;
}

export interface MarketingReport {
  window: ReportWindow;
  business: string;
  sample: boolean;
  overview: {
    tiles: ReportKpi[];
    projection: string;
    revenue: string;
  };
  google: ReportChannel;
  meta: ReportChannel;
  leads: {
    note: string;
    tiles: ReportKpi[];
    byType: { label: string; count: number }[];
    bySource: { label: string; count: number }[];
    sourceNote: string;
    speedNote: string;
    callNote: string;
  };
  summary: { happened: string; next: string };
  shareNote: string;
}

export interface ChannelRead {
  connected: boolean;
  note: string;
  rows: AdsPerformanceRow[];
  previousRows: AdsPerformanceRow[];
  /** False when the earlier window did not come back, so a zero is not shown as real. */
  previousKnown: boolean;
}

export interface MarketingReportInput {
  now?: Date;
  range: ReportRangeId;
  business: string;
  trade: string;
  sample: boolean;
  expectation: BudgetExpectation | null;
  ticket: number | null;
  ticketSource: string;
  events: CrmEvent[];
  replies: ResponderLog[];
  speedOn: boolean;
  google: ChannelRead;
  meta: ChannelRead;
}

const RANGES: ReportRangeId[] = ['7', '30', '90', 'mtd', 'last_month'];

export function reportRangeId(value: unknown): ReportRangeId {
  return RANGES.includes(value as ReportRangeId) ? value as ReportRangeId : '30';
}

function utcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysBetween(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

export function reportWindow(id: ReportRangeId, now = new Date()): ReportWindow {
  const today = utcDay(now);
  let start = today;
  let end = today;
  let label = 'Last 30 days';
  let googleRange = 'LAST_30_DAYS';
  let metaPreset = 'last_30d';
  if (id === '7') {
    start = addDays(today, -6);
    label = 'Last 7 days';
    googleRange = 'LAST_7_DAYS';
    metaPreset = 'last_7d';
  } else if (id === '90') {
    start = addDays(today, -89);
    label = 'Last 90 days';
    googleRange = 'LAST_90_DAYS';
    metaPreset = 'last_90d';
  } else if (id === 'mtd') {
    start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    label = 'Month to date';
    googleRange = 'THIS_MONTH';
    metaPreset = 'this_month';
  } else if (id === 'last_month') {
    const firstThis = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    end = addDays(firstThis, -1);
    start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
    label = 'Last month';
    googleRange = 'LAST_MONTH';
    metaPreset = 'last_month';
  } else {
    start = addDays(today, -29);
  }
  const days = daysBetween(start, end);
  const previousEnd = addDays(start, -1);
  const previousStart = addDays(previousEnd, -(days - 1));
  return {
    id, label, start: iso(start), end: iso(end),
    previousStart: iso(previousStart), previousEnd: iso(previousEnd),
    days, googleRange, metaPreset,
  };
}

function plain(text: string): string {
  return text
    .replace(/[ \t]*\u2014[ \t]*/g, ', ')
    .replace(/\u2013/g, '-')
    .replace(/searchlight/ig, 'industry benchmarks')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function money(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  const digits = Number.isInteger(rounded) ? 0 : 2;
  return rounded.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function count(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

function pct(part: number, whole: number): string {
  if (!(whole > 0)) return 'n/a';
  return `${Math.round((part / whole) * 1000) / 10}%`;
}

function compare(current: number, previous: number | null): string {
  if (previous == null) return 'No earlier period to compare.';
  if (previous === 0 && current === 0) return 'Same as the previous period.';
  if (previous === 0) return 'The previous period was 0.';
  const change = Math.round(((current - previous) / previous) * 100);
  if (change === 0) return 'Same as the previous period.';
  return `${change > 0 ? 'Up' : 'Down'} ${Math.abs(change)}% from the previous period.`;
}

function inWindow(ts: string, start: string, end: string): boolean {
  const day = ts.slice(0, 10);
  return day >= start && day <= end;
}

function sum(rows: AdsPerformanceRow[], pick: (row: AdsPerformanceRow) => number): number {
  return rows.reduce((total, row) => total + pick(row), 0);
}

function campaignRows(rows: AdsPerformanceRow[]): AdsPerformanceRow[] {
  return rows.filter((row) => row.level === 'campaign');
}

function totals(rows: AdsPerformanceRow[]) {
  const source = campaignRows(rows);
  const used = source.length ? source : rows.filter((row) => row.level !== 'keyword' && row.level !== 'search_term');
  return {
    spend: Math.round(sum(used, (row) => row.spend) * 100) / 100,
    clicks: sum(used, (row) => row.clicks),
    impressions: sum(used, (row) => row.impressions),
    conversions: sum(used, (row) => row.conversions),
    reach: used.some((row) => row.reach != null) ? sum(used, (row) => row.reach || 0) : null,
  };
}

function rollup(rows: AdsPerformanceRow[], nameOf: (row: AdsPerformanceRow) => string, extraOf?: (row: AdsPerformanceRow) => string): ReportTableRow[] {
  const buckets = new Map<string, AdsPerformanceRow>();
  for (const row of rows) {
    const name = nameOf(row).trim();
    if (!name) continue;
    const key = `${extraOf ? extraOf(row) : ''}|${name}`;
    const prev = buckets.get(key);
    if (!prev) buckets.set(key, { ...row, campaign: name });
    else {
      prev.spend += row.spend;
      prev.clicks += row.clicks;
      prev.impressions += row.impressions;
      prev.conversions += row.conversions;
    }
  }
  return [...buckets.values()]
    .sort((a, b) => b.spend - a.spend || b.clicks - a.clicks)
    .slice(0, 25)
    .map((row) => ({
      name: nameOf(row) || row.campaign,
      extra: extraOf ? extraOf(row) : undefined,
      spend: money(row.spend),
      impressions: count(row.impressions),
      clicks: count(row.clicks),
      ctr: pct(row.clicks, row.impressions),
      cpc: row.clicks > 0 ? money(row.spend / row.clicks) : 'n/a',
      conversions: count(row.conversions),
      conversionRate: pct(row.conversions, row.clicks),
      costPerConversion: row.conversions > 0 ? money(row.spend / row.conversions) : 'n/a',
    }));
}

function trend(rows: AdsPerformanceRow[]): MarketingReport['google']['trend'] {
  const byDate = new Map<string, { spend: number; clicks: number; impressions: number }>();
  for (const row of campaignRows(rows)) {
    if (!row.date) continue;
    const prev = byDate.get(row.date) || { spend: 0, clicks: 0, impressions: 0 };
    prev.spend += row.spend;
    prev.clicks += row.clicks;
    prev.impressions += row.impressions;
    byDate.set(row.date, prev);
  }
  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, row]) => ({ date, spend: Math.round(row.spend * 100) / 100, clicks: row.clicks, impressions: row.impressions }));
}

function channel(title: string, read: ChannelRead, sample: boolean, kind: 'google' | 'meta'): ReportChannel {
  if (sample) {
    return {
      title, connected: false, tiles: [], trend: [], campaigns: [], groups: [], keywords: [], terms: [],
      groupLabel: kind === 'google' ? 'Ad groups' : 'Ad sets',
      termLabel: 'Search terms',
      footnote: '',
      note: 'This is a preview. Ad numbers are not shown, because this is not your live ad account.',
    };
  }
  if (!read.connected) {
    return {
      title, connected: false, tiles: [], trend: [], campaigns: [], groups: [], keywords: [], terms: [],
      groupLabel: kind === 'google' ? 'Ad groups' : 'Ad sets',
      termLabel: 'Search terms',
      footnote: '',
      note: read.note,
    };
  }
  const now = totals(read.rows);
  const before = read.previousKnown ? totals(read.previousRows) : null;
  const tiles: ReportKpi[] = [
    { label: 'Spend', value: money(now.spend), compare: compare(now.spend, before ? before.spend : null) },
    { label: 'Impressions', value: count(now.impressions), compare: compare(now.impressions, before ? before.impressions : null) },
    { label: 'Clicks', value: count(now.clicks), compare: compare(now.clicks, before ? before.clicks : null) },
    { label: 'CTR', value: pct(now.clicks, now.impressions), compare: 'Clicks divided by impressions.' },
    { label: 'CPC', value: now.clicks > 0 ? money(now.spend / now.clicks) : 'n/a', compare: 'Spend divided by clicks.' },
    { label: 'Conversions', value: count(now.conversions), compare: compare(now.conversions, before ? before.conversions : null) },
    { label: 'Conversion rate', value: pct(now.conversions, now.clicks), compare: 'Conversions divided by clicks.' },
  ];
  if (kind === 'meta' && now.reach != null) {
    tiles.push({ label: 'Reach', value: count(now.reach), compare: 'Unique people Meta reported. This is not impressions.' });
  }
  const groups = rollup(read.rows.filter((row) => row.level === 'ad_group'), (row) => row.adGroup || '', (row) => row.campaign);
  const terms = kind === 'google'
    ? rollup(read.rows.filter((row) => row.level === 'search_term'), (row) => row.searchTerm || '', (row) => row.campaign)
    : [];
  const keywords = kind === 'google'
    ? rollup(read.rows.filter((row) => row.level === 'keyword'), (row) => row.keyword || '', (row) => row.adGroup || row.campaign)
    : [];
  const emptyBits: string[] = [];
  if (!read.rows.some((row) => row.level === 'ad_group')) emptyBits.push(kind === 'google' ? 'no ad group rows' : 'no ad set rows');
  if (kind === 'google' && !read.rows.some((row) => row.level === 'keyword')) emptyBits.push('no keyword rows');
  if (kind === 'google' && !read.rows.some((row) => row.level === 'search_term')) emptyBits.push('no search term rows');
  const note = emptyBits.length
    ? `${read.note} Missing for this period: ${emptyBits.join(', ')}. Those tables stay empty instead of using a sample.`
    : read.note;
  return {
    title,
    connected: true,
    note: plain(note),
    tiles,
    trend: trend(read.rows),
    campaigns: rollup(campaignRows(read.rows), (row) => row.campaign),
    groups,
    groupLabel: kind === 'google' ? 'Ad groups' : 'Ad sets',
    keywords,
    terms,
    termLabel: 'Search terms',
    footnote: kind === 'google'
      ? 'Conversions are Google\'s count. Miles does not treat them as leads.'
      : 'Conversions are Meta lead actions. Clicks are not counted as leads. Reach is shown only when Meta sends it.',
  };
}

function countEvents(events: CrmEvent[], type: CrmEvent['type'], start: string, end: string): number {
  return events.filter((event) => event.type === type && inWindow(event.ts, start, end)).length;
}

export function buildMarketingReport(input: MarketingReportInput): MarketingReport {
  const window = reportWindow(input.range, input.now || new Date());
  const google = channel('Google Ads', input.sample ? { ...input.google, connected: false, rows: [], previousRows: [] } : input.google, input.sample, 'google');
  const meta = channel('Facebook and Instagram', input.sample ? { ...input.meta, connected: false, rows: [], previousRows: [] } : input.meta, input.sample, 'meta');
  const events = input.events || [];
  const hasLedger = events.length > 0;
  const leadsNow = countEvents(events, 'lead', window.start, window.end) + countEvents(events, 'missed_call', window.start, window.end);
  const leadsPrev = hasLedger ? countEvents(events, 'lead', window.previousStart, window.previousEnd) + countEvents(events, 'missed_call', window.previousStart, window.previousEnd) : null;
  const missedNow = countEvents(events, 'missed_call', window.start, window.end);
  const missedPrev = hasLedger ? countEvents(events, 'missed_call', window.previousStart, window.previousEnd) : null;
  const wonNow = countEvents(events, 'closed_won', window.start, window.end);
  const wonPrev = hasLedger ? countEvents(events, 'closed_won', window.previousStart, window.previousEnd) : null;
  const revenueNow = events.filter((event) => event.type === 'closed_won' && inWindow(event.ts, window.start, window.end)).reduce((total, event) => total + (event.amount || 0), 0);
  const adsConnected = google.connected || meta.connected;
  const adSpend = (google.connected ? totals(input.google.rows).spend : 0) + (meta.connected ? totals(input.meta.rows).spend : 0);
  const spendPrevKnown = adsConnected && (!google.connected || input.google.previousKnown) && (!meta.connected || input.meta.previousKnown);
  const adSpendPrev = spendPrevKnown
    ? (input.google.previousKnown ? totals(input.google.previousRows).spend : 0) + (input.meta.previousKnown ? totals(input.meta.previousRows).spend : 0)
    : null;
  const tiles: ReportKpi[] = [];
  if (adsConnected) tiles.push({ label: 'Spend', value: money(adSpend), compare: compare(adSpend, adSpendPrev) });
  else tiles.push({ label: 'Spend', value: 'Not connected', compare: 'Connect Google Ads or a Facebook ad account to see spend.' });
  if (hasLedger) tiles.push({ label: 'Leads', value: count(leadsNow), compare: compare(leadsNow, leadsPrev) });
  else tiles.push({ label: 'Leads', value: 'No lead tracking yet', compare: 'Leads are counted from your CRM ledger, not from ad conversions.' });
  if (adsConnected && hasLedger && leadsNow > 0) tiles.push({ label: 'Cost per lead', value: money(adSpend / leadsNow), compare: 'Spend divided by tracked leads. Ad conversions are not used.' });
  else tiles.push({ label: 'Cost per lead', value: 'n/a', compare: 'Needs connected ad spend and at least one tracked lead in this period.' });
  const factor = window.days / 30;
  let projection = 'No budget projection is saved yet. Save one on the campaign plan before this can compare booked jobs with the plan.';
  let projectedJobsLow: number | null = null;
  let projectedJobsHigh: number | null = null;
  if (input.expectation) {
    projectedJobsLow = Math.round(input.expectation.range.jobs.low * factor * 10) / 10;
    projectedJobsHigh = Math.round(input.expectation.range.jobs.high * factor * 10) / 10;
    const actual = hasLedger ? `${wonNow} won job${wonNow === 1 ? '' : 's'} in this period` : 'no won jobs are tracked yet';
    projection = `Your saved projection is for a month. Scaled to these ${window.days} days, that is about ${projectedJobsLow} to ${projectedJobsHigh} booked jobs. This period shows ${actual}. Won jobs are the closest tracked stand-in for a booked job.`;
  }
  tiles.push({
    label: 'Booked jobs',
    value: hasLedger ? count(wonNow) : 'n/a',
    compare: input.expectation
      ? `Projected ${projectedJobsLow} to ${projectedJobsHigh} for this period.`
      : hasLedger
        ? compare(wonNow, wonPrev)
        : 'Won jobs show up after your CRM records them.',
  });
  const ticketBit = input.ticket != null ? `${input.ticketSource} of ${money(input.ticket)}` : 'no job value is saved';
  let revenue = `No revenue estimate yet, because ${ticketBit === 'no job value is saved' ? 'no job value is saved' : 'there is no saved projection'}.`;
  if (input.expectation && input.ticket != null && projectedJobsLow != null && projectedJobsHigh != null) {
    revenue = `Estimated job value for this period is ${money(projectedJobsLow * input.ticket)} to ${money(projectedJobsHigh * input.ticket)}, using ${ticketBit}. This is not money received.`;
  }
  if (hasLedger && revenueNow > 0) revenue += ` Won jobs recorded ${money(revenueNow)} in this period.`;
  else if (hasLedger) revenue += ' No won job in this period included a dollar amount.';
  const replies = (input.replies || []).filter((reply) => inWindow(reply.at, window.start, window.end));
  const timed = replies.filter((reply) => typeof reply.responseSec === 'number');
  const avgSec = timed.length ? Math.round(timed.reduce((total, reply) => total + (reply.responseSec || 0), 0) / timed.length) : null;
  const sources = new Map<string, number>();
  for (const reply of replies) {
    const source = (reply.source || '').trim();
    if (!source) continue;
    sources.set(source, (sources.get(source) || 0) + 1);
  }
  const bySource = [...sources.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
  const leadTiles: ReportKpi[] = hasLedger ? [
    { label: 'Leads', value: count(leadsNow), compare: compare(leadsNow, leadsPrev) },
    { label: 'Missed calls', value: count(missedNow), compare: compare(missedNow, missedPrev) },
    { label: 'Won jobs', value: count(wonNow), compare: compare(wonNow, wonPrev) },
  ] : [];
  const happenedParts: string[] = [];
  if (adsConnected) happenedParts.push(`Ads spent ${money(adSpend)} with ${count((google.connected ? totals(input.google.rows).clicks : 0) + (meta.connected ? totals(input.meta.rows).clicks : 0))} clicks.`);
  else happenedParts.push('No ad account is connected, so this report does not show spend.');
  if (hasLedger) happenedParts.push(`${count(leadsNow)} tracked leads came in, including ${count(missedNow)} missed calls, and ${count(wonNow)} jobs were marked won.`);
  else happenedParts.push('Lead tracking has no events yet.');
  const nextParts: string[] = [];
  if (!google.connected && !input.sample) nextParts.push('Connect Google Ads to see campaigns, ad groups, keywords, and search terms.');
  if (!meta.connected && !input.sample) nextParts.push('Connect a Facebook ad account and a Page to see Facebook and Instagram results.');
  if (input.sample) nextParts.push('This preview cannot read a live ad account.');
  if (!input.speedOn) nextParts.push('Speed to lead is off, so new leads are not getting an instant reply.');
  else if (avgSec != null) nextParts.push(`Speed to lead answered in about ${avgSec < 120 ? `${avgSec} seconds` : `${Math.round(avgSec / 60)} minutes`} on average in this period.`);
  else if (input.speedOn) nextParts.push('Speed to lead is on. No timed reply was saved in this period.');
  nextParts.push('Scheduled email of this report is not set up. Print or save as PDF to share it.');
  const googleNote = input.sample
    ? 'Preview mode. Google Ads numbers are hidden.'
    : input.google.connected ? input.google.note : 'Google Ads is not connected. Connect it under Integrations. Nothing here is a sample.';
  const metaNote = input.sample
    ? 'Preview mode. Facebook and Instagram numbers are hidden.'
    : input.meta.connected ? input.meta.note : (input.meta.note || 'No Facebook ad account is connected. A Page by itself is not an ad account. Nothing here is a sample.');
  return {
    window,
    business: input.business || 'Your business',
    sample: input.sample,
    overview: { tiles, projection: plain(projection), revenue: plain(revenue) },
    google: { ...google, note: plain(google.connected ? google.note : googleNote) },
    meta: { ...meta, note: plain(meta.connected ? meta.note : metaNote) },
    leads: {
      note: hasLedger
        ? 'Leads, missed calls, and won jobs come from your CRM ledger. A missed call counts as a lead that arrived.'
        : 'No leads or calls are saved yet. They show up after GoHighLevel sends them. Ad conversions are not used as leads.',
      tiles: leadTiles,
      byType: hasLedger ? [
        { label: 'New leads', count: countEvents(events, 'lead', window.start, window.end) },
        { label: 'Missed calls', count: missedNow },
        { label: 'Jobs completed', count: countEvents(events, 'job_complete', window.start, window.end) },
        { label: 'Won jobs', count: wonNow },
      ] : [],
      bySource,
      sourceNote: bySource.length
        ? 'Sources are the ones saved on speed-to-lead replies. Lead events themselves do not name a channel.'
        : 'Lead events do not name a channel, and no speed-to-lead reply in this period saved a source.',
      speedNote: !input.speedOn
        ? 'Speed to lead is off.'
        : avgSec == null
          ? 'Speed to lead is on. No reply in this period has a response time.'
          : `Average first reply in this period: ${avgSec < 120 ? `${avgSec} seconds` : `${Math.round(avgSec / 60)} minutes`} across ${timed.length} repl${timed.length === 1 ? 'y' : 'ies'}.`,
      callNote: 'Call length and answered-call totals are not in Miles. Missed calls above are the ones lead tracking saved. There is no separate call tracker.',
    },
    summary: {
      happened: plain(`${window.label}, ${window.start} to ${window.end}. ${happenedParts.join(' ')}`),
      next: plain(nextParts.join(' ')),
    },
    shareNote: 'Print or save as PDF to share this report. Scheduled email is the next step. Miles can send other email when a key is set, but this report is not on a schedule.',
  };
}
