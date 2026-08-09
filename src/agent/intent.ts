import type { PartialIntake, Session } from './types.js';

/**
 * Turning a plain-English message into intent + intake fields. This is the
 * *brain* seam (docs/VISION.md §3, §8): a deterministic heuristic interpreter
 * ships as the offline default and the regression baseline; an LLM interpreter
 * can later implement the same interface for real natural-language understanding,
 * with the whole loop underneath unchanged.
 */
export type Intent = 'plan' | 'approve' | 'connect' | 'unknown';

export interface Interpretation {
  intent: Intent;
  fields: PartialIntake;
  /** For a connect request, the app the user named (if any). */
  connectApp?: string;
}

export interface Interpreter {
  readonly name: string;
  interpret(message: string, session: Session): Interpretation;
  /** Optional async path (e.g. an LLM). The loop prefers it when present. */
  interpretAsync?(message: string, session: Session): Promise<Interpretation>;
}

const CATEGORY_KEYWORDS: Array<[RegExp, { vertical: string; category: string }]> = [
  [/\b(invisalign|braces|orthodont)/i, { vertical: 'dental', category: 'orthodontics' }],
  [/\bimplant/i, { vertical: 'dental', category: 'implants' }],
  [/\b(veneer|whiten|cosmetic dent)/i, { vertical: 'dental', category: 'cosmetic' }],
  [/\bemergency (dentist|dental)/i, { vertical: 'dental', category: 'emergency_dental' }],
  [/\b(dentist|dental|teeth|tooth)/i, { vertical: 'dental', category: 'general' }],
  [/\b(water damage|restoration|flood)/i, { vertical: 'home_services', category: 'water_damage' }],
  [/\b(plumb|drain|sewer|water heater)/i, { vertical: 'home_services', category: 'plumbing' }],
  [/\b(hvac|air.?condition|\bac\b|furnace|heating|cooling)/i, { vertical: 'home_services', category: 'hvac' }],
  [/\b(electric|panel upgrade|wiring)/i, { vertical: 'home_services', category: 'electrical' }],
  [/\broof/i, { vertical: 'home_services', category: 'roofing' }],
  [/\bgarage door/i, { vertical: 'home_services', category: 'garage_door' }],
  [/\b(pest|extermin)/i, { vertical: 'home_services', category: 'pest_control' }],
  [/\b(landscap|lawn care)/i, { vertical: 'home_services', category: 'landscaping' }],
  [/\b(remodel|renovat)/i, { vertical: 'home_services', category: 'remodeling' }],
];

export class MockInterpreter implements Interpreter {
  readonly name = 'mock';

  interpret(message: string, _session: Session): Interpretation {
    const t = message.trim();
    const low = t.toLowerCase();

    if (/^(y|yes|yep|approve|approved|launch it|do it|go ahead|ship it|confirm)\b/.test(low)) {
      return { intent: 'approve', fields: {} };
    }
    if (/\bconnect\b/.test(low)) {
      return { intent: 'connect', fields: {}, connectApp: this.parseApp(low) };
    }

    const fields = this.parseFields(t, low);
    // If we learned anything plan-relevant, treat it as a planning turn.
    const learned = Object.keys(fields).length > 0;
    return { intent: learned ? 'plan' : 'unknown', fields };
  }

  private parseFields(t: string, low: string): PartialIntake {
    const fields: PartialIntake = {};

    for (const [re, cat] of CATEGORY_KEYWORDS) {
      if (re.test(low)) {
        fields.vertical = cat.vertical;
        fields.category = cat.category;
        break;
      }
    }

    const budget = this.parseBudget(low);
    if (budget !== undefined) fields.monthlyBudget = budget;

    if (/higher.?ticket|bigger job|high.?value|expensive job|more revenue/.test(low)) fields.goal = 'higher_ticket';
    else if (/\b(brand|awareness)\b/.test(low)) fields.goal = 'awareness';
    else if (/fill (the )?(schedule|calendar)|keep .*busy|book(ings)?\b/.test(low)) fields.goal = 'fill_schedule';
    else if (/more (call|lead|job|customer|client)|phone .*ring/.test(low)) fields.goal = 'more_calls';

    if (/24\s*\/?\s*7|emergency|same.?day|urgent/.test(low)) fields.emergency = true;

    const cities = this.parseCities(t);
    if (cities.length) fields.cities = cities;

    const name = this.parseName(t);
    if (name) fields.businessName = name;

    return fields;
  }

  private parseBudget(low: string): number | undefined {
    // "$3k", "$3,000", "3000 a month", "budget of 5000", "3k/mo"
    const m =
      low.match(/\$\s?(\d[\d,]*(?:\.\d+)?)\s*(k)?/i) ||
      low.match(/(\d[\d,]*(?:\.\d+)?)\s*(k)?\s*(?:\/\s*mo|per month|a month|monthly|month|budget)/i);
    if (!m) return undefined;
    let n = parseFloat(m[1]!.replace(/,/g, ''));
    if (m[2]) n *= 1000;
    return Math.round(n);
  }

  private parseCities(t: string): string[] {
    const m = t.match(/\bin ([A-Z][a-zA-Z.-]+(?:\s+[A-Z][a-zA-Z.-]+)*(?:,\s*[A-Z][a-zA-Z.-]+)*)/);
    if (!m) return [];
    return m[1]!
      .split(/,|\band\b/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 3);
  }

  private parseName(t: string): string | undefined {
    // "I run <Name>", "my business is <Name>", or a quoted name.
    const q = t.match(/["“]([^"”]{2,60})["”]/);
    if (q) return q[1];
    const m = t.match(/\b(?:i run|we're|we are|business (?:is|called)|company (?:is|called)|shop (?:is|called))\s+([A-Z][\w&'.-]*(?:\s+[A-Z][\w&'.-]*){0,4})/);
    return m?.[1];
  }

  private parseApp(low: string): string | undefined {
    if (/google ads|adwords/.test(low)) return 'google_ads';
    if (/facebook|meta|instagram/.test(low)) return 'facebook_ads';
    if (/business profile|gmb|google my business|maps/.test(low)) return 'google_my_business';
    if (/local service|lsa/.test(low)) return 'google_lsa';
    return undefined;
  }
}
