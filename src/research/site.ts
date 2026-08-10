/**
 * Website importer — paste a URL and pull first-party brand data (logo, colors,
 * services, name) so a customer doesn't have to type it all in. Best-effort HTML
 * scraping of the standard meta tags; every failure returns null so the caller
 * degrades gracefully. Runs server-side (needs outbound fetch, works on deploy).
 */
export interface SiteImport {
  businessName?: string;
  tagline?: string;
  services?: string;
  brandColor?: string;
  logo?: string;
  website?: string;
}

export async function importSite(input: string): Promise<SiteImport | null> {
  let url = (input || '').trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  let res: Response;
  try {
    res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (compatible; MilesBot/1.0)' } });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const html = (await res.text()).slice(0, 400_000);

  const pick = (re: RegExp): string | undefined => {
    const m = html.match(re);
    return m && m[1] ? decode(m[1].trim()) : undefined;
  };
  const attr = (name: string): string | undefined =>
    pick(new RegExp('<meta[^>]+(?:property|name)=["\']' + name + '["\'][^>]+content=["\']([^"\']+)["\']', 'i')) ||
    pick(new RegExp('<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\']' + name + '["\']', 'i'));

  const title = pick(/<title[^>]*>([^<]+)<\/title>/i);
  const businessName = attr('og:site_name') || (title ? title.split(/[|\-–—]/)[0]!.trim() : undefined);
  const tagline = attr('og:title');
  const services = attr('description') || attr('og:description');
  const brandColor = attr('theme-color');

  let logo = attr('og:image');
  if (!logo)
    logo =
      pick(/<link[^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]+href=["']([^"']+)["']/i) ||
      pick(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*apple-touch-icon/i) ||
      pick(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]+href=["']([^"']+)["']/i);

  const base = new URL(res.url || url);
  const abs = (u?: string): string | undefined => {
    if (!u) return undefined;
    try {
      return new URL(u, base).href;
    } catch {
      return undefined;
    }
  };

  const out: SiteImport = {
    businessName,
    tagline: tagline && tagline !== businessName ? tagline : undefined,
    services,
    brandColor,
    logo: abs(logo),
    website: base.origin,
  };
  // Nothing useful found → treat as a miss.
  if (!out.businessName && !out.logo && !out.services) return null;
  return out;
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}
