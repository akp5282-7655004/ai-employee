/**
 * Your Business page view.
 *
 * Every percent, "N to add" badge, missing chip, connection pill, and website
 * score is computed from saved profile, brand, photos, crawl, and connector
 * state. Empty stays empty. Nothing here invents a competitor, a photo, a
 * connection, or an audit score.
 */
import type { MilesMode } from '../agents/policy.js';
import { formatSetupLine, MODE_PILLS } from '../dashboard/operator.js';

export interface BusinessCaps {
  dailyBudget: number;
  monthlyCeiling: number;
  maxChangePct: number;
  paused: boolean;
}

export interface BusinessFound {
  pagesRead: number;
  businessName: string;
  phone: string;
  services: string;
  website: string;
  crawledAt?: string;
}

export interface BusinessProfileInput {
  profile: Record<string, unknown>;
  brand: {
    tagline?: string;
    colors?: string[];
    fonts?: string;
    logoUrl?: string;
    voice?: string;
    /** Explicit audience only. Do not pass a sentence derived from the city. */
    audience?: string;
    avoid?: string;
  };
  photos: { url: string }[];
  caps: BusinessCaps | null;
  /** Saved daily number when no plan cap exists yet. */
  profileDaily: number | null;
  goal: string;
  hasBundle: boolean;
  leadsPerDay: number | null;
  mode: MilesMode | null;
  paused: boolean;
  /** City or market already used on the operator setup line. */
  market: string;
  found: BusinessFound | null;
  /** Facts the crawl itself extracted. Used only for the "what was found" line. */
  crawlFound: { logo?: string; brandColors?: string };
  websiteAudit: { summary?: string } | null;
  google: { oauth: boolean; ready: boolean; note: string };
  ghlConnected: boolean;
  ghlDetail: string;
  gbpConnected: boolean;
  facebookConnected: boolean;
  instagramConnected: boolean;
  linkedinConnected: boolean;
}

export interface BusinessField {
  id: string;
  label: string;
  filled: boolean;
  value: string;
  hint: string;
  wide?: boolean;
  href?: string;
  connect?: string;
}

export interface BusinessSection {
  id: string;
  title: string;
  blurb: string;
  fields: BusinessField[];
  emptyCount: number;
  badge: string;
}

export interface BusinessDraft {
  businessName: string;
  industry: string;
  yearStarted: string;
  phone: string;
  email: string;
  website: string;
  description: string;
  city: string;
  state: string;
  zip: string;
  serviceAreas: string;
  services: string;
  topServices: string;
  avgTicket: string;
  currentOffers: string;
  goal: string;
  dailyBudget: string;
  leadsPerDay: string;
  targetCpa: string;
  idealCustomer: string;
  runningAds: string;
  tagline: string;
  voice: string;
  audience: string;
  fonts: string;
  avoid: string;
  competitors: string;
  colors: string[];
  logoUrl: string;
}

export interface BusinessProfileView {
  title: string;
  subtitle: string;
  percent: number;
  filledCount: number;
  totalCount: number;
  missingChips: string[];
  banner: string;
  setupLine: string;
  sampleLegend: string;
  mode: MilesMode | null;
  modes: { id: MilesMode; label: string }[];
  paused: boolean;
  caps: BusinessCaps | null;
  sections: BusinessSection[];
  draft: BusinessDraft;
  photos: { url: string }[];
  preview: { name: string; phone: string; offer: string; colors: string[] };
  websiteRead: { host: string; url: string; lastRead: string | null; found: string[]; canReread: boolean; line: string };
  websiteCheck: { score: number | null; checked: boolean; fixes: string[]; line: string };
  accounts: {
    google: { pill: string; detail: string; fix: boolean; connect: boolean };
    ghl: { pill: string; detail: string; connect: boolean };
    meta: { pill: string; detail: string };
  };
  social: { pill: string; detail: string; connectSlug: string | null };
  footer: string;
  footerNext: string;
}

const CHIP_LABEL: Record<string, string> = {
  topServices: 'Most profitable jobs',
  currentOffers: 'Current offer',
  competitors: 'Main competitors',
  tagline: 'Tagline',
  photos: 'Job photos',
  yearStarted: 'Year founded',
  businessName: 'Business name',
  industry: 'Trade',
  phone: 'Phone',
  website: 'Website',
  serviceAreas: 'Service area',
  services: 'Services',
  goal: 'Goal',
  dailyBudget: 'Daily budget',
  leadsPerDay: 'Leads you want',
};

const CHIP_ORDER = [
  'Most profitable jobs',
  'Current offer',
  'Main competitors',
  'Tagline',
  'Job photos',
  'Year founded',
  'Business name',
  'Trade',
  'Phone',
  'Website',
  'Service area',
  'Services',
  'Goal',
  'Daily budget',
  'Leads you want',
];

const HINT: Record<string, string> = {
  yearStarted: '+ Add. "since 2012" builds trust',
  topServices: '+ Add. Miles pushes these first',
  currentOffers: '+ Add. e.g. 15% off a second room',
  competitors: '+ Add. Add 2-3 so Miles can watch their ads',
  tagline: '+ Add. e.g. "Clean lines, on time"',
  photos: 'Upload',
};

function plain(s: string): string {
  return s.replace(/\u2014/g, ' - ').replace(/\u2013/g, '-').replace(/\s{2,}/g, ' ').trim();
}

function text(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => String(x ?? '').trim()).filter(Boolean).join(', ');
  if (v == null) return '';
  return String(v).trim();
}

function posNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
  const n = Number(String(v ?? '').replace(/[$,]/g, '').trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

function httpUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  try {
    const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.href;
  } catch {
    return '';
  }
}

function hostOf(raw: string): string {
  const href = httpUrl(raw);
  if (!href) return '';
  try {
    return new URL(href).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

function handleOf(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  if (t.startsWith('@')) return t;
  const href = httpUrl(t);
  if (!href) return t;
  try {
    const u = new URL(href);
    const path = u.pathname.replace(/\/+$/, '').split('/').filter(Boolean).pop() || '';
    if (path && !/^(profile|pages|home)$/i.test(path)) return path.startsWith('@') ? path : `@${path.replace(/^@/, '')}`;
    return u.hostname.replace(/^www\./i, '');
  } catch {
    return t;
  }
}

function shortDate(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function hintFor(id: string): string {
  return HINT[id] || '+ Add';
}

function websiteCheckOf(audit: { summary?: string } | null): BusinessProfileView['websiteCheck'] {
  const summary = plain(audit?.summary || '');
  const matched = summary.match(/Score\s+(\d+)\/100/);
  if (!matched) {
    return {
      score: null,
      checked: false,
      fixes: [],
      line: summary || 'Not checked yet. Read your website and Miles will score the page it can see.',
    };
  }
  const score = Number(matched[1] ?? '');
  const fixMatch = summary.match(/First fixes:\s*(.+)$/);
  const fixText = fixMatch?.[1] ?? '';
  const fixes = fixText
    ? fixText.replace(/\.$/, '').split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  const line = fixes.length
    ? `${fixes.length} quick fix${fixes.length === 1 ? '' : 'es'}: ${fixes.join(', ')}`
    : 'No failed checks on the last page Miles read.';
  return { score, checked: true, fixes, line: plain(line) };
}

function googleAccount(input: BusinessProfileInput): BusinessProfileView['accounts']['google'] {
  if (!input.google.oauth) {
    return { pill: 'Not connected', detail: 'Not connected.', fix: false, connect: true };
  }
  const note = plain(input.google.note || '');
  if (input.google.ready) {
    return { pill: 'Connected', detail: note || 'Customer id is resolved.', fix: false, connect: false };
  }
  const unresolved = /customer id|not resolved|no accessible|no ad account/i.test(note) || !note;
  return {
    pill: unresolved ? 'Customer ID not found' : 'Not ready',
    detail: note || 'Google is signed in. The ad customer id is not resolved.',
    fix: unresolved,
    connect: false,
  };
}

function socialOf(input: BusinessProfileInput): BusinessProfileView['social'] {
  const nets = [
    { slug: 'facebook_pages', name: 'Facebook', on: input.facebookConnected },
    { slug: 'instagram', name: 'Instagram', on: input.instagramConnected },
    { slug: 'linkedin', name: 'LinkedIn', on: input.linkedinConnected },
  ];
  const on = nets.filter((n) => n.on);
  const off = nets.filter((n) => !n.on);
  if (!on.length) {
    return { pill: 'Not connected', detail: 'Not connected.', connectSlug: 'facebook_pages' };
  }
  if (!off.length) {
    return { pill: 'Connected', detail: 'Facebook, Instagram, and LinkedIn are connected for posting. This is not a Meta ad account.', connectSlug: null };
  }
  return {
    pill: 'Partly connected',
    detail: plain(`${on.map((n) => n.name).join(', ')} connected. ${off.map((n) => n.name).join(' and ')} ${off.length === 1 ? 'is' : 'are'} not.`),
    connectSlug: off[0]!.slug,
  };
}

export function buildBusinessProfile(input: BusinessProfileInput): BusinessProfileView {
  const p = input.profile || {};
  const colors = (input.brand.colors || []).map((c) => c.trim()).filter((c) => /^#?[0-9a-fA-F]{6}$/.test(c)).map((c) => (c.startsWith('#') ? c : `#${c}`)).slice(0, 5);
  const logoUrl = text(input.brand.logoUrl);
  const tagline = text(input.brand.tagline);
  const voice = text(input.brand.voice);
  const audience = text(input.brand.audience);
  const fonts = text(input.brand.fonts);
  const avoid = text(input.brand.avoid);
  const photos = (input.photos || []).filter((ph) => text(ph.url));

  const city = text(p.city);
  const state = text(p.state);
  const zip = text(p.zip);
  const basedCore = [city, state].filter(Boolean).join(', ');
  const based = text(p.address) && !basedCore && !zip
    ? text(p.address)
    : [basedCore, zip].filter(Boolean).join(' ');

  const capDaily = input.caps && posNum(input.caps.dailyBudget);
  const dailyNum = capDaily || (!input.caps ? input.profileDaily : null);
  const monthNum = capDaily && input.caps && posNum(input.caps.monthlyCeiling) ? Math.round(input.caps.monthlyCeiling) : null;
  const dailyValue = dailyNum
    ? (monthNum ? `${money(dailyNum)}/day · ${money(monthNum)}/mo` : `${money(dailyNum)}/day`)
    : '';
  const leadsNum = posNum(input.leadsPerDay);
  const goalText = text(p.goal) || (input.hasBundle ? text(input.goal) : '');
  const avgRaw = text(p.avgTicket) || text(p.averageJobValue);
  const avgNum = posNum(avgRaw);
  const avgValue = avgRaw ? (avgNum ? money(avgNum) : avgRaw) : '';
  const targetNum = posNum(p.targetCpa);
  const gbpUrl = httpUrl(text(p.gbpUrl));
  const facebookUrl = httpUrl(text(p.facebook));
  const instagramUrl = httpUrl(text(p.instagram));

  const fields: { section: string; field: BusinessField }[] = [];
  const put = (section: string, field: BusinessField) => fields.push({ section, field });

  put('basics', { id: 'businessName', label: 'Business name', filled: !!text(p.businessName), value: text(p.businessName), hint: hintFor('businessName') });
  put('basics', { id: 'industry', label: 'Trade', filled: !!text(p.industry), value: text(p.industry), hint: hintFor('industry') });
  put('basics', { id: 'yearStarted', label: 'Year founded', filled: !!text(p.yearStarted), value: text(p.yearStarted), hint: hintFor('yearStarted') });
  put('basics', { id: 'phone', label: 'Phone', filled: !!text(p.phone), value: text(p.phone), hint: hintFor('phone') });
  put('basics', { id: 'email', label: 'Email', filled: !!text(p.email), value: text(p.email), hint: hintFor('email') });
  put('basics', { id: 'website', label: 'Website', filled: !!text(p.website), value: hostOf(text(p.website)) || text(p.website), hint: hintFor('website') });
  put('basics', { id: 'description', label: 'What makes you different', filled: !!text(p.description), value: text(p.description), hint: hintFor('description'), wide: true });

  put('brand', { id: 'logo', label: 'Logo', filled: !!logoUrl, value: logoUrl ? 'Logo saved' : '', hint: hintFor('logo') });
  put('brand', { id: 'colors', label: 'Colors', filled: colors.length > 0, value: colors.join(', '), hint: hintFor('colors') });
  put('brand', { id: 'voice', label: 'Voice', filled: !!voice, value: voice, hint: hintFor('voice') });
  put('brand', { id: 'tagline', label: 'Tagline', filled: !!tagline, value: tagline, hint: hintFor('tagline') });
  put('brand', { id: 'audience', label: 'Talk to', filled: !!audience, value: audience, hint: hintFor('audience') });
  put('brand', { id: 'fonts', label: 'Fonts', filled: !!fonts, value: fonts, hint: hintFor('fonts') });
  put('brand', { id: 'avoid', label: 'Never say', filled: !!avoid, value: avoid, hint: hintFor('avoid'), wide: true });

  put('work', { id: 'basedIn', label: 'Based in', filled: !!based, value: based, hint: hintFor('basedIn') });
  put('work', { id: 'serviceAreas', label: 'Service area', filled: !!text(p.serviceAreas), value: text(p.serviceAreas), hint: hintFor('serviceAreas') });
  put('work', { id: 'services', label: 'Services', filled: !!text(p.services), value: text(p.services), hint: hintFor('services'), wide: true });
  put('work', { id: 'topServices', label: 'Most profitable jobs', filled: !!text(p.topServices), value: text(p.topServices), hint: hintFor('topServices') });
  put('work', { id: 'avgTicket', label: 'Average job value', filled: !!avgValue, value: avgValue, hint: hintFor('avgTicket') });
  put('work', { id: 'currentOffers', label: 'Current offer', filled: !!text(p.currentOffers), value: text(p.currentOffers), hint: hintFor('currentOffers') });

  put('photos', { id: 'photos', label: 'Job photos', filled: photos.length > 0, value: photos.length ? `${photos.length} saved` : '', hint: hintFor('photos'), wide: true });

  put('goals', { id: 'goal', label: 'Goal', filled: !!goalText, value: goalText, hint: hintFor('goal') });
  put('goals', { id: 'dailyBudget', label: 'Daily ad budget', filled: !!dailyValue, value: dailyValue, hint: hintFor('dailyBudget') });
  put('goals', { id: 'leadsPerDay', label: 'Leads you want', filled: !!leadsNum, value: leadsNum ? `${leadsNum}/day` : '', hint: hintFor('leadsPerDay') });
  put('goals', { id: 'targetCpa', label: "Most you'll pay per lead", filled: !!targetNum, value: targetNum ? money(targetNum) : '', hint: hintFor('targetCpa') });
  put('goals', { id: 'idealCustomer', label: 'Ideal customer', filled: !!text(p.idealCustomer), value: text(p.idealCustomer), hint: hintFor('idealCustomer') });
  put('goals', { id: 'runningAds', label: 'Ads running before Miles', filled: !!text(p.runningAds), value: text(p.runningAds), hint: hintFor('runningAds') });

  put('presence', {
    id: 'gbp',
    label: 'Google Business Profile',
    filled: input.gbpConnected || !!gbpUrl,
    value: input.gbpConnected ? 'Connected' : (gbpUrl ? 'Link saved' : ''),
    hint: 'Connect',
    href: gbpUrl || undefined,
    connect: !input.gbpConnected && !gbpUrl ? 'google_my_business' : undefined,
  });
  put('presence', {
    id: 'facebook',
    label: 'Facebook',
    filled: input.facebookConnected || !!facebookUrl,
    value: input.facebookConnected ? 'Connected' : (facebookUrl ? handleOf(text(p.facebook)) : ''),
    hint: 'Connect',
    href: facebookUrl || undefined,
    connect: !input.facebookConnected && !facebookUrl ? 'facebook_pages' : undefined,
  });
  put('presence', {
    id: 'instagram',
    label: 'Instagram',
    filled: input.instagramConnected || !!instagramUrl,
    value: input.instagramConnected ? 'Connected' : (instagramUrl ? handleOf(text(p.instagram)) : ''),
    hint: 'Connect',
    href: instagramUrl || undefined,
    connect: !input.instagramConnected && !instagramUrl ? 'instagram' : undefined,
  });
  put('presence', { id: 'competitors', label: 'Main competitors', filled: !!text(p.competitors), value: text(p.competitors), hint: hintFor('competitors'), wide: true });

  const meta: { id: string; title: string; blurb: string }[] = [
    { id: 'basics', title: 'The basics', blurb: 'Used on every ad, post and landing page.' },
    { id: 'brand', title: 'Your brand', blurb: 'Everything Miles makes uses this, so it looks like you, not like AI.' },
    { id: 'work', title: 'Where you work & what you sell', blurb: 'Decides who sees your ads and what they say.' },
    { id: 'goals', title: 'Goals & budget', blurb: 'Miles plans every campaign around these. Change them here and the plan updates.' },
    { id: 'photos', title: 'Job photos', blurb: 'Real photos of your work beat stock every time. Miles uses them in ads and posts.' },
    { id: 'presence', title: 'Online presence & competitors', blurb: "Where homeowners find you, and who you're up against." },
  ];
  const sections: BusinessSection[] = meta.map((m) => {
    const list = fields.filter((f) => f.section === m.id).map((f) => f.field);
    const emptyCount = list.filter((f) => !f.filled).length;
    return {
      ...m,
      blurb: plain(m.blurb),
      fields: list,
      emptyCount,
      badge: emptyCount === 0 ? 'Complete' : `${emptyCount} to add`,
    };
  });

  const all = sections.flatMap((s) => s.fields);
  const filledCount = all.filter((f) => f.filled).length;
  const totalCount = all.length;
  const percent = totalCount ? Math.round((100 * filledCount) / totalCount) : 0;
  const missingChips = CHIP_ORDER.filter((label) => {
    const id = Object.entries(CHIP_LABEL).find(([, name]) => name === label)?.[0];
    const field = id ? all.find((f) => f.id === id) : undefined;
    return !!field && !field.filled;
  });

  const readHappened = !!(input.found && (input.found.pagesRead > 0 || input.found.crawledAt));
  const foundBits: string[] = [];
  if (readHappened && input.found) {
    if (text(input.found.businessName)) foundBits.push('name');
    if (text(input.found.phone)) foundBits.push('phone');
    if (text(input.found.services)) foundBits.push('services');
    if (text(input.crawlFound.logo)) foundBits.push('logo');
    if (text(input.crawlFound.brandColors)) foundBits.push('colors');
  }
  const siteRaw = text(p.website) || text(input.found?.website);
  const host = hostOf(siteRaw);
  const lastRead = readHappened ? shortDate(input.found?.crawledAt) : null;
  const readLine = !readHappened
    ? 'Not read yet.'
    : foundBits.length
      ? `Last read ${lastRead || 'recently'} · ${foundBits.join(', ')} found`
      : `Last read ${lastRead || 'recently'}. Nothing usable was found on the page.`;

  let banner: string;
  if (!missingChips.length) banner = 'The answers Miles uses for ads and posts are filled in. You can still edit anything below.';
  else if (input.found && input.found.pagesRead > 0) banner = `Miles filled what it could from your website. These ${missingChips.length} answer${missingChips.length === 1 ? '' : 's'} would make your ads and posts noticeably better:`;
  else banner = `These ${missingChips.length} answer${missingChips.length === 1 ? '' : 's'} are still blank. Fill them in, or read your website and Miles will fill what it can:`;

  const setupLine = formatSetupLine({
    trade: text(p.industry),
    market: text(input.market).split(',')[0]?.trim() || text(p.serviceAreas).split(',')[0]?.trim() || '',
    dailyBudget: input.caps ? input.caps.dailyBudget : null,
    maxChangePct: input.caps ? input.caps.maxChangePct : null,
  });

  const draft: BusinessDraft = {
    businessName: text(p.businessName),
    industry: text(p.industry),
    yearStarted: text(p.yearStarted),
    phone: text(p.phone),
    email: text(p.email),
    website: text(p.website),
    description: text(p.description),
    city,
    state,
    zip,
    serviceAreas: text(p.serviceAreas),
    services: text(p.services),
    topServices: text(p.topServices),
    avgTicket: avgRaw,
    currentOffers: text(p.currentOffers),
    goal: goalText,
    dailyBudget: dailyNum ? String(Math.round(dailyNum)) : '',
    leadsPerDay: leadsNum ? String(leadsNum) : '',
    targetCpa: targetNum ? String(Math.round(targetNum)) : '',
    idealCustomer: text(p.idealCustomer),
    runningAds: text(p.runningAds),
    tagline,
    voice,
    audience,
    fonts,
    avoid,
    competitors: text(p.competitors),
    colors,
    logoUrl,
  };

  return {
    title: 'YOUR BUSINESS',
    subtitle: 'Everything Miles knows about you. Fill the gaps and every ad gets better.',
    percent,
    filledCount,
    totalCount,
    missingChips,
    banner: plain(banner),
    setupLine,
    sampleLegend: 'SAMPLE = example numbers until that source connects',
    mode: input.mode,
    modes: MODE_PILLS,
    paused: input.paused || !!input.caps?.paused,
    caps: input.caps,
    sections,
    draft,
    photos: photos.map((ph) => ({ url: ph.url })),
    preview: {
      name: text(p.businessName),
      phone: text(p.phone),
      offer: text(p.currentOffers),
      colors,
    },
    websiteRead: {
      host,
      url: httpUrl(siteRaw),
      lastRead,
      found: foundBits,
      canReread: !!host,
      line: plain(readLine),
    },
    websiteCheck: websiteCheckOf(input.websiteAudit),
    accounts: {
      google: googleAccount(input),
      ghl: {
        pill: input.ghlConnected ? 'Connected' : 'Not connected',
        detail: plain(input.ghlDetail || (input.ghlConnected ? 'Connected.' : 'Not connected.')),
        connect: !input.ghlConnected,
      },
      meta: { pill: 'Coming soon', detail: 'Coming soon. A Facebook Page is not an ad account.' },
    },
    social: socialOf(input),
    footer: 'Changes save automatically. Miles uses the new details from the next thing it makes.',
    footerNext: "Looking for the plan, leads or Miles mode? They're on your Dashboard and Launch.",
  };
}

const COPY_SKIP = new Set([
  'value', 'href', 'logoUrl', 'offer', 'phone', 'name', 'colors', 'url', 'host', 'draft', 'photos', 'connect',
]);

/** System copy only. Saved answers are skipped so a customer's own dash is not rewritten. */
export function businessCopy(view: BusinessProfileView): string[] {
  const out: string[] = [];
  const walk = (value: unknown, key?: string) => {
    if (key && COPY_SKIP.has(key)) return;
    if (typeof value === 'string') out.push(value);
    else if (Array.isArray(value)) value.forEach((v) => walk(v));
    else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) walk(v, k);
    }
  };
  walk(view);
  return out;
}
