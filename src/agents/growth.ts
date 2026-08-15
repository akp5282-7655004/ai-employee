/**
 * Growth Autopilot — the agent that closes the ad loop. It reads live spend and
 * won deals, attributes revenue per campaign (ROI/ROAS), judges each against the
 * target CPA, and proposes budget moves (scale winners, cut/pause losers) that
 * respect the owner's autonomy level and guardrails (max budget change per step).
 * Analysis is deterministic; execution goes through the approval gate.
 */
import type { CampaignSpend, Deal } from '../revenue/attribution.js';

export interface CampaignPerf {
  name: string;
  platform: string;
  utm: string;
  spend: number;
  clicks: number;
  leads: number;
  revenue: number;
  roas: number | null;
  cpa: number | null;
}
export interface GrowthAction {
  campaign: string;
  platform: string;
  verdict: 'winner' | 'loser' | 'steady' | 'no-data';
  action: 'scale' | 'cut' | 'pause' | 'hold';
  deltaPct: number; // signed budget change; 0 for hold/pause
  reason: string;
}
export interface GrowthPlan {
  totals: { spend: number; revenue: number; leads: number; roas: number | null; roiPct: number | null; targetCpa: number | null };
  perf: CampaignPerf[];
  actions: GrowthAction[];
  autonomy: number;
  guardrailPct: number;
  protectProven: boolean;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Attribute won-deal revenue to a campaign by matching UTM/campaign tag. */
function revenueFor(utm: string, name: string, deals: Deal[]): number {
  const key = (utm || name || '').toLowerCase();
  return deals
    .filter((d) => d.won && (d.value || 0) > 0 && (String(d.utmCampaign || '').toLowerCase() === key || (utm && String(d.utmCampaign || '').toLowerCase() === utm.toLowerCase())))
    .reduce((s, d) => s + (d.value || 0), 0);
}

export function buildGrowthPlan(
  spend: CampaignSpend[],
  deals: Deal[],
  opts: { targetCpa: number | null; guardrailPct: number; protectProven: boolean; autonomy: number },
): GrowthPlan {
  const g = opts.guardrailPct > 0 ? opts.guardrailPct : 10;
  const target = opts.targetCpa && opts.targetCpa > 0 ? opts.targetCpa : null;

  const perf: CampaignPerf[] = spend.map((c) => {
    const s = Math.round(c.spend || 0);
    const clicks = c.clicks || 0;
    const leads = c.conversions || 0;
    const revenue = Math.round(revenueFor(c.utm || '', c.campaign, deals));
    return { name: c.campaign, platform: c.platform, utm: c.utm || '', spend: s, clicks, leads, revenue, roas: s ? r2(revenue / s) : null, cpa: leads ? r2(s / leads) : null };
  });

  const actions: GrowthAction[] = perf.map((p) => {
    // Spending with zero leads — the clearest loser.
    if (p.spend > 0 && p.leads === 0) {
      return { campaign: p.name, platform: p.platform, verdict: 'loser', action: p.spend >= 200 ? 'pause' : 'cut', deltaPct: p.spend >= 200 ? 0 : -g, reason: `Spent $${p.spend.toLocaleString()} with 0 leads — ${p.spend >= 200 ? 'pause and rework the offer/targeting' : `cut budget ${g}%`}.` };
    }
    if (p.cpa == null) return { campaign: p.name, platform: p.platform, verdict: 'no-data', action: 'hold', deltaPct: 0, reason: 'Not enough data yet — hold.' };
    const roasStrong = p.roas != null && p.roas >= 3;
    const underTarget = target != null && p.cpa <= target;
    const wayOver = target != null && p.cpa > target * 1.5;
    if (underTarget || roasStrong) {
      return { campaign: p.name, platform: p.platform, verdict: 'winner', action: 'scale', deltaPct: +g, reason: `${underTarget ? `$${p.cpa}/lead is at/under your $${target} target` : `${p.roas}x ROAS is strong`} — scale budget +${g}%${opts.protectProven ? ' (within guardrail, proven funnel protected)' : ''}.` };
    }
    if (wayOver) {
      return { campaign: p.name, platform: p.platform, verdict: 'loser', action: 'cut', deltaPct: -g, reason: `$${p.cpa}/lead is well over your $${target} target — cut budget ${g}% and tighten.` };
    }
    return { campaign: p.name, platform: p.platform, verdict: 'steady', action: 'hold', deltaPct: 0, reason: `$${p.cpa}/lead${target ? ` vs $${target} target` : ''} — steady, hold.` };
  });

  const totSpend = perf.reduce((s, p) => s + p.spend, 0);
  const totRev = perf.reduce((s, p) => s + p.revenue, 0);
  const totLeads = perf.reduce((s, p) => s + p.leads, 0);
  return {
    totals: { spend: totSpend, revenue: totRev, leads: totLeads, roas: totSpend ? r2(totRev / totSpend) : null, roiPct: totSpend ? Math.round(((totRev - totSpend) / totSpend) * 100) : null, targetCpa: target },
    perf,
    actions,
    autonomy: opts.autonomy,
    guardrailPct: g,
    protectProven: opts.protectProven,
  };
}
