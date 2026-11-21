import { describe, expect, it } from 'vitest';
import { requiredContributors } from '../src/benchmarks/cohort.js';
import { aggregateBenchmarks } from '../src/benchmarks/aggregate.js';
import { collectAccount } from '../src/benchmarks/collect.js';
import { CRM_ADAPTERS, crmDayFromLedger, mapHubspotDeals, mapServiceTitanJobs, readCrmAdapter } from '../src/benchmarks/crm.js';
import { adminCohorts } from '../src/benchmarks/adminView.js';
import { payloadLeaks, publicAggregate } from '../src/benchmarks/privacy.js';
import { resolveBenchmark } from '../src/benchmarks/resolve.js';
import { LIVING_PLAYBOOK_SQL } from '../src/benchmarks/schema.js';
import { BENCHMARK_HUB } from '../src/packs/benchmarks.js';
import { goalCheck } from '../src/agents/goalcheck.js';
import { MemoryStore } from '../src/db/memory.js';
import { buildServer } from '../src/server.js';
import type { Connector } from '../src/connectors/types.js';
import type { DailyRow, Membership, MilesCohort } from '../src/benchmarks/types.js';

const TABLE = [
  [5, 5],
  [10, 5],
  [25, 14],
  [50, 31],
  [100, 75],
  [200, 150],
] as const;

describe('minimum group size', () => {
  it('matches the owner table', () => {
    for (const [n, required] of TABLE) expect(requiredContributors(n)).toBe(required);
  });
});

function member(id: string, trade: string, extra: Partial<Membership> = {}): Membership {
  return {
    accountId: id,
    trade,
    active: true,
    consent: true,
    trackingVerified: true,
    platforms: ['google_ads'],
    ...extra,
  };
}

function daily(id: string, trade: string, spend: number, leads: number, extra: Partial<DailyRow> = {}): DailyRow {
  return {
    accountId: id,
    day: '2026-11-01',
    platform: 'google_ads',
    campaignType: 'search',
    trade,
    trackingVerified: true,
    accountActive: true,
    consent: true,
    spend,
    clicks: 20,
    impressions: 200,
    leads,
    conversions: leads,
    bookedJobs: 2,
    revenue: spend * 3,
    cpl: leads > 0 ? spend / leads : null,
    cpc: spend / 20,
    cpa: spend / 2,
    roas: 3,
    ...extra,
  };
}

describe('aggregation and privacy', () => {
  it('publishes a median when the minimum is met and hides it when it is not', () => {
    const ids = ['acct_alpha', 'acct_bravo', 'acct_charlie', 'acct_delta', 'acct_echo'];
    const membership = ids.map((id) => member(id, 'plumbing'));
    const dailyRows = ids.map((id, i) => daily(id, 'plumbing', 200, 5 + i));
    const published = aggregateBenchmarks({ asOf: '2026-11-20', daily: dailyRows, membership });
    const cpl = published.find((row) => row.trade === 'plumbing' && row.platform === 'google_ads' && row.metric === 'cpl')!;
    expect(cpl.cohortN).toBe(5);
    expect(cpl.requiredCount).toBe(5);
    expect(cpl.published).toBe(true);
    expect(cpl.median).toBeGreaterThan(0);
    expect(JSON.stringify(cpl)).not.toMatch(/accountId|email|phone/);

    const short = aggregateBenchmarks({
      asOf: '2026-11-20',
      daily: dailyRows.slice(0, 4),
      membership,
    });
    const hidden = short.find((row) => row.metric === 'cpl' && row.platform === 'google_ads')!;
    expect(hidden.published).toBe(false);
    expect(hidden.median).toBeNull();
    expect(hidden.contributorCount).toBe(4);
    expect(hidden.reason).toBe('below_minimum');
    const pub = publicAggregate(hidden);
    expect(pub.median).toBeNull();
    expect(payloadLeaks(pub, ids)).toBeNull();
  });

  it('refuses a cohort where one account is more than 40% of spend', () => {
    const ids = ['acct_alpha', 'acct_bravo', 'acct_charlie', 'acct_delta', 'acct_echo'];
    const membership = ids.map((id) => member(id, 'plumbing'));
    const dailyRows = [
      daily('acct_alpha', 'plumbing', 1000, 10),
      ...ids.slice(1).map((id) => daily(id, 'plumbing', 100, 5)),
    ];
    const rows = aggregateBenchmarks({ asOf: '2026-11-20', daily: dailyRows, membership });
    const cpl = rows.find((row) => row.metric === 'cpl')!;
    expect(cpl.contributorCount).toBe(5);
    expect(cpl.published).toBe(false);
    expect(cpl.reason).toBe('spend_concentration');
    expect(cpl.median).toBeNull();
  });

  it('drops opted-out and unverified accounts from the median and from future rows', async () => {
    const store = new MemoryStore();
    const ids = ['acct_alpha', 'acct_bravo', 'acct_charlie', 'acct_delta', 'acct_echo'];
    for (const id of ids) {
      const row = member(id, 'plumbing');
      if (id === 'acct_echo') row.consent = false;
      await store.upsertBenchmarkMembership(row);
      if (id !== 'acct_echo') await store.upsertBenchmarkDaily([daily(id, 'plumbing', 200, 8)]);
    }
    await store.upsertBenchmarkDaily([daily('acct_echo', 'plumbing', 9000, 40)]);
    await store.deleteBenchmarkDaily('acct_echo');
    const rows = aggregateBenchmarks({
      asOf: '2026-11-20',
      daily: await store.listBenchmarkDaily(),
      membership: await store.listBenchmarkMembership(),
    });
    const cpl = rows.find((row) => row.metric === 'cpl')!;
    expect(cpl.cohortN).toBe(5);
    expect(cpl.contributorCount).toBe(4);
    expect(cpl.published).toBe(false);
    await store.deleteUser('acct_alpha');
    expect((await store.listBenchmarkDaily()).some((row) => row.accountId === 'acct_alpha')).toBe(false);
    expect((await store.listBenchmarkMembership()).some((row) => row.accountId === 'acct_alpha')).toBe(false);
  });
});

describe('resolver priority', () => {
  it('lets a published Miles median replace Searchlight with no blend', () => {
    const cohort: MilesCohort = {
      published: true,
      median: 80,
      p25: 70,
      p75: 90,
      contributors: 82,
      required: 75,
      cohortN: 100,
      spendCapOk: true,
    };
    const row = resolveBenchmark({ trade: 'plumbing', platform: 'google_ads', metric: 'cpl', cohort });
    expect(row.kind).toBe('miles');
    expect(row.value).toBe(80);
    expect(row.sourceLabel).toBe('Miles data, 82 plumbing accounts, last 90 days');
    expect(row.milesShortfall).toBeNull();
    const check = goalCheck({ trade: 'Plumbing', city: 'Austin', budgetAmount: 20, budgetPeriod: 'day', leadGoal: 4, leadPeriod: 'month', cohort });
    expect(check.sourceLabel).toMatch(/Miles data, 82 plumbing accounts/);
    expect(check.assumption).toMatch(/\$80/);
    expect(check.assumption).not.toMatch(/\$183/);
  });

  it('uses Searchlight, then LocaliQ, then the playbook, then nothing', () => {
    const plumbing = resolveBenchmark({ trade: 'plumbing', platform: 'google_ads', metric: 'cpl' });
    expect(plumbing.kind).toBe('searchlight');
    expect(plumbing.value).toBe(183);
    expect(plumbing.sourceLabel).toBe('Searchlight, Q1 2026');
    expect(plumbing.milesShortfall).toBe('Not enough Miles data yet (0 of 5 accounts)');

    const painting = resolveBenchmark({ trade: 'painting', platform: 'google_ads', metric: 'cpl' });
    expect(painting).toMatchObject({ kind: 'external', value: 138.38, sourceLabel: 'LocaliQ 2025' });

    const hvacRoas = resolveBenchmark({ trade: 'hvac', platform: 'google_ads', metric: 'roas' });
    expect(hvacRoas.kind).toBe('none');
    expect(hvacRoas.value).not.toBe(4.37);

    const solar = resolveBenchmark({ trade: 'solar', platform: 'google_ads', metric: 'cpl' });
    expect(solar.kind).toBe('none');
    expect(solar.sourceLabel).toBe('No benchmark');

    const tiktok = resolveBenchmark({ trade: 'plumbing', platform: 'tiktok', metric: 'cpl' });
    expect(tiktok.kind).toBe('none');

    const meta = resolveBenchmark({ trade: 'hvac', platform: 'meta', metric: 'cpl' });
    expect(meta.kind).toBe('playbook');
    expect(meta.value).toBeNull();
    expect(meta.low).toBe(40);
    expect(meta.high).toBe(95);

    const roofCpa = resolveBenchmark({ trade: 'roofing', platform: 'google_ads', metric: 'cpa' });
    expect(roofCpa).toMatchObject({ kind: 'playbook', value: 2000, sourceLabel: 'Playbook estimate' });
  });

  it('flags the HVAC Google 4.37x ROAS cell as unverified', () => {
    const cell = BENCHMARK_HUB.find((channel) => channel.id === 'google_ads')!.entries.find((entry) => entry.trade === 'HVAC' && entry.metric === 'ROAS');
    expect(cell?.value).toBe(4.37);
    expect(cell?.unverified).toBe(true);
  });
});

describe('collection and CRM adapters', () => {
  it('derives rates and stores no personal fields', () => {
    const { daily, membership } = collectAccount({
      accountId: 'acct_1',
      day: '2026-11-20',
      trade: 'plumbing',
      active: true,
      consent: true,
      trackingVerified: true,
      connectedPlatforms: ['google_ads'],
      spend: [{ platform: 'google_ads', campaign: 'Brand Search', utm: '', spend: 200, clicks: 40, impressions: 800, conversions: 8 }],
      crm: crmDayFromLedger([
        { type: 'closed_won', ts: '2026-11-20T15:00:00.000Z', name: 'Ann', amount: 500, utmSource: 'google' },
        { type: 'lead', ts: '2026-11-20T12:00:00.000Z', name: 'Bob', utmSource: 'google' },
      ], [], '2026-11-20'),
    });
    expect(membership.platforms).toContain('google_ads');
    expect(daily.length).toBeGreaterThan(0);
    const text = JSON.stringify(daily);
    expect(text).not.toMatch(/Ann|Bob|phone|email|address/);
    expect(text).toContain('acct_1');
    const search = daily.find((row) => row.campaignType === 'brand_search')!;
    expect(search.cpl).toBe(25);
    expect(search.cpc).toBe(5);
  });

  it('does not call HubSpot, ServiceTitan, or Jobber', async () => {
    const fetchAction = () => Promise.reject(new Error('network'));
    for (const adapter of CRM_ADAPTERS.filter((row) => row.id !== 'gohighlevel')) {
      const result = await readCrmAdapter(adapter, fetchAction);
      expect(result.called).toBe(false);
      expect(result.todo).toMatch(/TODO/);
    }
    expect(mapHubspotDeals([{ stage: 'closedwon', amount: 80, email: 'a@b.c', phone: '555' }])).toEqual({ bookedJobs: 1, revenue: 80 });
    expect(mapServiceTitanJobs([{ status: 'Completed', invoiceTotal: 40, address: '1 Main' }])).toEqual({ bookedJobs: 1, revenue: 40 });
    expect(JSON.stringify(mapHubspotDeals([{ stage: 'closedwon', amount: 1, email: 'a@b.c' }]))).not.toMatch(/a@b.c/);
  });
});

describe('schema and routes', () => {
  it('keeps account ids off the aggregate table', () => {
    const aggregate = LIVING_PLAYBOOK_SQL.split('CREATE TABLE IF NOT EXISTS benchmark_aggregate')[1] || '';
    expect(aggregate).not.toMatch(/account_id/);
    expect(LIVING_PLAYBOOK_SQL).toMatch(/benchmark_daily \([\s\S]*account_id TEXT NOT NULL/);
  });

  it('blocks another tenant and a sub-minimum median', async () => {
    const store = new MemoryStore();
    const app = buildServer({ authStore: store, connector: { name: 'mock' } as Connector });
    const signed = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'owner@example.com', password: 'password1', tos: true, name: 'Ada Owner' } });
    const headers = { cookie: String(signed.headers['set-cookie']).split(';')[0] };
    const settings = await app.inject({ method: 'GET', url: '/api/settings', headers });
    expect(settings.json().benchmarkShare).toBe(true);
    await store.upsertBenchmarkMembership(member('other_business', 'plumbing'));
    await store.upsertBenchmarkDaily([daily('other_business', 'plumbing', 500, 9)]);
    await store.replaceBenchmarkAggregates(aggregateBenchmarks({
      asOf: '2026-11-20',
      daily: await store.listBenchmarkDaily(),
      membership: await store.listBenchmarkMembership(),
    }));
    const living = await app.inject({ method: 'GET', url: '/api/benchmarks/living?trade=plumbing&platform=google_ads&metric=cpl', headers });
    const body = living.json();
    expect(JSON.stringify(body)).not.toContain('other_business');
    expect(JSON.stringify(body)).not.toMatch(/Ada Owner|owner@example.com/);
    expect(body.aggregates[0].published).toBe(false);
    expect(body.aggregates[0].median).toBeNull();
    const admin = await app.inject({ method: 'GET', url: '/api/admin/benchmarks', headers });
    expect(admin.statusCode).toBe(403);
    const opted = await app.inject({ method: 'POST', url: '/api/benchmarks/sharing', headers, payload: { share: false } });
    expect(opted.json()).toMatchObject({ ok: true, benchmarkShare: false });
    const cohorts = adminCohorts(await store.listBenchmarkAggregates(), await store.listBenchmarkMembership());
    expect(JSON.stringify(cohorts)).not.toContain('other_business');
    expect(cohorts.find((row) => row.trade === 'plumbing' && row.platform === 'google_ads' && row.metric === 'cpl')!.published).toBe(false);
    await app.close();
  });
});
