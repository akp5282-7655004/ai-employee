import { describe, expect, it } from 'vitest';
import { buildCampaignSpec, deriveServiceLines } from '../src/agents/campaign.js';
import { judgeEnableReadback, parseGoogleStatuses } from '../src/agents/enablecheck.js';
import { enforceRulebook, housekeepingProposals, nextBidStage, RULEBOOK_DEFAULTS } from '../src/agents/rulebook.js';

describe('campaign rulebook', () => {
  it('does not build the old junk ad group or quote keywords', () => {
    const names = deriveServiceLines('HOUSE PAINTING, FREE CUSTOM QUOTE, Slide title, LOCATION', 'Painting');
    expect(names.join(' ')).not.toMatch(/FREE CUSTOM|SLIDE|LOCATION/);
    expect(names.some((name) => name === 'HOUSE PAINTING')).toBe(false);
    const spec = enforceRulebook(buildCampaignSpec(
      { dailyBudget: 20, finalUrl: 'https://paintersinphilly.com', locations: ['Philadelphia'] },
      { business: "Philadelphia's #1 Painters, Painters In Philly", trade: 'Painting', city: 'Philadelphia', services: 'HOUSE PAINTING, FREE CUSTOM QUOTE' },
    ), { trade: 'painting', city: 'Philadelphia', phone: '2155550199', gbpUrl: 'https://maps.example/gbp' }).spec;
    const text = spec.adGroups.flatMap((group) => [group.name, ...group.keywords.map((keyword) => keyword.text), ...group.rsa.headlines]).join(' ');
    expect(text).not.toMatch(/FREE CUSTOM QUOTE|HOUSE PAINTING|best house painting|house painting quote/);
    expect(spec.adGroups.every((group) => group.keywords.every((keyword) => keyword.match !== 'broad'))).toBe(true);
    expect(spec.adGroups.every((group) => group.rsa.headlines.length === 15 && group.rsa.descriptions.length === 4)).toBe(true);
    expect(spec.networks).toEqual(['Google Search']);
    expect(spec.bidPlan).toMatchObject({ stage: 'MAXIMIZE_CLICKS', maxCpc: RULEBOOK_DEFAULTS.maxCpc });
    expect(spec.targeting).toMatchObject({ presence: 'PRESENCE', radiusMiles: 15, searchPartners: false, display: false });
    expect(spec.callAsset?.phone).toBe('2155550199');
    expect(spec.locationAsset?.gbpUrl).toMatch(/^https:/);
    expect(spec.negatives).toEqual(expect.arrayContaining(['jobs', 'diy', 'free', 'sherwin']));
  });

  it('auto-fixes broad match and blocks an ad group that has no real keywords', () => {
    const built = buildCampaignSpec({ dailyBudget: 20, finalUrl: 'https://paintersinphilly.com' }, { trade: 'Painting', city: 'Philadelphia', services: 'Interior painting' });
    built.adGroups[0]!.keywords = [{ text: 'best free quote', match: 'broad' }];
    const ruled = enforceRulebook(built, { trade: 'painting', city: 'Philadelphia' });
    expect(ruled.blocks.join(' ')).toMatch(/no close-variant keywords/);
    expect(ruled.spec.adGroups[0]!.keywords).toEqual([]);
  });

  it('blocks a missing landing page in plain language', () => {
    const built = buildCampaignSpec({ dailyBudget: 20, finalUrl: 'https://example.com' }, { trade: 'Painting', city: 'Philadelphia', services: 'Interior painting' });
    built.finalUrl = '';
    const ruled = enforceRulebook(built, { city: 'Philadelphia' });
    expect(ruled.blocks.join(' ')).toMatch(/Crawl/);
    expect(ruled.blocks.join(' ')).not.toMatch(/Sitelink needs/);
  });

  it('labels bid stages as defaults', () => {
    expect(nextBidStage({ conversions: 0 }).stage).toBe('MAXIMIZE_CLICKS');
    expect(nextBidStage({ conversions: RULEBOOK_DEFAULTS.conversionsBeforeMaximizeConversions }).reason).toMatch(/not a benchmark/);
    expect(nextBidStage({ conversions: RULEBOOK_DEFAULTS.conversionsBeforeTargetCpa, observedCpa: 42 }).stage).toBe('TARGET_CPA');
  });

  it('queues keyword and search-term proposals without treating them as a benchmark', () => {
    const rows = housekeepingProposals({
      searchTerms: [{ term: 'diy paint', cost: RULEBOOK_DEFAULTS.searchTermNegativeSpend, conversions: 0 }],
      keywords: [{ text: 'house painting quote', cost: RULEBOOK_DEFAULTS.keywordPauseSpend, conversions: 0 }],
      qualityScores: [{ text: 'interior painting', score: 3, components: ['expected CTR below average'] }],
    });
    expect(rows.map((row) => row.title).join(' ')).toMatch(/Negative: diy paint/);
    expect(rows.map((row) => row.title).join(' ')).toMatch(/Pause keyword/);
    expect(rows.map((row) => row.reason).join(' ')).toMatch(/not a benchmark/);
    expect(rows.map((row) => row.reason).join(' ')).toMatch(/expected CTR below average/);
  });
});

describe('enable read-back', () => {
  it('requires the campaign, every ad group, and every ad to read back as enabled', () => {
    expect(judgeEnableReadback({ campaign: 'ENABLED', adGroups: ['ENABLED'], ads: ['ENABLED'], note: '' }).enabled).toBe(true);
    expect(judgeEnableReadback({ campaign: 'ENABLED', adGroups: ['PAUSED'], ads: ['ENABLED'], note: '' }).reason).toMatch(/ad group/);
    expect(judgeEnableReadback({ campaign: 'ENABLED', adGroups: ['ENABLED'], ads: [], note: '' }).reason).toMatch(/ad/);
    expect(judgeEnableReadback({ campaign: 'UNKNOWN', adGroups: ['ENABLED'], ads: ['ENABLED'], note: 'No status was read back.' }).enabled).toBe(false);
  });

  it('reads statuses from a list payload and leaves missing rows unknown', () => {
    const read = parseGoogleStatuses({
      campaigns: [{ id: '9', status: 'ENABLED' }],
      adGroups: [{ resourceName: 'customers/1/adGroups/3', status: 'PAUSED' }],
    }, { campaignId: '9', adGroupIds: ['3'], adIds: ['8'] });
    expect(read.campaign).toBe('ENABLED');
    expect(read.adGroups).toEqual(['PAUSED']);
    expect(read.ads).toEqual(['UNKNOWN']);
  });
});
