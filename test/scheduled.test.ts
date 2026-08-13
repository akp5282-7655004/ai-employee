import { describe, expect, it } from 'vitest';
import { isDue, buildCpaReport, buildMorningBrief, buildTaskListPrompt, fallbackTaskList, buildWrapupPrompt, fallbackWrapup, TASK_SPECS, socialAgent, reviewAgent, leadAgent, metricsLine, agentFallback, buildAgentDesignPrompt, parseAgentSpec, fallbackAgentDesign, customAgentRun, DATA_SOURCES, type ScheduledAgent } from '../src/agents/scheduled.js';

const agent = (o: Partial<ScheduledAgent> = {}): ScheduledAgent => ({
  id: 'a1', name: 'Brief', task: 'morning_brief', time: '08:30', days: [1, 2, 3, 4, 5], enabled: true, tzOffset: 0, createdAt: '', ...o,
});

describe('isDue', () => {
  // A Monday at 08:30 UTC (tzOffset 0).
  const mon0830 = new Date('2026-08-10T08:30:00Z');
  it('fires at the scheduled minute on a scheduled weekday', () => {
    expect(isDue(agent(), mon0830)).toBe(true);
  });
  it('does not fire before the time or long after', () => {
    expect(isDue(agent(), new Date('2026-08-10T08:29:00Z'))).toBe(false);
    expect(isDue(agent(), new Date('2026-08-10T08:40:00Z'))).toBe(false);
  });
  it('forgives a few minutes of scheduler lag', () => {
    expect(isDue(agent(), new Date('2026-08-10T08:33:00Z'))).toBe(true);
  });
  it('skips days not in the schedule (Sunday)', () => {
    expect(isDue(agent(), new Date('2026-08-09T08:30:00Z'))).toBe(false);
  });
  it('respects the timezone offset (PST 08:30 local = 16:30 UTC)', () => {
    const pst = agent({ tzOffset: 480 });
    expect(isDue(pst, new Date('2026-08-10T16:30:00Z'))).toBe(true);
    expect(isDue(pst, new Date('2026-08-10T08:30:00Z'))).toBe(false);
  });
  it('runs only once per local day', () => {
    expect(isDue(agent({ lastRunAt: '2026-08-10T08:30:00Z' }), new Date('2026-08-10T08:31:00Z'))).toBe(false);
  });
  it('never fires when disabled', () => {
    expect(isDue(agent({ enabled: false }), mon0830)).toBe(false);
  });
});

describe('buildCpaReport', () => {
  const spend = [
    { platform: 'google_ads', campaign: 'Plumbing', utm: 'g', spend: 1200, clicks: 400, conversions: 20 }, // $60 CPA
    { platform: 'facebook', campaign: 'AC', utm: 'f', spend: 900, clicks: 500, conversions: 6 }, // $150 CPA
  ];
  it('computes CPA per platform and flags the ones over target', () => {
    const r = buildCpaReport(spend, [], 85);
    const g = r.rows.find((x) => x.platform === 'google_ads')!;
    const f = r.rows.find((x) => x.platform === 'facebook')!;
    expect(g.cpa).toBe(60);
    expect(g.status).toBe('under');
    expect(f.cpa).toBe(150);
    expect(f.status).toBe('over');
    expect(r.overCount).toBe(1);
    expect(r.body).toContain('OVER target');
  });
  it('handles a platform with no conversions without dividing by zero', () => {
    const r = buildCpaReport([{ platform: 'google_ads', campaign: 'x', utm: 'g', spend: 500, clicks: 100, conversions: 0 }], [], 85);
    expect(r.rows[0]!.status).toBe('no_data');
    expect(r.rows[0]!.cpa).toBeNull();
  });
  it('says so cleanly when there is no ad data at all', () => {
    const r = buildCpaReport([], [], 85);
    expect(r.body.toLowerCase()).toContain('connect');
  });
});

describe('email → task list', () => {
  const emails = [
    { from: 'Sarah', subject: 'Kitchen repaint quote?', snippet: 'can you quote a repaint this week', unread: true },
    { from: 'QuickBooks', subject: 'Invoice #1042 is overdue', snippet: '$1,850 is 5 days overdue', unread: false },
    { from: 'Newsletter', subject: 'Weekly digest', snippet: 'top articles', unread: true },
  ];
  it('prompt lists the inbox and asks for a prioritized to-do', () => {
    const { system, user } = buildTaskListPrompt(emails, 'Painters In Philly');
    expect(system.toLowerCase()).toContain('prioriti');
    expect(user).toContain('Kitchen repaint quote');
    expect(user).toContain('Painters In Philly');
  });
  it('fallback puts leads & overdue invoices in "Do first"', () => {
    const out = fallbackTaskList(emails);
    const doFirst = out.split('🟡')[0]!;
    expect(doFirst).toContain('Kitchen repaint quote?');
    expect(doFirst).toContain('Invoice #1042 is overdue');
  });
});

describe('6pm daily wrap-up', () => {
  it('fallback separates accomplished from pending', () => {
    const out = fallbackWrapup({ accomplished: ['Paused Drain ad set'], pending: ['New AC campaign'], agentRuns: ['Morning task list'] }, 'Monday');
    expect(out).toContain('✅ Accomplished today');
    expect(out).toContain('Paused Drain ad set');
    expect(out).toContain('Morning task list');
    expect(out).toContain('New AC campaign');
  });
  it('handles a quiet day gracefully', () => {
    expect(fallbackWrapup({ accomplished: [], pending: [], agentRuns: [] }, 'Monday')).toContain('Quiet day');
  });
  it('prompt includes the activity', () => {
    const { user } = buildWrapupPrompt({ accomplished: ['x'], pending: ['y'], agentRuns: [] }, 'Acme');
    expect(user).toContain('Acme');
    expect(user).toContain('x');
    expect(user).toContain('y');
  });
});

describe('the full agent roster', () => {
  const ctx = { business: 'Painters In Philly', trade: 'Home Services', city: 'Philadelphia', services: 'interior painting', offers: '10% off' };
  it('ships all 14 agents', () => {
    expect(TASK_SPECS.map((t) => t.task).sort()).toEqual(
      ['competitor_watch', 'content_writer', 'cpa_report', 'daily_wrapup', 'email_tasklist', 'geo_agent', 'lead_followup', 'morning_brief', 'recommend', 'review_responder', 'seo_agent', 'social_content', 'social_poster', 'social_report'].sort(),
    );
  });
  it('social prompt weaves in the business + offer', () => {
    const { system, user } = socialAgent(ctx);
    expect(system.toLowerCase()).toContain('social media');
    expect(user).toContain('Painters In Philly');
    expect(user).toContain('10% off');
  });
  it('review agent asks for templates when there are no reviews', () => {
    expect(reviewAgent({ ...ctx, reviews: [] }).user).toContain('none today');
    expect(reviewAgent({ ...ctx, reviews: [{ rating: 2, author: 'Dave', text: 'late' }] }).user).toContain('Dave');
  });
  it('metricsLine reports numbers or nudges to connect', () => {
    expect(metricsLine({ impressions: 3420, clicks: 128, likes: 74 })).toContain('3,420 impressions');
    expect(metricsLine(null).toLowerCase()).toContain('connect');
  });
  it('fallbacks are usable with no LLM key', () => {
    expect(agentFallback('social_content', ctx)).toContain('Painters In Philly');
    expect(agentFallback('lead_followup', { ...ctx, leads: [{ name: 'Sarah', service: 'repaint' }] })).toContain('Sarah');
  });
  it('the competitive agents (SEO / content / GEO) have their own fallbacks', () => {
    expect(agentFallback('seo_agent', ctx)).toContain('Philadelphia');
    expect(agentFallback('content_writer', ctx)).toContain('interior painting');
    expect(agentFallback('geo_agent', ctx).toLowerCase()).toContain('geo');
  });
});

describe('Agent Studio — build a custom agent from a problem', () => {
  const emailProblem = 'Every morning read my email, summarize it, sort by priority, and tell me which to reply to and which to ignore.';

  it('design prompt asks for JSON and lists the real data sources', () => {
    const { system, user } = buildAgentDesignPrompt(emailProblem);
    expect(system).toContain('JSON');
    expect(system).toContain('"emails"');
    expect(user).toContain('summarize it');
  });

  it('parses a valid LLM JSON spec and validates the data source', () => {
    const raw = 'Sure!\n```json\n{"name":"Inbox Triage","description":"Reads and prioritizes your email","dataSource":"emails","systemPrompt":"Read the inbox and produce a ranked to-do list.","time":"08:00","days":[1,2,3,4,5]}\n```';
    const spec = parseAgentSpec(raw)!;
    expect(spec).not.toBeNull();
    expect(spec.name).toBe('Inbox Triage');
    expect(spec.dataSource).toBe('emails');
    expect(spec.days).toEqual([1, 2, 3, 4, 5]);
  });

  it('coerces an unknown data source to "none" and rejects an empty prompt', () => {
    expect(parseAgentSpec('{"name":"X","dataSource":"telepathy","systemPrompt":"do it"}')!.dataSource).toBe('none');
    expect(parseAgentSpec('{"name":"X","dataSource":"emails","systemPrompt":""}')).toBeNull();
    expect(parseAgentSpec('not json at all')).toBeNull();
  });

  it('fallback design keyword-maps the problem to the right data source', () => {
    expect(fallbackAgentDesign(emailProblem).dataSource).toBe('emails');
    expect(fallbackAgentDesign('respond to my new google reviews').dataSource).toBe('reviews');
    expect(fallbackAgentDesign('summarize my day').dataSource).toBe('none');
  });

  it('the run prompt uses the stored instruction and injects gathered data', () => {
    const spec = fallbackAgentDesign(emailProblem);
    const { system, user } = customAgentRun(spec, 'Rivera Plumbing', '1. From: Sarah | quote?');
    expect(system).toBe(spec.systemPrompt);
    expect(user).toContain('Rivera Plumbing');
    expect(user).toContain('Sarah');
  });

  it('every data source has a connect hint (or is the no-data option)', () => {
    for (const s of DATA_SOURCES) expect(s.id === 'none' ? s.connect === '' : s.connect.length > 0).toBe(true);
  });
});

describe('buildMorningBrief', () => {
  it('lists pending approvals and weather as real to-dos', () => {
    const b = buildMorningBrief({
      business: 'Rivera Plumbing', dateLabel: 'Monday, August 10', weatherLine: '104°F, Sunny',
      weatherOpportunity: 'Push AC emergency ads', pendingApprovals: 2, activeTriggers: 1,
    });
    expect(b.title).toContain('Morning brief');
    expect(b.body).toContain('Rivera Plumbing');
    expect(b.body).toContain('104°F');
    expect(b.body).toContain('Approve 2 changes');
  });
});
