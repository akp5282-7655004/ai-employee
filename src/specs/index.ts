/**
 * Platform spec registry — the master build specifications for every ad
 * platform Miles touches, encoded as data (specs/*.json at the repo root)
 * rather than scattered magic numbers. Sources: the owner's master reference
 * docs (docs/specs/*.md), last verified 2026-08.
 *
 *   google_ads — every campaign type (Search, PMax, Demand Gen, Video, …),
 *                asset library limits, launch checklists
 *   lsa_gbp    — Local Services Ads + Google Business Profile completeness
 *   meta_ads   — Meta campaign/ad-set/ad limits, formats, launch checklists
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CampaignSpec } from '../agents/campaign.js';

export type SpecPlatform = 'google_ads' | 'lsa_gbp' | 'meta_ads';
export const SPEC_PLATFORMS: SpecPlatform[] = ['google_ads', 'lsa_gbp', 'meta_ads'];

const cache = new Map<SpecPlatform, unknown>();

/** Load a platform spec (parsed once, cached). Throws if the file is absent. */
export function loadSpec(platform: SpecPlatform): any {
  if (!cache.has(platform)) {
    const raw = readFileSync(join(process.cwd(), 'specs', `${platform}.json`), 'utf8');
    cache.set(platform, JSON.parse(raw));
  }
  return cache.get(platform);
}

/**
 * One line of a spec audit. `manual` means Google requires it but it can only
 * be added in the Google Ads UI today (images, phone verification, GBP link) —
 * Miles' write-chain can't upload those through the connection yet, and we say
 * so instead of pretending.
 */
export interface SpecCheckItem {
  item: string;
  status: 'ok' | 'warn' | 'missing' | 'manual';
  detail: string;
}

/**
 * Audit a built Search campaign against Google's launch checklist from the
 * master spec — what's ready, what's thin, what's absent, and what has to be
 * finished by hand in Google Ads.
 */
export function searchSpecCheck(s: CampaignSpec): SpecCheckItem[] {
  const spec = loadSpec('google_ads');
  const rsa = spec?.campaign_types?.search?.ad_units?.responsive_search_ad ?? {};
  const hlMax = rsa?.headlines?.max_count ?? 15;
  const hlMin = rsa?.headlines?.min_count ?? 3;
  const deMax = rsa?.descriptions?.max_count ?? 4;
  const deMin = rsa?.descriptions?.min_count ?? 2;
  const slRec = spec?.assets_library?.sitelink?.recommended_min ?? 4;
  const slMin = spec?.assets_library?.sitelink?.min_to_serve ?? 2;
  const coMin = spec?.assets_library?.callout?.min_to_serve ?? 2;
  const snMin = spec?.assets_library?.structured_snippet?.fields?.values?.min_count ?? 3;
  const items: SpecCheckItem[] = [];

  items.push({
    item: 'Final URL',
    status: /^https?:\/\//.test(s.finalUrl ?? '') ? 'ok' : 'missing',
    detail: s.finalUrl || 'No landing page URL set.',
  });

  const groups = s.adGroups ?? [];
  const hlCounts = groups.map((g) => g.rsa.headlines.length);
  const deCounts = groups.map((g) => g.rsa.descriptions.length);
  const hlLow = Math.min(...(hlCounts.length ? hlCounts : [0]));
  const deLow = Math.min(...(deCounts.length ? deCounts : [0]));
  items.push({
    item: `Headlines (${hlMin}–${hlMax} per ad)`,
    status: hlLow < hlMin ? 'missing' : hlLow < hlMax ? 'warn' : 'ok',
    detail: hlLow < hlMin
      ? `An ad group has only ${hlLow} — Google requires ${hlMin}.`
      : hlLow < hlMax
        ? `${hlLow}/${hlMax} — serves fine, but Google performs best with all ${hlMax} filled.`
        : `All ad groups max out ${hlMax} headlines.`,
  });
  items.push({
    item: `Descriptions (${deMin}–${deMax} per ad)`,
    status: deLow < deMin ? 'missing' : deLow < deMax ? 'warn' : 'ok',
    detail: deLow < deMin
      ? `An ad group has only ${deLow} — Google requires ${deMin}.`
      : deLow < deMax
        ? `${deLow}/${deMax} — add ${deMax - deLow} more for best serving.`
        : `All ad groups carry ${deMax} descriptions.`,
  });

  const paths = (s.displayPaths ?? []).filter(Boolean);
  items.push({
    item: 'Display paths (2 × ≤15)',
    status: paths.length >= 2 ? 'ok' : paths.length === 1 ? 'warn' : 'warn',
    detail: paths.length ? `yoursite.com/${paths.join('/')}` : 'Optional, but a readable path lifts click-through.',
  });

  const kwEmpty = groups.filter((g) => !g.keywords.length);
  items.push({
    item: 'Keywords + match types',
    status: !groups.length || kwEmpty.length ? 'missing' : 'ok',
    detail: !groups.length
      ? 'No ad groups.'
      : kwEmpty.length
        ? `${kwEmpty.map((g) => `"${g.name}"`).join(', ')} has no keywords.`
        : `${groups.reduce((n, g) => n + g.keywords.length, 0)} keywords across ${groups.length} ad group${groups.length > 1 ? 's' : ''}.`,
  });

  items.push({
    item: 'Negative keywords',
    status: (s.negatives ?? []).length ? 'ok' : 'warn',
    detail: (s.negatives ?? []).length
      ? `${s.negatives!.length} negatives block junk clicks (${s.negatives!.slice(0, 4).join(', ')}…).`
      : 'None set — junk searches (jobs, DIY, free) will eat budget.',
  });

  items.push({ item: 'Bidding strategy', status: s.biddingStrategy ? 'ok' : 'missing', detail: s.biddingStrategy === 'MAXIMIZE_CLICKS' ? 'Maximize clicks (Google enum TARGET_SPEND).' : s.biddingStrategy ?? 'Not set.' });

  const sl = s.sitelinks ?? [];
  items.push({
    item: `Sitelinks (${slRec}+ recommended)`,
    status: sl.length >= slRec ? 'ok' : sl.length >= slMin ? 'warn' : 'missing',
    detail: sl.length ? `${sl.length} sitelinks.` : `Google needs ${slMin} to serve any; ${slRec}+ recommended.`,
  });
  const co = s.callouts ?? [];
  items.push({
    item: 'Callouts (4+ recommended)',
    status: co.length >= 4 ? 'ok' : co.length >= coMin ? 'warn' : 'missing',
    detail: co.length ? `${co.length} callouts.` : `Google needs ${coMin} to serve any.`,
  });
  const sn = s.structuredSnippet;
  items.push({
    item: 'Structured snippet',
    status: sn && sn.values.length >= snMin ? 'ok' : sn ? 'warn' : 'missing',
    detail: sn ? `${sn.header}: ${sn.values.length} values.` : 'Not set.',
  });
  items.push({
    item: 'Business name (≤25)',
    status: s.businessName ? 'ok' : 'warn',
    detail: s.businessName || 'Not set — Google shows your domain instead.',
  });

  // What Google's checklist wants but this connection cannot create — image
  // and phone/GBP assets need the Google Ads UI. Honest, not silently absent.
  const manual = (item: string, detail: string): SpecCheckItem => ({ item, status: 'manual', detail });
  items.push(manual('Business logo (1:1, 1200×1200)', 'Upload once in Google Ads → Assets → Business logo.'));
  items.push(manual('Image assets (1:1 + 1.91:1)', 'Add photos of real work in Google Ads → Assets → Images.'));
  items.push(manual('Call asset (verified phone)', 'Add your number in Google Ads → Assets → Calls.'));
  items.push(manual('Location asset (GBP link)', 'Link your Google Business Profile in Google Ads → Assets → Locations.'));

  return items;
}
