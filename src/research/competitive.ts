/**
 * Competitive audit — you against your five closest competitors, per channel.
 *
 * The input to the whole acquisition loop: an owner supplies their site and up
 * to five rivals, and every channel gets audited for all of them, so the answer
 * to "what should I do differently" comes from measurement rather than opinion.
 *
 * The honest part, and the reason this module exists rather than a single
 * scoring function: THE CHANNELS DO NOT HAVE EQUAL DATA. A competitor's website
 * can be crawled directly — it is public and serving it to anyone who asks is
 * the point of it. Their ads mostly cannot: Meta's Ad Library API withholds US
 * commercial ads, Google's Transparency Center has no API, and no public source
 * exists for anyone's email programme at all. So each channel declares what it
 * can actually see, and a channel with no source says so instead of producing a
 * confident-looking score from nothing.
 */
import { auditSite, type AuditArea, type AuditResult } from './audit.js';

/** How competitor data for a channel can be obtained. */
export type Coverage =
  /** Public and directly readable — we fetch it ourselves. */
  | 'crawl'
  /** Public to a human, but with no API we may use. Filled by capture. */
  | 'capture'
  /** No source, public or licensed, that yields competitor data. */
  | 'none';

export interface ChannelSpec {
  id: string;
  label: string;
  coverage: Coverage;
  /** Stated to the owner, so an empty panel is explained rather than mysterious. */
  note: string;
}

export const CHANNELS: ChannelSpec[] = [
  { id: 'seo', label: 'SEO / Website', coverage: 'crawl', note: 'Crawled directly — a public website is served to anyone who asks.' },
  { id: 'local', label: 'Local Presence (GBP)', coverage: 'crawl', note: 'Read from Google Places. Needs GOOGLE_PLACES_KEY.' },
  { id: 'google_ads', label: 'Google Ads', coverage: 'capture', note: 'Google\'s Ads Transparency Center is public but has no API — captured, not crawled.' },
  { id: 'meta', label: 'Meta (Facebook / Instagram)', coverage: 'capture', note: 'The Ad Library API withholds US commercial ads. Captured from the web UI, or from a licensed feed.' },
  { id: 'tiktok', label: 'TikTok', coverage: 'capture', note: 'TikTok\'s Creative Center is public but has no API for competitor ads.' },
  { id: 'youtube', label: 'YouTube', coverage: 'capture', note: 'Covered by Google\'s Ads Transparency Center — same limitation as Google Ads.' },
  { id: 'email', label: 'Email', coverage: 'none', note: 'No public or licensed source exists for a competitor\'s email programme. The only way in is to subscribe to their list yourself.' },
];

export const MAX_COMPETITORS = 5;

export interface SiteAudit {
  url: string;
  /** Whose site this is — the comparison is meaningless without it. */
  role: 'you' | 'competitor';
  ok: boolean;
  result?: AuditResult;
  /** Why an audit failed, in words, rather than a silent gap in the table. */
  error?: string;
}

const AREAS: AuditArea[] = ['Trust', 'SEO', 'Conversion', 'Mobile', 'Local', 'AI Search', 'Content'];

/** Weighted 0–100 score for one area of one audit, or null when unmeasured. */
export function areaScore(result: AuditResult, area: AuditArea): number | null {
  const inArea = result.findings.filter((f) => f.area === area);
  if (!inArea.length) return null;
  const total = inArea.reduce((s, f) => s + f.weight, 0);
  if (!total) return null;
  const earned = inArea.reduce((s, f) => s + f.weight * (f.status === 'good' ? 1 : f.status === 'warn' ? 0.5 : 0), 0);
  return Math.round((earned / total) * 100);
}

export interface AreaGap {
  area: AuditArea;
  you: number | null;
  /** Best score any competitor achieved in this area. */
  best: number | null;
  bestBy: string | null;
  /** Mean across competitors that produced a score. */
  average: number | null;
  /** Positive means competitors are ahead of you by this many points. */
  behindBy: number | null;
  verdict: 'ahead' | 'level' | 'behind' | 'unknown';
}

/**
 * Where you stand per area. Compares against the BEST competitor rather than
 * the average: an owner is not trying to beat the mean of their market, they
 * are trying to beat whoever is currently taking the jobs.
 */
export function compareAreas(audits: SiteAudit[]): AreaGap[] {
  const you = audits.find((a) => a.role === 'you' && a.ok)?.result;
  const rivals = audits.filter((a) => a.role === 'competitor' && a.ok && a.result);
  return AREAS.map((area) => {
    const mine = you ? areaScore(you, area) : null;
    const theirs = rivals
      .map((r) => ({ url: r.url, score: areaScore(r.result!, area) }))
      .filter((x): x is { url: string; score: number } => x.score !== null);
    if (!theirs.length || mine === null) {
      return { area, you: mine, best: null, bestBy: null, average: null, behindBy: null, verdict: 'unknown' as const };
    }
    const top = theirs.reduce((a, b) => (b.score > a.score ? b : a));
    const average = Math.round(theirs.reduce((s, t) => s + t.score, 0) / theirs.length);
    const behindBy = top.score - mine;
    return {
      area,
      you: mine,
      best: top.score,
      bestBy: top.url,
      average,
      behindBy,
      // A few points either way is noise on a checklist score, not a finding.
      verdict: behindBy > 8 ? 'behind' : behindBy < -8 ? 'ahead' : 'level',
    };
  });
}

/** Tidy a typed-in domain into something fetchable. */
export function normalizeUrl(input: string): string | null {
  const s = String(input || '').trim();
  if (!s) return null;
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    if (!u.hostname.includes('.')) return null;
    return u.origin + (u.pathname === '/' ? '' : u.pathname);
  } catch {
    return null;
  }
}

export interface CompetitiveAudit {
  ts: string;
  you: string | null;
  audits: SiteAudit[];
  gaps: AreaGap[];
  channels: (ChannelSpec & { ready: boolean })[];
  /** Ranked worst-first: where a competitor most out-performs you. */
  priorities: AreaGap[];
}

/**
 * Audit your site and up to five competitors. One site failing never sinks the
 * run — it comes back marked with the reason, because a missing row that says
 * why is far more useful than a table that silently lost a competitor.
 */
export async function competitiveAudit(yourUrl: string, competitorUrls: string[]): Promise<CompetitiveAudit> {
  const mine = normalizeUrl(yourUrl);
  const rivals = competitorUrls
    .map(normalizeUrl)
    .filter((u): u is string => !!u)
    .filter((u) => u !== mine)
    .slice(0, MAX_COMPETITORS);

  const one = async (url: string, role: SiteAudit['role']): Promise<SiteAudit> => {
    try {
      const result = await auditSite(url);
      return result ? { url, role, ok: true, result } : { url, role, ok: false, error: 'Could not read that site — it may be blocking automated requests.' };
    } catch (err) {
      return { url, role, ok: false, error: (err as Error).message || 'Could not read that site.' };
    }
  };

  const audits = await Promise.all([
    ...(mine ? [one(mine, 'you' as const)] : []),
    ...rivals.map((u) => one(u, 'competitor' as const)),
  ]);

  const gaps = compareAreas(audits);
  return {
    ts: new Date().toISOString(),
    you: mine,
    audits,
    gaps,
    channels: CHANNELS.map((c) => ({
      ...c,
      // 'ready' means this channel can produce competitor data right now.
      ready: c.coverage === 'crawl' && (c.id !== 'local' || !!process.env.GOOGLE_PLACES_KEY),
    })),
    priorities: gaps
      .filter((g) => g.verdict === 'behind')
      .sort((a, b) => (b.behindBy ?? 0) - (a.behindBy ?? 0)),
  };
}
