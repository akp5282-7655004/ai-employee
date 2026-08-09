import type { Channel, Offer, ClaimsCheck } from '../packs/index.js';

export interface ChannelAllocation {
  channel: Channel;
  label: string;
  /** Monthly dollars assigned. The managed profile is always 0 (run, not bought). */
  monthlyBudget: number;
  /** 0–1 share of the paid budget. */
  share: number;
  rationale: string;
  /** Services this channel should target first. */
  targets: string[];
}

export interface AdDraft {
  channel: Channel;
  service: string;
  headline: string;
  body: string;
  cta: string;
  /** Claims-checklist result — must pass before anything could publish. */
  claims: ClaimsCheck;
}

export interface CampaignPlan {
  businessName: string;
  vertical: string;
  category: string;
  monthlyBudget: number;
  band: string;
  allocations: ChannelAllocation[];
  /** Prioritized services to feature, most-wanted first. */
  featuredServices: string[];
  /** Proven offers from the pack's library the owner can pick from (§5). */
  suggestedOffers: Offer[];
  drafts: AdDraft[];
  /** One-paragraph plain-English strategy summary for the owner. */
  summary: string;
}

export type { Offer };
