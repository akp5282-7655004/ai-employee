import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { planActions } from '../src/automation/engine.js';
import { audiencesSkill, auditsSkill, feedTitles, landingPages, marginCac, seasonalSkill, structureSkill } from '../src/automation/desk.js';
import { runDailyRead } from '../src/automation/engine.js';
import type { DailyInput } from '../src/automation/skills.js';

function input(over: Partial<DailyInput> = {}): DailyInput {
  return {
    now: '2026-11-14T12:00:00.000Z',
    trade: 'Painting',
    monthlyBudget: 600,
    spentMonth: 200,
    dayOfMonth: 10,
    leads: 4,
    bookedJobs: 1,
    channels: { google: true, meta: false, gbp: false, ghl: false },
    campaigns: [{ name: 'House Painting', platform: 'google_ads', spend: 100, conversions: 2, clicks: 20 }],
    searchTerms: [],
    conversionActions: 1,
    callTracking: false,
    metaSpend: null,
    gbpCalls: null,
    ghlLeads: null,
    ...over,
  };
}

const guard = { mode: 'automate' as const, paused: false, creditsLeft: 100, dailyBudget: 20, monthlyCeiling: 600, maxChangePct: 10, spentToday: 0, spentMonth: 100 };

describe('landing pages', () => {
  it('says the final URL is missing instead of inventing a page check', () => {
    const rows = landingPages(input({ channels: { google: false, meta: false, gbp: false, ghl: false }, pages: [] }));
    expect(rows[0]!.detail).toMatch(/not connected/);
    expect(rows[0]!.detail).not.toMatch(/status 200|load time on file/i);
  });

  it('checks status, speed, phone, form, viewport, and the headline', () => {
    const bad = landingPages(input({
      city: 'Philadelphia',
      services: 'Interior painting',
      pages: [{ url: 'https://painters.example', adGroup: 'Interior', keywords: ['interior painting'], status: 404, loadMs: 4200, html: '<html><h1>Welcome</h1></html>' }],
    }));
    expect(bad[0]!.detail).toMatch(/status 404/);
    expect(bad[0]!.detail).toMatch(/4\.2 seconds/);
    expect(bad[0]!.detail).toMatch(/No phone number/);
    expect(bad[0]!.detail).toMatch(/No form/);
    expect(bad[0]!.detail).toMatch(/No mobile viewport/);
    expect(bad[0]!.detail).toMatch(/does not mention/);
    expect(bad[0]!.detail).toMatch(/Philadelphia/);
    const good = landingPages(input({
      city: 'Philadelphia',
      services: 'Interior painting',
      pages: [{
        url: 'https://painters.example',
        keywords: ['interior painting'],
        status: 200,
        loadMs: 800,
        html: '<html><head><meta name="viewport" content="width=device-width"></head><body><h1>Interior painting in Philadelphia</h1><a href="tel:2155550148">Call</a><form></form></body></html>',
      }],
    }));
    expect(good[0]!.detail).toMatch(/status 200/);
    expect(good[0]!.detail).toMatch(/phone number is on the page/);
    expect(good[0]!.detail).toMatch(/form is on the page/);
    expect(good[0]!.detail).toMatch(/interior painting/);
  });
});

describe('feed and titles', () => {
  it('does not invent headlines when no assets are stored', () => {
    const rows = feedTitles(input({ assets: [], channels: { google: false, meta: false, gbp: false, ghl: false } }));
    expect(rows[0]!.detail).toMatch(/will not invent ad copy/);
    expect(rows[0]!.action).toBeUndefined();
  });

  it('proposes playbook lines and never applies them', () => {
    const rows = feedTitles(input({
      city: 'Philadelphia',
      services: 'Cabinet refinishing',
      offer: 'Spring booking',
      assetSource: 'plan',
      assets: [{ adGroup: 'Brand', headlines: ['Our company'], descriptions: ['Learn more today'] }],
    }));
    expect(rows[0]!.detail).toMatch(/Cabinet refinishing/);
    expect(rows[0]!.detail).toMatch(/proposal only/);
    expect(rows[0]!.action?.kind).toBe('propose');
    const log = planActions(rows, guard, input().now);
    expect(log[0]!.effect).toBe('queued');
    expect(planActions(rows, { ...guard, mode: 'manual' }, input().now)[0]!.effect).toBe('suggested');
    expect(planActions(rows, { ...guard, mode: 'hybrid' }, input().now)[0]!.effect).toBe('queued');
    expect(planActions(rows, { ...guard, paused: true }, input().now)[0]!.effect).toBe('paused');
  });
});

describe('margin and CAC', () => {
  it('names every missing input and asks one question', () => {
    const rows = marginCac(input({
      trade: 'Roofing',
      leads: 0,
      bookedJobs: 0,
      campaigns: [],
      channels: { google: false, meta: false, gbp: false, ghl: false },
    }));
    expect(rows[0]!.detail).toMatch(/Missing:/);
    expect(rows[0]!.detail).toMatch(/One question: What is your ad spend/);
    expect(rows[0]!.detail).toMatch(/will not call this on track/);
    const ticket = marginCac(input({
      trade: 'Roofing',
      leads: 2,
      bookedJobs: 1,
      campaigns: [{ name: 'Roof', platform: 'google_ads', spend: 80, conversions: 1, clicks: 4 }],
    }));
    expect(ticket[0]!.detail).toMatch(/\$14,000/);
    expect(ticket[0]!.detail).not.toMatch(/your average job is \$14,000/);
  });

  it('marks on track only from stored spend, leads, and the saved target', () => {
    const on = marginCac(input({ leads: 4, bookedJobs: 1, avgTicket: 3500, closeRate: 0.4, targetCpa: 80 }));
    expect(on[0]!.detail).toMatch(/Cost per lead is \$25/);
    expect(on[0]!.detail).toMatch(/On track/);
    const off = marginCac(input({ leads: 1, bookedJobs: 1, avgTicket: 3500, closeRate: 0.4, targetCpa: 40, campaigns: [{ name: 'House Painting', platform: 'google_ads', spend: 100, conversions: 1, clicks: 10 }] }));
    expect(off[0]!.detail).toMatch(/Off track/);
  });
});

describe('audits, structure, audiences, and seasonal', () => {
  it('will not score a site that was not stored', () => {
    expect(auditsSkill(input({ website: 'https://painters.example', pages: [{ url: 'https://painters.example' }] }))[0]!.detail).toMatch(/will not score/);
  });

  it('flags a stored page that is missing the playbook checks', () => {
    const rows = auditsSkill(input({ pages: [{ url: 'https://painters.example', html: '<html><h1>Hi</h1></html>' }] }));
    expect(rows[0]!.detail).toMatch(/tap-to-call/);
    expect(rows[0]!.detail).toMatch(/form/);
  });

  it('proposes a missing service campaign and does not create it', () => {
    const rows = structureSkill(input({ services: 'Cabinet refinishing', campaigns: [{ name: 'Brand', platform: 'google_ads', spend: 10, conversions: 0, clicks: 2 }] }));
    expect(rows[0]!.detail).toMatch(/did not create a campaign/);
    expect(rows[0]!.action?.kind).toBe('propose');
    expect(planActions(rows, guard, input().now)[0]!.effect).toBe('queued');
  });

  it('lists playbook audiences and does not invent a segment', () => {
    const rows = audiencesSkill(input({ trade: 'Plumbing' }));
    expect(rows[0]!.detail).toMatch(/playbook/i);
    expect(rows[0]!.detail).not.toMatch(/sample audience/i);
  });

  it('uses the playbook calendar and stays quiet when the month is not named', () => {
    const named = seasonalSkill(input({ now: '2026-05-15T12:00:00.000Z' }), '2026-05-15T12:00:00.000Z');
    expect(named[0]!.detail).toMatch(/May/);
    const quiet = seasonalSkill(input({ now: '2026-11-14T12:00:00.000Z' }), '2026-11-14T12:00:00.000Z');
    expect(quiet[0]!.detail).toMatch(/does not name November/);
  });
});

describe('daily read wiring', () => {
  it('runs the new skills beside the original five', () => {
    const read = runDailyRead(input());
    const skills = read.findings.map((row) => row.skill);
    for (const key of ['landing-pages', 'feed-titles', 'margin-cac', 'audits', 'structure', 'audiences', 'seasonal', 'wasted-spend', 'weekly-report']) {
      expect(skills).toContain(key);
    }
    expect(read.findings.map((row) => row.detail).join(' ')).not.toMatch(/\u2014/);
  });

  it('shows the findings view hooks on the skills page and the dashboard', () => {
    const html = readFileSync(join(process.cwd(), 'web', 'index.html'), 'utf8');
    expect(html).toContain("findBox.id='skill-findings'");
    expect(html).toContain("card.id='dash-findings'");
    expect(html).toContain('skill.findings');
    expect(html).toContain('No daily read is saved yet');
  });
});
