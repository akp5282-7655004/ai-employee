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
}

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
  ].filter(Boolean);
  const descriptions = [
    clip(`${biz} offers ${theme.toLowerCase()}${city}. Fast response, upfront pricing, quality work.`, 90),
    clip(`${offer ? offer + '. ' : ''}Get your free quote today and see why locals choose us.`, 90),
    clip(`Licensed, insured, and reliable. Call or book online for ${theme.toLowerCase()}.`, 90),
    'Trusted by your neighbors. Honest pricing, on-time service, guaranteed work.',
  ];
  return { headlines: headlines.slice(0, 10), descriptions: descriptions.slice(0, 4) };
}

/** Negative keywords that stop wasted spend for local-service search. */
function defaultNegatives(): string[] {
  return ['jobs', 'careers', 'salary', 'hiring', 'diy', 'how to', 'free', 'training', 'course', 'cheap', 'used', 'wholesale'];
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
  return errs;
}
