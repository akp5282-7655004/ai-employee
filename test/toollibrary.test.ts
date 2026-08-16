import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Script } from 'node:vm';

const dir = join(process.cwd(), 'skills-library', 'tools');

describe('vendored marketing CLI tools', () => {
  it('registry and directories are present', () => {
    expect(existsSync(join(dir, 'REGISTRY.md'))).toBe(true);
    expect(existsSync(join(dir, 'integrations'))).toBe(true);
  });

  it('every CLI parses as valid JavaScript and never embeds a credential', () => {
    const clis = readdirSync(join(dir, 'clis')).filter((f) => f.endsWith('.js'));
    expect(clis.length).toBeGreaterThanOrEqual(50);
    for (const f of clis) {
      const src = readFileSync(join(dir, 'clis', f), 'utf8');
      expect(() => new Script(src, { filename: f })).not.toThrow();
      // keys must come from env vars, never hardcoded
      expect(src, f).not.toMatch(/(api[_-]?key|token)\s*[:=]\s*["'][A-Za-z0-9_\-]{20,}["']/i);
    }
  });
});
