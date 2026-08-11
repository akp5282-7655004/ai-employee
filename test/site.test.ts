import { describe, expect, it } from 'vitest';
import { parseSiteHtml } from '../src/research/site.js';

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
