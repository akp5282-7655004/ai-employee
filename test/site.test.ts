import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildKeywords, chooseLinks, detectBrandColors, detectEmployees, detectIndustry, detectOffers,
  detectRunningAds, detectServiceAreas, detectYearFounded, importSite, mergeFacts, parseSiteHtml, visibleText,
} from '../src/research/site.js';

const HTML = `<!doctype html><html><head>
<title>Rivera Plumbing &amp; AC | Phoenix's Trusted Plumbers</title>
<meta property="og:site_name" content="Rivera Plumbing & AC">
<meta name="description" content="Fast, honest plumbing and AC repair in Phoenix.">
<meta name="theme-color" content="#0c5aa6">
<meta property="og:image" content="/img/logo.png">
<script type="application/ld+json">{"@type":"LocalBusiness","name":"Rivera Plumbing & AC","telephone":"(602) 555-0142","email":"mailto:hi@riveraplumbing.com","address":{"streetAddress":"123 Main St","addressLocality":"Phoenix","addressRegion":"AZ","postalCode":"85001"},"sameAs":["https://facebook.com/riveraplumbing","https://instagram.com/riveraplumbing"]}</script>
</head><body>
<a href="https://facebook.com/sharer/sharer.php?u=x">share</a>
<h2>Drain Cleaning</h2><h2>Water Heater Repair</h2><h3>AC Tune-Up</h3><h2>About Us</h2>
<a href="tel:+16025550142">Call</a>
</body></html>`;

describe('parseSiteHtml', () => {
  const r = parseSiteHtml(HTML, 'https://riveraplumbing.com/');
  it('pulls the business name and description', () => {
    expect(r.businessName).toBe('Rivera Plumbing & AC');
    expect(r.description).toContain('plumbing and AC repair');
  });
  it('reads phone, email and address from JSON-LD', () => {
    expect(r.phone).toContain('602');
    expect(r.email).toBe('hi@riveraplumbing.com');
    expect(r.city).toBe('Phoenix');
    expect(r.state).toBe('AZ');
    expect(r.zip).toBe('85001');
  });
  it('captures real social profiles but skips share buttons', () => {
    expect(r.facebook).toBe('https://facebook.com/riveraplumbing');
    expect(r.instagram).toBe('https://instagram.com/riveraplumbing');
  });
  it('extracts services from headings, dropping boilerplate like "About Us"', () => {
    expect(r.services).toContain('Drain Cleaning');
    expect(r.services).toContain('Water Heater Repair');
    expect(r.services).not.toContain('About Us');
  });
  it('resolves a relative logo to an absolute URL and reads the brand color', () => {
    expect(r.logo).toBe('https://riveraplumbing.com/img/logo.png');
    expect(r.brandColor).toBe('#0c5aa6');
  });
});

/**
 * A painting contractor's home page, written the way these sites actually are:
 * no JSON-LD business block, facts scattered through the prose, and the useful
 * signals sitting in third-party embed code rather than in markup.
 */
const PAINTER = `<!doctype html><html><head>
<title>Painters In Philly | Philadelphia's #1 House Painters</title>
<meta name="generator" content="WordPress 6.5">
<link rel="stylesheet" href="/wp-content/themes/x/style.css">
<style>:root{--brand-primary:#1f4e79;--accent-color:#f2a20c;--text:#333333;--bg:#ffffff}</style>
<script async src="https://www.googletagmanager.com/gtag/js?id=AW-987654321"></script>
<script>!function(f,b){f.fbq=b}(window);fbq('init','123456789');</script>
<script src="https://chimpstatic.com/mcjs-connected/js/users/abc.js"></script>
</head><body>
<h1>Interior &amp; Exterior Painting in Philadelphia</h1>
<p>Painters In Philly has been a family-owned house painting company serving Philadelphia since 1998.
Our team of 14 painters handles interior painting, exterior painting and cabinet refinishing for
homeowners across the city, and every project comes with a written warranty.</p>
<h2>Interior Painting</h2><h2>Exterior Painting</h2><h2>Cabinet Refinishing</h2>
<h2>Deck Staining</h2><h2>Why Choose Us</h2><h2>Free Estimate</h2>
<p>Ask about our spring special: $250 off any exterior painting job, plus free estimates and
0% financing for 12 months.</p>
<h3>Areas We Serve</h3>
<ul><li>Philadelphia</li><li>Bala Cynwyd</li><li>Ardmore</li><li>Chestnut Hill</li><li>Manayunk</li></ul>
<h3>Newsletter</h3>
<form><input type="email" name="EMAIL"><button>Subscribe</button></form>
<a href="/about-us/">About</a><a href="/about-us/our-team/history/">History</a>
<a href="/services/interior-painting/">Interior</a><a href="/services/">All services</a>
<a href="/contact/">Contact</a><a href="/specials/">Specials</a>
<a href="/blog/2019/best-paint">Blog</a><a href="https://yelp.com/biz/x">Yelp</a>
<a href="https://www.facebook.com/paintersinphilly">Facebook</a>
<a href="https://www.instagram.com/paintersinphilly/">Instagram</a>
<footer><p>1234 Ridge Avenue, Philadelphia, PA 19123 &middot; <a href="tel:2673923939">(267) 392-3939</a>
&middot; <a href="mailto:paul@paintersinphilly.com">Email us</a></p>
<p>&copy; 2026 Painters In Philly. All rights reserved.</p></footer>
</body></html>`;

describe('a real-world contractor page with no JSON-LD', () => {
  const r = parseSiteHtml(PAINTER, 'https://paintersinphilly.com/', new Date('2026-08-18T00:00:00Z'));

  it('identifies the trade from the page instead of leaving it blank', () => {
    expect(r.industry).toBe('Painting');
  });
  it('reads the founding year from prose, not from the copyright line', () => {
    expect(r.yearStarted).toBe(1998);
  });
  it('reads team size from a sentence that states one', () => {
    expect(r.employees).toBe(14);
  });
  it('collects the service-area list under its heading', () => {
    expect(r.serviceAreas).toContain('Bala Cynwyd');
    expect(r.serviceAreas).toContain('Manayunk');
  });
  it('picks up the promotions', () => {
    expect(r.currentOffers).toMatch(/\$250 off/);
    expect(r.currentOffers).toMatch(/free estimate/i);
  });
  it('fingerprints the website platform', () => {
    expect(r.websitePlatform).toBe('WordPress');
  });
  it('sees both ad platforms already running, from their tags', () => {
    expect(r.runningAds).toBe('Both');
  });
  it('spots the email tool and the signup form', () => {
    expect(r.emailTool).toBe('Mailchimp');
    expect(r.collectsEmails).toBe('Yes');
  });
  it('takes brand colors from CSS custom properties, skipping the neutrals', () => {
    expect(r.brandColors).toContain('#1f4e79');
    expect(r.brandColors).toContain('#f2a20c');
    expect(r.brandColors).not.toContain('#333333');
    expect(r.brandColors).not.toContain('#ffffff');
  });
  it('falls back to the first real paragraph when there is no meta description', () => {
    expect(r.description).toContain('family-owned house painting company');
  });
  it('reads the street address, phone and email out of the footer', () => {
    expect(r.address).toBe('1234 Ridge Avenue');
    expect(r.city).toBe('Philadelphia');
    expect(r.state).toBe('PA');
    expect(r.zip).toBe('19123');
    expect(r.phone).toBe('2673923939');
    expect(r.email).toBe('paul@paintersinphilly.com');
  });
  it('keeps real services and drops the boilerplate headings', () => {
    expect(r.services).toContain('Cabinet Refinishing');
    expect(r.services).not.toContain('Why Choose Us');
    expect(r.services).not.toContain('Free Estimate');
  });
});

describe('detectIndustry', () => {
  it('does not let one passing mention of another trade win', () => {
    const text = 'roofing roof repair shingles roofer roof replacement. We also paint trim.';
    expect(detectIndustry(text)).toBe('Roofing');
  });
  it('returns nothing rather than guessing when no trade is evidenced', () => {
    expect(detectIndustry('Welcome to our website. We are a local company you can trust.')).toBeUndefined();
  });
  it('weights the title and headings above body copy', () => {
    expect(detectIndustry('call us today', 'Philadelphia Electrician')).toBe('Electrical');
  });
});

describe('detectYearFounded', () => {
  it('reads the common phrasings', () => {
    expect(detectYearFounded('Established in 1976 and still going.', 2026)).toBe(1976);
    expect(detectYearFounded('Proudly serving Dallas since 2004.', 2026)).toBe(2004);
  });
  it('never reads a copyright line as a founding year', () => {
    expect(detectYearFounded('© 2026 Acme. All rights reserved.', 2026)).toBeUndefined();
  });
  it('derives a year from "over N years" only when no year is stated', () => {
    expect(detectYearFounded('Over 25 years of experience.', 2026)).toBe(2001);
    expect(detectYearFounded('Since 1999. Over 25 years of experience.', 2026)).toBe(1999);
  });
  it('rejects an implausible year', () => {
    expect(detectYearFounded('Established in 1492', 2026)).toBeUndefined();
  });
});

describe('detectEmployees', () => {
  it('reads a stated team size', () => {
    expect(detectEmployees('our team of 14 painters')).toBe(14);
    expect(detectEmployees('We have 32 full-time employees.')).toBe(32);
  });
  it('does not invent one', () => {
    expect(detectEmployees('We are a small local crew.')).toBeUndefined();
  });
});

describe('detectOffers', () => {
  it('finds money-off and free-X offers', () => {
    const o = detectOffers('Get $79 AC tune-up or 15% off any repair. Free estimates always.');
    expect(o.join(' | ')).toMatch(/15% off/);
    expect(o.join(' | ')).toMatch(/free estimate/i);
  });
  it('finds nothing on a page with no offer', () => {
    expect(detectOffers('We do quality work at fair prices.')).toEqual([]);
  });
});

describe('detectServiceAreas', () => {
  it('reads a "proudly serving" sentence', () => {
    const t = 'Proudly serving Philadelphia, Bala Cynwyd, Ardmore and Narberth for 20 years.';
    const a = detectServiceAreas('', t);
    expect(a).toContain('Bala Cynwyd');
    expect(a).toContain('Narberth');
  });
});

describe('detectRunningAds', () => {
  it('reads Google Ads from a conversion tag', () => {
    expect(detectRunningAds('<script src="https://www.googletagmanager.com/gtag/js?id=AW-123456789">')).toBe('Google Ads');
  });
  it('reads Meta from the pixel', () => {
    expect(detectRunningAds("fbq('init','1234')")).toBe('Meta (FB/IG)');
  });
  it('says nothing when no ad tag is present — absence is not proof', () => {
    expect(detectRunningAds('<script src="/js/app.js"></script>')).toBeUndefined();
  });
  it('does not mistake plain Google Analytics for Google Ads', () => {
    expect(detectRunningAds('<script src="https://www.googletagmanager.com/gtag/js?id=G-ABC123">')).toBeUndefined();
  });
});

describe('detectBrandColors', () => {
  it('ranks a declared brand variable above an incidental one', () => {
    const c = detectBrandColors(':root{--x:#8a2be2;--brand:#00857a}');
    expect(c[0]).toBe('#00857a');
  });
  it('drops greys, near-white and near-black', () => {
    expect(detectBrandColors('a{color:#fefefe}b{color:#010101}c{color:#777777}')).toEqual([]);
  });
});

describe('chooseLinks', () => {
  const base = new URL('https://paintersinphilly.com/');
  const links = chooseLinks(PAINTER, base);
  it('prefers the shallowest page for each hint', () => {
    expect(links).toContain('https://paintersinphilly.com/about-us/');
    expect(links).not.toContain('https://paintersinphilly.com/about-us/our-team/history/');
  });
  it('covers contact, services, and specials', () => {
    expect(links).toContain('https://paintersinphilly.com/contact/');
    expect(links).toContain('https://paintersinphilly.com/services/');
    expect(links).toContain('https://paintersinphilly.com/specials/');
  });
  it('never leaves the origin', () => {
    expect(links.every((l) => l.startsWith('https://paintersinphilly.com/'))).toBe(true);
  });
  it('respects the page cap', () => {
    expect(chooseLinks(PAINTER, base, 2)).toHaveLength(2);
  });
});

describe('mergeFacts', () => {
  it('takes the first page for single-value facts', () => {
    const m = mergeFacts([{ phone: '111' }, { phone: '222', email: 'a@b.com' }]);
    expect(m.phone).toBe('111');
    expect(m.email).toBe('a@b.com');
  });
  it('unions list fields across pages instead of stopping at the first', () => {
    const m = mergeFacts([{ services: 'Interior Painting' }, { services: 'Deck Staining, Interior Painting' }]);
    expect(m.services).toBe('Interior Painting, Deck Staining');
  });
});

describe('buildKeywords', () => {
  it('pairs each service with the city', () => {
    const k = buildKeywords({ industry: 'Painting', city: 'Philadelphia', services: 'Interior Painting, Deck Staining' });
    expect(k).toContain('painting philadelphia');
    expect(k).toContain('interior painting philadelphia');
  });
  it('returns nothing when there is nothing to build from', () => {
    expect(buildKeywords({})).toBeUndefined();
  });
});

describe('visibleText', () => {
  it('drops scripts and styles so their contents cannot be read as page copy', () => {
    const t = visibleText('<style>.a{color:red}</style><script>var plumbing=1</script><p>We paint houses.</p>');
    expect(t).toBe('We paint houses.');
  });
});

/** A fake site: the home page above, plus the internal pages holding the rest. */
const PAGES: Record<string, string> = {
  'https://paintersinphilly.com/': PAINTER,
  'https://paintersinphilly.com/about-us/': `<html><head><title>About</title></head><body>
    <p>Painters In Philly is a family-owned painting company. Our team of 14 painters has
    been repainting Philadelphia homes since 1998.</p></body></html>`,
  'https://paintersinphilly.com/services/': `<html><head><title>Services</title></head><body>
    <h2>Wallpaper Removal</h2><h2>Popcorn Ceiling Removal</h2><h2>Interior Painting</h2>
    </body></html>`,
  'https://paintersinphilly.com/contact/': `<html><head><title>Contact</title></head><body>
    <p>1234 Ridge Avenue, Philadelphia, PA 19123</p></body></html>`,
  'https://paintersinphilly.com/specials/': `<html><head><title>Specials</title></head><body>
    <p>10% off interior painting booked this month.</p></body></html>`,
};

function stubFetch(pages: Record<string, string>) {
  const seen: string[] = [];
  vi.stubGlobal('fetch', async (input: string | URL) => {
    const url = String(input);
    seen.push(url);
    const body = pages[url];
    return {
      ok: body !== undefined,
      status: body === undefined ? 404 : 200,
      url,
      headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null) },
      text: async () => body ?? '',
    } as unknown as Response;
  });
  return seen;
}

describe('importSite', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('crawls the internal pages and merges what only they know', async () => {
    const seen = stubFetch(PAGES);
    const d = await importSite('paintersinphilly.com');
    expect(d).toBeTruthy();
    expect(d!.pagesRead).toBe(5);
    expect(seen).toContain('https://paintersinphilly.com/specials/');
    // Services only the /services/ page lists.
    expect(d!.services).toContain('Wallpaper Removal');
    // ...alongside the ones the home page listed.
    expect(d!.services).toContain('Cabinet Refinishing');
    // Offers union across pages rather than stopping at the home page.
    expect(d!.currentOffers).toMatch(/10% off/);
    expect(d!.currentOffers).toMatch(/\$250 off/);
  });

  it('fills the fields the profile form was leaving blank', async () => {
    stubFetch(PAGES);
    const d = (await importSite('https://paintersinphilly.com'))!;
    expect(d.industry).toBe('Painting');
    expect(d.yearStarted).toBe(1998);
    expect(d.employees).toBe(14);
    expect(d.websitePlatform).toBe('WordPress');
    expect(d.runningAds).toBe('Both');
    expect(d.targetKeywords).toContain('painting philadelphia');
    expect(d.serviceAreas).toContain('Manayunk');
    expect(d.filled!.length).toBeGreaterThanOrEqual(20);
    expect(d.foundFields).toBe(d.filled!.length);
  });

  it('reports a site that refused us instead of pretending the site was empty', async () => {
    stubFetch({});
    const d = await importSite('paintersinphilly.com');
    expect(d?.foundFields).toBe(0);
  });

  it('refuses to fetch private and loopback addresses', async () => {
    const seen = stubFetch(PAGES);
    for (const target of ['http://localhost:8080/', 'http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data/', 'http://10.0.0.5/', 'file:///etc/passwd']) {
      expect(await importSite(target)).toBeNull();
    }
    expect(seen).toEqual([]);
  });
});
