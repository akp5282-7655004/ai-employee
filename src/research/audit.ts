/**
 * Website audit — crawl a local-service business's site and score it on the things
 * that actually win them jobs: is it trustworthy (SSL), can a customer find the
 * phone and call in one tap, is there a clear next step, does Google (and now
 * ChatGPT) understand what the business is and where it works.
 *
 * The checks here are DETERMINISTIC and pulled straight from the page HTML — the
 * score is a real measurement, not an LLM guess. The plain-English "fix this first"
 * narrative is layered on in server.ts; this module is the pure, testable core.
 */
export type AuditStatus = 'good' | 'warn' | 'bad';
export type AuditArea = 'Trust' | 'SEO' | 'Conversion' | 'Mobile' | 'Local' | 'AI Search' | 'Content';

export interface AuditFinding {
  id: string;
  area: AuditArea;
  label: string;
  status: AuditStatus;
  /** What we actually saw on the page. */
  found: string;
  /** The concrete action to take. */
  fix: string;
  /** How much this matters (relative weight in the score). */
  weight: number;
}

export interface AuditResult {
  url: string;
  finalUrl: string;
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  findings: AuditFinding[];
  stats: { words: number; images: number; imagesWithAlt: number };
  pagesCrawled: number;
}

const count = (re: RegExp, s: string): number => (s.match(re) || []).length;
const has = (re: RegExp, s: string): boolean => re.test(s);

/**
 * Run every deterministic check against one page's HTML. Pure and testable —
 * give it the raw HTML and the final (post-redirect) URL, get back scored findings.
 */
export function runAuditChecks(html: string, finalUrl: string): AuditFinding[] {
  const https = /^https:\/\//i.test(finalUrl);
  const head = html.slice(0, 200_000);
  // Strip tags for a rough visible-word count.
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
  const words = (text.match(/\b[a-z]{3,}\b/gi) || []).length;

  const title = (head.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || '').trim();
  const metaDesc = (head.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1]
    || head.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i)?.[1] || '').trim();
  const h1s = count(/<h1[\s>]/gi, html);
  const telLink = has(/href=["']tel:[+\d][\d\s().\-]{5,}/i, html);
  const phoneText = has(/\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}/, text);
  const viewport = has(/<meta[^>]+name=["']viewport["']/i, head);
  const cta = has(/\b(book|schedule|get a? ?(free )?(quote|estimate)|call now|contact us|request|get started|free consultation)\b/i, text);
  const imgs = count(/<img\b/gi, html);
  const imgsAlt = count(/<img\b[^>]*\balt=["'][^"']*[^"'\s][^"']*["']/gi, html);
  const jsonLd = has(/application\/ld\+json/i, html);
  const localBiz = has(/"@type"\s*:\s*"[^"]*(?:LocalBusiness|Plumber|Electrician|Roofing|HVAC|HomeAndConstruction|ProfessionalService|Contractor|Dentist)/i, html);
  const ogImage = has(/<meta[^>]+property=["']og:image["']/i, head);
  const cityState = has(/[A-Z][A-Za-z.\-]+,\s*[A-Z]{2}\b/, text) || has(/\b\d{5}(?:-\d{4})?\b/, text);
  const analytics = has(/googletagmanager|gtag\(|google-analytics|fbevents|clarity\.ms|hotjar/i, html);
  const favicon = has(/<link[^>]+rel=["'][^"']*icon/i, head);
  const reviews = has(/\b(review|testimonial|\d(?:\.\d)?\s*star|rated|google reviews|yelp)\b/i, text);

  const f: AuditFinding[] = [];
  const add = (id: string, area: AuditArea, weight: number, ok: boolean | 'warn', label: string, found: string, fix: string) =>
    f.push({ id, area, weight, status: ok === true ? 'good' : ok === 'warn' ? 'warn' : 'bad', label, found, fix });

  add('ssl', 'Trust', 8, https, 'Secure (HTTPS)',
    https ? 'Your site loads over a secure https connection.' : 'Your site is not served over https.',
    https ? 'No action needed.' : 'Enable SSL/HTTPS — browsers show "Not secure" without it and Google ranks you lower.');

  add('title', 'SEO', 7, title ? (title.length >= 10 && title.length <= 65 ? true : 'warn') : false, 'Page title',
    title ? `"${title}" (${title.length} chars)` : 'No <title> tag found.',
    !title ? 'Add a page title with your service + city, e.g. "AC Repair in Phoenix | Rivera Plumbing".'
      : title.length > 65 ? 'Shorten your title to ~60 characters so Google doesn’t cut it off.'
      : 'Lengthen your title and include your main service + city.');

  add('metadesc', 'SEO', 5, metaDesc ? (metaDesc.length >= 50 && metaDesc.length <= 165 ? true : 'warn') : false, 'Meta description',
    metaDesc ? `"${metaDesc.slice(0, 90)}${metaDesc.length > 90 ? '…' : ''}" (${metaDesc.length} chars)` : 'No meta description found.',
    !metaDesc ? 'Add a 1-sentence meta description with your service, city, and a reason to call.'
      : 'Aim for 50–160 characters so it shows fully in search results.');

  add('h1', 'SEO', 5, h1s === 1 ? true : h1s === 0 ? false : 'warn', 'Main heading (H1)',
    h1s === 0 ? 'No H1 heading found.' : h1s === 1 ? 'One clear H1 heading.' : `${h1s} H1 headings (should be one).`,
    h1s === 1 ? 'No action needed.' : 'Use exactly one H1 that states what you do and where.');

  add('phone', 'Conversion', 9, telLink ? true : phoneText ? 'warn' : false, 'Phone number visible',
    telLink ? 'A tap-to-call phone link is present.' : phoneText ? 'A phone number appears as text (not a tap-to-call link).' : 'No phone number found on the page.',
    telLink ? 'No action needed.' : phoneText ? 'Wrap your phone number in a tap-to-call link (tel:) so mobile users call in one tap.'
      : 'Add your phone number — prominently, as a tap-to-call link. For local services, the phone is the #1 conversion.');

  add('cta', 'Conversion', 7, cta, 'Clear call-to-action',
    cta ? 'A clear next step (book/quote/call/contact) is present.' : 'No obvious call-to-action found.',
    cta ? 'No action needed.' : 'Add a prominent button: "Get a Free Quote", "Book Now", or "Call Today".');

  add('viewport', 'Mobile', 6, viewport, 'Mobile-friendly',
    viewport ? 'A mobile viewport tag is set.' : 'No mobile viewport tag — the site may not scale on phones.',
    viewport ? 'No action needed.' : 'Add a responsive viewport meta tag. Most local searches happen on phones.');

  add('alt', 'SEO', 3, imgs === 0 ? 'warn' : imgsAlt / imgs >= 0.7 ? true : 'warn', 'Image alt text',
    imgs === 0 ? 'No images found.' : `${imgsAlt} of ${imgs} images have alt text.`,
    imgs && imgsAlt / imgs >= 0.7 ? 'No action needed.' : 'Add descriptive alt text to images — helps SEO and accessibility.');

  add('schema', 'AI Search', 6, localBiz ? true : jsonLd ? 'warn' : false, 'Business structured data',
    localBiz ? 'LocalBusiness structured data found.' : jsonLd ? 'Some structured data, but no LocalBusiness type.' : 'No structured data (schema) found.',
    localBiz ? 'No action needed.' : 'Add LocalBusiness JSON-LD (name, phone, address, hours, services). This is how Google and AI assistants like ChatGPT understand and recommend you.');

  add('local', 'Local', 6, cityState, 'Location signals',
    cityState ? 'City/state or ZIP appears on the page.' : 'No clear city, state, or ZIP on the page.',
    cityState ? 'No action needed.' : 'Put your city and service area in your text and footer so you rank for "near me" searches.');

  add('og', 'SEO', 2, ogImage, 'Social sharing preview',
    ogImage ? 'An Open Graph image is set for shared links.' : 'No Open Graph image — shared links look bare.',
    ogImage ? 'No action needed.' : 'Add an og:image so your link shows a photo when shared on Facebook/text.');

  add('reviews', 'Trust', 4, reviews, 'Social proof / reviews',
    reviews ? 'Reviews or testimonials are referenced.' : 'No reviews or testimonials found on the page.',
    reviews ? 'No action needed.' : 'Show your star rating and a few real reviews — trust is what converts local buyers.');

  add('analytics', 'Conversion', 2, analytics, 'Tracking installed',
    analytics ? 'Analytics/tracking is installed.' : 'No analytics or tracking pixel detected.',
    analytics ? 'No action needed.' : 'Install Google Analytics (and an ad pixel) so you can measure what’s working.');

  add('favicon', 'Trust', 1, favicon, 'Favicon',
    favicon ? 'A favicon is set.' : 'No favicon (the little tab icon).',
    favicon ? 'No action needed.' : 'Add a favicon so your tab looks professional.');

  add('content', 'Content', 3, words >= 300 ? true : words >= 120 ? 'warn' : false, 'Content depth',
    `About ${words} words on the homepage.`,
    words >= 300 ? 'No action needed.' : 'Add more helpful content — what you do, your service area, and answers to common questions.');

  return f;
}

/** Weighted 0–100 score: good = full weight, warn = half, bad = 0. */
export function scoreFindings(findings: AuditFinding[]): number {
  const total = findings.reduce((s, x) => s + x.weight, 0);
  if (!total) return 0;
  const earned = findings.reduce((s, x) => s + x.weight * (x.status === 'good' ? 1 : x.status === 'warn' ? 0.5 : 0), 0);
  return Math.round((earned / total) * 100);
}

export function gradeFor(score: number): AuditResult['grade'] {
  return score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';
}

async function fetchPage(url: string): Promise<{ html: string; finalUrl: string } | null> {
  try {
    const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (compatible; MilesBot/1.0)' } });
    if (!res.ok) return null;
    return { html: (await res.text()).slice(0, 500_000), finalUrl: res.url || url };
  } catch {
    return null;
  }
}

/** Fetch a site's homepage and produce a full scored audit. Returns null if unreachable. */
export async function auditSite(input: string): Promise<AuditResult | null> {
  let url = (input || '').trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  const home = await fetchPage(url);
  if (!home) return null;

  const html = home.html;
  const findings = runAuditChecks(html, home.finalUrl);
  const score = scoreFindings(findings);
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
  const words = (text.match(/\b[a-z]{3,}\b/gi) || []).length;
  const images = count(/<img\b/gi, html);
  const imagesWithAlt = count(/<img\b[^>]*\balt=["'][^"']*[^"'\s][^"']*["']/gi, html);

  // Sort worst-first so the report leads with what to fix.
  const order: Record<AuditStatus, number> = { bad: 0, warn: 1, good: 2 };
  findings.sort((a, b) => order[a.status] - order[b.status] || b.weight - a.weight);

  return {
    url,
    finalUrl: home.finalUrl,
    score,
    grade: gradeFor(score),
    findings,
    stats: { words, images, imagesWithAlt },
    pagesCrawled: 1,
  };
}

/** Deterministic fix summary when no LLM key is set (demo-safe). */
export function fallbackAuditSummary(result: AuditResult): string {
  const problems = result.findings.filter((x) => x.status !== 'good');
  if (!problems.length) return `Great news — your site passed every check with a score of ${result.score}/100 (${result.grade}). Keep your content and reviews fresh.`;
  const lines = [`Your site scored ${result.score}/100 (grade ${result.grade}). Here’s what to fix first:`, ''];
  problems.slice(0, 6).forEach((p, i) => lines.push(`${i + 1}. ${p.label}: ${p.fix}`));
  lines.push('', '(Add an OpenRouter key and Miles writes a tailored action plan with these findings.)');
  return lines.join('\n');
}

/** Prompt for the LLM to turn findings into a prioritized, plain-English plan. */
export function buildAuditPrompt(result: AuditResult, business?: string): { system: string; user: string } {
  const list = result.findings
    .map((x) => `- [${x.status.toUpperCase()}] ${x.label} (${x.area}): ${x.found} → Fix: ${x.fix}`)
    .join('\n');
  const system =
    'You are a web strategist advising a local-service business owner (a tradesperson, not a marketer). You are given a deterministic audit of their website. Write a short, encouraging, plain-English action plan: open with the score in one line, then "Fix these first" (the 3 highest-impact issues, each one sentence on what and why it wins jobs), then "Nice-to-haves" (2-3 smaller items). No jargon, no preamble. Base everything ONLY on the findings given.';
  const user = `${business ? `Business: ${business}.\n` : ''}Website: ${result.finalUrl}\nScore: ${result.score}/100 (grade ${result.grade}).\nFindings:\n${list}`;
  return { system, user };
}
