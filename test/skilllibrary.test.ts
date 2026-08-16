import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { listSkills, readSkill, parseFrontmatter } from '../src/skills/library.js';

describe('skills library loader', () => {
  const all = listSkills();

  it('loads the vendored library plus Miles seven skills', () => {
    expect(all.filter((s) => s.source === 'miles').length).toBe(11);
    expect(all.filter((s) => s.source === 'library').length).toBeGreaterThanOrEqual(45);
  });

  it('reads a skill by name and refuses unknown/path-trick names', () => {
    expect(readSkill('copywriting')?.content).toContain('name: copywriting');
    expect(readSkill('campaign-launcher')?.source).toBe('miles');
    expect(readSkill('../secrets')).toBeUndefined();
    expect(readSkill('nope-nope')).toBeUndefined();
  });
});

describe('Agent Skills spec compliance (validate-skills rules)', () => {
  const all = listSkills();

  it('every skill has a valid name matching its directory', () => {
    for (const s of all) {
      expect(s.name, s.name).toMatch(/^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/);
      const dir = s.source === 'miles' ? 'skills' : 'skills-library';
      const md = readFileSync(join(process.cwd(), dir, s.name, 'SKILL.md'), 'utf8');
      expect(parseFrontmatter(md).name).toBe(s.name);
    }
  });

  it('every skill has a description within 1-1024 chars', () => {
    for (const s of all) {
      expect(s.description.length, s.name).toBeGreaterThan(0);
      expect(s.description.length, s.name).toBeLessThanOrEqual(1024);
    }
  });

  it("Miles' own skills carry trigger phrasing and version metadata", () => {
    for (const s of all.filter((x) => x.source === 'miles')) {
      expect(s.description.toLowerCase(), s.name).toMatch(/when|use/);
      const md = readFileSync(join(process.cwd(), 'skills', s.name, 'SKILL.md'), 'utf8');
      expect(md).toMatch(/version: \d+\.\d+\.\d+/);
    }
  });
});
