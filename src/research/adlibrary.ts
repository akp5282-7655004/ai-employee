/**
 * Competitor Ad Research — reads Meta's Ad Library the way a veteran media buyer
 * does, not as a raw dump. Two honest truths shape this module:
 *
 *  1. Meta's Ad Library API only returns full data for EU-delivered ads and for
 *     political/issue ads worldwide. US *commercial* competitor ads — what a local
 *     contractor actually wants — are NOT available through the API in 2026; that
 *     data lives only in the free public web UI (facebook.com/ads/library).
 *  2. So Miles does two things: (a) when a token is set, it pulls and *analyzes*
 *     whatever the API can return (EU / political) — computing run-time, variant
 *     replication, and advertiser "mode"; and (b) always builds smart deep-links
 *     into the web UI, pre-filtered and pre-sorted, plus the expert read-the-signals
 *     checklist — the working path for US commercial research.
 *
 * The read-the-signals method (per the 2026 Ad Library guides): don't trust how
 * long an ad has run on its own — under cost-cap/bid-cap buying an old ad is often
 * just one nobody pruned. Read REPLICATION (the same angle rebuilt as many
 * near-identical variants = a bet being scaled) and impression weight instead, and
 * read the count of an advertiser's active ads as their posture (maintenance /
 * testing / scaling).
 */
const BASE = process.env.META_AD_LIBRARY_BASE || 'https://graph.facebook.com/v20.0';
const WEB = 'https://www.facebook.com/ads/library/';

export function adLibraryReady(): boolean {
  return !!process.env.META_AD_LIBRARY_TOKEN;
}

export interface CompetitorAd {
  id: string;
  page: string;
  body: string;
  title?: string;
  snapshotUrl?: string;
  started?: string;
  stopped?: string;
  daysRunning?: number;
  impressionsText?: string;
  platforms: string[];
}

/** A cluster of near-identical ads = one angle the advertiser is replicating. */
export interface AdAngle {
  page: string;
  gist: string;
  variants: number;
  maxDaysRunning: number;
  sample: CompetitorAd;
  signal: 'scaling-bet' | 'testing' | 'single';
}

export interface AdvertiserPosture {
  page: string;
  activeAds: number;
  mode: 'maintenance' | 'testing' | 'scaling';
}

export interface AdLibraryDeepLink {
  label: string;
  url: string;
  note?: string;
}

export interface CompetitorAdReport {
  ready: boolean; // API token present
  apiCovers: boolean; // whether the API meaningfully covers this query (US commercial → false)
  query: string;
  country: string;
  ads: CompetitorAd[];
  angles: AdAngle[];
  advertisers: AdvertiserPosture[];
  deepLinks: AdLibraryDeepLink[];
  checklist: string[];
  note: string;
}

export interface AdSearchOpts {
  terms: string;
  countries?: string[];
  limit?: number;
}

const EU = new Set([
  'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE',
]);

/** Search the Ad Library API for active ads matching the search terms. */
export async function searchCompetitorAds(opts: AdSearchOpts): Promise<CompetitorAd[]> {
  const token = process.env.META_AD_LIBRARY_TOKEN;
  if (!token || !opts.terms.trim()) return [];
  const params = new URLSearchParams({
    access_token: token,
    search_terms: opts.terms,
    ad_reached_countries: JSON.stringify(opts.countries?.length ? opts.countries : ['US']),
    ad_active_status: 'ACTIVE',
    ad_type: 'ALL',
    fields:
      'id,page_name,ad_creative_bodies,ad_creative_link_titles,ad_snapshot_url,ad_delivery_start_time,ad_delivery_stop_time,impressions,publisher_platforms',
    limit: String(Math.min(opts.limit ?? 24, 50)),
  });
  try {
    const res = await fetch(`${BASE}/ads_archive?${params.toString()}`);
    if (!res.ok) return [];
    const data: any = await res.json();
    const rows: any[] = Array.isArray(data?.data) ? data.data : [];
    return rows.map(mapAd).filter((a) => a.id && a.body);
  } catch {
    return [];
  }
}

function mapAd(a: any): CompetitorAd {
  const started = typeof a?.ad_delivery_start_time === 'string' ? a.ad_delivery_start_time : undefined;
  const stopped = typeof a?.ad_delivery_stop_time === 'string' ? a.ad_delivery_stop_time : undefined;
  const imp = a?.impressions;
  const impressionsText =
    imp && (imp.lower_bound || imp.upper_bound)
      ? `${imp.lower_bound ?? '?'}–${imp.upper_bound ?? '?'}`
      : undefined;
  return {
    id: String(a?.id ?? ''),
    page: String(a?.page_name ?? 'Advertiser'),
    body: (a?.ad_creative_bodies?.[0] ?? '').toString().slice(0, 600),
    title: a?.ad_creative_link_titles?.[0] ? String(a.ad_creative_link_titles[0]).slice(0, 200) : undefined,
    snapshotUrl: typeof a?.ad_snapshot_url === 'string' ? a.ad_snapshot_url : undefined,
    started,
    stopped,
    daysRunning: daysRunning(started, stopped),
    impressionsText,
    platforms: Array.isArray(a?.publisher_platforms) ? a.publisher_platforms.map((p: unknown) => String(p)) : [],
  };
}

function daysRunning(start?: string, stop?: string): number | undefined {
  if (!start) return undefined;
  const s = Date.parse(start);
  if (Number.isNaN(s)) return undefined;
  const end = stop ? Date.parse(stop) : Date.now();
  if (Number.isNaN(end)) return undefined;
  return Math.max(0, Math.round((end - s) / 86_400_000));
}

/** Fingerprint an ad body so near-identical variants cluster together. */
function fingerprint(body: string): string {
  return body
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 14)
    .join(' ');
}

/** Group ads into replicated angles — the honest "what are they betting on" read. */
export function groupAngles(ads: CompetitorAd[]): AdAngle[] {
  const map = new Map<string, CompetitorAd[]>();
  for (const a of ads) {
    const key = a.page + '::' + fingerprint(a.body);
    const arr = map.get(key) ?? [];
    arr.push(a);
    map.set(key, arr);
  }
  const angles: AdAngle[] = [];
  for (const arr of map.values()) {
    const sample = arr.slice().sort((x, y) => (y.daysRunning ?? 0) - (x.daysRunning ?? 0))[0]!;
    const variants = arr.length;
    angles.push({
      page: sample.page,
      gist: (sample.title ? sample.title + ' — ' : '') + sample.body.slice(0, 140),
      variants,
      maxDaysRunning: Math.max(...arr.map((a) => a.daysRunning ?? 0)),
      sample,
      signal: variants >= 4 ? 'scaling-bet' : variants >= 2 ? 'testing' : 'single',
    });
  }
  // Replication first (a scaled angle beats a lone long-runner), then longevity.
  return angles.sort((a, b) => b.variants - a.variants || b.maxDaysRunning - a.maxDaysRunning);
}

/** Read each advertiser's active-ad count as posture: maintenance / testing / scaling. */
export function advertiserPostures(ads: CompetitorAd[]): AdvertiserPosture[] {
  const count = new Map<string, number>();
  for (const a of ads) count.set(a.page, (count.get(a.page) ?? 0) + 1);
  return [...count.entries()]
    .map(([page, n]) => ({
      page,
      activeAds: n,
      mode: (n >= 15 ? 'scaling' : n >= 5 ? 'testing' : 'maintenance') as AdvertiserPosture['mode'],
    }))
    .sort((a, b) => b.activeAds - a.activeAds);
}

/** Smart deep-links into the free web UI — the working path for US commercial research. */
export function buildDeepLinks(terms: string, country: string, competitors: string[]): AdLibraryDeepLink[] {
  const c = (country || 'US').toUpperCase();
  const q = (t: string, active: 'active' | 'all' = 'active') => {
    const p = new URLSearchParams({
      active_status: active,
      ad_type: 'all',
      country: c,
      media_type: 'all',
      search_type: 'keyword_unordered',
      q: t,
    });
    return `${WEB}?${p.toString()}`;
  };
  const links: AdLibraryDeepLink[] = [
    { label: `Active ads · “${terms}”`, url: q(terms, 'active'), note: 'What competitors are running right now' },
    { label: `All ads (incl. stopped) · “${terms}”`, url: q(terms, 'all'), note: 'Adds recently-killed tests — the deltas are their failed experiments' },
  ];
  for (const name of competitors.filter(Boolean).slice(0, 4)) {
    links.push({ label: `By name · ${name}`, url: q(name, 'all'), note: 'Open their page, then “See all ads” for the full account' });
  }
  return links;
}

/** The expert read-the-signals checklist, encoded from the 2026 Ad Library guides. */
export function readingChecklist(): string[] {
  return [
    'Sort by Oldest — the longest-running ad is their control. But longevity alone is weak: under cost-cap buying an old ad is often just one nobody turned off.',
    'Read REPLICATION first — one angle rebuilt as many near-identical variants is the real "this is working" signal. That’s their bet.',
    'Count their active ads as posture: 1–3 = maintenance (proven campaign, not testing), 5–15 = active testing, 15+ = scaling a winner.',
    'Use impression weight where shown (EU markets expose ranges for all ads) — it’s the closest public proxy for what the system is actually delivering.',
    'Read the CTA + destination URL as a pair: Shop Now → product = direct response; Learn More → advertorial = cold education; Get Offer → landing page = a control offer they’re protecting.',
    'Don’t clone — adapt. Extract the structure (promise → proof → format), then make your own version. Copying keeps you a step behind whoever you copy.',
  ];
}

const US_COMMERCIAL_NOTE =
  'Heads up: Meta’s Ad Library API only returns full data for EU-delivered ads and political ads — US commercial competitor ads aren’t in the API in 2026, only in the free web UI. So for US research, use the pre-built links below (they open the real Ad Library, which does have full US coverage) and the read-the-signals checklist. The API pull below covers EU/political only.';

const READY_NOTE =
  'Pulled live from Meta’s Ad Library API. For US commercial ads the API is limited to EU/political — use the web-UI links for full local coverage.';

const UNCONFIGURED_NOTE =
  'No API token set — that’s fine for US research, since US commercial ads live only in the free web UI anyway. Use the pre-built links below plus the checklist. (Add META_AD_LIBRARY_TOKEN on Render to also pull EU/political ads inline.)';

/** Full competitor-ad report: analyzed API results (when useful) + web-UI handoff. */
export async function competitorAdReport(
  terms: string,
  country: string,
  competitors: string[],
): Promise<CompetitorAdReport> {
  const c = (country || 'US').toUpperCase();
  const apiCovers = EU.has(c); // API meaningfully covers commercial ads only in the EU
  const ready = adLibraryReady();
  const ads = ready ? await searchCompetitorAds({ terms, countries: [c], limit: 30 }) : [];
  return {
    ready,
    apiCovers,
    query: terms,
    country: c,
    ads,
    angles: groupAngles(ads),
    advertisers: advertiserPostures(ads),
    deepLinks: buildDeepLinks(terms, c, competitors),
    checklist: readingChecklist(),
    note: !ready ? UNCONFIGURED_NOTE : apiCovers ? READY_NOTE : US_COMMERCIAL_NOTE,
  };
}
