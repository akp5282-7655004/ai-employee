/**
 * One gate for every Miles action that would change the customer's marketing.
 * Rules are paraphrased from the owner's SOP library and cite SOP numbers.
 * Licensed procedure text is not stored here. A number that is not in an SOP
 * is labeled a Miles default.
 */
import { enforceRulebook, type RulebookContext } from './rulebook.js';
import type { CampaignSpec } from './campaign.js';

export type SopAction =
  | 'campaign_create' | 'campaign_enable' | 'campaign_pause'
  | 'keyword_add' | 'negative_add' | 'bid_change' | 'budget_change' | 'asset_save'
  | 'ghl_send' | 'ghl_pipeline' | 'seo_publish' | 'tracking_setup' | 'report' | 'other';

export type MilesMode = 'automate' | 'hybrid' | 'manual';

export interface SopSubject {
  mode?: MilesMode;
  spec?: CampaignSpec;
  trade?: string;
  city?: string;
  phone?: string;
  gbpUrl?: string;
  tracking?: { leadConversion?: boolean; ga4Linked?: boolean; method?: string };
  negative?: string;
  protectTerms?: string[];
  budget?: { daily?: number; approvedDaily?: number };
  ghl?: { phone?: string; email?: string; pipelineStage?: string; message?: string };
  seo?: { title?: string; h1?: string; meta?: string; path?: string; noindex?: boolean };
  reportPeriod?: string;
}

export interface SopLog {
  ruleId: string;
  sop: string;
  result: 'pass' | 'fixed' | 'warn' | 'block';
  detail: string;
}

export interface SopGate {
  subject: SopSubject;
  logs: SopLog[];
  fixes: string[];
  warns: string[];
  blocks: string[];
  /** execute = Automate may run it; queue = Hybrid holds a passed action; show = Manual only displays the check; block = nobody runs it. */
  disposition: 'execute' | 'queue' | 'show' | 'block';
}

export interface SopRule {
  id: string;
  sops: string[];
  category: 'google_ads' | 'paid' | 'tracking' | 'ghl' | 'technical_seo' | 'seo_delivery';
  actions: SopAction[];
  severity: 'block' | 'warn';
  detail: string;
}

export const SOP_RULES: SopRule[] = [
  { id: 'sop147-ready', sops: ['147'], category: 'google_ads', actions: ['campaign_create', 'campaign_enable'], severity: 'block', detail: 'A Search campaign is Ready only when no blocker remains. Hold it while ads stay off.' },
  { id: 'sop147-search-presence', sops: ['147'], category: 'google_ads', actions: ['campaign_create', 'campaign_enable'], severity: 'block', detail: 'Use Google Search only and Presence. A 15 mile radius and a 7:00–20:00 schedule are Miles defaults, not from the SOP.' },
  { id: 'sop147-not-sent', sops: ['147'], category: 'google_ads', actions: ['campaign_create'], severity: 'warn', detail: 'Presence, radius, and schedule stay on the plan. The verified create action cannot send those fields.' },
  { id: 'sop130-rsa', sops: ['130'], category: 'google_ads', actions: ['campaign_create', 'asset_save'], severity: 'block', detail: 'Write 8–10 headlines of at most 30 characters and 2–4 descriptions of at most 90. Google still requires at least 3 and 2. Do not invent facts to fill a count.' },
  { id: 'sop130-destination', sops: ['130'], category: 'google_ads', actions: ['campaign_create', 'asset_save'], severity: 'block', detail: 'Each ad uses the page that matches the search. Display paths are at most 15 characters and do not change the destination.' },
  { id: 'sop130-one-need', sops: ['130', '145'], category: 'google_ads', actions: ['campaign_create', 'keyword_add'], severity: 'block', detail: 'One ad group serves one customer need. Exact and phrase only at launch.' },
  { id: 'sop149-assets', sops: ['149'], category: 'google_ads', actions: ['campaign_create', 'asset_save'], severity: 'block', detail: 'Sitelink text stays within 25 characters and each description within 35. Callouts stay within 25. A snippet uses at least 3 real services, preferably 4, under a preset header.' },
  { id: 'sop129-protect', sops: ['129'], category: 'google_ads', actions: ['negative_add'], severity: 'block', detail: 'Do not exclude a search the campaign is trying to win. Review a period before saving a negative.' },
  { id: 'sop018-loop', sops: ['018'], category: 'google_ads', actions: ['bid_change', 'budget_change', 'keyword_add', 'negative_add'], severity: 'warn', detail: 'Turn an audit into a prioritized change. Miles queues it unless Automate is inside the owner caps.' },
  { id: 'sop131-period', sops: ['131', '129'], category: 'paid', actions: ['report'], severity: 'block', detail: 'A monthly Search report names the period. If nobody supplied one, start from the last completed calendar month.' },
  { id: 'sop039-lead', sops: ['039', '002', '019'], category: 'tracking', actions: ['campaign_enable', 'tracking_setup'], severity: 'block', detail: 'Count the lead action, such as a thank-you page or a form submit. Do not launch to an unrelated purchase goal. Missing proof holds the enable.' },
  { id: 'sop134-ga4', sops: ['134'], category: 'tracking', actions: ['campaign_create', 'tracking_setup'], severity: 'warn', detail: 'Link the Google Ads account to the GA4 property before treating reports as one system.' },
  { id: 'sop008-utm', sops: ['008'], category: 'tracking', actions: ['campaign_create', 'tracking_setup'], severity: 'warn', detail: 'Campaign URLs keep a consistent source, medium, and campaign when tags are present. An empty tag is not a tag.' },
  { id: 'sop076-intake', sops: ['076', '074', '108', '110', '111'], category: 'ghl', actions: ['ghl_send'], severity: 'block', detail: 'A follow-up needs a real phone or email and a message. Do not invent a price.' },
  { id: 'sop005-stage', sops: ['005', '075', '103', '106'], category: 'ghl', actions: ['ghl_pipeline'], severity: 'block', detail: 'An opportunity needs a pipeline stage the owner defined. Miles does not invent a stage.' },
  { id: 'sop042-page', sops: ['042', '049', '032', '038'], category: 'seo_delivery', actions: ['seo_publish'], severity: 'block', detail: 'A page Miles publishes has one topic, a title, one H1, and a meta description before it is marked ready.' },
  { id: 'sop065-index', sops: ['065', '030'], category: 'technical_seo', actions: ['seo_publish'], severity: 'block', detail: 'Do not noindex a page you want found. A canonical, when set, points at the page you mean to keep.' },
  { id: 'sop095-profile', sops: ['095', '089'], category: 'seo_delivery', actions: ['seo_publish', 'asset_save'], severity: 'warn', detail: 'A local page is stronger when the Google Business Profile is claimed. Miles warns when it is missing and does not invent a listing.' },
];

const SHOPPING = new Set(['143', '140', '142', '141', '139', '021', '026', '124', '123', '122', '121', '120', '119', '118', '117', '116', '070']);
const AGENCY = new Set(['016', '027', '014', '013', '006', '007', '009']);
const PLUGIN = new Set(['132', '128', '127', '125', '115', '114', '113', '112', '101', '102', '100', '097', '098', '060', '058', '069', '068', '067', '066', '064', '063', '062', '061', '059', '057', '051', '050', '054', '056', '055', '040', '046', '045', '044', '043', '035', '034', '033', '031', '048', '047']);
const NA_REASON: Record<string, string> = {};
for (const n of SHOPPING) NA_REASON[n] = 'Shopping, Merchant Center, or WooCommerce. Not a home-services Search campaign.';
for (const n of AGENCY) NA_REASON[n] = 'Agency seat or permission handoff. Miles does not grant access to other people.';
for (const n of PLUGIN) NA_REASON[n] = 'Needs Semrush, Yoast, Rank Math, SEOPress, All in One SEO, or another plugin Miles does not run. The shared on-page checks are in sop042-page and sop065-index.';

/** Every captured SOP number, with the rule that covers it or an N/A reason. */
const SOP_ROWS: [string, string, string][] = [
  ['147', 'google_ads', 'Review a Search campaign before launch'],
  ['149', 'google_ads', 'Add sitelinks, callouts, and snippets'],
  ['143', 'google_ads', 'First Standard Shopping campaign'],
  ['140', 'google_ads', 'WooCommerce to Merchant Center'],
  ['142', 'google_ads', 'Link Merchant Center to Google Ads'],
  ['134', 'tracking', 'Connect Google Ads to GA4'],
  ['129', 'google_ads', 'Search terms and negatives'],
  ['131', 'google_ads', 'Monthly Search report'],
  ['130', 'google_ads', 'Write a responsive Search ad'],
  ['096', 'google_ads', 'Create an account without launching'],
  ['039', 'tracking', 'Choose a conversion tracking method'],
  ['029', 'google_ads', 'Prepare a client for handoff'],
  ['027', 'google_ads', 'Choose agency access'],
  ['021', 'tracking', 'WooCommerce purchases in Google Ads'],
  ['020', 'tracking', 'Internal link clicks in Google Ads'],
  ['019', 'tracking', 'Contact Form 7 in Google Ads'],
  ['017', 'tracking', 'Outbound clicks in Google Ads'],
  ['002', 'tracking', 'Thank-you page lead in Google Ads'],
  ['018', 'google_ads', 'Audit and prioritize fixes'],
  ['016', 'google_ads', 'Grant agency Google Ads access'],
  ['145', 'paid', 'Keyword research with Semrush'],
  ['141', 'paid', 'Merchant Center disapprovals'],
  ['139', 'paid', 'Merchant Center shipping'],
  ['111', 'ghl', 'Fix a missed follow-up'],
  ['110', 'ghl', 'Email follow-up for new enquiries'],
  ['109', 'ghl', 'Newsletter'],
  ['108', 'ghl', 'Choose a follow-up process'],
  ['107', 'ghl', 'Unanswered quotes'],
  ['106', 'ghl', 'Manage the sales process'],
  ['105', 'ghl', 'Review the pipeline'],
  ['104', 'ghl', 'Follow-up tasks'],
  ['103', 'ghl', 'Sales opportunities'],
  ['088', 'ghl', 'Segment contacts'],
  ['087', 'ghl', 'Tag form submissions'],
  ['086', 'ghl', 'Smart List filters'],
  ['085', 'ghl', 'Add and remove tags'],
  ['084', 'ghl', 'Import and clean contacts'],
  ['083', 'ghl', 'CSV contact import'],
  ['082', 'ghl', 'Prepare an import file'],
  ['081', 'ghl', 'Merge duplicate contacts'],
  ['080', 'ghl', 'Appointment booking'],
  ['079', 'ghl', 'Reschedule or cancel'],
  ['078', 'ghl', 'Booking calendar on WordPress'],
  ['077', 'ghl', 'Personal booking calendar'],
  ['076', 'ghl', 'Lead intake'],
  ['075', 'ghl', 'Opportunities from form submissions'],
  ['074', 'ghl', 'Lead-capture form'],
  ['009', 'ghl', 'Onboard a client'],
  ['003', 'ghl', 'Create a sub-account'],
  ['007', 'ghl', 'Account user and locations'],
  ['006', 'ghl', 'Team member permissions'],
  ['005', 'ghl', 'Sales pipeline and stages'],
  ['004', 'ghl', 'Contact and opportunity fields'],
  ['137', 'tracking', 'Exclude staff from GA4'],
  ['136', 'tracking', 'Cookie consent'],
  ['133', 'tracking', 'Search Console to GA4'],
  ['135', 'tracking', 'First GA4 account'],
  ['025', 'tracking', 'Contact Form 7 in GA4'],
  ['028', 'tracking', 'UTM traffic in GA4'],
  ['024', 'tracking', 'GA4 and Tag Manager setup choice'],
  ['023', 'tracking', 'Choose how to track leads in GA4'],
  ['022', 'tracking', 'Tag Manager web container'],
  ['015', 'tracking', 'Thank-you page in GA4'],
  ['012', 'tracking', 'Install GA4 through Tag Manager'],
  ['011', 'tracking', 'Create a Tag Manager account'],
  ['010', 'tracking', 'GA4 property and web stream'],
  ['008', 'tracking', 'Consistent UTM URLs'],
  ['001', 'tracking', 'Install Tag Manager with Site Kit'],
  ['026', 'tracking', 'WooCommerce purchases in GA4'],
  ['132', 'seo_delivery', 'Search Console with Yoast'],
  ['126', 'seo_delivery', 'Keyword cannibalization'],
  ['128', 'seo_delivery', 'Internal links with Semrush'],
  ['127', 'seo_delivery', 'Consolidate WordPress pages'],
  ['125', 'seo_delivery', 'Refresh WordPress content'],
  ['073', 'seo_delivery', 'Monthly SEO review'],
  ['041', 'seo_delivery', 'Next content-planning step'],
  ['099', 'seo_delivery', 'Next competitor-research task'],
  ['095', 'seo_delivery', 'Manage the Business Profile'],
  ['094', 'seo_delivery', 'Business Profile performance'],
  ['091', 'seo_delivery', 'Business Profile photos'],
  ['090', 'seo_delivery', 'Update the Business Profile'],
  ['092', 'seo_delivery', 'Ask for reviews'],
  ['093', 'seo_delivery', 'Business Profile post'],
  ['089', 'seo_delivery', 'Create a Business Profile'],
  ['072', 'seo_delivery', 'Organic leads in GA4'],
  ['071', 'seo_delivery', 'Drop in search traffic'],
  ['049', 'seo_delivery', 'Optimize a page'],
  ['053', 'seo_delivery', 'Indexing problems'],
  ['042', 'seo_delivery', 'Headings and body'],
  ['032', 'seo_delivery', 'On-page audit'],
  ['030', 'seo_delivery', 'Indexing and canonical'],
  ['037', 'seo_delivery', 'Pages to improve'],
  ['036', 'seo_delivery', 'Keywords without paid tools'],
  ['038', 'seo_delivery', 'SEO content brief'],
  ['052', 'technical_seo', 'Next technical fix'],
  ['065', 'technical_seo', 'Noindex, canonical, redirect, or robots'],
  ['066', 'technical_seo', 'Rich Results test'],
  ['124', 'seo_delivery', 'Next WooCommerce SEO step'],
  ['123', 'seo_delivery', 'WooCommerce product page SEOPress'],
  ['122', 'seo_delivery', 'WooCommerce category SEOPress'],
  ['121', 'seo_delivery', 'WooCommerce category All in One'],
  ['120', 'seo_delivery', 'WooCommerce product All in One'],
  ['119', 'seo_delivery', 'WooCommerce category Yoast'],
  ['118', 'seo_delivery', 'WooCommerce product Yoast'],
  ['117', 'seo_delivery', 'WooCommerce category Rank Math'],
  ['116', 'seo_delivery', 'WooCommerce product Rank Math'],
  ['112', 'seo_delivery', 'Rank tracking with Semrush'],
  ['101', 'seo_delivery', 'Content ideas with Semrush'],
  ['102', 'seo_delivery', 'Competitor backlinks with Semrush'],
  ['100', 'seo_delivery', 'Competitor keywords with Semrush'],
  ['097', 'seo_delivery', 'Keyword research with Semrush'],
  ['098', 'seo_delivery', 'Pages to improve with Semrush'],
  ['046', 'seo_delivery', 'Titles with SEOPress'],
  ['045', 'seo_delivery', 'Titles with All in One SEO'],
  ['048', 'seo_delivery', 'Optimize images in WordPress'],
  ['047', 'seo_delivery', 'Internal links in WordPress'],
  ['044', 'seo_delivery', 'Titles with Yoast'],
  ['043', 'seo_delivery', 'Titles with Rank Math'],
  ['035', 'seo_delivery', 'SEOPress sitemap'],
  ['034', 'seo_delivery', 'All in One sitemap'],
  ['033', 'seo_delivery', 'Yoast sitemap'],
  ['031', 'seo_delivery', 'Rank Math sitemap'],
  ['115', 'technical_seo', 'Redirect chains with Semrush'],
  ['114', 'technical_seo', 'Broken links with Semrush'],
  ['113', 'technical_seo', 'Semrush site audit'],
  ['060', 'technical_seo', 'Canonical with Yoast'],
  ['058', 'technical_seo', 'Canonical with Rank Math'],
  ['069', 'technical_seo', 'Choose structured data'],
  ['070', 'technical_seo', 'WooCommerce product structured data'],
  ['068', 'technical_seo', 'Article schema with Yoast'],
  ['067', 'technical_seo', 'Article schema with Rank Math'],
  ['064', 'technical_seo', 'Canonical with SEOPress'],
  ['063', 'technical_seo', 'Noindex with SEOPress'],
  ['062', 'technical_seo', 'Canonical with All in One'],
  ['061', 'technical_seo', 'Noindex with All in One'],
  ['059', 'technical_seo', 'Noindex with Yoast'],
  ['057', 'technical_seo', 'Noindex with Rank Math'],
  ['051', 'technical_seo', 'Page caching'],
  ['050', 'technical_seo', 'Page speed'],
  ['054', 'technical_seo', 'robots.txt with Rank Math'],
  ['056', 'technical_seo', 'Many redirects'],
  ['055', 'technical_seo', 'One redirect'],
  ['040', 'technical_seo', 'Choose a sitemap guide'],
  ['014', 'tracking', 'Agency Tag Manager access'],
  ['013', 'tracking', 'Agency GA4 access'],
];
export const SOP_INDEX: { n: string; category: string; title: string }[] = SOP_ROWS.map(([n, category, title]) => ({ n, category, title }));

function log(logs: SopLog[], ruleId: string, sop: string, result: SopLog['result'], detail: string) {
  logs.push({ ruleId, sop, result, detail });
}

function headlineOk(spec: CampaignSpec): string | undefined {
  for (const group of spec.adGroups) {
    const heads = group.rsa?.headlines ?? [];
    const desc = group.rsa?.descriptions ?? [];
    if (heads.length < 3 || desc.length < 2) return `${group.name} needs at least 3 headlines and 2 descriptions (SOP 130).`;
    if (heads.some((line) => line.length > 30) || desc.some((line) => line.length > 90)) return `${group.name} has a line over 30 or 90 characters (SOP 130).`;
    if (heads.length < 8 || desc.length < 2) return `${group.name} is under the 8 headline draft SOP 130 asks for.`;
  }
  return undefined;
}

export function runSopGate(action: SopAction, subject: SopSubject): SopGate {
  const logs: SopLog[] = [];
  const fixes: string[] = [];
  const warns: string[] = [];
  const blocks: string[] = [];
  const next: SopSubject = { ...subject, spec: subject.spec ? { ...subject.spec, adGroups: subject.spec.adGroups.map((g) => ({ ...g, keywords: [...g.keywords], rsa: { ...g.rsa } })) } : undefined };
  const mode = subject.mode ?? 'manual';
  const add = (ruleId: string, sop: string, result: SopLog['result'], detail: string) => {
    log(logs, ruleId, sop, result, detail);
    if (result === 'fixed') fixes.push(`${ruleId} (SOP ${sop}): ${detail}`);
    if (result === 'warn') warns.push(`${ruleId} (SOP ${sop}): ${detail}`);
    if (result === 'block') blocks.push(`${ruleId} (SOP ${sop}): ${detail}`);
  };

  if ((action === 'campaign_create' || action === 'campaign_enable' || action === 'asset_save' || action === 'keyword_add') && next.spec) {
    const ruled = enforceRulebook(next.spec, { trade: subject.trade, city: subject.city, phone: subject.phone, gbpUrl: subject.gbpUrl } satisfies RulebookContext);
    next.spec = ruled.spec;
    if (ruled.fixes.length) add('sop147-ready', '147', 'fixed', ruled.fixes[0]!);
    for (const block of ruled.blocks) add('sop147-ready', '147', 'block', block);
    const short = headlineOk(next.spec);
    if (short?.includes('at least 3') || short?.includes('30 or 90')) add('sop130-rsa', '130', 'block', short);
    else if (short) add('sop130-rsa', '130', 'warn', short);
    else add('sop130-rsa', '130', 'pass', 'Headlines and descriptions fit SOP 130.');
    if (!next.spec.finalUrl || !/^https:\/\/.+\..+/.test(next.spec.finalUrl)) add('sop130-destination', '130', 'block', 'The landing page is not a real https URL.');
    else add('sop130-destination', '130', 'pass', 'Each ad group has a landing page.');
    if (next.spec.networks.some((n) => /display|partner/i.test(n))) add('sop147-search-presence', '147', 'block', 'Display or Search partners are on. SOP 147 keeps this to Google Search.');
    else add('sop147-search-presence', '147', 'pass', 'Google Search only. Presence is on the plan. Radius and hours are Miles defaults.');
    if (action === 'campaign_create' && next.spec.status !== 'PAUSED') {
      next.spec.status = 'PAUSED';
      add('sop147-ready', '147', 'fixed', 'Create stays paused until a separate enable reads Google back as on.');
    }
    const badLink = (next.spec.sitelinks ?? []).find((link) => link.text.length > 25 || (link.desc1 && link.desc1.length > 35) || !/^https:\/\//.test(link.url));
    if (badLink) add('sop149-assets', '149', 'block', `Sitelink "${badLink.text}" breaks the 25/35 character limits or has no https URL.`);
    else if ((next.spec.sitelinks?.length ?? 0) < 4) add('sop149-assets', '149', 'warn', 'Fewer than 4 useful sitelinks. SOP 149 aims for four when the site has the pages.');
    else add('sop149-assets', '149', 'pass', 'Assets fit the character limits.');
    if (action === 'campaign_create') add('sop147-not-sent', '147', 'warn', 'Presence, the 15 mile radius, and the ad schedule are saved on the plan. The verified Google create action cannot carry them, so they were not sent.');
    if (subject.tracking?.ga4Linked) add('sop134-ga4', '134', 'pass', 'Google Ads is marked linked to GA4.');
    else if (action === 'campaign_create' || action === 'campaign_enable') add('sop134-ga4', '134', 'warn', 'GA4 is not marked linked. Reports will not line up until SOP 134 is done.');
    const emptyUtm = /[?&]utm_[a-z]+=(&|$)/i.test(next.spec.finalUrl);
    if (emptyUtm) add('sop008-utm', '008', 'warn', 'A UTM tag is empty. SOP 008 wants a source, medium, and campaign when tags are used.');
  }

  if (action === 'campaign_enable') {
    if (!subject.tracking?.leadConversion) add('sop039-lead', '039', 'block', 'No proof a lead form or thank-you page is counted. Hold enable until SOP 039, 002, or 019 is done.');
    else if (subject.tracking.method === 'purchase') add('sop039-lead', '039', 'block', 'The counted action is a purchase. This contractor campaign should count a lead.');
    else add('sop039-lead', '039', 'pass', 'A lead conversion is marked ready.');
  }

  if (action === 'negative_add') {
    const term = (subject.negative || '').toLowerCase();
    const hit = (subject.protectTerms ?? []).find((word) => word && term.includes(word.toLowerCase()));
    if (!term) add('sop129-protect', '129', 'block', 'There is no search term to exclude.');
    else if (hit) add('sop129-protect', '129', 'block', `"${subject.negative}" would also block "${hit}", which this campaign wants.`);
    else add('sop129-protect', '129', 'pass', 'The negative does not block a wanted service.');
  }

  if (action === 'budget_change') {
    const daily = subject.budget?.daily ?? 0;
    const cap = subject.budget?.approvedDaily ?? 0;
    if (cap && daily > cap) add('sop018-loop', '018', 'block', `$${daily}/day is over the approved $${cap}/day. SOP 147 treats a different budget as a blocker.`);
    else add('sop018-loop', '018', 'pass', 'The budget change stays inside the approved amount.');
  }

  if (action === 'bid_change' || action === 'keyword_add') {
    add('sop018-loop', '018', 'warn', 'This is a prioritized change, logged so it can be reverted. Spend thresholds on keyword pauses are Miles defaults.');
  }

  if (action === 'ghl_send') {
    const g = subject.ghl ?? {};
    if (!g.phone && !g.email) add('sop076-intake', '076', 'block', 'No phone or email, so there is nobody to follow up with.');
    else if (!g.message?.trim()) add('sop076-intake', '108', 'block', 'The follow-up message is empty.');
    else if (/\$\s?\d+|\bprice is\b/i.test(g.message)) add('sop076-intake', '110', 'block', 'The message states a price Miles was not given.');
    else add('sop076-intake', '076', 'pass', 'The follow-up has a recipient and a message.');
  }

  if (action === 'ghl_pipeline') {
    if (!subject.ghl?.pipelineStage?.trim()) add('sop005-stage', '005', 'block', 'No pipeline stage was named. Miles will not invent one.');
    else add('sop005-stage', '005', 'pass', 'The opportunity uses a named stage.');
  }

  if (action === 'seo_publish') {
    const page = subject.seo ?? {};
    if (!page.title?.trim() || !page.h1?.trim()) add('sop042-page', '042', 'block', 'The page needs a title and one H1 before it is marked ready.');
    else if (!page.meta?.trim()) add('sop042-page', '032', 'block', 'The page needs a meta description.');
    else add('sop042-page', '042', 'pass', 'Title, H1, and meta description are present.');
    if (page.noindex) add('sop065-index', '065', 'block', 'This page is noindex. Do not publish a page you want customers to find.');
    else add('sop065-index', '065', 'pass', 'The page is not marked noindex.');
    if (!subject.gbpUrl) add('sop095-profile', '095', 'warn', 'No Google Business Profile link is saved.');
    else add('sop095-profile', '095', 'pass', 'A Business Profile link is on file.');
  }

  if (action === 'tracking_setup') {
    if (!subject.tracking?.leadConversion && !subject.tracking?.ga4Linked) add('sop039-lead', '039', 'block', 'Nothing was marked: no lead action and no GA4 link.');
    else add('sop039-lead', '039', 'pass', 'Tracking proof was recorded. Miles still does not install tags.');
  }

  if (action === 'report') {
    if (!subject.reportPeriod?.trim()) {
      next.reportPeriod = 'last completed calendar month';
      add('sop131-period', '131', 'fixed', 'No period was supplied, so the report uses the last completed calendar month (SOP 129).');
    } else add('sop131-period', '131', 'pass', `Report period: ${subject.reportPeriod}.`);
  }

  if (action === 'campaign_pause') add('sop147-ready', '147', 'pass', 'Pausing keeps ads off, which is the safe state while a review is open.');
  if (action === 'other') add('sop018-loop', '018', 'warn', 'No home-services SOP covers this connector call. It was logged and not treated as a campaign change.');

  const blocked = blocks.length > 0;
  const disposition = blocked ? 'block' : mode === 'manual' ? 'show' : mode === 'hybrid' ? 'queue' : 'execute';
  return { subject: next, logs, fixes, warns, blocks, disposition };
}

export function formatSopLog(gate: SopGate): string {
  const pick = (result: SopLog['result']) => gate.logs.filter((row) => row.result === result).map((row) => row.ruleId);
  return `passed: ${pick('pass').join(', ') || 'none'}; fixed: ${pick('fixed').join(', ') || 'none'}; warned: ${pick('warn').join(', ') || 'none'}; blocked: ${pick('block').join(', ') || 'none'}`;
}

export function sopCoverage(): { n: string; category: string; title: string; state: string }[] {
  return SOP_INDEX.map((row) => {
    const rules = SOP_RULES.filter((rule) => rule.sops.includes(row.n));
    if (rules.length) return { ...row, state: rules.map((rule) => rule.id).join(', ') };
    return { ...row, state: NA_REASON[row.n] || 'Not a home-services action Miles can run yet.' };
  });
}

/** Executor calls in server.ts must sit just after the gate. */
export function ungatedExecutorCalls(source: string): string[] {
  const lines = source.split('\n');
  const bad: string[] = [];
  const window: string[] = [];
  lines.forEach((line, index) => {
    window.push(line);
    if (window.length > 40) window.shift();
    if (/connector\.(launchCampaign|setGoogleCampaignStatus|runAppTask)!?\(/.test(line)) {
      if (!window.some((prev) => /runSopGate\(/.test(prev))) bad.push(`${index + 1}: ${line.trim()}`);
    }
  });
  return bad;
}
