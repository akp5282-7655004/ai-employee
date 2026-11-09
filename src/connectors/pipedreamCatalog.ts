/**
 * Pipedream apps read from public catalog pages on 2026-11-07.
 * `ownerProject` is always unknown here: this process cannot see Akhil's
 * Pipedream project or which contractors have finished Connect.
 * A slug in this list is not a connected account.
 */

export type CatalogStatus = 'verified' | 'not_found';

export interface CampaignAction {
  available: boolean;
  /** Documented action key, when the catalog page lists one. */
  actionKey?: string;
  /** How a create stays off. Absent when the catalog page did not name a paused value. */
  pausedValue?: string;
  note: string;
}

export interface PipedreamAppRecord {
  product: string;
  slug: string | null;
  catalog: CatalogStatus;
  source: string;
  auth: string;
  scopes?: string[];
  campaign: CampaignAction;
  /** What this repository actually calls. */
  repoWiring: string;
  ownerProject: 'unknown';
}

export const CATALOG_READ_ON = '2026-11-07';

export const PIPEDREAM_APPS: PipedreamAppRecord[] = [
  {
    product: 'Google Ads',
    slug: 'google_ads',
    catalog: 'verified',
    source: 'https://pipedream.com/apps/google-ads.md',
    auth: 'OAuth, Pipedream-managed',
    scopes: ['email', 'profile', 'https://www.googleapis.com/auth/adwords'],
    campaign: {
      available: true,
      actionKey: 'google_ads-create-or-update-campaign',
      pausedValue: 'PAUSED',
      note: 'Create also needs google_ads-create-or-update-campaign-budget, then google_ads-create-or-update-ad-group, google_ads-create-or-update-keywords, and google_ads-create-responsive-search-ad. accountId is the login customer; customerClientId is the managed client. Status is an optional prop. Google enum PAUSED is the value Miles sends.',
    },
    repoWiring: 'PipedreamConnector.launchCampaign calls those five keys and google_ads-list-campaigns to verify. It forces status PAUSED.',
    ownerProject: 'unknown',
  },
  {
    product: 'TikTok Ads',
    slug: 'tiktok_ads_manager',
    catalog: 'verified',
    source: 'https://pipedream.com/apps/tiktok-ads-manager.md',
    auth: 'OAuth, Pipedream-managed. The catalog page I read did not list OAuth scope strings.',
    campaign: {
      available: true,
      actionKey: 'tiktok_ads_manager-create-or-update-campaign',
      pausedValue: 'DISABLE',
      note: 'Pipedream prop operationStatus is the status when created. TikTok campaign create docs (https://business-api.tiktok.com/portal/docs/create-a-campaign/v1.3) name DISABLE as disabled when created and ENABLE as enabled. Miles sends DISABLE only after a separate approval, and only for the signed-in user.',
    },
    repoWiring: 'POST /api/tiktok/launch calls tiktok_ads_manager-create-or-update-campaign with operationStatus DISABLE. It is not added to a $20 Search plan.',
    ownerProject: 'unknown',
  },
  {
    product: 'Meta Ads (Facebook and Instagram campaigns)',
    slug: null,
    catalog: 'not_found',
    source: 'Rechecked 2026-11-09. https://pipedream.com/apps/facebook-ads returned 404. https://pipedream.com/apps/facebook-graph-api lists zero actions. facebook_pages creates Page posts, not ads.',
    auth: 'No campaign app verified.',
    campaign: {
      available: false,
      note: 'No prebuilt create-campaign action was found. facebook_graph_api is an OAuth app with zero actions; its proxy could reach Graph, and Miles does not use that proxy. META_* env tokens are not a per-tenant Pipedream account.',
    },
    repoWiring: 'Launch is refused. Older Graph code in PipedreamConnector.launchMetaCampaign returns before any POST. Reads that pass the slug "facebook" are not a verified catalog slug (pipedream.com/apps/facebook.md was 404).',
    ownerProject: 'unknown',
  },
  {
    product: 'Facebook Pages',
    slug: 'facebook_pages',
    catalog: 'verified',
    source: 'https://pipedream.com/apps/facebook-pages.md',
    auth: 'OAuth, Pipedream-managed',
    scopes: ['email', 'public_profile', 'pages_manage_engagement', 'pages_manage_posts', 'pages_show_list', 'pages_read_user_content', 'pages_read_engagement', 'business_management'],
    campaign: {
      available: false,
      actionKey: 'facebook_pages-create-post',
      note: 'Creates a Page post, not an ad campaign. ads_management is not in the published scope list.',
    },
    repoWiring: 'Not used for campaign create.',
    ownerProject: 'unknown',
  },
  {
    product: 'Instagram',
    slug: null,
    catalog: 'not_found',
    source: 'https://pipedream.com/apps/instagram.md and instagram-business.md returned 404.',
    auth: 'No app page verified.',
    campaign: {
      available: false,
      note: 'No Instagram campaign action was verified. Do not treat a Facebook Page connection as an Instagram ad account.',
    },
    repoWiring: 'Social metrics try the slug "instagram". That slug was not verified.',
    ownerProject: 'unknown',
  },
  {
    product: 'GoHighLevel',
    slug: 'highlevel_oauth',
    catalog: 'verified',
    source: 'https://pipedream.com/apps/highlevel-oauth.md',
    auth: 'OAuth, Pipedream-managed',
    scopes: ['contacts.write', 'contacts.readonly', 'opportunities.write', 'opportunities.readonly', 'conversations/message.write'],
    campaign: {
      available: false,
      actionKey: 'highlevel_oauth-upsert-contact',
      note: 'This is a CRM upsert, not an ad campaign. The catalog lists six actions. Upsert props are locationId, name, email, phone, additionalOptions. There is no separate opportunity-upsert action in that list.',
    },
    repoWiring: 'Journey lead ingest calls highlevel_oauth-upsert-contact through the existing Pipedream runAction only when this user has connected highlevel_oauth. The older gohighlevel slug is still used by fuzzy SMS discovery and was not re-verified as the OAuth app.',
    ownerProject: 'unknown',
  },
];

export function appByProduct(product: string): PipedreamAppRecord | undefined {
  return PIPEDREAM_APPS.find((a) => a.product === product);
}

/** Names only. Values are never returned. */
export function pipedreamConfigPresence(env: Record<string, string | undefined>): {
  connector: string;
  environment: string;
  projectIdSet: boolean;
  clientIdSet: boolean;
  clientSecretSet: boolean;
  accountsConnected: 'unknown';
} {
  return {
    connector: env.CONNECTOR === 'pipedream' ? 'pipedream' : 'mock',
    environment: env.PIPEDREAM_ENVIRONMENT === 'production' ? 'production' : 'development-or-unset',
    projectIdSet: !!env.PIPEDREAM_PROJECT_ID,
    clientIdSet: !!env.PIPEDREAM_CLIENT_ID,
    clientSecretSet: !!env.PIPEDREAM_CLIENT_SECRET,
    accountsConnected: 'unknown',
  };
}
