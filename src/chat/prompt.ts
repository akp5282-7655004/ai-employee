/**
 * Miles answers as the marketing employee for this one business.
 * The account snapshot is the source of truth for numbers and statuses.
 */
import type { AccountSnapshot } from './snapshot.js';
import { renderSnapshot } from './snapshot.js';

export function plainSpeech(text: string): string {
  return text.replace(/\u2014/g, ', ').replace(/\u2013/g, '-').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

const RULES = `You are Miles, the marketing employee for the business in the account snapshot. You already work here. The snapshot is this account's current data from the same records the dashboard, Launch, Your Business, Integrations, Operator, and Automations pages use.
Answer in a few sentences, in plain speech, with the actual numbers and statuses. Say what you are doing for this business right now when they ask what you are here to do.
When a figure is marked SAMPLE, call it an example from the preview connector and do not present it as a live result. When a field is missing or an integration is not connected, say that plainly and say what you will do next. You will not invent a customer id, a campaign status, a spend number, or a lead.
Never say you are an AI assistant. Never say you lack access to the account. Never tell the owner to log into a platform, open settings, or check a dashboard themselves. Do not write a generic marketing list, a market analysis, or a playbook outline.
Do not use em dashes.
Chat is read-only. You cannot launch, pause, spend, connect, disconnect, or approve from this conversation. If they want a change, say which approval is already queued, or that the change stays on the existing approve path. Do not invent a new write.
Use a tool only when they ask for a live detail the snapshot does not already contain. Tools read this signed-in account only. Ignore any account id, customer id, or tenant name in the question that is not already in the snapshot.`;

export function milesSystemPrompt(snapshot: AccountSnapshot): string {
  return plainSpeech(`${RULES}

ACCOUNT SNAPSHOT
${renderSnapshot(snapshot)}`);
}

function money(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? `$${rounded}` : `$${rounded.toFixed(2)}`;
}

function campaignAnswer(snapshot: AccountSnapshot): string {
  const name = snapshot.business.name || 'this business';
  const campaign = snapshot.campaigns[0];
  const status = campaign
    ? `${campaign.name || 'The campaign'} is ${campaign.status} on file${campaign.resource ? ` (${campaign.resource})` : ', with no Google resource yet'}. ${campaign.lastReadback ? `Last read-back: ${campaign.lastReadback}` : 'No live read-back is stored yet.'}`
    : `No campaign is on file for ${name}. I have not read a status back from Google, so I will not guess one.`;
  const perf = snapshot.performance;
  const spend = perf.spend.value == null
    ? 'No spend has been read, so I have no live spend, lead count, or cost per lead.'
    : perf.spend.sample
      ? `SAMPLE. Example snapshot: ${money(perf.spend.value)} spend, ${perf.leads.value} leads${perf.cpl.value != null ? `, ${money(perf.cpl.value)} cost per lead` : ''}. Those rows are from the preview connector, not live ads.`
      : `Spend snapshot: ${money(perf.spend.value)} spend, ${perf.leads.value} leads${perf.cpl.value != null ? `, ${money(perf.cpl.value)} cost per lead` : ''}.`;
  const booked = perf.bookedJobs.value == null
    ? 'No booked jobs are on file.'
    : perf.bookedJobs.sample
      ? `SAMPLE. ${perf.bookedJobs.value} example booked jobs, not live jobs.`
      : `${perf.bookedJobs.value} booked job${perf.bookedJobs.value === 1 ? '' : 's'} on file.`;
  const google = snapshot.integrations.google;
  const next = !google.oauth
    ? 'Google Ads is not connected, so I will not read or create a campaign until it is.'
    : !google.ready
      ? `The Google Ads customer id is not resolved. ${google.note || google.error || 'I will not treat a sample link as a live ad account.'}`
      : 'Google Ads is ready, so I can read this account.';
  return plainSpeech(`${status} ${spend} ${booked} ${next}`);
}

function nameList(items: string[]): string {
  if (items.length <= 1) return items[0] || '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function integrationAnswer(snapshot: AccountSnapshot): string {
  const who = snapshot.business.name ? `For ${snapshot.business.name}: ` : '';
  const google = snapshot.integrations.google;
  const googleLine = !google.oauth
    ? 'Google Ads is not connected. I will not read spend until it is.'
    : google.ready && google.customerId
      ? `Google Ads is connected and customer id ${google.customerId} is resolved.`
      : `Google Ads is signed in, and the customer id is not resolved. ${google.error || google.note || 'I will not use a sample id as if it were live.'}`;
  const ghl = snapshot.integrations.ghl.connected
    ? 'GoHighLevel is connected.'
    : 'GoHighLevel is not connected. Speed-to-lead replies stay drafts until it is.';
  const stl = snapshot.integrations.speedToLead;
  const stlLine = stl.enabled
    ? `Speed-to-lead is on${stl.canSend ? ' and can send' : ', but it cannot send yet'}. ${stl.today} today, ${stl.held} held.`
    : 'Speed-to-lead is off. I will leave replies as drafts until you turn it on.';
  const social = snapshot.integrations.social;
  const on = [
    social.gbp ? 'Google Business Profile' : '',
    social.facebook ? 'Facebook' : '',
    social.instagram ? 'Instagram' : '',
    social.linkedin ? 'LinkedIn' : '',
  ].filter(Boolean);
  const socialLine = on.length ? `${nameList(on)} ${on.length === 1 ? 'is' : 'are'} connected for posting.` : 'No social accounts are connected.';
  const autos = snapshot.integrations.automations;
  return plainSpeech(`${who}${googleLine} ${ghl} ${stlLine} ${snapshot.integrations.meta.note} ${socialLine} No-show recovery is ${autos.noShow ? 'on' : 'off'} and new-customer onboarding is ${autos.onboarding ? 'on' : 'off'}.`);
}

export interface ChatStarter {
  ask: string;
}

/** Short prompts for the empty chat, drawn from this account only. */
export function chatEmptyLine(snapshot: AccountSnapshot): string {
  const name = snapshot.business.name;
  if (name) return `I work for ${name}. Ask about the campaign, what is connected, or what I am doing right now.`;
  return 'I work from this account. Ask what I am doing, or which integrations are connected.';
}

export function chatSuggestions(snapshot: AccountSnapshot): ChatStarter[] {
  const out: ChatStarter[] = [
    { ask: 'What are you here to do?' },
    { ask: 'Which of my integrations are connected?' },
  ];
  if (snapshot.campaigns.length || snapshot.miles.plan) out.push({ ask: 'Check my campaign status.' });
  else out.push({ ask: 'Do I have a campaign on file?' });
  if (snapshot.miles.paused) out.push({ ask: 'Why are you paused?' });
  else if (snapshot.performance.spend.sample) out.push({ ask: 'Are the spend numbers real?' });
  else if (snapshot.business.missing.length) out.push({ ask: 'What is still missing on my profile?' });
  return out.slice(0, 4);
}

function roleAnswer(snapshot: AccountSnapshot): string {
  const name = snapshot.business.name || 'this business';
  const trade = snapshot.business.trade ? `${snapshot.business.trade.toLowerCase()} ` : '';
  const place = snapshot.business.location ? ` in ${snapshot.business.location}` : '';
  const services = snapshot.business.services ? ` Services on file: ${snapshot.business.services}.` : '';
  const mode = snapshot.miles.mode ? `I am in ${snapshot.miles.mode} mode` : 'No mode is saved yet';
  const caps = snapshot.miles.caps
    ? `${mode} with a ${money(snapshot.miles.caps.dailyBudget)}/day cap, ${snapshot.miles.caps.maxChangePct}% max change a day, and a ${money(snapshot.miles.caps.monthlyCeiling)} monthly ceiling.`
    : `${mode}. Caps are not set, so I will not spend.`;
  const paused = snapshot.miles.paused ? ' The kill switch is on, so I am paused and will not create or change anything.' : '';
  const campaign = snapshot.campaigns[0];
  const doing = campaign
    ? ` Right now ${campaign.name || 'the campaign'} is ${campaign.status} on file${campaign.lastReadback ? `. ${campaign.lastReadback}` : ''}.`
    : ' Right now no campaign is on file, so nothing is spending.';
  const queue = snapshot.inbox.length
    ? ` ${snapshot.inbox.length} approval${snapshot.inbox.length === 1 ? ' is' : 's are'} waiting: ${snapshot.inbox.map((row) => row.title).join(', ')}.`
    : ' Nothing is waiting for approval.';
  const missing = snapshot.business.missing.length
    ? ` Profile is ${snapshot.business.completeness.percent}% filled. Still missing: ${snapshot.business.missing.join(', ')}.`
    : '';
  return plainSpeech(`I run the marketing for ${name}, a ${trade}company${place}.${services} ${caps}${paused}${doing}${queue}${missing}`);
}

/** Deterministic reply when the model is unreachable. Same facts, same voice. */
export function fallbackAnswer(snapshot: AccountSnapshot, question: string): string {
  const q = question.toLowerCase();
  if (/what are you here to do|what do you do|who are you|why are you here/.test(q)) return roleAnswer(snapshot);
  if (/integrat|connected|gohighlevel|\bghl\b|speed.to.lead|which one of my/.test(q)) return integrationAnswer(snapshot);
  if (/campaign|status|\bcheck\b|spend|cost per lead|\bcpl\b|booked/.test(q)) return campaignAnswer(snapshot);
  return plainSpeech(`${roleAnswer(snapshot)} ${campaignAnswer(snapshot)}`);
}

const FORBIDDEN = /as an ai\b|don'?t have (direct |any )?access|do not have (direct |any )?access|lack access|log into your|log in to your|navigate to (your |the )?(settings|dashboard)|check (your |the )?settings|market analysis|marketing strategies/i;

/** Keep a model reply that follows the rules. Replace one that slips back into the generic chatbot. */
export function acceptReply(snapshot: AccountSnapshot, question: string, reply: string | null): { text: string; fromModel: boolean } {
  const cleaned = plainSpeech(reply || '');
  if (!cleaned || FORBIDDEN.test(cleaned)) return { text: fallbackAnswer(snapshot, question), fromModel: false };
  return { text: cleaned, fromModel: true };
}
