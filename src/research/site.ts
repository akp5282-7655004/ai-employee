/**
 * Website importer — the front door of onboarding. Paste a URL and Miles crawls
 * the site (home plus the pages that actually carry business facts: about,
 * services, contact, service areas, specials) and pulls everything it can:
 * name, trade, year founded, team size, services, service areas, offers, phone,
 * email, address, socials, logo, brand colors, website platform, and whether
 * they already run ads or collect emails — so the customer only fills the gaps.
 *
 * Two rules govern this file. Every field must come from something actually on
 * the page: we infer, we never invent, and a field we cannot evidence is left
 * blank for the human rather than guessed. And every failure degrades — a dead
 * page, malformed JSON-LD or a hostile WAF costs us that one source, not the
 * import. Runs server-side (needs outbound fetch).
 */
export interface SiteImport {
  website?: string;
  businessName?: string;
  tagline?: string;
  description?: string;
  industry?: string;
  yearStarted?: number;
  employees?: number;
  services?: string;
  serviceAreas?: string;
  currentOffers?: string;
  targetKeywords?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  websitePlatform?: string;
  runningAds?: string;
  collectsEmails?: string;
  emailTool?: string;
  facebook?: string;
  instagram?: string;
  linkedin?: string;
  twitter?: string;
  youtube?: string;
  tiktok?: string;
  /** Single hex from <meta name="theme-color"> — kept for the Assets panel. */
  brandColor?: string;
  /** Human-readable list of the colors the site actually uses. */
  brandColors?: string;
  logo?: string;
  /** How many fields we managed to fill — surfaced to the user. */
  foundFields?: number;
  /** Which fields, by profile key, so the UI can say what it filled. */
  filled?: string[];
  /** How many pages we successfully read. */
  pagesRead?: number;
  /** Set when the site refused us outright, so the UI can say so honestly. */
  blocked?: boolean;
}

const GENERIC = new Set([
  'home','about','about us','contact','contact us','services','service','our services','blog','gallery','reviews',
  'testimonials','menu','login','sign in','book now','get a quote','request a quote','free estimate','careers','faq',
  'privacy','terms','shop','cart','search','more','our work','portfolio','financing','why choose us','our team',
  'meet the team','get in touch','locations','service areas','areas we serve','news','projects','before and after',
]);

/**
 * The trades we sell to, with the words their sites actually use. Order matters
 * only for ties; scoring picks the winner. "Home Services" sits last as the
 * catch-all for a general contractor whose site names no single trade.
 */
const TRADES: { label: string; words: string[] }[] = [
  { label: 'Painting', words: ['painting','painter','painters','house painting','interior painting','exterior painting','cabinet refinishing','repaint','paint job','drywall repair','staining'] },
  { label: 'Plumbing', words: ['plumbing','plumber','plumbers','drain cleaning','water heater','sewer line','repiping','leak detection','clogged drain','sump pump'] },
  { label: 'HVAC', words: ['hvac','heating and cooling','air conditioning','furnace','heat pump','ac repair','air conditioner','ductwork','tune-up','mini split'] },
  { label: 'Electrical', words: ['electrical','electrician','electricians','panel upgrade','rewiring','wiring','circuit breaker','ev charger','generator install'] },
  { label: 'Roofing', words: ['roofing','roofer','roofers','roof replacement','roof repair','shingle','shingles','asphalt roof','metal roof','flat roof'] },
  { label: 'Landscaping', words: ['landscaping','landscaper','lawn care','lawn mowing','hardscaping','sod','irrigation','tree trimming','mulching'] },
  { label: 'Cleaning', words: ['house cleaning','maid service','janitorial','deep cleaning','carpet cleaning','move out cleaning','housekeeping','commercial cleaning'] },
  { label: 'Pest Control', words: ['pest control','exterminator','termite','bed bugs','rodent control','mosquito control','wildlife removal'] },
  { label: 'Dental', words: ['dental','dentist','orthodontic','teeth whitening','invisalign','dental implants','root canal'] },
  { label: 'Solar', words: ['solar','solar panels','photovoltaic','solar installation','net metering','battery storage'] },
  { label: 'Flooring', words: ['flooring','hardwood floors','laminate flooring','tile installation','vinyl plank','carpet installation','floor refinishing'] },
  { label: 'Windows & Doors', words: ['window replacement','replacement windows','window installation','door installation','patio doors','entry doors'] },
  { label: 'Garage Doors', words: ['garage door','garage doors','garage door opener','garage door repair'] },
  { label: 'Concrete & Masonry', words: ['concrete','masonry','driveway','patio pour','stamped concrete','brick repair','retaining wall','paver','hardscape'] },
  { label: 'Fencing', words: ['fencing','fence installation','fence repair','vinyl fence','chain link','wood fence'] },
  { label: 'Tree Service', words: ['tree service','tree removal','tree trimming','arborist','stump grinding','tree care'] },
  { label: 'Pool Service', words: ['pool service','pool cleaning','pool maintenance','pool repair','pool resurfacing'] },
  { label: 'Restoration', words: ['water damage','restoration','mold remediation','fire damage','water mitigation','flood cleanup'] },
  { label: 'Remodeling', words: ['remodeling','remodel','kitchen remodeling','bathroom remodeling','home renovation','renovations','general contractor'] },
  { label: 'Siding & Gutters', words: ['siding','gutters','gutter installation','gutter guards','soffit','fascia'] },
  { label: 'Appliance Repair', words: ['appliance repair','refrigerator repair','washer repair','dryer repair','dishwasher repair'] },
  { label: 'Home Services', words: ['home services','handyman','home repair','home improvement','property maintenance'] },
];

/** A trade needs real presence on the page, not one passing mention. */
const MIN_TRADE_SCORE = 4;

/** Website platforms we can fingerprint, mapped to the profile's dropdown. */
const PLATFORMS: { label: string; re: RegExp }[] = [
  { label: 'GoHighLevel', re: /msgsndr\.com|leadconnectorhq\.com|gohighlevel/i },
  { label: 'WordPress', re: /\/wp-content\/|\/wp-includes\/|content=["']WordPress/i },
  { label: 'Wix', re: /wixstatic\.com|_wixCssImports|content=["']Wix\.com/i },
  { label: 'Squarespace', re: /squarespace\.com|static1\.squarespace|content=["']Squarespace/i },
  { label: 'GoDaddy', re: /img1\.wsimg\.com|godaddysites\.com/i },
  { label: 'Webflow', re: /data-wf-page|assets\.website-files\.com|content=["']Webflow/i },
  { label: 'Shopify', re: /cdn\.shopify\.com|Shopify\.theme/i },
  { label: 'Duda', re: /irp\.cdn-website\.com|dudaone|content=["']Duda/i },
  { label: 'HubSpot', re: /hs-scripts\.com|hubspotusercontent/i },
];

/** Email tools whose embed code is visible in the page source. */
const EMAIL_TOOLS: { label: string; re: RegExp }[] = [
  { label: 'Mailchimp', re: /list-manage\.com|chimpstatic\.com|mailchimp/i },
  { label: 'Klaviyo', re: /klaviyo\.com/i },
  { label: 'Constant Contact', re: /constantcontact\.com|ctctcdn\.com/i },
  { label: 'HubSpot', re: /hs-scripts\.com|hsforms\.(net|com)/i },
  { label: 'ActiveCampaign', re: /activehosted\.com|activecampaign/i },
  { label: 'GoHighLevel', re: /msgsndr\.com|leadconnectorhq\.com/i },
  { label: 'ConvertKit', re: /convertkit\.com/i },
];

/** Fields we union across pages rather than taking the first page's answer. */
const UNION_FIELDS = ['services', 'serviceAreas', 'currentOffers'] as const;

export function decode(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;|&rsquo;|&apos;/gi, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => { const n = Number(d); return n > 31 && n < 0x10000 ? String.fromCharCode(n) : ' '; })
    .replace(/\s+/g, ' ').trim();
}

/** Everything a human would read on the page, with the machinery stripped out. */
export function visibleText(html: string): string {
  return decode(
    html
      .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' '),
  );
}

/** Occurrences of a phrase as whole words, capped so keyword stuffing can't run away. */
function countPhrase(text: string, phrase: string): number {
  const re = new RegExp('\\b' + phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
  let n = 0;
  for (const _m of text.matchAll(re)) { if (++n >= 6) break; }
  return n;
}

/**
 * Which trade is this? Scored across the page, with the title and headings
 * weighted heavily — a roofer who mentions painting once stays a roofer.
 * Returns undefined rather than a guess when nothing clears the bar.
 */
export function detectIndustry(body: string, strong = ''): string | undefined {
  let best: { label: string; score: number } | undefined;
  for (const t of TRADES) {
    let score = 0;
    for (const w of t.words) score += countPhrase(body, w) + countPhrase(strong, w) * 4;
    if (!best || score > best.score) best = { label: t.label, score };
  }
  return best && best.score >= MIN_TRADE_SCORE ? best.label : undefined;
}

/**
 * Year founded, from the phrasings contractors actually use. A copyright line
 * is explicitly not a founding date, and "over 25 years" is only trusted when
 * no explicit year is stated.
 */
export function detectYearFounded(text: string, thisYear: number): number | undefined {
  const ok = (y: number) => y >= 1850 && y <= thisYear;
  const explicit = [
    /(?:serving[^.]{0,60}?)?\bsince\s+(1[89]\d{2}|20\d{2})/i,
    /\b(?:established|est\.?|founded|founding|in business|family[- ]owned)\s*(?:in|since)?\s*(1[89]\d{2}|20\d{2})/i,
    /\b(1[89]\d{2}|20\d{2})\s*[-–—]\s*(?:present|today)/i,
  ];
  for (const re of explicit) {
    const m = text.match(re);
    if (!m || !m[1]) continue;
    // A "©"/"copyright" immediately before the match makes it a footer year, not a founding year.
    const before = text.slice(Math.max(0, m.index! - 24), m.index!);
    if (/©|\(c\)|copyright/i.test(before)) continue;
    const y = Number(m[1]);
    if (ok(y)) return y;
  }
  const rel = text.match(/\b(?:over|more than|nearly|almost)?\s*(\d{1,3})\+?\s*years?\s+(?:of\s+)?(?:experience|in business|serving|strong)/i);
  if (rel && rel[1]) {
    const n = Number(rel[1]);
    if (n >= 2 && n <= 120) return thisYear - n;
  }
  return undefined;
}

/** Team size, only from a sentence that plainly states one. */
export function detectEmployees(text: string): number | undefined {
  const pats = [
    /\bteam of\s+(?:over\s+|more than\s+)?(\d{1,4})\b/i,
    /\b(\d{1,4})\+?\s+(?:full[- ]time\s+)?(?:employees|technicians|crew members|staff members|painters|plumbers|electricians|installers)\b/i,
    /\b(\d{1,4})[- ]person\s+(?:team|crew|company)\b/i,
  ];
  for (const re of pats) {
    const m = text.match(re);
    if (m && m[1]) { const n = Number(m[1]); if (n >= 1 && n <= 5000) return n; }
  }
  return undefined;
}

/**
 * Promotions worth putting in front of a customer. Deliberately narrow —
 * a dollar figure, a percentage, or one of the standard free-X offers.
 */
export function detectOffers(text: string): string[] {
  const out = new Set<string>();
  const pats = [
    /\$\s?\d{1,4}(?:\.\d{2})?\s*(?:off|discount)\b[^.!?|]{0,30}/gi,
    /\b\d{1,2}%\s*off\b[^.!?|]{0,30}/gi,
    /\$\s?\d{1,4}\s+(?:[a-z][a-z-]{2,14}\s+){0,3}(?:tune[- ]?up|special|inspection|service call|estimate|cleaning)/gi,
    /\bfree\s+(?:estimate|quote|inspection|consultation|second opinion|service call|diagnostic)s?\b/gi,
    /\b(?:0%|no interest|interest[- ]free)\s+financing\b[^.!?|]{0,24}/gi,
    /\bfinancing available\b/gi,
  ];
  for (const re of pats) {
    for (const m of text.matchAll(re)) {
      const s = decode(m[0]).replace(/[\s,;:.-]+$/, '').trim();
      if (s.length >= 5 && s.length <= 70) out.add(s);
      if (out.size >= 6) return [...out];
    }
  }
  return [...out];
}

/**
 * Cities served. Two sources: a section headed "areas we serve" (whose links
 * and list items are almost always the city list), and a "proudly serving A, B
 * and C" sentence anywhere on the page.
 */
export function detectServiceAreas(html: string, text: string): string[] {
  const out = new Set<string>();
  const clean = (s: string) => decode(s).replace(/^[\s,•|·-]+|[\s,•|·-]+$/g, '').trim();
  const plausible = (s: string) =>
    s.length >= 3 && s.length <= 34 && /^[A-Z]/.test(s) && !/\d{3}/.test(s) &&
    s.split(/\s+/).length <= 4 && !GENERIC.has(s.toLowerCase()) && !/@|https?:/i.test(s);

  // A heading that announces the list, then everything up to the next heading.
  const head = /<(h[1-6])[^>]*>[^<]{0,60}?(?:areas?\s+we\s+serve|service\s+areas?|communities\s+we\s+serve|where\s+we\s+work|proudly\s+serving|cities\s+we\s+serve)[^<]{0,40}<\/\1>/i;
  const hm = html.match(head);
  if (hm && hm.index != null) {
    const block = html.slice(hm.index + hm[0].length).split(/<h[1-6][^>]*>/i)[0] ?? '';
    for (const m of block.matchAll(/<(?:a|li|span|p)[^>]*>([^<]{3,40})<\/(?:a|li|span|p)>/gi)) {
      const s = clean(m[1]!).replace(/,\s*[A-Z]{2}$/, (x) => x); // keep "City, ST" intact
      if (plausible(s.replace(/,\s*[A-Z]{2}$/, ''))) out.add(s);
      if (out.size >= 25) break;
    }
  }

  // "Proudly serving Philadelphia, Bala Cynwyd, Ardmore and the Main Line."
  const sentence = text.match(/\b(?:proudly\s+)?serving\s+((?:[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3}(?:,\s*[A-Z]{2})?)(?:\s*(?:,|and|&)\s*[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3}(?:,\s*[A-Z]{2})?){1,14})/);
  if (sentence && sentence[1]) {
    for (const part of sentence[1].split(/\s*(?:,|\band\b|&)\s*/)) {
      const s = clean(part);
      if (plausible(s) && !/^[A-Z]{2}$/.test(s)) out.add(s);
    }
  }
  return [...out].slice(0, 25);
}

/**
 * The colors the site is actually built from — CSS custom properties first
 * (that's where a theme puts its brand), then declared backgrounds. Neutrals
 * are dropped: every site is mostly white, grey and black, so those say nothing.
 */
export function detectBrandColors(html: string): string[] {
  const hits = new Map<string, number>();
  const add = (hex: string, weight: number) => {
    let h = hex.toLowerCase();
    if (h.length === 4) h = '#' + h[1]! + h[1]! + h[2]! + h[2]! + h[3]! + h[3]!;
    const r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16);
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max - min < 28) return;        // grey, white or black
    if (max < 24 || min > 232) return; // too dark or too washed out to be a brand color
    hits.set(h, (hits.get(h) ?? 0) + weight);
  };
  for (const m of html.matchAll(/--[a-z0-9-]*(?:primary|brand|accent|main|theme|secondary)[a-z0-9-]*\s*:\s*(#[0-9a-f]{3,8})\b/gi)) add(m[1]!, 12);
  for (const m of html.matchAll(/--[a-z0-9-]+\s*:\s*(#[0-9a-f]{6})\b/gi)) add(m[1]!, 4);
  for (const m of html.matchAll(/(?:background(?:-color)?|border-color|fill)\s*:\s*(#[0-9a-f]{3,8})\b/gi)) add(m[1]!, 2);
  for (const m of html.matchAll(/\bcolor\s*:\s*(#[0-9a-f]{3,8})\b/gi)) add(m[1]!, 1);
  return [...hits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([h]) => h);
}

/** Which ad platforms are already firing on this site — the tag is the proof. */
export function detectRunningAds(html: string): string | undefined {
  const google = /gtag\/js\?id=AW-|['"]AW-\d{6,}|googleadservices\.com|google_conversion_id/i.test(html);
  const meta = /connect\.facebook\.net[^"']*fbevents|fbq\s*\(\s*['"]init/i.test(html);
  if (google && meta) return 'Both';
  if (google) return 'Google Ads';
  if (meta) return 'Meta (FB/IG)';
  return undefined;
}

/** Pure extractor — pull structured fields out of one page's HTML. Testable. */
export function parseSiteHtml(html: string, baseUrl: string, now = new Date()): Partial<SiteImport> {
  const out: Partial<SiteImport> = {};
  const pick = (re: RegExp): string | undefined => { const m = html.match(re); return m && m[1] ? decode(m[1]) : undefined; };
  const attr = (name: string): string | undefined =>
    pick(new RegExp('<meta[^>]+(?:property|name)=["\']' + name + '["\'][^>]+content=["\']([^"\']+)["\']', 'i')) ||
    pick(new RegExp('<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\']' + name + '["\']', 'i'));

  const text = visibleText(html);
  const headings: string[] = [];
  for (const m of html.matchAll(/<h[1-3][^>]*>([\s\S]{0,120}?)<\/h[1-3]>/gi)) headings.push(decode(m[1]!.replace(/<[^>]+>/g, ' ')));
  const title = pick(/<title[^>]*>([^<]+)<\/title>/i);
  const strong = [title ?? '', attr('og:title') ?? '', attr('keywords') ?? '', ...headings].join(' . ');

  out.businessName = attr('og:site_name') || (title ? decode(title.split(/[|\-–—•·]/)[0]!) : undefined);
  const ogTitle = attr('og:title');
  if (ogTitle && ogTitle !== out.businessName) out.tagline = ogTitle;

  // Meta description when it's substantial; otherwise the first real paragraph,
  // which on a contractor site is usually the hero pitch.
  const meta = attr('description') || attr('og:description');
  out.description = meta && meta.length >= 60 ? meta : undefined;
  if (!out.description) {
    for (const m of html.matchAll(/<p[^>]*>([\s\S]{60,600}?)<\/p>/gi)) {
      const p = decode(m[1]!.replace(/<[^>]+>/g, ' '));
      if (p.length >= 60 && p.length <= 400 && !/cookie|privacy policy|all rights reserved|©/i.test(p)) { out.description = p; break; }
    }
  }
  if (!out.description && meta) out.description = meta;

  out.brandColor = attr('theme-color');
  const colors = detectBrandColors(html);
  if (colors.length) out.brandColors = colors.join(', ');

  const industry = detectIndustry(text, strong);
  if (industry) out.industry = industry;
  const year = detectYearFounded(text, now.getFullYear());
  if (year) out.yearStarted = year;
  const staff = detectEmployees(text);
  if (staff) out.employees = staff;

  const offers = detectOffers(text);
  if (offers.length) out.currentOffers = offers.join(', ');
  const areas = detectServiceAreas(html, text);
  if (areas.length) out.serviceAreas = areas.join(', ');

  for (const p of PLATFORMS) if (p.re.test(html)) { out.websitePlatform = p.label; break; }
  const ads = detectRunningAds(html);
  if (ads) out.runningAds = ads;
  for (const t of EMAIL_TOOLS) if (t.re.test(html)) { out.emailTool = t.label; break; }
  // A newsletter form is direct evidence they collect emails; its absence proves nothing.
  if (/<input[^>]+type=["']email["'][\s\S]{0,600}?(?:subscribe|newsletter|join our|sign ?up|mailing list)/i.test(html)
    || /(?:subscribe|newsletter|join our|mailing list)[\s\S]{0,600}?<input[^>]+type=["']email["']/i.test(html)
    || out.emailTool) out.collectsEmails = 'Yes';

  // Contact: prefer explicit tel:/mailto: links, then loose patterns.
  const tel = pick(/href=["']tel:([+\d][\d\s().\-]{6,}\d)["']/i) || pick(/(\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4})/);
  if (tel) out.phone = decode(tel).replace(/\s+/g, ' ');
  const mail = pick(/href=["']mailto:([^"'?]+@[^"'?]+)["']/i) || pick(/\b([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})\b/);
  if (mail && !/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(mail) && !/(sentry|wixpress|example)\./i.test(mail)) out.email = mail.toLowerCase();

  // Socials — first real profile link per network, skipping share buttons,
  // tracking pixels, embeds and the networks' own developer/help pages.
  const social = (re: RegExp): string | undefined => {
    for (const m of html.matchAll(/https?:\/\/[^"'\s<>()]+/gi)) {
      const href = m[0].replace(/[.,)]+$/, '');
      if (!re.test(href)) continue;
      if (/\/(sharer|share|intent|plugins|dialog|embed|tr\?|watch\?|developers|business\/help|policies)/i.test(href)) continue;
      if (/\/(?:tr|v\d+\.\d+|xd_arbiter)\b/i.test(href)) continue;
      const path = href.replace(/^https?:\/\/[^/]+/, '').replace(/^\/+|\/+$/g, '');
      if (!path) continue; // a bare domain link is a badge, not a profile
      return href;
    }
    return undefined;
  };
  out.facebook = social(/facebook\.com\//i);
  out.instagram = social(/instagram\.com\//i);
  out.linkedin = social(/linkedin\.com\/(?:company|in)\//i);
  out.twitter = social(/(?:twitter|x)\.com\//i);
  out.youtube = social(/(?:youtube\.com\/(?:@|c\/|channel\/|user\/)|youtu\.be\/)/i);
  out.tiktok = social(/tiktok\.com\/@/i);

  // Address via loose "City, ST 12345" pattern.
  const addr = html.match(/([A-Z][A-Za-z.\-]+(?:\s+[A-Z][A-Za-z.\-]+)*),\s*([A-Z]{2})\s+(\d{5})(?:-\d{4})?/);
  if (addr) { out.city = decode(addr[1]!); out.state = addr[2]; out.zip = addr[3]; }
  const street = text.match(/\b(\d{1,6}\s+[A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,3}\s+(?:Street|Avenue|Boulevard|Highway|Terrace|Parkway|Court|Drive|Place|Road|Lane|Pike|Blvd|Hwy|Pkwy|Ave|Rd|Ln|Ct|Pl|Ter|Dr|St|Way)\.?)(?:\s*(?:#|Ste\.?|Suite|Unit)\s*[\w-]+)?/);
  if (street && street[1]) out.address = decode(street[0]);

  // JSON-LD — the richest source when present (LocalBusiness / Organization).
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { collectLd(JSON.parse(m[1]!), out); } catch { /* skip bad json */ }
  }

  // Services — headings, service-page links, and JSON-LD offer catalogs, minus boilerplate.
  const cand = new Set<string>();
  for (const m of html.matchAll(/<(?:h2|h3)[^>]*>([^<]{3,50})<\/(?:h2|h3)>/gi)) cand.add(decode(m[1]!));
  for (const m of html.matchAll(/<a[^>]+href=["'][^"']*(?:service|repair|install|cleaning|treatment|painting|remodel)[^"']*["'][^>]*>([^<]{3,40})<\/a>/gi)) cand.add(decode(m[1]!));
  const services = [...cand, ...(out.services ? out.services.split(', ') : [])]
    .map((s) => s.trim().replace(/\s*[»›>→]+\s*$/, ''))
    .filter((s) => s && s.split(/\s+/).length <= 6 && !GENERIC.has(s.toLowerCase())
      && !/^\W|©|read more|learn more|click here|http|\?$|!$|^\d+$/i.test(s))
    .slice(0, 14);
  out.services = services.length ? [...new Set(services)].join(', ') : undefined;

  // Logo.
  let logo = attr('og:image')
    || pick(/<link[^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]+href=["']([^"']+)["']/i)
    || pick(/<img[^>]+(?:class|alt|id)=["'][^"']*logo[^"']*["'][^>]+src=["']([^"']+)["']/i)
    || pick(/<img[^>]+src=["']([^"']+)["'][^>]+(?:class|alt|id)=["'][^"']*logo/i)
    || pick(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]+href=["']([^"']+)["']/i);
  try { if (logo) out.logo = new URL(logo, baseUrl).href; } catch { /* ignore */ }

  for (const k of Object.keys(out) as (keyof SiteImport)[]) if (out[k] == null) delete out[k];
  return out;
}

/** Walk a JSON-LD node (handles arrays and @graph) filling business fields. */
function collectLd(node: unknown, out: Partial<SiteImport>): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) collectLd(n, out); return; }
  const o = node as Record<string, any>;
  if (o['@graph']) collectLd(o['@graph'], out);
  const type = String(o['@type'] || '').toLowerCase();
  if (/business|organization|store|professionalservice|localbusiness|contractor|dentist|hvac|plumber|roofing|electrician/.test(type) || o.telephone || o.address) {
    if (!out.businessName && typeof o.name === 'string') out.businessName = decode(o.name);
    if (!out.description && typeof o.description === 'string' && o.description.length >= 40) out.description = decode(o.description);
    if (!out.tagline && typeof o.slogan === 'string') out.tagline = decode(o.slogan);
    if (!out.phone && o.telephone) out.phone = String(o.telephone);
    if (!out.email && typeof o.email === 'string') out.email = o.email.replace(/^mailto:/i, '').toLowerCase();
    if (!out.website && typeof o.url === 'string' && /^https?:/i.test(o.url)) out.website = o.url;
    if (!out.yearStarted && o.foundingDate) {
      const y = Number(String(o.foundingDate).slice(0, 4));
      if (y >= 1850 && y <= new Date().getFullYear()) out.yearStarted = y;
    }
    if (!out.employees && o.numberOfEmployees) {
      const v = o.numberOfEmployees;
      const n = Number(typeof v === 'object' ? (v.value ?? v.minValue) : v);
      if (Number.isFinite(n) && n >= 1 && n <= 5000) out.employees = n;
    }
    const a = o.address && typeof o.address === 'object' ? (Array.isArray(o.address) ? o.address[0] : o.address) : null;
    if (a) {
      if (!out.address && a.streetAddress) out.address = decode(String(a.streetAddress));
      if (!out.city && a.addressLocality) out.city = decode(String(a.addressLocality));
      if (!out.state && a.addressRegion) out.state = String(a.addressRegion);
      if (!out.zip && a.postalCode) out.zip = String(a.postalCode);
    }
    // areaServed and hasOfferCatalog are how a well-marked-up site states its
    // coverage and its service list outright — far better than our scraping.
    const areas = ldNames(o.areaServed);
    if (areas.length) out.serviceAreas = joinUnique(out.serviceAreas, areas, 25);
    const offered = [
      ...ldNames(o.makesOffer),
      ...(o.hasOfferCatalog ? ldNames(o.hasOfferCatalog).concat(ldCatalog(o.hasOfferCatalog)) : []),
    ];
    if (offered.length) out.services = joinUnique(out.services, offered, 14);
    for (const s of ([] as string[]).concat(o.sameAs || [])) {
      if (typeof s !== 'string') continue;
      if (/facebook\.com/i.test(s) && !out.facebook) out.facebook = s;
      else if (/instagram\.com/i.test(s) && !out.instagram) out.instagram = s;
      else if (/linkedin\.com/i.test(s) && !out.linkedin) out.linkedin = s;
      else if (/(twitter|x)\.com/i.test(s) && !out.twitter) out.twitter = s;
      else if (/(youtube\.com|youtu\.be)/i.test(s) && !out.youtube) out.youtube = s;
      else if (/tiktok\.com/i.test(s) && !out.tiktok) out.tiktok = s;
    }
  }
}

/** Names out of a JSON-LD value that may be a string, an object, or a list of either. */
function ldNames(v: unknown): string[] {
  const out: string[] = [];
  for (const x of ([] as unknown[]).concat(v ?? [])) {
    if (typeof x === 'string') out.push(decode(x));
    else if (x && typeof x === 'object') {
      const o = x as Record<string, any>;
      const n = o.name ?? o.itemOffered?.name;
      if (typeof n === 'string') out.push(decode(n));
    }
  }
  return out.filter((s) => s.length >= 3 && s.length <= 60);
}

/** OfferCatalog nests its real list one level down in itemListElement. */
function ldCatalog(v: unknown): string[] {
  const out: string[] = [];
  for (const x of ([] as unknown[]).concat(v ?? [])) {
    if (x && typeof x === 'object') out.push(...ldNames((x as Record<string, any>).itemListElement));
  }
  return out;
}

function joinUnique(existing: string | undefined, add: string[], cap: number): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of [...(existing ? existing.split(', ') : []), ...add]) {
    const v = s.trim();
    const k = v.toLowerCase();
    if (!v || seen.has(k) || GENERIC.has(k)) continue;
    seen.add(k); out.push(v);
    if (out.length >= cap) break;
  }
  return out.join(', ');
}

/** Combine per-page results: first page wins on facts, all pages contribute to lists. */
export function mergeFacts(parts: Partial<SiteImport>[]): Partial<SiteImport> {
  const merged: Partial<SiteImport> = {};
  for (const p of parts) {
    for (const [k, v] of Object.entries(p)) {
      if (v == null || v === '') continue;
      if ((UNION_FIELDS as readonly string[]).includes(k)) {
        const cap = k === 'services' ? 14 : k === 'serviceAreas' ? 25 : 6;
        (merged as any)[k] = joinUnique((merged as any)[k], String(v).split(', '), cap);
      } else if (!(merged as any)[k]) (merged as any)[k] = v;
    }
  }
  return merged;
}

/** The search terms this business should be buying — its services, in its city. */
export function buildKeywords(d: Partial<SiteImport>): string | undefined {
  const city = d.city || (d.serviceAreas ? d.serviceAreas.split(',')[0]!.trim().replace(/,\s*[A-Z]{2}$/, '') : '');
  const seeds = (d.services ? d.services.split(', ') : []).slice(0, 5);
  if (!seeds.length && d.industry) seeds.push(d.industry);
  if (!seeds.length) return undefined;
  const out = seeds.map((s) => (city ? `${s.toLowerCase()} ${city.toLowerCase()}` : s.toLowerCase()));
  if (city && d.industry) out.unshift(`${d.industry.toLowerCase()} ${city.toLowerCase()}`);
  return [...new Set(out)].slice(0, 8).join(', ');
}

/**
 * A plain browser identity. Contractor sites sit behind Cloudflare and similar
 * WAFs that 403 anything self-identifying as a bot, which used to cost us the
 * whole import on sites that were perfectly readable.
 */
const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
} as const;

const PAGE_TIMEOUT_MS = 9_000;
const MAX_PAGES = 7;
const MAX_HTML = 800_000;
const MAX_REDIRECTS = 4;

/** Address ranges that are never a customer's website — loopback, private, link-local, metadata. */
function isPrivateAddress(ip: string): boolean {
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  const parts = v4.split('.');
  if (parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p))) {
    const [a, b] = [Number(parts[0]), Number(parts[1])];
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
  }
  const s = ip.toLowerCase();
  return s === '::' || s === '::1' || /^f[cd]/.test(s) || /^fe[89ab]/.test(s);
}

/**
 * Resolve the host and refuse anything that isn't a public address. Without
 * this, "import my website" is a request the server will make to any address a
 * customer names — including the cloud metadata endpoint and our own internals.
 */
async function isPublicUrl(u: URL): Promise<boolean> {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(host)) return false;
  if (/^[\d.]+$/.test(host) || host.includes(':')) return !isPrivateAddress(host);
  try {
    const { lookup } = await import('node:dns/promises');
    const addrs = await lookup(host, { all: true });
    return addrs.length > 0 && addrs.every((a) => !isPrivateAddress(a.address));
  } catch { return false; }
}

/**
 * Fetch one page, checking every redirect hop rather than trusting the first —
 * a public hostname that 302s to 127.0.0.1 would otherwise walk straight past
 * the check above.
 */
async function fetchPage(url: string): Promise<{ html: string; finalUrl: string; status: number } | null> {
  let current = url;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      let u: URL;
      try { u = new URL(current); } catch { return null; }
      if (!(await isPublicUrl(u))) return null;
      const res = await fetch(u.href, { redirect: 'manual', headers: HEADERS, signal: AbortSignal.timeout(PAGE_TIMEOUT_MS) });
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) {
        try { current = new URL(loc, u.href).href; continue; } catch { return null; }
      }
      if (!res.ok) return { html: '', finalUrl: u.href, status: res.status };
      const type = res.headers.get('content-type') ?? '';
      if (type && !/html|xml|text/i.test(type)) return null;
      return { html: (await res.text()).slice(0, MAX_HTML), finalUrl: u.href, status: res.status };
    }
    return null;
  } catch { return null; }
}

/** The internal pages that carry facts the home page leaves out, best first. */
const PAGE_HINTS: { key: string; re: RegExp }[] = [
  { key: 'contact', re: /contact|get-?in-?touch/i },
  { key: 'about', re: /about|our-?story|who-?we-?are|meet-?the-?team|our-?team|history/i },
  { key: 'services', re: /services?|what-?we-?do|our-?work/i },
  { key: 'areas', re: /areas?-?we-?serve|service-?areas?|locations?|cities|coverage|neighborhoods/i },
  { key: 'offers', re: /specials?|offers?|coupons?|promotions?|deals|financing|pricing/i },
];

/** Pick the best same-origin page per hint — shortest path wins, so /about beats /about/team/bob. */
export function chooseLinks(html: string, base: URL, cap = MAX_PAGES - 1): string[] {
  const best = new Map<string, { href: string; depth: number }>();
  for (const m of html.matchAll(/<a[^>]+href=["']([^"'\s]+)["']/gi)) {
    let u: URL;
    try { u = new URL(m[1]!, base.href); } catch { continue; }
    if (u.origin !== base.origin) continue;
    if (!/^https?:$/.test(u.protocol)) continue;
    if (/\.(pdf|jpg|jpeg|png|gif|svg|webp|zip|mp4|xml|css|js)$/i.test(u.pathname)) continue;
    u.hash = '';
    const path = u.pathname.replace(/\/+$/, '');
    if (!path || path === '/') continue;
    const depth = path.split('/').filter(Boolean).length;
    for (const h of PAGE_HINTS) {
      if (!h.re.test(path)) continue;
      const cur = best.get(h.key);
      if (!cur || depth < cur.depth) best.set(h.key, { href: u.href, depth });
      break; // one hint per link, in PAGE_HINTS order
    }
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const h of PAGE_HINTS) {
    const v = best.get(h.key);
    if (v && !seen.has(v.href)) { seen.add(v.href); out.push(v.href); }
  }
  return out.slice(0, cap);
}

/** Crawl home plus the key internal pages and merge what's found. */
export async function importSite(input: string): Promise<SiteImport | null> {
  let url = (input || '').trim().replace(/^["'<]+|["'>]+$/g, '');
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  // A bare domain that only answers on www is common enough to be worth one retry.
  let home = await fetchPage(url);
  if ((!home || !home.html) && !/\/\/www\./i.test(url)) {
    const alt = await fetchPage(url.replace(/^(https?:\/\/)/i, '$1www.'));
    if (alt?.html) home = alt;
  }
  if (!home) return null;
  if (!home.html) return { website: url, foundFields: 0, pagesRead: 0, blocked: home.status === 403 || home.status === 401 };

  const base = new URL(home.finalUrl);
  const homeFacts = parseSiteHtml(home.html, base.href);

  // All the internal pages at once — a slow one no longer delays the rest.
  const links = chooseLinks(home.html, base);
  const pages = await Promise.all(links.map((h) => fetchPage(h)));
  const rest = pages.filter((p): p is NonNullable<typeof p> => !!p?.html).map((p) => parseSiteHtml(p.html, p.finalUrl));

  const merged: SiteImport = { ...mergeFacts([homeFacts, ...rest]), website: base.origin };
  const kw = buildKeywords(merged);
  if (kw) merged.targetKeywords = kw;
  // A city named in the address is always also a service area.
  if (merged.city) merged.serviceAreas = joinUnique(merged.serviceAreas, [merged.city], 25);

  merged.pagesRead = 1 + rest.length;
  merged.filled = Object.entries(merged)
    .filter(([k, v]) => !['website', 'foundFields', 'filled', 'pagesRead', 'blocked', 'brandColor', 'tagline', 'logo'].includes(k) && v !== '' && v != null)
    .map(([k]) => k);
  merged.foundFields = merged.filled.length;
  if (merged.foundFields === 0) return null;
  return merged;
}
