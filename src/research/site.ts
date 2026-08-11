/**
 * Website importer — the front door of onboarding. Paste a URL and Miles crawls
 * the site (home + about/services/contact) and pulls everything it can: business
 * name, description, services, phone, email, address, socials, logo, brand color —
 * so the customer only fills the gaps. Best-effort HTML scraping + JSON-LD; every
 * failure degrades gracefully. Runs server-side (needs outbound fetch).
 */
export interface SiteImport {
  website?: string;
  businessName?: string;
  tagline?: string;
  description?: string;
  services?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  facebook?: string;
  instagram?: string;
  linkedin?: string;
  twitter?: string;
  youtube?: string;
  tiktok?: string;
  brandColor?: string;
  logo?: string;
  /** How many fields we managed to fill — surfaced to the user. */
  foundFields?: number;
}

const GENERIC = new Set([
  'home','about','about us','contact','contact us','services','service','blog','gallery','reviews','testimonials',
  'menu','login','sign in','book now','get a quote','careers','faq','privacy','terms','shop','cart','search','more',
]);

export function decode(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;|&rsquo;|&apos;/gi, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

/** Pure extractor — pull structured fields out of one page's HTML. Testable. */
export function parseSiteHtml(html: string, baseUrl: string): Partial<SiteImport> {
  const out: Partial<SiteImport> = {};
  const pick = (re: RegExp): string | undefined => { const m = html.match(re); return m && m[1] ? decode(m[1]) : undefined; };
  const attr = (name: string): string | undefined =>
    pick(new RegExp('<meta[^>]+(?:property|name)=["\']' + name + '["\'][^>]+content=["\']([^"\']+)["\']', 'i')) ||
    pick(new RegExp('<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\']' + name + '["\']', 'i'));

  const title = pick(/<title[^>]*>([^<]+)<\/title>/i);
  out.businessName = attr('og:site_name') || (title ? decode(title.split(/[|\-–—•·]/)[0]!) : undefined);
  const ogTitle = attr('og:title');
  if (ogTitle && ogTitle !== out.businessName) out.tagline = ogTitle;
  out.description = attr('description') || attr('og:description');
  out.brandColor = attr('theme-color');

  // Contact: prefer explicit tel:/mailto: links, then loose patterns.
  const tel = pick(/href=["']tel:([+\d][\d\s().\-]{6,}\d)["']/i) || pick(/(\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4})/);
  if (tel) out.phone = decode(tel).replace(/\s+/g, ' ');
  const mail = pick(/href=["']mailto:([^"'?]+@[^"'?]+)["']/i) || pick(/\b([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})\b/);
  if (mail && !/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(mail)) out.email = mail.toLowerCase();

  // Socials — first real profile link per network (skip share/intent buttons).
  const social = (re: RegExp): string | undefined => {
    for (const m of html.matchAll(/https?:\/\/[^"'\s<>]+/gi)) {
      const href = m[0];
      if (re.test(href) && !/\/(sharer|share|intent|plugins|dialog)/i.test(href)) return href.replace(/["'].*$/, '');
    }
    return undefined;
  };
  out.facebook = social(/facebook\.com\//i);
  out.instagram = social(/instagram\.com\//i);
  out.linkedin = social(/linkedin\.com\//i);
  out.twitter = social(/(?:twitter|x)\.com\//i);
  out.youtube = social(/(?:youtube\.com|youtu\.be)\//i);
  out.tiktok = social(/tiktok\.com\//i);

  // Address via loose "City, ST 12345" pattern.
  const addr = html.match(/([A-Z][A-Za-z.\-]+(?:\s+[A-Z][A-Za-z.\-]+)*),\s*([A-Z]{2})\s+(\d{5})(?:-\d{4})?/);
  if (addr) { out.city = decode(addr[1]!); out.state = addr[2]; out.zip = addr[3]; }

  // JSON-LD — the richest source when present (LocalBusiness / Organization).
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { collectLd(JSON.parse(m[1]!), out); } catch { /* skip bad json */ }
  }

  // Services — nav links + section headings, minus boilerplate.
  const cand = new Set<string>();
  for (const m of html.matchAll(/<(?:h2|h3)[^>]*>([^<]{3,50})<\/(?:h2|h3)>/gi)) cand.add(decode(m[1]!));
  for (const m of html.matchAll(/<a[^>]+href=["'][^"']*(?:service|repair|install|cleaning|treatment)[^"']*["'][^>]*>([^<]{3,40})<\/a>/gi)) cand.add(decode(m[1]!));
  const services = [...cand].map((s) => s.trim()).filter((s) => s && !GENERIC.has(s.toLowerCase()) && !/^\W|©|read more|learn more|http/i.test(s)).slice(0, 10);
  if (services.length) out.services = services.join(', ');

  // Logo.
  let logo = attr('og:image')
    || pick(/<link[^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]+href=["']([^"']+)["']/i)
    || pick(/<img[^>]+(?:class|alt|id)=["'][^"']*logo[^"']*["'][^>]+src=["']([^"']+)["']/i)
    || pick(/<img[^>]+src=["']([^"']+)["'][^>]+(?:class|alt|id)=["'][^"']*logo/i)
    || pick(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]+href=["']([^"']+)["']/i);
  try { if (logo) out.logo = new URL(logo, baseUrl).href; } catch { /* ignore */ }

  return out;
}

/** Walk a JSON-LD node (handles arrays and @graph) filling business fields. */
function collectLd(node: unknown, out: Partial<SiteImport>): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) collectLd(n, out); return; }
  const o = node as Record<string, any>;
  if (o['@graph']) collectLd(o['@graph'], out);
  const type = String(o['@type'] || '').toLowerCase();
  if (/business|organization|store|professionalservice|localbusiness/.test(type) || o.telephone || o.address) {
    if (!out.businessName && typeof o.name === 'string') out.businessName = decode(o.name);
    if (!out.phone && o.telephone) out.phone = String(o.telephone);
    if (!out.email && typeof o.email === 'string') out.email = o.email.replace(/^mailto:/i, '').toLowerCase();
    const a = o.address && typeof o.address === 'object' ? o.address : null;
    if (a) {
      if (!out.address && a.streetAddress) out.address = decode(String(a.streetAddress));
      if (!out.city && a.addressLocality) out.city = decode(String(a.addressLocality));
      if (!out.state && a.addressRegion) out.state = String(a.addressRegion);
      if (!out.zip && a.postalCode) out.zip = String(a.postalCode);
    }
    for (const s of ([] as string[]).concat(o.sameAs || [])) {
      if (/facebook\.com/i.test(s) && !out.facebook) out.facebook = s;
      else if (/instagram\.com/i.test(s) && !out.instagram) out.instagram = s;
      else if (/linkedin\.com/i.test(s) && !out.linkedin) out.linkedin = s;
      else if (/(twitter|x)\.com/i.test(s) && !out.twitter) out.twitter = s;
      else if (/(youtube\.com|youtu\.be)/i.test(s) && !out.youtube) out.youtube = s;
      else if (/tiktok\.com/i.test(s) && !out.tiktok) out.tiktok = s;
    }
  }
}

async function fetchPage(url: string): Promise<{ html: string; finalUrl: string } | null> {
  try {
    const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (compatible; MilesBot/1.0)' } });
    if (!res.ok) return null;
    return { html: (await res.text()).slice(0, 500_000), finalUrl: res.url || url };
  } catch { return null; }
}

/** Crawl home + a couple of key internal pages and merge what's found. */
export async function importSite(input: string): Promise<SiteImport | null> {
  let url = (input || '').trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  const home = await fetchPage(url);
  if (!home) return null;
  const base = new URL(home.finalUrl);
  const merged: SiteImport = { website: base.origin };
  const apply = (p: Partial<SiteImport>) => { for (const [k, v] of Object.entries(p)) if (v && !(merged as any)[k]) (merged as any)[k] = v; };
  apply(parseSiteHtml(home.html, base.href));

  // Follow a few high-value internal links (about / services / contact).
  const wanted = ['contact', 'service', 'about'];
  const links = new Map<string, string>();
  for (const m of home.html.matchAll(/<a[^>]+href=["']([^"'#]+)["']/gi)) {
    const href = m[1]!;
    for (const w of wanted) {
      if (!links.has(w) && new RegExp(w, 'i').test(href)) {
        try { links.set(w, new URL(href, base.href).href); } catch { /* ignore */ }
      }
    }
  }
  for (const href of [...links.values()].slice(0, 3)) {
    if (new URL(href).origin !== base.origin) continue;
    const page = await fetchPage(href);
    if (page) apply(parseSiteHtml(page.html, page.finalUrl));
  }

  merged.foundFields = Object.entries(merged).filter(([k, v]) => k !== 'website' && k !== 'foundFields' && v).length;
  if (merged.foundFields === 0) return null;
  return merged;
}
