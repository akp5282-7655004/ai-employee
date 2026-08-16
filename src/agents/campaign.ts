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
const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());
const clip = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, '').trim());

/** Split a services string ("Interior & exterior repaints, cabinets") into themes. */
function serviceThemes(ctx: CampaignCtx): string[] {
  const raw = (ctx.services || ctx.trade || 'services').split(/[,;/&]|\band\b/i).map((s) => s.trim()).filter(Boolean);
  const themes = raw.length ? raw : [ctx.trade || 'services'];
  return themes.slice(0, 3).map((t) => titleCase(t));
}

/** High-intent keyword set for a service theme in a city. */
function keywordsFor(theme: string, ctx: CampaignCtx): KeywordSpec[] {
  const t = theme.toLowerCase();
  const city = (ctx.city || '').toLowerCase();
  const out: KeywordSpec[] = [
    { text: `${t} near me`, match: 'phrase' },
    { text: `${t} services`, match: 'phrase' },
    { text: city ? `${t} ${city}` : `local ${t}`, match: 'phrase' },
    { text: `${t} cost`, match: 'broad' },
    { text: `${t} quote`, match: 'broad' },
    { text: `best ${t}`, match: 'exact' },
  ];
  // de-dupe by text
  const seen = new Set<string>();
  return out.filter((k) => (seen.has(k.text) ? false : (seen.add(k.text), true)));
}

/** Deterministic responsive-search-ad copy for a theme (within Google's limits). */
function rsaFor(theme: string, ctx: CampaignCtx): RsaSpec {
  const biz = ctx.business || 'Us';
  const city = ctx.city ? ` in ${ctx.city}` : '';
  const offer = ctx.offers ? clip(ctx.offers, 30) : '';
  // Google serves best with ALL 15 headline slots filled (master spec:
  // "recommendation: max out 15/4") — vary lengths, include the theme in ≥2.
  const headlines = [
    clip(`${theme}${city}`, 30),
    clip(`${biz} — ${theme}`, 30),
    clip(`${theme} Done Right`, 30),
    'Fast, Reliable Service',
    'Free Quote Today',
    'Licensed & Insured',
    'Book Online in Minutes',
    offer ? clip(offer, 30) : 'Trusted Local Pros',
    'Same-Day Availability',
    clip(`Top-Rated ${theme}`, 30),
    clip(`Local ${theme} Experts`, 30),
    ctx.city ? clip(`${ctx.city}'s Trusted Choice`, 30) : 'Your Trusted Local Choice',
    'Upfront, Honest Pricing',
    '100% Satisfaction Focus',
    clip(`Call Now — ${theme}`, 30),
  ].filter(Boolean);
  const descriptions = [
    clip(`${biz} offers ${theme.toLowerCase()}${city}. Fast response, upfront pricing, quality work.`, 90),
    clip(`${offer ? offer + '. ' : ''}Get your free quote today and see why locals choose us.`, 90),
    clip(`Licensed, insured, and reliable. Call or book online for ${theme.toLowerCase()}.`, 90),
    'Trusted by your neighbors. Honest pricing, on-time service, guaranteed work.',
  ];
  const dedup = [...new Set(headlines)];
  return { headlines: dedup.slice(0, 15), descriptions: descriptions.slice(0, 4) };
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
  return clip(ctx.business || ctx.trade || 'Our Business', 25);
}

/** Two ≤15-char display-path segments (alphanumeric, hyphen for spaces). */
function displayPathsOf(themes: string[]): string[] {
  const seg = (s: string) => clip(s.replace(/[^a-z0-9 ]/gi, '').trim().replace(/\s+/g, '-'), 15);
  return [seg(themes[0] || 'Services'), 'Free-Quote'].filter(Boolean);
}

/** 4+ sitelinks derived from the services, each with its own final URL + descriptions. */
function sitelinksOf(themes: string[], ctx: CampaignCtx, finalUrl: string): Sitelink[] {
  const base: { text: string; desc1: string; desc2: string; seg: string }[] = [
    { text: clip(themes[0] || 'Our Services', 25), desc1: clip(`Professional ${(themes[0] || 'service').toLowerCase()}`, 35), desc2: 'Fast, reliable, done right', seg: 'services' },
    { text: 'Get a Free Quote', desc1: 'No-obligation estimate', desc2: 'Upfront, honest pricing', seg: 'quote' },
    { text: 'About Us', desc1: clip(`Trusted ${ctx.city ? 'in ' + ctx.city : 'local'} team`, 35), desc2: 'Licensed & insured', seg: 'about' },
    { text: 'Contact Us', desc1: 'Call or message anytime', desc2: 'We respond fast', seg: 'contact' },
  ];
  if (themes[1]) base.splice(1, 0, { text: clip(themes[1], 25), desc1: clip(`${themes[1]} services`, 35), desc2: 'Ask about our options', seg: 'services-2' });
  return base.slice(0, 6).map((s) => ({ text: s.text, desc1: s.desc1, desc2: s.desc2, url: urlWith(finalUrl, s.seg) }));
}

/** 4–6 callout assets (≤25 each), no punctuation-heavy text. */
function calloutsOf(ctx: CampaignCtx): string[] {
  const outs = ['Licensed & Insured', 'Free Estimates', 'Locally Owned', 'Satisfaction Guaranteed', 'Fast Response Times', 'Experienced Professionals'];
  if (ctx.offers) outs.unshift(clip(ctx.offers.replace(/[.!]+$/, ''), 25));
  return [...new Set(outs.map((c) => clip(c, 25)))].slice(0, 6);
}

/** Structured snippet — header "Service catalog" + the service themes as values (≥3). */
function snippetOf(themes: string[]): StructuredSnippet {
  const vals = [...new Set(themes.map((t) => clip(titleCase(t), 25)))];
  while (vals.length < 3) vals.push(['Free Estimates', 'Emergency Service', 'Quality Guaranteed'][vals.length] || 'Service');
  return { header: 'Service catalog', values: vals.slice(0, 10) };
}

/** Build a complete, launch-ready campaign spec. Always full; never partial. */
export function buildCampaignSpec(input: CampaignInput, ctx: CampaignCtx): CampaignSpec {
  const themes = serviceThemes(ctx);
  const budget = clampBudget(input.dailyBudget);
  const name = clip(`${ctx.business || ctx.trade || 'New'} — ${themes[0] ?? 'Search'} ${new Date().getFullYear()}`, 120);
  const locations = input.locations && input.locations.length ? input.locations : ctx.city ? [ctx.city] : ['United States'];
  const finalUrl = (input.finalUrl || '').trim() || 'https://example.com';
  return {
    name,
    dailyBudget: budget,
    biddingStrategy: 'MAXIMIZE_CLICKS',
    networks: ['Google Search', 'Search partners'],
    locations,
    language: 'English',
    finalUrl,
    adGroups: themes.map((theme) => ({ name: theme, keywords: keywordsFor(theme, ctx), rsa: rsaFor(theme, ctx) })),
    negatives: defaultNegatives(),
    status: 'PAUSED',
    businessName: businessNameOf(ctx),
    displayPaths: displayPathsOf(themes),
    sitelinks: sitelinksOf(themes, ctx, finalUrl),
    callouts: calloutsOf(ctx),
    structuredSnippet: snippetOf(themes),
  };
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
