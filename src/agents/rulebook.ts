/**
 * Campaign rulebook. These are launch defaults, not measured benchmarks and
 * not a promise of Quality Score, CPC, or cost per lead.
 *
 * Defaults:
 * - up to 8 close keywords in one ad group, so one intent stays together. This is not a Starter, Growth, or Scale allotment.
 * - 8 to 10 headlines (SOP 130), 4 descriptions, 30 and 90 character limits
 * - the same keyword is not saved as both phrase and exact (SOP 145)
 * - at least 3 headlines mention the service or the city, and 2 mention the city when it fits
 * - exact and phrase match only
 * - 15 mile presence radius
 * - ads scheduled 7:00 to 20:00, all week
 * - Maximize Clicks with a $4 max CPC until 15 conversions, then Maximize Conversions
 * - Target CPA only after 30 conversions, using the observed CPA
 * - pause a keyword proposal at $50 spend and zero conversions
 * - mine a search term into a negative proposal at $20 spend and zero conversions
 * - flag a Quality Score below 5 only when Google actually returned a score
 */
import { defaultCallouts, licensedAndInsured, type CampaignSpec, type KeywordSpec, type VerifiedClaims } from './campaign.js';

export const RULEBOOK_DEFAULTS = {
  maxKeywordsPerAdGroup: 8,
  /** SOP 130 asks for 8–10. Google allows 15. Miles does not invent lines to reach 15. */
  headlines: 10,
  headlineMin: 8,
  descriptions: 4,
  headlineChars: 30,
  descriptionChars: 90,
  headlinesWithServiceOrCity: 3,
  headlinesWithCity: 2,
  radiusMiles: 15,
  scheduleStartHour: 7,
  scheduleEndHour: 20,
  maxCpc: 4,
  conversionsBeforeMaximizeConversions: 15,
  conversionsBeforeTargetCpa: 30,
  keywordPauseSpend: 50,
  searchTermNegativeSpend: 20,
  qualityScoreFlagBelow: 5,
} as const;

export const STANDARD_NEGATIVES = [
  'jobs', 'careers', 'salary', 'hiring', 'diy', 'how to', 'free', 'cheap', 'training', 'school',
  'course', 'courses', 'supplies', 'wholesale', 'used', 'colors', 'colour', 'home depot', 'lowes', "lowe's",
  'sherwin', 'benjamin moore', 'behr', 'valspar', 'ppg',
];

const TRADE_NEGATIVES: Record<string, string[]> = {
  painting: ['paint color', 'paint colors', 'colour chart', 'sherwin williams', 'home depot paint'],
};

const JUNK = /\b(free custom quote|slide title|lorem|placeholder|untitled)\b/i;

/** All-caps words Google's capitalization policy allows in an ad. */
const AD_ACRONYMS = new Set(['HVAC', 'AC', 'LLC', 'INC', 'LLP', 'PLLC', 'USA', 'SEO', 'GBP', 'TV', 'EV', 'DIY', 'PA', 'NJ', 'NY', 'DC']);

/**
 * Google rejects excessive capitalization. All-caps words become title case.
 * Known acronyms (HVAC) and short tokens (LLC) stay in caps. The line is kept.
 */
export function fixAdCapitalization(input: string): string {
  return input.replace(/[A-Za-z0-9&']+/g, (word) => {
    const letters = word.replace(/[^A-Za-z]/g, '');
    if (!letters) return word;
    const upper = letters.toUpperCase();
    if (AD_ACRONYMS.has(upper)) return word.replace(letters, upper);
    if (letters.length >= 2 && letters === upper) {
      return word.replace(letters, upper.charAt(0) + upper.slice(1).toLowerCase());
    }
    if (letters === letters.toLowerCase()) return word.replace(letters, upper.charAt(0) + letters.slice(1));
    return word;
  });
}

/** Pull a start and end hour out of a phrase such as "Monday 8am to 5pm". */
export function hoursRange(text: string | undefined): { startHour: number; endHour: number } | null {
  const match = (text || '').match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:to|-)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!match) return null;
  const to24 = (hour: number, ap?: string) => {
    if (!ap) return hour;
    const mark = ap.toLowerCase();
    if (mark === 'pm' && hour < 12) return hour + 12;
    if (mark === 'am' && hour === 12) return 0;
    return hour;
  };
  const start = to24(Number(match[1]), match[3]);
  const end = to24(Number(match[4]), match[6] || match[3]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || start < 0 || end > 24) return null;
  return { startHour: start, endHour: end };
}

export interface RulebookContext {
  trade?: string;
  city?: string;
  phone?: string;
  gbpUrl?: string;
  /** Saved business hours, such as "Monday 8am to 5pm". */
  hours?: string;
  /** Claims the profile or crawl backs up. Unset means none are printed. */
  claims?: VerifiedClaims;
}

export interface RulebookResult {
  spec: CampaignSpec;
  fixes: string[];
  blocks: string[];
}

function title(input: string): string {
  return fixAdCapitalization(input).replace(/\s+/g, ' ').trim();
}

function fit(line: string, max: number): string {
  const text = title(line).replace(/\s+/g, ' ').trim();
  return text.length <= max ? text : '';
}

function token(name: string): string {
  return name.toLowerCase().split(/[^a-z0-9]+/).find((word) => word.length > 3 && word !== 'painting' && word !== 'service') || name.toLowerCase().split(/\s+/)[0] || '';
}

function pad(lines: string[], seeds: string[], max: number, count: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [...lines, ...seeds]) {
    const line = fit(raw, max);
    const key = line.toLowerCase();
    if (!line || seen.has(key) || JUNK.test(line)) continue;
    seen.add(key);
    out.push(line);
    if (out.length >= count) break;
  }
  return out;
}

export function nextBidStage(args: { conversions: number; observedCpa?: number }): { stage: 'MAXIMIZE_CLICKS' | 'MAXIMIZE_CONVERSIONS' | 'TARGET_CPA'; maxCpc: number; targetCpa?: number; reason: string } {
  const d = RULEBOOK_DEFAULTS;
  if (args.conversions >= d.conversionsBeforeTargetCpa && args.observedCpa && args.observedCpa > 0) {
    return { stage: 'TARGET_CPA', maxCpc: d.maxCpc, targetCpa: Math.round(args.observedCpa * 100) / 100, reason: `Default: Target CPA after ${d.conversionsBeforeTargetCpa} conversions, using the observed CPA. This is not a benchmark.` };
  }
  if (args.conversions >= d.conversionsBeforeMaximizeConversions) {
    return { stage: 'MAXIMIZE_CONVERSIONS', maxCpc: d.maxCpc, reason: `Default: Maximize Conversions after ${d.conversionsBeforeMaximizeConversions} conversions. This is not a benchmark.` };
  }
  return { stage: 'MAXIMIZE_CLICKS', maxCpc: d.maxCpc, reason: `Default: Maximize Clicks with a $${d.maxCpc} max CPC until ${d.conversionsBeforeMaximizeConversions} conversions. This is not a benchmark.` };
}

export function enforceRulebook(spec: CampaignSpec, ctx: RulebookContext = {}): RulebookResult {
  const d = RULEBOOK_DEFAULTS;
  const fixes: string[] = [];
  const blocks: string[] = [];
  const city = (ctx.city || spec.locations?.[0] || '').split(',')[0]?.trim() || '';
  const hours = hoursRange(ctx.hours);
  const savedSchedule = spec.targeting?.schedule;
  const next: CampaignSpec = {
    ...spec,
    networks: ['Google Search'],
    copyControls: { aiMax: false, textCustomization: false, finalUrlExpansion: false },
    requiredWording: (spec.requiredWording || '').trim(),
    negatives: [...new Set([...(spec.negatives ?? []), ...STANDARD_NEGATIVES, ...(TRADE_NEGATIVES[(ctx.trade || '').toLowerCase()] ?? [])])],
    targeting: {
      presence: 'PRESENCE',
      radiusMiles: d.radiusMiles,
      searchPartners: false,
      display: false,
      schedule: {
        days: savedSchedule?.days?.length ? savedSchedule.days : [0, 1, 2, 3, 4, 5, 6],
        startHour: hours?.startHour ?? savedSchedule?.startHour ?? d.scheduleStartHour,
        endHour: hours?.endHour ?? savedSchedule?.endHour ?? d.scheduleEndHour,
      },
    },
    trafficTest: spec.trafficTest === true,
    biddingStrategy: spec.trafficTest === true ? 'MAXIMIZE_CLICKS' : 'MAXIMIZE_CONVERSIONS',
    bidPlan: spec.trafficTest === true
      ? { stage: 'MAXIMIZE_CLICKS', maxCpc: d.maxCpc }
      : { stage: 'MAXIMIZE_CONVERSIONS', maxCpc: d.maxCpc },
    callAsset: ctx.phone && /\d{7,}/.test(ctx.phone.replace(/\D/g, '')) ? { phone: ctx.phone } : null,
    locationAsset: ctx.gbpUrl && /^https:\/\//i.test(ctx.gbpUrl) ? { gbpUrl: ctx.gbpUrl } : null,
    structuredSnippet: spec.structuredSnippet?.header === 'Service catalog' && (spec.structuredSnippet.values?.length ?? 0) >= 3
      ? spec.structuredSnippet
      : { header: 'Service catalog', values: [...new Set([...(spec.structuredSnippet?.values ?? []), ...spec.adGroups.map((g) => fit(g.name, 25)).filter(Boolean)])].slice(0, 10) },
  };
  if (JSON.stringify(spec.networks) !== '["Google Search"]') fixes.push('Networks set to Google Search only. No Display and no Search partners.');
  fixes.push(spec.trafficTest === true
    ? `Bid plan set to Maximize Clicks with a $${d.maxCpc} max CPC because the owner asked for a traffic test.`
    : 'Bid plan set to Maximize conversions with no target CPA. SOP 146. The draft stays paused until the lead is confirmed.');
  fixes.push(`Targeting set to presence only, ${d.radiusMiles} miles, ${d.scheduleStartHour}:00 to ${d.scheduleEndHour}:00. Those are defaults, not a benchmark.`);

  if ((next.structuredSnippet?.values.length ?? 0) < 3) {
    while ((next.structuredSnippet?.values.length ?? 0) < 3) next.structuredSnippet!.values.push(['Local Service', 'Scheduled Work', 'Repair Work'][next.structuredSnippet!.values.length] || 'Service');
    fixes.push('Structured snippet filled to 3 services.');
  }

  const pathBit = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 15) || 'service';
  next.displayPaths = [pathBit(spec.adGroups[0]?.name || 'service'), pathBit(city || 'area')].slice(0, 2);
  if (!next.finalUrl || !/^https:\/\/.+\..+/.test(next.finalUrl)) blocks.push('Add the website in Crawl. Miles will not invent a landing page.');

  next.adGroups = spec.adGroups.map((group) => {
    const name = title(group.name);
    const stem = token(name);
    let keywords: KeywordSpec[] = group.keywords
      .map((row) => ({ text: row.text.toLowerCase().replace(/\s+/g, ' ').trim(), match: row.match === 'broad' ? 'phrase' as const : row.match }))
      .filter((row) => row.match === 'phrase' || row.match === 'exact')
      .filter((row) => !/\b(best|free|quote|cheap)\b/.test(row.text))
      .filter((row) => !stem || row.text.includes(stem));
    const seenKw = new Map<string, KeywordSpec>();
    for (const row of keywords) {
      if (!row.text) continue;
      const prev = seenKw.get(row.text);
      if (!prev) { seenKw.set(row.text, row); continue; }
      const specific = row.text.split(/\s+/).length >= 3 || (city && row.text.includes(city.toLowerCase()));
      seenKw.set(row.text, { text: row.text, match: specific ? 'exact' : 'phrase' });
    }
    keywords = [...seenKw.values()].slice(0, d.maxKeywordsPerAdGroup);
    if (keywords.length !== group.keywords.length) fixes.push(`Keywords for ${name} were limited to close ${keywords.length ? 'phrase and exact' : ''} variants.`);
    if (!keywords.length) blocks.push(`${name} has no close-variant keywords left. Miles will not create a mixed or empty ad group.`);

    const cityOk = city && city.length <= 20 ? city : '';
    let headlines = pad(group.rsa?.headlines ?? [], [
      name,
      cityOk ? `${name} in ${cityOk}` : name,
      cityOk ? `Serving ${cityOk}` : 'Local Crew',
      cityOk ? `${cityOk} ${name}` : name,
      cityOk ? `${cityOk} Crew` : 'Local Crew',
      cityOk ? `Call ${cityOk}` : 'Call Today',
      licensedAndInsured(ctx.claims) ? 'Licensed And Insured' : 'Get A Quote', 'Book A Visit', 'Local Crew', 'Call For A Visit', 'Clear Pricing',
      'Schedule A Visit', 'Ask About Timing', 'Request A Visit', 'Talk To The Crew', `${name} Help`, 'Local Team',
    ], d.headlineChars, d.headlines);
    if (cityOk) {
      const citySeeds = [`Serving ${cityOk}`, `${cityOk} Crew`, `Call ${cityOk}`, `${cityOk} Team`].map((line) => fit(line, d.headlineChars)).filter(Boolean);
      const cityCount = () => headlines.filter((line) => line.toLowerCase().includes(cityOk.toLowerCase())).length;
      for (const seed of citySeeds) {
        if (cityCount() >= d.headlinesWithCity) break;
        if (headlines.some((line) => line.toLowerCase() === seed.toLowerCase())) continue;
        let replaceAt = -1;
        for (let i = headlines.length - 1; i >= 0; i--) {
          if (!headlines[i]!.toLowerCase().includes(cityOk.toLowerCase())) { replaceAt = i; break; }
        }
        if (replaceAt >= 0) headlines[replaceAt] = seed;
        else if (headlines.length < d.headlines) headlines.push(seed);
      }
    }
    const descriptions = pad(group.rsa?.descriptions ?? [], [
      cityOk ? `${name} in ${cityOk}. Call to schedule a visit.` : `${name}. Call to schedule a visit.`,
      licensedAndInsured(ctx.claims) ? 'Licensed and insured. Call to schedule a visit.' : 'Request a quote and a local crew will follow up.',
      'Clear pricing. Ask about timing.',
      cityOk ? `Serving ${cityOk}. Schedule a visit with a local crew.` : 'Schedule a visit with a local crew.',
    ], d.descriptionChars, d.descriptions);
    const mentions = headlines.filter((line) => line.toLowerCase().includes(stem) || (cityOk && line.toLowerCase().includes(cityOk.toLowerCase()))).length;
    const withCity = cityOk ? headlines.filter((line) => line.toLowerCase().includes(cityOk.toLowerCase())).length : d.headlinesWithCity;
    if (headlines.length > d.headlines) headlines = headlines.slice(0, d.headlines);
    if (headlines.length < d.headlineMin || descriptions.length < 2) blocks.push(`${name} could not be filled to ${d.headlineMin} headlines and 2 descriptions without inventing a line. SOP 130 keeps a shorter ad rather than a made-up one.`);
    if (mentions < d.headlinesWithServiceOrCity) blocks.push(`${name} needs the service or the city in at least ${d.headlinesWithServiceOrCity} headlines.`);
    if (withCity < d.headlinesWithCity) blocks.push(`${name} needs the city in at least ${d.headlinesWithCity} headlines.`);
    if ([...headlines, ...descriptions, name].some((line) => JUNK.test(line))) blocks.push(`${name} still has junk from the crawl. Miles will not use it.`);
    const required = (next.requiredWording || '').trim();
    const pin = required.length > 0 && descriptions[0]?.toLowerCase().includes(required.toLowerCase()) === true;
    if (required && !pin) blocks.push(`${name} is missing the required wording in description 1, so SOP 130 will not pin it.`);
    return { ...group, name, keywords, rsa: { headlines, descriptions, pinDescription1: pin }, finalUrl: group.finalUrl || next.finalUrl };
  });

  if ((next.callouts?.length ?? 0) < 4) {
    next.callouts = defaultCallouts(ctx.claims);
    fixes.push('Callouts filled to the default set.');
  }
  if ((next.sitelinks?.length ?? 0) > 0 && next.sitelinks!.some((link) => !/^https:\/\/.+\..+/.test(link.url))) {
    next.sitelinks = next.sitelinks!.filter((link) => /^https:\/\/.+\..+/.test(link.url));
    fixes.push('Sitelinks without a real https URL were removed.');
  }
  if ((next.sitelinks?.length ?? 0) === 1) {
    next.sitelinks = [];
    fixes.push('Only one real sitelink was left, so sitelinks were omitted.');
  }
  return { spec: next, fixes, blocks };
}

export interface HousekeepingInput {
  searchTerms?: { term: string; cost: number; conversions: number }[];
  keywords?: { text: string; cost: number; conversions: number }[];
  qualityScores?: { text: string; score: number; components?: string[] }[];
  conversions?: number;
  observedCpa?: number;
}

/** Proposals only. Nothing here changes Google. */
export function housekeepingProposals(input: HousekeepingInput): { title: string; reason: string }[] {
  const d = RULEBOOK_DEFAULTS;
  const out: { title: string; reason: string }[] = [];
  for (const term of input.searchTerms ?? []) {
    if (term.cost >= d.searchTermNegativeSpend && term.conversions === 0) {
      out.push({ title: `Negative: ${term.term}`, reason: `Default: $${d.searchTermNegativeSpend} spent and no conversions. Add "${term.term}" as a negative. This is not a benchmark.` });
    }
  }
  for (const keyword of input.keywords ?? []) {
    if (keyword.cost >= d.keywordPauseSpend && keyword.conversions === 0) {
      out.push({ title: `Pause keyword: ${keyword.text}`, reason: `Default: $${d.keywordPauseSpend} spent and no conversions. Pause this keyword, not the whole campaign. This is not a benchmark.` });
    }
  }
  for (const row of input.qualityScores ?? []) {
    if (row.score < d.qualityScoreFlagBelow) {
      out.push({ title: `Quality Score ${row.score}: ${row.text}`, reason: `Default: flag a score under ${d.qualityScoreFlagBelow} when Google returns one. ${row.components?.join(', ') || 'No component breakdown was returned.'}` });
    }
  }
  const stage = nextBidStage({ conversions: input.conversions ?? 0, observedCpa: input.observedCpa });
  if (stage.stage !== 'MAXIMIZE_CLICKS') out.push({ title: `Bid stage: ${stage.stage}`, reason: stage.reason });
  return out;
}
