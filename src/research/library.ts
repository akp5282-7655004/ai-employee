/**
 * Ad Library — the browse-and-pick surface.
 *
 * The owner is in charge here, and that is a deliberate reversal. An earlier
 * pass had Miles read the market, name one winning offer type and generate
 * against it. That is faster and it is wrong: the owner never sees the options
 * they did not get, and they are the only person who knows which promises their
 * business can actually keep. So Miles ranks and explains; the owner picks.
 *
 * What comes out of a selection is a description of what the chosen ads have in
 * COMMON — offer type, hook shape, whether they lead on proof or on price — and
 * never their words. Copying the copy is someone else's property, and Meta
 * rejects near-duplicate creative, so it would fail twice over.
 */
import type { CompetitorAd } from './adlibrary.js';
import { extractOffer, OFFER_KINDS, readWinners, type OfferKind } from './offers.js';

export interface LibraryAd {
  id: string;
  page: string;
  body: string;
  daysRunning?: number;
  /** Near-identical siblings from the same advertiser. */
  variants: number;
  offerKind: OfferKind;
  offerLabel: string;
  /** The exact text that classified it — the evidence, so a label can be checked. */
  offerEvidence?: string;
  confidence: 'strong' | 'moderate' | 'weak';
  why: string;
  selected: boolean;
}

/** Structural traits worth naming, read from the copy rather than guessed. */
export interface HookTraits {
  question: boolean;
  numbers: boolean;
  urgency: boolean;
  guarantee: boolean;
  local: boolean;
}

export function hookTraits(text: string): HookTraits {
  const t = (text || '').toLowerCase();
  return {
    question: /\?/.test(t),
    numbers: /\d/.test(t),
    urgency: /\b(today|now|limited|ends|hurry|last chance|this week|book by)\b/.test(t),
    guarantee: /\b(guarantee|guaranteed|warranty|no obligation|risk[- ]free|money[- ]back)\b/.test(t),
    local: /\b(near you|in your area|local|neighbou?rs?|serving)\b/.test(t),
  };
}

export const SELECTION_CAP = 12;

/**
 * Turn stored ads into a browsable, ranked library. Ranking is by how likely an
 * ad is to be earning — replication first, age second — but every ad stays
 * visible. The ranking is a suggestion, not a filter.
 */
export function buildLibrary(ads: CompetitorAd[], selectedIds: string[] = []): LibraryAd[] {
  const picked = new Set(selectedIds);
  const reads = readWinners(ads);
  // readWinners groups near-identical ads; map each group's read back onto its members.
  const byKey = new Map<string, { variants: number; confidence: LibraryAd['confidence']; why: string }>();
  for (const r of reads) {
    byKey.set(`${r.ad.page}|${r.offer.kind}`, { variants: r.variants, confidence: r.confidence, why: r.why });
  }
  const rank = { strong: 0, moderate: 1, weak: 2 };
  return ads
    .map((a) => {
      const offer = extractOffer(`${a.title ?? ''} ${a.body ?? ''}`);
      const read = byKey.get(`${a.page}|${offer.kind}`);
      return {
        id: a.id,
        page: a.page,
        body: a.body ?? '',
        daysRunning: a.daysRunning,
        variants: read?.variants ?? 1,
        offerKind: offer.kind,
        offerLabel: OFFER_KINDS.find((o) => o.kind === offer.kind)?.label ?? offer.kind,
        offerEvidence: offer.evidence,
        confidence: read?.confidence ?? 'weak',
        why: read?.why ?? 'Not enough signal to read yet.',
        selected: picked.has(a.id),
      };
    })
    .sort((x, y) =>
      rank[x.confidence] - rank[y.confidence] ||
      y.variants - x.variants ||
      (y.daysRunning ?? 0) - (x.daysRunning ?? 0));
}

export interface LibraryFilter {
  advertiser?: string;
  kind?: OfferKind;
  minDays?: number;
  selectedOnly?: boolean;
}

export function filterLibrary(lib: LibraryAd[], f: LibraryFilter = {}): LibraryAd[] {
  return lib.filter((a) => {
    if (f.advertiser && a.page !== f.advertiser) return false;
    if (f.kind && a.offerKind !== f.kind) return false;
    if (f.minDays != null && (a.daysRunning ?? 0) < f.minDays) return false;
    if (f.selectedOnly && !a.selected) return false;
    return true;
  });
}

/** The facets a browser needs, computed from what is actually in the library. */
export function libraryFacets(lib: LibraryAd[]): {
  advertisers: { name: string; count: number }[];
  kinds: { kind: OfferKind; label: string; count: number }[];
} {
  const adv = new Map<string, number>();
  const kinds = new Map<OfferKind, number>();
  for (const a of lib) {
    adv.set(a.page, (adv.get(a.page) ?? 0) + 1);
    kinds.set(a.offerKind, (kinds.get(a.offerKind) ?? 0) + 1);
  }
  return {
    advertisers: [...adv.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    kinds: [...kinds.entries()]
      .map(([kind, count]) => ({ kind, label: OFFER_KINDS.find((o) => o.kind === kind)?.label ?? kind, count }))
      .sort((a, b) => b.count - a.count),
  };
}

export interface SelectionBrief {
  count: number;
  /** Offer kinds present in the selection, most common first. */
  kinds: { kind: OfferKind; label: string; count: number }[];
  /** The dominant kind, when one clearly leads. */
  leadKind: OfferKind | null;
  /** Structural traits shared by MOST of the picked ads. */
  sharedTraits: string[];
  /** What the owner is being told Miles took from their picks. */
  reading: string;
  /** The instruction handed to the generator. Angle only, never their words. */
  brief: string;
}

const TRAIT_LABELS: Record<keyof HookTraits, string> = {
  question: 'opens with a question',
  numbers: 'leads with a specific number',
  urgency: 'carries a deadline or scarcity',
  guarantee: 'promises a guarantee or removes risk',
  local: 'names the local area',
};

/** "a", "a and b", "a, b and c" — chained "and"s read like a machine wrote them. */
function listOf(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/**
 * Read a selection: what do these ads have in common, and what should be
 * written because of it. Traits are reported only when MOST of the picked ads
 * share them — one ad with a question mark is not a pattern.
 */
export function briefFromSelection(selected: LibraryAd[], trade: string): SelectionBrief | null {
  if (!selected.length) return null;

  const counts = new Map<OfferKind, number>();
  for (const a of selected) counts.set(a.offerKind, (counts.get(a.offerKind) ?? 0) + 1);
  const kinds = [...counts.entries()]
    .map(([kind, count]) => ({ kind, label: OFFER_KINDS.find((o) => o.kind === kind)?.label ?? kind, count }))
    .sort((a, b) => b.count - a.count);

  const top = kinds[0]!;
  // "Dominant" needs a real majority, not merely the largest slice of a spread.
  const leadKind = top.count > selected.length / 2 ? top.kind : null;

  const tally: Record<keyof HookTraits, number> = { question: 0, numbers: 0, urgency: 0, guarantee: 0, local: 0 };
  for (const a of selected) {
    const t = hookTraits(a.body);
    for (const k of Object.keys(tally) as (keyof HookTraits)[]) if (t[k]) tally[k]++;
  }
  const threshold = Math.ceil(selected.length / 2);
  const sharedTraits = (Object.keys(tally) as (keyof HookTraits)[])
    .filter((k) => tally[k] >= threshold)
    .map((k) => TRAIT_LABELS[k]);

  // Two short sentences rather than one long one — the offer type and the
  // structure are separate findings and read as such.
  const lead = leadKind
    ? `Most of what you picked runs ${top.label.toLowerCase()}.`
    : `Your picks span ${kinds.length} different offer types.`;
  const shape = sharedTraits.length ? ` Each one ${listOf(sharedTraits)}.` : '';
  const reading = lead + shape;

  return {
    count: selected.length,
    kinds,
    leadKind,
    sharedTraits,
    reading,
    brief: [
      `Write a Meta ad for a ${trade} business.`,
      leadKind ? `Offer type: ${top.label}.` : `Offer types the owner favours: ${kinds.map((k) => k.label).join(', ')}.`,
      sharedTraits.length ? `Match this structure: the ad ${sharedTraits.join(', and ')}.` : '',
      `Write original copy in this business's own voice and offer. Do not imitate any competitor's wording, and do not name or reference a competitor.`,
    ].filter(Boolean).join(' '),
  };
}

export function readSelection(data: Record<string, unknown>): string[] {
  const s = data.librarySelection;
  return Array.isArray(s) ? (s as string[]).filter((x) => typeof x === 'string') : [];
}

export function writeSelection(data: Record<string, unknown>, ids: string[]): string[] {
  const unique = [...new Set(ids)].slice(0, SELECTION_CAP);
  data.librarySelection = unique;
  return unique;
}
