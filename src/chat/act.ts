/**
 * Chat actions on the owner's Google Ads account.
 * These functions only propose. They do not call Google.
 * The server shows the proposal as an approval card and runs the existing
 * launch, status, budget, and negative services after Approve.
 */
import { buildSearchPlan, type PlanProfile } from '../agents/campaignplan.js';
import { overDailyCap, type MilesMode } from '../agents/policy.js';
import { reviewSearchPlan } from '../agents/prelaunch.js';
import type { CampaignSpec } from '../agents/campaign.js';
import { draftLaunch, draftSocialTurn, type LaunchChoice } from './launch.js';

export type ChatActKind = 'create_campaign' | 'set_budget' | 'pause_campaign' | 'resume_campaign' | 'add_negatives' | 'launch_plan' | 'social_change';

export interface ActAccount {
  business: string;
  trade: string;
  services: string;
  serviceAreas: string;
  website: string;
  phone: string;
  hours: string;
  mode: MilesMode;
  kill: boolean;
  dailyCap: number;
  monthlyCeiling: number;
  maxChangePct: number;
  currentDaily: number;
  campaignName: string;
  campaignResource: string;
  activation: 'none' | 'paused' | 'enabled';
  trackingLead: boolean;
  /** Keyword texts already on the plan, so a negative cannot block them. */
  protectTerms: string[];
  imageUrl?: string;
  videoUrl?: string;
  savedPlatforms?: string[];
  social?: SocialCampaign[];
}

export interface SocialCampaign {
  channel: 'meta' | 'tiktok';
  campaignId: string;
  name: string;
  daily: number;
  status: 'paused' | 'live';
  adSetIds: string[];
  adIds: string[];
  advertiserId?: string;
  mode: 'cbo' | 'abo' | 'ad_group';
  shares: number[];
  lastRaiseAt?: string | null;
}

export interface LaunchSlicePayload {
  id: 'google' | 'meta' | 'tiktok' | 'lsa';
  label: string;
  daily: number;
  create: boolean;
  reason: string;
  spec?: CampaignSpec;
  metaPlan?: unknown;
  tiktokPlan?: unknown;
}

export interface SocialChangePayload {
  channel: 'meta' | 'tiktok';
  campaignId: string;
  name: string;
  action: 'pause' | 'live' | 'budget';
  daily?: number;
  previousDaily?: number;
  advertiserId?: string;
  adSetIds: string[];
  adIds: string[];
  mode: 'cbo' | 'abo' | 'ad_group';
  shares: number[];
}

export interface ChatApproval {
  id: string;
  kind: ChatActKind;
  title: string;
  before: string;
  after: string;
  dailyCost: string;
  lines: string[];
  payload: {
    dailyBudget?: number;
    previousDaily?: number;
    keywords?: string[];
    goLive?: boolean;
    spec?: CampaignSpec;
    status?: 'PAUSED' | 'ENABLED';
    launch?: LaunchSlicePayload[];
    social?: SocialChangePayload;
  };
}

export interface ChatPlanSummary {
  title: string;
  channel: string;
  locations: string[];
  dailyBudget: number | null;
  services: string[];
  note: string;
}

export interface LaunchPickerShape {
  options: { id: string; label: string; platforms: string[]; selected: boolean }[];
  budgets: Record<string, number>;
  daily: number;
}

export type ChatDraft =
  | { kind: 'none' }
  | { kind: 'ask'; text: string; plan?: ChatPlanSummary }
  | { kind: 'refuse'; text: string; plan?: ChatPlanSummary }
  | { kind: 'suggest'; text: string; picker: LaunchPickerShape }
  | { kind: 'choose'; text: string; picker: LaunchPickerShape }
  | { kind: 'card'; text: string; approval: Omit<ChatApproval, 'id'>; plan?: ChatPlanSummary };

const SETUP = /\b(set up|setup|launch|create|start|build)\b/i;
const BUDGET = /\b(raise|lower|set|chang\w*|increase|decrease|update|adjust)\b/i;
const DAY = /(?:\$?\d+(?:\.\d+)?)\s*(?:dollars?\s*)?(?:(?:a|per)\s+|\/\s*)day\b|budget/i;

function money(text: string): number | null {
  const match = text.match(/\$(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:dollars?\s*)?(?:(?:a|per)\s+|\/\s*)day\b/i);
  const raw = match?.[1] || match?.[2];
  const amount = raw ? Number(raw) : 0;
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function placeFrom(text: string): string {
  const match = text.match(/\b(?:for|in)\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?)/);
  return match?.[1]?.trim() || '';
}

function serviceList(phrase: string): string[] {
  const noun = phrase.match(/painting|repair|cleaning|roofing/i)?.[0] || '';
  return phrase.split(/\s+and\s+|,/i).map((part) => {
    const bit = part.trim().replace(/[.,]$/, '');
    if (!bit) return '';
    if (noun && !new RegExp(noun, 'i').test(bit)) return `${bit} ${noun}`.toLowerCase();
    return bit.toLowerCase();
  }).filter(Boolean);
}

function servicesFrom(text: string): string {
  const match = text.match(/\b((?:interior|cabinet|exterior|house|commercial|storm|drain)(?:\s+and\s+(?:interior|cabinet|exterior|house|commercial|storm|drain))*\s+\w+)/i);
  if (!match?.[1]) return '';
  return match[1].replace(/\s+at\s+\$?\d.*$/i, '').replace(/[.,]$/, '').trim();
}

/** SOP 146. A monthly amount becomes an average daily budget by dividing by 30.4 and rounding down. */
function dailyAmount(text: string): number | null {
  const month = text.match(/\$(\d+(?:\.\d+)?)\s*(?:a|per|\/)\s*month\b|\$(\d+(?:\.\d+)?)\s*monthly\b|(\d+(?:\.\d+)?)\s*(?:a|per|\/)\s*month\b/i);
  if (month) {
    const raw = Number(month[1] || month[2] || month[3]);
    if (Number.isFinite(raw) && raw > 0) return Math.floor((raw / 30.4) * 100) / 100;
  }
  return money(text);
}

function quoted(text: string): string[] {
  const found = [...text.matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]!.trim().toLowerCase()).filter(Boolean);
  if (found.length) return [...new Set(found)];
  const bare = text.match(/\badd\s+(.+?)\s+as\s+negative/i)?.[1] || '';
  return [...new Set(bare.split(/\s+and\s+|,/i).map((part) => part.replace(/^['"]|['"]$/g, '').trim().toLowerCase()).filter((part) => part && part !== 'the'))];
}

function firstCity(areas: string): string {
  return areas.split(/[,;]/)[0]?.replace(/\b[A-Z]{2}\b/, '').trim() || '';
}

function capBlock(daily: number, account: ActAccount, current = account.currentDaily): string | null {
  if (account.kill) return 'The kill switch is on. Nothing was changed.';
  if (account.mode === 'manual') return 'Ask me first is on. Miles will not change Google Ads. Switch the mode if you want an approval card.';
  const over = overDailyCap(daily, account.dailyCap);
  if (over) return over;
  if (account.monthlyCeiling > 0 && daily * 30 > account.monthlyCeiling) {
    return `$${daily}/day is about $${daily * 30} in 30 days, above your $${account.monthlyCeiling} monthly ceiling. Nothing was changed.`;
  }
  if (current > 0 && account.maxChangePct > 0) {
    const pct = Math.abs((daily - current) / current) * 100;
    if (pct > account.maxChangePct + 0.001) {
      return `That is a ${Math.round(pct)}% change, above your ${account.maxChangePct}% daily change cap. Nothing was changed.`;
    }
  }
  return null;
}

function card(kind: ChatActKind, title: string, before: string, after: string, dailyCost: string, lines: string[], payload: ChatApproval['payload'], text: string, plan?: ChatPlanSummary): ChatDraft {
  return { kind: 'card', text, approval: { kind, title, before, after, dailyCost, lines, payload }, plan };
}

export function draftCreate(text: string, account: ActAccount): ChatDraft {
  const namedBudget = dailyAmount(text);
  const city = placeFrom(text) || firstCity(account.serviceAreas);
  const services = servicesFrom(text) || account.services.trim();
  const daily = namedBudget ?? (account.currentDaily > 0 ? account.currentDaily : (account.dailyCap > 0 ? account.dailyCap : null));
  if (!city) return { kind: 'ask', text: 'Which area should this cover? I would use your saved service area.' };
  if (!services) return { kind: 'ask', text: 'Which services should the ads cover? I would use the services on your profile.' };
  if (daily == null) return { kind: 'ask', text: 'What daily budget should I use? I would use $30 a day.' };
  if (account.campaignResource) return { kind: 'refuse', text: 'A Google campaign is already saved. Miles will not create a second one. You can pause it, change the budget, or add negatives. Nothing was created.' };
  const blocked = capBlock(daily, account, 0);
  if (blocked) return { kind: 'refuse', text: blocked };
  const profile: PlanProfile = {
    businessName: account.business,
    trade: account.trade || 'Home services',
    services,
    serviceAreas: city,
    phone: account.phone,
    website: account.website,
    hours: account.hours,
    goal: 'Get more calls',
    dailyBudget: daily,
  };
  const plan = buildSearchPlan(profile);
  plan.spec.dailyBudget = daily;
  plan.spec.status = 'PAUSED';
  if (/\btraffic test\b/i.test(text)) {
    plan.spec.trafficTest = true;
    plan.spec.biddingStrategy = 'MAXIMIZE_CLICKS';
    plan.spec.bidPlan = { stage: 'MAXIMIZE_CLICKS', maxCpc: 4 };
  }
  const review = reviewSearchPlan(plan.spec, { trackingLead: account.trackingLead, dailyCap: account.dailyCap, requestedDaily: daily });
  const summary: ChatPlanSummary = {
    title: 'Google Ads plan',
    channel: 'Google Ads',
    locations: [city],
    dailyBudget: daily,
    services: serviceList(services),
    note: 'Review the draft before creating a paused campaign in Google Ads.',
  };
  if (!review.ready) {
    const hold = review.rows.find((item) => item.result === 'blocker') || review.rows.find((item) => item.result !== 'pass');
    const lead = hold?.area === 'Goals';
    const textOut = [
      `Here is the paused draft for ${city}, $${daily} a day, covering ${services}. Nothing was created.`,
      'Open the campaign draft to review the settings before approving a paused build.',
      lead
        ? 'SOP 147 holds the approval card until a lead is confirmed. I would count calls or form fills. Reply yes if that is the conversion.'
        : (hold?.detail || 'The pre-launch review is on hold.'),
    ].join(' ');
    return { kind: lead ? 'ask' : 'refuse', text: textOut, plan: summary };
  }
  const goLive = /\b(go live|turn it on|enable it)\b/i.test(text);
  const lines = plan.sections.map((section) => `${section.title}: ${section.body}`);
  if (goLive && !account.trackingLead) lines.push('Going live stays off until the lead is confirmed. Approve creates the campaign paused.');
  const dailyCost = `$${daily}/day once it is enabled. The campaign is created paused, so this approval does not spend.`;
  return card('create_campaign', 'Create a paused Google Search campaign', 'No campaign from this request yet.', `Paused Search plan for ${city} at $${daily}/day.`, dailyCost, lines, {
    dailyBudget: daily,
    spec: plan.spec,
    goLive: goLive && account.trackingLead,
    status: 'PAUSED',
  }, 'Review the plan, then Approve. Nothing is created until you do. New campaigns stay paused unless you also asked to go live and the lead is confirmed.', summary);
}

export function draftBudget(text: string, account: ActAccount): ChatDraft {
  const next = dailyAmount(text);
  if (next == null) {
    const suggested = account.currentDaily > 0 ? account.currentDaily : (account.dailyCap > 0 ? account.dailyCap : 30);
    return { kind: 'ask', text: `What daily budget should I use? I would use $${suggested} a day.` };
  }
  const blocked = capBlock(next, account);
  if (blocked) return { kind: 'refuse', text: blocked };
  const before = account.currentDaily > 0 ? `$${account.currentDaily}/day` : 'No daily budget saved';
  return card('set_budget', 'Change the daily budget', before, `$${next}/day`, `$${next}/day`, [
    account.campaignResource ? 'This updates the Google Ads daily budget on the saved campaign.' : 'There is no Google campaign yet, so Approve saves the budget on the plan only.',
  ], { dailyBudget: next, previousDaily: account.currentDaily }, 'Approve to change the daily budget. Nothing changes until you do.');
}

export function draftPause(account: ActAccount): ChatDraft {
  const blocked = capBlock(0, account, 0);
  if (blocked) return { kind: 'refuse', text: blocked };
  if (!account.campaignResource) return { kind: 'refuse', text: 'There is no Google campaign on this account. Nothing was paused.' };
  if (account.activation === 'paused') return { kind: 'refuse', text: 'The campaign is already paused. Nothing was changed.' };
  return card('pause_campaign', 'Pause the Google campaign', account.activation === 'enabled' ? 'Enabled' : 'Status not confirmed on', 'Paused', account.currentDaily > 0 ? `$${account.currentDaily}/day stops while it is paused` : 'Spend stops while it is paused', [
    account.campaignName ? `Campaign: ${account.campaignName}` : 'The saved Google campaign.',
  ], { status: 'PAUSED' }, 'Approve to pause it. Nothing changes until you do.');
}

export function draftResume(account: ActAccount): ChatDraft {
  if (!account.campaignResource) return { kind: 'refuse', text: 'There is no Google campaign on this account. Nothing was enabled.' };
  if (account.activation === 'enabled') return { kind: 'refuse', text: 'The campaign is already on. Nothing was changed.' };
  if (!account.trackingLead) return { kind: 'refuse', text: 'SOP 039 holds going live until calls or form fills are confirmed as the lead. Nothing was enabled.' };
  const daily = account.currentDaily > 0 ? account.currentDaily : account.dailyCap;
  const blocked = capBlock(daily, account, 0);
  if (blocked) return { kind: 'refuse', text: blocked };
  return card('resume_campaign', 'Turn the Google campaign on', 'Paused', 'Enabled', daily > 0 ? `$${daily}/day can spend once Google reports it on` : 'Daily cost is the saved budget', [
    'This is the go-live approval. The campaign stays paused if you cancel.',
  ], { status: 'ENABLED', dailyBudget: daily }, 'Approve to turn it on. Nothing changes until you do.');
}

export function draftNegatives(text: string, account: ActAccount): ChatDraft {
  const blocked = capBlock(0, account, 0);
  if (blocked) return { kind: 'refuse', text: blocked };
  if (!account.campaignResource) return { kind: 'refuse', text: 'There is no Google campaign on this account, so there is nowhere to add negatives. Nothing was changed.' };
  const words = quoted(text);
  if (!words.length) return { kind: 'ask', text: 'Which words should I block? I would add free and jobs as phrase negatives.' };
  const hit = words.find((word) => account.protectTerms.some((term) => term.toLowerCase().includes(word)));
  if (hit) return { kind: 'refuse', text: `"${hit}" would also block a search this campaign wants. SOP 129 will not add it. Nothing was changed.` };
  return card('add_negatives', 'Add negative keywords', 'Those words are not on the saved negative list from this request.', words.map((word) => `"${word}" phrase`).join(', '), account.currentDaily > 0 ? `Daily cost stays $${account.currentDaily}/day` : 'Daily cost does not change', [
    'Phrase match, campaign level. Undo removes these words.',
  ], { keywords: words }, 'Approve to add them. Nothing is blocked until you do.');
}

const TRACKING_ASK = 'SOP 147 holds the approval card until a lead is confirmed';

export function confirmsLead(text: string): boolean {
  return /^(y|yes|yep|calls?|forms?|calls or forms)\b/i.test(text.trim());
}

export function draftChatAction(text: string, account: ActAccount, history: Array<{ role?: string; text?: string }> = [], choice?: LaunchChoice): ChatDraft {
  const raw = text.trim();
  const prior = [...history].reverse().find((message) => message.role !== 'user' && message.text)?.text || '';
  if (confirmsLead(raw) && prior.includes(TRACKING_ASK)) {
    const earlier = [...history].reverse().find((message) => message.role === 'user' && SETUP.test(message.text || '') && /\b(campaign|ads)\b/i.test(message.text || ''));
    if (earlier?.text) return draftCreate(earlier.text, { ...account, trackingLead: true });
  }
  const social = draftSocialTurn(raw, account);
  if (social.kind !== 'none') return social;
  if (/\bnegative keywords?\b/i.test(raw) || /\bas negatives?\b/i.test(raw)) return draftNegatives(raw, account);
  if (/\bpause\b/i.test(raw) && /\bcampaign\b/i.test(raw)) return draftPause(account);
  if (/\b(resume|unpause|go live|turn (it |the campaign )?on|enable (my |the )?campaign)\b/i.test(raw) && !SETUP.test(raw)) return draftResume(account);
  if (BUDGET.test(raw) && DAY.test(raw) && !SETUP.test(raw)) return draftBudget(raw, account);
  const launch = draftLaunch(raw, account, history, choice);
  if (launch.kind !== 'none') return launch;
  if (SETUP.test(raw) && /\b(google ads|campaign|ads)\b/i.test(raw)) {
    if (/\bmeta\b|\bfacebook\b/i.test(raw) && !/\bgoogle\b/i.test(raw)) return { kind: 'none' };
    return draftCreate(raw, account);
  }
  return { kind: 'none' };
}
