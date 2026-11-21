/**
 * Cross-platform launch suggestions for Ask Miles.
 * Elements: docs/reference/BUILD-GUIDANCE.md and
 * docs/reference/checklists/social-media-paid-checklist.md.
 * Meta structure: docs/meta-tiktok-campaign-sop.md and
 * docs/reference/meta/notion-meta-ads-sops.md.
 * Counts come from the budget and those SOPs. Checklist tier columns are not caps.
 * Numbers come only from resolveBenchmark in src/benchmarks/resolve.ts.
 */
import { tradePlaybook } from '../playbooks/load.js';
import { resolveBenchmark, type ResolvedBenchmark } from '../benchmarks/resolve.js';
import { tradeKey } from '../benchmarks/trades.js';
import { buildSearchPlan, type PlanProfile } from '../agents/campaignplan.js';
import { buildMetaPlan } from '../agents/paidstructure.js';
import { buildTikTokPlan, reviewBlocked, reviewTikTokPlan } from '../agents/paidstructure.js';
import { reviewMetaPlan } from '../agents/paidstructure.js';
import { overDailyCap } from '../agents/policy.js';
import { scaleIncreaseAllowed } from '../agents/paidstructure.js';
import type { ActAccount, ChatApproval, ChatDraft, ChatPlanSummary, LaunchSlicePayload, SocialCampaign } from './act.js';

export type LaunchPlatform = 'google' | 'meta' | 'tiktok' | 'lsa';

export interface PlatformSlice {
  id: LaunchPlatform;
  label: string;
  daily: number;
  /** False when Miles cannot create it, or the budget cannot feed it. */
  create: boolean;
  reason: string;
  source?: string;
}

export interface LaunchSuggestion {
  trade: string;
  leadType: string;
  leadNote: string;
  platforms: PlatformSlice[];
  daily: number;
  text: string;
}

const LABELS: Record<LaunchPlatform, string> = {
  google: 'Google Search',
  meta: 'Meta',
  tiktok: 'TikTok',
  lsa: 'Local Services Ads',
};

const ORDER: LaunchPlatform[] = ['google', 'lsa', 'meta', 'tiktok'];

export function leadTypeOf(text: string): { id: string; label: string } {
  const t = text.toLowerCase();
  if (/\b(repair|emergency|leak|clog|no heat|no ac|broken)\b/.test(t)) return { id: 'repair', label: 'repair' };
  if (/\b(install|replacement|replace)\b/.test(t)) return { id: 'replacement', label: 'install or replacement' };
  if (/\b(maintenance|tune-?up|membership)\b/.test(t)) return { id: 'maintenance', label: 'maintenance' };
  if (/\b(estimate|quote)\b/.test(t)) return { id: 'estimate', label: 'estimate' };
  return { id: 'general', label: 'general' };
}

export function tradeOf(text: string, fallback: string): string {
  const t = `${text} ${fallback}`.toLowerCase();
  if (/\bplumb/.test(t)) return 'Plumbing';
  if (/\bhvac|heating|air conditioning|no heat|no ac\b/.test(t)) return 'HVAC';
  if (/\broof/.test(t)) return 'Roofing';
  if (/\belectric/.test(t)) return 'Electrical';
  if (/\bpaint/.test(t)) return 'Painting';
  if (/\bsolar/.test(t)) return 'Solar';
  if (/\blandscap/.test(t)) return 'Landscaping';
  return fallback.trim() || 'Home services';
}

/** Platforms the sentence names. Empty when the owner has not chosen yet. */
export function namedPlatforms(text: string): LaunchPlatform[] {
  const t = text.toLowerCase();
  const hits: LaunchPlatform[] = [];
  if (/\b(google( ads| search)?|just google|google only)\b/.test(t)) hits.push('google');
  if (/\b(meta|facebook|instagram)\b/.test(t)) hits.push('meta');
  if (/\btiktok\b/.test(t)) hits.push('tiktok');
  if (/\b(local services|lsa)\b/.test(t)) hits.push('lsa');
  return hits;
}

function playbookWeights(trade: string): Partial<Record<LaunchPlatform, number>> {
  const split = tradePlaybook(trade).economics?.budgetSplit;
  if (!split) return {};
  return { google: split.search, lsa: split.lsa, meta: split.meta };
}

function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const raw = weights.map((weight) => Math.floor((total * weight) / sum));
  let used = raw.reduce((a, b) => a + b, 0);
  let i = 0;
  while (used < total && raw.length) {
    const slot = raw[i % raw.length];
    if (slot == null) break;
    raw[i % raw.length] = slot + 1;
    used += 1;
    i += 1;
  }
  return raw;
}

interface Ranked {
  id: LaunchPlatform;
  roas: number | null;
  cpl: number | null;
  source: string;
  label: string;
  sample: number | null;
}

function published(row: ResolvedBenchmark): ResolvedBenchmark | null {
  return row.kind === 'none' || row.value == null ? null : row;
}

function sourceName(row: ResolvedBenchmark): string {
  return row.label.split('. Trade-level')[0] || row.label;
}

function rankPlatforms(trade: string, leadType: string): Ranked[] {
  const key = tradeKey(trade);
  if (!key) return [];
  const asked = leadType === 'general' ? null : leadType;
  const ranked: Ranked[] = [];
  for (const id of ORDER) {
    const roas = published(resolveBenchmark({ trade: key, platform: id, metric: 'roas', leadType: asked }));
    const cpl = published(resolveBenchmark({ trade: key, platform: id, metric: 'cpl', leadType: asked }));
    if (!roas && !cpl) continue;
    const shown = roas || cpl!;
    ranked.push({
      id,
      roas: roas?.value ?? null,
      cpl: cpl?.value ?? null,
      source: sourceName(shown),
      label: shown.label,
      sample: shown.sampleSize,
    });
  }
  ranked.sort((a, b) => {
    if (a.roas != null && b.roas != null) return b.roas - a.roas;
    if (a.roas != null) return -1;
    if (b.roas != null) return 1;
    return (a.cpl ?? 9999) - (b.cpl ?? 9999);
  });
  return ranked;
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] || '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function joinSources(sources: string[]): string {
  const hosts = new Map<string, string[]>();
  for (const source of sources) {
    const [host, when] = source.split(', ');
    const list = hosts.get(host || source) || [];
    if (when && !list.includes(when)) list.push(when);
    hosts.set(host || source, list);
  }
  return [...hosts].map(([host, whens]) => (whens.length ? `${host}, ${whens.join(' / ')}` : host)).join(' / ');
}

export function suggestLaunch(text: string, account: ActAccount, daily: number): LaunchSuggestion {
  const lead = leadTypeOf(text);
  const trade = tradeOf(text, account.trade);
  const ranked = rankPlatforms(trade, lead.id);
  const weights = playbookWeights(trade);
  const ids = ranked.map((row) => row.id);
  const useBook = ids.length > 0 && ids.every((id) => (weights[id] || 0) > 0);
  const shares = ids.length
    ? allocate(daily, useBook ? ids.map((id) => weights[id] || 0) : ids.map(() => 1))
    : [];
  const platforms: PlatformSlice[] = ranked.map((row, index) => ({
    id: row.id,
    label: LABELS[row.id],
    daily: shares[index] || 0,
    create: row.id !== 'lsa',
    reason: [
      row.roas != null ? `ROAS ${row.roas}x` : '',
      row.cpl != null ? `CPL $${row.cpl}` : '',
      row.label,
      row.sample != null ? `${row.sample} accounts` : '',
      row.source,
    ].filter(Boolean).join('. '),
    source: row.source,
  }));
  const figures = ranked.map((row) => `${LABELS[row.id]} ${[row.roas != null ? `ROAS ${row.roas}x` : '', row.cpl != null ? `CPL $${row.cpl}` : ''].filter(Boolean).join(', ')}`).join('. ');
  const names = joinNames(platforms.map((row) => row.label));
  const splitLine = platforms.map((row) => `${row.label} $${row.daily}`).join(', ');
  const bookNote = useBook
    ? `The dollars follow the ${trade} playbook shares for those platforms.`
    : ids.length > 1
      ? 'The playbook has no split for this set, so the dollars are even.'
      : '';
  const leadPhrase = lead.id === 'general' ? 'these leads' : `${lead.label} leads`;
  const caveat = ranked.find((row) => row.label.includes('Trade-level'))?.label.split('. ').slice(1).join('. ') || '';
  const ask = platforms.length > 1 ? 'Want to split the campaign across those?' : 'Want to run the campaign there?';
  const textOut = platforms.length
    ? `For ${leadPhrase}, ${names} ${platforms.length === 1 ? 'is' : 'are'} performing best for ${trade} (source: ${joinSources(platforms.map((row) => row.source || '').filter(Boolean))}). ${figures}. ${caveat} ${ask} Suggested: ${splitLine}. ${bookNote}`.replace(/\s+/g, ' ').trim()
    : `No published CPL or ROAS for ${trade} is stored for Google Search, Local Services Ads, Meta, or TikTok. No platform is ranked as best. Pick the platforms you want.`;
  return { trade, leadType: lead.label, leadNote: platforms[0]?.reason || '', platforms, daily, text: textOut };
}

export interface LaunchPicker {
  options: { id: string; label: string; platforms: LaunchPlatform[]; selected: boolean }[];
  budgets: Partial<Record<LaunchPlatform, number>>;
  daily: number;
}

export function pickerFor(suggestion: LaunchSuggestion, saved?: LaunchPlatform[]): LaunchPicker {
  const savedSet = new Set(saved || []);
  const suggested = suggestion.platforms.map((row) => row.id);
  const selected = savedSet.size ? savedSet : new Set(suggested);
  const budgets: Partial<Record<LaunchPlatform, number>> = {};
  for (const row of suggestion.platforms) budgets[row.id] = row.daily;
  return {
    daily: suggestion.daily,
    budgets,
    options: [
      { id: 'google', label: 'Google only', platforms: ['google'], selected: selected.size === 1 && selected.has('google') },
      { id: 'meta', label: 'Meta only', platforms: ['meta'], selected: selected.size === 1 && selected.has('meta') },
      { id: 'tiktok', label: 'TikTok only', platforms: ['tiktok'], selected: selected.size === 1 && selected.has('tiktok') },
      { id: 'lsa', label: 'Local Services Ads only', platforms: ['lsa'], selected: selected.size === 1 && selected.has('lsa') },
      { id: 'multi', label: 'Multi-platform', platforms: suggested.length ? suggested : ['google', 'meta'], selected: selected.size > 1 },
    ],
  };
}

function capText(daily: number, account: ActAccount): string | null {
  if (account.kill) return 'The kill switch is on. Nothing was changed.';
  if (account.mode === 'manual') return 'Ask me first is on. Miles will not launch ads. Switch the mode if you want an approval card.';
  const over = overDailyCap(daily, account.dailyCap);
  if (over) return over;
  if (account.monthlyCeiling > 0 && daily * 30 > account.monthlyCeiling) {
    return `$${daily}/day is about $${daily * 30} in 30 days, above your $${account.monthlyCeiling} monthly ceiling. Nothing was changed.`;
  }
  return null;
}

function dollars(text: string): number | null {
  const match = text.match(/\$(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:dollars?\s*)?(?:(?:a|per)\s+|\/\s*)day\b/i);
  const raw = Number(match?.[1] || match?.[2]);
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

function workingDaily(text: string, account: ActAccount): { daily: number; assumed: boolean } {
  const typed = dollars(text);
  if (typed) return { daily: typed, assumed: false };
  const fallback = account.currentDaily > 0 ? account.currentDaily : 30;
  const daily = account.dailyCap > 0 ? Math.min(fallback, account.dailyCap) : fallback;
  return { daily: daily > 0 ? daily : 30, assumed: true };
}

export function launchFacts(text: string, account: ActAccount): { daily: number; assumed: boolean; city: string; services: string; missing: string | null } {
  const budget = workingDaily(text, account);
  const cityMatch = text.match(/\bin\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?)/);
  const city = cityMatch?.[1]?.trim() || account.serviceAreas.split(/[,;]/)[0]?.trim() || '';
  const services = text.match(/\b((?:interior|exterior|cabinet|house)\s+painting|painting|plumbing|roofing|hvac|solar)\b/i)?.[0] || account.services.trim();
  const missing = !city ? 'Which area should this cover? I would use your saved service area.'
    : !services ? 'Which service should the ads cover? I would use the services on your profile.'
      : null;
  return { daily: budget.daily, assumed: budget.assumed, city, services, missing };
}

export interface BuiltPlatform {
  id: LaunchPlatform;
  label: string;
  daily: number;
  create: boolean;
  lines: string[];
  spec?: ReturnType<typeof buildSearchPlan>['spec'];
  metaPlan?: ReturnType<typeof buildMetaPlan>['plan'];
  tiktokPlan?: ReturnType<typeof buildTikTokPlan>['plan'];
}

export function buildLaunchCard(text: string, account: ActAccount & { imageUrl?: string; videoUrl?: string }, platforms: PlatformSlice[]): ChatDraft {
  const facts = launchFacts(text, account);
  if (facts.missing) return { kind: 'ask', text: facts.missing };
  const total = platforms.reduce((sum, row) => sum + row.daily, 0) || facts.daily;
  const blocked = capText(total, account);
  if (blocked) return { kind: 'refuse', text: blocked };
  const trade = tradeOf(text, account.trade);
  const built: BuiltPlatform[] = [];
  const lines: string[] = [];
  for (const slice of platforms) {
    if (slice.id === 'lsa') {
      lines.push(`Local Services Ads, $${slice.daily}/day. Owner action needed. Miles has no Local Services Ads create path. Set the service area to ${facts.city}, job types from ${facts.services}, and this daily budget in Google. Nothing will be created there.`);
      built.push({ id: 'lsa', label: slice.label, daily: slice.daily, create: false, lines: [] });
      continue;
    }
    if (slice.id === 'google') {
      if (account.campaignResource) {
        lines.push(`Google Search, $${slice.daily}/day. A Google campaign is already saved, so this request will not create a second one.`);
        built.push({ id: 'google', label: slice.label, daily: slice.daily, create: false, lines: [] });
        continue;
      }
      const profile: PlanProfile = {
        businessName: account.business,
        trade: trade || 'Home services',
        services: facts.services,
        serviceAreas: facts.city,
        phone: account.phone,
        website: account.website,
        hours: account.hours,
        goal: 'Get more calls',
        dailyBudget: slice.daily,
      };
      const plan = buildSearchPlan(profile);
      plan.spec.dailyBudget = slice.daily;
      plan.spec.status = 'PAUSED';
      const held = !account.trackingLead;
      lines.push(`Google Search, $${slice.daily}/day, paused. ${held ? 'The lead is not confirmed, so Approve will not create Google until you confirm calls or form fills.' : plan.sections.map((section) => section.title).join(', ')}.`);
      built.push({ id: 'google', label: slice.label, daily: slice.daily, create: !held, lines: plan.sections.map((section) => section.body), spec: held ? undefined : plan.spec });
      continue;
    }
    if (slice.id === 'meta') {
      const image = account.imageUrl || '';
      const meta = buildMetaPlan({
        dailyBudget: slice.daily,
        dailyCap: account.dailyCap || undefined,
        monthlyCap: account.monthlyCeiling || undefined,
        website: account.website,
        imageUrls: image ? [image] : [],
        business: account.business,
        trade,
        city: facts.city,
        serviceAreas: facts.city,
        services: facts.services,
      });
      const block = reviewBlocked(reviewMetaPlan(meta.plan, { dailyCap: account.dailyCap, monthlyCap: account.monthlyCeiling }));
      lines.push(`Meta, $${slice.daily}/day, paused. ${block ? `Not created. ${block}` : `${meta.plan.adSets.filter((set) => set.included).length} ad sets. ${meta.plan.budgetNote}`}`);
      built.push({ id: 'meta', label: slice.label, daily: slice.daily, create: !block, lines: meta.plan.elements.map((row) => `${row.label}: ${row.detail}`), metaPlan: block ? undefined : meta.plan });
      continue;
    }
    const video = account.videoUrl || '';
    const tiktok = buildTikTokPlan({
      dailyBudget: slice.daily,
      dailyCap: account.dailyCap || undefined,
      monthlyCap: account.monthlyCeiling || undefined,
      website: account.website,
      videoUrl: video,
      business: account.business,
      trade,
      city: facts.city,
      serviceAreas: facts.city,
      services: facts.services,
    });
    const block = reviewBlocked(reviewTikTokPlan(tiktok.plan, { dailyCap: account.dailyCap, monthlyCap: account.monthlyCeiling }));
    lines.push(`TikTok, $${slice.daily}/day, disabled on create. ${block ? `Not created. ${block}` : tiktok.plan.budgetNote}`);
    built.push({ id: 'tiktok', label: slice.label, daily: slice.daily, create: !block, lines: [], tiktokPlan: block ? undefined : tiktok.plan });
  }
  const summary: ChatPlanSummary = {
    title: built.length === 1 ? `${built[0]!.label} plan` : 'Multi-platform plan',
    channel: built.map((row) => row.label).join(', '),
    locations: facts.city ? [facts.city] : [],
    dailyBudget: total,
    services: facts.services ? [facts.services] : [],
    note: 'Approve creates paused campaigns only. Going live is a separate approval. Local Services Ads are not created.',
  };
  const approval: Omit<ChatApproval, 'id'> = {
    kind: 'launch_plan',
    title: built.length === 1 ? `Create a paused ${built[0]!.label} campaign` : 'Create paused campaigns',
    before: 'Nothing from this request is created yet.',
    after: lines.join(' '),
    dailyCost: `$${total}/day across this plan. Created campaigns stay paused, so this approval does not spend.`,
    lines,
    payload: {
      dailyBudget: total,
      launch: built.map((row): LaunchSlicePayload => ({
        id: row.id,
        label: row.label,
        daily: row.daily,
        create: row.create,
        reason: lines.find((line) => line.startsWith(row.label)) || row.label,
        spec: row.spec,
        metaPlan: row.metaPlan,
        tiktokPlan: row.tiktokPlan,
      })),
    },
  };
  return { kind: 'card', text: 'Review the plan, then Approve. Nothing is created until you do. New campaigns stay paused.', approval, plan: summary };
}

export interface LaunchChoice {
  accept?: boolean;
  decline?: boolean;
  platforms?: LaunchPlatform[];
  budgets?: Partial<Record<LaunchPlatform, number>>;
}

const LAUNCH_SENTENCE = /\b(set up|setup|launch|create|start|build)\b/i;
const YES = /^(y|yes|yep|sure|ok|okay)\b/i;
const NO = /^(n|no|nope)\b/i;

function isLaunchSentence(text: string): boolean {
  return LAUNCH_SENTENCE.test(text) && /\b(campaign|ads|meta|facebook|instagram|tiktok|local services|lsa)\b/i.test(text);
}

function isPlatformAsk(text: string): boolean {
  return /\bplatforms?\b/i.test(text) && /\b(run|use|should|which|what|best|recommend)\b/i.test(text);
}

function withAssumption(text: string, facts: { daily: number; assumed: boolean }): string {
  return facts.assumed ? `I'll use $${facts.daily} a day. ${text}` : text;
}

function earlierLaunch(text: string, history: Array<{ role?: string; text?: string }>): string {
  const earlier = [...history].reverse().find((message) => message.role === 'user' && message.text && message.text !== text && isLaunchSentence(message.text));
  return earlier?.text || '';
}

function slicesFor(ids: LaunchPlatform[], daily: number, trade: string): PlatformSlice[] {
  const weights = playbookWeights(trade);
  const useBook = ids.length > 0 && ids.every((id) => (weights[id] || 0) > 0);
  const shares = allocate(daily, useBook ? ids.map((id) => weights[id] || 0) : ids.map(() => 1));
  return ids.map((id, index) => ({
    id,
    label: LABELS[id],
    daily: shares[index] || 0,
    create: id !== 'lsa',
    reason: 'Chosen for this launch.',
  }));
}

function slicesFromBudgets(ids: LaunchPlatform[], daily: number, budgets?: Partial<Record<LaunchPlatform, number>>): PlatformSlice[] {
  const amounts = ids.map((id) => Math.max(0, Math.round(Number(budgets?.[id]) || 0)));
  const sum = amounts.reduce((total, amount) => total + amount, 0);
  const quickPickSingle = ids.length === 1 && !!budgets && Object.keys(budgets).length > 1;
  const shares = quickPickSingle ? [daily] : (sum > 0 ? amounts : allocate(daily, ids.map(() => 1)));
  return ids.map((id, index) => ({
    id,
    label: LABELS[id],
    daily: shares[index] || 0,
    create: id !== 'lsa',
    reason: 'Chosen for this launch.',
  }));
}

function chooseDraft(suggestion: LaunchSuggestion, saved?: string[]): ChatDraft {
  const picker = pickerFor(suggestion, (saved || []).filter((id): id is LaunchPlatform => id === 'google' || id === 'meta' || id === 'tiktok' || id === 'lsa'));
  const budgets: Record<string, number> = {};
  for (const [key, value] of Object.entries(picker.budgets)) budgets[key] = value || 0;
  if (!Object.keys(budgets).length) {
    const even = allocate(suggestion.daily || 30, [1, 1]);
    budgets.google = even[0] || 0;
    budgets.meta = even[1] || 0;
  }
  return {
    kind: 'choose',
    text: suggestion.platforms.length
      ? 'Which platforms should I use? Multi-platform starts from the suggestion. You can change the dollars before I build the plan.'
      : suggestion.text,
    picker: { options: picker.options.map((option) => ({ ...option, platforms: option.platforms })), budgets, daily: picker.daily },
  };
}

export function draftLaunch(text: string, account: ActAccount, history: Array<{ role?: string; text?: string }> = [], choice?: LaunchChoice): ChatDraft {
  const prior = [...history].reverse().find((message) => message.role !== 'user' && message.text)?.text || '';
  const base = earlierLaunch(text, history);
  const offered = /performing best/.test(prior);
  if (choice?.decline || (NO.test(text) && offered)) {
    const source = base || text;
    const facts = launchFacts(source, account);
    if (facts.missing) return { kind: 'ask', text: facts.missing };
    return chooseDraft(suggestLaunch(source, account, facts.daily), account.savedPlatforms);
  }
  if (choice?.accept || (YES.test(text) && offered)) {
    if (!base) return { kind: 'ask', text: 'Which launch should I use that split for?' };
    const facts = launchFacts(base, account);
    if (facts.missing) return { kind: 'ask', text: facts.missing };
    const suggestion = suggestLaunch(base, account, facts.daily);
    if (!suggestion.platforms.length) return chooseDraft(suggestion, account.savedPlatforms);
    return buildLaunchCard(base, account, suggestion.platforms);
  }
  if (choice?.platforms?.length) {
    const source = base || text;
    const facts = launchFacts(source, account);
    if (facts.missing) return { kind: 'ask', text: facts.missing };
    const ids = choice.platforms.filter((id): id is LaunchPlatform => id === 'google' || id === 'meta' || id === 'tiktok' || id === 'lsa');
    if (!ids.length) return { kind: 'ask', text: 'Pick Google, Meta, TikTok, Local Services Ads, or a mix.' };
    return buildLaunchCard(source, account, slicesFromBudgets(ids, facts.daily, choice.budgets));
  }
  const platformAsk = isPlatformAsk(text);
  if (!isLaunchSentence(text) && !platformAsk) return { kind: 'none' };
  const named = namedPlatforms(text);
  if (!platformAsk && named.length === 1 && named[0] === 'google') return { kind: 'none' };
  const facts = launchFacts(text, account);
  if (facts.missing) return { kind: 'ask', text: facts.missing };
  if (!platformAsk && named.length) return buildLaunchCard(text, account, slicesFor(named, facts.daily, tradeOf(text, account.trade)));
  const suggestion = suggestLaunch(text, account, facts.daily);
  const picked = chooseDraft(suggestion, account.savedPlatforms);
  if (!suggestion.platforms.length) return picked;
  if (picked.kind !== 'choose') return picked;
  return { kind: 'suggest', text: withAssumption(suggestion.text, facts), picker: picked.picker };
}

function socialOf(text: string, account: ActAccount): SocialCampaign | null {
  const rows = account.social || [];
  const wantMeta = /\b(meta|facebook|instagram)\b/i.test(text);
  const wantTikTok = /\btiktok\b/i.test(text);
  const hit = rows.find((row) => (wantMeta && row.channel === 'meta') || (wantTikTok && row.channel === 'tiktok'));
  return hit || null;
}

export function draftSocialTurn(text: string, account: ActAccount): ChatDraft {
  const named = /\b(meta|facebook|instagram|tiktok)\b/i.test(text);
  if (!named) return { kind: 'none' };
  const row = socialOf(text, account);
  const channel = /\btiktok\b/i.test(text) ? 'TikTok' : 'Meta';
  if (/\bpause\b/i.test(text)) {
    if (!row) return { kind: 'refuse', text: `There is no ${channel} campaign on this account. Nothing was paused.` };
    if (row.status === 'paused') return { kind: 'refuse', text: `The ${channel} campaign is already paused. Nothing was changed.` };
    return socialCard(row, 'pause', `Pause the ${channel} campaign`, 'Live', 'Paused', row.daily);
  }
  if (/\b(go live|turn (it |the campaign )?on|resume|unpause|enable)\b/i.test(text) && !LAUNCH_SENTENCE.test(text)) {
    if (!row) return { kind: 'refuse', text: `There is no ${channel} campaign on this account. Nothing was turned on.` };
    if (row.status === 'live') return { kind: 'refuse', text: `The ${channel} campaign is already on. Nothing was changed.` };
    const blocked = capText(combinedLive(account, row.daily, row.campaignId), account);
    if (blocked) return { kind: 'refuse', text: blocked };
    return socialCard(row, 'live', `Turn the ${channel} campaign on`, 'Paused', 'Live', row.daily);
  }
  if (/\b(raise|lower|set|change|increase|decrease|update)\b/i.test(text) && /(?:\$?\d+(?:\.\d+)?)\s*(?:dollars?\s*)?(?:(?:a|per)\s+|\/\s*)day\b|budget/i.test(text) && !LAUNCH_SENTENCE.test(text)) {
    if (!row) return { kind: 'refuse', text: `There is no ${channel} campaign on this account. Nothing was changed.` };
    const next = dollars(text);
    if (next == null) return { kind: 'ask', text: `What daily budget should I use? I would keep $${row.daily} a day.` };
    const blocked = capText(combinedLive(account, next, row.campaignId), account);
    if (blocked) return { kind: 'refuse', text: blocked };
    const paced = scaleIncreaseAllowed(row.daily, next, row.lastRaiseAt ?? null);
    if (paced) return { kind: 'refuse', text: paced };
    if (row.daily > 0 && account.maxChangePct > 0) {
      const pct = Math.abs((next - row.daily) / row.daily) * 100;
      if (pct > account.maxChangePct + 0.001) {
        return { kind: 'refuse', text: `That is a ${Math.round(pct)}% change, above your ${account.maxChangePct}% daily change cap. Nothing was changed.` };
      }
    }
    return socialCard(row, 'budget', `Change the ${channel} daily budget`, `$${row.daily}/day`, `$${next}/day`, next, row.daily);
  }
  return { kind: 'none' };
}

function combinedLive(account: ActAccount, next: number, campaignId: string): number {
  const google = account.activation === 'enabled' ? account.currentDaily : 0;
  const others = (account.social || []).filter((row) => row.status === 'live' && row.campaignId !== campaignId).reduce((sum, row) => sum + row.daily, 0);
  return google + others + next;
}

function socialCard(row: SocialCampaign, action: 'pause' | 'live' | 'budget', title: string, before: string, after: string, daily: number, previousDaily = row.daily): ChatDraft {
  const approval: Omit<ChatApproval, 'id'> = {
    kind: 'social_change',
    title,
    before,
    after,
    dailyCost: action === 'pause' ? `$${row.daily}/day stops while it is paused` : `$${daily}/day`,
    lines: [`${row.channel === 'meta' ? 'Meta' : 'TikTok'}: ${row.name || row.campaignId}`],
    payload: {
      dailyBudget: daily,
      previousDaily,
      social: {
        channel: row.channel,
        campaignId: row.campaignId,
        name: row.name,
        action,
        daily,
        previousDaily,
        advertiserId: row.advertiserId,
        adSetIds: row.adSetIds,
        adIds: row.adIds,
        mode: row.mode,
        shares: row.shares,
      },
    },
  };
  return { kind: 'card', text: 'Approve to make this change. Nothing changes until you do.', approval };
}
