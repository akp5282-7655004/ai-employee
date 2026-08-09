import type { Intake } from '../intake.js';
import {
  budgetBand,
  channelWeights,
  getPack,
  suggestOffers,
  PAID_CHANNELS,
  type Channel,
  type CommandPack,
} from '../packs/index.js';
import { draftAds, featuredServices } from './copy.js';
import type { CampaignPlan, ChannelAllocation } from './types.js';

/**
 * The campaign planner — the deterministic core of the agent loop. It turns one
 * intake into a concrete plan: channel mix, budget split, featured services,
 * proven offers, and claims-checked ad drafts. Offline and deterministic (no
 * keys) — the "brain". An LLM planner can later emit the identical CampaignPlan
 * with richer copy/strategy; this stays the regression baseline (docs/VISION.md
 * §3, §8).
 */
export const CHANNEL_LABEL: Record<Channel, string> = {
  lsa: 'Local Services Ads',
  managed_profile: 'Managed Business Profile',
  search: 'Search',
  social: 'Social (Meta/Instagram)',
};

export function planCampaign(intake: Intake): CampaignPlan {
  const pack = getPack(intake.vertical);
  const weights = channelWeights(pack, {
    category: intake.category,
    monthlyBudget: intake.monthlyBudget,
    goal: intake.goal,
    emergency: intake.emergency,
  });
  const band = budgetBand(pack, intake.monthlyBudget);
  const featured = featuredServices(intake);
  const allocations = buildAllocations(pack, weights, intake, featured);
  const drafts = draftAds(pack, intake, allocations);

  return {
    businessName: intake.businessName,
    vertical: pack.id,
    category: intake.category,
    monthlyBudget: intake.monthlyBudget,
    band,
    allocations,
    featuredServices: featured,
    suggestedOffers: suggestOffers(pack, intake.category),
    drafts,
    summary: buildSummary(intake, allocations, band),
  };
}

function buildAllocations(
  pack: CommandPack,
  weights: Record<Channel, number>,
  intake: Intake,
  featured: string[],
): ChannelAllocation[] {
  const out: ChannelAllocation[] = [];

  // The managed profile is always active, always $0.
  out.push({
    channel: 'managed_profile',
    label: CHANNEL_LABEL.managed_profile,
    monthlyBudget: 0,
    share: 0,
    rationale:
      'Managed for free: optimize the profile, categories, services, and posts to win the map pack and feed ad quality.',
    targets: featured.slice(0, 5),
  });

  // Paid channels, biggest share first — so the plan (and summary) leads with the
  // channel actually carrying the budget, which differs by vertical.
  const paid = [...PAID_CHANNELS].filter((c) => weights[c] > 0.001).sort((a, b) => weights[b] - weights[a]);
  for (const channel of paid) {
    const share = weights[channel];
    out.push({
      channel,
      label: CHANNEL_LABEL[channel],
      monthlyBudget: Math.round(intake.monthlyBudget * share),
      share,
      rationale: rationaleFor(channel, pack, intake),
      targets: channel === 'social' ? featured.slice(0, 4) : featured.slice(0, 3),
    });
  }
  return out;
}

function rationaleFor(channel: Channel, pack: CommandPack, intake: Intake): string {
  switch (channel) {
    case 'lsa':
      return pack.proximity.nearMeDominant
        ? 'Lead here: pay-per-lead, no creative, highest intent — perfect for "near me" demand.'
        : 'Pay-per-lead, high intent; kept modest where the buyer travels to choose a provider.';
    case 'search':
      return `Capture "${intake.category} near me" demand LSA can't fully absorb; exact-match on the money services.`;
    case 'social':
      return intake.goal === 'awareness'
        ? 'Build local awareness and retarget visitors — demand-gen, not first-dollar intent.'
        : 'Retarget visitors and run offers for higher-ticket work; kept behind the intent channels.';
    default:
      return '';
  }
}

function buildSummary(intake: Intake, allocations: ChannelAllocation[], band: string): string {
  const paid = allocations.filter((a) => a.monthlyBudget > 0);
  const parts = paid.map((a) => `${a.label} ${Math.round(a.share * 100)}% ($${a.monthlyBudget})`);
  const lead = paid[0]?.label ?? 'Search';
  const top = intake.wantMoreOf[0] ?? intake.services[0];
  return (
    `On a $${intake.monthlyBudget}/mo (${band}) budget for a ${intake.category} business, lead with ${lead} and a ` +
    `fully-managed business profile. Featuring ${top} first. Split: ${parts.join(', ')}. ` +
    `Nothing publishes without your approval.`
  );
}
