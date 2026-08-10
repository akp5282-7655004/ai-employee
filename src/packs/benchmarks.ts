/**
 * Real, observed Local Service Ads economics — the SearchLight Home Services LSA
 * Benchmark (Feb 2026: 888 contractors, 1,774 campaigns, $6.72M tracked LSA spend,
 * 126,650 leads, $52.7M closed revenue). Miles uses this to ground its CPL guidance
 * in observed data, not estimates, and to compute the metric that actually matters:
 * whether a cost-per-lead produces profitable customers (breakeven CPL).
 *
 * Source: SearchLight Home Services LSA Benchmark, February 2026. Spend-weighted.
 */

export interface TradeBenchmark {
  trade: string;
  /** Observed cost per lead ($). */
  cpl: number;
  accounts: number;
  /** Tracked spend, in thousands of dollars. */
  spendK: number;
  /** Share of leads that become a booked appointment (%). */
  bookRate: number;
  /** Revenue per paying customer ($). */
  avgTicket: number;
  /** Closed return on ad spend (revenue ÷ spend). */
  roas: number;
}

export const LSA_TRADES: TradeBenchmark[] = [
  { trade: 'Electrical', cpl: 39, accounts: 112, spendK: 335, bookRate: 43.4, avgTicket: 1434, roas: 8.52 },
  { trade: 'HVAC', cpl: 51, accounts: 409, spendK: 1520, bookRate: 44.0, avgTicket: 2110, roas: 9.55 },
  { trade: 'General / All Trades', cpl: 54, accounts: 464, spendK: 2510, bookRate: 43.9, avgTicket: 1831, roas: 7.84 },
  { trade: 'Plumbing', cpl: 57, accounts: 230, spendK: 2030, bookRate: 44.5, avgTicket: 1714, roas: 6.85 },
  { trade: 'Drain / Sewer', cpl: 59, accounts: 23, spendK: 314, bookRate: 39.5, avgTicket: 1521, roas: 5.5 },
  { trade: 'Water Heater', cpl: 71, accounts: 2, spendK: 15, bookRate: 35.0, avgTicket: 2484, roas: 5.13 },
];

export const LSA_BLENDED = {
  cpl: 53,
  bookRate: 43.9,
  matchRate: 42.8,
  avgTicket: 1826,
  roas: 7.84,
  costPerCustomer: 233,
};

/** LSA vs. Google Ads (Jan 2026 companion benchmark), for the channel comparison. */
export const LSA_VS_GOOGLE = [
  { metric: 'Cost Per Lead', lsa: '$53', google: '$104', googleNonBrand: '$149' },
  { metric: 'Book Rate', lsa: '43.9%', google: '41.7%', googleNonBrand: '37.6%' },
  { metric: 'Match Rate', lsa: '42.8%', google: '48.4%', googleNonBrand: '42.1%' },
  { metric: 'Cost / Customer', lsa: '$233', google: '$472', googleNonBrand: '$804' },
  { metric: 'Avg Ticket', lsa: '$1,826', google: '$2,465', googleNonBrand: '$2,516' },
];

export const BENCHMARK_META = {
  source: 'SearchLight Home Services LSA Benchmark',
  period: 'February 2026',
  contractors: 888,
  spend: 6_720_000,
  leads: 126_650,
};

export interface Profitability {
  /** Fraction of leads that become paying customers (book × match), as a %. */
  leadToCustomerPct: number;
  /** Total spend ÷ paying customers. */
  costPerCustomer: number;
  /** Gross profit on one job at the given margin. */
  profitPerJob: number;
  /** The highest CPL that still breaks even on the first job. */
  breakevenCpl: number;
  /** First-job return on ad spend at this CPL. */
  roas: number;
  /** Whether the given CPL is profitable, tight, or unprofitable. */
  verdict: 'profitable' | 'tight' | 'unprofitable';
}

/**
 * The article's core math. A lead is only worth its price if enough leads become
 * paying customers at a high enough ticket to clear your margin. Breakeven CPL =
 * profit-per-job × (book rate × match rate).
 */
export function profitability(
  cpl: number,
  avgTicket: number,
  bookRatePct: number,
  matchRatePct: number,
  marginPct: number,
): Profitability {
  const leadToCustomer = (bookRatePct / 100) * (matchRatePct / 100);
  const profitPerJob = Math.round(avgTicket * (marginPct / 100));
  const breakevenCpl = Math.round(profitPerJob * leadToCustomer);
  const costPerCustomer = leadToCustomer > 0 ? Math.round(cpl / leadToCustomer) : 0;
  const roas = costPerCustomer > 0 ? Math.round((avgTicket / costPerCustomer) * 100) / 100 : 0;
  const verdict: Profitability['verdict'] =
    cpl <= breakevenCpl * 0.85 ? 'profitable' : cpl <= breakevenCpl ? 'tight' : 'unprofitable';
  return {
    leadToCustomerPct: Math.round(leadToCustomer * 1000) / 10,
    costPerCustomer,
    profitPerJob,
    breakevenCpl,
    roas,
    verdict,
  };
}
