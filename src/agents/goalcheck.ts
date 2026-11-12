/**
 * Goal check for an owner who is not a marketer.
 *
 * Expected leads are budget divided by a published Google Ads cost per lead.
 * A published Google Ads row in src/packs/benchmarks.ts wins when one exists.
 * Those dollars are copied from that file, not averaged. When the file has
 * no row, the only other figure Miles may use is the playbook band in
 * src/agents/playbook.ts (for painting, $40 to $90). That band is labeled
 * as a playbook planning range, not as a published Google Ads study.
 * The midpoint is only the middle of those two ends. No other number is added.
 *
 * The benchmark file has no city rows and no Google Ads CPC or click
 * conversion rate for these trades. A city always uses the trade's national
 * figures, and the copy says so. Book rate is a share of leads that book,
 * not a click conversion rate, so it is not used to invent a cost per lead.
 *
 * A month is 30 days. A week is 7 days.
 */
import { BENCHMARK_HUB, BENCHMARK_META } from '../packs/benchmarks.js';
import { playbookCplBand } from './playbook.js';
import { tradeKey } from './feasibility.js';

export const MONTH_DAYS = 30;
export const WEEK_DAYS = 7;

export type BudgetPeriod = 'day' | 'month';
export type LeadPeriod = 'week' | 'month';
export type GoalChoiceId = 'keep_budget' | 'raise_budget';

/** Non-brand Google Search cost per lead, taken only from the benchmark file. */
interface BandSpec {
  key: string;
  /** Hub trade label for the CPL row. */
  hubTrade: string;
  low: number;
  typical: number;
  high: number;
  /** Each of these must be the row value or a $amount in that row's note. */
  cited: number[];
}

export const GOOGLE_SEARCH_BANDS: BandSpec[] = [
  { key: 'hvac', hubTrade: 'HVAC', low: 144, typical: 149, high: 198, cited: [144, 149, 198] },
  { key: 'plumbing', hubTrade: 'Plumbing', low: 168, typical: 183, high: 183, cited: [168, 183] },
  { key: 'roofing', hubTrade: 'Roofing', low: 124, typical: 124, high: 124, cited: [124] },
  { key: 'garage_door', hubTrade: 'Garage Door', low: 173, typical: 173, high: 173, cited: [173] },
  { key: 'electrical', hubTrade: 'Electrical', low: 128, typical: 163, high: 163, cited: [128, 163] },
];

export interface CplBand {
  key: string;
  label: string;
  low: number;
  typical: number;
  high: number;
  single: boolean;
  /** published = benchmark file. playbook = the planning band, not a Google Ads study. */
  source: 'published' | 'playbook';
}

export interface GoalCaps {
  daily: number | null;
  monthly: number | null;
}

export interface GoalChoice {
  id: GoalChoiceId;
  label: string;
  daily: number;
  leadGoal: number;
  leadPeriod: LeadPeriod;
  /** True only when this choice is higher than a cap the owner already saved. */
  raisesCap: boolean;
  monthly: number;
}

export interface GoalCheck {
  trade: string;
  city: string;
  verdict: string;
  likely: 'yes' | 'not_likely' | 'unknown';
  daily: number;
  budgetAmount: number;
  budgetPeriod: BudgetPeriod;
  leadGoal: number;
  leadPeriod: LeadPeriod;
  leads: { low: number; typical: number; high: number } | null;
  assumption: string;
  sourceLabel: string;
  cityNote: string;
  choices: GoalChoice[];
}

function plain(s: string): string {
  return s.replace(/\u2014/g, ', ').replace(/\u2013/g, '-').replace(/\s{2,}/g, ' ').trim();
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

function leadNoun(n: number, spread: boolean): string {
  return !spread && n === 1 ? 'lead' : 'leads';
}

function aboutLeads(low: number, high: number): string {
  if (low <= 0 && high <= 0) return 'about 0 leads';
  if (low === high) return `about ${low} ${leadNoun(low, false)}`;
  const a = Math.min(low, high);
  const b = Math.max(low, high);
  return `about ${a} to ${b} ${leadNoun(b, true)}`;
}

function periodPhrase(period: LeadPeriod): string {
  return period === 'week' ? 'a week' : 'a month';
}

export function periodDays(period: LeadPeriod): number {
  return period === 'week' ? WEEK_DAYS : MONTH_DAYS;
}

export function dailyFromBudget(amount: number, period: BudgetPeriod): number {
  if (!(amount > 0)) return 0;
  return period === 'month' ? amount / MONTH_DAYS : amount;
}

function roundDaily(n: number): number {
  if (!(n > 0)) return 0;
  return Math.max(1, Math.round(n));
}

function roundCount(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n);
}

function googleEntry(hubTrade: string) {
  const channel = BENCHMARK_HUB.find((c) => c.id === 'google_ads');
  return channel?.entries.find((e) => e.trade === hubTrade && e.metric === 'CPL' && e.value != null) ?? null;
}

function citedInRow(amount: number, value: number | null, note: string): boolean {
  if (value === amount) return true;
  return note.includes(`$${amount}`);
}

/**
 * National non-brand Google Ads cost per lead for a trade.
 * Returns null when the benchmark file has no row, or when a cited dollar
 * is no longer in that row (fail closed, never keep a stale number).
 */
export function nationalSearchCpl(trade: string): CplBand | null {
  const key = tradeKey(trade);
  const spec = GOOGLE_SEARCH_BANDS.find((row) => row.key === key);
  if (!spec) return null;
  const entry = googleEntry(spec.hubTrade);
  if (!entry) return null;
  const note = entry.note || '';
  if (!spec.cited.every((amount) => citedInRow(amount, entry.value, note))) return null;
  return {
    key: spec.key,
    label: spec.hubTrade,
    low: spec.low,
    typical: spec.typical,
    high: spec.high,
    single: spec.low === spec.high,
    source: 'published',
  };
}

/** Published Google Ads row when the benchmark file has one, otherwise the playbook band. */
export function cplBandForGoal(trade: string): CplBand | null {
  const published = nationalSearchCpl(trade);
  if (published) return published;
  const band = playbookCplBand(trade);
  if (!band) return null;
  const typical = Math.round((band.low + band.high) / 2);
  const label = band.key.charAt(0).toUpperCase() + band.key.slice(1);
  return {
    key: band.key,
    label,
    low: band.low,
    typical,
    high: band.high,
    single: band.low === band.high,
    source: 'playbook',
  };
}

function cityLine(tradeLabel: string, city: string, single: boolean): string {
  const place = city.trim();
  const what = single ? 'national figure' : 'national range';
  if (!place) return `No city is saved, so this uses the ${what} for ${tradeLabel}.`;
  return `No published cost per lead for ${tradeLabel} in ${place}. This uses the ${what}.`;
}

function assumptionFor(band: CplBand | null, tradeLabel: string, cityNote: string): string {
  if (!band) {
    return plain(`${cityNote} The published study has no Google Ads cost per lead for ${tradeLabel}, and the playbook has no band either. Miles will not guess one. Source: ${BENCHMARK_META.source}.`);
  }
  if (band.source === 'playbook') {
    const middle = band.single
      ? ''
      : ` The middle figure, ${money(band.typical)}, is the midpoint of ${money(band.low)} and ${money(band.high)}, not a separate published cost.`;
    const figures = band.single ? money(band.typical) : `${money(band.low)} to ${money(band.high)}`;
    return plain(`Cost per lead used here: ${figures}. That is the home services playbook band for ${tradeLabel}, not a published Google Ads study.${middle} ${cityNote} Source: home services playbook.`);
  }
  const source = `Source: ${BENCHMARK_META.source}.`;
  const figures = band.single
    ? `${money(band.typical)}`
    : `${money(band.low)}, ${money(band.typical)}, and ${money(band.high)}`;
  const spread = band.single
    ? `The published study lists one non-brand Google Ads figure for ${tradeLabel}, not a spread.`
    : `Those are the published non-brand Google Ads figures for ${tradeLabel}. The middle one is the figure the study lists for the trade.`;
  return plain(`Cost per lead used here: ${figures}. ${spread} ${cityNote} ${source}`);
}

export interface GoalInput {
  trade?: string;
  city?: string;
  budgetAmount?: number;
  budgetPeriod?: BudgetPeriod;
  leadGoal?: number;
  leadPeriod?: LeadPeriod;
  caps?: GoalCaps | null;
}

export function goalCheck(input: GoalInput): GoalCheck {
  const budgetPeriod: BudgetPeriod = input.budgetPeriod === 'month' ? 'month' : 'day';
  const leadPeriod: LeadPeriod = input.leadPeriod === 'week' ? 'week' : 'month';
  const budgetAmount = Number(input.budgetAmount) > 0 ? Number(input.budgetAmount) : 0;
  const leadGoal = Number(input.leadGoal) > 0 ? Math.round(Number(input.leadGoal)) : 0;
  const dailyExact = dailyFromBudget(budgetAmount, budgetPeriod);
  const daily = roundDaily(dailyExact);
  const trade = (input.trade || '').trim();
  const city = (input.city || '').trim();
  const band = trade ? cplBandForGoal(trade) : null;
  const tradeLabel = band?.label || trade || 'this trade';
  const place = city.trim();
  const cityNote = !band
    ? (place
      ? `No published cost per lead for ${tradeLabel} in ${place}, and the playbook has no band for ${tradeLabel} either.`
      : `No city is saved, and there is no Google Ads figure or playbook band for ${tradeLabel}.`)
    : band.source === 'playbook'
      ? (place
        ? `No published Google Ads cost per lead for ${tradeLabel} in ${place}. This uses the home services playbook band, not a city figure.`
        : `No city is saved. This uses the home services playbook band for ${tradeLabel}, not a city figure.`)
      : cityLine(tradeLabel, city, band.single);
  const caps = input.caps ?? { daily: null, monthly: null };
  const savedDaily = caps.daily != null && caps.daily > 0 ? caps.daily : null;
  const savedMonthly = caps.monthly != null && caps.monthly > 0 ? caps.monthly : null;
  const sourceLabel = band?.source === 'playbook' ? 'Home services playbook' : BENCHMARK_META.source;

  const base = {
    trade: tradeLabel,
    city,
    daily,
    budgetAmount,
    budgetPeriod,
    leadGoal,
    leadPeriod,
    sourceLabel,
    cityNote,
  };

  if (!(daily > 0) || !(leadGoal > 0)) {
    return {
      ...base,
      verdict: 'Enter a budget and how many leads you want.',
      likely: 'unknown',
      leads: null,
      assumption: assumptionFor(band, tradeLabel, cityNote),
      choices: [],
    };
  }

  if (!band) {
    const kept = savedDaily == null || daily <= savedDaily + 0.001 ? daily : roundDaily(savedDaily);
    return {
      ...base,
      verdict: plain(`Miles does not have a cost per lead for ${tradeLabel}, so it will not guess how many leads ${money(daily)}/day brings.`),
      likely: 'unknown',
      leads: null,
      assumption: assumptionFor(null, tradeLabel, cityNote),
      choices: [choiceOf('keep_budget', kept, leadGoal, leadPeriod, savedDaily, savedMonthly, `Use ${money(kept)}/day anyway. Miles will not guess a lead count.`)],
    };
  }

  const days = periodDays(leadPeriod);
  const per = periodPhrase(leadPeriod);
  const counts = (dollars: number) => {
    const periodBudget = dollars * days;
    return {
      low: roundCount(periodBudget / band.high),
      typical: roundCount(periodBudget / band.typical),
      high: roundCount(periodBudget / band.low),
    };
  };
  const leads = counts(dailyExact);
  const span = aboutLeads(leads.low, leads.high);
  const yes = leadGoal <= leads.high;
  const needed = roundDaily((leadGoal * band.typical) / days);
  const verdict = yes
    ? plain(`Yes, ${money(daily)}/day should bring ${span} ${per}.`)
    : plain(`Not likely. For ${leadGoal} ${leadNoun(leadGoal, false)} ${per} you would need about ${money(needed)}/day, or at ${money(daily)}/day expect ${span}.`);

  const keepDaily = savedDaily == null || daily <= savedDaily + 0.001 ? daily : roundDaily(savedDaily);
  const keepCounts = counts(keepDaily);
  const keepAtTyped = keepDaily === daily;
  const goalFits = leadGoal <= keepCounts.high;
  const keepGoal = goalFits ? leadGoal : (keepCounts.typical > 0 ? keepCounts.typical : keepCounts.high);
  const keepNoun = leadNoun(keepAtTyped && goalFits ? leadGoal : keepGoal, false);
  const keepLabel = goalFits && keepAtTyped
    ? `Keep ${money(daily)}/day and the goal of ${leadGoal} ${leadNoun(leadGoal, false)} ${per}`
    : goalFits
      ? `Keep the ${money(keepDaily)}/day cap and the goal of ${leadGoal} ${leadNoun(leadGoal, false)} ${per}`
      : keepAtTyped
        ? `Keep ${money(keepDaily)}/day and set the goal to ${keepGoal} ${keepNoun} ${per}`
        : `Keep the ${money(keepDaily)}/day cap and set the goal to ${keepGoal} ${keepNoun} ${per}`;

  const choices: GoalChoice[] = [
    choiceOf('keep_budget', keepDaily, keepGoal, leadPeriod, savedDaily, savedMonthly, keepLabel),
  ];

  const raiseDaily = leadGoal > keepCounts.high ? needed : 0;
  if (raiseDaily > 0 && raiseDaily !== keepDaily) {
    const over = savedDaily != null && raiseDaily > savedDaily + 0.001;
    const month = raiseDaily * MONTH_DAYS;
    const overMonth = savedMonthly != null && month > savedMonthly + 0.001;
    const label = over || overMonth
      ? `Raise my daily cap to ${money(raiseDaily)}${overMonth ? ` (${money(month)} a month)` : ''} to reach ${leadGoal} ${leadNoun(leadGoal, false)} ${per}`
      : `Raise the budget to ${money(raiseDaily)}/day to reach ${leadGoal} ${leadNoun(leadGoal, false)} ${per}`;
    choices.push(choiceOf('raise_budget', raiseDaily, leadGoal, leadPeriod, savedDaily, savedMonthly, plain(label)));
  }

  return {
    ...base,
    verdict,
    likely: yes ? 'yes' : 'not_likely',
    leads,
    assumption: assumptionFor(band, tradeLabel, cityNote),
    choices,
  };
}

function choiceOf(
  id: GoalChoiceId,
  daily: number,
  leadGoal: number,
  leadPeriod: LeadPeriod,
  savedDaily: number | null,
  savedMonthly: number | null,
  label: string,
): GoalChoice {
  const monthly = Math.max(savedMonthly ?? 0, daily * MONTH_DAYS);
  const raisesCap = (savedDaily != null && daily > savedDaily + 0.001)
    || (savedMonthly != null && savedMonthly > 0 && daily * MONTH_DAYS > savedMonthly + 0.001);
  return {
    id,
    label: plain(label),
    daily,
    leadGoal,
    leadPeriod,
    raisesCap,
    monthly,
  };
}

/** The choice Miles will apply. A keep choice never comes back above the saved cap. */
export function choiceById(check: GoalCheck, id: GoalChoiceId): GoalChoice | null {
  return check.choices.find((choice) => choice.id === id) ?? null;
}

export const LAUNCH_LINE = 'Miles will build and launch Google Search for you.';
