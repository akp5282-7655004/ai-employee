/**
 * Budget expectation for an owner who is not a marketer.
 *
 * leads = monthly budget / cost per lead
 * booked jobs = leads x book rate
 *
 * The cost per lead is the same band the goal check uses, so the two cannot
 * disagree. A trade with no row uses the published blended and non-brand
 * figures and is labeled as an estimate from similar home-services trades.
 * Customer copy uses BENCHMARK_META.source and never names the study's publisher.
 */
import { BENCHMARK_HUB, BENCHMARK_META, LSA_BLENDED, LSA_TRADES } from '../packs/benchmarks.js';
import {
  cplBandForGoal,
  googleAdsEnds,
  leadCountsForBudget,
  tradeLabelFor,
  MONTH_DAYS,
  type CplBand,
  type GoalChannel,
} from './goalcheck.js';
import { tradeKey } from './feasibility.js';

export interface ProjectionEnd {
  kind: 'non_brand' | 'blended' | 'trade' | 'lsa';
  cpl: number;
  bookRatePct: number;
  /** Published cost per customer for this end. Null when that row does not list one. */
  costPerCustomer: number | null;
  leadsExact: number;
  jobsExact: number;
}

export interface BudgetExpectation {
  inputs: {
    trade: string;
    city: string;
    monthlyBudget: number;
    channel: GoalChannel;
  };
  benchmark: {
    channel: GoalChannel;
    rowLabel: string;
    fallback: boolean;
    sourceLabel: string;
    /** Set when the trade has no row of its own. */
    estimateLabel: string | null;
    /** Fewer leads. Higher cost per lead. */
    highCpl: ProjectionEnd;
    /** More leads. Lower cost per lead. Same as highCpl when the study lists one figure. */
    lowCpl: ProjectionEnd;
    /** Channel cost per customer when the trade row does not publish its own. */
    channelCostPerCustomer: { blended: number; nonBrand: number } | null;
  };
  range: {
    leads: { low: number; high: number };
    jobs: { low: number; high: number };
  };
  copy: string;
  computedAt: string;
}

export interface ExpectationActuals {
  /** Real account with an enabled campaign. */
  live: boolean;
  /** Preview connector. Its numbers are never shown as real. */
  sample: boolean;
  /** Google spend in the last 30 days. Null when that read did not happen. */
  spend: number | null;
  /** Tracked leads in the last 30 days. Null when lead tracking has no real read. */
  leads: number | null;
  /** Days since the campaign was enabled. Null when that day is not known. */
  liveDays: number | null;
}

export interface ExpectationReadout {
  state: 'empty' | 'saved' | 'waiting' | 'live' | 'sample';
  headline: string;
  detail: string;
  lines: { label: string; value: string }[];
}

function plain(s: string): string {
  return s
    .replace(/\u2014/g, ', ')
    .replace(/\u2013/g, '-')
    .replace(/searchlight\s*digital/gi, 'the published study')
    .replace(/searchlight/gi, 'the published study')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function jobNum(n: number): string {
  const rounded = round1(n);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function leadPhrase(low: number, high: number): string {
  const a = Math.min(low, high);
  const b = Math.max(low, high);
  if (a === b) return `about ${a} ${a === 1 ? 'lead' : 'leads'}`;
  return `about ${a} to ${b} leads`;
}

function jobPhrase(low: number, high: number): string {
  const a = round1(Math.min(low, high));
  const b = round1(Math.max(low, high));
  if (a === b) {
    const word = a === 1 ? 'booked job' : 'booked jobs';
    return `about ${jobNum(a)} ${word}`;
  }
  return `about ${jobNum(a)} to ${jobNum(b)} booked jobs`;
}

function hubNote(channelId: 'google_ads' | 'lsa', tradeName: string, metric: string): string {
  const block = BENCHMARK_HUB.find((row) => row.id === channelId);
  return block?.entries.find((row) => row.trade === tradeName && row.metric === metric)?.note || '';
}

/** Book rate written as "book rate 41.2%" on a Google Ads cost-per-lead note. */
export function tradeBookRate(hubTrade: string): number | null {
  const note = hubNote('google_ads', hubTrade, 'CPL');
  const match = note.match(/book rate (\d+(?:\.\d+)?)%/i);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function lsaBook(trade: string, label: string): { bookRatePct: number; costPerCustomer: number | null; own: boolean } {
  const named = LSA_TRADES.find((row) => row.trade.toLowerCase() === label.toLowerCase());
  if (named) return { bookRatePct: named.bookRate, costPerCustomer: null, own: true };
  const key = tradeKey(trade);
  if (key === 'garage_door') {
    const note = hubNote('lsa', 'Garage Door', 'CPL');
    const book = note.match(/book rate (\d+(?:\.\d+)?)%/i);
    const cost = note.match(/cost\/customer \$(\d+(?:\.\d+)?)/i);
    const bookRate = book ? Number(book[1]) : null;
    const costPerCustomer = cost ? Number(cost[1]) : null;
    if (bookRate && bookRate > 0) return { bookRatePct: bookRate, costPerCustomer: costPerCustomer && costPerCustomer > 0 ? costPerCustomer : null, own: true };
  }
  if (key === 'roofing') return { bookRatePct: LSA_BLENDED.bookRate, costPerCustomer: null, own: false };
  return { bookRatePct: LSA_BLENDED.bookRate, costPerCustomer: LSA_BLENDED.costPerCustomer, own: false };
}

function endOf(kind: ProjectionEnd['kind'], cpl: number, bookRatePct: number, costPerCustomer: number | null, monthly: number): ProjectionEnd {
  const leadsExact = cpl > 0 ? monthly / cpl : 0;
  const jobsExact = leadsExact * (bookRatePct / 100);
  return { kind, cpl, bookRatePct, costPerCustomer, leadsExact, jobsExact };
}

function capSentence(monthly: number): string {
  const daily = Math.max(1, Math.round(monthly / MONTH_DAYS));
  const across = daily * MONTH_DAYS;
  if (Math.abs(across - monthly) < 1) return '';
  return ` The daily cap rounds to ${money(daily)}, which is ${money(across)} over 30 days. This projection uses the ${money(monthly)} you typed.`;
}

function copyFor(input: { monthly: number; city: string; label: string; fallback: boolean; channel: GoalChannel; high: ProjectionEnd; low: ProjectionEnd; channelCost: { blended: number; nonBrand: number } | null }): string {
  const leads = leadPhrase(Math.round(input.high.leadsExact), Math.round(input.low.leadsExact));
  const jobs = jobPhrase(input.high.jobsExact, input.low.jobsExact);
  const place = input.city.trim();
  const where = place ? ` No separate figure is published for ${place}.` : '';
  const same = input.high.cpl === input.low.cpl && input.high.bookRatePct === input.low.bookRatePct;
  let rates: string;
  if (same) {
    rates = `A lead costs about ${money(input.high.cpl)}. About ${input.high.bookRatePct}% of leads book a job.`;
  } else if (input.fallback && input.channel === 'google_ads') {
    rates = `A lead costs about ${money(input.low.cpl)} when the study includes people who search a company by name, and about ${money(input.high.cpl)} for everyone else. About ${input.low.bookRatePct}% of the cheaper leads book a job, and about ${input.high.bookRatePct}% of the others.`;
  } else {
    rates = `A lead costs about ${money(Math.min(input.high.cpl, input.low.cpl))} to ${money(Math.max(input.high.cpl, input.low.cpl))}. About ${input.high.bookRatePct}% of leads book a job.`;
  }
  const estimate = input.fallback
    ? ` ${input.label} has no ${input.channel === 'lsa' ? 'Local Services Ads' : 'Google Ads'} row, so this is an estimate from similar home-services trades.`
    : '';
  let customer = '';
  if (input.high.costPerCustomer != null && input.low.costPerCustomer != null) {
    const a = Math.min(input.high.costPerCustomer, input.low.costPerCustomer);
    const b = Math.max(input.high.costPerCustomer, input.low.costPerCustomer);
    customer = a === b
      ? ` A paying customer in the study costs about ${money(a)}.`
      : ` A paying customer in the study costs about ${money(a)} to ${money(b)}.`;
  } else if (input.channelCost && input.channel === 'google_ads' && !input.fallback) {
    customer = ` The study does not list a cost per customer for ${input.label}. For Google Ads from people who are not searching a company by name, a paying customer costs about ${money(input.channelCost.nonBrand)}. That number is not for ${input.label} alone.`;
  }
  const bookNote = !input.fallback && input.channel === 'google_ads' && input.high.bookRatePct === input.low.bookRatePct
    ? (tradeBookRate(input.label) != null
      ? ''
      : ` That book rate is for Google Ads from people who are not searching a company by name. ${input.label}'s row does not list its own.`)
    : (!input.fallback && input.channel === 'lsa' && input.high.costPerCustomer == null && input.high.bookRatePct === LSA_BLENDED.bookRate
      ? ` ${input.label}'s row does not list how often a lead books, so this uses the all-trades figure of ${LSA_BLENDED.bookRate}%.`
      : '');
  return plain(`On ${money(input.monthly)} a month, expect ${leads}. ${jobs.charAt(0).toUpperCase()}${jobs.slice(1)} from those leads. ${rates}${bookNote}${customer}${estimate}${where}${capSentence(input.monthly)} This is not a promise. Source: ${BENCHMARK_META.source}.`);
}

export function projectBudget(input: {
  trade?: string;
  city?: string;
  monthlyBudget?: number;
  channel?: GoalChannel;
  now?: Date;
}): BudgetExpectation | null {
  const monthly = Number(input.monthlyBudget);
  if (!(monthly > 0) || !Number.isFinite(monthly)) return null;
  const channel: GoalChannel = input.channel === 'lsa' ? 'lsa' : 'google_ads';
  const trade = (input.trade || '').trim();
  const city = (input.city || '').trim();
  const band = trade ? cplBandForGoal(trade, channel) : null;
  if (!band) return null;
  const ends = channel === 'google_ads' ? googleAdsEnds() : null;
  const built = endsFor(trade, band, monthly, ends);
  if (!built) return null;
  const counts = leadCountsForBudget(monthly, band);
  const jobsLow = round1(built.high.jobsExact);
  const jobsHigh = round1(built.low.jobsExact);
  const copy = copyFor({
    monthly,
    city,
    label: band.label,
    fallback: band.source === 'similar',
    channel,
    high: built.high,
    low: built.low,
    channelCost: ends ? { blended: ends.blended.costPerCustomer, nonBrand: ends.nonBrand.costPerCustomer } : null,
  });
  return {
    inputs: { trade: band.label, city, monthlyBudget: monthly, channel },
    benchmark: {
      channel,
      rowLabel: band.label,
      fallback: band.source === 'similar',
      sourceLabel: BENCHMARK_META.source,
      estimateLabel: band.source === 'similar' ? 'Estimate from similar home-services trades' : null,
      highCpl: built.high,
      lowCpl: built.low,
      channelCostPerCustomer: ends ? { blended: ends.blended.costPerCustomer, nonBrand: ends.nonBrand.costPerCustomer } : null,
    },
    range: {
      leads: { low: counts.low, high: counts.high },
      jobs: { low: Math.min(jobsLow, jobsHigh), high: Math.max(jobsLow, jobsHigh) },
    },
    copy,
    computedAt: (input.now ?? new Date()).toISOString(),
  };
}

function endsFor(
  trade: string,
  band: CplBand,
  monthly: number,
  google: ReturnType<typeof googleAdsEnds>,
): { high: ProjectionEnd; low: ProjectionEnd } | null {
  if (band.channel === 'lsa') {
    const book = lsaBook(trade, band.label);
    const kind: ProjectionEnd['kind'] = 'lsa';
    const cost = book.costPerCustomer;
    const one = endOf(kind, band.typical, book.bookRatePct, cost, monthly);
    return { high: one, low: one };
  }
  if (!google) return null;
  if (band.source === 'similar') {
    return {
      high: endOf('non_brand', google.nonBrand.cpl, google.nonBrand.bookRatePct, google.nonBrand.costPerCustomer, monthly),
      low: endOf('blended', google.blended.cpl, google.blended.bookRatePct, google.blended.costPerCustomer, monthly),
    };
  }
  const own = tradeBookRate(band.label);
  const book = own ?? google.nonBrand.bookRatePct;
  const highCpl = Math.max(band.low, band.high);
  const lowCpl = Math.min(band.low, band.high);
  return {
    high: endOf('non_brand', highCpl, book, null, monthly),
    low: endOf(own != null ? 'trade' : 'non_brand', lowCpl, book, null, monthly),
  };
}

const EXPECTATION_KEY = 'budgetExpectation';

function isEnd(value: unknown): value is ProjectionEnd {
  if (!value || typeof value !== 'object') return false;
  const row = value as ProjectionEnd;
  return typeof row.cpl === 'number' && row.cpl > 0
    && typeof row.bookRatePct === 'number'
    && typeof row.leadsExact === 'number'
    && typeof row.jobsExact === 'number';
}

export function readExpectation(data: Record<string, unknown>): BudgetExpectation | null {
  const raw = data[EXPECTATION_KEY];
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as BudgetExpectation;
  if (!row.inputs || !(row.inputs.monthlyBudget > 0)) return null;
  if (!row.benchmark || !isEnd(row.benchmark.highCpl) || !isEnd(row.benchmark.lowCpl)) return null;
  if (!row.range?.leads || !row.range?.jobs) return null;
  if (typeof row.copy !== 'string' || typeof row.computedAt !== 'string') return null;
  return row;
}

/** Keep the first projection once a campaign exists. A locked empty account is not backfilled. */
export function storeExpectation(
  data: Record<string, unknown>,
  next: BudgetExpectation,
  locked: boolean,
): { current: BudgetExpectation | null; wrote: boolean } {
  const existing = readExpectation(data);
  if (locked) return { current: existing, wrote: false };
  data[EXPECTATION_KEY] = next;
  return { current: next, wrote: true };
}

export function liveDaysFromEvents(
  events: { ts: string; text: string }[],
  activation: string | null | undefined,
  now = new Date(),
): number | null {
  if (activation !== 'enabled') return null;
  const hits = events.filter((event) => /enabled/i.test(event.text) && Number.isFinite(Date.parse(event.ts)));
  if (!hits.length) return null;
  const oldest = hits.reduce((a, b) => (Date.parse(a.ts) <= Date.parse(b.ts) ? a : b));
  return Math.max(0, Math.floor((now.getTime() - Date.parse(oldest.ts)) / 86_400_000));
}

function closesFrom(leads: number, stored: BudgetExpectation): string {
  const low = leads * (stored.benchmark.highCpl.bookRatePct / 100);
  const high = leads * (stored.benchmark.lowCpl.bookRatePct / 100);
  return jobPhrase(low, high);
}

function paceSentence(stored: BudgetExpectation, actuals: ExpectationActuals, leads: number | null): string {
  const planned = leadPhrase(stored.range.leads.low, stored.range.leads.high);
  const jobs = jobPhrase(stored.range.jobs.low, stored.range.jobs.high);
  const spent = actuals.spend == null ? '' : ` You have spent ${money(actuals.spend)} of the ${money(stored.inputs.monthlyBudget)} you planned.`;
  const leadBit = leads == null
    ? ' No tracked leads yet, so cost per lead stays blank. Google conversion counts are not used as leads.'
    : ` Tracked leads: ${leads}, against ${planned} for a full month.`;
  if (actuals.liveDays != null && actuals.liveDays < 30) {
    const days = actuals.liveDays === 1 ? '1 day' : `${actuals.liveDays} days`;
    return plain(`You planned ${money(stored.inputs.monthlyBudget)} a month, ${planned} and ${jobs}.${spent}${leadBit} The campaign has been on about ${days}. Google spend here is the last 30 days, not only those days, so Miles will not call a partial month ahead or behind.`);
  }
  if (actuals.liveDays == null) {
    return plain(`You planned ${money(stored.inputs.monthlyBudget)} a month, ${planned} and ${jobs}.${spent}${leadBit} Miles does not know the day the campaign was enabled, so this is the last 30 days against the full month, not a day-by-day pace.`);
  }
  let verdict = 'That is inside the projection for the month.';
  if (leads != null && leads < stored.range.leads.low) verdict = 'That is behind the projection for the month.';
  else if (leads != null && leads > stored.range.leads.high) verdict = 'That is ahead of the projection for the month.';
  return plain(`You planned ${money(stored.inputs.monthlyBudget)} a month, ${planned} and ${jobs}.${spent}${leadBit} ${verdict}`);
}

export function expectationReadout(stored: BudgetExpectation | null, actuals: ExpectationActuals): ExpectationReadout {
  if (actuals.sample) {
    const saved = stored
      ? ` Your saved projection is still ${leadPhrase(stored.range.leads.low, stored.range.leads.high)} a month. It is not compared with example data.`
      : '';
    return {
      state: 'sample',
      headline: 'These are not your numbers.',
      detail: plain(`The preview connector can show example spend and example leads. Miles will not treat them as real.${saved}`),
      lines: [],
    };
  }
  if (!actuals.live) {
    if (!stored) {
      return {
        state: 'empty',
        headline: 'No budget projection is saved yet.',
        detail: 'Set a budget on the launch page before Miles builds anything. Miles will show what that budget should bring.',
        lines: [],
      };
    }
    return {
      state: 'saved',
      headline: 'Before the campaign is on',
      detail: stored.copy,
      lines: [],
    };
  }
  const spendKnown = actuals.spend != null && Number.isFinite(actuals.spend);
  const leadsKnown = actuals.leads != null && Number.isFinite(actuals.leads);
  const lines: { label: string; value: string }[] = [];
  if (spendKnown) lines.push({ label: 'Spent', value: money(actuals.spend || 0) });
  if (leadsKnown) lines.push({ label: 'Tracked leads', value: String(Math.round(actuals.leads || 0)) });
  if (spendKnown && leadsKnown && (actuals.leads || 0) > 0) {
    lines.push({ label: 'Cost per lead', value: money((actuals.spend || 0) / (actuals.leads || 1)) });
  }
  if (stored && leadsKnown) lines.push({ label: 'Booked jobs from these leads', value: closesFrom(actuals.leads || 0, stored) });
  if (!spendKnown && !leadsKnown) {
    return {
      state: 'waiting',
      headline: 'The campaign is on. Miles has not read spend or tracked leads yet.',
      detail: stored
        ? plain(`Your saved projection is still here. This page will compare it when Google returns spend and a lead is tracked. ${stored.copy}`)
        : 'No budget projection was saved before this campaign was built, so Miles will not invent one. Example numbers are not used.',
      lines: [],
    };
  }
  if (spendKnown && (actuals.spend || 0) === 0 && leadsKnown && (actuals.leads || 0) === 0) {
    return {
      state: 'waiting',
      headline: 'The campaign is on, and there is nothing to compare yet.',
      detail: stored
        ? plain(`The last 30 days show $0 spent and 0 tracked leads. ${stored.copy} Miles will not invent a pace from an empty read.`)
        : 'The last 30 days show $0 spent and 0 tracked leads. No budget projection was saved before this campaign was built.',
      lines,
    };
  }
  return {
    state: 'live',
    headline: 'Last 30 days against the budget you saved',
    detail: stored
      ? paceSentence(stored, actuals, leadsKnown ? Math.round(actuals.leads || 0) : null)
      : plain(`${spendKnown ? `Spent ${money(actuals.spend || 0)} on Google in the last 30 days.` : 'Google spend has not come back yet.'} ${leadsKnown ? `${Math.round(actuals.leads || 0)} tracked leads.` : 'No tracked leads yet.'} No budget projection was saved before this campaign was built, so booked jobs stay blank.`),
    lines,
  };
}
