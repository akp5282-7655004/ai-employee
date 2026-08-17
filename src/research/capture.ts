/**
 * Assisted ad capture.
 *
 * Meta's Ad Library API returns full data only for EU-delivered and
 * political/issue ads. US *commercial* ads — a Philadelphia painter's actual
 * competitors — are visible only in the free public web UI. So the analysis
 * engine needs a way to be fed by hand until a licensed feed is wired in.
 *
 * This parses what a person can copy straight out of facebook.com/ads/library
 * into the same CompetitorAd shape the API path produces, so everything
 * downstream is identical no matter where the ads came from.
 *
 * It is deliberately forgiving about layout and deliberately strict about
 * facts: a run length is recorded only when the pasted text actually states
 * one. Nothing is inferred, because a made-up run length would flow straight
 * into the survival numbers that the recommendation rests on.
 */
import type { CompetitorAd } from './adlibrary.js';

export interface CaptureResult {
  ads: CompetitorAd[];
  /** Blocks that carried no usable ad text, so the paste can be corrected. */
  skipped: number;
  /** Ads that parsed but stated no run length — they cannot inform survival. */
  undated: number;
}

const DAY = 86_400_000;

/** "running 37 days", "37 days", "Active for 37 days" */
const DAYS_RE = /\b(?:running|active(?:\s+for)?)?\s*(\d{1,4})\s*days?\b/i;
/** "Started running on Jul 3, 2026" / "Started running on 3 Jul 2026" */
const STARTED_RE = /started running on\s+([A-Za-z0-9 ,]+?)(?:\s*[·|]|$)/i;
/** "· 3 ads" — Meta's own count of near-identical variants in a group. */
const VARIANTS_RE = /\b(\d{1,3})\s*ads?\b/i;
const LIBRARY_ID_RE = /library id[:\s]*([0-9]+)/i;
const META_LINE = /^(sponsored|open drop-?down|see (ad )?details|library id|see summary details)/i;

/** A real calendar date, not a bare year — "2026" parses as Jan 1 and would
 *  silently invent a run length hundreds of days long. */
const HAS_MONTH = /[A-Za-z]{3}|\d{1,2}\s*[/-]\s*\d{1,2}/;

function daysFrom(line: string, now: number): { days?: number; started?: string } {
  const started = STARTED_RE.exec(line);
  if (started?.[1] && HAS_MONTH.test(started[1])) {
    const t = Date.parse(started[1].trim());
    if (Number.isFinite(t) && t <= now) {
      return { days: Math.max(0, Math.round((now - t) / DAY)), started: new Date(t).toISOString() };
    }
  }
  const d = DAYS_RE.exec(line);
  if (d?.[1]) {
    const n = Number(d[1]);
    // A four-digit "day count" is almost always a year that leaked in.
    if (Number.isFinite(n) && n >= 0 && n <= 3650) return { days: n };
  }
  return {};
}

/**
 * Parse pasted Ad Library text. Blocks are separated by blank lines; within a
 * block the first line is the advertiser, any line stating a run length or a
 * start date sets the age, and the remaining prose is the ad copy.
 */
export function parseCapturedAds(raw: string, now = Date.now()): CaptureResult {
  const blocks = String(raw || '')
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n+/)
    .map((b) => b.trim())
    .filter(Boolean);

  const ads: CompetitorAd[] = [];
  let skipped = 0;
  let undated = 0;

  for (const [i, block] of blocks.entries()) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) { skipped++; continue; }

    const page = lines[0]!.replace(/\s*[·|]\s*(sponsored|active).*$/i, '').trim();
    let days: number | undefined;
    let started: string | undefined;
    let variants: number | undefined;
    const bodyLines: string[] = [];

    for (const line of lines.slice(1)) {
      const found = daysFrom(line, now);
      const isMeta = META_LINE.test(line) || LIBRARY_ID_RE.test(line);
      if (found.days !== undefined && days === undefined) {
        days = found.days;
        started = found.started;
        const v = VARIANTS_RE.exec(line);
        if (v?.[1]) variants = Number(v[1]);
        continue; // a status line, not ad copy
      }
      if (isMeta) continue;
      bodyLines.push(line);
    }

    const body = bodyLines.join(' ').replace(/\s+/g, ' ').trim();
    // An advertiser name with no copy tells the analyser nothing.
    if (!body) { skipped++; continue; }
    if (days === undefined) undated++;

    ads.push({
      id: `cap_${i}_${page.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 12)}`,
      page: page || 'Unknown advertiser',
      body,
      platforms: ['facebook'],
      ...(days !== undefined ? { daysRunning: days } : {}),
      ...(started ? { started } : {}),
    });

    // Meta groups near-identical creative and prints "· N ads". That count IS
    // the replication signal, so expand it rather than throwing it away — the
    // copies carry no separate text and exist only to be counted.
    if (variants && variants > 1) {
      for (let k = 1; k < Math.min(variants, 20); k++) {
        ads.push({
          id: `cap_${i}_${k}`,
          page: page || 'Unknown advertiser',
          body,
          platforms: ['facebook'],
          ...(days !== undefined ? { daysRunning: days } : {}),
        });
      }
    }
  }

  return { ads, skipped, undated };
}

/** Ads kept per account. Bounded — this lives in the per-user JSON blob. */
export const CAPTURE_CAP = 400;

export interface CapturedSet {
  ts: string;
  ads: CompetitorAd[];
}

export function readCaptured(data: Record<string, unknown>): CompetitorAd[] {
  const c = data.capturedAds as CapturedSet | undefined;
  return Array.isArray(c?.ads) ? c.ads : [];
}

/** Replace the captured set (mutates `data`). */
export function writeCaptured(data: Record<string, unknown>, ads: CompetitorAd[]): CapturedSet {
  const set: CapturedSet = { ts: new Date().toISOString(), ads: ads.slice(0, CAPTURE_CAP) };
  data.capturedAds = set;
  return set;
}
