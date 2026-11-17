import { describe, expect, it } from 'vitest';
import { buildCampaignSpec } from '../src/agents/campaign.js';
import { enforceRulebook } from '../src/agents/rulebook.js';
import { buildSearchAssets, buildMetaAssets } from '../src/creative/tospec.js';
import { buildSkillsBoard } from '../src/dashboard/skillsboard.js';
import { unvouchedClaim, vouchedLines } from '../src/agents/claims.js';

const TRADES = ['Roofing', 'HVAC', 'Plumbing', 'Electrical', 'Painting', 'Solar', 'Landscaping'];

/**
 * Facts about a business that only its owner can vouch for. An ad that states
 * one the owner never gave us is a false claim made in their name, and the
 * platform's misrepresentation policy lands on their account, not ours.
 */
const UNVOUCHED = /licen[sc]ed|insured|bonded|certified|\b5[- ]star|\brated\b|review(ed|s)?\b|guarantee|warrant|award|#1|\bbest\b|\bfree\b|locally owned|family[- ]owned|years (of|in)|since \d{4}|neighbou?rs already|\$\d|\d+% off/i;

const strings = (value: unknown, out: string[] = []): string[] => {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  // Negative keywords are searches to skip ("free", "cheap"), not ad text.
  else if (value && typeof value === 'object') Object.entries(value).forEach(([k, v]) => { if (!/url|path|negative/i.test(k)) strings(v, out); });
  return out;
};

describe('default ad copy makes no claim the owner did not give us', () => {
  for (const trade of TRADES) {
    it(`${trade}: Google Search campaign, before and after the rulebook fills it`, () => {
      const ctx = { business: `Ace ${trade}`, trade, city: 'Little Rock', services: '', offers: '' };
      const spec = buildCampaignSpec({ goal: `Get more ${trade} customers`, finalUrl: 'https://ace.example', locations: ['Little Rock, AR'] }, ctx);
      const filled = enforceRulebook(spec, { city: 'Little Rock' }).spec;
      for (const line of [...strings(spec), ...strings(filled)]) expect(line, line).not.toMatch(UNVOUCHED);
    });

    it(`${trade}: Ad Studio search and social packs`, () => {
      const input = { trade: trade.toLowerCase(), city: 'Little Rock', business: `Ace ${trade}`, services: [] as string[] };
      const lines = [...strings(buildSearchAssets(input as never)), ...strings(buildMetaAssets(input as never))];
      expect(lines.length).toBeGreaterThan(10);
      for (const line of lines) expect(line, line).not.toMatch(UNVOUCHED);
    });
  }

  it('keeps an offer the owner did enter', () => {
    const spec = buildSearchAssets({ trade: 'roofing', city: 'Little Rock', business: 'Ace Roofing', offer: 'Free roof inspection' } as never);
    expect(strings(spec).some((line) => /Free roof inspection/i.test(line))).toBe(true);
  });
});

describe('every advertised trade is recognised as the account\'s own', () => {
  for (const trade of TRADES) {
    it(`${trade} gets its own playbook card`, () => {
      const mine = buildSkillsBoard({ trade }).cards.filter((card) => card.yours);
      expect(mine.map((card) => card.title)).toEqual([`${trade} playbook`]);
      const loaded = mine[0]!.lines.find((line) => line.label === 'Loaded playbook')!.text;
      expect(loaded).toContain(`Miles ${trade} Playbook`);
    });
  }

  it('marks nothing as yours for a trade Miles has no playbook for', () => {
    expect(buildSkillsBoard({ trade: 'Dental' }).cards.filter((card) => card.group === 'playbook' && card.yours)).toEqual([]);
  });
});

describe('copy written by a model keeps a claim only when the owner made it', () => {
  it('drops the stock claims a model adds on its own', () => {
    const lines = ['Roof Repair In Little Rock', 'Licensed & Insured Roofers', '5-Star Rated Locally', 'Free Estimates Today', 'Satisfaction Guaranteed', '#1 Roofer In Town', '20+ Years Experience', 'Call For A Visit'];
    expect(vouchedLines(lines)).toEqual(['Roof Repair In Little Rock', 'Call For A Visit']);
  });

  it('keeps a claim the profile itself states', () => {
    const owner = 'Ace Roofing. Licensed and insured. Free roof inspection. Family-owned since 2009.';
    expect(unvouchedClaim('Licensed & Insured Roofers', owner)).toBeNull();
    expect(unvouchedClaim('Free Roof Inspection', owner)).toBeNull();
    expect(unvouchedClaim('Family-Owned Since 2009', owner)).toBeNull();
    // And still refuses the ones it does not.
    expect(unvouchedClaim('5-Star Rated Locally', owner)).toBe('rated');
    expect(unvouchedClaim('Lifetime Warranty', owner)).toBe('warranty');
  });
});
