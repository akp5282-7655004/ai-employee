/**
 * Campaign rulebook. These are launch defaults, not measured benchmarks and
 * not a promise of Quality Score, CPC, or cost per lead.
 *
 * Defaults:
 * - 8 keywords per ad group
 * - 15 headlines, 4 descriptions, 30 and 90 character limits
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
import type { CampaignSpec, KeywordSpec } from './campaign.js';

export const RULEBOOK_DEFAULTS = {
  maxKeywordsPerAdGroup: 8,
  headlines: 15,
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
  'course', 'supplies', 'wholesale', 'used', 'colors', 'colour', 'home depot', 'lowes', "lowe's",
  'sherwin', 'benjamin moore', 'behr', 'valspar', 'ppg',
];

const TRADE_NEGATIVES: Record<string, string[]> = {
  painting: ['paint color', 'paint colors', 'colour chart', 'sherwin williams', 'home depot paint'],
};

const JUNK = /\b(free custom quote|slide title|lorem|placeholder|untitled)\b/i;

export interface RulebookContext {
  trade?: string;
  city?: string;
  phone?: string;
  gbpUrl?: string;
}

export interface RulebookResult {
  spec: CampaignSpec;
  fixes: string[];
  blocks: string[];
}

function title(input: string): string {
  return input.replace(/\w\S*/g, (word) => {
    if (/^[A-Z0-9]{2,4}$/.test(word)) return word;
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });
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
  const next: CampaignSpec = {
    ...spec,
    networks: ['Google Search'],
    negatives: [...new Set([...(spec.negatives ?? []), ...STANDARD_NEGATIVES, ...(TRADE_NEGATIVES[(ctx.trade || '').toLowerCase()] ?? [])])],
    targeting: {
      presence: 'PRESENCE',
      radiusMiles: d.radiusMiles,
      searchPartners: false,
      display: false,
      schedule: { days: [0, 1, 2, 3, 4, 5, 6], startHour: d.scheduleStartHour, endHour: d.scheduleEndHour },
    },
    bidPlan: { stage: 'MAXIMIZE_CLICKS', maxCpc: d.maxCpc },
    callAsset: ctx.phone && /\d{7,}/.test(ctx.phone.replace(/\D/g, '')) ? { phone: ctx.phone } : null,
    locationAsset: ctx.gbpUrl && /^https:\/\//i.test(ctx.gbpUrl) ? { gbpUrl: ctx.gbpUrl } : null,
    structuredSnippet: spec.structuredSnippet?.header === 'Service catalog' && (spec.structuredSnippet.values?.length ?? 0) >= 3
      ? spec.structuredSnippet
      : { header: 'Service catalog', values: [...new Set([...(spec.structuredSnippet?.values ?? []), ...spec.adGroups.map((g) => fit(g.name, 25)).filter(Boolean)])].slice(0, 10) },
  };
  if (JSON.stringify(spec.networks) !== '["Google Search"]') fixes.push('Networks set to Google Search only. No Display and no Search partners.');
  fixes.push(`Bid plan set to Maximize Clicks with a $${d.maxCpc} max CPC. That cap is a default, not a benchmark.`);
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
    const seenKw = new Set<string>();
    keywords = keywords.filter((row) => {
      if (!row.text || seenKw.has(row.text)) return false;
      seenKw.add(row.text);
      return true;
    }).slice(0, d.maxKeywordsPerAdGroup);
    if (keywords.length !== group.keywords.length) fixes.push(`Keywords for ${name} were limited to close ${keywords.length ? 'phrase and exact' : ''} variants.`);
    if (!keywords.length) blocks.push(`${name} has no close-variant keywords left. Miles will not create a mixed or empty ad group.`);

    const cityOk = city && city.length <= 20 ? city : '';
    const headlines = pad(group.rsa?.headlines ?? [], [
      name,
      cityOk ? `${name} in ${cityOk}` : name,
      cityOk ? `Serving ${cityOk}` : 'Local Crew',
      cityOk ? `${cityOk} ${name}` : name,
      cityOk ? `${cityOk} Crew` : 'Local Crew',
      cityOk ? `Call ${cityOk}` : 'Call Today',
      'Licensed And Insured', 'Book A Visit', 'Local Crew', 'Call For A Visit', 'Clear Pricing',
      'Schedule A Visit', 'Ask About Timing', 'Request A Visit', 'Talk To The Crew', `${name} Help`, 'Local Team',
    ], d.headlineChars, d.headlines);
    const descriptions = pad(group.rsa?.descriptions ?? [], [
      cityOk ? `${name} in ${cityOk}. Call to schedule a visit.` : `${name}. Call to schedule a visit.`,
      'Licensed and insured. You approve before anything spends.',
      'Clear pricing. Ask about timing.',
      cityOk ? `Serving ${cityOk}. Schedule a visit with a local crew.` : 'Schedule a visit with a local crew.',
    ], d.descriptionChars, d.descriptions);
    const mentions = headlines.filter((line) => line.toLowerCase().includes(stem) || (cityOk && line.toLowerCase().includes(cityOk.toLowerCase()))).length;
    const withCity = cityOk ? headlines.filter((line) => line.toLowerCase().includes(cityOk.toLowerCase())).length : d.headlinesWithCity;
    if (headlines.length < d.headlines || descriptions.length < d.descriptions) blocks.push(`${name} could not be filled to ${d.headlines} headlines and ${d.descriptions} descriptions without cutting a line in half.`);
    if (mentions < d.headlinesWithServiceOrCity) blocks.push(`${name} needs the service or the city in at least ${d.headlinesWithServiceOrCity} headlines.`);
    if (withCity < d.headlinesWithCity) blocks.push(`${name} needs the city in at least ${d.headlinesWithCity} headlines.`);
    if ([...headlines, ...descriptions, name].some((line) => JUNK.test(line))) blocks.push(`${name} still has junk from the crawl. Miles will not use it.`);
    return { ...group, name, keywords, rsa: { headlines, descriptions }, finalUrl: group.finalUrl || next.finalUrl };
  });

  if ((next.callouts?.length ?? 0) < 4) {
    next.callouts = ['Licensed And Insured', 'Locally Owned', 'Clear Pricing', 'Fast Response', 'Experienced Crew', 'Schedule A Visit'];
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
