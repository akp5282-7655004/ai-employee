import { describe, expect, it } from 'vitest';
import {
  cadenceFor, cadenceLabel, frameworkGuidance, isSkillDue, MAX_ACTIVE_FRAMEWORKS, MAX_DEPLOYED_SKILLS,
  normalizeDeployed, normalizeFrameworks, parseCadence, playbookBody, scoreFramework, type DeployedSkill,
} from '../src/skills/deploy.js';

describe('parseCadence', () => {
  it('reads the cadence a skill asks for in its own Trigger line', () => {
    expect(parseCadence('# X\nTrigger: monthly, "which headlines work".')).toBe('monthly');
    expect(parseCadence('Trigger: weekly readout of spend.')).toBe('weekly');
    expect(parseCadence('Trigger: daily, each morning.')).toBe('daily');
  });
  it('falls back to weekly when no cadence is stated', () => {
    expect(parseCadence('Trigger: "improve my ad copy".')).toBe('weekly');
    expect(parseCadence('no trigger line at all')).toBe('weekly');
  });
  it('reads the real skill files on disk', () => {
    expect(cadenceFor('ad-copy-performance-ranker')).toBe('monthly');
    expect(cadenceFor('cpl-funnel-reader')).toBe('weekly');
  });
  it('does not throw on a skill that does not exist', () => {
    expect(cadenceFor('not-a-real-skill')).toBe('weekly');
  });
});

const at = (iso: string): DeployedSkill => ({ key: 'k', name: 'K', cadence: 'weekly', deployedAt: iso, lastRunAt: iso, runs: 1 });

describe('isSkillDue', () => {
  const now = new Date('2026-08-18T12:00:00Z');
  it('is not due before its cadence has elapsed', () => {
    expect(isSkillDue(at('2026-08-16T12:00:00Z'), now)).toBe(false);
  });
  it('is due once the cadence has elapsed', () => {
    expect(isSkillDue(at('2026-08-10T12:00:00Z'), now)).toBe(true);
  });
  it('holds a monthly skill for the month', () => {
    const m: DeployedSkill = { ...at('2026-08-01T12:00:00Z'), cadence: 'monthly' };
    expect(isSkillDue(m, now)).toBe(false);
    expect(isSkillDue({ ...m, lastRunAt: '2026-07-01T12:00:00Z' }, now)).toBe(true);
  });
  it('falls back to the deploy time when it has never run', () => {
    const never: DeployedSkill = { key: 'k', name: 'K', cadence: 'daily', deployedAt: '2026-08-18T11:00:00Z', runs: 0 };
    expect(isSkillDue(never, now)).toBe(false);
  });
  it('runs rather than stalls when the timestamps are garbage', () => {
    expect(isSkillDue({ ...at('not a date'), lastRunAt: 'nonsense' }, now)).toBe(true);
  });
  it('labels the cadence in words', () => {
    expect(cadenceLabel('monthly')).toBe('Runs monthly');
  });
});

describe('normalizeDeployed', () => {
  it('drops junk and duplicates', () => {
    const out = normalizeDeployed([
      { key: 'a', name: 'A', cadence: 'daily', deployedAt: '2026-01-01T00:00:00Z', runs: 3 },
      { key: 'a', name: 'A again' },
      null, 'nope', { name: 'no key' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.cadence).toBe('daily');
    expect(out[0]!.runs).toBe(3);
  });
  it('coerces an unknown cadence to weekly rather than trusting it', () => {
    expect(normalizeDeployed([{ key: 'a', cadence: 'hourly' }])[0]!.cadence).toBe('weekly');
  });
  it('caps how many can be deployed', () => {
    const many = Array.from({ length: MAX_DEPLOYED_SKILLS + 10 }, (_, i) => ({ key: 'k' + i }));
    expect(normalizeDeployed(many)).toHaveLength(MAX_DEPLOYED_SKILLS);
  });
  it('returns empty for anything that is not a list', () => {
    expect(normalizeDeployed(undefined)).toEqual([]);
    expect(normalizeDeployed({ key: 'a' })).toEqual([]);
  });
});

describe('normalizeFrameworks', () => {
  const known = (n: string) => n.startsWith('real');
  it('keeps only frameworks that exist', () => {
    expect(normalizeFrameworks(['real-a', 'made-up', 'real-b'], known)).toEqual(['real-a', 'real-b']);
  });
  it('dedupes and caps the active set', () => {
    const many = Array.from({ length: MAX_ACTIVE_FRAMEWORKS + 5 }, (_, i) => 'real' + i);
    expect(normalizeFrameworks([...many, 'real0'], known)).toHaveLength(MAX_ACTIVE_FRAMEWORKS);
  });
});

describe('playbookBody', () => {
  it('strips the YAML frontmatter, keeping the playbook', () => {
    expect(playbookBody('---\nname: x\n---\n# Title\nStep one.')).toBe('# Title\nStep one.');
  });
  it('leaves a file with no frontmatter alone', () => {
    expect(playbookBody('# Title\nStep one.')).toBe('# Title\nStep one.');
  });
});

describe('scoreFramework', () => {
  it('ranks a name match above a body mention', () => {
    const named = scoreFramework('landing-page-copy', 'generic advice', 'write landing copy');
    const mentioned = scoreFramework('pricing-strategy', 'talks about landing pages', 'write landing copy');
    expect(named).toBeGreaterThan(mentioned);
  });
  it('scores nothing against an empty topic', () => {
    expect(scoreFramework('anything', 'body', '')).toBe(0);
  });
});

describe('frameworkGuidance', () => {
  it('adds nothing when the owner has deployed nothing', () => {
    expect(frameworkGuidance([], 'write an ad')).toBe('');
  });
  it('loads a real deployed framework into the prompt', () => {
    const out = frameworkGuidance(['ad-copy-performance-ranker'], 'rank my ad copy headlines');
    expect(out).toContain('ad-copy-performance-ranker');
    expect(out).toContain('Ad Copy Performance Ranker');
    expect(out).not.toContain('---\nname:'); // frontmatter never reaches the prompt
  });
  it('tells the model not to name the frameworks in the output', () => {
    expect(frameworkGuidance(['loser-pauser'], 'pause losers')).toMatch(/never mention them/i);
  });
  it('caps how many reach one prompt', () => {
    const many = ['loser-pauser', 'budget-shifter', 'channel-comparator', 'cpl-funnel-reader', 'spend-pacing-monitor'];
    const out = frameworkGuidance(many, 'budget', 2);
    expect(out.match(/^## /gm)).toHaveLength(2);
  });
  it('ignores a framework that is not on disk instead of failing the prompt', () => {
    expect(frameworkGuidance(['does-not-exist'], 'anything')).toBe('');
  });
});
