/**
 * Pull a campaign request out of plain speech. This does not create,
 * launch, or spend. Phase 2 is what would run a saved intent.
 */

export interface AgentIntent {
  channel: 'google_ads' | 'meta' | null;
  locations: string[];
  dailyBudget: number | null;
  services: string[];
  missing: 'channel' | 'location' | 'budget' | 'services' | null;
  suggestion: string | null;
}

const ACTION = /\b(set up|setup|launch|create|start|build|run)\b/i;
const ADS = /\b(google ads|meta ads|facebook ads|campaign|ads)\b/i;

function servicesFrom(text: string): string[] {
  const match = text.match(/\bfor\s+((?:interior|cabinet|exterior|house|commercial|storm|drain)[^.]*)/i);
  if (!match?.[1]) return [];
  const phrase = match[1].replace(/\s+at\s+\$?\d.*$/i, '').trim();
  const noun = phrase.match(/painting|repair|cleaning|roofing/i)?.[0] || '';
  return phrase.split(/\s+and\s+/i).map((part) => {
    const bit = part.trim().replace(/[.,]$/, '');
    if (!bit) return '';
    if (noun && !new RegExp(noun, 'i').test(bit)) return `${bit} ${noun}`.toLowerCase();
    return bit.toLowerCase();
  }).filter(Boolean);
}

export function parseActionIntent(text: string): AgentIntent | null {
  const raw = text.trim();
  if (!ACTION.test(raw) || !ADS.test(raw)) return null;
  const channel = /\bmeta\b|\bfacebook\b/i.test(raw) && !/\bgoogle\b/i.test(raw) ? 'meta' : (/\bgoogle\b/i.test(raw) ? 'google_ads' : null);
  const money = raw.match(/\$(\d+(?:\.\d+)?)/) || raw.match(/\b(\d+(?:\.\d+)?)\s*(?:dollars?\s*)?(?:a|per)\s*day\b/i);
  const dailyBudget = money ? Number(money[1]) : null;
  const place = raw.match(/\b(?:for|in)\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?)(?:\s+at\b|\s+for\b|,|\.)/);
  const locations = place?.[1] ? [place[1].trim()] : [];
  const services = servicesFrom(raw);
  let missing: AgentIntent['missing'] = null;
  let suggestion: string | null = null;
  if (!channel) { missing = 'channel'; suggestion = 'I would start with Google Ads.'; }
  else if (!locations.length) { missing = 'location'; suggestion = 'I would use your saved service area.'; }
  else if (dailyBudget == null) { missing = 'budget'; suggestion = 'I would use $30 a day.'; }
  else if (!services.length) { missing = 'services'; suggestion = 'I would use the services on your profile.'; }
  return { channel, locations, dailyBudget, services, missing, suggestion };
}

export function intentReply(intent: AgentIntent, business: string): { text: string; ready: boolean } {
  const name = business || 'this business';
  if (intent.missing) {
    const ask = intent.missing === 'channel'
      ? `Which channel should I plan for ${name}?`
      : intent.missing === 'location'
        ? 'Which area should this cover?'
        : intent.missing === 'budget'
          ? 'What daily budget should I use?'
          : 'Which services should the ads cover?';
    return { ready: false, text: `${ask} ${intent.suggestion || ''}`.trim() };
  }
  const channel = intent.channel === 'meta' ? 'Meta' : 'Google Ads';
  const services = intent.services.join(' and ');
  const text = [
    `Here is the plan I heard for ${name}. Nothing was created and nothing was spent.`,
    `${channel} for ${intent.locations.join(', ')}, $${intent.dailyBudget} a day, covering ${services}.`,
    'Building actions arrives in the next update.',
  ].join(' ');
  return { ready: true, text };
}
