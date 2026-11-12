/**
 * The playbooks this tenant can open from the sidebar.
 * Built from saved setup and local counters. No network, no invented results.
 */

export interface ActivePlaybook {
  id: string;
  title: string;
  status: string;
  runs: string;
  budget: string;
  results: string;
}

export interface ActivePlaybookInput {
  trade?: string;
  business?: string;
  /** Saved Google Search plan title, when a plan exists. */
  planTitle?: string | null;
  /** none | paused | enabled, from the Miles file. */
  activation?: string | null;
  dailyBudget?: number | null;
  monthlyCeiling?: number | null;
  /** Trailing read. Null when no Google row is stored. */
  spend?: number | null;
  leads?: number | null;
  speedOn?: boolean;
  speedToday?: number | null;
  speedTotal?: number | null;
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

function tradeWord(trade?: string): string {
  const t = (trade || '').toLowerCase();
  if (t.includes('paint')) return 'painting';
  if (t.includes('plumb')) return 'plumbing';
  if (t.includes('hvac') || t.includes('heat') || t.includes('cool')) return 'HVAC';
  if (t.includes('roof')) return 'roofing';
  if (t.includes('electric')) return 'electrical';
  return (trade || '').trim();
}

export function activePlaybooks(input: ActivePlaybookInput): ActivePlaybook[] {
  const trade = tradeWord(input.trade);
  const who = (input.business || '').trim() || 'this business';
  const title = trade ? `Google Search ${trade} playbook` : (input.planTitle || 'Google Search playbook');
  const activation = input.activation === 'enabled' ? 'enabled' : input.activation === 'paused' ? 'paused' : 'not started';
  const status = activation === 'enabled'
    ? 'Running'
    : activation === 'paused'
      ? 'Paused'
      : input.planTitle
        ? 'Saved, not started'
        : 'Not started';
  const daily = input.dailyBudget != null && input.dailyBudget > 0 ? input.dailyBudget : null;
  const month = input.monthlyCeiling != null && input.monthlyCeiling > 0 ? input.monthlyCeiling : null;
  const budget = daily
    ? `${money(daily)} a day${month ? `, ${money(month)} a month` : ''}`
    : 'No daily budget saved';
  const results = input.spend == null && input.leads == null
    ? 'No live Google Ads results are stored yet.'
    : `${money(input.spend || 0)} spend and ${input.leads || 0} lead${(input.leads || 0) === 1 ? '' : 's'} in the last 30 days.`;
  const runs = trade
    ? `Miles builds one paused Google Search campaign for ${who} around ${trade}. It does not turn the campaign on or spend until you approve it in your current mode.`
    : `Miles builds one paused Google Search campaign for ${who}. It does not turn the campaign on or spend until you approve it in your current mode.`;

  const today = input.speedToday ?? 0;
  const total = input.speedTotal ?? 0;
  return [
    { id: 'google-search', title, status, runs, budget, results },
    {
      id: 'speed-to-lead',
      title: 'Speed-to-lead',
      status: input.speedOn ? 'On' : 'Off',
      runs: 'When a new lead or a missed call comes in, Miles drafts a text back in seconds. It sends only when this is on and GoHighLevel is connected.',
      budget: 'No ad spend',
      results: `${today} answered today, ${total} in total. These counts are from this account, not a sample.`,
    },
  ];
}
