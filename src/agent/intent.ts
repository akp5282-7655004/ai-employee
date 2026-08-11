import type { PartialIntake, Session } from './types.js';

/**
 * Turning a plain-English message into intent + intake fields. This is the
 * *brain* seam (docs/VISION.md §3, §8): a deterministic heuristic interpreter
 * ships as the offline default and the regression baseline; an LLM interpreter
 * can later implement the same interface for real natural-language understanding,
 * with the whole loop underneath unchanged.
 */
export type Intent = 'plan' | 'approve' | 'connect' | 'action' | 'unknown';

/** Canonical tasks Miles can run inside a connected app (the "hands"). */
export type ActionOp = 'create_contact' | 'send_sms' | 'add_note' | 'add_tag' | 'other';

/**
 * A concrete "do this in my app" request, resolved from plain English. `app` is
 * a slug (gohighlevel, twilio, …); `params` are semantic — email/firstName/phone/
 * message/note/tag — and the connector maps them onto the real component's props.
 */
export interface AppAction {
  app: string;
  op: ActionOp;
  /** A short natural-language phrase used to discover the right app action. */
  query: string;
  params: Record<string, string>;
}

export interface Interpretation {
  intent: Intent;
  fields: PartialIntake;
  /** For a connect request, the app the user named (if any). */
  connectApp?: string;
  /** For an action request, the task to run in a connected app. */
  action?: AppAction;
}

/** App name/phrase → slug. Extend as more CRMs/tools are wired. */
const APP_ALIASES: Array<[RegExp, string]> = [
  [/\b(go\s*high\s*level|gohighlevel|ghl|highlevel|lead\s*connector)\b/i, 'gohighlevel'],
  [/\bhubspot\b/i, 'hubspot'],
  [/\bsalesforce\b/i, 'salesforce_rest_api'],
  [/\bservice\s*titan\b/i, 'servicetitan'],
  [/\bjobber\b/i, 'jobber'],
  [/\bhousecall\b/i, 'housecall_pro'],
  [/\btwilio\b/i, 'twilio'],
  [/\bmailchimp\b/i, 'mailchimp'],
  [/\bgoogle\s*sheets?\b/i, 'google_sheets'],
  [/\bslack\b/i, 'slack'],
];
export function appSlugFrom(text: string): string | undefined {
  for (const [re, slug] of APP_ALIASES) if (re.test(text)) return slug;
  return undefined;
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
  [/\b(paint|painter)/i, { vertical: 'home_services', category: 'painting' }],
  [/\broof/i, { vertical: 'home_services', category: 'roofing' }],
  [/\bgarage door/i, { vertical: 'home_services', category: 'garage_door' }],
  [/\b(pest|extermin)/i, { vertical: 'home_services', category: 'pest_control' }],
  [/\b(landscap|lawn care)/i, { vertical: 'home_services', category: 'landscaping' }],
  [/\b(remodel|renovat)/i, { vertical: 'home_services', category: 'remodeling' }],
];

export class MockInterpreter implements Interpreter {
  readonly name = 'mock';

  interpret(message: string, _session: Session): Interpretation {
    // Strip URLs so a pasted website doesn't drown out the real signal.
    const t = message.replace(/https?:\/\/\S+/gi, ' ').trim();
    const low = t.toLowerCase();

    if (/^(y|yes|yep|approve|approved|launch it|do it|go ahead|ship it|confirm)\b/.test(low)) {
      return { intent: 'approve', fields: {} };
    }
    const action = this.parseAction(t, low);
    if (action) return { intent: 'action', fields: {}, action };

    if (/\bconnect\b/.test(low)) {
      return { intent: 'connect', fields: {}, connectApp: this.parseApp(low) };
    }

    const fields = this.parseFields(t, low);
    // If we learned anything plan-relevant, treat it as a planning turn.
    const learned = Object.keys(fields).length > 0;
    return { intent: learned ? 'plan' : 'unknown', fields };
  }

  /**
   * Detect a "do this in my app" request. Returns an AppAction only when the
   * message clearly names a task verb + object (add contact / send text / add
   * note / add tag), so ordinary planning talk ("get me more calls") never trips it.
   */
  private parseAction(t: string, low: string): AppAction | undefined {
    const app = appSlugFrom(low);
    let op: ActionOp | undefined;
    let query = '';
    if (/\b(add|create|new|make|save)\b[^.]*\b(contact|lead|customer|client|person)\b/.test(low)) {
      op = 'create_contact';
      query = 'create contact';
    } else if (/\b(send|text|shoot)\b[^.]*\b(text|sms|message)\b/.test(low) || (/\btext\b/.test(low) && /\bphone|\+?\d[\d\s().-]{7,}/.test(low))) {
      op = 'send_sms';
      query = 'send SMS';
    } else if (/\b(add|leave|create|write)\b[^.]*\bnote\b/.test(low)) {
      op = 'add_note';
      query = 'create note';
    } else if (/\b(add|apply|put)\b[^.]*\b(tag|label)\b/.test(low) || /\btag\s+(them|it|this|the|as|contact|lead|\w+\s+(?:as|with))/.test(low)) {
      op = 'add_tag';
      query = 'add tag';
    } else if (/\b(email\s*(marketing\s*)?campaign|newsletter|email\s*sequence|drip\s*campaign|nurture\s*sequence)\b/.test(low)) {
      // A "build content" request — no app runs it as one action; the loop builds the content.
      op = 'other';
      query = /newsletter/.test(low) ? 'newsletter' : 'email marketing campaign';
    }
    if (!op) return undefined;
    // Require either a named app or an unambiguous CRM verb so we don't hijack planning turns.
    if (!app && op === 'create_contact' && !/\b(crm|contact|lead)\b/.test(low)) return undefined;

    const params = this.parseActionParams(t);
    return { app: app ?? 'gohighlevel', op, query, params };
  }

  private parseActionParams(t: string): Record<string, string> {
    const p: Record<string, string> = {};
    const email = t.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    if (email) p.email = email[0];
    const phone = t.match(/\+?\d[\d\s().-]{7,}\d/);
    if (phone) p.phone = phone[0].trim();
    // "name - Miles Employee", "name: Miles Employee", "named Miles Employee", "name is Miles"
    const name = t.match(/\bnamed?\s*(?:is|[-:])?\s*["“]?([A-Za-z][\w'.-]*(?:\s+[A-Za-z][\w'.-]*){0,3})["”]?/i);
    if (name) {
      const full = name[1]!.trim();
      p.name = full;
      const parts = full.split(/\s+/);
      p.firstName = parts[0]!;
      if (parts.length > 1) p.lastName = parts.slice(1).join(' ');
    }
    // message / note body: after "saying", "that says", or in quotes
    const body = t.match(/\b(?:saying|that says|message|note)\s*[:-]?\s*["“]([^"”]+)["”]/i) || t.match(/["“]([^"”]{3,})["”]/);
    if (body) {
      p.message = body[1]!.trim();
      p.note = body[1]!.trim();
    }
    // tag value: "tag them VIP", "add tag VIP"
    const tag = t.match(/\b(?:tag|label)\s+(?:them\s+|it\s+|as\s+)?["“]?([A-Za-z][\w -]{1,30})["”]?/i);
    if (tag && !/\b(tag|label)s?\b/i.test(tag[1]!)) p.tag = tag[1]!.trim();
    return p;
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
