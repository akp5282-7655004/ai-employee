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

// ── Benchmark Hub — every channel × trade × metric SearchLight publishes ──
// Modeled on searchlightdigital.io/benchmark-hub. Cells we can source from the LSA
// benchmark already in this file are filled with REAL numbers; cells that live in a
// SearchLight article we haven't ingested carry value:null and link to the source,
// so the hub is honest — a real number or an explicit "add from source", never a
// fabricated figure.

export interface HubEntry {
  trade: string;
  /** 'CPL' | 'ROAS' | 'ROI' | 'Book Rate' | 'Cost/Customer' | 'Insight' … */
  metric: string;
  /** The benchmark value, or null when it still needs to be sourced from the article. */
  value: number | null;
  unit: 'usd' | 'x' | 'pct' | '';
  /** The SearchLight article this figure comes from (or should be read from). */
  source: string;
  note?: string;
}

export interface HubChannel {
  id: string;
  channel: string;
  blurb: string;
  entries: HubEntry[];
}

const SL = 'https://searchlightdigital.io/';

/**
 * Assemble the hub from SearchLight's published home-services benchmarks. Every
 * value is a real, sourced figure (period + sample noted per channel); each cell
 * links to the article it came from.
 */
export function buildBenchmarkHub(): HubChannel[] {
  const lsa: HubEntry[] = [
    { trade: 'All Trades', metric: 'CPL', value: LSA_BLENDED.cpl, unit: 'usd', source: SL + 'google-local-service-ads-cost-per-lead/', note: `Book rate ${LSA_BLENDED.bookRate}% · cost/customer $${LSA_BLENDED.costPerCustomer} · ROAS ${LSA_BLENDED.roas}x` },
  ];
  for (const t of LSA_TRADES) {
    const roasSrc = t.trade === 'HVAC' ? SL + 'what-is-a-good-roas-for-hvac-local-services-ads/' : SL + 'google-local-service-ads-cost-per-lead/';
    const small = t.accounts < 25 ? ' · directional (small sample, not statistically robust)' : '';
    lsa.push({ trade: t.trade, metric: 'CPL', value: t.cpl, unit: 'usd', source: SL + 'google-local-service-ads-cost-per-lead/', note: `Feb 2026 · ${t.accounts} accts · book rate ${t.bookRate}% · avg ticket $${t.avgTicket.toLocaleString()}${small}` });
    lsa.push({ trade: t.trade, metric: 'ROAS', value: t.roas, unit: 'x', source: roasSrc, note: t.trade === 'HVAC' ? 'Feb 2026 spend-weighted trade aggregate · dedicated HVAC LSA ROAS page reports 6.90x account median (Q4 2025)' : `Feb 2026 spend-weighted · ${t.accounts} accts${small}` });
  }
  // Roofing & garage-door LSA — now sourced from their dedicated living benchmarks.
  lsa.push({ trade: 'Roofing', metric: 'CPL', value: 79, unit: 'usd', source: SL + 'roofing-google-lsa-cost-per-lead/', note: 'Q1 2026 · median $72 · 37% cheaper than Google Ads' });
  lsa.push({ trade: 'Roofing', metric: 'ROAS', value: 4.82, unit: 'x', source: SL + 'roofing-google-lsa-cost-per-lead/' });
  lsa.push({ trade: 'Garage Door', metric: 'CPL', value: 49, unit: 'usd', source: SL + 'garage-door-google-lsa-cost-per-lead/', note: 'Jan–Apr 2026 · book rate 38% · cost/customer $198' });
  lsa.push({ trade: 'Garage Door', metric: 'ROAS', value: 5.78, unit: 'x', source: SL + 'what-is-a-good-roas-for-garage-door-local-services-ads/', note: 'Median 7.8x account-level' });

  return [
    {
      id: 'google_ads',
      channel: 'Google Ads',
      blurb: 'Search & PMax cost-per-lead and ROAS by trade (non-branded).',
      entries: [
        { trade: 'HVAC & Plumbing', metric: 'CPL', value: 104, unit: 'usd', source: SL + 'what-is-a-good-cost-per-lead-for-hvac-google-ads/', note: 'Blended · Jan 2026 · 816 HVAC+plumbing contractors (NOT all trades) · non-branded $149 · branded $34 · PMax $72' },
        { trade: 'HVAC', metric: 'CPL', value: 149, unit: 'usd', source: SL + 'what-is-a-good-cost-per-lead-for-hvac-google-ads/', note: 'Non-branded · HVAC-general $198 · heating-repair $144' },
        { trade: 'Plumbing', metric: 'CPL', value: 183, unit: 'usd', source: SL + 'plumbing-google-ads-cost-per-lead/', note: 'Non-branded · PMax $82 · median acct $168 · HVAC&plumbing benchmark (Jan 2026, 404 accts) reads $167, 41.5% book, $2,208 ticket, 2.72x' },
        { trade: 'Roofing', metric: 'CPL', value: 124, unit: 'usd', source: SL + 'roofing-google-ads-cost-per-lead/', note: 'Non-branded · branded $44 · PMax $64' },
        { trade: 'Garage Door', metric: 'CPL', value: 173, unit: 'usd', source: SL + 'garage-door-google-ads-cost-per-lead/', note: 'Non-branded · blended $145 · branded $66' },
        { trade: 'Electrical', metric: 'CPL', value: 163, unit: 'usd', source: SL + 'what-is-a-good-cost-per-lead-for-hvac-google-ads/', note: 'Non-branded · Jan 2026 · 173 accts · book rate 41.2% · avg ticket $2,491 · ROAS 2.92x · newer Q1 2026 comparison reports $128 (271 accts)' },
        { trade: 'HVAC', metric: 'ROAS', value: 4.37, unit: 'x', source: SL + 'what-is-a-good-roas-for-hvac-google-ads', note: 'Blended MEDIAN · top quartile 10.24x · non-branded 2.95x is spend-weighted (non-brand account median just 0.99x — methods differ)' },
        { trade: 'Garage Door', metric: 'ROAS', value: 3.51, unit: 'x', source: SL + 'what-is-a-good-roas-for-garage-door-google-ads/', note: 'Blended · median 2.90x · top quartile 11.37x' },
      ],
    },
    { id: 'lsa', channel: 'Google Local Service Ads', blurb: 'Google Guaranteed — the lowest cost-per-lead channel in home services (Feb 2026, 888 contractors).', entries: lsa },
    { id: 'facebook', channel: 'Facebook Ads', blurb: 'Meta / Facebook closed-revenue ROAS (Q4 2025, 262 advertisers).', entries: [{ trade: 'HVAC', metric: 'ROAS', value: 1.65, unit: 'x', source: SL + 'what-is-a-good-roas-for-hvac-facebook-ads/', note: 'Closed · top quartile 5.17x · ROAS-potential 7.32x' }] },
    { id: 'direct_mail', channel: 'Direct Mail', blurb: 'Print & EDDM weighted closed ROAS (Q1 2026, MSI Direct — small sample).', entries: [{ trade: 'HVAC', metric: 'Closed ROAS', value: 5.9, unit: 'x', source: SL + 'what-is-a-good-roi-for-hvac-direct-mail/', note: 'Weighted closed ROAS, call-tracking · n=11 contractors · 12.2x with address-match · median 8.3x. Not profit-based ROI; address-match does not prove causation.' }] },
    { id: 'seo', channel: 'SEO', blurb: 'Organic search attributed-revenue multiple (Q4 2025, ~1,000 companies).', entries: [{ trade: 'HVAC', metric: 'Revenue multiple', value: 27.46, unit: 'x', source: SL + 'hvac-seo/', note: 'Attributed revenue ÷ SEO fees — a revenue multiple, NOT profit ROI (excludes fulfillment/overhead) · median · bottom quartile 12.83x · top 60.54x · ~$3,604/mo' }] },
    {
      id: 'ai',
      channel: 'AI',
      blurb: 'AI ad channels and AI lead-grading performance (2026).',
      entries: [
        { trade: 'ChatGPT Ads', metric: 'Book Rate', value: 33.9, unit: 'pct', source: SL + 'chatgpt-ads-home-services-benchmarks/', note: 'Paid · tiny sample: 117 leads across 20 contractors over 2 months · no reliable CPL/CAC/ROAS (attribution depends on tagging) · organic ChatGPT books 42.3%' },
        { trade: 'AI Lead Grading', metric: 'Accuracy', value: 98, unit: 'pct', source: SL + 'ai-lead-grading-benchmark-home-services/', note: 'Vendor-run: ClaraT is SearchLight’s own model · only 1,500 of 6,000 transcripts fully human-labeled (rest AI-labeled w/ review) · best general LLM ~90%' },
      ],
    },
    {
      id: 'lead_quality',
      channel: 'Lead Quality',
      blurb: 'How many leads actually book — neutrally graded (2026).',
      entries: [
        { trade: 'Qualified · on-call', metric: 'Book Rate', value: 58, unit: 'pct', source: SL + 'book-rate-benchmarks-home-services/', note: 'Qualified conversions booked during the call' },
        { trade: 'Qualified · eventual', metric: 'Book Rate', value: 74, unit: 'pct', source: SL + 'book-rate-benchmarks-home-services/', note: 'Qualified, ever booked (incl. follow-up)' },
        { trade: 'All leads · raw', metric: 'Book Rate', value: 22, unit: 'pct', source: SL + 'book-rate-benchmarks-home-services/', note: "Every conversion at the call — the marketer's number" },
      ],
    },
  ];
}

export const BENCHMARK_HUB = buildBenchmarkHub();

/** Count of sourced vs. total benchmark cells across the hub. */
export function hubCoverage(hub: HubChannel[] = BENCHMARK_HUB): { sourced: number; total: number } {
  let sourced = 0;
  let total = 0;
  for (const c of hub) for (const e of c.entries) { total++; if (e.value != null) sourced++; }
  return { sourced, total };
}

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
