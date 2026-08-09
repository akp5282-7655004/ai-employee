import { parseIntake, type Intake } from '../intake.js';
import { planCampaign, CHANNEL_LABEL } from '../plan/planner.js';
import type { CampaignPlan } from '../plan/types.js';
import type { Connector } from '../connectors/index.js';
import { MockInterpreter, type Interpreter } from './intent.js';
import type { AgentReply, PartialIntake, ProposedAction, Session } from './types.js';

/**
 * The agent loop — the spine that makes the packs, planner, and connector behave
 * like an employee (docs/VISION.md §1, §3). One message in → intake updated →
 * either a clarifying question, or a plan + proposed actions awaiting approval;
 * an "approve" runs the actions through the connector. Surface-agnostic and, with
 * the mock interpreter + mock connector, fully offline.
 */

/** Sensible default services per category, so a plan is possible before the owner lists them. */
const DEFAULT_SERVICES: Record<string, string[]> = {
  plumbing: ['drain cleaning', 'water heater', 'sewer line', 'leak repair'],
  hvac: ['ac repair', 'furnace repair', 'ac install', 'tune-up'],
  electrical: ['panel upgrade', 'wiring', 'ev charger', 'lighting'],
  roofing: ['roof repair', 'roof replacement', 'storm damage', 'inspection'],
  garage_door: ['spring repair', 'opener install', 'new door'],
  water_damage: ['water extraction', 'mold remediation', 'restoration'],
  pest_control: ['general pest', 'termite', 'rodent'],
  landscaping: ['lawn care', 'design', 'cleanup'],
  remodeling: ['kitchen', 'bathroom', 'basement'],
  general: ['cleanings', 'fillings', 'crowns', 'exams'],
  cosmetic: ['veneers', 'whitening', 'bonding'],
  orthodontics: ['braces', 'invisalign', 'retainers'],
  implants: ['implants', 'all-on-4', 'bone grafting'],
  emergency_dental: ['emergency exam', 'extraction', 'crown repair'],
};

/** Which app + action each channel maps to. */
const CHANNEL_APP: Record<string, { app: string; actionId: string }> = {
  managed_profile: { app: 'google_my_business', actionId: 'google_my_business-optimize-profile' },
  lsa: { app: 'google_lsa', actionId: 'google_lsa-create-campaign' },
  search: { app: 'google_ads', actionId: 'google_ads-create-campaign' },
  social: { app: 'facebook_ads', actionId: 'facebook_ads-create-campaign' },
};

export interface AgentDeps {
  connector: Connector;
  interpreter?: Interpreter;
}

export class Agent {
  private interpreter: Interpreter;
  constructor(private deps: AgentDeps) {
    this.interpreter = deps.interpreter ?? new MockInterpreter();
  }

  async handle(session: Session, message: string): Promise<{ session: Session; reply: AgentReply }> {
    const s: Session = { ...session, intake: { ...session.intake } };
    const interp = this.interpreter.interpretAsync
      ? await this.interpreter.interpretAsync(message, s)
      : this.interpreter.interpret(message, s);

    if (interp.intent === 'approve') return this.approve(s);
    if (interp.intent === 'connect') return this.connect(s, interp.connectApp);

    // Merge anything we learned.
    Object.assign(s.intake, prune(interp.fields));

    if (interp.intent === 'unknown' && !hasEnough(s.intake)) {
      return {
        session: s,
        reply: {
          text:
            "I'm your marketing employee — tell me about the business and I'll build a plan. " +
            'For example: "I run a plumbing shop in Chicago, $3k/month, I want more calls."',
        },
      };
    }

    const missing = missingFields(s.intake);
    if (missing.length) {
      return { session: s, reply: { text: askFor(missing, s.intake) } };
    }

    // We have enough — build the plan and propose actions.
    const plan = planCampaign(buildIntake(s.intake));
    const actions = proposeActions(plan, s.externalUserId);
    s.pending = { plan, actions };
    return { session: s, reply: { text: renderProposal(plan, actions), plan, actions } };
  }

  private async approve(s: Session): Promise<{ session: Session; reply: AgentReply }> {
    if (!s.pending) {
      return { session: s, reply: { text: "There's nothing waiting for approval yet. Tell me about the business first." } };
    }
    const { actions } = s.pending;
    const launched: string[] = [];
    const blocked: ProposedAction[] = [];
    for (const a of actions) {
      const res = await this.deps.connector.runAction({
        externalUserId: s.externalUserId,
        actionId: a.actionId,
        configuredProps: a.configuredProps,
      });
      if (res.ok) launched.push(a.label);
      else blocked.push(a);
    }

    let connectUrl: string | undefined;
    let text = launched.length ? `Launched: ${launched.join(', ')}.` : 'Nothing launched yet.';
    if (blocked.length) {
      const apps = [...new Set(blocked.map((b) => b.app))];
      const token = await this.deps.connector.createConnectToken(s.externalUserId);
      connectUrl = token.connectUrl;
      text +=
        `\nStill need you to connect ${apps.join(', ')} before I can run: ` +
        `${blocked.map((b) => b.label).join(', ')}.\nConnect here: ${connectUrl}`;
    }
    s.pending = undefined;
    return {
      session: s,
      reply: {
        text,
        connectUrl,
        launched: launched,
        blocked: blocked.map((b) => ({ label: b.label, app: b.app, actionId: b.actionId })),
      },
    };
  }

  private async connect(s: Session, app?: string): Promise<{ session: Session; reply: AgentReply }> {
    const token = await this.deps.connector.createConnectToken(s.externalUserId);
    const which = app ? `your ${app} account` : 'an app';
    return { session: s, reply: { text: `To connect ${which}, open: ${token.connectUrl}`, connectUrl: token.connectUrl } };
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function prune(fields: PartialIntake): PartialIntake {
  const out: PartialIntake = {};
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

/** The minimum to produce a plan: a category and a budget. */
function missingFields(i: PartialIntake): Array<'category' | 'monthlyBudget'> {
  const out: Array<'category' | 'monthlyBudget'> = [];
  if (!i.category) out.push('category');
  if (i.monthlyBudget === undefined) out.push('monthlyBudget');
  return out;
}

function hasEnough(i: PartialIntake): boolean {
  return missingFields(i).length === 0;
}

function askFor(missing: Array<'category' | 'monthlyBudget'>, i: PartialIntake): string {
  const bits: string[] = [];
  if (missing.includes('category')) bits.push('what kind of business is it (e.g. plumbing, HVAC, dental)?');
  if (missing.includes('monthlyBudget')) bits.push("what's your monthly ad budget?");
  const ack = i.category ? `Got it — ${i.category}. ` : '';
  return `${ack}A couple things so I can build the plan: ${bits.join(' And ')}`;
}

function buildIntake(i: PartialIntake): Intake {
  return parseIntake({
    businessName: i.businessName ?? 'Your business',
    vertical: i.vertical ?? 'home_services',
    category: i.category,
    services: i.services ?? DEFAULT_SERVICES[i.category!] ?? [i.category!],
    serviceArea: { cities: i.cities ?? [] },
    monthlyBudget: i.monthlyBudget,
    goal: i.goal ?? 'more_calls',
    emergency: i.emergency ?? false,
  });
}

function proposeActions(plan: CampaignPlan, _externalUserId: string): ProposedAction[] {
  const out: ProposedAction[] = [];
  for (const a of plan.allocations) {
    const map = CHANNEL_APP[a.channel];
    if (!map) continue;
    out.push({
      actionId: map.actionId,
      app: map.app,
      channel: a.channel,
      label: `${CHANNEL_LABEL[a.channel as keyof typeof CHANNEL_LABEL] ?? a.channel}${a.monthlyBudget > 0 ? ` ($${a.monthlyBudget}/mo)` : ''}`,
      configuredProps: {
        name: `${plan.businessName} — ${a.label}`,
        monthlyBudget: a.monthlyBudget,
        targets: a.targets,
      },
    });
  }
  return out;
}

function renderProposal(plan: CampaignPlan, actions: ProposedAction[]): string {
  const lines = [plan.summary, '', "Here's what I'll set up (nothing runs until you say so):"];
  for (const a of actions) lines.push(`  • ${a.label}`);
  lines.push('', "Reply “approve” to launch.");
  return lines.join('\n');
}
