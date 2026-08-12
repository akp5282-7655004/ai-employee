/**
 * Scheduled agents — Miles doing recurring, unattended work: a daily morning
 * brief, a marketing performance report, and more. This module is the pure core:
 * the schedule model, the "is it due right now" check, and the task builders that
 * turn real data into a written result. The runner + persistence live in server.ts.
 */
import type { CampaignSpend, Deal } from '../revenue/attribution.js';
import type { EmailMessage } from '../connectors/types.js';

export type TaskType =
  | 'morning_brief'
  | 'cpa_report'
  | 'email_tasklist'
  | 'daily_wrapup'
  | 'social_content'
  | 'review_responder'
  | 'lead_followup'
  | 'competitor_watch'
  | 'seo_agent'
  | 'content_writer'
  | 'geo_agent'
  | 'custom';

export interface TaskSpec {
  task: TaskType;
  label: string;
  description: string;
  /** A sensible default time (local HH:MM) to pre-fill the form. */
  defaultTime: string;
  /** Transparency — what data the agent reads (and what to connect for it). */
  reads: string;
  /** Transparency — what the agent produces each run. */
  produces: string;
  /** Transparency — the actual instruction the agent follows, in plain terms. */
  instruction: string;
}

export const TASK_SPECS: TaskSpec[] = [
  {
    task: 'morning_brief',
    label: 'Morning brief + to-do list',
    description: 'A daily rundown — weather, what needs your approval, and the day’s priorities.',
    defaultTime: '08:30',
    reads: 'Your local weather, pending approvals in Deploy, and active weather triggers.',
    produces: 'A morning brief: weather + the opportunity it creates, a numbered to-do list, and the day’s focus.',
    instruction: 'Assemble a daily rundown. Lead with today’s weather and the marketing opportunity it creates. List concrete to-dos: clear any changes waiting for approval, reply to overnight leads, check yesterday’s ad spend vs. booked jobs. End with one focus — turn yesterday’s leads into booked jobs before chasing new ones.',
  },
  {
    task: 'cpa_report',
    label: 'Marketing performance report',
    description: 'Cost-per-acquisition across every ad platform vs. your target, with what to fix.',
    defaultTime: '09:00',
    reads: 'Your ad spend & conversions per platform (connect Google Ads / Meta) and your target CPA.',
    produces: 'A per-platform cost-per-job report vs. your target, flagging what’s over and where to move budget.',
    instruction: 'For each ad platform, compute cost-per-acquisition (spend ÷ conversions) and compare it to your target CPA. Flag any platform over target, never divide by zero when a platform has no conversions, and recommend trimming the worst performer and shifting budget to the best.',
  },
  {
    task: 'email_tasklist',
    label: 'Morning email → task list',
    description: 'Reads your inbox each morning and turns it into a prioritized to-do list — leads first.',
    defaultTime: '08:00',
    reads: 'Your recent email inbox (connect Gmail).',
    produces: 'A prioritized to-do list grouped Do-first / Today / When-you-can.',
    instruction: 'Act as the owner’s executive assistant. From the inbox, build a prioritized to-do list in three groups: “Do first” (money & time-sensitive — new leads, quotes, overdue invoices, anything that books a job), “Today”, and “When you can”. Each item is one short action. Ignore newsletters and noise.',
  },
  {
    task: 'daily_wrapup',
    label: '6pm daily wrap-up',
    description: 'Reviews the day’s activity at 6pm and reports what got done vs. what’s still pending.',
    defaultTime: '18:00',
    reads: 'Today’s deployed changes, agent runs, and anything still pending your approval.',
    produces: 'An end-of-day wrap-up: accomplished, still pending, and tomorrow’s 1–2 priorities.',
    instruction: 'Act as the owner’s chief of staff. Write a short, warm end-of-day wrap-up from the day’s activity only: “Accomplished today”, “Still pending” (needs approval), and “Tomorrow” (1–2 priorities). If it was a quiet day, say so kindly.',
  },
  {
    task: 'social_content',
    label: 'Daily social post + report',
    description: 'Writes an organic social post every day and reports impressions, clicks & likes.',
    defaultTime: '10:00',
    reads: 'Your business profile, services & offer (plus social metrics if Facebook/Instagram/LinkedIn are connected).',
    produces: 'One ready-to-post caption + hashtags + a visual note, and yesterday’s impressions/clicks/likes.',
    instruction: 'Act as a social media manager for a local-service business. Write ONE ready-to-post organic post: a scroll-stopping caption (2–4 short lines), 5–8 relevant hashtags, and a one-line note on the visual to pair with it. Friendly, local, no fluff. Then report yesterday’s metrics if connected.',
  },
  {
    task: 'review_responder',
    label: 'Review responder',
    description: 'Drafts on-brand replies to new reviews so your reputation stays strong.',
    defaultTime: '11:00',
    reads: 'Your new customer reviews (connect Google Business Profile).',
    produces: 'A warm, specific reply per review — or 3 reusable templates when there are none.',
    instruction: 'Reply to reviews as the business owner. Thank happy customers specifically; calmly de-escalate unhappy ones and offer to make it right — never defensive. If there are no new reviews, write 3 reusable reply templates (5-star, 3-star, 1-star) instead.',
  },
  {
    task: 'lead_followup',
    label: 'Lead follow-up',
    description: 'Follows up with new leads so none slip away — a ready-to-send message per lead.',
    defaultTime: '12:00',
    reads: 'Your new leads (connect your CRM).',
    produces: 'A ready-to-send text + email per lead — or a reusable 3-touch sequence when there are none.',
    instruction: 'Act as a speed-to-lead specialist. For each new lead, write a short, friendly first follow-up (a text option and an email option) that books the job, referencing what they asked about with a clear next step. If there are no leads, write a reusable 3-touch follow-up sequence instead.',
  },
  {
    task: 'competitor_watch',
    label: 'Competitor watch',
    description: 'Scans your local competitors and tells you how to stay ahead.',
    defaultTime: '07:00',
    reads: 'Your business profile, services, and local market.',
    produces: 'A short competitive read + 3 concrete moves to get ahead this week.',
    instruction: 'Act as a local marketing strategist. Give a short competitive read: where local competitors likely win, where this business can stand out, and 3 concrete moves to get ahead this week. Concise and actionable.',
  },
  {
    task: 'seo_agent',
    label: 'Local SEO agent',
    description: 'A weekly local-SEO play — Google Business Profile, local keywords, and citations.',
    defaultTime: '07:30',
    reads: 'Your business profile, services, and city.',
    produces: 'This week’s local-SEO play: a GBP post, a blog topic + outline, and 2 citation/review actions.',
    instruction: 'Act as a local SEO specialist for home services. Produce this week’s play: (1) one Google Business Profile post, (2) one blog topic + 4-point outline targeting a “service + city” keyword, (3) two citation/backlink or review actions.',
  },
  {
    task: 'content_writer',
    label: 'SEO content writer',
    description: 'Drafts a local-SEO blog post that helps you rank for “service near me”.',
    defaultTime: '09:30',
    reads: 'Your business profile, services, and city.',
    produces: 'A ~400-word blog draft: title, meta description, subheads, and a call to action.',
    instruction: 'Act as an SEO content writer. Write a ~400-word blog post optimized to rank for a “service near me / in city” search: a compelling title, a meta description under 155 characters, and a body with 2–3 H2 subheads and a clear call to action. Natural and helpful, not keyword-stuffed.',
  },
  {
    task: 'geo_agent',
    label: 'AI-search (GEO) agent',
    description: 'Gets your business recommended by ChatGPT & Gemini when locals ask for the best.',
    defaultTime: '08:15',
    reads: 'Your business profile, services, and city.',
    produces: 'A GEO kit: a cite-ready description, 5 AI-style FAQs, and 3 things to publish.',
    instruction: 'Act as a Generative Engine Optimization specialist — help the business get recommended by ChatGPT, Gemini and Perplexity when people ask “who’s the best [service] near me”. Produce a crisp, factual, cite-ready description, 5 FAQ question+answer pairs matching how people ask AI, and 3 things to publish so AI models pick this business.',
  },
];

// ── content agents (social / reviews / leads / competitors) ──
// Each returns an LLM {system,user} plus a demo-safe fallback. `ctx` carries the
// business profile and whatever live data the connector could gather.
export interface AgentCtx {
  business?: string;
  trade?: string;
  city?: string;
  services?: string;
  offers?: string;
  metrics?: import('../connectors/types.js').SocialMetrics | null;
  reviews?: import('../connectors/types.js').Review[];
  leads?: import('../connectors/types.js').Lead[];
  competitors?: string[];
}

const who = (c: AgentCtx) => `${c.business || 'a local business'}${c.trade ? ` (${c.trade})` : ''}${c.city ? `, ${c.city}` : ''}`;

export function socialAgent(c: AgentCtx): { system: string; user: string } {
  return {
    system:
      'You are a social media manager for a local-service business. Write ONE ready-to-post organic post for today: a scroll-stopping caption (2-4 short lines), 5-8 relevant hashtags, and a one-line note on the visual to pair with it. Friendly, local, no fluff. Plain text.',
    user: `Business: ${who(c)}.${c.services ? ` Services: ${c.services}.` : ''}${c.offers ? ` Offer: ${c.offers}.` : ''}`,
  };
}
export function reviewAgent(c: AgentCtx): { system: string; user: string } {
  const list = (c.reviews || []).map((r, i) => `${i + 1}. ${r.rating}★ from ${r.author || 'a customer'}: ${r.text || ''}`).join('\n');
  return {
    system:
      'You reply to customer reviews as the business owner. For each review, write a warm, specific, professional reply — thank happy customers, and calmly de-escalate and offer to make it right for unhappy ones. Never defensive. If NO reviews are given, instead write 3 reusable reply templates (one 5-star, one 3-star, one 1-star). Plain text, labeled.',
    user: `Business: ${who(c)}.\nReviews:\n${list || '(none today — write reusable templates)'}`,
  };
}
export function leadAgent(c: AgentCtx): { system: string; user: string } {
  const list = (c.leads || []).map((l, i) => `${i + 1}. ${l.name || 'Lead'} — ${l.service || 'inquiry'} (via ${l.source || 'unknown'})`).join('\n');
  return {
    system:
      'You are a speed-to-lead specialist. For each new lead, write a short, friendly first follow-up (a text and an email option) that books the job — reference what they asked about, offer a clear next step. If NO leads are given, instead write a reusable 3-touch follow-up sequence (text + email over a few days) for a new lead. Plain text, labeled.',
    user: `Business: ${who(c)}.\nNew leads:\n${list || '(none today — write a reusable follow-up sequence)'}`,
  };
}
export function competitorAgent(c: AgentCtx): { system: string; user: string } {
  return {
    system:
      'You are a local marketing strategist. Give a short competitive read for this business: where local competitors likely win, where this business can stand out, and 3 concrete moves to get ahead this week. Concise, actionable, plain text.',
    user: `Business: ${who(c)}.${c.services ? ` Services: ${c.services}.` : ''}${c.competitors?.length ? ` Nearby competitors: ${c.competitors.join(', ')}.` : ''}`,
  };
}

export function seoAgent(c: AgentCtx): { system: string; user: string } {
  return {
    system:
      'You are a local SEO specialist for home-services businesses. Produce this week’s local-SEO play: (1) one Google Business Profile post, (2) one blog topic + 4-point outline targeting a "service + city" keyword, (3) two citation/backlink or review actions. Concise, plain text.',
    user: `Business: ${who(c)}.${c.services ? ` Services: ${c.services}.` : ''}${c.city ? ` City: ${c.city}.` : ''}`,
  };
}
export function contentAgent(c: AgentCtx): { system: string; user: string } {
  return {
    system:
      'You are an SEO content writer for local-service businesses. Write a complete ~400-word blog post draft optimized to rank for a "service near me / in city" search: a compelling title, a meta description (<155 chars), and a body with 2-3 H2 subheads and a clear call to action. Natural, helpful, not keyword-stuffed. Plain text.',
    user: `Business: ${who(c)}.${c.services ? ` Services: ${c.services}.` : ''}${c.city ? ` City: ${c.city}.` : ''} Pick the most valuable service to target.`,
  };
}
export function geoAgent(c: AgentCtx): { system: string; user: string } {
  return {
    system:
      'You are a Generative Engine Optimization (GEO) specialist — you help local businesses get recommended by AI assistants (ChatGPT, Gemini, Perplexity) when people ask "who’s the best [service] near me". Produce: (1) a crisp, factual business description AI tools can cite, (2) 5 FAQ question+answer pairs matching how people ask AI, (3) 3 things to publish so AI models pick this business. Plain text.',
    user: `Business: ${who(c)}.${c.services ? ` Services: ${c.services}.` : ''}${c.city ? ` City: ${c.city}.` : ''}`,
  };
}

export function metricsLine(m?: import('../connectors/types.js').SocialMetrics | null): string {
  if (!m) return 'Connect your social accounts (Integrations) and I’ll report impressions, clicks & likes here — and compile a 30-day dataset.';
  return `📊 Yesterday: ${m.impressions.toLocaleString()} impressions · ${m.clicks} clicks · ${m.likes} likes${m.followers ? ` · ${m.followers.toLocaleString()} followers` : ''}.`;
}

/** Demo-safe fallback text for the content agents when no LLM key is set. */
export function agentFallback(task: TaskType, c: AgentCtx): string {
  const biz = c.business || 'your business';
  if (task === 'social_content')
    return `Today's post idea for ${biz}:\n\n"Your home deserves a fresh look. ${c.offers || 'Book this week and save.'} 🏡✨"\n#local #${(c.trade || 'homeservices').replace(/\s+/g, '')} #smallbusiness\n\n(Add an OpenRouter key and Miles writes a fresh custom post every day.)`;
  if (task === 'review_responder')
    return (c.reviews || []).length
      ? (c.reviews || []).map((r) => `To ${r.author || 'customer'} (${r.rating}★): "Thank you so much for the kind words — it means a lot to our team!"`).join('\n\n')
      : 'No new reviews to respond to. Connect Google Business Profile and I’ll draft replies the moment they come in.';
  if (task === 'lead_followup')
    return (c.leads || []).length
      ? (c.leads || []).map((l) => `${l.name || 'Lead'}: "Hi ${l.name || 'there'} — thanks for reaching out about ${l.service || 'your project'}! When's a good time for a quick call to get you a quote?"`).join('\n\n')
      : 'No new leads right now. Connect your CRM and I’ll draft a follow-up for every new lead automatically.';
  const svc = c.services || 'your services';
  const place = c.city || 'your area';
  if (task === 'seo_agent')
    return `This week's local-SEO play for ${biz}:\n\n1. Google Business Profile post: share a recent ${svc} job with 1-2 photos and your service area.\n2. Blog topic: "${svc} in ${place}: what it costs and how to choose a pro" — outline: intro · pricing factors · how to pick · your offer.\n3. Get 2 fresh 5-star reviews and add your business to one new local directory.\n\n(Add an OpenRouter key and Miles tailors this to your exact keywords each week.)`;
  if (task === 'content_writer')
    return `Blog draft for ${biz}:\n\nTitle: The Homeowner's Guide to ${svc} in ${place}\nMeta: Looking for ${svc} in ${place}? Here's what to expect, what it costs, and how to pick the right pro.\n\n[Intro] When you need ${svc} in ${place}, choosing the right team matters...\n## What to expect\n## What it costs\n## Why locals choose ${biz}\nCall to action: ${c.offers || 'Get a free quote today.'}\n\n(Add an OpenRouter key and Miles writes the full ~400-word post.)`;
  if (task === 'geo_agent')
    return `AI-search (GEO) starter for ${biz}:\n\n• Cite-ready description: "${biz} provides ${svc} in ${place}, known for fast response and quality work."\n• FAQ to publish: "Who offers the best ${svc} in ${place}?" · "How much does ${svc} cost?" · "How fast can I get an appointment?"\n• Publish clear pricing, service-area, and review content so ChatGPT & Gemini recommend you.\n\n(Add an OpenRouter key and Miles builds the full GEO kit.)`;
  return `Competitive tip for ${biz}: lead with speed-to-lead and reviews — respond to every inquiry in minutes and ask every happy customer for a review. (Add an OpenRouter key for a full competitor read.)`;
}

// ── Agent Studio — build a custom agent from a plain-language problem ──
// A custom agent is, honestly, a stored instruction + a data binding + a schedule,
// run by the same proven scheduler. It reads one data source we can actually access,
// then writes a summary / draft / prioritized list / report. It does NOT take
// real-world actions we haven't wired a connector for — the design step is told this.

export type DataSource = 'emails' | 'social' | 'reviews' | 'leads' | 'adspend' | 'deals' | 'none';

export interface DataSourceSpec {
  id: DataSource;
  label: string;
  /** What the owner connects in Integrations to feed this agent live data. */
  connect: string;
}

export const DATA_SOURCES: DataSourceSpec[] = [
  { id: 'emails', label: 'your email inbox', connect: 'Gmail' },
  { id: 'reviews', label: 'your customer reviews', connect: 'Google Business Profile' },
  { id: 'leads', label: 'your new leads', connect: 'your CRM' },
  { id: 'social', label: 'your social metrics', connect: 'Facebook / Instagram / LinkedIn' },
  { id: 'adspend', label: 'your ad spend & performance', connect: 'Google Ads / Meta' },
  { id: 'deals', label: 'your won & lost deals', connect: 'your CRM' },
  { id: 'none', label: 'no live data (works from your business profile)', connect: '' },
];

export interface CustomAgentSpec {
  name: string;
  description: string;
  dataSource: DataSource;
  /** The instruction the LLM follows every time the agent runs. */
  systemPrompt: string;
  time: string;
  days: number[];
}

/** Ask the LLM to compile a plain-language problem into a runnable agent spec (JSON). */
export function buildAgentDesignPrompt(problem: string): { system: string; user: string } {
  const sources = DATA_SOURCES.map((s) => `"${s.id}" (${s.label})`).join(', ');
  const system =
    'You design ONE automated agent for a local-service business owner from a problem they describe. ' +
    'Respond with ONLY a JSON object (no markdown, no prose) with these keys:\n' +
    '- name: a short, friendly agent name (e.g. "Inbox Triage")\n' +
    '- description: one plain sentence on what it does for the owner\n' +
    `- dataSource: EXACTLY one of ${sources} — the data the agent must read (use "none" if the business profile is enough)\n` +
    '- systemPrompt: the instruction you would give an AI to do this job on every run. Be specific about what to produce and how to format/prioritize it. Write it as instructions to the AI.\n' +
    '- time: suggested run time "HH:MM" 24h (e.g. "08:00")\n' +
    '- days: array of weekday numbers to run, 0=Sun..6=Sat (e.g. [1,2,3,4,5])\n' +
    'Design only what an AI can do by READING data and WRITING text — summaries, drafts, prioritized lists, reports. Never promise real-world actions (sending, posting, paying) it cannot take.';
  return { system, user: `The business owner says:\n"${problem}"` };
}

/** Robustly parse the design LLM's JSON into a validated spec. Returns null if unusable. */
export function parseAgentSpec(text: string): CustomAgentSpec | null {
  if (!text) return null;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(m[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
  const valid = new Set(DATA_SOURCES.map((s) => s.id));
  const dataSource = (typeof o.dataSource === 'string' && valid.has(o.dataSource as DataSource) ? o.dataSource : 'none') as DataSource;
  const systemPrompt = String(o.systemPrompt || '').trim().slice(0, 2000);
  if (!systemPrompt) return null;
  const name = String(o.name || '').trim().slice(0, 60) || 'Custom agent';
  const description = String(o.description || '').trim().slice(0, 220);
  const time = typeof o.time === 'string' && /^\d{1,2}:\d{2}$/.test(o.time) ? o.time : '08:00';
  const days =
    Array.isArray(o.days) && o.days.length && o.days.every((d) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6)
      ? (o.days as number[])
      : [1, 2, 3, 4, 5];
  return { name, description, dataSource, systemPrompt, time, days };
}

/** Demo-safe design when no LLM key is set — keyword-maps the problem to a data source. */
export function fallbackAgentDesign(problem: string): CustomAgentSpec {
  const t = (problem || '').toLowerCase();
  let dataSource: DataSource = 'none';
  let name = 'Custom Agent';
  if (/email|inbox|gmail/.test(t)) { dataSource = 'emails'; name = 'Inbox Triage'; }
  else if (/review|reputation|rating|star/.test(t)) { dataSource = 'reviews'; name = 'Reputation Watch'; }
  else if (/lead|inquir|prospect|quote request/.test(t)) { dataSource = 'leads'; name = 'Lead Concierge'; }
  else if (/social|instagram|facebook|linkedin|follower|post/.test(t)) { dataSource = 'social'; name = 'Social Pulse'; }
  else if (/ad spend|cpa|campaign|ads|budget|roas/.test(t)) { dataSource = 'adspend'; name = 'Ad Watchdog'; }
  else if (/deal|sale|revenue|won|pipeline/.test(t)) { dataSource = 'deals'; name = 'Revenue Recap'; }
  const src = DATA_SOURCES.find((s) => s.id === dataSource)!;
  return {
    name,
    description: (problem || '').trim().slice(0, 180) || 'A recurring task tailored to your business.',
    dataSource,
    systemPrompt: `You help a local-service business owner with this recurring need: "${(problem || '').trim()}". Each run, ${dataSource !== 'none' ? `read the provided ${src.label} and ` : ''}produce a clear, prioritized, plain-text result the owner can act on right away. Be concise, specific, and practical.`,
    time: '08:00',
    days: [1, 2, 3, 4, 5],
  };
}

/** The run-time prompt: the agent's stored instruction + whatever live data we gathered. */
export function customAgentRun(spec: CustomAgentSpec, business: string | undefined, dataText: string): { system: string; user: string } {
  return {
    system: spec.systemPrompt,
    user:
      `${business ? `Business: ${business}.\n` : ''}` +
      (dataText ? `Here is the data to work from:\n${dataText}` : 'No live data source is connected — use general best practice for this business.'),
  };
}

export function fallbackCustomAgent(spec: CustomAgentSpec): string {
  const src = DATA_SOURCES.find((s) => s.id === spec.dataSource);
  return `${spec.name} is deployed and will run on schedule: ${spec.description}\n\n(Add an OpenRouter key and it produces this live${spec.dataSource !== 'none' ? `, reading ${src?.label || 'your data'}` : ''}.)`;
}

export interface ScheduledAgent {
  id: string;
  name: string;
  task: TaskType;
  /** Present only for task==='custom' — the agent's stored instruction + data binding. */
  spec?: CustomAgentSpec;
  /** Local wall-clock time, "HH:MM" (24h). */
  time: string;
  /** Weekday numbers to run on: 0=Sun … 6=Sat. */
  days: number[];
  enabled: boolean;
  /** Minutes the owner's local time is behind UTC (browser getTimezoneOffset). */
  tzOffset: number;
  createdAt: string;
  lastRunAt?: string;
}

export interface AgentRun {
  id: string;
  agentId: string;
  task: TaskType;
  ts: string;
  title: string;
  body: string;
}

/** The owner's local wall clock for a given UTC instant + their tz offset. */
function localParts(nowUtc: Date, tzOffset: number): { day: number; hh: number; mm: number; ymd: string } {
  const local = new Date(nowUtc.getTime() - tzOffset * 60_000);
  return {
    day: local.getUTCDay(),
    hh: local.getUTCHours(),
    mm: local.getUTCMinutes(),
    ymd: local.toISOString().slice(0, 10),
  };
}

/**
 * True when an enabled agent should run at `now`: the weekday matches, the local
 * time is at/just past its scheduled minute, and it hasn't already run this local
 * day. The small look-back window means a scheduler ticking each minute won't miss it.
 */
export function isDue(agent: ScheduledAgent, now: Date): boolean {
  if (!agent.enabled || !agent.days?.length) return false;
  const [h = NaN, m = NaN] = agent.time.split(':').map((n) => parseInt(n, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return false;
  const { day, hh, mm, ymd } = localParts(now, agent.tzOffset);
  if (!agent.days.includes(day)) return false;
  const nowMin = hh * 60 + mm;
  const dueMin = h * 60 + m;
  // Fire in the minute it's due, and forgive up to a 5-minute scheduler lag.
  if (nowMin < dueMin || nowMin > dueMin + 5) return false;
  // Once per local day.
  if (agent.lastRunAt) {
    const last = localParts(new Date(agent.lastRunAt), agent.tzOffset);
    if (last.ymd === ymd) return false;
  }
  return true;
}

// ── task builders ────────────────────────────────────────────────────────────

export interface BriefContext {
  business?: string;
  dateLabel: string;
  weatherLine?: string;
  weatherOpportunity?: string;
  pendingApprovals: number;
  activeTriggers: number;
  focus?: string;
}

// ── morning email → task-list agent ──

/** Prompt for the LLM to turn an inbox into a prioritized to-do list. */
export function buildTaskListPrompt(emails: EmailMessage[], business?: string): { system: string; user: string } {
  const list = emails
    .map((e, i) => `${i + 1}. From: ${e.from || '?'} | Subject: ${e.subject || '(none)'} | ${e.snippet || ''}`)
    .join('\n');
  const system =
    'You are the executive assistant to a busy local-service business owner. From their inbox, produce a prioritized daily to-do list. Group into three: "🔴 Do first" (money & time-sensitive — new leads, quotes, overdue invoices, anything that books a job), "🟡 Today", and "🟢 When you can". Each item is one short action naming who/what it relates to. Ignore newsletters and noise. Plain text, no preamble.';
  const user = `${business ? `Business: ${business}.\n` : ''}Inbox (${emails.length} recent messages):\n${list}`;
  return { system, user };
}

/** Deterministic task list when no LLM key is set (demo-safe). */
export function fallbackTaskList(emails: EmailMessage[]): string {
  const hot: EmailMessage[] = [];
  const today: EmailMessage[] = [];
  const later: EmailMessage[] = [];
  for (const e of emails) {
    const t = `${e.subject || ''} ${e.snippet || ''}`.toLowerCase();
    if (/lead|quote|estimate|overdue|urgent|invoice|review|deposit|book|appointment/.test(t)) hot.push(e);
    else if (e.unread) today.push(e);
    else later.push(e);
  }
  const fmt = (e: EmailMessage) => `   • ${e.subject || '(no subject)'} — ${e.from || ''}`;
  const parts: string[] = [];
  if (hot.length) { parts.push('🔴 Do first:'); hot.forEach((e) => parts.push(fmt(e))); }
  if (today.length) { parts.push('', '🟡 Today:'); today.forEach((e) => parts.push(fmt(e))); }
  if (later.length) { parts.push('', '🟢 When you can:'); later.forEach((e) => parts.push(fmt(e))); }
  parts.push('', '(Add an OpenRouter key and Miles will summarize and prioritize these intelligently.)');
  return parts.join('\n');
}

// ── 6pm daily wrap-up agent ──

export interface WrapActivity {
  accomplished: string[];
  pending: string[];
  agentRuns: string[];
}

export function buildWrapupPrompt(a: WrapActivity, business?: string): { system: string; user: string } {
  const system =
    'You are the chief of staff to a local-service business owner. Write a short, warm end-of-day wrap-up: "✅ Accomplished today", "⏳ Still pending", and "🎯 Tomorrow" (1-2 priorities). Base it only on the activity given. Concise, plain text, no preamble.';
  const user =
    `${business ? `Business: ${business}.\n` : ''}` +
    `Shipped/live today: ${a.accomplished.join('; ') || 'none'}\n` +
    `Agent runs today: ${a.agentRuns.join('; ') || 'none'}\n` +
    `Waiting for approval: ${a.pending.join('; ') || 'none'}`;
  return { system, user };
}

export function fallbackWrapup(a: WrapActivity, dateLabel: string): string {
  const done = [...a.accomplished, ...a.agentRuns];
  if (!done.length && !a.pending.length) return `Quiet day — nothing shipped or pending in Miles on ${dateLabel}. A good time to plan tomorrow’s outreach.`;
  const lines: string[] = [];
  lines.push('✅ Accomplished today:');
  if (done.length) done.forEach((d) => lines.push(`   • ${d}`));
  else lines.push('   • (nothing shipped today)');
  lines.push('', '⏳ Still pending:');
  if (a.pending.length) a.pending.forEach((d) => lines.push(`   • ${d} — needs your approval`));
  else lines.push('   • Nothing waiting on you 🎉');
  lines.push('', `🎯 Tomorrow: clear any pending approvals and follow up on new leads.`);
  return lines.join('\n');
}

export function buildMorningBrief(ctx: BriefContext): { title: string; body: string } {
  const biz = ctx.business || 'your business';
  const lines: string[] = [`Good morning — here's ${biz} for ${ctx.dateLabel}.`, ''];
  if (ctx.weatherLine) {
    lines.push(`🌤  Weather: ${ctx.weatherLine}`);
    if (ctx.weatherOpportunity) lines.push(`     Opportunity: ${ctx.weatherOpportunity}`);
    lines.push('');
  }
  lines.push('✅ To-do today:');
  const todos: string[] = [];
  if (ctx.pendingApprovals > 0)
    todos.push(`Approve ${ctx.pendingApprovals} change${ctx.pendingApprovals === 1 ? '' : 's'} waiting in Deploy.`);
  if (ctx.activeTriggers > 0) todos.push(`${ctx.activeTriggers} weather trigger${ctx.activeTriggers === 1 ? '' : 's'} armed — no action needed.`);
  todos.push('Reply to any new leads from overnight.');
  todos.push('Check yesterday’s ad spend vs. booked jobs.');
  todos.forEach((t, i) => lines.push(`   ${i + 1}. ${t}`));
  lines.push('');
  lines.push(`🎯 Focus: ${ctx.focus || 'Turn yesterday’s leads into booked jobs before chasing new ones.'}`);
  return { title: `Morning brief — ${ctx.dateLabel}`, body: lines.join('\n') };
}

export interface CpaRow {
  platform: string;
  spend: number;
  conversions: number;
  cpa: number | null;
  status: 'under' | 'over' | 'no_data';
}

/**
 * Cost-per-acquisition per platform vs. a target. Conversions come from ad-platform
 * data; when a platform reports none we say so rather than divide by zero.
 */
export function buildCpaReport(
  spend: CampaignSpend[],
  _deals: Deal[],
  targetCpa: number,
): { title: string; body: string; rows: CpaRow[]; overCount: number } {
  const byPlatform = new Map<string, { spend: number; conversions: number }>();
  for (const s of spend) {
    const cur = byPlatform.get(s.platform) ?? { spend: 0, conversions: 0 };
    cur.spend += s.spend || 0;
    cur.conversions += s.conversions || 0;
    byPlatform.set(s.platform, cur);
  }
  const rows: CpaRow[] = [...byPlatform.entries()].map(([platform, v]) => {
    const cpa = v.conversions > 0 ? Math.round((v.spend / v.conversions) * 100) / 100 : null;
    const status: CpaRow['status'] = cpa === null ? 'no_data' : cpa <= targetCpa ? 'under' : 'over';
    return { platform, spend: Math.round(v.spend), conversions: v.conversions, cpa, status };
  });
  const overCount = rows.filter((r) => r.status === 'over').length;
  const fmt = (n: number) => `$${n.toLocaleString()}`;
  const label: Record<string, string> = {
    google_ads: 'Google Ads',
    facebook: 'Meta Ads',
    google_lsa: 'Local Services Ads',
  };
  const lines: string[] = [`Target CPA: ${fmt(targetCpa)} per booked job.`, ''];
  if (!rows.length) {
    lines.push('No ad-platform data yet. Connect Google Ads / Meta in Integrations and I’ll track CPA here automatically.');
  } else {
    for (const r of rows) {
      const name = label[r.platform] || r.platform;
      if (r.status === 'no_data') lines.push(`• ${name}: ${fmt(r.spend)} spent, no conversions reported yet.`);
      else {
        const mark = r.status === 'under' ? '✅ under target' : '⚠️ OVER target';
        lines.push(`• ${name}: ${fmt(r.cpa!)} CPA — ${mark}  (${fmt(r.spend)} / ${r.conversions} conv)`);
      }
    }
    lines.push('');
    lines.push(
      overCount === 0
        ? '🎉 Every platform is at or under your target CPA. Hold budgets and keep scaling the winners.'
        : `⚠️ ${overCount} platform${overCount === 1 ? '' : 's'} over target. Recommend trimming budget on the worst performer and shifting it to the best.`,
    );
  }
  return { title: 'Marketing performance — CPA vs. target', body: lines.join('\n'), rows, overCount };
}
