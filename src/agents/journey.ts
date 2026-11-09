/**
 * What Miles prepares from a crawl and the owner's setup.
 * Publishing and enabling go through the policy engine, not through this file.
 */
import { buildCampaignSpec, deriveServiceLines, shortBrand, type CampaignSpec } from './campaign.js';
import { runAuditChecks, scoreFindings, gradeFor } from '../research/audit.js';
import { parseSiteHtml, type SiteImport } from '../research/site.js';
import { CHANNELS } from '../research/competitive.js';
import { feasibility, playbookCard, type Feasibility, type PlaybookCard } from './feasibility.js';
import { DEFAULT_CAPS, type Caps, type MilesArea, type MilesMode } from './policy.js';

export interface CrawlInput {
  businessName?: string;
  location?: string;
  email?: string;
  website?: string;
  gbpUrl?: string;
  competitors?: string[];
  html?: string;
}

export interface SetupAnswers {
  goal: string;
  dailyBudget: number;
  leadsPerDay: number;
  /** Share of the daily budget assigned to Google. The rest is a plan for other channels. */
  googleShare: number;
}

export interface MilesSetup {
  mode: MilesMode;
  areaModes: Partial<Record<MilesArea, MilesMode>>;
  caps: Caps;
  businessName: string;
  location: string;
  email: string;
  website: string;
  gbpUrl: string;
  gbpNote: string;
  competitors: string[];
  goal: string;
  leadsPerDay: number;
  googleShare: number;
}

export interface AuditCard {
  id: 'website' | 'competitor' | 'performance';
  title: string;
  source: string;
  summary: string;
  score?: number;
  grade?: string;
}

export interface SeoDraft {
  path: string;
  title: string;
  description: string;
  status: 'draft';
}

export interface SocialDraft {
  day: string;
  caption: string;
  status: 'needs_approval';
  note: string;
}

export interface ChannelPlan {
  id: 'google' | 'meta' | 'tiktok' | 'lsa';
  label: string;
  daily: number;
  status: 'runnable' | 'coming_later';
  note: string;
}

export interface MilesBundle {
  setup: MilesSetup;
  profile: Record<string, string>;
  playbook: PlaybookCard;
  feasibility: Feasibility;
  audits: AuditCard[];
  spec: CampaignSpec;
  seo: SeoDraft[];
  social: SocialDraft[];
  channels: ChannelPlan[];
  hours: string;
  license: string;
}

function hoursOf(text: string): string {
  if (/\b(mon|tue|wed|thu|fri|sat|sun)(day)?\b/i.test(text) && /(\d\s*(am|pm)|\d:\d{2})/i.test(text)) return 'Hours are mentioned on the site.';
  return 'Not found on the site';
}

function licenseOf(text: string): string {
  const m = text.match(/licen[sc]e[^.]{0,40}/i);
  return m ? m[0].replace(/\s+/g, ' ').trim() : 'Not found on the site';
}

export function crawlFacts(input: CrawlInput): { site: Partial<SiteImport>; text: string; profile: Record<string, string>; hours: string; license: string; gbpNote: string } {
  const site = input.html ? parseSiteHtml(input.html, input.website || 'https://example.com') : {};
  const text = input.html ? input.html.replace(/<[^>]+>/g, ' ') : '';
  const name = input.businessName || site.businessName || '';
  const location = input.location || site.serviceAreas || site.city || '';
  const profile: Record<string, string> = {};
  if (name) profile.businessName = name;
  if (site.industry) profile.industry = site.industry;
  if (site.services) profile.services = site.services;
  if (location) profile.serviceAreas = location;
  if (input.website || site.website) profile.website = input.website || site.website || '';
  if (site.phone) profile.phone = site.phone;
  if (input.email) profile.email = input.email;
  if (site.brandColors) profile.brandColors = site.brandColors;
  if (site.logo) profile.logo = site.logo;
  if (site.facebook) profile.facebook = site.facebook;
  if (site.instagram) profile.instagram = site.instagram;
  const gbp = (input.gbpUrl || '').trim();
  return {
    site,
    text,
    profile,
    hours: hoursOf(text),
    license: licenseOf(text),
    gbpNote: gbp
      ? 'Google Business Profile link saved. Miles does not read ratings or hours from Google without a Places key, so nothing was guessed.'
      : 'No Google Business Profile link yet.',
  };
}

export function websiteAudit(html: string, url: string): AuditCard {
  if (!html) {
    return { id: 'website', title: 'Website audit', source: 'No page was fetched', summary: 'Paste a website Miles can read. Nothing was scored.' };
  }
  const findings = runAuditChecks(html, url.startsWith('http') ? url : `https://${url}`);
  const score = scoreFindings(findings);
  const bad = findings.filter((f) => f.status !== 'good').slice(0, 3).map((f) => f.label);
  return {
    id: 'website',
    title: 'Website audit',
    source: 'Read from the page HTML. Not a guess.',
    summary: bad.length ? `Score ${score}/100 (${gradeFor(score)}). First fixes: ${bad.join(', ')}.` : `Score ${score}/100 (${gradeFor(score)}). No failed checks on this page.`,
    score,
    grade: gradeFor(score),
  };
}

export function competitorAudit(competitors: string[]): AuditCard {
  const urls = competitors.map((s) => s.trim()).filter(Boolean);
  const blocked = CHANNELS.filter((c) => c.coverage !== 'crawl').map((c) => c.label);
  return {
    id: 'competitor',
    title: 'Competitor audit',
    source: urls.length ? 'Competitor websites you named. Public pages only.' : 'No competitor websites were provided.',
    summary: urls.length
      ? `${urls.length} site${urls.length === 1 ? '' : 's'} listed: ${urls.join(', ')}. Competitor ad spend is not available. ${blocked.join(', ')} have no API Miles can query.`
      : 'No competitor websites yet. Miles will not invent competitors or their spend. Google Ads Transparency and the Meta Ad Library are not available here.',
  };
}

export function performanceAudit(args: { trade: string; hasSpend: boolean; demo: boolean }): AuditCard {
  const play = playbookCard(args.trade);
  if (args.demo) {
    return { id: 'performance', title: 'Performance audit', source: 'Preview connector', summary: 'This environment is not your live ad account. No performance numbers are shown.' };
  }
  if (!args.hasSpend) {
    return { id: 'performance', title: 'Performance audit', source: play.benchmarkNote, summary: 'No campaign spend is on file yet. ' + play.benchmarkNote };
  }
  return { id: 'performance', title: 'Performance audit', source: 'Connected ad account, compared with the benchmark file where a row exists.', summary: play.benchmarkNote };
}

export function buildBundle(input: CrawlInput & SetupAnswers & { mode?: MilesMode; areaModes?: Partial<Record<MilesArea, MilesMode>>; caps?: Partial<Caps>; now?: Date }): MilesBundle {
  const facts = crawlFacts(input);
  const trade = facts.profile.industry || 'painting';
  const city = (facts.profile.serviceAreas || input.location || 'Your area').split(',')[0] || 'Your area';
  const daily = input.dailyBudget > 0 ? input.dailyBudget : DEFAULT_CAPS.dailyBudget;
  const share = Math.min(1, Math.max(0, input.googleShare));
  const googleDaily = Math.round(daily * share * 100) / 100;
  const otherDaily = Math.round((daily - googleDaily) * 100) / 100;
  const services = deriveServiceLines(facts.profile.services, trade);
  const spec = buildCampaignSpec(
    { goal: input.goal, dailyBudget: googleDaily || daily, finalUrl: facts.profile.website || 'https://example.com', locations: [city] },
    { business: shortBrand(facts.profile.businessName, trade, city), trade, city, services: services.join(', ') },
  );
  const feas = feasibility({ dailyBudget: daily, leadsPerDay: input.leadsPerDay, trade, now: input.now });
  const seo: SeoDraft[] = services.slice(0, 3).map((service) => ({
    path: '/' + service.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    title: `${service} in ${city}`,
    description: `${service} for homes in ${city}. Call to schedule a visit.`,
    status: 'draft' as const,
  }));
  const social: SocialDraft[] = [0, 1, 2].map((i) => ({
    day: `Day ${i + 1}`,
    caption: `${facts.profile.businessName || 'We'} do ${services[i % services.length] || trade} in ${city}. Ask about timing.`,
    status: 'needs_approval' as const,
    note: 'Draft only. Miles does not publish a post until the mode and a connected page allow it. No image was generated.',
  }));
  const caps: Caps = {
    dailyBudget: input.caps?.dailyBudget ?? daily,
    monthlyCeiling: input.caps?.monthlyCeiling ?? Math.round(daily * 30),
    maxChangePct: input.caps?.maxChangePct ?? DEFAULT_CAPS.maxChangePct,
    paused: input.caps?.paused ?? false,
  };
  return {
    setup: {
      mode: input.mode ?? 'hybrid',
      areaModes: input.areaModes ?? {},
      caps,
      businessName: facts.profile.businessName || '',
      location: city,
      email: input.email || '',
      website: facts.profile.website || '',
      gbpUrl: input.gbpUrl || '',
      gbpNote: facts.gbpNote,
      competitors: (input.competitors ?? []).map((s) => s.trim()).filter(Boolean),
      goal: input.goal,
      leadsPerDay: input.leadsPerDay,
      googleShare: share,
    },
    profile: { ...facts.profile, hours: facts.hours, license: facts.license },
    playbook: feas.playbook,
    feasibility: feas,
    audits: [
      websiteAudit(input.html || '', input.website || ''),
      competitorAudit(input.competitors ?? []),
      performanceAudit({ trade, hasSpend: false, demo: false }),
    ],
    spec,
    seo,
    social,
    channels: [
      { id: 'google', label: 'Google Search', daily: googleDaily || daily, status: 'runnable', note: 'This is the channel Miles can create and enable. Other channels are not in this build.' },
      { id: 'meta', label: 'Meta', daily: 0, status: 'coming_later', note: 'Coming later. Miles is not building or launching Meta in this version.' },
      { id: 'tiktok', label: 'TikTok', daily: 0, status: 'coming_later', note: 'Coming later. Not part of this Google-only path.' },
      { id: 'lsa', label: 'Local Services Ads', daily: 0, status: 'coming_later', note: 'Coming later. The playbook likes this channel. Miles cannot create it yet.' },
    ],
    hours: facts.hours,
    license: facts.license,
  };
}
