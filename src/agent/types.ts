import type { Intake } from '../intake.js';
import type { CampaignPlan } from '../plan/types.js';

/** Intake fields accumulated across a conversation — filled a bit at a time. */
export interface PartialIntake {
  businessName?: string;
  vertical?: string;
  category?: string;
  services?: string[];
  cities?: string[];
  monthlyBudget?: number;
  goal?: Intake['goal'];
  emergency?: boolean;
}

/** A single action the employee proposes to run — gated behind approval. */
export interface ProposedAction {
  actionId: string;
  app: string;
  channel: string;
  label: string;
  configuredProps: Record<string, unknown>;
}

/** Everything the loop remembers between messages for one user. */
export interface Session {
  externalUserId: string;
  intake: PartialIntake;
  /** A plan + its proposed actions, waiting for the owner's "approve". */
  pending?: { plan: CampaignPlan; actions: ProposedAction[] };
}

export interface AgentReply {
  text: string;
  /** Structured extras a UI can render (the loop stays surface-agnostic). */
  plan?: CampaignPlan;
  actions?: ProposedAction[];
  connectUrl?: string;
  /** After an approval: which actions ran, and which need an app connected. */
  launched?: string[];
  blocked?: Array<{ label: string; app: string; actionId: string }>;
}

export function newSession(externalUserId: string): Session {
  return { externalUserId, intake: {} };
}
