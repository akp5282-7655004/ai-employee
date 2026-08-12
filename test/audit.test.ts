import { describe, expect, it } from 'vitest';
import { runAuditChecks, scoreFindings, gradeFor, fallbackAuditSummary, buildAuditPrompt, type AuditResult } from '../src/research/audit.js';

const find = (fs: ReturnType<typeof runAuditChecks>, id: string) => fs.find((f) => f.id === id)!;

describe('runAuditChecks', () => {
  it('flags a bare, insecure page as failing across the board', () => {
    const fs = runAuditChecks('<html><body><p>hi</p></body></html>', 'http://example.com');
    expect(find(fs, 'ssl').status).toBe('bad');
    expect(find(fs, 'title').status).toBe('bad');
    expect(find(fs, 'phone').status).toBe('bad');
    expect(find(fs, 'cta').status).toBe('bad');
    expect(find(fs, 'viewport').status).toBe('bad');
  });

  it('rewards a well-built local-service homepage', () => {
    const html = `<!doctype html><html><head>
      <title>AC Repair in Phoenix | Rivera Plumbing</title>
      <meta name="description" content="Fast, licensed AC repair in Phoenix, AZ. Same-day service, 5-star rated. Call today for a free quote.">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <meta property="og:image" content="/hero.jpg">
      <link rel="icon" href="/favicon.ico">
      <script type="application/ld+json">{"@type":"LocalBusiness","name":"Rivera Plumbing","telephone":"6025550134"}</script>
      <script src="https://www.googletagmanager.com/gtag/js"></script>
      </head><body>
      <h1>AC Repair in Phoenix, AZ</h1>
      <a href="tel:+16025550134">Call (602) 555-0134</a>
      <a class="btn">Get a Free Quote</a>
      <p>We are a licensed, 5-star rated team serving Phoenix, AZ 85001. Read our reviews.
      ${'Our technicians repair air conditioners fast. '.repeat(30)}</p>
      <img src="a.jpg" alt="AC unit"><img src="b.jpg" alt="technician">
      </body></html>`;
    const fs = runAuditChecks(html, 'https://riveraplumbing.com');
    expect(find(fs, 'ssl').status).toBe('good');
    expect(find(fs, 'title').status).toBe('good');
    expect(find(fs, 'phone').status).toBe('good'); // tap-to-call link
    expect(find(fs, 'schema').status).toBe('good'); // LocalBusiness
    expect(find(fs, 'local').status).toBe('good');
    expect(find(fs, 'cta').status).toBe('good');
    expect(scoreFindings(fs)).toBeGreaterThanOrEqual(85);
  });

  it('warns (not fails) when a phone is text-only, not a tap-to-call link', () => {
    const fs = runAuditChecks('<html><body>Call us at (602) 555-0134</body></html>', 'https://x.com');
    expect(find(fs, 'phone').status).toBe('warn');
  });
});

describe('scoreFindings + gradeFor', () => {
  it('is 0 for an all-bad page and maps grades sensibly', () => {
    const fs = runAuditChecks('<html><body></body></html>', 'http://x.com');
    expect(scoreFindings(fs)).toBeLessThan(20);
    expect(gradeFor(95)).toBe('A');
    expect(gradeFor(80)).toBe('B');
    expect(gradeFor(50)).toBe('D');
    expect(gradeFor(10)).toBe('F');
  });
});

describe('summaries', () => {
  const result: AuditResult = {
    url: 'x.com', finalUrl: 'https://x.com', score: 55, grade: 'D',
    findings: runAuditChecks('<html><body>hi</body></html>', 'http://x.com'),
    stats: { words: 1, images: 0, imagesWithAlt: 0 }, pagesCrawled: 1,
  };
  it('fallback leads with the score and lists concrete fixes', () => {
    const s = fallbackAuditSummary(result);
    expect(s).toContain('55/100');
    expect(s.toLowerCase()).toContain('fix');
  });
  it('prompt hands the model the score and findings', () => {
    const { system, user } = buildAuditPrompt(result, 'Rivera Plumbing');
    expect(system.toLowerCase()).toContain('action plan');
    expect(user).toContain('Rivera Plumbing');
    expect(user).toContain('55/100');
  });
});
