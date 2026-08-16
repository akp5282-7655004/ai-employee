/**
 * The Seven Miles Skills (spec: docs/specs/dashboard-and-skills-spec.md §5) —
 * home-services adaptations of the B2B originals. Every skill runs in
 * PROPOSAL mode: it produces a recommendation with the metrics it cites and
 * a revert path; nothing writes to an ad platform without an explicit
 * approval event, and where no write path exists yet the approval is
 * disabled with the reason stated. Instruction files: skills/<key>/SKILL.md.
 */
import { getMetrics, type LiveReaders } from '../metrics/resolver.js';

export interface SkillCtx {
  business: string;
  trade: string;
  city: string;
  services: string;
  zips: string[];
  live: LiveReaders;
  /** Real per-campaign spend rows when Google Ads is connected. */
  spendRows: { campaign: string; cost: number; conversions?: number }[];
  /** Real search terms (30d) when the connection exposes them. */
  searchTerms?: { term: string; cost: number; clicks: number; conversions: number }[];
  /** Owner-set monthly ad budget (profile), for pacing. */
  monthlyBudget?: number;
}

export interface SkillRun {
  id: string;
  skill: string;
  name: string;
  status: 'needs_approval' | 'approved' | 'executed' | 'dismissed' | 'read_only';
  summary: string;
  details: string[];
  approvable: boolean;
  approve_disabled_reason?: string;
  source: 'live' | 'sample';
  ts: string;
}

export const SEVEN_SKILLS: { key: string; name: string; what: string; mode: 'proposal' | 'read_only' }[] = [
  { key: 'service-area-audience-builder', name: 'Service Area Audience Builder', what: 'ZIPs, radius, and homeowner signals → targeting spec per platform', mode: 'proposal' },
  { key: 'seasonality-demand-layer', name: 'Seasonality + Demand Layer', what: 'Which service lines to push this week, with budget weighting', mode: 'read_only' },
  { key: 'campaign-launcher', name: 'Campaign Launcher', what: 'Brief → launch-ready campaign validated against the platform specs', mode: 'proposal' },
  { key: 'cpl-funnel-reader', name: 'CPL + Funnel Reader', what: 'Weekly readout: spend → leads → booked, and where the funnel leaks', mode: 'read_only' },
  { key: 'loser-pauser', name: 'Loser Pauser', what: 'Spend with zero results → proposed pause list with $ saved', mode: 'proposal' },
  { key: 'budget-shifter', name: 'Budget Shifter', what: 'Move budget from losers to winners within your caps', mode: 'proposal' },
  { key: 'channel-comparator', name: 'Channel Comparator', what: 'Google vs LSA vs Meta on cost per booked job', mode: 'proposal' },
  { key: 'search-term-gold-miner', name: 'Search Term Gold Miner', what: 'Find wasted spend and hidden winners in your search terms', mode: 'proposal' },
  { key: 'negative-keyword-implementer', name: 'Negative Keyword Implementer', what: 'Turn wasted search terms into a negative-keyword block list', mode: 'proposal' },
  { key: 'spend-pacing-monitor', name: 'Spend Pacing Monitor', what: 'Track spend vs your monthly budget and project month-end', mode: 'read_only' },
  { key: 'ad-copy-performance-ranker', name: 'Ad Copy Performance Ranker', what: 'Rank your headlines and descriptions, propose swaps', mode: 'proposal' },
];

const fmt$ = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;

/** Run one skill and produce its proposal/readout. Pure read — never writes. */
export async function runSevenSkill(key: string, ctx: SkillCtx): Promise<Omit<SkillRun, 'id' | 'ts'>> {
  const def = SEVEN_SKILLS.find((s) => s.key === key);
  if (!def) throw new Error(`Unknown skill: ${key}`);
  const liveSpend = ctx.spendRows.length > 0;
  const source: 'live' | 'sample' = liveSpend ? 'live' : 'sample';
  const noWrite = 'Write access to this platform is not connected yet — Miles produced the proposal; apply it in the platform UI or connect write access.';

  switch (key) {
    case 'service-area-audience-builder': {
      const zips = ctx.zips.length ? ctx.zips.join(', ') : `${ctx.city || 'your city'} + 15-mile radius`;
      return {
        skill: key, name: def.name, status: 'needs_approval', approvable: true, source: 'sample',
        approve_disabled_reason: noWrite,
        summary: `Audience spec for ${ctx.trade || 'your trade'} across Google, LSA, and Meta — geo: ${zips}.`,
        details: [
          `Google Search: location targeting = ${zips}, setting "presence" (people IN the area, not interested in it).`,
          `LSA: service areas = the same ZIP list; every offered job type ON, everything else OFF.`,
          `Meta: geo = ${zips} (radius min 1 mi), Advantage+ audience with suggestions: homeowners, home improvement, recent movers; age floor 25.`,
          `Exclusions: renters-heavy interest stacks; Audience Network placement (lead quality).`,
        ],
      };
    }
    case 'seasonality-demand-layer': {
      const month = new Date().toLocaleString('en-US', { month: 'long' });
      return {
        skill: key, name: def.name, status: 'read_only', approvable: false, source: 'sample',
        summary: `${month} demand memo for ${ctx.trade || 'home services'} in ${ctx.city || 'your area'}.`,
        details: [
          `Push now: the service lines your customers book this month (${ctx.services || 'core services'}) — front-load budget early in the week; homeowners book Mon–Wed.`,
          `Budget weighting: 60% proven winners / 25% seasonal push / 15% testing.`,
          `Note: this memo is template-driven until search-term and trends reads are connected; treat weights as starting points.`,
        ],
      };
    }
    case 'cpl-funnel-reader': {
      const m = await getMetrics(['calc.blended_spend', 'calc.blended_leads', 'crm.qualified_leads', 'crm.booked_jobs', 'calc.cost_per_booked', 'calls.missed', 'calc.lead_leak_dollars'], 30, ctx.live);
      const v = (k: string) => m.find((x) => x.key === k)?.value ?? 0;
      const leadToQual = v('calc.blended_leads') ? (v('crm.qualified_leads') / v('calc.blended_leads')) * 100 : 0;
      const qualToBook = v('crm.qualified_leads') ? (v('crm.booked_jobs') / v('crm.qualified_leads')) * 100 : 0;
      const leak = leadToQual < qualToBook ? 'lead → qualified' : 'qualified → booked';
      return {
        skill: key, name: def.name, status: 'read_only', approvable: false, source,
        summary: `30-day readout: ${fmt$(v('calc.blended_spend'))} spent → ${Math.round(v('calc.blended_leads'))} leads → ${Math.round(v('crm.booked_jobs'))} booked (${fmt$(v('calc.cost_per_booked'))}/booked). Biggest leak: ${leak}.`,
        details: [
          `Lead → qualified: ${leadToQual.toFixed(0)}% · qualified → booked: ${qualToBook.toFixed(0)}%.`,
          `Missed-call leak: ${Math.round(v('calls.missed'))} missed calls ≈ ${fmt$(v('calc.lead_leak_dollars'))} in bookable revenue walking away.`,
          `Fix order: answer the phone (missed calls first), then the ${leak} stage.`,
        ],
      };
    }
    case 'campaign-launcher': {
      return {
        skill: key, name: def.name, status: 'needs_approval', approvable: true, source: 'sample',
        summary: `Ready to build a launch-ready campaign for ${ctx.business || 'your business'} — validated against the platform spec before anything goes live.`,
        details: [
          'Google Search: full RSA (15 headlines / 4 descriptions), keywords + negatives, sitelinks/callouts/snippets — built and launched from the Launch a Campaign page (campaigns land PAUSED).',
          'Meta Leads: objective=Leads, Instant Form with 1–3 qualifiers + privacy URL, CTA=Get Quote — built from the Launch on Facebook page.',
          'Every field is checked against the master specs (character limits, counts) before launch.',
        ],
        approve_disabled_reason: 'Approval happens on the launch pages themselves — this skill routes you there with the brief filled in.',
      };
    }
    case 'loser-pauser': {
      const losers = ctx.spendRows.filter((r) => r.cost >= 50 && (r.conversions ?? 0) === 0);
      if (liveSpend && !losers.length) {
        return { skill: key, name: def.name, status: 'read_only', approvable: false, source, summary: 'No campaigns meet the pause rule (≥$50 spend, zero conversions, 30-day window). Nothing to cut.', details: [] };
      }
      const rows = liveSpend ? losers : [{ campaign: 'Example — Display Remarketing', cost: 96, conversions: 0 }];
      const saved = rows.reduce((a, r) => a + r.cost, 0);
      return {
        skill: key, name: def.name, status: 'needs_approval', approvable: true, source,
        approve_disabled_reason: noWrite,
        summary: `${rows.length} campaign${rows.length === 1 ? '' : 's'} spending with zero conversions — pausing saves ~${fmt$(saved)}/mo.`,
        details: rows.map((r) => `Pause "${r.campaign}" — ${fmt$(r.cost)} spent, 0 conversions in 30 days. Revert: re-enable in one click.`),
      };
    }
    case 'budget-shifter': {
      const ranked = [...ctx.spendRows].sort((a, b) => (b.conversions ?? 0) - (a.conversions ?? 0));
      const winner = ranked[0]?.campaign ?? 'Best performer';
      const loser = ranked[ranked.length - 1]?.campaign ?? 'Worst performer';
      return {
        skill: key, name: def.name, status: 'needs_approval', approvable: true, source,
        approve_disabled_reason: noWrite,
        summary: liveSpend
          ? `Shift 20% of daily budget from "${loser}" to "${winner}" (caps: max 20%/day move, $5/day floor).`
          : 'Sample proposal: shift 20% of daily budget from the worst CPL campaign to the best (caps: max 20%/day, $5/day floor).',
        details: [
          'Why: winners are budget-limited while losers burn the same dollars at worse cost per booked job.',
          'Guardrails: never below the floor, never more than the daily cap, monthly ceiling respected.',
          'Revert: budgets restore to the logged prior values in one click.',
        ],
      };
    }
    case 'channel-comparator': {
      const m = await getMetrics(['google_ads.cost', 'lsa.spend', 'meta.spend', 'calc.cost_per_booked'], 30, ctx.live);
      const v = (k: string) => m.find((x) => x.key === k)?.value ?? 0;
      return {
        skill: key, name: def.name, status: 'needs_approval', approvable: true, source,
        approve_disabled_reason: 'Execution hands off to Budget Shifter once write access is connected.',
        summary: `Channel mix this month — Google ${fmt$(v('google_ads.cost'))} · LSA ${fmt$(v('lsa.spend'))} · Meta ${fmt$(v('meta.spend'))}. Compare on cost per BOOKED JOB (${fmt$(v('calc.cost_per_booked'))} blended), never on cost per lead.`,
        details: [
          'LSA leads are pay-per-lead and pre-qualified by Google Guaranteed; Search leads are cheaper but rawer — normalizing on booked jobs is the only fair comparison.',
          'GBP is $0 media cost and upstream of LSA (reviews drive LSA rank) — its calls count as booked-job source, not spend.',
          'Recommendation engine sharpens as CRM booked-job data accumulates per channel.',
        ],
      };
    }
    case 'search-term-gold-miner': {
      const terms = ctx.searchTerms ?? [];
      const liveTerms = terms.length > 0;
      const rows = liveTerms ? terms : [
        { term: `${(ctx.trade || 'painter').toLowerCase()} jobs near me`, cost: 42, clicks: 18, conversions: 0 },
        { term: `diy ${(ctx.trade || 'painting').toLowerCase()} tips`, cost: 27, clicks: 14, conversions: 0 },
        { term: `${(ctx.trade || 'painting').toLowerCase()} cost calculator free`, cost: 19, clicks: 9, conversions: 0 },
        { term: `emergency ${(ctx.services || 'repair').split(',')[0]?.toLowerCase().trim() ?? 'repair'} near me`, cost: 38, clicks: 11, conversions: 4 },
      ];
      const waste = rows.filter((t) => t.cost >= 10 && t.conversions === 0).sort((a, b) => b.cost - a.cost);
      const gold = rows.filter((t) => t.conversions > 0 && t.cost / Math.max(t.conversions, 1) < 25).sort((a, b) => b.conversions - a.conversions);
      const wasted = waste.reduce((a, t) => a + t.cost, 0);
      return {
        skill: key, name: 'Search Term Gold Miner', status: 'needs_approval', approvable: true,
        source: liveTerms ? 'live' : 'sample',
        approve_disabled_reason: 'Blocking happens via the Negative Keyword Implementer — run it next with this list.',
        summary: liveTerms
          ? `${waste.length} search terms burned ${fmt$(wasted)} with zero conversions in 30 days; ${gold.length} hidden winner${gold.length === 1 ? '' : 's'} found.`
          : `Sample analysis (search-term read not exposed by this connection yet): here is exactly what Miles flags once terms flow.`,
        details: [
          ...waste.slice(0, 5).map((t) => `WASTE: "${t.term}" — ${fmt$(t.cost)}, ${t.clicks} clicks, 0 conversions → add as negative.`),
          ...gold.slice(0, 3).map((t) => `GOLD: "${t.term}" — ${t.conversions} conversions at ${fmt$(t.cost / Math.max(t.conversions, 1))} each → consider an exact-match keyword.`),
        ],
      };
    }
    case 'negative-keyword-implementer': {
      const terms = (ctx.searchTerms ?? []).filter((t) => t.cost >= 10 && t.conversions === 0);
      const liveTerms = terms.length > 0;
      const negs = liveTerms ? terms.map((t) => t.term) : ['jobs', 'diy', 'free', 'calculator', 'how to', 'salary'];
      const saved = liveTerms ? terms.reduce((a, t) => a + t.cost, 0) : 86;
      return {
        skill: key, name: 'Negative Keyword Implementer', status: 'needs_approval', approvable: true,
        source: liveTerms ? 'live' : 'sample',
        approve_disabled_reason: 'One-click apply ships with negative-keyword write access — until then, paste the list into Google Ads → Keywords → Negative keywords (campaign level).',
        summary: `Block ${negs.length} money-wasting terms — saves ~${fmt$(saved)}/mo. Copy-paste list below.`,
        details: [
          `Negative list (phrase match): ${negs.map((n) => `"${n}"`).join(', ')}`,
          'Where: Google Ads → Campaigns → Keywords → Negative keywords → + → Campaign level.',
          'Rule applied: ≥$10 spend, zero conversions, 30-day window — same rule the Gold Miner uses.',
        ],
      };
    }
    case 'spend-pacing-monitor': {
      const spend30 = ctx.spendRows.reduce((a, r) => a + r.cost, 0);
      const budget = ctx.monthlyBudget;
      const now = new Date();
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const projected = (spend30 / 30) * daysInMonth;
      if (!liveSpend) {
        return { skill: key, name: 'Spend Pacing Monitor', status: 'read_only', approvable: false, source: 'sample', summary: 'Connect Google Ads to track pacing — spend vs budget, with a month-end projection and overspend alerts.', details: [] };
      }
      if (!budget) {
        return {
          skill: key, name: 'Spend Pacing Monitor', status: 'read_only', approvable: false, source,
          summary: `Trailing-30 spend is ${fmt$(spend30)} (projects to ~${fmt$(projected)} for a ${daysInMonth}-day month). Set a monthly ad budget in Business Profile to get pacing alerts.`,
          details: [`Per-campaign: ${ctx.spendRows.slice(0, 5).map((r) => `${r.campaign} ${fmt$(r.cost)}`).join(' · ')}`],
        };
      }
      const pct = (projected / budget) * 100;
      return {
        skill: key, name: 'Spend Pacing Monitor', status: 'read_only', approvable: false, source,
        summary: `Pacing at ${pct.toFixed(0)}% of your ${fmt$(budget)}/mo budget — projected month-end ${fmt$(projected)}${pct > 110 ? ' (OVER — trim daily budgets or expect Google to cap)' : pct < 80 ? ' (UNDER — headroom to scale winners)' : ' (on track)'}.`,
        details: [`30-day spend ${fmt$(spend30)} · ${ctx.spendRows.length} campaigns · Google can spend up to 2× a daily budget on strong days; monthly cap = daily × 30.4.`],
      };
    }
    case 'ad-copy-performance-ranker': {
      return {
        skill: key, name: 'Ad Copy Performance Ranker', status: 'needs_approval', approvable: true, source: 'sample',
        approve_disabled_reason: 'Needs asset-level performance reads (per-headline impressions/CTR) — not exposed by this connection yet. The method below runs the moment they are.',
        summary: 'Ranks every headline and description by Google\'s asset performance labels + CTR, then proposes swaps for the "Low" performers.',
        details: [
          'Method: pull per-asset performance (Best/Good/Low + impressions), rank within each ad, flag assets rated Low with meaningful impressions.',
          'Fix: replace flagged assets with variants from the winning patterns (your top asset\'s structure, new angle) — never edit winners.',
          'Guardrail: minimum 2 weeks / 1,000 impressions before judging any asset.',
        ],
      };
    }
    default:
      throw new Error(`Unhandled skill: ${key}`);
  }
}
