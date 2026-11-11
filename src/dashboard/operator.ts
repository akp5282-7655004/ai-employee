/**
 * Operator dashboard view model.
 *
 * The home screen renders this payload. Numbers are tagged sample or left
 * empty. Disconnected channels are not given jobs or spend. Goals come from
 * saved setup. The published LSA benchmark is a reference, never "your" result.
 */
import type { Recommendation } from '../agents/recommend.js';
import type { MilesMode } from '../agents/policy.js';
import { BENCHMARK_META, LSA_BLENDED } from '../packs/benchmarks.js';

export const MODE_PILLS: { id: MilesMode; label: string }[] = [
  { id: 'manual', label: 'Ask me first' },
  { id: 'hybrid', label: 'Hybrid' },
  { id: 'automate', label: 'Do everything' },
];

export function modeFromPill(label: string): MilesMode | null {
  const hit = MODE_PILLS.find((p) => p.label.toLowerCase() === label.trim().toLowerCase());
  return hit?.id ?? null;
}

export interface OperatorMetric {
  key: string;
  value: number;
  prior_value: number;
  source: 'live' | 'sample';
}

export interface OperatorCampaign {
  platform: string;
  name: string;
  spend: number;
  leads: number;
}

export interface OperatorInput {
  mode: MilesMode | null;
  trade: string;
  market: string;
  /** Saved daily cap. Null when the owner has not saved a plan. */
  dailyBudget: number | null;
  maxChangePct: number | null;
  leadsPerDay: number | null;
  /** Saved cost-per-job goal from the profile. Null when unset. */
  targetCpa: number | null;
  /** Preview connector. Campaign rows from it are examples, not a live account. */
  sampleConnector: boolean;
  google: { oauth: boolean; ready: boolean; note: string };
  ghlConnected: boolean;
  ghlDetail: string;
  socialConnected: boolean;
  gbpConnected: boolean;
  gbpHasData: boolean;
  paused: boolean;
  hasBundle: boolean;
  playbook: { title: string; season: string; splitNote: string } | null;
  reviewOn: boolean;
  speedOn: boolean;
  metrics: OperatorMetric[];
  campaigns: OperatorCampaign[];
  recommendations: Recommendation[];
  inbox: { id: string; title: string; reason: string }[];
}

export interface OperatorDecision {
  id: string;
  title: string;
  detail: string;
  impact: string | null;
  kind: 'recommendation' | 'inbox';
  canSkip: boolean;
  rec?: Recommendation;
}

export interface OperatorChannel {
  id: string;
  name: string;
  state: 'live' | 'sample' | 'empty' | 'later' | 'hold';
  grade: string | null;
  cost: string | null;
  jobs: string | null;
  foot: string;
  verdict: string;
}

export interface OperatorView {
  mode: MilesMode | null;
  modes: { id: MilesMode; label: string }[];
  paused: boolean;
  setupLine: string;
  sampleLegend: string;
  onTrack: {
    headline: string;
    bookedLabel: string;
    bookedValue: string;
    bookedGoal: string | null;
    bookedSample: boolean;
    bookedBar: number | null;
    costLabel: string;
    costValue: string;
    costGoal: string | null;
    costSample: boolean;
    costBar: number | null;
    explain: string;
    action: { title: string; body: string; decisionId: string } | null;
  };
  money: {
    tone: 'positive' | 'negative' | 'sample' | 'unknown';
    headline: string;
    vs: string;
    tiles: { label: string; value: string; sub: string; delta: string | null; sample: boolean }[];
  };
  compare: {
    headline: string;
    badge: string;
    sub: string;
    sourceLine: string;
    rows: { measure: string; hint: string; you: string; benchmark: string; verdict: string }[];
  };
  decisions: OperatorDecision[];
  playbooks: {
    id: string;
    eyebrow: string;
    outcome: string;
    title: string;
    body: string;
    budget: string;
    runnable: boolean;
    runKind: 'google_plan' | 'review' | 'speed' | 'unavailable';
  }[];
  playbookNote: string;
  channels: OperatorChannel[];
  breakdown: {
    sample: boolean;
    empty: string | null;
    note: string;
    rows: { name: string; spend: string; leads: string; jobs: string; cost: string; status: string | null }[];
  };
  connections: { name: string; state: 'on' | 'off' | 'hold' | 'later'; detail: string }[];
}

function plain(s: string): string {
  return s
    .replace(/\u2014/g, ' - ')
    .replace(/\u2013/g, '-')
    .replace(/searchlight\s*digital/gi, 'the published study')
    .replace(/searchlight/gi, 'the published study')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

function metricOf(metrics: OperatorMetric[], key: string): OperatorMetric | undefined {
  return metrics.find((m) => m.key === key);
}

function pos(n: number | null | undefined): number | null {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}

function deltaOf(m: OperatorMetric | undefined): string | null {
  if (!m || !m.prior_value) return null;
  const pct = Math.round(((m.value - m.prior_value) / Math.abs(m.prior_value)) * 100);
  if (!Number.isFinite(pct)) return null;
  if (pct === 0) return '0% vs prior';
  return `${pct > 0 ? '+' : ''}${pct}% vs prior`;
}

function impactOf(text: string): string | null {
  const m = text.match(/\$[\d,]+(?:\.\d+)?/);
  return m ? m[0] : null;
}

function statusFor(spend: number, leads: number, target: number | null): string | null {
  if (spend <= 0 && leads <= 0) return null;
  if (leads <= 0) return 'Losing';
  if (target && spend / leads <= target) return 'Winning';
  if (target && spend / leads > target * 1.5) return 'Losing';
  return 'OK';
}

/** Shared setup status line for Dashboard, Launch, and Your Business. */
export function formatSetupLine(input: { trade: string; market: string; dailyBudget: number | null; maxChangePct: number | null }): string {
  const trade = input.trade.trim();
  const market = input.market.trim();
  const bits: string[] = [];
  if (trade) bits.push(trade);
  if (market) bits.push(market);
  bits.push('Google Search');
  const daily = typeof input.dailyBudget === 'number' && Number.isFinite(input.dailyBudget) && input.dailyBudget > 0
    ? Math.round(input.dailyBudget)
    : null;
  if (daily) bits.push(`${money(daily)}/day`);
  if (input.maxChangePct != null && Number.isFinite(input.maxChangePct)) bits.push(`${input.maxChangePct}% max daily change`);
  const line = !trade && !market && !daily
    ? 'Google Search only. Add a trade, market, and daily budget in Profile. Meta, TikTok, and Local Services Ads are coming later.'
    : bits.join(' · ');
  return plain(line);
}

function setupLine(input: OperatorInput): string {
  return formatSetupLine({
    trade: input.trade,
    market: input.market,
    dailyBudget: pos(input.dailyBudget),
    maxChangePct: input.maxChangePct,
  });
}

function decisionsOf(input: OperatorInput): OperatorDecision[] {
  const inbox = input.inbox.map((item) => ({
    id: item.id,
    title: plain(item.title),
    detail: plain(item.reason),
    impact: impactOf(`${item.title} ${item.reason}`),
    kind: 'inbox' as const,
    canSkip: false,
  }));
  const recs = input.recommendations.map((rec) => ({
    id: rec.id,
    title: plain(rec.title),
    detail: plain(rec.why || rec.action || ''),
    impact: impactOf(`${rec.title} ${rec.why} ${rec.action}`),
    kind: 'recommendation' as const,
    canSkip: true,
    rec,
  }));
  return [...inbox, ...recs];
}

function onTrack(input: OperatorInput, decisions: OperatorDecision[]): OperatorView['onTrack'] {
  const leadsPerDay = pos(input.leadsPerDay);
  const monthlyLeads = leadsPerDay ? Math.round(leadsPerDay * 30) : null;
  const target = pos(input.targetCpa);
  const booked = metricOf(input.metrics, 'crm.booked_jobs');
  const cost = metricOf(input.metrics, 'calc.cost_per_booked');
  const bookedSample = !booked || booked.source !== 'live';
  const costSample = !cost || cost.source !== 'live';
  const bookedValue = booked ? String(Math.round(booked.value)) : 'n/a';
  const costValue = cost ? money(cost.value) : 'n/a';
  const parts: string[] = [];
  if (monthlyLeads && leadsPerDay) {
    parts.push(`Your saved goal is ${leadsPerDay} lead${leadsPerDay === 1 ? '' : 's'} a day, about ${monthlyLeads} leads a month. That is a lead goal, not a booked-job target.`);
  } else {
    parts.push('No monthly job goal is saved. Miles will not invent one.');
  }
  if (target) parts.push(`Your saved cost goal is ${money(target)} per job.`);
  else parts.push('No cost-per-job goal is saved.');
  if (bookedSample) parts.push('The booked-job count here is an example until your CRM connects.');
  if (costSample) parts.push('Cost per booked job is an example until ad spend and booked jobs are both live.');

  let headline = 'Add a goal to track this.';
  if (monthlyLeads && !bookedSample && booked) {
    const gap = monthlyLeads - Math.round(booked.value);
    headline = gap > 0
      ? `${Math.round(booked.value)} booked jobs. Your lead goal is ${monthlyLeads} a month.`
      : `${Math.round(booked.value)} booked jobs, at or above your ${monthlyLeads} lead goal.`;
  } else if (monthlyLeads) {
    headline = 'Goal saved. The job count is not live yet.';
  } else if (!bookedSample && booked) {
    headline = `${Math.round(booked.value)} booked jobs. No lead goal is saved.`;
  }

  const first = decisions[0];
  return {
    headline: plain(headline),
    bookedLabel: 'Booked jobs',
    bookedValue,
    bookedGoal: monthlyLeads ? `${monthlyLeads} lead goal` : null,
    bookedSample,
    bookedBar: booked && monthlyLeads ? Math.max(0, Math.min(100, (booked.value / monthlyLeads) * 100)) : null,
    costLabel: 'Cost per booked job',
    costValue,
    costGoal: target ? `under ${money(target)} goal` : null,
    costSample,
    costBar: cost && target ? Math.max(0, Math.min(100, (Math.min(cost.value, target) / target) * 100)) : null,
    explain: plain(parts.join(' ')),
    action: first
      ? { title: first.title, body: first.detail, decisionId: first.id }
      : null,
  };
}

function moneyBlock(input: OperatorInput): OperatorView['money'] {
  const rev = metricOf(input.metrics, 'crm.job_revenue');
  const spend = metricOf(input.metrics, 'calc.blended_spend');
  const leads = metricOf(input.metrics, 'calc.blended_leads');
  const booked = metricOf(input.metrics, 'crm.booked_jobs');
  const livePair = !!(rev && spend && rev.source === 'live' && spend.source === 'live' && spend.value > 0);
  const per = livePair && rev && spend ? rev.value / spend.value : (rev && spend && spend.value > 0 ? rev.value / spend.value : null);
  const perText = per == null ? null : (per >= 100 ? money(per) : `$${per.toFixed(2).replace(/\.00$/, '')}`);
  let tone: OperatorView['money']['tone'] = 'unknown';
  let headline = 'Not enough live revenue and spend to say if you are making money.';
  if (perText && livePair) {
    tone = per! >= 1 ? 'positive' : 'negative';
    headline = per! >= 1
      ? `${perText} back for every $1 you spend`
      : `${perText} back for every $1 you spend. Marketing revenue is under the ad spend.`;
  } else if (perText) {
    tone = 'sample';
    headline = `SAMPLE. Example math: ${perText} back for every $1 in these example numbers.`;
  }
  const tile = (label: string, m: OperatorMetric | undefined, sub: string, format: (n: number) => string) => ({
    label,
    value: m ? format(m.value) : 'n/a',
    sub,
    delta: m && m.source === 'live' ? null : deltaOf(m),
    sample: !m || m.source !== 'live',
  });
  const netSample = !rev || !spend || rev.source !== 'live' || spend.source !== 'live';
  const net = rev && spend ? rev.value - spend.value : null;
  return {
    tone,
    headline: plain(headline),
    vs: 'vs. prior period',
    tiles: [
      tile('Revenue from marketing', rev, booked && booked.source === 'live' ? `${Math.round(booked.value)} booked jobs in your CRM` : 'Booked-job count is not live', money),
      tile('Marketing cost', spend, 'Ad spend only. A Miles fee is not added here.', money),
      {
        label: 'Revenue minus cost',
        value: net == null ? 'n/a' : `${net >= 0 ? '+' : '-'}${money(Math.abs(net))}`,
        sub: 'Before job costs',
        delta: null,
        sample: netSample,
      },
      tile('Leads', leads, leads && leads.source === 'live' && booked && booked.source === 'live' && leads.value > 0 ? `${Math.round((booked.value / leads.value) * 100)}% became booked jobs` : 'Share that book is shown when both counts are live', (n) => Math.round(n).toLocaleString('en-US')),
    ],
  };
}

function compareBlock(): OperatorView['compare'] {
  const cpl = LSA_BLENDED.cpl;
  const roas = LSA_BLENDED.roas;
  const revPerLead = Math.round(roas * cpl);
  const spend = BENCHMARK_META.spend >= 1_000_000
    ? `$${(BENCHMARK_META.spend / 1_000_000).toFixed(2).replace(/\.00$/, '')}M`
    : money(BENCHMARK_META.spend);
  return {
    headline: 'Not graded yet',
    badge: 'Not connected',
    sub: 'Local Services Ads are not connected, so Miles will not grade you against this benchmark.',
    sourceLine: plain(`${BENCHMARK_META.source}. ${BENCHMARK_META.period}. ${BENCHMARK_META.contractors.toLocaleString('en-US')} contractors. ${spend} tracked spend. ${BENCHMARK_META.leads.toLocaleString('en-US')} leads. Not your account.`),
    rows: [
      { measure: 'LSA cost per lead', hint: 'Lower is better', you: 'n/a', benchmark: money(cpl), verdict: 'Not connected' },
      { measure: 'LSA revenue per lead', hint: 'Published return times cost per lead. Higher is better.', you: 'n/a', benchmark: money(revPerLead), verdict: 'Not connected' },
      { measure: 'LSA revenue per $1 of ads', hint: 'Higher is better', you: 'n/a', benchmark: `${roas}x`, verdict: 'Not connected' },
      { measure: 'Cost per lead, all paid channels', hint: 'Compared with the published LSA cost per lead', you: 'n/a', benchmark: money(cpl), verdict: 'Not connected' },
    ],
  };
}

function playbooksOf(input: OperatorInput): OperatorView['playbooks'] {
  const daily = pos(input.dailyBudget);
  const season = plain(input.playbook?.season || 'No seasonal shift is loaded until a trade is saved.');
  const split = plain(input.playbook?.splitNote || 'Run starts the saved Google Search plan and still follows your mode. Local Services Ads and Meta are not launched.');
  return [
    {
      id: 'google-search',
      eyebrow: 'Google Search',
      outcome: 'No promised job count',
      title: plain(input.playbook?.title || 'Google Search plan'),
      body: `${season} ${split}`.trim(),
      budget: daily ? `${money(daily)}/day saved cap` : 'No daily budget saved',
      runnable: input.hasBundle,
      runKind: 'google_plan',
    },
    {
      id: 'review',
      eyebrow: 'Reputation',
      outcome: input.reviewOn ? 'On' : 'Off',
      title: 'Review requests',
      body: 'Texts a review ask after a completed job when this is on and GoHighLevel can send. Miles does not invent how many jobs are waiting.',
      budget: 'No ad spend',
      runnable: true,
      runKind: 'review',
    },
    {
      id: 'speed',
      eyebrow: 'Speed to lead',
      outcome: input.speedOn ? 'On' : 'Off',
      title: 'Speed-to-lead',
      body: 'Texts and emails a new lead when this is on and GoHighLevel is connected. It does not launch ads.',
      budget: 'No ad spend',
      runnable: true,
      runKind: 'speed',
    },
    {
      id: 'later',
      eyebrow: 'Coming later',
      outcome: 'Not available',
      title: 'Local Services Ads and Meta',
      body: 'This build cannot launch Local Services Ads or Meta campaigns. Run does nothing for this card.',
      budget: 'No budget is set aside',
      runnable: false,
      runKind: 'unavailable',
    },
  ];
}

function googleCampaigns(input: OperatorInput): OperatorCampaign[] {
  return input.campaigns.filter((c) => c.platform === 'google_ads');
}

function channelsOf(input: OperatorInput): OperatorChannel[] {
  const rows = googleCampaigns(input);
  const spend = rows.reduce((s, r) => s + (r.spend || 0), 0);
  const leads = rows.reduce((s, r) => s + (r.leads || 0), 0);
  let google: OperatorChannel;
  if (!rows.length && !input.google.oauth) {
    google = {
      id: 'google',
      name: 'Google Search',
      state: 'empty',
      grade: null,
      cost: null,
      jobs: null,
      foot: 'Not connected',
      verdict: 'Connect Google Ads to see a grade. Miles will not invent jobs or spend.',
    };
  } else if (!rows.length && input.google.oauth && !input.google.ready) {
    google = {
      id: 'google',
      name: 'Google Search',
      state: 'hold',
      grade: null,
      cost: null,
      jobs: null,
      foot: 'Signed in',
      verdict: plain(input.google.note || 'Google is signed in. The ad customer id is not resolved, so Miles cannot read spend or create a campaign yet.'),
    };
  } else if (!rows.length) {
    google = {
      id: 'google',
      name: 'Google Search',
      state: 'empty',
      grade: null,
      cost: null,
      jobs: null,
      foot: 'No rows',
      verdict: 'Google Ads is ready and returned no campaign rows in this window.',
    };
  } else {
    const sample = input.sampleConnector;
    google = {
      id: 'google',
      name: 'Google Search',
      state: sample ? 'sample' : 'live',
      grade: null,
      cost: leads > 0 ? money(spend / leads) : null,
      jobs: null,
      foot: sample
        ? `SAMPLE. ${money(spend)} example spend. ${Math.round(leads)} example leads.`
        : `${money(spend)} spent. ${Math.round(leads)} leads. Booked jobs are not split by channel.`,
      verdict: sample
        ? 'Example rows from the preview connector. Not a live grade.'
        : 'Live Google Ads leads in this window. There is no letter grade until booked jobs are known for this channel.',
    };
  }
  return [
    google,
    {
      id: 'lsa',
      name: 'Google LSA',
      state: 'later',
      grade: null,
      cost: null,
      jobs: null,
      foot: 'Coming later',
      verdict: 'Miles cannot read or create Local Services Ads in this build.',
    },
    {
      id: 'meta',
      name: 'Meta',
      state: 'later',
      grade: null,
      cost: null,
      jobs: null,
      foot: 'Coming later',
      verdict: 'Meta Ads is not connected. A Facebook Page is not an ad account, and this build cannot launch Meta campaigns.',
    },
    {
      id: 'gbp',
      name: 'Google Profile',
      state: input.gbpConnected ? 'empty' : 'empty',
      grade: null,
      cost: null,
      jobs: null,
      foot: input.gbpConnected ? (input.gbpHasData ? 'Connected' : 'Connected, no reviews yet') : 'Not connected',
      verdict: input.gbpConnected
        ? 'Connected. This build does not grade Google Business Profile on cost per booked job.'
        : 'Not connected. Miles will not invent organic jobs.',
    },
  ];
}

function breakdownOf(input: OperatorInput): OperatorView['breakdown'] {
  const rows = googleCampaigns(input);
  const target = pos(input.targetCpa);
  if (!rows.length) {
    const empty = !input.google.oauth
      ? 'No campaign rows. Connect Google Ads to see spend, leads, and status.'
      : !input.google.ready
        ? plain(input.google.note || 'Google is signed in. The ad customer id is not resolved, so there are no campaign rows.')
        : 'No campaign rows in this window.';
    return {
      sample: false,
      empty,
      note: 'Ad groups are not in this read. Meta and Local Services Ads rows are omitted because those channels are not running.',
      rows: [],
    };
  }
  return {
    sample: input.sampleConnector,
    empty: null,
    note: input.sampleConnector
      ? 'SAMPLE. These rows are from the preview connector, not a live ad account. Ad groups are not in this read. Status uses cost per lead against your saved cost goal when you have one.'
      : 'Live Google Ads campaigns. Ad groups are not in this read. Status uses cost per lead against your saved cost goal when you have one. It is not cost per booked job.',
    rows: rows.map((r) => ({
      name: plain(r.name),
      spend: money(r.spend || 0),
      leads: String(Math.round(r.leads || 0)),
      jobs: 'n/a',
      cost: r.leads > 0 ? money(r.spend / r.leads) : 'n/a',
      status: statusFor(r.spend || 0, r.leads || 0, target),
    })),
  };
}

function connectionsOf(input: OperatorInput): OperatorView['connections'] {
  let google: OperatorView['connections'][number];
  if (!input.google.oauth) {
    google = { name: 'Google Ads', state: 'off', detail: 'Not connected.' };
  } else if (!input.google.ready) {
    google = { name: 'Google Ads', state: 'hold', detail: plain(input.google.note || 'Signed in. Customer id not found.') };
  } else {
    google = { name: 'Google Ads', state: 'on', detail: 'Customer id is resolved.' };
  }
  return [
    google,
    {
      name: 'GoHighLevel',
      state: input.ghlConnected ? 'on' : 'off',
      detail: plain(input.ghlDetail),
    },
    {
      name: 'Meta',
      state: 'later',
      detail: 'Not connected. Coming later. A Facebook Page is not an ad account.',
    },
    {
      name: 'Facebook, Instagram, LinkedIn',
      state: input.socialConnected ? 'on' : 'off',
      detail: input.socialConnected ? 'Connected for organic social. This is not a Meta ad account.' : 'Not connected.',
    },
  ];
}

export function buildOperatorView(input: OperatorInput): OperatorView {
  const decisions = decisionsOf(input);
  return {
    mode: input.mode,
    modes: MODE_PILLS,
    paused: input.paused,
    setupLine: plain(setupLine(input)),
    sampleLegend: 'SAMPLE = example numbers until that source connects',
    onTrack: onTrack(input, decisions),
    money: moneyBlock(input),
    compare: compareBlock(),
    decisions,
    playbooks: playbooksOf(input),
    playbookNote: 'Run builds or queues the saved Google Search plan and still follows your mode. In Hybrid, Miles asks before it spends. Meta and Local Services Ads are not launched from here.',
    channels: channelsOf(input),
    breakdown: breakdownOf(input),
    connections: connectionsOf(input),
  };
}

/** Every customer-facing string on the operator view, for honesty checks. */
export function operatorCopy(view: OperatorView): string[] {
  const out: string[] = [view.setupLine, view.sampleLegend, view.playbookNote];
  const walk = (value: unknown) => {
    if (typeof value === 'string') out.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        if (k === 'rec') continue;
        walk(v);
      }
    }
  };
  walk(view.onTrack);
  walk(view.money);
  walk(view.compare);
  walk(view.decisions);
  walk(view.playbooks);
  walk(view.channels);
  walk(view.breakdown);
  walk(view.connections);
  view.modes.forEach((m) => out.push(m.label));
  return out;
}
