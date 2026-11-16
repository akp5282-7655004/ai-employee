/**
 * Rule-first skills for the daily read. They use stored pages, stored ads,
 * the profile, and the trade playbook. A missing input stays missing.
 */
import { audiencesFor, tradePlaybook, type PlaybookDoc } from '../playbooks/load.js';
import type { DailyInput, Finding } from './skills.js';

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

function plain(s: string): string {
  return s.replace(/\u2014/g, ', ').replace(/\u2013/g, '-').replace(/\s{2,}/g, ' ').trim();
}

function sectionLines(doc: PlaybookDoc, match: RegExp): string[] {
  const pools = [...(doc.sections || []), ...(doc.masterSections || [])];
  const hit = pools.find((section) => match.test(section.title));
  return (hit?.lines || []).map((line) => line.trim()).filter(Boolean);
}

function servicesOf(input: DailyInput, doc: PlaybookDoc): string[] {
  const fromProfile = (input.services || '').split(/[,;\n]/).map((part) => part.trim()).filter((part) => part.length > 2);
  const fromBook = (doc.keywords || []).map((word) => word.trim()).filter((word) => word.length > 2);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of [...fromProfile, ...fromBook]) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out.slice(0, 8);
}

function hasText(html: string, re: RegExp): boolean {
  return re.test(html);
}

export function landingPages(input: DailyInput): Finding[] {
  const doc = tradePlaybook(input.trade);
  const rules = sectionLines(doc, /landing page/i).slice(0, 4);
  const pages = input.pages || [];
  if (!pages.length) {
    const why = input.channels.google
      ? 'Google Ads is connected, but no final URL from a live ad is stored.'
      : 'Google Ads is not connected, so Miles has no final URL from a live ad.';
    return [{ id: 'landing-pages-missing', skill: 'landing-pages', title: 'Landing pages', detail: plain(`${why} Add the ad's final URL, then Miles can check status, speed, the phone number, the form, and the ${doc.label} landing-page rules.`) }];
  }
  const findings: Finding[] = [];
  for (const page of pages.slice(0, 4)) {
    const bits: string[] = [];
    if (page.status == null && !page.html) {
      bits.push(`The URL is saved (${page.url}). Miles has not read the page, so status, load time, the phone number, and the form are not known yet.`);
    } else {
      if (page.status != null && page.status >= 400) bits.push(`The page returned status ${page.status}. Fix the link before sending more clicks there.`);
      else if (page.status != null) bits.push(`The page returned status ${page.status}.`);
      else bits.push('A status code was not stored with this page read.');
      if (page.loadMs == null) bits.push('Load time was not measured.');
      else if (page.loadMs > 3000) bits.push(`It took ${Math.round(page.loadMs / 100) / 10} seconds to load. Aim for under 3 seconds on a phone.`);
      else bits.push(`Load time on file is ${Math.round(page.loadMs / 100) / 10} seconds.`);
      if (page.html) {
        const html = page.html;
        const viewport = hasText(html, /<meta[^>]+name=["']viewport["']/i);
        const phone = hasText(html, /href=["']tel:/i) || hasText(html, /\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}/);
        const form = hasText(html, /<form\b/i);
        const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        bits.push(viewport ? 'A mobile viewport tag is present.' : 'No mobile viewport tag. Phones may show a desktop page.');
        bits.push(phone ? 'A phone number is on the page.' : 'No phone number was found. Put a tap-to-call number above the fold.');
        bits.push(form ? 'A form is on the page.' : 'No form was found. The playbook asks for name, phone, ZIP, and job type.');
        const needles = [...(page.keywords || []), ...(input.services || '').split(',')].map((word) => word.trim().toLowerCase()).filter((word) => word.length > 3);
        const hay = `${h1} ${html}`.toLowerCase();
        const hit = needles.find((word) => hay.includes(word));
        if (!needles.length) bits.push('No ad-group keyword or service is stored, so Miles cannot check that the headline matches the ad.');
        else if (!h1) bits.push('No H1 was found. The playbook asks for an H1 with the service and the city.');
        else if (hit) bits.push(`The page mentions "${hit}", which matches the ad or the service list.`);
        else bits.push(`The H1 is "${h1.slice(0, 80)}". It does not mention the ad-group keywords or the saved services.`);
        if (input.city && !hay.includes(input.city.toLowerCase())) bits.push(`The city "${input.city}" is not on the page. The playbook asks for the service in the city.`);
      }
    }
    if (rules.length) bits.push(`Playbook landing-page rules: ${rules.join(' ')}`);
    findings.push({
      id: `landing-pages-${pages.indexOf(page) + 1}`,
      skill: 'landing-pages',
      title: page.adGroup ? `Landing page for ${page.adGroup}` : 'Landing page',
      detail: plain(bits.join(' ')),
    });
  }
  return findings;
}

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : clean.slice(0, max - 1).trim();
}

export function feedTitles(input: DailyInput): Finding[] {
  const doc = tradePlaybook(input.trade);
  const assets = input.assets || [];
  if (!assets.length) {
    const why = input.channels.google
      ? 'Google Ads is connected, but no headlines or descriptions are stored.'
      : 'Google Ads is not connected, and no saved ad plan has headlines.';
    return [{ id: 'feed-titles-missing', skill: 'feed-titles', title: 'Feed and titles', detail: plain(`${why} Miles will not invent ad copy until those assets are on file.`) }];
  }
  const services = servicesOf(input, doc);
  const blob = assets.flatMap((asset) => [...asset.headlines, ...asset.descriptions]).join(' ').toLowerCase();
  const missing: string[] = [];
  for (const service of services.slice(0, 5)) {
    if (!blob.includes(service.toLowerCase())) missing.push(service);
  }
  if (input.city && !blob.includes(input.city.toLowerCase())) missing.push(input.city);
  if (input.offer && !blob.includes(input.offer.toLowerCase().slice(0, 24))) missing.push('the saved offer');
  const trust = ['licensed', 'insured', 'warranty', 'rated'];
  if (!trust.some((word) => blob.includes(word))) missing.push('a trust line such as licensed, insured, or a real rating');
  const source = input.assetSource === 'live' ? 'These are the stored live ad assets.' : 'These headlines are from the saved campaign plan, not a live Google read.';
  if (!missing.length) {
    return [{ id: 'feed-titles-clear', skill: 'feed-titles', title: 'Feed and titles', detail: plain(`${source} Headlines and descriptions cover the saved services, location, offer, and a trust line.`) }];
  }
  const city = input.city || 'your city';
  const lead = services[0] || doc.keywords[0] || doc.label;
  const headline = clip(`${lead} in ${city}`, 30);
  const description = clip(`${input.offer || lead}. Licensed and insured. Call for a quote in ${city}.`, 90);
  return [{
    id: 'feed-titles-gaps',
    skill: 'feed-titles',
    title: 'Ad copy is missing playbook coverage',
    detail: plain(`${source} Missing: ${missing.join(', ')}. Proposed headline: "${headline}". Proposed description: "${description}". This is a proposal only.`),
    action: {
      kind: 'propose',
      title: 'Replace weak headlines from the playbook',
      spend: 0,
      before: assets[0]?.headlines.slice(0, 2).join(' | ') || 'Current headlines',
      after: `${headline} | ${description}`,
    },
  }];
}

export function marginCac(input: DailyInput): Finding[] {
  const doc = tradePlaybook(input.trade);
  const spend = input.campaigns.reduce((sum, row) => sum + (row.spend || 0), 0);
  const missing: string[] = [];
  if (!input.channels.google && !input.channels.meta && spend <= 0) missing.push('ad spend');
  if (!(input.leads > 0)) missing.push('leads');
  if (!(input.bookedJobs > 0)) missing.push('booked jobs');
  if (!(typeof input.avgTicket === 'number' && input.avgTicket > 0)) missing.push('average job value');
  if (!(typeof input.closeRate === 'number' && input.closeRate > 0)) missing.push('close rate');
  if (!(typeof input.targetCpa === 'number' && input.targetCpa > 0)) missing.push('target cost per lead');

  const cpl = spend > 0 && input.leads > 0 ? spend / input.leads : null;
  const perJob = spend > 0 && input.bookedJobs > 0 ? spend / input.bookedJobs : null;
  const parts: string[] = [];
  if (cpl != null) parts.push(`Cost per lead is ${money(cpl)} (${money(spend)} spent, ${input.leads} leads).`);
  else if (spend > 0) parts.push(`Spend on file is ${money(spend)}. Cost per lead needs a lead count above zero.`);
  else parts.push('No ad spend is stored, so cost per lead is not a number.');
  if (perJob != null) parts.push(`Cost per booked job is ${money(perJob)} (${input.bookedJobs} booked).`);
  else parts.push('No booked jobs are on file, so cost per booked job is not a number.');
  if (typeof input.avgTicket === 'number' && input.avgTicket > 0 && perJob != null) {
    const margin = Math.round((1 - perJob / input.avgTicket) * 100);
    parts.push(`That cost is ${money(perJob)} against an average job of ${money(input.avgTicket)}, about ${margin}% before overhead.`);
  }
  const target = typeof input.targetCpa === 'number' && input.targetCpa > 0 ? input.targetCpa : null;
  const bookTarget = doc.economics?.allowableCostPerSoldJob;
  if (target != null && cpl != null) parts.push(cpl <= target ? `On track. Cost per lead is within the saved target of ${money(target)}.` : `Off track. Cost per lead is above the saved target of ${money(target)}.`);
  else if (bookTarget && perJob != null) parts.push(perJob <= bookTarget ? `On track against the playbook cost per booked job of ${money(bookTarget)}.` : `Off track against the playbook cost per booked job of ${money(bookTarget)}.`);
  else parts.push('Miles will not call this on track or off track until both a cost and a target are on file.');

  const ask = missing[0];
  if (ask) {
    const suggestion = ask === 'average job value' && doc.economics?.ticket
      ? `The ${doc.label} playbook uses ${money(doc.economics.ticket)} as a planning ticket. Is yours close?`
      : ask === 'target cost per lead' && doc.economics?.costPerLead
        ? `The ${doc.label} playbook holds cost per lead near ${money(doc.economics.costPerLead)}. Want that as the target?`
        : `What is your ${ask}?`;
    parts.push(`Missing: ${missing.join(', ')}. One question: ${suggestion}`);
  }
  return [{ id: missing.length ? 'margin-cac-open' : 'margin-cac-clear', skill: 'margin-cac', title: 'Margin and cost to acquire', detail: plain(parts.join(' ')) }];
}

export function auditsSkill(input: DailyInput): Finding[] {
  const doc = tradePlaybook(input.trade);
  const page = (input.pages || []).find((row) => row.html);
  if (!page) {
    return [{ id: 'audits-missing', skill: 'audits', title: 'Audits', detail: plain(input.website ? `Website ${input.website} is saved, but the page HTML is not stored, so Miles will not score it.` : 'No website is saved, so the audit has nothing to read.') }];
  }
  const html = page.html || '';
  const checks = [
    [/href=["']tel:/i, 'a tap-to-call phone number'],
    [/<form\b/i, 'a form'],
    [/<meta[^>]+name=["']viewport["']/i, 'a mobile viewport'],
    [/<h1[\s>]/i, 'an H1'],
  ] as const;
  const gaps = checks.filter(([re]) => !re.test(html)).map(([, label]) => label);
  const rule = sectionLines(doc, /landing page/i)[0];
  const detail = gaps.length
    ? `The stored page is missing ${gaps.join(', ')}.${rule ? ` Playbook: ${rule}` : ''}`
    : `The stored page has a phone link, a form, a mobile viewport, and an H1.${rule ? ` Playbook: ${rule}` : ''}`;
  return [{ id: gaps.length ? 'audits-gaps' : 'audits-clear', skill: 'audits', title: 'Page audit', detail: plain(detail) }];
}

export function structureSkill(input: DailyInput): Finding[] {
  const doc = tradePlaybook(input.trade);
  const services = servicesOf(input, doc).slice(0, 5);
  if (!input.channels.google && !input.campaigns.length) {
    return [{ id: 'structure-offline', skill: 'structure', title: 'Account structure', detail: 'Google Ads is not connected and no campaigns are stored, so Miles cannot check one campaign per service.' }];
  }
  if (!services.length) {
    return [{ id: 'structure-noservices', skill: 'structure', title: 'Account structure', detail: `The ${doc.label} playbook has no service keywords on file, and the profile has no services list.` }];
  }
  const names = input.campaigns.map((row) => row.name.toLowerCase());
  const missing = services.filter((service) => !names.some((name) => name.includes(service.toLowerCase().split(' ')[0] || service.toLowerCase())));
  if (!missing.length) {
    return [{ id: 'structure-clear', skill: 'structure', title: 'Account structure', detail: 'Each saved service has a campaign name that mentions it. The playbook asks for one campaign per service line.' }];
  }
  return [{
    id: 'structure-gaps',
    skill: 'structure',
    title: 'A service has no matching campaign',
    detail: plain(`The playbook asks for one campaign per service. No stored campaign name matches: ${missing.join(', ')}. This is a proposal. Miles did not create a campaign.`),
    action: {
      kind: 'propose',
      title: `Draft a campaign for ${missing[0]}`,
      spend: 0,
      before: input.campaigns.map((row) => row.name).join(', ') || 'No campaigns',
      after: `Proposed campaign: ${missing[0]}`,
    },
  }];
}

export function audiencesSkill(input: DailyInput): Finding[] {
  const file = audiencesFor(input.trade);
  const doc = tradePlaybook(input.trade);
  const names = (file.segments || []).map((row) => row.name).filter(Boolean);
  const age = doc.audienceRules?.metaAdvantageAgeControl;
  if (!names.length) {
    return [{ id: 'audiences-missing', skill: 'audiences', title: 'Audiences', detail: plain(`The ${doc.label} playbook has audience rules${age ? `, including a Meta age control of ${age}` : ''}, and no named audience segments on file. Miles will not invent a segment.`) }];
  }
  return [{ id: 'audiences-clear', skill: 'audiences', title: 'Audiences', detail: plain(`Playbook audiences: ${names.slice(0, 6).join(', ')}.${age ? ` Meta age control is ${age}.` : ''} These are the playbook names, not a live ad-account audience read.`) }];
}

export function seasonalSkill(input: DailyInput, now = input.now): Finding[] {
  const doc = tradePlaybook(input.trade);
  const lines = sectionLines(doc, /season/i);
  if (!lines.length) {
    return [{ id: 'seasonal-missing', skill: 'seasonal', title: 'Seasonal', detail: `The ${doc.label} playbook does not include a seasonality section, so Miles will not name a service to push.` }];
  }
  const when = new Date(now);
  const month = when.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  const quarter = `Q${Math.floor(when.getUTCMonth() / 3) + 1}`;
  const hit = lines.filter((line) => new RegExp(`\\b${month}\\b|\\b${quarter}\\b`, 'i').test(line));
  if (!hit.length) {
    return [{ id: 'seasonal-unnamed', skill: 'seasonal', title: 'Seasonal', detail: plain(`The ${doc.label} playbook has a seasonality section, and it does not name ${month} or ${quarter}. Miles will not pick a service for this month.`) }];
  }
  return [{ id: 'seasonal-now', skill: 'seasonal', title: `Seasonal note for ${month}`, detail: plain(`From the ${doc.label} playbook calendar: ${hit.slice(0, 3).join(' ')}`) }];
}

export function deskSkills(input: DailyInput): Finding[] {
  return [
    ...landingPages(input),
    ...feedTitles(input),
    ...marginCac(input),
    ...auditsSkill(input),
    ...structureSkill(input),
    ...audiencesSkill(input),
    ...seasonalSkill(input),
  ];
}
