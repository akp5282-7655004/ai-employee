/**
 * Skills & Playbooks board.
 *
 * Every card is a trade playbook, a pack, or a skill that exists in code.
 * Active means this tenant has it on. A ready skill is available, not on.
 * Cost per lead matches the budget check. The playbook planning range is
 * labeled as a planning range, not as the published study.
 */
import { BENCHMARK_META } from '../packs/benchmarks.js';
import { listPacks } from '../packs/index.js';
import { cplBandForGoal, type CplBand } from '../agents/goalcheck.js';
import { playbookCplBand, playbookTrades } from '../agents/playbook.js';
import { tradeKey } from '../agents/feasibility.js';
import { SEVEN_SKILLS } from '../skills/seven.js';
import { SKILL_CATALOG } from '../skills/catalog.js';

export interface BoardCard {
  id: string;
  title: string;
  group: 'playbook' | 'pack' | 'skill' | 'schedule' | 'toolkit';
  active: boolean;
  status: string;
  yours: boolean;
  lines: { label: string; text: string }[];
}

export interface SkillsBoard {
  title: string;
  intro: string;
  cards: BoardCard[];
}

export interface SkillsBoardInput {
  trade?: string;
  installed?: string[];
  deployed?: string[];
  speedOn?: boolean;
  reviewOn?: boolean;
  hasSearchPlan?: boolean;
  activation?: string | null;
  socialConnected?: boolean;
  scheduledPosts?: number;
  ghlConnected?: boolean;
  localPresenceStarted?: boolean;
  weatherRulesOn?: number;
  noShowOn?: boolean;
  onboardingOn?: boolean;
}

function plain(s: string): string {
  return s
    .replace(/\u2014/g, ', ')
    .replace(/\u2013/g, '-')
    .replace(/→/g, ' to ')
    .replace(/searchlight\s*digital/gi, 'the published study')
    .replace(/searchlight/gi, 'the published study')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

function cplText(band: CplBand): string {
  if (band.single || band.low === band.high) return money(band.typical);
  const low = Math.min(band.low, band.high);
  const high = Math.max(band.low, band.high);
  const middle = band.typical !== low && band.typical !== high ? ` The study also lists ${money(band.typical)} for this trade.` : '';
  return `${money(low)} to ${money(high)}.${middle}`;
}

function studyLine(trade: string): string {
  const band = cplBandForGoal(trade, 'google_ads');
  if (!band) return `Miles will not guess a Google Ads cost per lead. Source: ${BENCHMARK_META.source}.`;
  const figures = cplText(band);
  if (band.source === 'similar') {
    return plain(`${figures} ${band.label} has no Google Ads row, so this is an estimate from similar home-services trades. ${money(Math.min(band.low, band.high))} includes people who search a company by name. ${money(Math.max(band.low, band.high))} is for everyone else. Miles uses this same range for the budget check. Source: ${BENCHMARK_META.source}.`);
  }
  return plain(`${figures} These are the published Google Ads figures for people who are not searching a company by name. Miles uses this same range for the budget check. Source: ${BENCHMARK_META.source}.`);
}

function planningLine(trade: string): string {
  const band = playbookCplBand(trade);
  if (!band) return 'This playbook does not store a planning range.';
  return plain(`${money(band.low)} to ${money(band.high)}. That is this playbook's planning range for a Meta campaign. It is not the published Google Ads study, and the budget check does not use it.`);
}

function structureLines(structure: 'roof' | 'core'): string {
  if (structure === 'roof') {
    return 'Two prospecting groups: pitched and shingle roofs in the suburbs, and flat or rubber roofs in the city. Plus a retargeting group for people who already visited.';
  }
  return 'One prospecting group for the main service, plus a retargeting group for people who already visited.';
}

function packName(key: string): string {
  if (key === 'roofing') return 'Roofing pack';
  if (key === 'solar') return 'Solar pack';
  return 'Home services pack';
}

function searchStatus(input: SkillsBoardInput): { active: boolean; status: string } {
  if (input.activation === 'enabled') return { active: true, status: 'Running' };
  if (input.activation === 'paused') return { active: false, status: 'Paused' };
  if (input.hasSearchPlan) return { active: false, status: 'Saved, not started' };
  return { active: false, status: 'Not started' };
}

export function buildSkillsBoard(input: SkillsBoardInput = {}): SkillsBoard {
  const yours = tradeKey(input.trade || '');
  const installed = new Set(input.installed ?? []);
  const deployed = new Set(input.deployed ?? []);
  const cards: BoardCard[] = [];

  for (const trade of playbookTrades()) {
    cards.push({
      id: `playbook-${trade.key}`,
      title: `${trade.label} playbook`,
      group: 'playbook',
      active: yours === trade.key && (input.activation === 'enabled' || input.activation === 'paused' || !!input.hasSearchPlan),
      status: yours === trade.key ? 'Your trade' : 'In the library',
      yours: yours === trade.key,
      lines: [
        { label: 'What Miles does', text: 'Miles builds a paused Google Search campaign from the business details you saved. This playbook also describes a Meta campaign with the groups below. Miles cannot launch Meta or Local Services Ads in this build.' },
        { label: 'Cost per lead Miles uses', text: studyLine(trade.label) },
        { label: 'Playbook planning range', text: planningLine(trade.label) },
        { label: 'Season', text: plain(trade.season) },
        { label: 'Campaign structure', text: structureLines(trade.structure) },
        { label: 'Pack', text: packName(trade.key) },
      ],
    });
  }

  for (const pack of listPacks()) {
    const hasPlaybook = playbookTrades().some((trade) => trade.key === pack.id || (pack.id === 'home_services' && !['roofing', 'solar'].includes(trade.key) && trade.key !== 'dental'));
    const categories = pack.categories.map((row) => row.label).join(', ');
    const bands = pack.economics?.budgetBands;
    const budget = bands
      ? `Pack budget bands: growth from ${money(bands.growth)} a month, scale from ${money(bands.scale)} a month. These are planning bands in the pack, not a cost per lead.`
      : 'This pack does not store budget bands.';
    const playbookNote = pack.id === 'dental'
      ? 'No campaign playbook is stored for dental, so this page does not invent a cost per lead or a season.'
      : hasPlaybook
        ? 'The campaign playbook for this pack is in the list above.'
        : 'No separate campaign playbook is stored for this pack.';
    cards.push({
      id: `pack-${pack.id}`,
      title: `${pack.label} pack`,
      group: 'pack',
      active: false,
      status: 'Loaded',
      yours: false,
      lines: [
        { label: 'Categories', text: categories },
        { label: 'Budget bands', text: budget },
        { label: 'Playbook', text: playbookNote },
      ],
    });
  }

  const search = searchStatus(input);
  const posts = input.scheduledPosts ?? 0;
  const weatherOn = input.weatherRulesOn ?? 0;
  const product: BoardCard[] = [
    {
      id: 'google-search',
      title: 'Google Search ads',
      group: 'skill',
      active: search.active,
      status: search.status,
      yours: false,
      lines: [
        { label: 'What it does', text: 'Builds one paused Google Search campaign and turns it on only after you approve, in your current mode.' },
        { label: 'Limit', text: 'It does not raise spend on its own.' },
      ],
    },
    {
      id: 'ad-creation',
      title: 'Ad creation',
      group: 'skill',
      active: false,
      status: 'Ready',
      yours: false,
      lines: [
        { label: 'What it does', text: 'Studio writes ad copy and can make images from your brand kit.' },
        { label: 'Limit', text: 'Making an ad does not publish it or spend money.' },
      ],
    },
    {
      id: 'seo-pages',
      title: 'SEO pages',
      group: 'skill',
      active: false,
      status: 'Ready as a draft',
      yours: false,
      lines: [
        { label: 'What it does', text: 'Miles can draft a page title, heading, and description from your site.' },
        { label: 'Limit', text: 'Miles marks the page ready. It does not publish to WordPress.' },
      ],
    },
    {
      id: 'social',
      title: 'Social posts',
      group: 'skill',
      active: !!input.socialConnected || posts > 0,
      status: posts > 0 ? `${posts} scheduled` : input.socialConnected ? 'Connected' : 'Not connected',
      yours: false,
      lines: [
        { label: 'What it does', text: 'Schedules posts when Facebook, Instagram, or LinkedIn is connected.' },
        { label: 'Limit', text: 'A connected page is not a Meta ad account. Miles does not launch Meta ads from here.' },
      ],
    },
    {
      id: 'speed-to-lead',
      title: 'Speed to lead',
      group: 'skill',
      active: !!input.speedOn,
      status: input.speedOn ? 'On' : 'Off',
      yours: false,
      lines: [
        { label: 'What it does', text: 'When a new lead or a missed call comes in, Miles drafts a text back. It sends only when this is on and GoHighLevel is connected.' },
      ],
    },
    {
      id: 'reviews',
      title: 'Review requests',
      group: 'skill',
      active: !!input.reviewOn,
      status: input.reviewOn ? 'On' : 'Off',
      yours: false,
      lines: [
        { label: 'What it does', text: 'Texts a review ask after a completed job when this is on and GoHighLevel can send.' },
      ],
    },
    {
      id: 'local-presence',
      title: 'Local presence',
      group: 'skill',
      active: !!input.localPresenceStarted,
      status: input.localPresenceStarted ? 'Started' : 'Not started',
      yours: false,
      lines: [
        { label: 'What it does', text: 'Checks the Google Business Profile facts you saved.' },
        { label: 'Limit', text: 'This build does not grade the profile on cost per booked job.' },
      ],
    },
    {
      id: 'weather',
      title: 'Weather rules',
      group: 'skill',
      active: weatherOn > 0,
      status: weatherOn > 0 ? `${weatherOn} on` : 'None on',
      yours: false,
      lines: [
        { label: 'What it does', text: 'A saved weather rule can fire when the forecast matches. Nothing fires until you turn a rule on.' },
      ],
    },
    {
      id: 'ghl-follow-up',
      title: 'GoHighLevel follow-up',
      group: 'skill',
      active: !!input.ghlConnected && (!!input.noShowOn || !!input.onboardingOn),
      status: !input.ghlConnected
        ? 'GoHighLevel is not connected'
        : [input.noShowOn ? 'No-show on' : '', input.onboardingOn ? 'New-customer on' : ''].filter(Boolean).join(', ') || 'Connected, both off',
      yours: false,
      lines: [
        { label: 'What it does', text: 'No-show and new-customer texts through GoHighLevel. Nothing sends until GoHighLevel is connected and the switch is on.' },
      ],
    },
  ];
  cards.push(...product);

  for (const skill of SEVEN_SKILLS) {
    const on = deployed.has(skill.key);
    cards.push({
      id: `seven-${skill.key}`,
      title: skill.name,
      group: 'schedule',
      active: on,
      status: on ? 'On a schedule' : 'Not on a schedule',
      yours: false,
      lines: [
        { label: 'What it does', text: plain(skill.what) },
        { label: 'Limit', text: skill.mode === 'read_only' ? 'Read only. It does not change the ad account.' : 'It writes a proposal. Nothing in the ad account changes until you approve it.' },
      ],
    });
  }

  for (const skill of SKILL_CATALOG) {
    const on = installed.has(skill.id);
    cards.push({
      id: `toolkit-${skill.id}`,
      title: skill.name,
      group: 'toolkit',
      active: on,
      status: on ? 'Installed' : 'Not installed',
      yours: false,
      lines: [
        { label: 'What it does', text: plain(skill.desc) },
        { label: 'Plays', text: skill.plays.map((play) => play.label).join(', ') },
      ],
    });
  }

  return {
    title: 'Skills and playbooks',
    intro: 'These are the playbooks and skills stored in Miles. A card is on only when this account has it running, saved, installed, or scheduled. Nothing here is a sample result.',
    cards: cards.map((card) => ({
      ...card,
      title: plain(card.title),
      status: plain(card.status),
      lines: card.lines.map((line) => ({ label: plain(line.label), text: plain(line.text) })),
    })),
  };
}

export function boardCopy(board: SkillsBoard): string[] {
  const out = [board.title, board.intro];
  for (const card of board.cards) {
    out.push(card.title, card.status);
    for (const line of card.lines) out.push(line.label, line.text);
  }
  return out;
}
