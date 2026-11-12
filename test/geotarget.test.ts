import { describe, expect, it } from 'vitest';
import { judgeSearchLaunch } from '../src/agents/googlelaunch.js';
import {
  areaTerms,
  chooseGeoHits,
  geoReportProps,
  geoTargetGaql,
  locationCriterion,
  locationReadbackOk,
  parseGeoTargets,
  parseLocationCriteria,
  resolveAreas,
} from '../src/agents/geotarget.js';
import { buildSearchPlan } from '../src/agents/campaignplan.js';

const PHILADELPHIA = {
  results: [{
    geoTargetConstant: {
      resourceName: 'geoTargetConstants/1025197',
      id: '1025197',
      name: 'Philadelphia',
      canonicalName: 'Philadelphia,Pennsylvania,United States',
      countryCode: 'US',
      targetType: 'City',
      status: 'ENABLED',
    },
  }, {
    geoTargetConstant: {
      resourceName: 'geoTargetConstants/1020542',
      id: '1020542',
      name: 'Philadelphia',
      canonicalName: 'Philadelphia,Missouri,United States',
      countryCode: 'US',
      targetType: 'City',
    },
  }],
};

describe('geo target resolution', () => {
  it('builds a US city, county, or ZIP query with no date and no metrics', () => {
    const term = areaTerms('Philadelphia, PA')[0]!;
    expect(term).toMatchObject({ kind: 'city', name: 'Philadelphia', state: 'pennsylvania' });
    const gaql = geoTargetGaql(term);
    expect(gaql).toMatch(/FROM geo_target_constant/);
    expect(gaql).toMatch(/country_code = 'US'/);
    expect(gaql).toMatch(/target_type = 'City'/);
    expect(gaql).toMatch(/name = 'Philadelphia'/);
    expect(gaql).not.toMatch(/metrics|segments\.date/);
    const props = geoReportProps({ appName: 'googleAds', authId: 'apn', accountId: '3519644891', customerClientId: '9013698905', term });
    expect(props.accountId).toBe('3519644891');
    expect(props.customerClientId).toBe('9013698905');
    expect(props.resource).toBe('geo_target_constant');
    expect(props.segments).toEqual([]);
    expect(props).not.toHaveProperty('dateRange');
  });

  it('picks the Pennsylvania city from a geo_target_constant response', () => {
    const rows = parseGeoTargets(PHILADELPHIA);
    const picked = chooseGeoHits(areaTerms('Philadelphia, PA')[0]!, rows);
    expect(picked).toMatchObject({ id: '1025197', targetType: 'City' });
    expect(locationCriterion(picked as { id: string; name: string; state: string; targetType: 'City'; resourceName: string })).toEqual({ geoTargetConstant: 'geoTargetConstants/1025197' });
  });

  it('resolves a city and state, a county, and a ZIP from the published list', () => {
    expect(resolveAreas('Philadelphia, PA').targets.map((row) => row.id)).toEqual(['1025197']);
    expect(resolveAreas('Philadelphia County, PA').targets.map((row) => row.id)).toEqual(['9059180']);
    expect(resolveAreas('19103').targets.map((row) => row.id)).toEqual(['9007283']);
    expect(resolveAreas(['Philadelphia, PA', '19103']).targets.map((row) => row.id)).toEqual(['9007283', '1025197']);
  });

  it('does not guess when the city is ambiguous or unknown', () => {
    expect(resolveAreas('Philadelphia').targets).toEqual([]);
    expect(resolveAreas('Philadelphia').block).toMatch(/more than one US city/);
    expect(resolveAreas('Nowhereville, ZZ').targets).toEqual([]);
    expect(resolveAreas('Nowhereville, ZZ').block).toMatch(/did not match/);
    expect(resolveAreas('').block).toMatch(/city and state/);
  });

  it('reads location criteria back and requires Presence', () => {
    const found = parseLocationCriteria({
      ret: [
        { campaignCriterion: { resourceName: 'customers/9013698905/campaignCriteria/111~1025197', criterionId: '1025197', type: 'LOCATION', negative: false } },
        { campaignCriterion: { resourceName: 'customers/9013698905/campaignCriteria/111~55', criterionId: '55', type: 'KEYWORD', negative: true } },
      ],
    });
    expect(found).toEqual([{ id: '1025197', negative: false }]);
    const wanted = resolveAreas('Philadelphia, PA').targets;
    expect(locationReadbackOk(wanted, found, 'PRESENCE').ok).toBe(true);
    expect(locationReadbackOk(wanted, found, 'PRESENCE_OR_INTEREST').ok).toBe(false);
    expect(locationReadbackOk(wanted, [], 'PRESENCE').reason).toMatch(/did not show location Philadelphia/);
  });

  it('keeps Approve and launch off until a location matches, and puts the constant on the plan', () => {
    const ready = buildSearchPlan({
      businessName: 'Painters In Philly',
      trade: 'Painting',
      services: 'Interior painting',
      serviceAreas: 'Philadelphia, PA',
      phone: '2155550199',
      website: 'https://paintersinphilly.com',
      hours: '8am to 5pm',
      goal: 'Get more calls',
      dailyBudget: 20,
      jobsToAvoid: 'jobs, diy',
      keywordFocus: 'interior painting philadelphia',
    });
    expect(ready.locationBlock).toBe('');
    expect(ready.spec.geoTargets?.map((row) => row.id)).toEqual(['1025197']);
    expect(ready.sections.find((section) => section.id === 'locations')?.body).toMatch(/Presence only/);
    expect(ready.sections.find((section) => section.id === 'locations')?.body).toMatch(/1025197/);
    const blocked = buildSearchPlan({ ...{
      businessName: 'Painters',
      trade: 'Painting',
      services: 'Interior painting',
      phone: '2155550199',
      website: 'https://paintersinphilly.com',
      hours: '8am to 5pm',
      goal: 'Get more calls',
      dailyBudget: 20,
      jobsToAvoid: 'jobs',
      keywordFocus: 'interior painting',
    }, serviceAreas: 'Nowhereville, ZZ' });
    expect(blocked.locationBlock).toMatch(/Approve and launch stays off/);
    expect(blocked.spec.geoTargets).toEqual([]);
  });
});

describe('launch judge', () => {
  it('does not call a campaign launched when location targeting is missing', () => {
    const judged = judgeSearchLaunch([
      { step: 'Create daily budget ($20)', ok: true, resource: 'customers/1/campaignBudgets/1' },
      { step: 'Create campaign "Painting" (PAUSED)', ok: true, resource: 'customers/1/campaigns/9' },
      { step: 'Create ad group "Interior painting"', ok: true, resource: 'customers/1/adGroups/3' },
      { step: 'Add 3 keywords to "Interior painting"', ok: true },
      { step: 'Create responsive search ad in "Interior painting"', ok: true },
    ]);
    expect(judged.ok).toBe(false);
    expect(judged.missing).toContain('location targeting');
  });
});
