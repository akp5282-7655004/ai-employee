/**
 * Miles builds a paused Search plan from a website, the profile, and the
 * trade playbook. Missing facts fall back to a labeled estimate. Nothing here
 * is a performance guarantee.
 */
import { budgetCaution, buildCampaignSpec, deriveServiceLines, shortBrand, type CampaignSpec } from './campaign.js';
import { parseSiteHtml, type SiteImport } from '../research/site.js';

export interface Sourced {
  value: string;
  source: string;
  estimated: boolean;
}

export interface MilesPlan {
  trade: Sourced;
  services: Sourced;
  area: Sourced;
  phone: Sourced;
  landing: Sourced;
  dailyBudget: Sourced;
  targetCpl: Sourced;
  jobValue: Sourced;
  hours: Sourced;
  license: Sourced;
  brand: Sourced;
  spec: CampaignSpec;
  budgetCaution: { warn: boolean; daysPerLead: number | null; message: string };
  note: string;
}

export interface PlanProfile {
  businessName?: string;
  industry?: string;
  services?: string;
  serviceAreas?: string;
  website?: string;
  phone?: string;
  dailyBudget?: string | number;
  targetCpl?: string | number;
  averageJobValue?: string | number;
}

const ESTIMATE: Record<string, { daily: number; cpl: number; job: number; note: string }> = {
  painting: { daily: 40, cpl: 80, job: 1800, note: 'Miles planning estimate for painting. Not a measured benchmark and not a guarantee.' },
  plumbing: { daily: 40, cpl: 57, job: 1714, note: 'Plumbing cost per lead ($57) and average job ($1,714) are from the February 2026 local services benchmark. The $40 daily budget is a Miles planning estimate, not a guarantee.' },
  hvac: { daily: 50, cpl: 51, job: 2110, note: 'HVAC cost per lead ($51) and average job ($2,110) are from the February 2026 local services benchmark. The daily budget is a Miles planning estimate, not a guarantee.' },
  electrical: { daily: 40, cpl: 39, job: 1434, note: 'Electrical cost per lead ($39) and average job ($1,434) are from the February 2026 local services benchmark. The daily budget is a Miles planning estimate, not a guarantee.' },
  roofing: { daily: 60, cpl: 79, job: 1800, note: 'Roofing cost per lead ($79) is from the Q1 2026 local services benchmark. Job value and daily budget are Miles planning estimates, not guarantees.' },
};

function num(v: string | number | undefined): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function tradeOf(site: Partial<SiteImport> | null, profile: PlanProfile): { key: string; label: string; source: string; estimated: boolean } {
  const fromSite = site?.industry;
  const fromProfile = profile.industry;
  const raw = fromSite || fromProfile || '';
  const key = raw.toLowerCase().includes('paint') ? 'painting'
    : raw.toLowerCase().includes('plumb') ? 'plumbing'
    : raw.toLowerCase().includes('hvac') || /air condition/i.test(raw) ? 'hvac'
    : raw.toLowerCase().includes('electric') ? 'electrical'
    : raw.toLowerCase().includes('roof') ? 'roofing'
    : '';
  if (fromSite && key) return { key, label: fromSite, source: 'website', estimated: false };
  if (fromProfile && key) return { key, label: fromProfile, source: 'profile', estimated: false };
  return { key: 'painting', label: 'Painting', source: 'playbook default because the site and profile did not name a trade', estimated: true };
}

export function readSite(html: string, url: string): Partial<SiteImport> {
  return parseSiteHtml(html, url);
}

export function buildMilesPlan(args: { profile?: PlanProfile; site?: Partial<SiteImport> | null; connectedAds?: boolean }): MilesPlan {
  const profile = args.profile ?? {};
  const site = args.site ?? null;
  const trade = tradeOf(site, profile);
  const estimate = ESTIMATE[trade.key] ?? ESTIMATE.painting!;
  const serviceBlob = [site?.services, profile.services, site?.description, site?.tagline].filter(Boolean).join('. ');
  const lines = deriveServiceLines(serviceBlob, trade.label);
  const servicesFromSite = !!(site?.services || (site?.description && /interior|exterior|cabinet|commercial|drain|roof/i.test(site.description)));
  const area = site?.serviceAreas || site?.city || profile.serviceAreas || '';
  const phone = site?.phone || profile.phone || '';
  const landing = profile.website || site?.website || '';
  const dailyProfile = num(profile.dailyBudget);
  const cplProfile = num(profile.targetCpl);
  const jobProfile = num(profile.averageJobValue);
  const daily = dailyProfile ?? estimate.daily;
  const cpl = cplProfile ?? estimate.cpl;
  const job = jobProfile ?? estimate.job;
  const city = (area || 'Your area').split(',')[0]?.trim() || 'Your area';
  const spec = buildCampaignSpec(
    { dailyBudget: daily, finalUrl: landing || 'https://example.com', locations: area ? area.split(',').map((s) => s.trim()).filter(Boolean) : [city] },
    { business: shortBrand(site?.businessName || profile.businessName, trade.label, city), trade: trade.label, city, services: lines.join(', ') },
  );
  const hours = /hour|mon(day)?|open/i.test(site?.description || '') ? 'See the website text' : '';
  const license = /licen[sc]e/i.test(`${site?.description || ''} ${site?.tagline || ''}`) ? 'Mentioned on the site' : '';
  return {
    trade: { value: trade.label, source: trade.source, estimated: trade.estimated },
    services: { value: lines.join(', '), source: servicesFromSite ? 'website service lines, offer phrases removed' : `trade playbook for ${trade.key}`, estimated: !servicesFromSite },
    area: { value: area || city, source: site?.serviceAreas || site?.city ? 'website' : profile.serviceAreas ? 'profile' : 'not found, city placeholder', estimated: !(site?.serviceAreas || site?.city || profile.serviceAreas) },
    phone: { value: phone || 'Not found', source: site?.phone ? 'website' : profile.phone ? 'profile' : 'not on the site', estimated: false },
    landing: { value: landing || 'Not found', source: profile.website ? 'profile website' : site?.website ? 'crawled url' : 'not on file', estimated: false },
    dailyBudget: { value: String(daily), source: dailyProfile ? 'profile' : estimate.note, estimated: !dailyProfile },
    targetCpl: { value: String(cpl), source: cplProfile ? 'profile' : estimate.note, estimated: !cplProfile },
    jobValue: { value: String(job), source: jobProfile ? 'profile' : estimate.note, estimated: !jobProfile },
    hours: { value: hours || 'Not found on the site', source: hours ? 'website' : 'not on the site', estimated: false },
    license: { value: license || 'Not found on the site', source: license ? 'website' : 'not on the site', estimated: false },
    brand: { value: spec.businessName || '', source: site?.businessName ? 'website name, shortened' : 'profile or trade', estimated: !site?.businessName },
    spec,
    budgetCaution: budgetCaution(daily, cpl),
    note: args.connectedAds
      ? 'Google Ads is connected. This plan is paused until you approve it.'
      : 'Connect Google Ads before Miles can create the paused campaign. The plan itself does not spend.',
  };
}
