import { describe, expect, it } from 'vitest';
import {
  briefFromSelection, buildLibrary, filterLibrary, hookTraits, libraryFacets,
  readSelection, writeSelection, SELECTION_CAP, type LibraryAd,
} from '../src/research/library.js';
import type { CompetitorAd } from '../src/research/adlibrary.js';

let n = 0;
const ad = (body: string, days: number, page = 'Acme Roofing'): CompetitorAd =>
  ({ id: `a${n++}`, page, body, platforms: ['facebook'], daysRunning: days });

describe('building the library', () => {
  it('labels each ad with its offer and the evidence for it', () => {
    const lib = buildLibrary([ad('0% APR financing on a new roof', 30)]);
    expect(lib[0]).toMatchObject({ offerKind: 'financing', offerLabel: 'Financing / monthly payments' });
    // The evidence is the exact substring that triggered the classification, so
    // it can be checked against the ad — here the regex fires on "0% APR".
    expect(lib[0]!.offerEvidence).toBe('0% APR');
    expect(lib[0]!.body).toContain(lib[0]!.offerEvidence!);
  });

  it('ranks by how likely an ad is earning, but hides nothing', () => {
    const ads = [
      ad('Proudly serving Philadelphia', 400, 'OldCo'),
      ...Array.from({ length: 4 }, () => ad('0% APR financing on a new roof', 45, 'ScaleCo')),
    ];
    const lib = buildLibrary(ads);
    expect(lib[0]!.page).toBe('ScaleCo');       // replication outranks age
    expect(lib[0]!.confidence).toBe('strong');
    expect(lib).toHaveLength(5);                 // the weak one is ranked last, not filtered out
    expect(lib.at(-1)!.page).toBe('OldCo');
  });

  it('carries the selected flag through', () => {
    const ads = [ad('0% APR financing', 30)];
    expect(buildLibrary(ads, [])[0]!.selected).toBe(false);
    expect(buildLibrary(ads, [ads[0]!.id])[0]!.selected).toBe(true);
  });
});

describe('browsing', () => {
  const lib = () => buildLibrary([
    ad('0% APR financing on a new roof', 40, 'Acme'),
    ad('Free estimate today', 12, 'Bravo'),
    ad('Free estimate on any job', 5, 'Acme'),
  ]);

  it('filters by advertiser, offer type and age', () => {
    expect(filterLibrary(lib(), { advertiser: 'Acme' })).toHaveLength(2);
    expect(filterLibrary(lib(), { kind: 'free_estimate' })).toHaveLength(2);
    expect(filterLibrary(lib(), { minDays: 20 })).toHaveLength(1);
  });

  it('can show only what has been picked', () => {
    const l = lib();
    l[0]!.selected = true;
    expect(filterLibrary(l, { selectedOnly: true })).toHaveLength(1);
  });

  it('builds its facets from what is actually there', () => {
    const f = libraryFacets(lib());
    expect(f.advertisers[0]).toEqual({ name: 'Acme', count: 2 });
    expect(f.kinds.map((k) => k.kind)).toContain('financing');
  });
});

describe('reading the hook', () => {
  it('spots the structural traits worth copying', () => {
    expect(hookTraits('Need a new roof?')).toMatchObject({ question: true });
    expect(hookTraits('Save $500 today')).toMatchObject({ numbers: true, urgency: true });
    expect(hookTraits('Backed by our workmanship warranty')).toMatchObject({ guarantee: true });
    expect(hookTraits('Serving Philadelphia homeowners')).toMatchObject({ local: true });
  });
});

describe('what a selection means', () => {
  const pick = (bodies: string[]): LibraryAd[] =>
    buildLibrary(bodies.map((b, i) => ad(b, 30, `Co${i}`))).map((a) => ({ ...a, selected: true }));

  it('names the dominant offer type when one clearly leads', () => {
    const b = briefFromSelection(pick([
      '0% APR financing on a new roof',
      'Monthly payments available on any install',
      'Free estimate today',
    ]), 'roofing')!;
    expect(b.leadKind).toBe('financing');
    expect(b.reading).toMatch(/most of what you picked/i);
  });

  it('refuses to call a plurality dominant when the picks are spread', () => {
    const b = briefFromSelection(pick([
      '0% APR financing on a new roof',
      'Free estimate today',
      'Backed by a 25-year warranty',
    ]), 'roofing')!;
    expect(b.leadKind).toBeNull();
    expect(b.reading).toMatch(/span 3 different offer types/i);
  });

  it('reports a trait only when most of the picks share it', () => {
    const b = briefFromSelection(pick([
      'Need a new roof? Free estimate today',
      'Thinking about a new roof? Free estimate today',
      'Free estimate on any roofing job',
    ]), 'roofing')!;
    expect(b.sharedTraits).toContain('opens with a question'); // 2 of 3
    const lonely = briefFromSelection(pick([
      'Need a new roof?',
      'Free estimate on any job',
      'Free estimate today',
      'Free estimate this week',
    ]), 'roofing')!;
    expect(lonely.sharedTraits).not.toContain('opens with a question'); // 1 of 4 is not a pattern
  });

  it('hands the generator the structure, never the competitor\'s words', () => {
    const b = briefFromSelection(pick([
      '0% APR financing on a new roof — no payments for 12 months',
      'Monthly payments available on any install',
    ]), 'roofing')!;
    expect(b.brief).not.toContain('no payments for 12 months');
    expect(b.brief).not.toContain('Co0');
    expect(b.brief).toMatch(/original copy/i);
    expect(b.brief).toMatch(/not imitate/i);
    expect(b.brief).toContain('roofing');
  });

  it('returns nothing when nothing is picked', () => {
    expect(briefFromSelection([], 'roofing')).toBeNull();
  });

  it('reads traits as a sentence, not a chain of "and"s', () => {
    const b = briefFromSelection(pick([
      'Need a new roof? Save $500 — book by Friday',
      'Thinking about a new roof? Save $500 — limited slots',
    ]), 'roofing')!;
    expect(b.sharedTraits.length).toBeGreaterThan(2);
    // The trait list reads "a, b and c" — never "a and b and c".
    const shape = b.reading.split('Each one ')[1]!;
    expect(shape).not.toMatch(/ and .* and /);
    expect(shape).toMatch(/, .* and /);
    // Offer type and structure are separate findings, so separate sentences.
    expect(b.reading).toMatch(/\. Each one /);
  });
});

describe('storing the selection', () => {
  it('round-trips, de-duplicates, and caps', () => {
    const data: Record<string, unknown> = {};
    writeSelection(data, ['a', 'b', 'a']);
    expect(readSelection(data)).toEqual(['a', 'b']);
    writeSelection(data, Array.from({ length: SELECTION_CAP + 10 }, (_, i) => `x${i}`));
    expect(readSelection(data)).toHaveLength(SELECTION_CAP);
  });

  it('reads an empty selection from an account that has picked nothing', () => {
    expect(readSelection({})).toEqual([]);
    expect(readSelection({ librarySelection: 'nonsense' })).toEqual([]);
  });
});
