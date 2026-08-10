/**
 * Real competitor listings via Google Places (Text Search) — the most concrete
 * competition layer: actual businesses, names, ratings, and review counts near a
 * ZIP. Enabled by GOOGLE_PLACES_KEY; returns null when unset or the key is
 * rejected, so the Research tab degrades to the Census competitor *count* only.
 */
export interface Competitor {
  name: string;
  rating?: number;
  reviews?: number;
  address?: string;
}

export async function searchCompetitors(query: string): Promise<Competitor[] | null> {
  const key = process.env.GOOGLE_PLACES_KEY;
  if (!key) return null;
  try {
    const url =
      'https://maps.googleapis.com/maps/api/place/textsearch/json?query=' +
      encodeURIComponent(query) +
      '&key=' +
      key;
    const res = await fetch(url);
    if (!res.ok) return null;
    const j = (await res.json()) as { status?: string; results?: any[] };
    // A bad/unauthorized key or quota error → treat as "not available".
    if (j.status && j.status !== 'OK' && j.status !== 'ZERO_RESULTS') return null;
    const rows = j.results ?? [];
    return rows
      .map((r) => ({
        name: String(r.name ?? ''),
        rating: typeof r.rating === 'number' ? r.rating : undefined,
        reviews: typeof r.user_ratings_total === 'number' ? r.user_ratings_total : undefined,
        address: r.formatted_address,
      }))
      .filter((c) => c.name)
      .sort((a, b) => (b.reviews ?? 0) - (a.reviews ?? 0))
      .slice(0, 8);
  } catch {
    return null;
  }
}
