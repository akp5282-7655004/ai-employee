/**
 * Network learning — anonymized, cross-workspace benchmarks. As more businesses
 * use Miles, everyone gets smarter: what agents work, what a typical target CPA
 * looks like for your trade, how active the network is. This aggregates ONLY
 * numbers — never names, emails, or any customer content — and is honest about
 * being thin until the network grows. Pure and testable.
 */

/** The minimal, privacy-safe slice we read from each workspace. */
export interface WorkspaceSignal {
  trade?: string;
  agentTasks: string[]; // task types they've deployed
  targetCpa?: number;
  agentRuns: number;
}

export interface NetworkInsights {
  workspaces: number;
  byTrade: Array<{ trade: string; count: number }>;
  topAgents: Array<{ task: string; count: number }>;
  totalAgentsDeployed: number;
  totalAgentRuns: number;
  medianTargetCpa: number | null;
  /** For "businesses like yours" — the caller's trade, echoed back. */
  yourTrade?: string;
  yourTradeCount: number;
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

/** Aggregate every workspace's signal into network-wide benchmarks. */
export function aggregateNetwork(signals: WorkspaceSignal[], yourTrade?: string): NetworkInsights {
  const tradeCounts = new Map<string, number>();
  const agentCounts = new Map<string, number>();
  let totalAgents = 0;
  let totalRuns = 0;
  const cpas: number[] = [];

  for (const s of signals) {
    const trade = (s.trade || 'Other').trim() || 'Other';
    tradeCounts.set(trade, (tradeCounts.get(trade) ?? 0) + 1);
    for (const t of s.agentTasks) {
      agentCounts.set(t, (agentCounts.get(t) ?? 0) + 1);
      totalAgents++;
    }
    totalRuns += s.agentRuns || 0;
    if (typeof s.targetCpa === 'number' && s.targetCpa > 0) cpas.push(s.targetCpa);
  }

  const byTrade = [...tradeCounts.entries()].map(([trade, count]) => ({ trade, count })).sort((a, b) => b.count - a.count);
  const topAgents = [...agentCounts.entries()].map(([task, count]) => ({ task, count })).sort((a, b) => b.count - a.count).slice(0, 5);
  const norm = (yourTrade || '').trim();

  return {
    workspaces: signals.length,
    byTrade,
    topAgents,
    totalAgentsDeployed: totalAgents,
    totalAgentRuns: totalRuns,
    medianTargetCpa: median(cpas),
    yourTrade: norm || undefined,
    yourTradeCount: norm ? (tradeCounts.get(norm) ?? 0) : 0,
  };
}
