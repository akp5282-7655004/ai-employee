/**
 * Approval Log — the unified record of every Proposal, Approval, executed
 * Action, and Dismissal (ToS §3.4: "the authoritative record of what the
 * Service did and on whose instruction"). Append-only from the app's point
 * of view: entries are never edited, only added, and the log is exportable
 * from the Approvals page.
 */

export type ApprovalKind = 'proposal' | 'approval' | 'action' | 'dismissal';

export interface ApprovalEntry {
  id: string;
  ts: string; // ISO
  kind: ApprovalKind;
  /** Who acted — the account email for human events, "miles" for system events. */
  actor: string;
  /** Where it came from: skill key, "campaign-launcher", "email", … */
  source: string;
  title: string;
  detail?: string;
}

const CAP = 400; // the UI reads 50; export covers the rest before trimming

/** Append an entry to the log inside a user-data object (mutates `data`). */
export function appendApproval(data: Record<string, unknown>, entry: ApprovalEntry): void {
  const list = Array.isArray(data.approvalLog) ? (data.approvalLog as ApprovalEntry[]) : [];
  list.unshift(entry);
  data.approvalLog = list.slice(0, CAP);
}

export function approvalLog(data: Record<string, unknown>): ApprovalEntry[] {
  return Array.isArray(data.approvalLog) ? (data.approvalLog as ApprovalEntry[]) : [];
}

// ── Autonomy Settings (ToS §3.3) ─────────────────────────────────────────────
// Default is Proposal mode: nothing writes without a per-action Approval.
// "auto" is a standing approval within the caps — it only takes effect for
// skills that have a write path, and every auto action still logs.

export interface AutonomySettings {
  perSkill: Record<string, 'proposal' | 'auto'>;
  caps: {
    maxDailyMovePct: number; // budget-shifter: max % of a budget moved per day
    floorDailyBudget: number; // never shrink a campaign below this $/day
    monthlyCeiling: number; // 0 = no ceiling set
  };
}

export function defaultAutonomy(): AutonomySettings {
  return {
    perSkill: {},
    caps: { maxDailyMovePct: 20, floorDailyBudget: 5, monthlyCeiling: 0 },
  };
}

export function normalizeAutonomy(raw: unknown): AutonomySettings {
  const d = defaultAutonomy();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, any>;
  const perSkill: Record<string, 'proposal' | 'auto'> = {};
  if (r.perSkill && typeof r.perSkill === 'object') {
    for (const [k, v] of Object.entries(r.perSkill as Record<string, unknown>)) {
      if ((v === 'proposal' || v === 'auto') && k.length < 64) perSkill[k] = v;
    }
  }
  const num = (v: unknown, fb: number, min: number, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fb;
  };
  return {
    perSkill,
    caps: {
      maxDailyMovePct: num(r.caps?.maxDailyMovePct, d.caps.maxDailyMovePct, 1, 100),
      floorDailyBudget: num(r.caps?.floorDailyBudget, d.caps.floorDailyBudget, 0, 10_000),
      monthlyCeiling: num(r.caps?.monthlyCeiling, d.caps.monthlyCeiling, 0, 1_000_000),
    },
  };
}

/** The current Terms of Service version stamped to accounts at acceptance. */
export const TOS_VERSION = 'v0.1';
