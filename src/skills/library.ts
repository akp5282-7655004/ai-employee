/**
 * Marketing Skills Library — loader for the vendored Agent Skills collection
 * (skills-library/, MIT, from coreyhaines31/marketingskills) and for Miles'
 * own seven home-services skills (skills/). Both follow the Agent Skills
 * spec: a SKILL.md with YAML frontmatter (name, description, optional
 * metadata) plus optional references/.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface LibrarySkill {
  name: string;
  description: string;
  version?: string;
  source: 'library' | 'miles';
}

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  raw: Record<string, string>;
}

/** Parse the YAML frontmatter block of a SKILL.md (tolerant, flat keys only). */
export function parseFrontmatter(md: string): SkillFrontmatter {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  const raw: Record<string, string> = {};
  if (m?.[1]) {
    for (const line of m[1].split(/\r?\n/)) {
      const kv = /^([a-zA-Z_][\w-]*):\s*(.*)$/.exec(line);
      if (kv?.[1] && kv[2] !== undefined) {
        let v = kv[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        raw[kv[1]] = v;
      }
    }
  }
  return { name: raw.name, description: raw.description, raw };
}

const dirs = {
  library: () => join(process.cwd(), 'skills-library'),
  miles: () => join(process.cwd(), 'skills'),
};

let cache: LibrarySkill[] | undefined;

/** All skills, Miles' own first, then the vendored library alphabetically. */
export function listSkills(): LibrarySkill[] {
  if (cache) return cache;
  const scan = (dir: string, source: 'library' | 'miles'): LibrarySkill[] => {
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((d) => {
        try { return statSync(join(dir, d)).isDirectory() && existsSync(join(dir, d, 'SKILL.md')); } catch { return false; }
      })
      .sort()
      .map((d) => {
        const fm = parseFrontmatter(readFileSync(join(dir, d, 'SKILL.md'), 'utf8'));
        return { name: fm.name ?? d, description: fm.description ?? '', version: fm.raw.version, source };
      });
  };
  cache = [...scan(dirs.miles(), 'miles'), ...scan(dirs.library(), 'library')];
  return cache;
}

/** Read one skill's SKILL.md. Name is validated against the listing — no path tricks. */
export function readSkill(name: string): { name: string; source: string; content: string } | undefined {
  const entry = listSkills().find((s) => s.name === name);
  if (!entry || !/^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/.test(name)) return undefined;
  const file = join(dirs[entry.source](), name, 'SKILL.md');
  try {
    return { name, source: entry.source, content: readFileSync(file, 'utf8') };
  } catch {
    return undefined;
  }
}
