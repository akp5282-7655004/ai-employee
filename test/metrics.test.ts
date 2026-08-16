import { describe, expect, it } from 'vitest';
import { metricCatalog, metricByKey, dashboardDefaults, formatMetric } from '../src/metrics/catalog.js';
import { getMetric, getMetrics } from '../src/metrics/resolver.js';
import { SEVEN_SKILLS, runSevenSkill, type SkillCtx } from '../src/skills/seven.js';

describe('metric catalog', () => {
  it('loads 100+ metrics with unique dot-namespaced keys', () => {
    const all = metricCatalog();
    expect(all.length).toBeGreaterThanOrEqual(100);
    expect(new Set(all.map((m) => m.key)).size).toBe(all.length);
    all.forEach((m) => expect(m.key).toMatch(/^[a-z_]+\.[a-z0-9_]+$/));
  });

  it('every calculated metric declares dependencies that exist', () => {
    const all = metricCatalog();
    for (const m of all.filter((x) => x.platform === 'calculated')) {
      for (const dep of m.depends_on) {
        expect(metricByKey(dep), `${m.key} depends on missing ${dep}`).toBeTruthy();
      }
    }
  });

  it('every metric has a testable sample_value', () => {
    metricCatalog().forEach((m) => expect(typeof m.sample_value, m.key).toBe('number'));
  });

  it('rates use recompute aggregation (never average the daily rate)', () => {
    for (const m of metricCatalog().filter((x) => x.unit === 'percent' || x.unit === 'ratio')) {
      expect(['recompute', 'weighted_avg', 'last'], `${m.key} aggregates by ${m.aggregation}`).toContain(m.aggregation);
    }
  });

  it('defaults reference real catalog keys', () => {
    const d = dashboardDefaults();
    expect(d.kpi_strip.length).toBe(8);
    d.kpi_strip.forEach((k) => expect(metricByKey(k), k).toBeTruthy());
  });

  it('formats values by catalog entry', () => {
    expect(formatMetric(metricByKey('crm.job_revenue')!, 41300)).toBe('$41,300');
    expect(formatMetric(metricByKey('google_ads.ctr')!, 1.44)).toBe('1.4%');
  });
});

describe('getMetric resolver', () => {
  it('returns deterministic sample data labeled as sample', async () => {
    const a = await getMetric('crm.booked_jobs', 30);
    const b = await getMetric('crm.booked_jobs', 30);
    expect(a).toEqual(b); // stable dashboards — no random flicker
    expect(a!.source).toBe('sample');
    expect(a!.series.length).toBeGreaterThan(5);
  });

  it('uses live google ads cost when the reader provides it', async () => {
    const r = await getMetric('google_ads.cost', 30, { googleAdsCost: async () => 412.55 });
    expect(r!.source).toBe('live');
    expect(r!.value).toBe(412.55);
  });

  it('falls back to sample when the live reader fails', async () => {
    const r = await getMetric('google_ads.cost', 30, { googleAdsCost: async () => { throw new Error('down'); } });
    expect(r!.source).toBe('sample');
  });

  it('resolves batches and skips unknown keys', async () => {
    const rs = await getMetrics(['crm.booked_jobs', 'nope.nothing', 'lsa.spend'], 7);
    expect(rs.map((r) => r.key)).toEqual(['crm.booked_jobs', 'lsa.spend']);
  });
});

describe('seven skills — proposal mode', () => {
  const ctx: SkillCtx = {
    business: 'Painters In Philly', trade: 'Painting', city: 'Philadelphia',
    services: 'Interior painting', zips: ['19103', '19104'], live: {},
    spendRows: [
      { campaign: 'Search — Interior', cost: 300, conversions: 12 },
      { campaign: 'Display — Remarketing', cost: 96, conversions: 0 },
    ],
  };

  it('all seven run and none executes anything', async () => {
    for (const s of SEVEN_SKILLS) {
      const run = await runSevenSkill(s.key, ctx);
      expect(run.summary.length).toBeGreaterThan(10);
      expect(['needs_approval', 'read_only']).toContain(run.status);
    }
  });

  it('loser pauser finds the zero-conversion spender from live rows', async () => {
    const run = await runSevenSkill('loser-pauser', ctx);
    expect(run.status).toBe('needs_approval');
    expect(run.details.join(' ')).toContain('Display — Remarketing');
    expect(run.source).toBe('live');
  });

  it('proposals without write access disable approval with a stated reason', async () => {
    const run = await runSevenSkill('loser-pauser', ctx);
    expect(run.approve_disabled_reason).toBeTruthy();
  });

  it('unknown skill throws', async () => {
    await expect(runSevenSkill('nope', ctx)).rejects.toThrow(/Unknown skill/);
  });
});

describe('native analysis skills (8-11)', () => {
  const base: SkillCtx = {
    business: 'Painters In Philly', trade: 'Painting', city: 'Philadelphia',
    services: 'Interior painting', zips: [], live: {},
    spendRows: [{ campaign: 'Search — Interior', cost: 600, conversions: 12 }],
  };

  it('gold miner runs LIVE on real search terms and finds waste + gold', async () => {
    const run = await runSevenSkill('search-term-gold-miner', {
      ...base,
      searchTerms: [
        { term: 'painter jobs hiring', cost: 55, clicks: 20, conversions: 0 },
        { term: 'interior painter near me', cost: 80, clicks: 25, conversions: 5 },
        { term: 'cheap diy paint', cost: 4, clicks: 3, conversions: 0 }, // under $10 — ignored
      ],
    });
    expect(run.source).toBe('live');
    expect(run.details.join(' ')).toContain('painter jobs hiring');
    expect(run.details.join(' ')).toContain('interior painter near me');
    expect(run.details.join(' ')).not.toContain('cheap diy paint');
  });

  it('negative implementer builds the block list from live waste', async () => {
    const run = await runSevenSkill('negative-keyword-implementer', {
      ...base,
      searchTerms: [{ term: 'painter salary', cost: 30, clicks: 12, conversions: 0 }],
    });
    expect(run.source).toBe('live');
    expect(run.details[0]).toContain('"painter salary"');
    expect(run.approve_disabled_reason).toBeTruthy(); // no write path yet — honest
  });

  it('pacing monitor projects month-end against the set budget', async () => {
    const run = await runSevenSkill('spend-pacing-monitor', { ...base, monthlyBudget: 1000 });
    expect(run.source).toBe('live');
    expect(run.summary).toMatch(/Pacing at \d+% of your \$1,000\/mo budget/);
  });

  it('pacing monitor asks for a budget when none is set, still showing real spend', async () => {
    const run = await runSevenSkill('spend-pacing-monitor', base);
    expect(run.summary).toContain('$600');
    expect(run.summary).toContain('Set a monthly ad budget');
  });
});
