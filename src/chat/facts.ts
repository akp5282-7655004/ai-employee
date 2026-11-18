/**
 * Connected-tool names and the launch-credit count. No model, no network.
 */
import { LAUNCH_GRANT } from '../billing/credits.js';
import { REQUIRED_TOOLS, setupProgress } from '../onboarding/tools.js';

export interface AccountFacts {
  connectedNames: string[];
  unlockNames: string[];
  unlockConnected: number;
  unlockRequired: number;
  creditsRemaining: number | null;
}

const APP_NAMES: Record<string, string> = {
  google_ads: 'Google Ads',
  google_analytics: 'Google Analytics',
  google_my_business: 'Google Business Profile',
  gmb: 'Google Business Profile',
  gohighlevel: 'GoHighLevel',
  highlevel: 'GoHighLevel',
  highlevel_oauth: 'GoHighLevel',
  leadconnector: 'GoHighLevel',
  facebook: 'Facebook',
  facebook_pages: 'Facebook',
  facebook_graph_api: 'Facebook',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  gmail: 'Gmail',
};

export function accountFacts(apps: string[], website: string, creditsRemaining: number | null): AccountFacts {
  const progress = setupProgress({ apps, website });
  const connectedNames: string[] = [];
  for (const app of apps) {
    const label = APP_NAMES[app] || app.replace(/_/g, ' ');
    if (label && !connectedNames.includes(label)) connectedNames.push(label);
  }
  if (website.trim() && !connectedNames.includes('Website')) connectedNames.push('Website');
  return {
    connectedNames,
    unlockNames: progress.items.filter((item) => item.connected).map((item) => item.label),
    unlockConnected: progress.connected,
    unlockRequired: progress.required || REQUIRED_TOOLS,
    creditsRemaining,
  };
}

export function unlockLine(facts: AccountFacts): string {
  const n = facts.unlockConnected;
  const need = facts.unlockRequired;
  const left = Math.max(0, need - n);
  const names = facts.unlockNames.join(', ');
  if (n <= 0) return `You have 0 of ${need} tools connected. Connect ${need} to unlock $${LAUNCH_GRANT} in credits.`;
  if (left === 0) return `You have ${n} of ${need} tools connected${names ? `: ${names}` : ''}.`;
  const more = left === 1 ? '1 more' : `${left} more`;
  return `You have ${n} of ${need} tools connected: ${names || 'your tools'}. Connect ${more} to unlock $${LAUNCH_GRANT} in credits.`;
}
