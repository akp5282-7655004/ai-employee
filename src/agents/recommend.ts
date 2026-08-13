/**
 * Agent Recommendation Engine — the daily "here's what I'd change" brain.
 *
 * Once a day (or on demand) Miles reviews the shop's real marketing data — ad
 * spend and cost-per-lead by platform, uncontacted leads, unreplied hot emails,
 * new reviews, whether posts are scheduled — and turns what's off into a short
 * list of specific, approvable recommendations. The owner clicks Approve on the
 * ones they want and the change is queued into the Deploy pipeline (or applied
 * directly, for a toggle like Speed-to-Lead).
 *
 * This is deterministic on purpose: the same data always yields the same, honest
 * recommendations, with no invented numbers. Phrasing can be enriched by an LLM
 * upstream, but the signal and the math live here.
 */
import type { CampaignSpend, Deal } from '../revenue/attribution.js';
import type { Lead, Review, EmailMessage, SocialMetrics } from '../connectors/types.js';

export type RecCategory = 'ads' | 'leads' | 'email' | 'reputation' | 'content' | 'speed';
export type RecSeverity = 'high' | 'medium' | 'low';
export type RecApplyKind = 'queue_change' | 'enable_speed_to_lead';

export interface Recommendation {
  id: string;
  category: RecCategory;
  severity: RecSeverity;
  title: string;
  /** Why Miles is recommending this — the evidence, in plain language. */
  why: string;
  /** The concrete action that gets applied on approval. */
  action: string;
  apply: { kind: RecApplyKind; label: string };
}

export interface RecInput {
  spend: CampaignSpend[];
  deals: Deal[];
  leads: Lead[];
  reviews: Review[];
  emails: EmailMessage[];
  social: SocialMetrics | null;
  scheduledPosts: number;
  targetCpa: number | null;
  speedToLeadOn: boolean;
}

const SEV_RANK: Record<RecSeverity, number> = { high: 0, medium: 1, low: 2 };
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const pct = (a: number, b: number) => Math.round(((a - b) / b) * 100);

function dayKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Group spend rows by platform and total spend/conversions. */
function byPlatform(spend: CampaignSpend[]): Array<{ platform: string; spend: number; conv: number }> {
  const m = new Map<string, { platform: string; spend: number; conv: number }>();
  for (const r of spend) {
    const key = r.platform || 'unknown';
    const cur = m.get(key) ?? { platform: key, spend: 0, conv: 0 };
    cur.spend += r.spend || 0;
    cur.conv += r.conversions || 0;
    m.set(key, cur);
  }
  return [...m.values()];
}

const PLATFORM_LABEL: Record<string, string> = {
  google_ads: 'Google Ads',
  facebook: 'Facebook',
  instagram: 'Instagram',
  google_lsa: 'Local Services Ads',
  meta: 'Meta',
};
const label = (p: string) => PLATFORM_LABEL[p] ?? p.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Build today's recommendations from the shop's data. Pure and deterministic:
 * ids are stable per day per issue so approve/dismiss can persist within a day.
 */
export function buildRecommendations(input: RecInput, today: Date = new Date()): Recommendation[] {
  const day = dayKey(today);
  const recs: Recommendation[] = [];
  const push = (r: Omit<Recommendation, 'id'> & { key: string }) => {
    recs.push({ id: `${r.category}:${r.key}:${day}`, category: r.category, severity: r.severity, title: r.title, why: r.why, action: r.action, apply: r.apply });
  };
  const target = input.targetCpa && input.targetCpa > 0 ? input.targetCpa : null;

  // ── Ads: cost-per-lead vs target, dead spend, and scale-up wins ──
  for (const pf of byPlatform(input.spend)) {
    if (pf.spend <= 0) continue;
    const name = label(pf.platform);
    if (pf.conv === 0 && pf.spend >= 50) {
      push({ key: `dead:${pf.platform}`, category: 'ads', severity: 'high',
        title: `${name} spent ${money(pf.spend)} with no leads`,
        why: `${name} has spent ${money(pf.spend)} this period and produced 0 conversions.`,
        action: `Pause ${name} and move its budget to your best-converting channel until the ads are fixed.`,
        apply: { kind: 'queue_change', label: `Pause ${name} (no conversions)` } });
      continue;
    }
    if (pf.conv > 0) {
      const cpa = pf.spend / pf.conv;
      if (target && cpa > target * 1.15) {
        push({ key: `cpa-high:${pf.platform}`, category: 'ads', severity: 'high',
          title: `${name} cost per lead is ${money(cpa)} — ${pct(cpa, target)}% over target`,
          why: `${name} is at ${money(cpa)} per lead vs your ${money(target)} target (${pf.conv} leads on ${money(pf.spend)}).`,
          action: `Shift ~20% of ${name} budget to your best channel and pause its weakest ad set to pull the cost back toward ${money(target)}.`,
          apply: { kind: 'queue_change', label: `Rebalance ${name} budget (CPA ${money(cpa)} > target)` } });
      } else if (target && cpa < target * 0.8) {
        push({ key: `scale:${pf.platform}`, category: 'ads', severity: 'medium',
          title: `${name} is beating target — scale it up`,
          why: `${name} is winning leads at ${money(cpa)} vs your ${money(target)} target, so there's room to spend more at this efficiency.`,
          action: `Increase ${name} daily budget ~20% to capture more leads while the cost is below target.`,
          apply: { kind: 'queue_change', label: `Increase ${name} budget +20% (beating target)` } });
      }
    }
  }

  // ── Leads: uncontacted, and Speed-to-Lead ──
  const uncontacted = input.leads.filter((l) => !l.contacted).length;
  if (uncontacted > 0 && !input.speedToLeadOn) {
    push({ key: 'stl-off', category: 'speed', severity: 'high',
      title: `${uncontacted} new lead${uncontacted > 1 ? 's' : ''} not answered — turn on Speed-to-Lead`,
      why: `${uncontacted} lead${uncontacted > 1 ? 's have' : ' has'} come in without an instant reply. 78% of homeowners hire whoever answers first.`,
      action: `Turn on Speed-to-Lead so every new lead gets an instant text + email within a minute.`,
      apply: { kind: 'enable_speed_to_lead', label: 'Enable Speed-to-Lead responder' } });
  } else if (uncontacted > 0) {
    push({ key: 'leads-followup', category: 'leads', severity: 'medium',
      title: `${uncontacted} lead${uncontacted > 1 ? 's' : ''} still waiting on follow-up`,
      why: `${uncontacted} lead${uncontacted > 1 ? 's are' : ' is'} marked uncontacted in your CRM.`,
      action: `Send a follow-up text to every uncontacted lead from the last few days.`,
      apply: { kind: 'queue_change', label: `Follow up with ${uncontacted} uncontacted leads` } });
  }

  // ── Email: an unread message that reads like a ready-to-book customer ──
  const HOT = /(quote|estimate|price|pricing|book|schedule|appointment|available|interested)/i;
  const hot = input.emails.find((e) => e.unread && HOT.test(`${e.subject} ${e.snippet}`));
  if (hot) {
    push({ key: 'hot-email', category: 'email', severity: 'high',
      title: `Unread email looks like a new job: "${hot.subject}"`,
      why: `${hot.from} sent an unread message that reads like a ready-to-book customer: "${hot.snippet}"`,
      action: `Reply now with availability and a quote — this looks like money on the table.`,
      apply: { kind: 'queue_change', label: `Reply to ${hot.from} — "${hot.subject}"` } });
  }

  // ── Reputation: a low review that needs a response ──
  const bad = input.reviews.find((r) => (r.rating || 0) > 0 && (r.rating || 0) <= 3);
  if (bad) {
    push({ key: 'bad-review', category: 'reputation', severity: 'medium',
      title: `A ${bad.rating}-star review from ${bad.author} needs a reply`,
      why: `${bad.author} left ${bad.rating} stars: "${bad.text}". Unanswered low reviews hurt your Google ranking.`,
      action: `Approve a calm, professional public reply that offers to make it right.`,
      apply: { kind: 'queue_change', label: `Respond to ${bad.author}'s ${bad.rating}-star review` } });
  }

  // ── Content: nothing scheduled ──
  if (input.scheduledPosts === 0) {
    push({ key: 'no-posts', category: 'content', severity: 'low',
      title: `No posts scheduled — stay top of mind`,
      why: `You have no posts queued. Consistent posting keeps you visible to past and future customers.`,
      action: `Schedule 3 on-brand posts for this week (a job photo, a review, and your current offer).`,
      apply: { kind: 'queue_change', label: 'Schedule 3 posts for this week' } });
  }

  return recs.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]).slice(0, 8);
}
