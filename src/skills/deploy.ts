/**
 * Deployment — the difference between a skill a customer *has* and a skill that
 * is *working*. Reading a playbook in a modal changes nothing; deploying one
 * puts it on Miles' schedule so it runs itself on the cadence the skill file
 * declares, and its output lands in the approval queue.
 *
 * Two kinds deploy, because there are two kinds of skill:
 *
 *  - Miles' own skills are executable. Deploying one schedules it. Every run
 *    goes down the same path as a manual run, so it inherits every guardrail:
 *    proposal mode, an approval event before anything is applied, and the
 *    skill's own "never touch a winner" rules. Deploying grants a cadence,
 *    never authority — a deployed skill still cannot move a dollar on its own.
 *
 *  - The library frameworks are instructions, not programs. Deploying one adds
 *    it to the set Miles writes with, and the most relevant ones are loaded
 *    into the prompt whenever it produces copy. That is a real change in the
 *    output, which is why the active set is capped: eight frameworks in the
 *    prompt is guidance, eighty is noise.
 */
import { readSkill } from './library.js';

export type Cadence = 'daily' | 'weekly' | 'monthly';

export interface DeployedSkill {
  key: string;
  name: string;
  cadence: Cadence;
  deployedAt: string;
  lastRunAt?: string;
  /** How many times the schedule has run it since deployment. */
  runs: number;
}

/** How many library frameworks may be active at once, and how many reach one prompt. */
export const MAX_ACTIVE_FRAMEWORKS = 8;
export const FRAMEWORKS_PER_PROMPT = 3;
export const MAX_DEPLOYED_SKILLS = 40;
/** Characters of a framework's playbook loaded into a prompt. */
const FRAMEWORK_BUDGET = 900;

const MS = { daily: 20 * 3_600_000, weekly: 6.5 * 86_400_000, monthly: 27 * 86_400_000 } as const;

/**
 * The cadence a skill asks for, read from its own "Trigger:" line. A skill that
 * names no cadence gets weekly — often enough to be useful, rare enough not to
 * bury the owner in proposals.
 */
export function parseCadence(md: string): Cadence {
  const line = /^\s*Trigger:\s*(.+)$/im.exec(md)?.[1]?.toLowerCase() ?? '';
  if (/\bdaily\b|\beach day\b|\bevery day\b/.test(line)) return 'daily';
  if (/\bmonthly\b|\bevery month\b|\bquarterly\b/.test(line)) return 'monthly';
  return 'weekly';
}

/** The cadence for one skill key, straight from its SKILL.md. */
export function cadenceFor(key: string): Cadence {
  const md = readSkill(key)?.content;
  return md ? parseCadence(md) : 'weekly';
}

/**
 * Due when enough time has passed since the last run. Elapsed time rather than
 * a wall-clock slot, so a customer's timezone can never make a skill run twice
 * or skip a month.
 */
export function isSkillDue(s: DeployedSkill, now: Date): boolean {
  const last = Date.parse(s.lastRunAt ?? s.deployedAt);
  if (!Number.isFinite(last)) return true;
  return now.getTime() - last >= MS[s.cadence];
}

/** Plain-English cadence, for the deployed list. */
export function cadenceLabel(c: Cadence): string {
  return c === 'daily' ? 'Runs daily' : c === 'monthly' ? 'Runs monthly' : 'Runs weekly';
}

/** Read back whatever is on the account, dropping anything malformed. */
export function normalizeDeployed(raw: unknown): DeployedSkill[] {
  if (!Array.isArray(raw)) return [];
  const out: DeployedSkill[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const key = typeof o.key === 'string' ? o.key : '';
    if (!key || key.length > 64 || seen.has(key)) continue;
    const cadence = o.cadence === 'daily' || o.cadence === 'monthly' ? o.cadence : 'weekly';
    seen.add(key);
    out.push({
      key,
      name: typeof o.name === 'string' ? o.name.slice(0, 120) : key,
      cadence,
      deployedAt: typeof o.deployedAt === 'string' ? o.deployedAt : new Date(0).toISOString(),
      lastRunAt: typeof o.lastRunAt === 'string' ? o.lastRunAt : undefined,
      runs: Number.isFinite(Number(o.runs)) ? Math.max(0, Math.min(100_000, Number(o.runs))) : 0,
    });
    if (out.length >= MAX_DEPLOYED_SKILLS) break;
  }
  return out;
}

/** Active framework names, deduped and capped. */
export function normalizeFrameworks(raw: unknown, known: (n: string) => boolean): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (typeof r !== 'string' || seen.has(r) || !known(r)) continue;
    seen.add(r); out.push(r);
    if (out.length >= MAX_ACTIVE_FRAMEWORKS) break;
  }
  return out;
}

/** Everything below the YAML frontmatter — the playbook itself. */
export function playbookBody(md: string): string {
  return md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
}

/**
 * Score a framework against the job at hand. Word overlap is crude, but the
 * alternative is loading all eight into every prompt, which drowns the brief
 * the copy is actually supposed to serve.
 */
export function scoreFramework(name: string, body: string, topic: string): number {
  const words = new Set((topic.toLowerCase().match(/[a-z]{4,}/g) ?? []).slice(0, 40));
  if (!words.size) return 0;
  const hay = (name + ' ' + body.slice(0, 1200)).toLowerCase();
  let score = 0;
  for (const w of words) {
    if (name.toLowerCase().includes(w)) score += 3;
    else if (hay.includes(w)) score += 1;
  }
  return score;
}

/**
 * The block appended to a system prompt: the most relevant active frameworks,
 * trimmed. Returns '' when nothing is deployed, so a prompt is only ever
 * changed by a deployment the owner actually made.
 */
export function frameworkGuidance(active: string[], topic: string, limit = FRAMEWORKS_PER_PROMPT): string {
  if (!active.length) return '';
  const loaded = active
    .map((name) => {
      const md = readSkill(name)?.content;
      return md ? { name, body: playbookBody(md) } : null;
    })
    .filter((x): x is { name: string; body: string } => !!x);
  if (!loaded.length) return '';
  const ranked = loaded
    .map((f) => ({ ...f, score: scoreFramework(f.name, f.body, topic) }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, Math.max(1, limit));
  const blocks = ranked.map((f) => `## ${f.name}\n${f.body.slice(0, FRAMEWORK_BUDGET).trim()}`);
  return `\n\nApply the frameworks this business has deployed. Follow them where they apply to this task and ignore the parts that do not; never mention them or their names in the output.\n\n${blocks.join('\n\n')}`;
}
