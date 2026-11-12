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
 * - Spend each day wobbles with a sine of the day index, then is scaled so
 *   the days add up to daily budget times the number of days.
 * - Clicks use a cost per click of 8% of that cost per lead.
 * - Click-through rate wobbles around 3.5%. Impressions are clicks divided
 *   by that rate. Reach is 72% of impressions.
 * - Leads are spend divided by the cost per lead. Booked jobs are leads
 *   times the book rate.
 * - When a sample chart is for one channel, Google is 70% of that spend and
 *   Facebook is 30%. That split is not the owner's saved channel mix.
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
  points: { label: string; value: number }[];
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
  cpl: number;
  bookRatePct: number;
  days: SampleDay[];
  totalSpend: number;
  totalLeads: number;
  totalJobs: number;
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

function shape(index: number, salt: number): number {
  return 1 + 0.18 * Math.sin((index + 1 + salt) * 0.9);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Documented sample series for the whole daily budget, before a channel split. */
export function samplePlan(args: { trade: string; dailyBudget: number | null; start: string; end: string }): SamplePlan {
  const band = cplBandForGoal(args.trade || '', 'google_ads');
  const cpl = band && band.typical > 0 ? band.typical : 149;
  const namedBook = band ? tradeBookRate(band.label) : null;
  const fallbackBook = googleAdsEnds()?.nonBrand.bookRatePct ?? 37.6;
  const bookRatePct = namedBook ?? fallbackBook;
  const daily = args.dailyBudget && args.dailyBudget > 0 ? args.dailyBudget : DEFAULT_CAPS.dailyBudget;
  const dates = datesOf(args.start, args.end);
  const weights = dates.map((_, index) => shape(index, 1));
  const weightSum = weights.reduce((sum, value) => sum + value, 0) || 1;
  const ctrWeights = dates.map((_, index) => shape(index, 4));
  const days = dates.map((date, index) => {
    const spend = round2((daily * dates.length) * (weights[index]! / weightSum));
    const clicks = round2(spend / Math.max(1, cpl * 0.08));
    const ctr = round2(0.035 * (ctrWeights[index]! / (ctrWeights.reduce((s, v) => s + v, 0) / ctrWeights.length)));
    const impressions = ctr > 0 ? round2(clicks / ctr) : 0;
    const leads = round2(spend / cpl);
    return {
      date,
      spend,
      clicks,
      impressions,
      leads,
      reach: round2(impressions * 0.72),
      jobs: round2(leads * (bookRatePct / 100)),
      ctr,
    };
  });
  const drift = round2(daily * dates.length - days.reduce((sum, day) => sum + day.spend, 0));
  if (days.length) days[days.length - 1]!.spend = round2(days[days.length - 1]!.spend + drift);
  return {
    daily,
    cpl,
    bookRatePct,
    days,
    totalSpend: round2(days.reduce((sum, day) => sum + day.spend, 0)),
    totalLeads: round2(days.reduce((sum, day) => sum + day.leads, 0)),
    totalJobs: round2(days.reduce((sum, day) => sum + day.jobs, 0)),
  };
}

function scaleDays(days: SampleDay[], share: number): SampleDay[] {
  return days.map((day) => ({
    date: day.date,
    spend: round2(day.spend * share),
    clicks: round2(day.clicks * share),
    impressions: round2(day.impressions * share),
    leads: round2(day.leads * share),
    reach: round2(day.reach * share),
    jobs: round2(day.jobs * share),
    ctr: day.ctr,
  }));
}

function line(title: string, sample: boolean, note: string, unit: ChartWidget['unit'], points: { label: string; value: number }[]): ChartWidget {
  return { kind: 'line', title, sample, note: sample ? `${SAMPLE_NOTE} ${note}` : note, unit, points };
}

function bar(title: string, sample: boolean, note: string, unit: ChartWidget['unit'], points: { label: string; value: number }[]): ChartWidget {
  return { kind: 'bar', title, sample, note: sample ? `${SAMPLE_NOTE} ${note}` : note, unit, points };
}

function donut(title: string, sample: boolean, note: string, points: { label: string; value: number }[]): ChartWidget {
  return { kind: 'donut', title, sample, note: sample ? `${SAMPLE_NOTE} ${note}` : note, unit: 'count', points };
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
  const googleSample = scaleDays(plan.days, GOOGLE_SHARE);
  const metaSample = scaleDays(plan.days, 1 - GOOGLE_SHARE);
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
    ? line('Spend', false, 'Spend from connected ad accounts only.', 'money', mergePoints([realGoogleSpend, realMetaSpend]))
    : line('Spend', true, 'No connected ad account returned daily spend.', 'money', plan.days.map((day) => ({ label: day.date, value: day.spend })));
  const clicksLine = realClicks.length
    ? line('Clicks', false, 'Clicks from connected ad accounts only.', 'count', realClicks)
    : line('Clicks', true, 'No connected ad account returned daily clicks.', 'count', plan.days.map((day) => ({ label: day.date, value: day.clicks })));
  const leadsLine = args.hasLedger
    ? line('Leads', false, 'Tracked leads from your CRM ledger, including missed calls.', 'count', realLeads)
    : line('Leads', true, 'No leads are saved yet.', 'count', plan.days.map((day) => ({ label: day.date, value: day.leads })));
  const cplReal = args.hasLedger && (googleDated || metaDated) ? cplPoints(mergePoints([realGoogleSpend, realMetaSpend]), realLeads) : [];
  const cplLine = cplReal.length
    ? line('Cost per lead', false, 'Connected spend that day divided by tracked leads that day.', 'money', cplReal)
    : line('Cost per lead', true, 'Needs both daily ad spend and tracked leads before this line is real.', 'money', plan.days.map((day) => ({ label: day.date, value: round2(plan.cpl * day.ctr / 0.035) })));

  const campaignBar = (googleCampaigns.length || metaCampaigns.length)
    ? bar('Spend by campaign', false, 'Campaigns from connected accounts only.', 'money', [...googleCampaigns, ...metaCampaigns].sort((a, b) => b.value - a.value).slice(0, 8))
    : bar('Spend by campaign', true, 'No campaign rows yet.', 'money', [
      { label: `${word} search`, value: round2(plan.totalSpend * 0.62) },
      { label: `${word} calls`, value: round2(plan.totalSpend * 0.38) },
    ]);
  const channelBar = (args.googleConnected || args.metaConnected)
    ? bar('Spend by channel', false, 'Only channels that are connected. A missing channel is left off, not filled in.', 'money', [
      ...(args.googleConnected ? [{ label: 'Google Ads', value: round2(args.googleRows.filter((row) => row.level === 'campaign').reduce((sum, row) => sum + row.spend, 0)) }] : []),
      ...(args.metaConnected ? [{ label: 'Facebook and Instagram', value: round2(args.metaRows.filter((row) => row.level === 'campaign').reduce((sum, row) => sum + row.spend, 0)) }] : []),
    ])
    : bar('Spend by channel', true, 'Neither ad account is connected.', 'money', [
      { label: 'Google Ads', value: round2(plan.totalSpend * GOOGLE_SHARE) },
      { label: 'Facebook and Instagram', value: round2(plan.totalSpend * (1 - GOOGLE_SHARE)) },
    ]);
  const source = args.sources.length
    ? donut('Lead source', false, 'Sources saved on speed-to-lead replies.', args.sources.map((row) => ({ label: row.label, value: row.count })))
    : donut('Lead source', true, 'Lead events do not name a channel yet.', [
      { label: 'Google', value: 55 },
      { label: 'Facebook', value: 30 },
      { label: 'Phone', value: 15 },
    ]);
  const device = donut('Device mix', true, 'The ad read does not include device, so this mix stays a sample.', [
    { label: 'Mobile', value: 68 },
    { label: 'Desktop', value: 24 },
    { label: 'Tablet', value: 8 },
  ]);
  const impressions = (args.googleConnected ? args.googleRows : []).concat(args.metaConnected ? args.metaRows : []).filter((row) => row.level === 'campaign');
  const funnelReal = args.hasLedger && (args.googleConnected || args.metaConnected);
  const funnel = funnelReal
    ? {
      kind: 'funnel' as const,
      title: 'Impressions to booked jobs',
      sample: false,
      note: 'Impressions and clicks are from connected ad accounts. Leads and booked jobs are from your CRM ledger. Google conversions are not used as leads.',
      unit: 'count' as const,
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
      points: [
        { label: 'Impressions', value: Math.round(plan.days.reduce((sum, day) => sum + day.impressions, 0)) },
        { label: 'Clicks', value: Math.round(plan.days.reduce((sum, day) => sum + day.clicks, 0)) },
        { label: 'Leads', value: Math.round(plan.totalLeads) },
        { label: 'Booked jobs', value: round2(plan.totalJobs) },
      ],
    };
  const gauge = gaugeWidget(args, plan);

  const googleKeywords = namedBars(args.googleRows.filter((row) => row.level === 'keyword'), (row) => row.keyword || '');
  const googleTerms = namedBars(args.googleRows.filter((row) => row.level === 'search_term'), (row) => row.searchTerm || '');
  const metaAds = namedBars(args.metaRows.filter((row) => row.level === 'ad_group'), (row) => row.adGroup || '');
  const googleSpend = round2(googleSample.reduce((sum, day) => sum + day.spend, 0));
  const metaSpend = round2(metaSample.reduce((sum, day) => sum + day.spend, 0));

  const overview = [spendLine, clicksLine, leadsLine, cplLine, campaignBar, channelBar, source, device, funnel, gauge];
  const google = [
    googleDated
      ? line('Spend', false, 'Daily spend from Google Ads.', 'money', realGoogleSpend)
      : line('Spend', true, args.googleConnected ? 'Google did not return a daily breakdown.' : 'Google Ads is not connected.', 'money', googleSample.map((day) => ({ label: day.date, value: day.spend }))),
    googleDated
      ? line('Clicks', false, 'Daily clicks from Google Ads.', 'count', byDate(args.googleRows, (row) => row.clicks))
      : line('Clicks', true, 'No daily Google clicks.', 'count', googleSample.map((day) => ({ label: day.date, value: day.clicks }))),
    googleDated
      ? line('CTR', false, 'Clicks divided by impressions each day.', 'rate', ctrPoints(args.googleRows))
      : line('CTR', true, 'No daily Google click-through rate.', 'rate', googleSample.map((day) => ({ label: day.date, value: day.ctr }))),
    googleCpl(args, plan, googleDated, realLeads, realGoogleSpend),
    googleCampaigns.length
      ? bar('Spend by campaign', false, 'Google campaigns in this period.', 'money', googleCampaigns)
      : bar('Spend by campaign', true, 'No Google campaign rows.', 'money', [
        { label: `${word} search`, value: round2(googleSpend * 0.62) },
        { label: `${word} calls`, value: round2(googleSpend * 0.38) },
      ]),
    googleKeywords.length
      ? bar('Top keywords', false, 'Keywords from Google Ads. Bar length is spend.', 'money', googleKeywords)
      : bar('Top keywords', true, 'No keyword rows.', 'money', [
        { label: `${word.toLowerCase()} near me`, value: round2(googleSpend * 0.42) },
        { label: `${word.toLowerCase()} cost`, value: round2(googleSpend * 0.33) },
        { label: `best ${word.toLowerCase()}`, value: round2(googleSpend * 0.25) },
      ]),
    googleTerms.length
      ? bar('Top search terms', false, 'Search terms from Google Ads. Bar length is spend.', 'money', googleTerms)
      : bar('Top search terms', true, 'No search term rows.', 'money', [
        { label: `${word.toLowerCase()} in my area`, value: round2(googleSpend * 0.4) },
        { label: `affordable ${word.toLowerCase()}`, value: round2(googleSpend * 0.35) },
        { label: `${word.toLowerCase()} estimate`, value: round2(googleSpend * 0.25) },
      ]),
  ];
  const metaReachReal = metaDated && args.metaRows.some((row) => row.reach != null);
  const meta = [
    metaDated
      ? line('Spend', false, 'Daily spend from the Facebook ad account.', 'money', realMetaSpend)
      : line('Spend', true, args.metaConnected ? 'Meta did not return a daily breakdown.' : 'No Facebook ad account is connected.', 'money', metaSample.map((day) => ({ label: day.date, value: day.spend }))),
    metaReachReal
      ? line('Reach', false, 'Reach Meta reported. This is not impressions.', 'count', byDate(args.metaRows, (row) => row.reach || 0))
      : line('Reach', true, 'Meta did not return reach.', 'count', metaSample.map((day) => ({ label: day.date, value: day.reach }))),
    metaDated
      ? line('CTR', false, 'Clicks divided by impressions each day.', 'rate', ctrPoints(args.metaRows))
      : line('CTR', true, 'No daily Facebook click-through rate.', 'rate', metaSample.map((day) => ({ label: day.date, value: day.ctr }))),
    metaCpl(args, plan, metaDated, realLeads, realMetaSpend),
    metaCampaigns.length
      ? bar('Spend by campaign', false, 'Facebook campaigns in this period.', 'money', metaCampaigns)
      : bar('Spend by campaign', true, 'No Facebook campaign rows.', 'money', [
        { label: `${word} leads`, value: round2(metaSpend * 0.7) },
        { label: `${word} retargeting`, value: round2(metaSpend * 0.3) },
      ]),
    metaAds.length
      ? bar('Top ad sets', false, 'Ad sets from the Facebook ad account. Bar length is spend.', 'money', metaAds)
      : bar('Top ads', true, 'No ad set rows.', 'money', [
        { label: 'Before and after', value: round2(metaSpend * 0.4) },
        { label: 'Free estimate', value: round2(metaSpend * 0.35) },
        { label: 'Local crew', value: round2(metaSpend * 0.25) },
      ]),
  ];
  const leads = [
    leadsLine,
    donut('Missed and answered calls', true, 'Answered calls are not tracked, so this whole chart is a sample. The missed-call tile is your real count when lead tracking is on.', [
      { label: 'Missed', value: Math.max(1, Math.round(plan.totalLeads * 0.22)) },
      { label: 'Answered', value: Math.max(1, Math.round(plan.totalLeads * 0.78)) },
    ]),
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
    : line('Cost per lead', true, 'Needs daily Google spend and tracked leads.', 'money', plan.days.map((day) => ({ label: day.date, value: plan.cpl })));
}

function metaCpl(args: { hasLedger: boolean; metaConnected: boolean }, plan: SamplePlan, dated: boolean, leads: { label: string; value: number }[], spend: { label: string; value: number }[]): ChartWidget {
  const points = args.hasLedger && dated ? cplPoints(spend, leads) : [];
  return points.length
    ? line('Cost per lead', false, 'Facebook spend that day divided by tracked leads that day.', 'money', points)
    : line('Cost per lead', true, 'Needs daily Facebook spend and tracked leads.', 'money', plan.days.map((day) => ({ label: day.date, value: plan.cpl })));
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
    points: [],
    pace: 0.72,
    caption: 'Sample pacing for this budget.',
  };
}
