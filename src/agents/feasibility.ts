/**
 * Budget divided by leads per day, compared with Searchlight when a row exists.
 * A missing row stays missing. The home-services pack is a playbook, not a
 * measured Google Ads cost per lead.
 */
import { BENCHMARK_HUB } from '../packs/benchmarks.js';
import { homeServicesPack } from '../packs/homeServices.js';
import { seasonFocus } from './contractorloop.js';
import { deriveServiceLines } from './campaign.js';

export interface PlaybookCard {
  title: string;
  pack: string;
  trade: string;
  season: string;
  services: string[];
  /** What the pack would do, and what Miles can actually run. */
  splitNote: string;
  suggestedGoogleShare: number;
  benchmarkCpl: number | null;
  benchmarkNote: string;
}

export function tradeKey(trade: string): string {
  const t = trade.toLowerCase();
  const hit = homeServicesPack.categories.find((c) => t.includes(c.id) || t.includes(c.label.toLowerCase()));
  return hit?.id ?? '';
}

/** Searchlight Google Ads CPL for a trade, or null when the file has no row. */
export function searchlightGoogleCpl(trade: string): { value: number; note: string } | null {
  const channel = BENCHMARK_HUB.find((c) => c.id === 'google_ads');
  const key = (tradeKey(trade) || trade).toLowerCase();
  const rows = (channel?.entries ?? []).filter((e) => e.metric === 'CPL' && e.value != null);
  const row = rows.find((e) => e.trade.toLowerCase() === key);
  if (!row || row.value == null) return null;
  return { value: row.value, note: row.note || 'Searchlight Google Ads benchmark' };
}

export function playbookCard(trade: string, now = new Date()): PlaybookCard {
  const key = tradeKey(trade);
  const label = homeServicesPack.categories.find((c) => c.id === key)?.label || trade || 'Home services';
  const season = key ? seasonFocus(key, now.getMonth()) : { line: '', note: 'No seasonal shift is loaded for this trade.' };
  const bench = searchlightGoogleCpl(label);
  return {
    title: `Running the ${label.toLowerCase()} playbook`,
    pack: homeServicesPack.label,
    trade: label,
    season: season.note,
    services: deriveServiceLines(season.line, label),
    suggestedGoogleShare: 1,
    splitNote: 'The home services playbook would put most of a small budget on Local Services Ads, then Search. Miles cannot create Local Services Ads or Meta campaigns yet, so the budget you can actually run is Google Search. Any share you assign to other channels stays a plan until a create action exists.',
    benchmarkCpl: bench?.value ?? null,
    benchmarkNote: bench
      ? `Searchlight Google Ads cost per lead for ${label}: $${bench.value}. ${bench.note}`
      : `Searchlight has no Google Ads cost-per-lead row for ${label}. Miles will not invent one. The home services pack median ($${homeServicesPack.economics.cpaBenchmark.median}) is a planning range for the vertical, not a measured result for this trade.`,
  };
}

export interface Feasibility {
  requiredCpl: number | null;
  benchmarkCpl: number | null;
  realistic: 'unknown' | 'unlikely' | 'in_range';
  message: string;
  playbook: PlaybookCard;
}

export function feasibility(args: { dailyBudget: number; leadsPerDay: number; trade: string; now?: Date }): Feasibility {
  const playbook = playbookCard(args.trade, args.now);
  const leads = args.leadsPerDay;
  const required = leads > 0 && args.dailyBudget > 0 ? Math.round((args.dailyBudget / leads) * 100) / 100 : null;
  if (required == null) {
    return { requiredCpl: null, benchmarkCpl: playbook.benchmarkCpl, realistic: 'unknown', playbook, message: 'Set a daily budget and how many leads you want per day.' };
  }
  if (playbook.benchmarkCpl == null) {
    return {
      requiredCpl: required,
      benchmarkCpl: null,
      realistic: 'unknown',
      playbook,
      message: `At $${args.dailyBudget} a day and ${leads} lead${leads === 1 ? '' : 's'} a day, the math needs about $${required} per lead. ${playbook.benchmarkNote} This is not a guarantee of leads.`,
    };
  }
  const unlikely = required < playbook.benchmarkCpl * 0.5;
  return {
    requiredCpl: required,
    benchmarkCpl: playbook.benchmarkCpl,
    realistic: unlikely ? 'unlikely' : 'in_range',
    playbook,
    message: unlikely
      ? `At $${args.dailyBudget} a day and ${leads} lead${leads === 1 ? '' : 's'} a day, the math needs about $${required} per lead. Searchlight's Google Ads figure for this trade is $${playbook.benchmarkCpl}. That target is well below the benchmark, so those leads are not a reasonable expectation. You can still run a paused, or in-cap, Search campaign. This is not a guarantee.`
      : `At $${args.dailyBudget} a day and ${leads} lead${leads === 1 ? '' : 's'} a day, the math needs about $${required} per lead. Searchlight's Google Ads figure for this trade is $${playbook.benchmarkCpl}. Being near the benchmark is not a promise of leads.`,
  };
}
