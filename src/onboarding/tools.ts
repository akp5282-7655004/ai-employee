/**
 * Setup progress. Miles needs a few real sources before the dashboard
 * is worth opening. A website on the profile counts, the same as an app.
 */

export const REQUIRED_TOOLS = 3;

export interface SetupTool {
  id: string;
  label: string;
  connected: boolean;
}

const GROUPS: { id: string; label: string; apps: string[] }[] = [
  { id: 'google_ads', label: 'Google Ads', apps: ['google_ads'] },
  { id: 'gbp', label: 'Google Business Profile', apps: ['google_my_business', 'gmb'] },
  { id: 'meta', label: 'Facebook or Instagram', apps: ['facebook_pages', 'facebook', 'instagram', 'facebook_graph_api'] },
  { id: 'ghl', label: 'GoHighLevel', apps: ['gohighlevel', 'highlevel_oauth', 'highlevel', 'leadconnector'] },
  { id: 'website', label: 'Website', apps: [] },
];

export interface SetupProgress {
  connected: number;
  required: number;
  ready: boolean;
  items: SetupTool[];
  headline: string;
  detail: string;
}

export function setupProgress(args: { apps?: string[]; website?: string }): SetupProgress {
  const apps = new Set((args.apps || []).map((app) => app.toLowerCase()));
  const website = (args.website || '').trim();
  const items = GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    connected: group.id === 'website' ? website.length > 0 : group.apps.some((app) => apps.has(app)),
  }));
  const connected = items.filter((item) => item.connected).length;
  const shown = Math.min(connected, REQUIRED_TOOLS);
  return {
    connected,
    required: REQUIRED_TOOLS,
    ready: connected >= REQUIRED_TOOLS,
    items,
    headline: `${shown} of ${REQUIRED_TOOLS} connected`,
    detail: 'Connect at least 3 tools so Miles can pull real data and show you something useful. Google Ads, your Google Business Profile, Facebook, GoHighLevel, or your website all count.',
  };
}
