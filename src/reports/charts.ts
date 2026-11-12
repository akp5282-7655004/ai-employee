/**
 * Chart series for the marketing report.
 *
 * A widget is either entirely real or entirely sample. Real rows and sample
 * points are never added together. Sample numbers are not stored on the
 * budget projection, the goal check, or the Am I on track readout.
 *
 * Sample shape, deterministic for a trade, a daily budget, and a date window:
 * - Daily budget is the owner's saved cap, or $20 when none is saved (the
 *   same default cap the product uses).
 * - Cost per lead is the typical figure from the same band the goal check
 *   uses. The book rate is that trade's published rate, or the non-brand
 *   study rate when the trade has none.
 * - Each day is heavier on weekdays than weekends, then nudged with seeded
 *   noise (not a sine wave). Integer dollars, clicks, leads, and impressions
 *   are dealt out so the days add up to the period totals exactly.
 * - Clicks use a whole-dollar cost per click near 8% of the cost per lead.
 * - Impressions are chosen so click-through rate is clicks divided by
 *   impressions. Reach is 72% of impressions, rounded.
 * - Leads are the period spend divided by the band's typical cost per lead,
 *   rounded. The cost per lead shown on a tile is that spend divided by
 *   those leads, so the tile matches the series.
 * - Google receives 70% of each total and Facebook the rest, split as whole
 *   numbers. Overview spend is the sum of those two. The split is not the
 *   owner's saved channel mix.
 * - Device mix is always a sample (mobile 68, desktop 24, tablet 8) because
 *   the ad read does not include device.
 * - Answered calls are not tracked, so the missed-versus-answered chart is
 *   always a sample. The missed-call tile stays real when the ledger has events.
 */
import { cplBandForGoal, googleAdsEnds } from '../agents/goalcheck.js';
import { tradeBookRate } from '../agents/budgetexpect.js';
import { DEFAULT_CAPS } from '../agents/policy.js';
import type { AdsPerformanceRow } from '../connectors/gadsread.js';
import type { CrmEvent } from '../metrics/crmledger.js';

export interface ChartWidget {
  kind: 'line' | 'bar' | 'donut' | 'funnel' | 'gauge';
  title: string;
  sample: boolean;
  note: string;
  unit: 'money' | 'count' | 'rate';
  /** Grid columns out of 6. Mixed sizes, not one chart per row. */
  span: 2 | 3 | 4 | 6;
  /** Tile value when summing the points would be wrong (rates and cost per lead). */
  headline?: string;
  points: { label: string; value: number | null }[];
  /** Gauge only. 0 to 1. */
  pace?: number;
  caption?: string;
}

export interface SampleDay {
  date: string;
  spend: number;
  clicks: number;
  impressions: number;
  leads: number;
  reach: number;
  jobs: number;
  ctr: number;
}

export interface SamplePlan {
  daily: number;
  /** Period spend divided by period leads. */
  cpl: number;
  bookRatePct: number;
  days: SampleDay[];
  google: SampleDay[];
  meta: SampleDay[];
  totalSpend: number;
  totalClicks: number;
  totalImpressions: number;
  totalLeads: number;
  totalJobs: number;
  totalReach: number;
  googleSpend: number;
  metaSpend: number;
  googleClicks: number;
  metaClicks: number;
  googleLeads: number;
  metaLeads: number;
  googleImpressions: number;
  metaImpressions: number;
  missed: number;
  answered: number;
}

export interface ReportCharts {
  banner: string | null;
  overview: ChartWidget[];
  google: ChartWidget[];
  meta: ChartWidget[];
  leads: ChartWidget[];
}

const SAMPLE_NOTE = 'Sample data. Not your account.';
const GOOGLE_SHARE = 0.7;

function datesOf(start: string, end: string): string[] {
  const out: string[] = [];
  const cursor = new Date(`${start}T00:00:00.000Z`);
  const last = new Date(`${end}T00:00:00.000Z`);
  while (cursor.getTime() <= last.getTime()) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out.length ? out : [start];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function hashSeed(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Largest-remainder split so the integers add up to `total`. */
export function allocateInt(total: number, weights: number[]): number[] {
  if (!weights.length) return [];
  const safe = weights.map((weight) => (weight > 0 ? weight : 0.0001));
  const sum = safe.reduce((acc, weight) => acc + weight, 0);
  const exact = safe.map((weight) => (total * weight) / sum);
  const base = exact.map((value) => Math.floor(value));
  let remain = total - base.reduce((acc, value) => acc + value, 0);
  const order = exact.map((value, index) => ({ index, frac: value - base[index]! })).sort((a, b) => b.frac - a.frac || a.index - b.index);
  let cursor = 0;
  while (remain > 0) {
    base[order[cursor % order.length]!.index]! += 1;
    remain -= 1;
    cursor += 1;
  }
  return base;
}

function dayWeights(dates: string[], rand: () => number): number[] {
  return dates.map((date) => {
    const dow = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    const weekend = dow === 0 || dow === 6;
    return (weekend ? 0.62 : 1.12) * (0.78 + rand() * 0.44);
  });
}

function splitPair(total: number): [number, number] {
  const google = Math.round(total * GOOGLE_SHARE);
  return [google, total - google];
}

function buildChannelDays(dates: string[], totals: { spend: number; clicks: number; impressions: number; leads: number; reach: number; jobs: number }, rand: () => number): SampleDay[] {
  const weights = dayWeights(dates, rand);
  const spend = allocateInt(totals.spend, weights);
  const clicks = allocateInt(totals.clicks, weights);
  const extraImpressions = Math.max(0, totals.impressions - totals.clicks);
  const extras = allocateInt(extraImpressions, dayWeights(dates, rand));
  const leads = allocateInt(totals.leads, dayWeights(dates, rand));
  const reach = allocateInt(totals.reach, dayWeights(dates, rand));
  const jobs = allocateInt(totals.jobs, weights);
  return dates.map((date, index) => {
    const click = clicks[index]!;
    const impression = click + extras[index]!;
    return {
      date,
      spend: spend[index]!,
      clicks: click,
      impressions: impression,
      leads: leads[index]!,
      reach: reach[index]!,
      jobs: jobs[index]!,
      ctr: impression > 0 ? click / impression : 0,
    };
  });
}

/** Documented sample series. Overview days are Google plus Facebook, exactly. */
export function samplePlan(args: { trade: string; dailyBudget: number | null; start: string; end: string }): SamplePlan {
  const band = cplBandForGoal(args.trade || '', 'google_ads');
  const bandCpl = band && band.typical > 0 ? band.typical : 149;
  const namedBook = band ? tradeBookRate(band.label) : null;
  const fallbackBook = googleAdsEnds()?.nonBrand.bookRatePct ?? 37.6;
  const bookRatePct = namedBook ?? fallbackBook;
  const daily = Math.round(args.dailyBudget && args.dailyBudget > 0 ? args.dailyBudget : DEFAULT_CAPS.dailyBudget);
  const dates = datesOf(args.start, args.end);
  const totalSpend = daily * dates.length;
  const totalLeads = Math.max(1, Math.round(totalSpend / bandCpl));
  const cpl = totalSpend / totalLeads;
  const cpc = Math.max(1, Math.round(bandCpl * 0.08));
  const totalClicks = Math.max(totalLeads, Math.round(totalSpend / cpc));
  const rand = mulberry32(hashSeed(`${args.trade}|${args.start}|${args.end}|${daily}`));
  const ctrTarget = 0.032 + rand() * 0.02;
  const totalImpressions = Math.max(totalClicks, Math.round(totalClicks / ctrTarget));
  const totalReach = Math.round(totalImpressions * 0.72);
  const totalJobs = Math.max(0, Math.round(totalLeads * (bookRatePct / 100)));
  const [googleSpend, metaSpend] = splitPair(totalSpend);
  const [googleClicks, metaClicks] = splitPair(totalClicks);
  const [googleExtra, metaExtra] = splitPair(Math.max(0, totalImpressions - totalClicks));
  const googleImpressions = googleClicks + googleExtra;
  const metaImpressions = metaClicks + metaExtra;
  const [googleLeads, metaLeads] = splitPair(totalLeads);
  const [googleReach, metaReach] = splitPair(totalReach);
  const [googleJobs, metaJobs] = splitPair(totalJobs);
  const google = buildChannelDays(dates, { spend: googleSpend, clicks: googleClicks, impressions: googleImpressions, leads: googleLeads, reach: googleReach, jobs: googleJobs }, rand);
  const meta = buildChannelDays(dates, { spend: metaSpend, clicks: metaClicks, impressions: metaImpressions, leads: metaLeads, reach: metaReach, jobs: metaJobs }, rand);
  const days = dates.map((date, index) => {
    const left = google[index]!;
    const right = meta[index]!;
    const clicks = left.clicks + right.clicks;
    const impressions = left.impressions + right.impressions;
    return {
      date,
      spend: left.spend + right.spend,
      clicks,
      impressions,
      leads: left.leads + right.leads,
      reach: left.reach + right.reach,
      jobs: left.jobs + right.jobs,
      ctr: impressions > 0 ? clicks / impressions : 0,
    };
  });
  const missed = Math.min(totalLeads, Math.max(totalLeads > 1 ? 1 : 0, Math.round(totalLeads * 0.22)));
  return {
    daily, cpl, bookRatePct, days, google, meta,
    totalSpend, totalClicks, totalImpressions, totalLeads, totalJobs, totalReach,
    googleSpend, metaSpend, googleClicks, metaClicks, googleLeads, metaLeads, googleImpressions, metaImpressions,
    missed, answered: totalLeads - missed,
  };
}

function line(title: string, sample: boolean, note: string, unit: ChartWidget['unit'], points: { label: string; value: number | null }[], span: ChartWidget['span'] = 3, headline?: string): ChartWidget {
  return { kind: 'line', title, sample, note: sample ? `${SAMPLE_NOTE} ${note}` : note, unit, span, headline, points };
}

function bar(title: string, sample: boolean, note: string, unit: ChartWidget['unit'], points: { label: string; value: number }[], span: ChartWidget['span'] = 3): ChartWidget {
  return { kind: 'bar', title, sample, note: sample ? `${SAMPLE_NOTE} ${note}` : note, unit, span, points };
}

function donut(title: string, sample: boolean, note: string, points: { label: string; value: number }[], span: ChartWidget['span'] = 2): ChartWidget {
  return { kind: 'donut', title, sample, note: sample ? `${SAMPLE_NOTE} ${note}` : note, unit: 'count', span, points };
}

function moneyText(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  const digits = Number.isInteger(rounded) ? 0 : 2;
  return rounded.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function rateText(clicks: number, impressions: number): string {
  if (!(impressions > 0)) return 'n/a';
  return `${Math.round((clicks / impressions) * 1000) / 10}%`;
}

function parts(total: number, labels: string[], ratios: number[]): { label: string; value: number }[] {
  const values = allocateInt(total, ratios);
  return labels.map((label, index) => ({ label, value: values[index]! }));
}

function byDate(rows: AdsPerformanceRow[], pick: (row: AdsPerformanceRow) => number): { label: string; value: number }[] {
  const map = new Map<string, number>();
  for (const row of rows) {
    if (row.level !== 'campaign' || !row.date) continue;
    map.set(row.date, (map.get(row.date) || 0) + pick(row));
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([label, value]) => ({ label, value: round2(value) }));
}

function campaignBars(rows: AdsPerformanceRow[]): { label: string; value: number }[] {
  const map = new Map<string, number>();
  for (const row of rows.filter((item) => item.level === 'campaign')) {
    const name = row.campaign.trim();
    if (!name) continue;
    map.set(name, (map.get(name) || 0) + row.spend);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, value]) => ({ label, value: round2(value) }));
}

function namedBars(rows: AdsPerformanceRow[], pick: (row: AdsPerformanceRow) => string): { label: string; value: number }[] {
  const map = new Map<string, number>();
  for (const row of rows) {
    const name = pick(row).trim();
    if (!name) continue;
    map.set(name, (map.get(name) || 0) + row.spend);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, value]) => ({ label, value: round2(value) }));
}

function leadDays(events: CrmEvent[], start: string, end: string): { label: string; value: number }[] {
  const counts = new Map<string, number>();
  for (const date of datesOf(start, end)) counts.set(date, 0);
  for (const event of events) {
    if (event.type !== 'lead' && event.type !== 'missed_call') continue;
    const day = event.ts.slice(0, 10);
    if (counts.has(day)) counts.set(day, (counts.get(day) || 0) + 1);
  }
  return [...counts.entries()].map(([label, value]) => ({ label, value }));
}

function tradeWord(trade: string): string {
  const clean = trade.trim();
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase() : 'Home services';
}

export function buildReportCharts(args: {
  trade: string;
  dailyBudget: number | null;
  start: string;
  end: string;
  googleConnected: boolean;
  metaConnected: boolean;
  googleRows: AdsPerformanceRow[];
  metaRows: AdsPerformanceRow[];
  hasLedger: boolean;
  events: CrmEvent[];
  leads: number;
  missed: number;
  won: number;
  sources: { label: string; count: number }[];
  projectedJobs: { low: number; high: number } | null;
}): ReportCharts {
  const plan = samplePlan(args);
  const googleSample = plan.google;
  const metaSample = plan.meta;
  const word = tradeWord(args.trade);
  const googleDated = args.googleConnected && args.googleRows.some((row) => row.level === 'campaign' && row.date);
  const metaDated = args.metaConnected && args.metaRows.some((row) => row.level === 'campaign' && row.date);
  const googleCampaigns = args.googleConnected ? campaignBars(args.googleRows) : [];
  const metaCampaigns = args.metaConnected ? campaignBars(args.metaRows) : [];
  const realLeads = args.hasLedger ? leadDays(args.events, args.start, args.end) : [];
  const realGoogleSpend = googleDated ? byDate(args.googleRows, (row) => row.spend) : [];
  const realMetaSpend = metaDated ? byDate(args.metaRows, (row) => row.spend) : [];
  const realClicks = googleDated || metaDated
    ? mergePoints([
      googleDated ? byDate(args.googleRows, (row) => row.clicks) : [],
      metaDated ? byDate(args.metaRows, (row) => row.clicks) : [],
    ])
    : [];

  const spendLine = (googleDated || metaDated)
    ? line('Spend', false, 'Spend from connected ad accounts only.', 'money', mergePoints([realGoogleSpend, realMetaSpend]), 4)
    : line('Spend', true, 'No connected ad account returned daily spend. Google plus Facebook equals this total.', 'money', plan.days.map((day) => ({ label: day.date, value: day.spend })), 4, moneyText(plan.totalSpend));
  const clicksLine = realClicks.length
    ? line('Clicks', false, 'Clicks from connected ad accounts only.', 'count', realClicks, 2)
    : line('Clicks', true, 'No connected ad account returned daily clicks.', 'count', plan.days.map((day) => ({ label: day.date, value: day.clicks })), 2, String(plan.totalClicks));
  const leadsLine = args.hasLedger
    ? line('Leads', false, 'Tracked leads from your CRM ledger, including missed calls.', 'count', realLeads, 3)
    : line('Leads', true, 'No leads are saved yet.', 'count', plan.days.map((day) => ({ label: day.date, value: day.leads })), 3, String(plan.totalLeads));
  const cplReal = args.hasLedger && (googleDated || metaDated) ? cplPoints(mergePoints([realGoogleSpend, realMetaSpend]), realLeads) : [];
  const cplLine = cplReal.length
    ? line('Cost per lead', false, 'Connected spend that day divided by tracked leads that day.', 'money', cplReal, 3)
    : line('Cost per lead', true, 'Running spend divided by running leads. The last point matches the tile.', 'money', runningCpl(plan.days), 3, moneyText(plan.cpl));

  const campaignBar = (googleCampaigns.length || metaCampaigns.length)
    ? bar('Spend by campaign', false, 'Campaigns from connected accounts only.', 'money', [...googleCampaigns, ...metaCampaigns].sort((a, b) => b.value - a.value).slice(0, 8))
    : bar('Spend by campaign', true, 'No campaign rows yet. The bars add up to the sample spend.', 'money', parts(plan.totalSpend, [`${word} search`, `${word} calls`], [0.62, 0.38]), 3);
  const channelBar = (args.googleConnected || args.metaConnected)
    ? bar('Spend by channel', false, 'Only channels that are connected. A missing channel is left off, not filled in.', 'money', [
      ...(args.googleConnected ? [{ label: 'Google Ads', value: round2(args.googleRows.filter((row) => row.level === 'campaign').reduce((sum, row) => sum + row.spend, 0)) }] : []),
      ...(args.metaConnected ? [{ label: 'Facebook and Instagram', value: round2(args.metaRows.filter((row) => row.level === 'campaign').reduce((sum, row) => sum + row.spend, 0)) }] : []),
    ], 3)
    : bar('Spend by channel', true, 'Neither ad account is connected. These two bars add up to the overview spend.', 'money', [
      { label: 'Google Ads', value: plan.googleSpend },
      { label: 'Facebook and Instagram', value: plan.metaSpend },
    ], 3);
  const source = args.sources.length
    ? donut('Lead source', false, 'Sources saved on speed-to-lead replies.', args.sources.map((row) => ({ label: row.label, value: row.count })))
    : donut('Lead source', true, 'Lead events do not name a channel yet. The slices add up to the sample lead total.', parts(plan.totalLeads, ['Google', 'Facebook', 'Phone'], [55, 30, 15]), 2);
  const device = donut('Device mix', true, 'The ad read does not include device, so this mix stays a sample. The slices add up to the sample impressions.', parts(plan.totalImpressions, ['Mobile', 'Desktop', 'Tablet'], [68, 24, 8]), 2);
  const impressions = (args.googleConnected ? args.googleRows : []).concat(args.metaConnected ? args.metaRows : []).filter((row) => row.level === 'campaign');
  const funnelReal = args.hasLedger && (args.googleConnected || args.metaConnected);
  const funnel = funnelReal
    ? {
      kind: 'funnel' as const,
      title: 'Impressions to booked jobs',
      sample: false,
      note: 'Impressions and clicks are from connected ad accounts. Leads and booked jobs are from your CRM ledger. Google conversions are not used as leads.',
      unit: 'count' as const,
      span: 4 as const,
      points: [
        { label: 'Impressions', value: impressions.reduce((sum, row) => sum + row.impressions, 0) },
        { label: 'Clicks', value: impressions.reduce((sum, row) => sum + row.clicks, 0) },
        { label: 'Leads', value: args.leads },
        { label: 'Booked jobs', value: args.won },
      ],
    }
    : {
      kind: 'funnel' as const,
      title: 'Impressions to booked jobs',
      sample: true,
      note: `${SAMPLE_NOTE} This funnel needs a connected ad account and tracked leads before it can use your numbers.`,
      unit: 'count' as const,
      span: 4 as const,
      points: [
        { label: 'Impressions', value: plan.totalImpressions },
        { label: 'Clicks', value: plan.totalClicks },
        { label: 'Leads', value: plan.totalLeads },
        { label: 'Booked jobs', value: plan.totalJobs },
      ],
    };
  const gauge = gaugeWidget(args, plan);

  const googleKeywords = namedBars(args.googleRows.filter((row) => row.level === 'keyword'), (row) => row.keyword || '');
  const googleTerms = namedBars(args.googleRows.filter((row) => row.level === 'search_term'), (row) => row.searchTerm || '');
  const metaAds = namedBars(args.metaRows.filter((row) => row.level === 'ad_group'), (row) => row.adGroup || '');
  const overview = [spendLine, clicksLine, leadsLine, cplLine, campaignBar, channelBar, source, device, funnel, gauge];
  const google = [
    googleDated
      ? line('Spend', false, 'Daily spend from Google Ads.', 'money', realGoogleSpend, 4)
      : line('Spend', true, args.googleConnected ? 'Google did not return a daily breakdown.' : 'Google Ads is not connected. This is 70% of the sample budget. Facebook shows the rest.', 'money', googleSample.map((day) => ({ label: day.date, value: day.spend })), 4, moneyText(plan.googleSpend)),
    googleDated
      ? line('Clicks', false, 'Daily clicks from Google Ads.', 'count', byDate(args.googleRows, (row) => row.clicks))
      : line('Clicks', true, 'No daily Google clicks.', 'count', googleSample.map((day) => ({ label: day.date, value: day.clicks })), 2, String(plan.googleClicks)),
    googleDated
      ? line('CTR', false, 'Clicks divided by impressions each day.', 'rate', ctrPoints(args.googleRows))
      : line('CTR', true, 'No daily Google click-through rate. The tile is total clicks divided by total impressions.', 'rate', googleSample.map((day) => ({ label: day.date, value: day.ctr })), 3, rateText(plan.googleClicks, plan.googleImpressions)),
    googleCpl(args, plan, googleDated, realLeads, realGoogleSpend),
    googleCampaigns.length
      ? bar('Spend by campaign', false, 'Google campaigns in this period.', 'money', googleCampaigns)
      : bar('Spend by campaign', true, 'No Google campaign rows. The bars add up to this tab\'s sample spend.', 'money', parts(plan.googleSpend, [`${word} search`, `${word} calls`], [0.62, 0.38]), 3),
    googleKeywords.length
      ? bar('Top keywords', false, 'Keywords from Google Ads. Bar length is spend.', 'money', googleKeywords)
      : bar('Top keywords', true, 'No keyword rows. The bars add up to this tab\'s sample spend.', 'money', parts(plan.googleSpend, [`${word.toLowerCase()} near me`, `${word.toLowerCase()} cost`, `best ${word.toLowerCase()}`], [0.42, 0.33, 0.25]), 3),
    googleTerms.length
      ? bar('Top search terms', false, 'Search terms from Google Ads. Bar length is spend.', 'money', googleTerms)
      : bar('Top search terms', true, 'No search term rows. The bars add up to this tab\'s sample spend.', 'money', parts(plan.googleSpend, [`${word.toLowerCase()} in my area`, `affordable ${word.toLowerCase()}`, `${word.toLowerCase()} estimate`], [0.4, 0.35, 0.25]), 3),
  ];
  const metaReachReal = metaDated && args.metaRows.some((row) => row.reach != null);
  const meta = [
    metaDated
      ? line('Spend', false, 'Daily spend from the Facebook ad account.', 'money', realMetaSpend, 4)
      : line('Spend', true, args.metaConnected ? 'Meta did not return a daily breakdown.' : 'No Facebook ad account is connected. This is the rest of the sample budget after Google.', 'money', metaSample.map((day) => ({ label: day.date, value: day.spend })), 4, moneyText(plan.metaSpend)),
    metaReachReal
      ? line('Reach', false, 'Reach Meta reported. This is not impressions.', 'count', byDate(args.metaRows, (row) => row.reach || 0))
      : line('Reach', true, 'Meta did not return reach.', 'count', metaSample.map((day) => ({ label: day.date, value: day.reach })), 2, String(metaSample.reduce((sum, day) => sum + day.reach, 0))),
    metaDated
      ? line('CTR', false, 'Clicks divided by impressions each day.', 'rate', ctrPoints(args.metaRows))
      : line('CTR', true, 'No daily Facebook click-through rate. The tile is total clicks divided by total impressions.', 'rate', metaSample.map((day) => ({ label: day.date, value: day.ctr })), 3, rateText(plan.metaClicks, plan.metaImpressions)),
    metaCpl(args, plan, metaDated, realLeads, realMetaSpend),
    metaCampaigns.length
      ? bar('Spend by campaign', false, 'Facebook campaigns in this period.', 'money', metaCampaigns)
      : bar('Spend by campaign', true, 'No Facebook campaign rows. The bars add up to this tab\'s sample spend.', 'money', parts(plan.metaSpend, [`${word} leads`, `${word} retargeting`], [0.7, 0.3]), 3),
    metaAds.length
      ? bar('Top ad sets', false, 'Ad sets from the Facebook ad account. Bar length is spend.', 'money', metaAds)
      : bar('Top ads', true, 'No ad set rows. The bars add up to this tab\'s sample spend.', 'money', parts(plan.metaSpend, ['Before and after', 'Free estimate', 'Local crew'], [0.4, 0.35, 0.25]), 3),
  ];
  const leads = [
    leadsLine,
    donut('Missed and answered calls', true, 'Answered calls are not tracked, so this whole chart is a sample. The two slices add up to the sample lead total. The missed-call tile matches the missed slice when lead tracking is off.', [
      { label: 'Missed', value: plan.missed },
      { label: 'Answered', value: plan.answered },
    ], 3),
    source,
  ];
  const all = [...overview, ...google, ...meta, ...leads];
  const banner = all.some((widget) => widget.sample)
    ? 'Some cards are sample data. Each one is marked Sample data. Sample numbers are not your account, and they are not used for your saved projection or the Am I on track check.'
    : null;
  return { banner, overview, google, meta, leads };
}

function googleCpl(args: { hasLedger: boolean }, plan: SamplePlan, dated: boolean, leads: { label: string; value: number }[], spend: { label: string; value: number }[]): ChartWidget {
  const points = args.hasLedger && dated ? cplPoints(spend, leads) : [];
  return points.length
    ? line('Cost per lead', false, 'Google spend that day divided by tracked leads that day. Not Google conversions.', 'money', points)
    : line('Cost per lead', true, 'Running Google spend divided by running Google leads. The last point matches the tile.', 'money', runningCpl(plan.google), 3, plan.googleLeads > 0 ? moneyText(plan.googleSpend / plan.googleLeads) : 'n/a');
}

function metaCpl(args: { hasLedger: boolean; metaConnected: boolean }, plan: SamplePlan, dated: boolean, leads: { label: string; value: number }[], spend: { label: string; value: number }[]): ChartWidget {
  const points = args.hasLedger && dated ? cplPoints(spend, leads) : [];
  return points.length
    ? line('Cost per lead', false, 'Facebook spend that day divided by tracked leads that day.', 'money', points)
    : line('Cost per lead', true, 'Running Facebook spend divided by running Facebook leads. The last point matches the tile.', 'money', runningCpl(plan.meta), 3, plan.metaLeads > 0 ? moneyText(plan.metaSpend / plan.metaLeads) : 'n/a');
}

function runningCpl(days: { date: string; spend: number; leads: number }[]): { label: string; value: number | null }[] {
  let spend = 0;
  let leads = 0;
  return days.map((day) => {
    spend += day.spend;
    leads += day.leads;
    return { label: day.date, value: leads > 0 ? round2(spend / leads) : null };
  });
}

function cplPoints(spend: { label: string; value: number }[], leads: { label: string; value: number }[]): { label: string; value: number }[] {
  const leadMap = new Map(leads.map((point) => [point.label, point.value]));
  return spend.flatMap((point) => {
    const lead = leadMap.get(point.label) || 0;
    if (!(lead > 0)) return [];
    return [{ label: point.label, value: round2(point.value / lead) }];
  });
}

function ctrPoints(rows: AdsPerformanceRow[]): { label: string; value: number }[] {
  const map = new Map<string, { clicks: number; impressions: number }>();
  for (const row of rows) {
    if (row.level !== 'campaign' || !row.date) continue;
    const prev = map.get(row.date) || { clicks: 0, impressions: 0 };
    prev.clicks += row.clicks;
    prev.impressions += row.impressions;
    map.set(row.date, prev);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([label, row]) => ({
    label,
    value: row.impressions > 0 ? round2(row.clicks / row.impressions) : 0,
  }));
}

function mergePoints(series: { label: string; value: number }[][]): { label: string; value: number }[] {
  const map = new Map<string, number>();
  for (const points of series) {
    for (const point of points) map.set(point.label, (map.get(point.label) || 0) + point.value);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([label, value]) => ({ label, value: round2(value) }));
}

function gaugeWidget(args: { hasLedger: boolean; won: number; projectedJobs: { low: number; high: number } | null }, plan: SamplePlan): ChartWidget {
  if (args.hasLedger && args.projectedJobs) {
    const mid = (args.projectedJobs.low + args.projectedJobs.high) / 2;
    const pace = mid > 0 ? Math.max(0, Math.min(1, args.won / mid)) : 0;
    return {
      kind: 'gauge',
      title: 'Goal pacing',
      sample: false,
      note: 'Won jobs in this period compared with your saved projection, scaled to these dates. This does not change the projection.',
      unit: 'count',
      span: 2,
      points: [],
      pace: round2(pace),
      caption: `${args.won} won job${args.won === 1 ? '' : 's'} vs about ${args.projectedJobs.low} to ${args.projectedJobs.high} projected.`,
    };
  }
  return {
    kind: 'gauge',
    title: 'Goal pacing',
    sample: true,
    note: `${SAMPLE_NOTE} This arc is not your saved projection and it is not the Am I on track check.`,
    unit: 'count',
    span: 2,
    points: [],
    pace: 0.72,
    caption: 'Sample pacing for this budget.',
  };
}
