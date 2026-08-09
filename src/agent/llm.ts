import { MockInterpreter, type Interpretation, type Interpreter } from './intent.js';
import type { Session } from './types.js';

/**
 * The Claude-backed interpreter — real natural-language understanding for the
 * same `Interpreter` seam the mock implements (docs/VISION.md §3). It extracts
 * the intake fields and intent from messier phrasing than the regex parser can
 * handle, and the whole agent loop, planner, and connector underneath stay
 * unchanged.
 *
 * Two safety choices mirror the connector's:
 *  - The Anthropic SDK is loaded dynamically, so the project ships without the
 *    dependency until this path is switched on ( npm install @anthropic-ai/sdk ).
 *  - Every call falls back to the deterministic MockInterpreter if the key is
 *    missing, the SDK isn't installed, or the model errors — so the product never
 *    hard-depends on the LLM being reachable.
 */
export interface LlmOptions {
  apiKey?: string;
  model?: string;
}

const SYSTEM = `You turn a small-business owner's message to their AI marketing employee into structured fields.
Return ONLY a JSON object with these optional keys:
  intent: "plan" | "approve" | "connect" | "unknown"
  vertical: "home_services" | "dental"
  category: a category id — home_services: plumbing,hvac,electrical,roofing,garage_door,water_damage,pest_control,landscaping,remodeling; dental: general,cosmetic,orthodontics,implants,emergency_dental
  monthlyBudget: number (whole dollars)
  goal: "more_calls" | "higher_ticket" | "fill_schedule" | "awareness"
  emergency: boolean
  cities: string[]
  businessName: string
Use "approve" if they are confirming/approving; "connect" if they ask to connect an app; "plan" if they describe the business; else "unknown". Omit keys you can't determine. No prose, JSON only.`;

export class LlmInterpreter implements Interpreter {
  readonly name = 'claude';
  private fallback = new MockInterpreter();
  private client: any | null = null;
  private model: string;
  private apiKey?: string;

  constructor(opts: LlmOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
    this.model = opts.model ?? process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5-20251001';
  }

  /** Interpreter is sync; callers that want the LLM use interpretAsync. */
  interpret(message: string, session: Session): Interpretation {
    return this.fallback.interpret(message, session);
  }

  async interpretAsync(message: string, session: Session): Promise<Interpretation> {
    if (!this.apiKey) return this.fallback.interpret(message, session);
    try {
      const client = await this.backend();
      const res = await client.messages.create({
        model: this.model,
        max_tokens: 400,
        system: SYSTEM,
        messages: [{ role: 'user', content: message }],
      });
      const text = (res.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
      const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
      const intent = ['plan', 'approve', 'connect', 'unknown'].includes(json.intent) ? json.intent : undefined;
      const fields: Interpretation['fields'] = {};
      for (const k of ['vertical', 'category', 'monthlyBudget', 'goal', 'emergency', 'cities', 'businessName'] as const) {
        if (json[k] !== undefined) (fields as Record<string, unknown>)[k] = json[k];
      }
      // Trust the mock for intent when the model didn't commit, so approve/connect still work.
      const base = this.fallback.interpret(message, session);
      return { intent: intent ?? (Object.keys(fields).length ? 'plan' : base.intent), fields, connectApp: base.connectApp };
    } catch {
      return this.fallback.interpret(message, session);
    }
  }

  private async backend(): Promise<any> {
    if (this.client) return this.client;
    const importDynamic = new Function('m', 'return import(m)') as (m: string) => Promise<any>;
    const mod = await importDynamic('@anthropic-ai/sdk');
    const Anthropic = mod.default ?? mod.Anthropic ?? mod;
    this.client = new Anthropic({ apiKey: this.apiKey });
    return this.client;
  }
}
