/**
 * Spec-complete asset packs.
 *
 * The creative engine produced three ad variations. Google's Responsive Search
 * Ad wants fifteen headlines and four descriptions, plus sitelinks, callouts and
 * a structured snippet before it serves properly; Meta wants five text
 * variations inside its own character budgets. Handing an owner three lines and
 * calling a campaign ready leaves them to write the other twelve by hand — which
 * is exactly the work they bought this to avoid.
 *
 * So this builds the full pack straight from specs/*.json rather than from
 * magic numbers, and it obeys one rule above all: NOTHING OVER THE LIMIT EVER
 * SHIPS. Candidates are generated, then filtered by length; a candidate that
 * does not fit is dropped, never truncated, because a headline cut mid-word is
 * worse than a headline that does not exist. If a quota cannot be filled the
 * shortfall is reported plainly rather than padded.
 */
import { loadSpec } from '../specs/index.js';

export interface SpecAssetInput {
  /** The trade, used as the keyword Google wants echoed in the headlines. */
  trade: string;
  city?: string;
  businessName?: string;
  /** The offer line the owner chose. Their promise, so it is used verbatim. */
  offer?: string;
  services?: string[];
}

export interface Sitelink {
  text: string;
  desc1?: string;
  desc2?: string;
}

export interface SearchAssetPack {
  headlines: string[];
  descriptions: string[];
  displayPaths: string[];
  sitelinks: Sitelink[];
  callouts: string[];
  snippet: { header: string; values: string[] };
  /** Anything that could not be filled to the recommended count, said plainly. */
  shortfalls: string[];
}

export interface MetaAssetPack {
  primaryTexts: string[];
  headlines: string[];
  descriptions: string[];
  cta: string;
  shortfalls: string[];
}

const title = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Keep only candidates that fit, are unique, and are not empty. */
function fit(candidates: string[], maxChars: number, want: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of candidates) {
    const c = clean(raw);
    // Dropped, never truncated — a headline cut mid-word is worse than none.
    if (!c || c.length > maxChars) continue;
    const key = c.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (out.length >= want) break;
  }
  return out;
}

export function buildSearchAssets(input: SpecAssetInput): SearchAssetPack {
  const spec = loadSpec('google_ads');
  const rsa = spec?.campaign_types?.search?.ad_units?.responsive_search_ad ?? {};
  const HL_MAX = rsa?.headlines?.max_count ?? 15;
  const HL_CHARS = rsa?.headlines?.max_chars ?? 30;
  const DE_MAX = rsa?.descriptions?.max_count ?? 4;
  const DE_CHARS = rsa?.descriptions?.max_chars ?? 90;
  const PATH_MAX = rsa?.display_path?.max_count ?? 2;
  const PATH_CHARS = rsa?.display_path?.max_chars ?? 15;
  const sl = spec?.assets_library?.sitelink ?? {};
  const SL_WANT = sl?.recommended_min ?? 4;
  const SL_CHARS = sl?.fields?.link_text?.max_chars ?? 25;
  const SL_DESC = sl?.fields?.description_1?.max_chars ?? 35;
  const co = spec?.assets_library?.callout ?? {};
  const CO_WANT = (co?.recommended?.[0] as number) ?? 4;
  const CO_CHARS = co?.fields?.text?.max_chars ?? 25;
  const ss = spec?.assets_library?.structured_snippet ?? {};
  const SS_MIN = ss?.fields?.values?.min_count ?? 3;
  const SS_CHARS = ss?.fields?.values?.max_chars ?? 25;
  const SS_HEADERS: string[] = ss?.fields?.header?.values ?? ['Service catalog'];

  const trade = clean(input.trade || 'home services');
  const Trade = title(trade);
  const city = clean(input.city || '');
  const offer = clean(input.offer || '');
  const services = (input.services ?? []).map(clean).filter(Boolean);

  // Google's rule: the keyword in at least two headlines, and varied lengths.
  // The keyword-bearing candidates come first so they survive the length filter.
  const headlineCandidates = [
    city ? `${city} ${Trade}` : `Local ${Trade}`,
    `${Trade} Near You`,
    `Trusted ${Trade} Pros`,
    offer && offer.length <= HL_CHARS ? offer : '',
    `Free ${Trade} Quote`,
    `Book ${Trade} Today`,
    city ? `${Trade} in ${city}` : `Expert ${Trade}`,
    'Licensed & Insured',
    'Same-Week Booking',
    'Upfront, Honest Pricing',
    'Free Estimates',
    '5-Star Rated Locally',
    'Workmanship Guaranteed',
    'No-Obligation Quote',
    'Talk To A Real Person',
    'Get A Quote Today',
    'Fast, Tidy, On Time',
    ...services.map((s) => title(s)),
    ...services.map((s) => `${title(s)} Experts`),
    input.businessName ? clean(input.businessName) : '',
  ];
  const headlines = fit(headlineCandidates, HL_CHARS, HL_MAX);

  const where = city ? ` in ${city}` : ' in your area';
  // Written well inside 90 characters. City and offer are variable length, so
  // the tail of this list is deliberately offer-free — if a long offer pushes
  // the first candidates over the limit they are dropped, and these still fill
  // the quota rather than leaving the owner short.
  const descriptionCandidates = [
    `${Trade}${where} done right first time.${offer ? ` ${offer}.` : ''} Fast, tidy, on schedule.`,
    `Licensed, insured and locally reviewed. Clear pricing before we start.`,
    offer ? `${offer}. Get a no-obligation quote and pick a slot that suits you.` : `Free quotes, and a slot that suits you. Real people answer the phone.`,
    `Tidy crews, on-time arrivals and a written guarantee on every job.`,
    `Talk to a real person about your ${trade} job. No call centres, no pressure.`,
    `Upfront pricing, no surprises on the day. Book online in under a minute.`,
    `Locally owned and 5-star rated. See recent work before you decide.`,
  ];
  const descriptions = fit(descriptionCandidates, DE_CHARS, DE_MAX);

  const displayPaths = fit(
    [trade.replace(/\s+/g, '-'), city ? city.split(',')[0]!.replace(/\s+/g, '-') : 'free-quote', 'quote'],
    PATH_CHARS, PATH_MAX,
  );

  const sitelinkCandidates: Sitelink[] = [
    { text: 'Get A Free Quote', desc1: 'No obligation, no pressure', desc2: 'Usually back within a day' },
    { text: 'See Our Work', desc1: 'Recent jobs and before/afters' },
    { text: 'Reviews', desc1: 'What local customers say' },
    { text: 'Our Services', desc1: services.slice(0, 2).join(', ') || `Everything ${trade}` },
    { text: 'Book Online', desc1: 'Pick a slot that suits you' },
    { text: 'Contact Us', desc1: 'Real people, real answers' },
  ];
  const sitelinks: Sitelink[] = [];
  const seenSl = new Set<string>();
  for (const s of sitelinkCandidates) {
    const text = clean(s.text);
    if (text.length > SL_CHARS || seenSl.has(text.toLowerCase())) continue;
    seenSl.add(text.toLowerCase());
    // Descriptions are optional, so an over-long one is dropped, not the sitelink.
    const d1 = s.desc1 && clean(s.desc1).length <= SL_DESC ? clean(s.desc1) : undefined;
    const d2 = s.desc2 && clean(s.desc2).length <= SL_DESC ? clean(s.desc2) : undefined;
    sitelinks.push({ text, ...(d1 ? { desc1: d1 } : {}), ...(d2 ? { desc2: d2 } : {}) });
    if (sitelinks.length >= SL_WANT) break;
  }

  const callouts = fit(
    ['Licensed & Insured', 'Free Estimates', 'Locally Owned', 'Written Guarantee',
     'Same-Week Booking', 'Upfront Pricing', 'Tidy Crews', 'On-Time Arrival'],
    CO_CHARS, CO_WANT,
  );

  const header = SS_HEADERS.includes('Service catalog') ? 'Service catalog' : SS_HEADERS[0]!;
  const snippetValues = fit(
    services.length ? services.map(title) : [Trade, 'Repairs', 'Installation', 'Maintenance', 'Free Quotes'],
    SS_CHARS, ss?.fields?.values?.max_count ?? 10,
  );

  const shortfalls: string[] = [];
  if (headlines.length < HL_MAX) shortfalls.push(`${headlines.length}/${HL_MAX} headlines — add ${HL_MAX - headlines.length} more (max ${HL_CHARS} characters each) for best serving.`);
  if (descriptions.length < DE_MAX) shortfalls.push(`${descriptions.length}/${DE_MAX} descriptions.`);
  if (sitelinks.length < SL_WANT) shortfalls.push(`${sitelinks.length}/${SL_WANT} sitelinks.`);
  if (callouts.length < CO_WANT) shortfalls.push(`${callouts.length}/${CO_WANT} callouts.`);
  if (snippetValues.length < SS_MIN) shortfalls.push(`Structured snippet needs ${SS_MIN} values, has ${snippetValues.length}. Add services in Business Profile.`);

  return { headlines, descriptions, displayPaths, sitelinks, callouts, snippet: { header, values: snippetValues }, shortfalls };
}

export function buildMetaAssets(input: SpecAssetInput): MetaAssetPack {
  const spec = loadSpec('meta_ads');
  const at = spec?.ad_text ?? {};
  const PT_CHARS = at?.primary_text?.visible_chars ?? 125;
  const PT_MAX = at?.primary_text?.variations_max ?? 5;
  const HL_CHARS = at?.headline?.safe_chars ?? 27;
  const HL_MAX = at?.headline?.variations_max ?? 5;
  const DE_CHARS = at?.description?.safe_chars ?? 27;
  const DE_MAX = at?.description?.variations_max ?? 5;
  // The spec names the home-services default rather than leaving it to taste.
  const cta = at?.cta?.home_services_default ?? 'Get Quote';

  const trade = clean(input.trade || 'home services');
  const Trade = title(trade);
  const city = clean(input.city || '');
  const offer = clean(input.offer || '');
  const where = city ? ` in ${city}` : ' near you';

  const primaryTexts = fit([
    `Looking for ${trade}${where}?${offer ? ` ${offer}.` : ''} Get a free quote today — no obligation.`,
    `${offer || 'Free estimates'} on ${trade}${where}. Licensed, insured, and locally reviewed.`,
    `Tired of chasing contractors? We answer, we turn up, and we finish. ${offer || 'Free quote'}.`,
    `Clear pricing before we start. ${offer || 'Book a free estimate'} and pick a slot that suits you.`,
    `Your neighbours already booked us for ${trade}. ${offer || 'See what a job costs'} — free quote.`,
  ], PT_CHARS, PT_MAX);

  const headlines = fit([
    offer && offer.length <= HL_CHARS ? offer : '',
    city ? `${Trade} in ${city}` : `${Trade} Near You`,
    'Get Your Free Quote',
    'Book In Under A Minute',
    'Licensed & Insured',
    'Free Estimates',
  ], HL_CHARS, HL_MAX);

  const descriptions = fit([
    'Free, no-obligation quote',
    'Locally owned & reviewed',
    'Upfront, honest pricing',
    'Written guarantee',
    'Same-week booking',
  ], DE_CHARS, DE_MAX);

  const shortfalls: string[] = [];
  if (primaryTexts.length < PT_MAX) shortfalls.push(`${primaryTexts.length}/${PT_MAX} primary texts (max ${PT_CHARS} visible characters).`);
  if (headlines.length < HL_MAX) shortfalls.push(`${headlines.length}/${HL_MAX} headlines (max ${HL_CHARS} characters).`);
  if (descriptions.length < DE_MAX) shortfalls.push(`${descriptions.length}/${DE_MAX} descriptions (max ${DE_CHARS} characters).`);

  return { primaryTexts, headlines, descriptions, cta, shortfalls };
}

export interface PackCheck {
  item: string;
  status: 'ok' | 'warn' | 'bad';
  detail: string;
}

/**
 * Prove the pack obeys the spec rather than asserting it. Every length is
 * re-measured here against the loaded JSON, so a generator regression shows up
 * as a failed check instead of an over-long headline reaching Google.
 */
export function checkSearchPack(pack: SearchAssetPack): PackCheck[] {
  const spec = loadSpec('google_ads');
  const rsa = spec?.campaign_types?.search?.ad_units?.responsive_search_ad ?? {};
  const HL_CHARS = rsa?.headlines?.max_chars ?? 30;
  const HL_MIN = rsa?.headlines?.min_count ?? 3;
  const HL_MAX = rsa?.headlines?.max_count ?? 15;
  const DE_CHARS = rsa?.descriptions?.max_chars ?? 90;
  const DE_MIN = rsa?.descriptions?.min_count ?? 2;
  const DE_MAX = rsa?.descriptions?.max_count ?? 4;
  const CO_CHARS = spec?.assets_library?.callout?.fields?.text?.max_chars ?? 25;
  const SL_CHARS = spec?.assets_library?.sitelink?.fields?.link_text?.max_chars ?? 25;

  const over = (arr: string[], max: number) => arr.filter((s) => s.length > max);
  const out: PackCheck[] = [];

  const hlOver = over(pack.headlines, HL_CHARS);
  out.push({
    item: `Headlines ≤ ${HL_CHARS} chars`,
    status: hlOver.length ? 'bad' : 'ok',
    detail: hlOver.length ? `${hlOver.length} over the limit: ${hlOver[0]}` : `All ${pack.headlines.length} fit.`,
  });
  out.push({
    item: `Headline count (${HL_MIN}–${HL_MAX})`,
    status: pack.headlines.length < HL_MIN ? 'bad' : pack.headlines.length < HL_MAX ? 'warn' : 'ok',
    detail: `${pack.headlines.length}/${HL_MAX}.`,
  });
  // Google's own per-item rule, checked rather than assumed.
  const kw = pack.headlines.filter((h) => /\b(painting|roofing|plumbing|hvac|electrical|landscaping|remodeling|cleaning|pest|services?)\b/i.test(h));
  out.push({
    item: 'Keyword in ≥2 headlines',
    status: kw.length >= 2 ? 'ok' : 'warn',
    detail: `${kw.length} headline${kw.length === 1 ? '' : 's'} carry the trade.`,
  });
  const lengths = new Set(pack.headlines.map((h) => (h.length <= 15 ? 'short' : h.length <= 24 ? 'mid' : 'long')));
  out.push({
    item: 'Varied headline lengths',
    status: lengths.size >= 2 ? 'ok' : 'warn',
    detail: `${lengths.size} distinct length band${lengths.size === 1 ? '' : 's'}.`,
  });

  const deOver = over(pack.descriptions, DE_CHARS);
  out.push({
    item: `Descriptions ≤ ${DE_CHARS} chars`,
    status: deOver.length ? 'bad' : 'ok',
    detail: deOver.length ? `${deOver.length} over the limit.` : `All ${pack.descriptions.length} fit.`,
  });
  out.push({
    item: `Description count (${DE_MIN}–${DE_MAX})`,
    status: pack.descriptions.length < DE_MIN ? 'bad' : pack.descriptions.length < DE_MAX ? 'warn' : 'ok',
    detail: `${pack.descriptions.length}/${DE_MAX}.`,
  });

  const slOver = pack.sitelinks.filter((s) => s.text.length > SL_CHARS);
  out.push({
    item: `Sitelinks (${spec?.assets_library?.sitelink?.recommended_min ?? 4} recommended)`,
    status: slOver.length ? 'bad' : pack.sitelinks.length < (spec?.assets_library?.sitelink?.min_to_serve ?? 2) ? 'bad' : pack.sitelinks.length < 4 ? 'warn' : 'ok',
    detail: slOver.length ? `${slOver.length} link texts over ${SL_CHARS} chars.` : `${pack.sitelinks.length} built.`,
  });

  const coOver = over(pack.callouts, CO_CHARS);
  out.push({
    item: `Callouts ≤ ${CO_CHARS} chars`,
    status: coOver.length ? 'bad' : pack.callouts.length < 2 ? 'bad' : 'ok',
    detail: coOver.length ? `${coOver.length} over the limit.` : `${pack.callouts.length} built, none duplicated.`,
  });

  const ssMin = spec?.assets_library?.structured_snippet?.fields?.values?.min_count ?? 3;
  out.push({
    item: `Structured snippet (≥${ssMin} values)`,
    status: pack.snippet.values.length >= ssMin ? 'ok' : 'warn',
    detail: `${pack.snippet.header}: ${pack.snippet.values.length} value${pack.snippet.values.length === 1 ? '' : 's'}.`,
  });

  return out;
}

export function checkMetaPack(pack: MetaAssetPack): PackCheck[] {
  const at = loadSpec('meta_ads')?.ad_text ?? {};
  const PT = at?.primary_text?.visible_chars ?? 125;
  const HL = at?.headline?.safe_chars ?? 27;
  const DE = at?.description?.safe_chars ?? 27;
  const overs = (arr: string[], max: number) => arr.filter((s) => s.length > max).length;
  return [
    { item: `Primary text ≤ ${PT} visible chars`, status: overs(pack.primaryTexts, PT) ? 'bad' : 'ok', detail: `${pack.primaryTexts.length} variation${pack.primaryTexts.length === 1 ? '' : 's'}, all within the visible budget.` },
    { item: `Headlines ≤ ${HL} chars`, status: overs(pack.headlines, HL) ? 'bad' : 'ok', detail: `${pack.headlines.length} variation${pack.headlines.length === 1 ? '' : 's'}.` },
    { item: `Descriptions ≤ ${DE} chars`, status: overs(pack.descriptions, DE) ? 'bad' : 'ok', detail: `${pack.descriptions.length} variation${pack.descriptions.length === 1 ? '' : 's'}.` },
    { item: 'Call to action', status: pack.cta ? 'ok' : 'warn', detail: `${pack.cta} — the spec's home-services default.` },
  ];
}
