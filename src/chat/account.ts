/**
 * Account questions are reads. They are answered from the snapshot and do
 * not call the model, so they do not draw credits.
 */
import { BANDS } from '../billing/credits.js';
import { contradictoryAsk } from '../qa/ownerrows.js';
import { parseConnectAsk } from './connect.js';
import { unlockLine, type AccountFacts } from './facts.js';
import { asksMode } from './prompt.js';
import type { AccountSnapshot } from './snapshot.js';

function dollars(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? `$${rounded}` : `$${rounded.toFixed(2)}`;
}

/** Connection, credit, and cap questions. Narrow on purpose so other reads can still use the model. */
export function asksOwnerStatus(text: string): boolean {
  const q = text.trim().toLowerCase();
  if (/^(what'?s|whats|what is|what are) (currently )?(connected|hooked up)\b/.test(q)) return true;
  if (/\b(which|what)( one)? of (my )?(integrations|tools|apps|accounts)\b/.test(q) && /\bconnected\b/.test(q)) return true;
  if (/\b(integrations|tools|apps) (that are |are )?connected\b/.test(q)) return true;
  if (/^is [\w\s]+ connected\??$/.test(q)) return true;
  if (/\b(how many credits|credit balance|credits do i have|my credits)\b/.test(q)) return true;
  if (/\b(daily cap|monthly ceiling|my caps|spend cap)\b/.test(q)) return true;
  return false;
}

/** Work that spends credits: writing ads, launching, building campaigns, generating creatives. */
export function asksSpendWork(text: string): boolean {
  const q = text.toLowerCase();
  return /\b(write|draft|generate|design|create|build|launch|set up|setup)\b/.test(q)
    && /\b(ad|ads|campaign|campaigns|creative|creatives|copy|image|video)\b/.test(q);
}

export function ownerStatusAnswer(snapshot: AccountSnapshot, question: string): string {
  const q = question.toLowerCase();
  const facts = snapshot.account;
  if (/\b(how many credits|credit balance|credits do i have|my credits)\b/.test(q)) {
    const head = facts.creditsRemaining == null
      ? 'I do not have a credit balance on this read.'
      : `You have ${dollars(facts.creditsRemaining)} in credits.`;
    return `${head} ${unlockLine(facts)}`.trim();
  }
  if (/\b(daily cap|monthly ceiling|my caps|spend cap)\b/.test(q)) {
    const caps = snapshot.miles.caps;
    if (!caps) return 'Caps are not set, so I will not spend.';
    return `The daily cap is ${dollars(caps.dailyBudget)}, the max change is ${caps.maxChangePct}% a day, and the monthly ceiling is ${dollars(caps.monthlyCeiling)}.`;
  }
  if (/^is [\w\s]+ connected\??$/.test(q) && /\bgoogle\b/.test(q)) return googleStatus(snapshot, q);
  if (/^is [\w\s]+ connected\??$/.test(q)) return namedToolStatus(snapshot, q);
  return connectionAnswer(facts);
}

function countRule(facts: AccountFacts): string {
  const line = unlockLine(facts);
  const unlocked = facts.launchGranted || facts.unlockConnected >= facts.unlockRequired
    ? ' $100 in credits is unlocked.'
    : '';
  const extra = facts.connectedNames.filter((name) => !facts.unlockNames.includes(name));
  if (!extra.length) return `${line}${unlocked}`.trim();
  const verb = extra.length === 1 ? 'is connected and does not count' : 'are connected and do not count';
  return `${line}${unlocked} ${extra.join(' and ')} ${verb} toward the ${facts.unlockRequired}.`.trim();
}

function connectionAnswer(facts: AccountFacts): string {
  const names = facts.connectedNames;
  const head = names.length === 0
    ? 'Nothing is connected yet.'
    : names.length === 1
      ? `${names[0]} is connected.`
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} are connected.`;
  return `${head} ${countRule(facts)}`.trim();
}

function has(facts: AccountFacts, label: string): boolean {
  return facts.connectedNames.includes(label);
}

function googleStatus(snapshot: AccountSnapshot, q: string): string {
  const facts = snapshot.account;
  // Same name list as "what's connected". Google readiness is a different check and is not used here.
  const ads = has(facts, 'Google Ads');
  const gbp = has(facts, 'Google Business Profile');
  const analytics = has(facts, 'Google Analytics');
  if (/analytics|\bga4\b/.test(q)) {
    return `${analytics ? 'Google Analytics is connected.' : 'Google Analytics is not connected.'} ${countRule(facts)}`.trim();
  }
  if (/business profile|\bgbp\b|\bgmb\b/.test(q)) {
    return `${gbp ? 'Google Business Profile is connected.' : 'Google Business Profile is not connected.'} ${countRule(facts)}`.trim();
  }
  if (/\bads\b/.test(q)) {
    return `${ads ? 'Google Ads is connected.' : 'Google Ads is not connected.'} ${countRule(facts)}`.trim();
  }
  const lines = [
    ads ? 'Google Ads is connected.' : 'Google Ads is not connected.',
    gbp ? 'Google Business Profile is connected.' : 'Google Business Profile is not connected.',
    analytics ? 'Google Analytics is connected.' : 'Google Analytics is not connected.',
  ];
  return `${lines.join(' ')} ${countRule(facts)}`.trim();
}

function namedToolStatus(snapshot: AccountSnapshot, q: string): string {
  const facts = snapshot.account;
  const known = facts.connectedNames.find((name) => q.includes(name.toLowerCase()));
  if (known) return `${known} is connected. ${countRule(facts)}`.trim();
  return connectionAnswer(facts);
}

export function spendWorkReply(snapshot: AccountSnapshot, question: string): string {
  const q = question.toLowerCase();
  const job = /\blaunch\b/.test(q)
    ? 'launch a campaign'
    : /\b(creative|image|video)\b/.test(q)
      ? 'generate a creative'
      : /\b(write|draft)\b/.test(q)
        ? 'write ads'
        : 'build that campaign';
  const plan = `Or pick a plan on Plan & Credits. Plans start at $${BANDS[0]!.monthlyPrice} a month.`;
  return `I can't ${job} until there are credits to work with. ${unlockLine(snapshot.account)} ${plan}`;
}

/** True when this question is a read the snapshot can answer with no model call. */
export function answersWithoutModel(question: string): boolean {
  if (contradictoryAsk(question)) return true;
  if (parseConnectAsk(question)) return true;
  if (asksOwnerStatus(question)) return true;
  if (asksMode(question)) return true;
  return false;
}
