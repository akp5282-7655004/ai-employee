/**
 * Campaign plan review.
 *
 * Run, Start, and Build open this plan before anything is created.
 * Answers are prefilled from the Your Business profile. A gap is one short
 * question, with Miles' suggestion already filled in. New answers are saved
 * back onto the profile so they are not asked again.
 *
 * Automate rule: the plan is not pre-approved until the owner approves the
 * first launch. After that, Automate reuses the saved plan and a later Run
 * can launch it without asking again. Hybrid and Manual always open the plan.
 * Approving in those modes does not become a standing yes for Automate.
 */
import {
  buildCampaignSpec,
  deriveServiceLines,
  normalizeSiteUrl,
  repairCampaignUrls,
  type CampaignSpec,
  type PageLinkRef,
} from './campaign.js';
import { resolveAreas } from './geotarget.js';
import { enforceRulebook, fixAdCapitalization, hoursRange, RULEBOOK_DEFAULTS, STANDARD_NEGATIVES } from './rulebook.js';

export const AUTOMATE_PLAN_RULE =
  'Automate reuses the saved plan only after the owner approves the first launch. Until that approval, and in Hybrid and Manual, Run opens the plan first.';

export interface PlanProfile {
  businessName?: string;
  trade?: string;
  services?: string;
  serviceAreas?: string;
  phone?: string;
  website?: string;
  hours?: string;
  goal?: string;
  dailyBudget?: number;
  leadsPerDay?: number;
  /** Confirmed jobs to avoid. Absent until the owner answers. */
  jobsToAvoid?: string;
  /** Confirmed keywords to prioritize. Absent until the owner answers. */
  keywordFocus?: string;
  gbpUrl?: string;
  links?: PageLinkRef[];
}

export interface PlanQuestion {
  id: 'website' | 'phone' | 'areas' | 'services' | 'budget' | 'goal' | 'hours' | 'avoid' | 'keywords';
  prompt: string;
  suggested: string;
  reason: string;
}

export interface PlanSection {
  id: 'locations' | 'keywords' | 'negatives' | 'ads' | 'assets' | 'budget';
  title: string;
  reason: string;
  body: string;
}

export interface SearchPlan {
  questions: PlanQuestion[];
  spec: CampaignSpec;
  sections: PlanSection[];
  /** True only in Automate after the first approved launch. */
  preapproved: boolean;
  /** Set when the service area did not match a Google location. Approve and launch stays off. */
  locationBlock: string;
}

const BOOK: Record<string, string[]> = {
  painting: ['Interior painting', 'Exterior painting', 'Cabinet painting', 'Commercial painting'],
  plumbing: ['Drain cleaning', 'Water heater', 'Leak repair'],
  hvac: ['Air conditioning', 'Furnace', 'Heat pump'],
  electrical: ['Panel upgrade', 'Wiring', 'EV charger'],
  roofing: ['Leak repair', 'Roof replacement', 'Roof repair'],
};

function tradeKey(trade?: string): string {
  const t = (trade || '').toLowerCase();
  if (t.includes('paint')) return 'painting';
  if (t.includes('plumb')) return 'plumbing';
  if (t.includes('hvac') || t.includes('air condition')) return 'hvac';
  if (t.includes('electric')) return 'electrical';
  if (t.includes('roof')) return 'roofing';
  return '';
}

function blank(value: string | undefined): boolean {
  const text = (value || '').trim();
  return !text || /^(your area|not found|not saved|n\/a|not found on the site)$/i.test(text);
}

function suggestedServices(trade?: string): string {
  const book = BOOK[tradeKey(trade)];
  if (book) return book.join(', ');
  const cleaned = (trade || '').trim();
  return cleaned || 'Local service';
}

/** True when the saved services text itself names a line, not only the trade. */
export function servicesFromCrawl(services: string | undefined, trade: string | undefined): boolean {
  const lines = deriveServiceLines(services, trade);
  if (!lines.length) return false;
  const named = (services || '').toLowerCase();
  if (!named.trim()) return false;
  return lines.some((line) => {
    const stem = line.toLowerCase().split(/\s+/).find((word) => word.length > 3 && word !== 'painting' && word !== 'service');
    return !!stem && named.includes(stem);
  });
}

function splitList(value: string | undefined): string[] {
  return [...new Set((value || '').split(/[\n,]/).map((part) => part.trim()).filter((part) => part.length > 1))];
}

export function planQuestions(profile: PlanProfile): PlanQuestion[] {
  const questions: PlanQuestion[] = [];
  const city = (profile.serviceAreas || '').split(',')[0]?.trim() || '';
  if (!normalizeSiteUrl(profile.website)) {
    questions.push({
      id: 'website',
      prompt: 'What is the website the ads should open?',
      suggested: profile.website || '',
      reason: 'Every ad needs a real landing page. Miles will not invent one.',
    });
  }
  if (!/\d{7,}/.test((profile.phone || '').replace(/\D/g, ''))) {
    questions.push({
      id: 'phone',
      prompt: 'What phone number should the call button use?',
      suggested: profile.phone || '',
      reason: 'The call asset uses the number on your profile.',
    });
  }
  if (blank(profile.serviceAreas)) {
    questions.push({
      id: 'areas',
      prompt: 'Which areas should these ads target?',
      suggested: city || '',
      reason: 'Miles targets people in the service area, presence only.',
    });
  }
  if (!servicesFromCrawl(profile.services, profile.trade)) {
    questions.push({
      id: 'services',
      prompt: 'Which services should the ads push?',
      suggested: suggestedServices(profile.trade),
      reason: 'Each service gets its own ad group. Miles will not guess from a slogan.',
    });
  }
  if (!(profile.dailyBudget && profile.dailyBudget > 0)) {
    questions.push({
      id: 'budget',
      prompt: 'What is the daily budget?',
      suggested: '20',
      reason: 'The default cap is $20 a day until you set another.',
    });
  }
  if (blank(profile.goal)) {
    questions.push({
      id: 'goal',
      prompt: 'What should this campaign do?',
      suggested: 'Get more calls from homeowners',
      reason: 'The goal is saved on the profile so the next plan starts there.',
    });
  }
  if (!hoursRange(profile.hours)) {
    questions.push({
      id: 'hours',
      prompt: 'What hours should the ads run?',
      suggested: '7am to 8pm',
      reason: 'The default schedule is 7:00 to 20:00, all week, until your hours are saved.',
    });
  }
  if (blank(profile.jobsToAvoid)) {
    questions.push({
      id: 'avoid',
      prompt: 'Which jobs or searches should the ads avoid?',
      suggested: STANDARD_NEGATIVES.slice(0, 12).join(', '),
      reason: 'This blocks jobs, DIY, retail, and other clicks that do not book work.',
    });
  }
  if (blank(profile.keywordFocus)) {
    const service = deriveServiceLines(profile.services, profile.trade)[0] || suggestedServices(profile.trade).split(',')[0]?.trim() || 'local service';
    const place = city || 'your city';
    questions.push({
      id: 'keywords',
      prompt: 'Which keywords should Miles prioritize?',
      suggested: `${service.toLowerCase()} ${place !== 'your city' ? place.toLowerCase() : ''}`.trim(),
      reason: 'These are added as phrase and exact match, with the city when it is known.',
    });
  }
  return questions;
}

export function applyPlanAnswer(profile: PlanProfile, id: PlanQuestion['id'], value: string): PlanProfile {
  const text = value.trim();
  const next = { ...profile };
  if (id === 'website') next.website = text;
  if (id === 'phone') next.phone = text;
  if (id === 'areas') next.serviceAreas = text;
  if (id === 'services') next.services = text;
  if (id === 'budget') {
    const amount = Number(text.replace(/[^0-9.]/g, ''));
    if (amount > 0) next.dailyBudget = Math.round(amount * 100) / 100;
  }
  if (id === 'goal') next.goal = text;
  if (id === 'hours') next.hours = text;
  if (id === 'avoid') next.jobsToAvoid = text;
  if (id === 'keywords') next.keywordFocus = text;
  return next;
}

function sectionsOf(spec: CampaignSpec): PlanSection[] {
  const keywords = spec.adGroups.map((group) => {
    const lines = group.keywords.map((row) => `${row.text} (${row.match})`).join(', ');
    return `${group.name}: ${lines || 'none'}`;
  }).join('\n');
  const ads = spec.adGroups.map((group) => {
    const headlines = group.rsa.headlines.slice(0, 3).join(' | ');
    return `${group.name}: ${headlines}`;
  }).join('\n');
  const bid = spec.bidPlan?.stage === 'MAXIMIZE_CONVERSIONS'
    ? 'Maximize Conversions'
    : `Maximize Clicks with a $${spec.bidPlan?.maxCpc ?? RULEBOOK_DEFAULTS.maxCpc} cap`;
  const presence = spec.targeting?.presence === 'PRESENCE' ? 'Presence only' : 'Presence only';
  const radius = spec.targeting?.radiusMiles ?? RULEBOOK_DEFAULTS.radiusMiles;
  return [
    {
      id: 'locations',
      title: 'Locations',
      reason: 'People physically in the service area. Interest outside the area is off.',
      body: `${presence}, ${radius} miles. ${spec.locations.join(', ') || 'No area yet.'}`,
    },
    {
      id: 'keywords',
      title: 'Keywords',
      reason: 'Phrase and exact match, with the city, one tight ad group per service.',
      body: keywords || 'No keywords yet.',
    },
    {
      id: 'negatives',
      title: 'Negative keywords',
      reason: 'Jobs, careers, DIY, how to, free, cheap, supplies, and retail stores.',
      body: spec.negatives.join(', '),
    },
    {
      id: 'ads',
      title: 'Ads',
      reason: 'Headlines and descriptions for each ad group, in normal capitalization.',
      body: ads || 'No ads yet.',
    },
    {
      id: 'assets',
      title: 'Assets',
      reason: 'Sitelinks, callouts, and a call button sit on the ad when the profile has them.',
      body: [
        spec.callAsset?.phone ? `Call ${spec.callAsset.phone}` : 'No phone on the profile',
        `${spec.sitelinks?.length || 0} sitelinks`,
        `${spec.callouts?.length || 0} callouts`,
      ].join('. '),
    },
    {
      id: 'budget',
      title: 'Budget and bidding',
      reason: spec.bidPlan?.stage === 'MAXIMIZE_CLICKS'
        ? 'No conversion history yet, so this is Maximize Clicks with a CPC cap. It is a default, not a promise.'
        : 'Bidding follows the conversions already on the account. It is a default, not a promise.',
      body: `$${spec.dailyBudget}/day. ${bid}. Ads ${spec.targeting?.schedule.startHour ?? 7}:00 to ${spec.targeting?.schedule.endHour ?? 20}:00, all week.`,
    },
  ];
}

export function buildSearchPlan(profile: PlanProfile, opts?: { preapproved?: boolean }): SearchPlan {
  const questions = opts?.preapproved ? [] : planQuestions(profile);
  const city = (profile.serviceAreas || '').split(',')[0]?.trim() || 'Your area';
  const services = servicesFromCrawl(profile.services, profile.trade)
    ? profile.services
    : (profile.services || suggestedServices(profile.trade));
  const daily = profile.dailyBudget && profile.dailyBudget > 0 ? profile.dailyBudget : 20;
  const drafted = buildCampaignSpec(
    { goal: profile.goal, dailyBudget: daily, finalUrl: profile.website || '', locations: blank(profile.serviceAreas) ? [city] : [profile.serviceAreas || city] },
    { business: profile.businessName, trade: profile.trade, city, services },
  );
  if (profile.jobsToAvoid) drafted.negatives = splitList(profile.jobsToAvoid);
  const hours = hoursRange(profile.hours);
  const ruled = enforceRulebook(repairCampaignUrls(drafted, { website: profile.website, links: profile.links }), {
    trade: profile.trade,
    city,
    phone: profile.phone,
    gbpUrl: profile.gbpUrl,
    hours: profile.hours,
  });
  const spec = ruled.spec;
  if (hours && spec.targeting) {
    spec.targeting = { ...spec.targeting, schedule: { ...spec.targeting.schedule, startHour: hours.startHour, endHour: hours.endHour } };
  }
  const focus = splitList(profile.keywordFocus).map((text) => text.toLowerCase());
  if (focus.length && spec.adGroups[0]) {
    const group = spec.adGroups[0];
    const seen = new Set(group.keywords.map((row) => row.text));
    for (const text of focus) {
      if (seen.has(text)) continue;
      group.keywords.unshift({ text, match: 'exact' });
      group.keywords.unshift({ text, match: 'phrase' });
      seen.add(text);
    }
    group.keywords = group.keywords.filter((row) => row.match === 'phrase' || row.match === 'exact').slice(0, RULEBOOK_DEFAULTS.maxKeywordsPerAdGroup);
  }
  spec.status = 'PAUSED';
  spec.biddingStrategy = spec.bidPlan?.stage === 'MAXIMIZE_CONVERSIONS' ? 'MAXIMIZE_CONVERSIONS' : 'MAXIMIZE_CLICKS';
  const geo = resolveAreas(profile.serviceAreas || spec.locations.join('; '));
  spec.geoTargets = geo.targets;
  const sections = sectionsOf(spec);
  const places = sections.find((section) => section.id === 'locations');
  if (places) {
    places.body = geo.targets.length
      ? `Presence only. ${geo.targets.map((target) => `${target.name}${target.state ? `, ${target.state}` : ''} (${target.targetType} ${target.id})`).join('; ')}.`
      : geo.block;
    places.reason = geo.targets.length
      ? 'People physically in these Google locations. Interest outside them is off.'
      : geo.block;
  }
  return { questions, spec, sections, preapproved: !!opts?.preapproved, locationBlock: geo.block };
}

/** Keep the owner's approved spec. Force paused, drop broad match, fix capitalization. */
export function acceptApprovedPlan(spec: CampaignSpec): CampaignSpec {
  return {
    ...spec,
    status: 'PAUSED',
    networks: ['Google Search'],
    negatives: [...new Set((spec.negatives || []).map((row) => row.trim().toLowerCase()).filter(Boolean))],
    adGroups: (spec.adGroups || []).map((group) => ({
      ...group,
      keywords: (group.keywords || [])
        .map((row) => ({
          text: row.text.toLowerCase().replace(/\s+/g, ' ').trim(),
          match: row.match === 'exact' ? 'exact' as const : 'phrase' as const,
        }))
        .filter((row) => row.text),
      rsa: {
        headlines: (group.rsa?.headlines || []).map((line) => fixAdCapitalization(line)).filter(Boolean),
        descriptions: (group.rsa?.descriptions || []).map((line) => fixAdCapitalization(line)).filter(Boolean),
      },
    })),
  };
}
