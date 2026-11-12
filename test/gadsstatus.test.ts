import { describe, expect, it } from 'vitest';
import { PipedreamConnector } from '../src/connectors/pipedream.js';
import type { Config } from '../src/config.js';

const CUSTOMER = '1234567890';

function client(opts?: { missing?: boolean; lag?: boolean }) {
  const queries: string[] = [];
  const sent: Record<string, unknown>[] = [];
  let reports = 0;
  const components = [
    { key: 'google_ads-list-account-id-options', configurableProps: [{ type: 'app', name: 'googleAds' }] },
    { key: 'google_ads-list-customer-clients', configurableProps: [{ type: 'app', name: 'googleAds' }, { name: 'accountId' }] },
    { key: 'google_ads-create-or-update-campaign', configurableProps: [{ type: 'app', name: 'googleAds' }] },
    { key: 'google_ads-create-or-update-ad-group', configurableProps: [{ type: 'app', name: 'googleAds' }] },
    { key: 'google_ads-list-campaigns', configurableProps: [{ type: 'app', name: 'googleAds' }] },
    { key: 'google_ads-create-report', configurableProps: [{ type: 'app', name: 'googleAds' }, { name: 'query' }] },
  ];
  return {
    queries,
    sent,
    pd: {
      accounts: {
        list: async () => ({ data: [{ id: 'apn_1', app: { nameSlug: 'google_ads' }, healthy: true, name: 'Google' }] }),
      },
      actions: {
        list: async () => ({ data: components }),
        run: async (req: { id?: string; configuredProps?: { query?: string } }) => {
          if (req.id === 'google_ads-list-account-id-options') return { ret: [{ value: CUSTOMER }] };
          if (req.id === 'google_ads-list-customer-clients') return { ret: [] };
          if (req.id === 'google_ads-create-or-update-campaign' && opts?.missing) {
            throw new Error('Google 400 mutateError RESOURCE_NOT_FOUND on operations[0].update.resource_name');
          }
          if (req.id === 'google_ads-list-campaigns') {
            return { ret: { results: [{ campaign: { id: '9', resourceName: 'customers/1/campaigns/9', status: 'ENABLED' } }] } };
          }
          if (req.id === 'google_ads-create-report') {
            reports += 1;
            sent.push((req.configuredProps || {}) as Record<string, unknown>);
            if (req.configuredProps?.query) queries.push(req.configuredProps.query);
            const lag = opts?.lag && reports < 3;
            return {
              ret: {
                results: [{
                  campaign: { id: '9', status: 'ENABLED' },
                  adGroup: { id: '3', status: lag ? 'PAUSED' : 'ENABLED' },
                  adGroupAd: { resourceName: 'customers/1/adGroupAds/3~8', status: lag ? 'PAUSED' : 'ENABLED', ad: { id: '8' } },
                }],
              },
            };
          }
          return { ret: { resourceName: 'customers/1/campaigns/9' } };
        },
      },
    },
  };
}

describe('Google enable read-back', () => {
  it('reads ad group and ad status, not only the campaign list', async () => {
    const fake = client();
    const connector = new PipedreamConnector({ connector: 'pipedream', pipedream: { environment: 'production', projectId: 'p', clientId: 'c', clientSecret: 's' } } as Config);
    (connector as unknown as { client: unknown }).client = fake.pd;
    const turned = await connector.setGoogleCampaignStatus('u', {
      campaignResource: 'customers/1/campaigns/9',
      status: 'ENABLED',
      adGroupResources: ['customers/1/adGroups/3'],
      adResources: ['customers/1/ads/8'],
    });
    expect(fake.sent.some((props) => props.resource === 'ad_group' && Array.isArray(props.segments) && (props.segments as unknown[]).length === 0 && !('dateRange' in props) && !('metrics' in props))).toBe(true);
    expect(fake.sent.some((props) => props.resource === 'ad_group_ad')).toBe(true);
    expect(turned.readback?.adGroups).toEqual(['ENABLED']);
    expect(turned.readback?.ads).toEqual(['ENABLED']);
    expect(turned.ok).toBe(true);
    expect(turned.note).toMatch(/ad groups/);
  });

  it('retries while the ad group read still shows the old status', async () => {
    const fake = client({ lag: true });
    const connector = new PipedreamConnector({ connector: 'pipedream', pipedream: { environment: 'production', projectId: 'p', clientId: 'c', clientSecret: 's' } } as Config);
    (connector as unknown as { client: unknown }).client = fake.pd;
    const turned = await connector.setGoogleCampaignStatus('u', {
      campaignResource: 'customers/1/campaigns/9',
      status: 'ENABLED',
      adGroupResources: ['customers/1/adGroups/3'],
      adResources: ['customers/1/adGroupAds/3~8'],
    });
    expect(fake.sent.length).toBeGreaterThan(2);
    expect(turned.readback?.adGroups).toEqual(['ENABLED']);
    expect(turned.ok).toBe(true);
  });

  it('says the campaign is gone when Google returns RESOURCE_NOT_FOUND', async () => {
    const fake = client({ missing: true });
    const connector = new PipedreamConnector({ connector: 'pipedream', pipedream: { environment: 'production', projectId: 'p', clientId: 'c', clientSecret: 's' } } as Config);
    (connector as unknown as { client: unknown }).client = fake.pd;
    const turned = await connector.setGoogleCampaignStatus('u', { campaignResource: 'customers/1/campaigns/9', status: 'PAUSED' });
    expect(turned.missing).toBe(true);
    expect(turned.note).toMatch(/no longer in the Google Ads account/);
    expect(turned.note).toMatch(/cleared/);
    expect(fake.queries).toEqual([]);
  });
});
