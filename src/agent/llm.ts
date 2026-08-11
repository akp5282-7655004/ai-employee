import { MockInterpreter, type Interpretation, type Interpreter } from './intent.js';
import type { Session } from './types.js';

/**
 * The LLM-backed interpreter — real natural-language understanding for the
 * same `Interpreter` seam the mock implements (docs/VISION.md §3). It extracts
 * the intake fields and intent from messier phrasing than the regex parser can
 * handle, and the whole agent loop, planner, and connector underneath stay
 * unchanged.
 *
 * It speaks to either backend, preferring OpenRouter so the whole product can
 * run vendor-agnostic on one key and one bill (the Model Router's whole point):
 *  - OPENROUTER_API_KEY → OpenRouter's OpenAI-compatible API over plain `fetch`
 *    (no SDK dependency at all). Model is OPENROUTER_MODEL or a cheap default.
 *  - ANTHROPIC_API_KEY → the Anthropic SDK, loaded dynamically so the project
 *    ships without the dependency until this path is switched on.
 * Every call falls back to the deterministic MockInterpreter if no key is set,
 * the backend is unreachable, or the model errors — so the product never
 * hard-depends on the LLM being up.
 */
export interface LlmOptions {
  apiKey?: string;
  model?: string;
  openrouterKey?: string;
  openrouterModel?: string;
}

/** Default OpenRouter model for the interpreter — cheap, stable, good at instructions. */
const DEFAULT_OR_MODEL = 'openai/gpt-4o-mini';

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
  readonly name: string;
  private fallback = new MockInterpreter();
  private client: any | null = null;
  private model: string;
  private apiKey?: string;
  private openrouterKey?: string;
  private openrouterModel: string;

  constructor(opts: LlmOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
    this.model = opts.model ?? process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5-20251001';
    this.openrouterKey = opts.openrouterKey ?? process.env.OPENROUTER_API_KEY;
    this.openrouterModel = opts.openrouterModel ?? process.env.OPENROUTER_MODEL ?? DEFAULT_OR_MODEL;
    // OpenRouter wins when present — one key, every vendor.
    this.name = this.openrouterKey ? 'openrouter' : 'claude';
  }

  /** Interpreter is sync; callers that want the LLM use interpretAsync. */
  interpret(message: string, session: Session): Interpretation {
    return this.fallback.interpret(message, session);
  }

  async interpretAsync(message: string, session: Session): Promise<Interpretation> {
    if (!this.openrouterKey && !this.apiKey) return this.fallback.interpret(message, session);
    try {
      const text = this.openrouterKey ? await this.viaOpenRouter(message) : await this.viaAnthropic(message);
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

  /** OpenRouter's OpenAI-compatible chat-completions API — plain fetch, no SDK. */
  private async viaOpenRouter(message: string): Promise<string> {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.openrouterKey}`,
        'content-type': 'application/json',
        'HTTP-Referer': 'https://miles.ai',
        'X-Title': 'Miles',
      },
      body: JSON.stringify({
        model: this.openrouterModel,
        max_tokens: 400,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: message },
        ],
      }),
    });
    if (!res.ok) throw new Error(`openrouter ${res.status}`);
    const data: any = await res.json();
    return data?.choices?.[0]?.message?.content ?? '';
  }

  /** The Anthropic SDK path, loaded dynamically so it isn't a hard dependency. */
  private async viaAnthropic(message: string): Promise<string> {
    const client = await this.backend();
    const res = await client.messages.create({
      model: this.model,
      max_tokens: 400,
      system: SYSTEM,
      messages: [{ role: 'user', content: message }],
    });
    return (res.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
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
