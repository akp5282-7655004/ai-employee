import { describe, expect, it } from 'vitest';
import { appendCrmEvent, amountFrom, crmLiveValues, calcLiveValues } from '../src/metrics/crmledger.js';
import { getMetric } from '../src/metrics/resolver.js';

const now = () => new Date().toISOString();

describe('CRM event ledger', () => {
  it('appends events newest-first with a cap', () => {
    const data: Record<string, unknown> = {};
    appendCrmEvent(data, { type: 'lead', ts: now() });
    appendCrmEvent(data, { type: 'closed_won', ts: now(), amount: 2400 });
    const list = data.crmEvents as any[];
    expect(list.length).toBe(2);
    expect(list[0].type).toBe('closed_won');
  });

  it('parses deal amounts from common CRM field names', () => {
    expect(amountFrom({ monetary_value: '2,400.50' })).toBe(2400.5);
    expect(amountFrom({ value: 1800 })).toBe(1800);
    expect(amountFrom({ note: 'hi' })).toBeUndefined();
  });

  it('returns {} until any event exists — sample stays sample', () => {
    expect(crmLiveValues({}, 30)).toEqual({});
  });

  it('computes real metrics from events, respecting the date range', () => {
    const data: Record<string, unknown> = {};
    appendCrmEvent(data, { type: 'lead', ts: now() });
    appendCrmEvent(data, { type: 'lead', ts: now() });
    appendCrmEvent(data, { type: 'missed_call', ts: now() });
    appendCrmEvent(data, { type: 'job_complete', ts: now() });
    appendCrmEvent(data, { type: 'closed_won', ts: now(), amount: 2400 });
    appendCrmEvent(data, { type: 'lead', ts: new Date(Date.now() - 60 * 86_400_000).toISOString() }); // outside 30d
    const v = crmLiveValues(data, 30);
    expect(v['crm.leads_created']).toBe(3); // 2 leads + 1 missed call, old lead excluded
    expect(v['calls.missed']).toBe(1);
    expect(v['crm.completed_jobs']).toBe(1);
    expect(v['crm.booked_jobs']).toBe(1);
    expect(v['crm.job_revenue']).toBe(2400);
    expect(v['crm.avg_ticket']).toBe(2400);
  });

  it('zeros are real once the ledger has any event', () => {
    const data: Record<string, unknown> = {};
    appendCrmEvent(data, { type: 'lead', ts: now() });
    const v = crmLiveValues(data, 30);
    expect(v['crm.job_revenue']).toBe(0);
    expect(v['crm.booked_jobs']).toBe(0);
  });

  it('calc metrics blend only when every input is live', () => {
    const crm = { 'crm.leads_created': 10, 'crm.booked_jobs': 4, 'crm.job_revenue': 8000 };
    const withSpend = calcLiveValues(crm, 400);
    expect(withSpend['calc.blended_cpl']).toBe(40);
    expect(withSpend['calc.cost_per_booked']).toBe(100);
    expect(withSpend['calc.blended_roas']).toBe(20);
    const noSpend = calcLiveValues(crm, undefined);
    expect(noSpend['calc.blended_spend']).toBeUndefined();
    expect(noSpend['calc.cost_per_booked']).toBeUndefined();
    expect(noSpend['calc.blended_leads']).toBe(10); // pure-CRM value still live
  });

  it('resolver serves ledger values as live, sample otherwise', async () => {
    const live = { values: { 'crm.booked_jobs': 4 } };
    const real = await getMetric('crm.booked_jobs', 30, live);
    expect(real!.source).toBe('live');
    expect(real!.value).toBe(4);
    const other = await getMetric('crm.estimates_sent', 30, live);
    expect(other!.source).toBe('sample');
  });
});

describe('deals read → live values (GHL opportunities)', () => {
  const deals = [
    { value: 4200, won: true, wonAt: new Date(Date.now() - 5 * 86_400_000).toISOString() },
    { value: 1800, won: true, wonAt: new Date(Date.now() - 60 * 86_400_000).toISOString() }, // outside 30d
    { value: 2500, won: false, createdAt: new Date().toISOString() }, // open pipeline
    { value: 900, won: true }, // undated win — counts rather than silently dropped
  ];

  it('computes won/revenue/pipeline from the pipeline, respecting the window', async () => {
    const { dealsLiveValues } = await import('../src/metrics/crmledger.js');
    const v = dealsLiveValues(deals, 30);
    expect(v['crm.booked_jobs']).toBe(2); // recent win + undated win
    expect(v['crm.job_revenue']).toBe(5100);
    expect(v['crm.pipeline_value']).toBe(2500);
    expect(v['crm.avg_ticket']).toBe(2550);
  });

  it('returns {} with no deals so the webhook ledger stays authoritative', async () => {
    const { dealsLiveValues } = await import('../src/metrics/crmledger.js');
    expect(dealsLiveValues([], 30)).toEqual({});
  });
});
