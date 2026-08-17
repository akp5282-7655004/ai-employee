import { describe, expect, it } from 'vitest';
import {
  extractOffer, offerBrief, offerMix, readWinners, survivalByOfferKind,
  MIN_ADS_FOR_SURVIVAL, OFFER_KINDS,
} from '../src/research/offers.js';
import type { CompetitorAd } from '../src/research/adlibrary.js';

let n = 0;
const ad = (body: string, days: number, page = 'Acme Roofing'): CompetitorAd => ({
  id: `a${n++}`, page, body, platforms: ['facebook'], daysRunning: days,
});

describe('reading the offer out of an ad', () => {
  it('finds each home-services offer kind, with the evidence that triggered it', () => {
    const cases: [string, string][] = [
      ['0% APR financing on a new roof', 'financing'],
      ['Pay as low as $99/month for a new HVAC system', 'financing'],
      ['Free roof inspection after the storm', 'free_inspection'],
      ['Get your free estimate today', 'free_estimate'],
      ['Spring AC tune-up special', 'seasonal_tuneup'],
      ['Backed by a 25-year warranty', 'warranty'],
      ['Save 15% off your first service', 'percent_off'],
      ['$500 off a full roof replacement', 'dollar_off'],
      ['Gutter cleaning starting at $199', 'price_anchor'],
      ['Limited time — book by Friday', 'urgency'],
      ['Rated 4.9 stars by 1,200 homeowners', 'social_proof'],
    ];
    for (const [text, kind] of cases) {
      const got = extractOffer(text);
      expect(got.kind, text).toBe(kind);
      expect(got.evidence, text).toBeTruthy();
    }
  });

  it('calls an ad with no ask branding_only rather than guessing at one', () => {
    expect(extractOffer('Philadelphia families have trusted us since 1994.').kind).toBe('branding_only');
    expect(extractOffer('').kind).toBe('branding_only');
    expect(extractOffer('   ').kind).toBe('branding_only');
  });

  it('prefers the specific offer when an ad stacks several', () => {
    // Financing is the actual mechanism; "limited time" is decoration on top.
    expect(extractOffer('Limited time: 0% APR financing on new roofs').kind).toBe('financing');
    // A free inspection is a different promise from a free estimate.
    expect(extractOffer('Free inspection and free estimate').kind).toBe('free_inspection');
  });

  it('every kind it can return is documented for the reader', () => {
    const documented = new Set(OFFER_KINDS.map((o) => o.kind));
    for (const text of ['0% APR', 'free estimate', 'nothing here', '$500 off']) {
      expect(documented.has(extractOffer(text).kind)).toBe(true);
    }
    for (const o of OFFER_KINDS) expect(o.meaning.length).toBeGreaterThan(10);
  });
});

describe('what the market is saying', () => {
  it('reports each offer kind as a share of the ads scanned', () => {
    const ads = [
      ad('0% APR financing', 10), ad('0% financing available', 12),
      ad('Free estimate today', 8), ad('We have served Philly since 1994', 4),
    ];
    const mix = offerMix(ads);
    expect(mix[0]).toMatchObject({ kind: 'financing', count: 2, sharePct: 50 });
    expect(mix.find((m) => m.kind === 'branding_only')).toMatchObject({ count: 1, sharePct: 25 });
    expect(mix.reduce((s, m) => s + m.count, 0)).toBe(ads.length);
  });
});

describe('which offer type survives', () => {
  const market = () => [
    ...Array.from({ length: 5 }, (_, i) => ad('0% APR financing on a new roof', 40 + i, `Fin${i}`)),
    ...Array.from({ length: 5 }, (_, i) => ad('Proudly serving Philadelphia', 5 + i, `Brand${i}`)),
  ];

  it('ranks offer kinds by how long they last, longest first', () => {
    const s = survivalByOfferKind(market());
    expect(s[0]!.kind).toBe('financing');
    expect(s[0]!.avgDays).toBeGreaterThan(s[1]!.avgDays);
  });

  it('marks a thin sample unreliable instead of reporting a confident average', () => {
    const thin = [ad('25-year warranty', 90)]; // one ad, one very old
    const s = survivalByOfferKind(thin);
    expect(s[0]!.ads).toBeLessThan(MIN_ADS_FOR_SURVIVAL);
    expect(s[0]!.reliable).toBe(false);
  });

  it('ignores ads with no run length rather than counting them as zero', () => {
    const ads = [ad('0% APR financing', 30), { ...ad('0% APR financing', 0), daysRunning: undefined }];
    const s = survivalByOfferKind(ads);
    expect(s[0]!.ads).toBe(1);
    expect(s[0]!.avgDays).toBe(30);
  });
});

describe('which ads are actually winning', () => {
  it('rates a replicated, long-running angle strongest', () => {
    const ads = Array.from({ length: 4 }, () => ad('0% APR financing on a new roof', 45));
    const w = readWinners(ads)[0]!;
    expect(w.variants).toBe(4);
    expect(w.confidence).toBe('strong');
  });

  it('rates a lone old ad WEAK — longevity alone is not evidence', () => {
    const w = readWinners([ad('Proudly serving Philadelphia since 1994', 400)])[0]!;
    expect(w.daysRunning).toBe(400);
    expect(w.confidence).toBe('weak');
    expect(w.why).toMatch(/nobody pruned/i);
  });

  it('ranks a replicated young angle above a lone ancient one', () => {
    const ads = [
      ad('Proudly serving Philadelphia', 400, 'OldCo'),
      ...Array.from({ length: 4 }, () => ad('0% APR financing on a new roof', 9, 'NewCo')),
    ];
    const [first] = readWinners(ads);
    expect(first!.ad.page).toBe('NewCo');
    expect(first!.confidence).toBe('moderate');
  });

  it('does not merge different advertisers running the same angle', () => {
    const ads = [ad('0% APR financing', 30, 'A'), ad('0% APR financing', 30, 'B')];
    expect(readWinners(ads)).toHaveLength(2);
  });
});

describe('the brief handed to the ad generator', () => {
  const market = [
    ...Array.from({ length: 5 }, (_, i) => ad('0% APR financing on a new roof', 40 + i, `Fin${i}`)),
    ...Array.from({ length: 5 }, (_, i) => ad('Proudly serving Philadelphia', 5 + i, `Brand${i}`)),
  ];

  it('picks the surviving offer type and explains the call in market terms', () => {
    const b = offerBrief(market, 'roofing')!;
    expect(b.kind).toBe('financing');
    expect(b.rationale).toMatch(/longest-surviving/);
    expect(b.rationale).toMatch(/no offer at all lasts?|no offer at all last/);
    expect(b.evidence.length).toBeGreaterThan(0);
  });

  it('never hands a competitor\'s wording to the generator', () => {
    const b = offerBrief(market, 'roofing')!;
    // The brief describes the angle; it must not carry the ad copy itself.
    expect(b.brief).not.toMatch(/0% APR financing on a new roof/);
    expect(b.brief).toMatch(/original copy/i);
    expect(b.brief).toMatch(/not imitate/i);
    expect(b.brief).toContain('roofing');
  });

  it('returns nothing rather than a guess when the market is too thin to read', () => {
    expect(offerBrief([ad('0% APR financing', 30)], 'roofing')).toBeNull();
    expect(offerBrief([], 'roofing')).toBeNull();
  });

  it('will not call branding-only the winning offer even if it outlasts everything', () => {
    const brandingWins = Array.from({ length: 6 }, (_, i) => ad('Serving Philadelphia since 1994', 200 + i, `B${i}`))
      .concat(Array.from({ length: 5 }, (_, i) => ad('Free estimate today', 10 + i, `E${i}`)));
    const b = offerBrief(brandingWins, 'painting')!;
    expect(b.kind).toBe('free_estimate'); // an offer you can actually run
  });
});
