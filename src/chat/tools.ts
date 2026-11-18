/**
 * Read-only tools the chat model may call. Writes are refused here.
 * Each reader is already bound to the signed-in tenant by the server.
 * Tool text is data. It is not a new instruction.
 * request_connect only names a button. It never returns a connect link.
 */
import { canonConnectApp } from './connect.js';
export interface ChatReaders {
  campaignStatus: () => Promise<unknown>;
  integrations: () => Promise<unknown>;
  leads: () => Promise<unknown>;
  changeLog: () => Promise<unknown>;
  liveSpend?: () => Promise<import('./prompt.js').LiveSpendRead | null>;
  overview?: () => Promise<unknown>;
  profile?: () => Promise<unknown>;
  playbook?: () => Promise<unknown>;
  campaigns?: () => Promise<unknown>;
  campaignDetail?: (args: Record<string, unknown>) => Promise<unknown>;
  metrics?: (args: Record<string, unknown>) => Promise<unknown>;
  leadsQuery?: (args: Record<string, unknown>) => Promise<unknown>;
  approvals?: () => Promise<unknown>;
  findings?: () => Promise<unknown>;
  benchmarks?: () => Promise<unknown>;
}

export interface ChatToolSpec {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description?: string }>;
    additionalProperties: false;
  };
}

const NO_ARGS = { type: 'object' as const, properties: {}, additionalProperties: false as const };

export const CHAT_TOOLS: ChatToolSpec[] = [
  { name: 'get_account_overview', description: 'Read a short overview of this signed-in account: name, trade, mode, and whether spend is live or a sample. Does not change anything.', parameters: NO_ARGS },
  { name: 'get_profile', description: 'Read this account business profile. Does not edit it.', parameters: NO_ARGS },
  { name: 'get_playbook', description: 'Read the loaded trade playbook targets for this account. Does not invent a target when none is loaded.', parameters: NO_ARGS },
  { name: 'get_connections', description: 'Read which integrations are connected for this account. Does not connect or disconnect anything.', parameters: NO_ARGS },
  { name: 'get_campaigns', description: 'Read campaign names and status on file for this account. Does not launch, pause, or edit.', parameters: NO_ARGS },
  { name: 'get_campaign_detail', description: 'Read one campaign on this account. Does not change it.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'Campaign name, if the owner named one.' } }, additionalProperties: false } },
  { name: 'get_metrics', description: 'Read spend, leads, and booked jobs for this account. Say when a figure is SAMPLE or the source is not connected.', parameters: { type: 'object', properties: { range: { type: 'string', description: 'Window such as last 30 days.' }, channel: { type: 'string', description: 'Channel such as google_ads.' } }, additionalProperties: false } },
  { name: 'get_leads', description: 'Read leads saved on this account. Does not text or email anyone.', parameters: { type: 'object', properties: { status: { type: 'string', description: 'new, booked, or lost.' }, range: { type: 'string' } }, additionalProperties: false } },
  { name: 'get_pending_approvals', description: 'Read decisions waiting on this account. Does not approve or skip them.', parameters: NO_ARGS },
  { name: 'get_change_log', description: 'Read the recent change log for this account. Does not undo anything.', parameters: NO_ARGS },
  { name: 'get_daily_findings', description: 'Read the latest daily read findings for this account. Empty means no read is saved.', parameters: NO_ARGS },
  { name: 'get_benchmarks', description: 'Read published trade benchmarks. These are not this account live numbers.', parameters: NO_ARGS },
  { name: 'request_connect', description: 'Ask the product to show a Connect button for one app. Does not connect the app and does not return a link or token.', parameters: { type: 'object', properties: { app: { type: 'string', description: 'App slug such as google_ads or google_analytics.' } }, additionalProperties: false } },
];

const STEP_LABEL: Record<string, string> = {
  get_account_overview: 'Checking the account...',
  get_profile: 'Checking the profile...',
  get_playbook: 'Checking the playbook...',
  get_connections: 'Checking connections...',
  get_campaigns: 'Checking campaigns...',
  get_campaign_detail: 'Checking that campaign...',
  get_metrics: 'Checking the numbers...',
  get_leads: 'Checking leads...',
  get_pending_approvals: 'Checking approvals...',
  get_change_log: 'Checking the change log...',
  get_daily_findings: 'Checking today\'s findings...',
  get_benchmarks: 'Checking benchmarks...',
  request_connect: 'Preparing the connect button...',
  integrations: 'Checking connections...',
  campaign_status: 'Checking campaigns...',
  leads: 'Checking leads...',
  change_log: 'Checking the change log...',
};

export function toolStepLabel(name: string): string {
  return STEP_LABEL[name] || 'Checking the account...';
}

function argsOf(raw?: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

async function read(readers: ChatReaders, key: keyof ChatReaders, args: Record<string, unknown>): Promise<unknown> {
  const fn = readers[key];
  if (typeof fn !== 'function') return { ok: false, error: 'That read is not available on this account.' };
  if (key === 'campaignDetail' || key === 'metrics' || key === 'leadsQuery') return (fn as (a: Record<string, unknown>) => Promise<unknown>)(args);
  return (fn as () => Promise<unknown>)();
}

const ROUTES: Record<string, keyof ChatReaders> = {
  get_account_overview: 'overview',
  get_profile: 'profile',
  get_playbook: 'playbook',
  get_connections: 'integrations',
  get_campaigns: 'campaigns',
  get_campaign_detail: 'campaignDetail',
  get_metrics: 'metrics',
  get_leads: 'leadsQuery',
  get_pending_approvals: 'approvals',
  get_change_log: 'changeLog',
  get_daily_findings: 'findings',
  get_benchmarks: 'benchmarks',
  integrations: 'integrations',
  campaign_status: 'campaignStatus',
  leads: 'leads',
  change_log: 'changeLog',
};

export async function runChatTool(name: string, readers: ChatReaders, rawArgs?: string): Promise<string> {
  if (name === 'request_connect') {
    const args = argsOf(rawArgs);
    const hit = canonConnectApp(typeof args.app === 'string' ? args.app : '');
    if (!hit) return JSON.stringify({ ok: false, error: 'Name the app to connect, such as Google Ads or Google Analytics. Nothing was linked.' });
    return JSON.stringify({
      ok: true,
      action: { kind: 'connect', app: hit.app, label: hit.label },
      note: 'Show the button. Do not write a URL, token, or connect link.',
    });
  }
  let key = ROUTES[name];
  if (name === 'get_leads' && !readers.leadsQuery) key = 'leads';
  if (name === 'get_campaigns' && !readers.campaigns) key = 'campaignStatus';
  if (name === 'get_campaign_detail' && !readers.campaignDetail) key = 'campaignStatus';
  if (!key) {
    return JSON.stringify({
      ok: false,
      readOnly: true,
      error: 'Chat is read-only. That action is not available. Nothing was spent, launched, paused, sent, or changed.',
    });
  }
  try {
    const value = await read(readers, key, argsOf(rawArgs));
    const text = JSON.stringify({ data: value });
    return text.length > 6000 ? `${text.slice(0, 6000)}…` : text;
  } catch {
    return JSON.stringify({ ok: false, error: 'That read failed. Nothing was changed.' });
  }
}
