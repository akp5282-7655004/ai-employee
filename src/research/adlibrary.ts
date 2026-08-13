/**
 * Competitor Ad Watch — reads Meta's public Ad Library to show the actual ads a
 * shop's local competitors are running. Miles surfaces their angles and copy so
 * the owner can make their own version of what's already working in their niche.
 *
 * Enabled by META_AD_LIBRARY_TOKEN (a token from a Meta app with Ad Library API
 * access). Every call degrades to an empty list so the UI stays honest without it.
 * Coverage of non-political/commercial ads via the API depends on Meta's rules for
 * the region — the UI says so rather than pretending.
 */
const BASE = process.env.META_AD_LIBRARY_BASE || 'https://graph.facebook.com/v20.0';

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
  platforms: string[];
}

export interface AdSearchOpts {
  terms: string;
  countries?: string[];
  limit?: number;
}

/** Search the Ad Library for active ads matching the search terms. */
export async function searchCompetitorAds(opts: AdSearchOpts): Promise<CompetitorAd[]> {
  const token = process.env.META_AD_LIBRARY_TOKEN;
  if (!token || !opts.terms.trim()) return [];
  const params = new URLSearchParams({
    access_token: token,
    search_terms: opts.terms,
    ad_reached_countries: JSON.stringify(opts.countries?.length ? opts.countries : ['US']),
    ad_active_status: 'ACTIVE',
    ad_type: 'ALL',
    fields: 'id,page_name,ad_creative_bodies,ad_creative_link_titles,ad_snapshot_url,ad_delivery_start_time,publisher_platforms',
    limit: String(Math.min(opts.limit ?? 24, 50)),
  });
  try {
    const res = await fetch(`${BASE}/ads_archive?${params.toString()}`);
    if (!res.ok) return [];
    const data: any = await res.json();
    const rows: any[] = Array.isArray(data?.data) ? data.data : [];
    return rows
      .map((a) => ({
        id: String(a?.id ?? ''),
        page: String(a?.page_name ?? 'Advertiser'),
        body: (a?.ad_creative_bodies?.[0] ?? '').toString().slice(0, 600),
        title: a?.ad_creative_link_titles?.[0] ? String(a.ad_creative_link_titles[0]).slice(0, 200) : undefined,
        snapshotUrl: typeof a?.ad_snapshot_url === 'string' ? a.ad_snapshot_url : undefined,
        started: typeof a?.ad_delivery_start_time === 'string' ? a.ad_delivery_start_time : undefined,
        platforms: Array.isArray(a?.publisher_platforms) ? a.publisher_platforms.map((p: unknown) => String(p)) : [],
      }))
      .filter((a) => a.id && a.body);
  } catch {
    return [];
  }
}
