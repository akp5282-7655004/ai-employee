/**
 * Google Ads campaign builder. Turns a plain-English goal + budget + business
 * profile into a COMPLETE, launch-ready Search campaign spec — budget, bidding,
 * networks, geo, ad groups, keywords (with match types), responsive search ads,
 * and negatives — that the owner reviews setting-by-setting before anything goes
 * live. Deterministic so it always produces a full spec; copy can be enriched by
 * the LLM but the structure never depends on it.
 */

export type MatchType = 'broad' | 'phrase' | 'exact';
export interface KeywordSpec {
  text: string;
  match: MatchType;
}
export interface RsaSpec {
  headlines: string[];
  descriptions: string[];
}
export interface AdGroupSpec {
  name: string;
  keywords: KeywordSpec[];
  rsa: RsaSpec;
  /** Landing page for this ad group. Homepage when no crawled service page matches. */
  finalUrl?: string;
}
/** Sitelink asset — link text (≤25) + up to two description lines (≤35) + its own URL. */
export interface Sitelink {
  text: string;
  desc1?: string;
  desc2?: string;
  url: string;
}
/** Structured snippet — a header from Google's fixed list + ≥3 values (≤25 each). */
export interface StructuredSnippet {
  header: string;
  values: string[];
}
export interface CampaignSpec {
  name: string;
  dailyBudget: number; // USD/day
  biddingStrategy: 'MAXIMIZE_CLICKS' | 'MAXIMIZE_CONVERSIONS';
  networks: string[];
  locations: string[];
  language: string;
  finalUrl: string;
  adGroups: AdGroupSpec[];
  negatives: string[];
  status: 'PAUSED' | 'ENABLED';
  // ── campaign assets (Search checklist) — recommended, not required to serve ──
  businessName?: string; // ≤25, must match domain/brand
  displayPaths?: string[]; // up to 2, ≤15 each
  sitelinks?: Sitelink[]; // 4+ recommended
  callouts?: string[]; // 4–10 recommended, ≤25 each
  structuredSnippet?: StructuredSnippet;
  /** Defaults from the campaign rulebook. Not a measured benchmark. */
  targeting?: {
    presence: 'PRESENCE';
    radiusMiles: number;
    searchPartners: false;
    display: false;
    schedule: { days: number[]; startHour: number; endHour: number };
  };
  /** Launch bid stage. Switches later are proposals, not a silent live change. */
  bidPlan?: { stage: 'MAXIMIZE_CLICKS' | 'MAXIMIZE_CONVERSIONS' | 'TARGET_CPA'; maxCpc: number; targetCpa?: number };
  callAsset?: { phone: string } | null;
  locationAsset?: { gbpUrl: string } | null;
  /** Google geo target constants for the service area. Presence only. */
  geoTargets?: { id: string; name: string; targetType: 'City' | 'County' | 'Postal Code'; resourceName: string }[];
}

/** Google's fixed structured-snippet headers. */
export const SNIPPET_HEADERS = ['Amenities', 'Brands', 'Courses', 'Degree programs', 'Destinations', 'Featured hotels', 'Insurance coverage', 'Models', 'Neighborhoods', 'Service catalog', 'Shows', 'Styles', 'Types'];

export interface CampaignInput {
  goal?: string;
  dailyBudget?: number;
  finalUrl?: string;
  locations?: string[];
}
export interface CampaignCtx {
  business?: string;
  trade?: string;
  city?: string;
  services?: string;
  offers?: string;
}

const clampBudget = (n: unknown): number => {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? Math.min(Math.max(Math.round(v * 100) / 100, 1), 10_000) : 20;
};

const ACRONYMS = new Set(['HVAC', 'AC', 'LLC', 'PA', 'USA']);

/** Title case, with short acronyms left in caps. All-caps marketing words become title case. */
export function normalizeAdCase(input: string): string {
  return input
    .replace(/#\s*1\b/gi, '')
    .replace(/\b(best|number one|top-rated|top rated)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((word) => {
      const letters = word.replace(/[^A-Za-z]/g, '');
      if (ACRONYMS.has(letters.toUpperCase())) {
        return word.replace(letters, letters.toUpperCase());
      }
      if (letters.length >= 3 && letters === letters.toUpperCase()) {
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      }
      if (word === word.toLowerCase()) return word.charAt(0).toUpperCase() + word.slice(1);
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Use the first complete variant that fits. Never cut a sentence in the middle. */
export function fitCopy(variants: string[], max: number): string {
  for (const raw of variants) {
    const text = normalizeAdCase(raw);
    if (text && text.length <= max) return text;
  }
  return '';
}

const OFFER_WORD = /\b(free|quote|quotes|custom|estimate|estimates|discount|discounts|best|cheap|guaranteed|sale|special|deal|deals|today|call|now|offer|offers)\b/gi;

export function stripOfferWords(input: string): string {
  return normalizeAdCase(input.replace(/#\s*\d+/g, ' ').replace(OFFER_WORD, ' ')).replace(/\s+/g, ' ').trim();
}

const SERVICE_BOOK: Record<string, { test: RegExp; label: string }[]> = {
  painting: [
    { test: /interior/i, label: 'Interior painting' },
    { test: /exterior/i, label: 'Exterior painting' },
    { test: /cabinet/i, label: 'Cabinet painting' },
    { test: /commercial/i, label: 'Commercial painting' },
    { test: /\bhouse\b/i, label: 'House painting' },
  ],
  plumbing: [
    { test: /drain/i, label: 'Drain cleaning' },
    { test: /water heater/i, label: 'Water heater' },
    { test: /leak/i, label: 'Leak repair' },
    { test: /sewer/i, label: 'Sewer line' },
  ],
  hvac: [
    { test: /air condition|\bac\b/i, label: 'Air conditioning' },
    { test: /furnace/i, label: 'Furnace' },
    { test: /heat pump/i, label: 'Heat pump' },
  ],
  electrical: [
    { test: /panel/i, label: 'Panel upgrade' },
    { test: /rewir|wiring/i, label: 'Wiring' },
    { test: /charger/i, label: 'EV charger' },
  ],
  roofing: [
    { test: /leak/i, label: 'Leak repair' },
    { test: /replacement/i, label: 'Roof replacement' },
    { test: /repair/i, label: 'Roof repair' },
  ],
};

function tradeKey(trade?: string): string {
  const t = (trade || '').toLowerCase();
  if (t.includes('paint')) return 'painting';
  if (t.includes('plumb')) return 'plumbing';
  if (t.includes('hvac') || t.includes('air condition')) return 'hvac';
  if (t.includes('electric')) return 'electrical';
  if (t.includes('roof')) return 'roofing';
  return '';
}

/** Ad groups come from real service lines, never from offers or taglines. */
export function deriveServiceLines(services: string | undefined, trade: string | undefined): string[] {
  const blob = `${services || ''} ${trade || ''}`;
  const key = tradeKey(trade);
  const book = SERVICE_BOOK[key];
  if (book) {
    const found = book.filter((row) => row.test.test(blob)).map((row) => row.label);
    if (found.length) return found.slice(0, 4);
    return book.slice(0, 3).map((row) => row.label);
  }
  const parts = (services || '').split(/[,;/|]/).map((part) => stripOfferWords(part)).filter((part) => part.length > 2 && !JUNK_LINE.test(part));
  if (parts.length) return parts.slice(0, 3);
  const cleaned = stripOfferWords(trade || '');
  return [cleaned || 'Local service'];
}

export function shortBrand(business: string | undefined, trade: string | undefined, city: string | undefined): string {
  const parts = (business || '').split(/[,|]/).map((part) => part.trim()).filter(Boolean);
  const clean = parts.map((part) => stripOfferWords(part)).filter((part) => part.length > 2 && !/#/.test(part));
  const pick = clean[clean.length - 1] || clean[0] || normalizeAdCase(trade || 'Local service');
  const withCity = pick.length <= 25 ? pick : normalizeAdCase(city ? `${trade || 'Local'} ${city}` : pick);
  return fitCopy([withCity, normalizeAdCase(trade || 'Local service'), 'Local service'], 25) || 'Local service';
}

export function budgetCaution(daily: number, targetCpl: number | null): { warn: boolean; daysPerLead: number | null; message: string } {
  if (!targetCpl || targetCpl <= 0 || !(daily > 0)) return { warn: false, daysPerLead: null, message: '' };
  const days = Math.ceil(targetCpl / daily);
  if (days < 14) return { warn: false, daysPerLead: days, message: '' };
  return {
    warn: true,
    daysPerLead: days,
    message: `At $${daily}/day and a $${targetCpl} target cost per lead, one lead at that cost takes about ${days} days of spend. This is arithmetic, not a promise of leads. You can still create the paused campaign if you acknowledge it.`,
  };
}

const NEGATIVES = ['jobs', 'careers', 'salary', 'hiring', 'diy', 'how to', 'free', 'training', 'course', 'cheap', 'used', 'wholesale'];
const JUNK_LINE = /\b(slide|slider|location|locations|placeholder|lorem|untitled|menu|header|footer|navigation)\b/i;

export interface PageLinkRef {
  href: string;
  text: string;
}

/** https URL with a real hostname. A label such as "Interior Painting" is not a URL. */
export function normalizeSiteUrl(raw: string | undefined): string | undefined {
  const trimmed = (raw || '').trim();
  if (!trimmed || /\s/.test(trimmed)) return undefined;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed.replace(/^\/+/, '')}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    if (!url.hostname.includes('.') || url.username || url.password) return undefined;
    if (url.hostname === 'example.com') return undefined;
    url.protocol = 'https:';
    url.hash = '';
    return url.toString();
  } catch {
    return undefined;
  }
}

function pathKey(raw: string): string {
  try {
    const path = new URL(raw).pathname.replace(/\/+$/, '');
    return (path || '/').toLowerCase();
  } catch {
    return '';
  }
}

function linkWords(label: string): string[] {
  return label.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3 && !['painting', 'service', 'services'].includes(word));
}

function matchCrawledLink(links: PageLinkRef[], label: string): string | undefined {
  const words = [...new Set(linkWords(label))];
  if (!words.length) return undefined;
  const hit = links.find((link) => {
    const hay = `${link.text} ${pathKey(link.href)}`.toLowerCase();
    return words.every((word) => hay.includes(word));
  });
  return hit ? normalizeSiteUrl(hit.href) : undefined;
}

/**
 * Fill the landing page and sitelinks from the crawled site. A sitelink is kept
 * only when its URL is a page the crawl actually saw. Fewer than two real
 * sitelinks means no sitelinks, never a blank or made-up path.
 */
export function repairCampaignUrls(spec: CampaignSpec, args: { website?: string; links?: PageLinkRef[] }): CampaignSpec {
  const home = normalizeSiteUrl(args.website) || normalizeSiteUrl(spec.finalUrl);
  const links = args.links ?? [];
  const known = new Set(links.map((link) => pathKey(link.href)).filter(Boolean));
  if (home) known.add('/');
  const adGroups = spec.adGroups.map((group) => ({
    ...group,
    finalUrl: (home && matchCrawledLink(links, group.name)) || home || undefined,
  }));
  const labels = [...spec.adGroups.map((group) => group.name), 'Request A Visit', 'About Us', 'Contact Us'];
  const seen = new Set<string>();
  const sitelinks: Sitelink[] = [];
  for (const label of labels) {
    const text = fitCopy([label, 'Services'], 25);
    if (!text || seen.has(text.toLowerCase())) continue;
    const url = matchCrawledLink(links, text);
    if (!url || !known.has(pathKey(url))) continue;
    seen.add(text.toLowerCase());
    sitelinks.push({ text, url, desc1: fitCopy([text, 'Local service'], 35) || undefined, desc2: 'Ask about timing' });
    if (sitelinks.length >= 6) break;
  }
  return {
    ...spec,
    finalUrl: home || '',
    adGroups,
    sitelinks: sitelinks.length >= 2 ? sitelinks : [],
  };
}

function keywordAllowed(text: string, negatives: string[]): boolean {
  const lower = text.toLowerCase();
  if (/\b(\w+)\s+\1\b/.test(lower)) return false;
  if (/^best\b/.test(lower)) return false;
  return !negatives.some((neg) => lower.includes(neg.toLowerCase()));
}

function keywordsFor(theme: string, ctx: CampaignCtx, negatives: string[]): KeywordSpec[] {
  const t = theme.toLowerCase();
  const city = (ctx.city || '').split(',')[0]?.trim().toLowerCase() || '';
  const drafts: KeywordSpec[] = [
    { text: city ? `${t} ${city}` : t, match: 'phrase' },
    { text: city ? `${t} ${city}` : t, match: 'exact' },
    { text: t, match: 'phrase' },
    { text: t, match: 'exact' },
    { text: `${t} near me`, match: 'phrase' },
  ];
  const seen = new Set<string>();
  return drafts.filter((row) => {
    const text = row.text.replace(/\s+/g, ' ').trim();
    const key = `${row.match}:${text}`;
    if (!text || seen.has(key) || !keywordAllowed(text, negatives)) return false;
    seen.add(key);
    row.text = text;
    return true;
  });
}

function rsaFor(theme: string, ctx: CampaignCtx, brand: string): RsaSpec {
  const city = (ctx.city || '').split(',')[0]?.trim() || '';
  const themeTitle = normalizeAdCase(theme);
  const cityTitle = city ? normalizeAdCase(city) : '';
  const headlines = [
    fitCopy([themeTitle, 'Local service'], 30),
    fitCopy([cityTitle ? `${themeTitle} in ${cityTitle}` : themeTitle, themeTitle], 30),
    fitCopy([cityTitle ? `Serving ${cityTitle}` : 'Serving your area'], 30),
    fitCopy([brand, themeTitle], 30),
    fitCopy([`${themeTitle} help`, themeTitle], 30),
    'Licensed And Insured',
    'Book A Visit',
    'Local Crew',
    'Call For A Visit',
    'Clear Pricing',
    fitCopy([cityTitle ? `${cityTitle} ${themeTitle}` : themeTitle, themeTitle], 30),
    'Schedule A Visit',
    'Ask About Timing',
    'Request A Visit',
    'Talk To The Crew',
  ].map((line) => normalizeAdCase(line)).filter((line, i, all) => line && line.length <= 30 && all.indexOf(line) === i);
  while (headlines.length < 15) {
    const extra = fitCopy([`${themeTitle} ${headlines.length + 1}`], 30);
    if (!extra || headlines.includes(extra)) break;
    headlines.push(extra);
  }
  const descriptions = [
    fitCopy([
      cityTitle ? `${themeTitle} in ${cityTitle}. Call to schedule a visit.` : `${themeTitle}. Call to schedule a visit.`,
      `${themeTitle}. Call to schedule a visit.`,
      'Call to schedule a visit.',
    ], 90),
    fitCopy([
      `${brand} handles ${themeTitle.toLowerCase()}.`,
      `${themeTitle}. Ask about timing.`,
      'Ask about timing.',
    ], 90),
    fitCopy([`Schedule ${themeTitle.toLowerCase()} with a local crew.`, 'Schedule a visit with a local crew.'], 90),
    'Honest pricing. You approve the campaign before it is created paused.',
  ].filter((line, i, all) => line && line.length <= 90 && all.indexOf(line) === i);
  return { headlines: headlines.slice(0, 15), descriptions: descriptions.slice(0, 4) };
}

/** Negative keywords that stop wasted spend for local-service search. */
function defaultNegatives(): string[] {
  return ['jobs', 'careers', 'salary', 'hiring', 'diy', 'how to', 'free', 'training', 'course', 'cheap', 'used', 'wholesale'];
}

/** Append a path segment to a base URL for a sitelink's distinct final URL. */
function urlWith(base: string, seg: string): string {
  const clean = (base || 'https://example.com').replace(/\/+$/, '');
  return `${clean}/${seg}`;
}

/** Business name asset (≤25, must match brand). */
function businessNameOf(ctx: CampaignCtx): string {
  return shortBrand(ctx.business, ctx.trade, ctx.city);
}

function displayPathsOf(themes: string[]): string[] {
  const seg = (s: string) => {
    const clean = normalizeAdCase(s).replace(/[^a-z0-9 ]/gi, '').trim().replace(/\s+/g, '-');
    return fitCopy([clean, clean.split('-')[0] || '', 'Services'], 15) || 'Services';
  };
  return [seg(themes[0] || 'Services'), 'Visit'].filter(Boolean);
}

/** 4+ sitelinks derived from the services, each with its own final URL + descriptions. */
function sitelinksOf(themes: string[], ctx: CampaignCtx, finalUrl: string): Sitelink[] {
  const base: { text: string; desc1: string; desc2: string; seg: string }[] = [
    { text: fitCopy([themes[0] || 'Our Services', 'Services'], 25), desc1: fitCopy([`Local ${(themes[0] || 'service').toLowerCase()}`, 'Local service'], 35), desc2: 'Clear timing', seg: 'services' },
    { text: 'Request A Visit', desc1: 'Talk through the work', desc2: 'No pressure', seg: 'visit' },
    { text: 'About Us', desc1: fitCopy([ctx.city ? `Team in ${normalizeAdCase(ctx.city.split(',')[0] || '')}` : 'Local team', 'Local team'], 35), desc2: 'Licensed and insured', seg: 'about' },
    { text: 'Contact Us', desc1: 'Call or message', desc2: 'We reply', seg: 'contact' },
  ];
  if (themes[1]) base.splice(1, 0, { text: fitCopy([themes[1], 'Services'], 25), desc1: fitCopy([`${themes[1]}`, 'More services'], 35), desc2: 'Ask about options', seg: 'services-2' });
  return base.slice(0, 6).map((s) => ({ text: s.text, desc1: s.desc1, desc2: s.desc2, url: urlWith(finalUrl, s.seg) }));
}

/** 4–6 callout assets (≤25 each), no punctuation-heavy text. */
function calloutsOf(ctx: CampaignCtx): string[] {
  const outs = ['Licensed And Insured', 'Locally Owned', 'Clear Pricing', 'Fast Response', 'Experienced Crew', 'Schedule A Visit'];
  return [...new Set(outs.map((line) => fitCopy([line], 25)).filter(Boolean))].slice(0, 6);
}

/** Structured snippet — header "Service catalog" + the service themes as values (≥3). */
function snippetOf(themes: string[]): StructuredSnippet {
  const vals = [...new Set(themes.map((t) => fitCopy([t, 'Service'], 25)).filter(Boolean))];
  while (vals.length < 3) vals.push(['Local Service', 'Scheduled Work', 'Repair Work'][vals.length] || 'Service');
  return { header: 'Service catalog', values: vals.slice(0, 10) };
}

/** Build a complete, launch-ready campaign spec. Always full; never partial. */
export function repairAdCopy(spec: CampaignSpec): CampaignSpec {
  const negatives = spec.negatives?.length ? spec.negatives : NEGATIVES;
  spec.name = normalizeAdCase(spec.name);
  if (spec.businessName) spec.businessName = fitCopy([normalizeAdCase(spec.businessName), 'Local service'], 25) || 'Local service';
  spec.displayPaths = (spec.displayPaths ?? []).map((path) => fitCopy([normalizeAdCase(path).replace(/\s+/g, '-'), 'Visit'], 15)).filter(Boolean);
  spec.adGroups = spec.adGroups.map((group) => ({
    ...group,
    name: normalizeAdCase(group.name),
    keywords: group.keywords
      .map((row) => ({ text: row.text.toLowerCase().replace(/\s+/g, ' ').trim(), match: row.match === 'broad' ? 'phrase' as const : row.match }))
      .filter((row) => keywordAllowed(row.text, negatives)),
    rsa: {
      headlines: group.rsa.headlines.map((line) => fitCopy([normalizeAdCase(line)], 30)).filter(Boolean).slice(0, 15),
      descriptions: group.rsa.descriptions.map((line) => fitCopy([normalizeAdCase(line)], 90)).filter(Boolean).slice(0, 4),
    },
  }));
  return spec;
}

export function buildCampaignSpec(input: CampaignInput, ctx: CampaignCtx, role: 'Planned' | 'Emergency' = 'Planned'): CampaignSpec {
  const themes = deriveServiceLines(ctx.services, ctx.trade);
  const budget = clampBudget(input.dailyBudget);
  const city = (ctx.city || input.locations?.[0] || 'Your area').split(',')[0]?.trim() || 'Your area';
  const tradeLabel = normalizeAdCase(tradeKey(ctx.trade) || ctx.trade || themes[0] || 'Search');
  const name = `${tradeLabel} | ${normalizeAdCase(city)} | Search | ${role}`.slice(0, 120);
  const locations = input.locations && input.locations.length ? input.locations : ctx.city ? [ctx.city] : [city];
  const finalUrl = (input.finalUrl || '').trim() || 'https://example.com';
  const brand = businessNameOf({ ...ctx, city });
  const spec: CampaignSpec = {
    name,
    dailyBudget: budget,
    biddingStrategy: 'MAXIMIZE_CLICKS',
    networks: ['Google Search'],
    locations,
    language: 'English',
    finalUrl,
    adGroups: themes.map((theme) => ({ name: theme, keywords: keywordsFor(theme, { ...ctx, city }, NEGATIVES), rsa: rsaFor(theme, { ...ctx, city }, brand) })),
    negatives: NEGATIVES,
    status: 'PAUSED',
    businessName: brand,
    displayPaths: displayPathsOf(themes),
    sitelinks: sitelinksOf(themes, { ...ctx, city }, finalUrl),
    callouts: calloutsOf(ctx),
    structuredSnippet: snippetOf(themes),
  };
  return repairAdCopy(spec);
}

/** Human summary line for the launch confirmation. */
export function campaignSummary(spec: CampaignSpec): string {
  const kw = spec.adGroups.reduce((s, g) => s + g.keywords.length, 0);
  return `${spec.name} · $${spec.dailyBudget}/day · ${spec.adGroups.length} ad groups · ${kw} keywords · ${spec.locations.join(', ')} · status ${spec.status}`;
}

/** Validate a spec before it can go live. Returns a list of problems (empty = ok). */
export function validateCampaignSpec(spec: CampaignSpec): string[] {
  const errs: string[] = [];
  if (!spec.name?.trim()) errs.push('Campaign needs a name.');
  if (!(spec.dailyBudget > 0)) errs.push('Daily budget must be greater than $0.');
  if (!/^https?:\/\/.+\..+/.test(spec.finalUrl)) errs.push('Final URL must be a valid https link to your landing page.');
  if (!spec.locations?.length) errs.push('Pick at least one location to target.');
  if (!spec.adGroups?.length) errs.push('Add at least one ad group.');
  spec.adGroups?.forEach((g, i) => {
    if (!g.keywords?.length) errs.push(`Ad group ${i + 1} (${g.name}) has no keywords.`);
    if (!g.rsa?.headlines?.length || g.rsa.headlines.length < 3) errs.push(`Ad group ${i + 1} (${g.name}) needs at least 3 headlines.`);
    if (!g.rsa?.descriptions?.length || g.rsa.descriptions.length < 2) errs.push(`Ad group ${i + 1} (${g.name}) needs at least 2 descriptions.`);
    g.rsa?.headlines?.forEach((h) => { if (h.length > 30) errs.push(`Headline too long (≤30): "${h}"`); });
    g.rsa?.descriptions?.forEach((d) => { if (d.length > 90) errs.push(`Description too long (≤90): "${d}"`); });
  });
  // Campaign assets — validated only when present (recommended, not required to serve).
  if (spec.businessName && spec.businessName.length > 25) errs.push(`Business name too long (≤25): "${spec.businessName}"`);
  spec.displayPaths?.forEach((p) => { if (p.length > 15) errs.push(`Display path too long (≤15): "${p}"`); });
  spec.callouts?.forEach((c) => { if (c.length > 25) errs.push(`Callout too long (≤25): "${c}"`); });
  spec.sitelinks?.forEach((s) => {
    if (!s.text || s.text.length > 25) errs.push(`Sitelink text must be 1–25 chars: "${s.text}"`);
    if (s.desc1 && s.desc1.length > 35) errs.push(`Sitelink description too long (≤35): "${s.desc1}"`);
    if (s.desc2 && s.desc2.length > 35) errs.push(`Sitelink description too long (≤35): "${s.desc2}"`);
    if (!/^https?:\/\/.+/.test(s.url)) errs.push(`Sitelink needs a valid URL: "${s.text}"`);
  });
  if (spec.structuredSnippet) {
    if (!SNIPPET_HEADERS.includes(spec.structuredSnippet.header)) errs.push(`Structured snippet header must be one of Google's list.`);
    if ((spec.structuredSnippet.values?.length ?? 0) < 3) errs.push('Structured snippet needs at least 3 values.');
    spec.structuredSnippet.values?.forEach((v) => { if (v.length > 25) errs.push(`Snippet value too long (≤25): "${v}"`); });
  }
  return errs;
}
