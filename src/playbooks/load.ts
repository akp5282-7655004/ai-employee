/**
 * Trade playbooks converted from the Nov 15, 2026 documents.
 * A known trade loads that file. Anything else uses the master template.
 * Fields the trade file does not set stay on the master.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface PlaybookSection {
  title: string;
  lines: string[];
}

export interface PlaybookEconomics {
  ticket?: number;
  grossMargin?: string;
  allowableCostPerSoldJob?: number;
  financingFromMonthly?: number;
  costPerLead?: number;
  budgetSplit?: { search: number; lsa: number; meta: number };
  source: string;
}

export interface AudienceRules {
  plannedAgeMin: number;
  zipIncomeFloor: number;
  emergencyAgeMin: number;
  metaAdvantageAgeControl: number;
  metaAgeSpendReviewPct: number;
  googleObserveConversions: number;
  googleNeverExcludeIncomeTiers: string[];
  alwaysExclude: string[];
  neverUse: string[];
}

export interface PlaybookDoc {
  id: string;
  name: string;
  label: string;
  version: string;
  summary: string;
  sections: PlaybookSection[];
  masterSections?: PlaybookSection[];
  negatives: string[];
  keywords: string[];
  baseNegatives?: string[];
  operatingRules?: string[];
  audienceRules?: AudienceRules;
  economics?: PlaybookEconomics;
  budgetMoveTestPct?: number;
  budgetMoveTestDays?: number;
  launchDoNotTouchDays?: number[];
}

const TRADE_KEYS = ['roofing', 'hvac', 'plumbing', 'electrical', 'painting', 'solar', 'landscaping'] as const;
const STEMS: Record<(typeof TRADE_KEYS)[number], string> = {
  painting: 'paint',
  roofing: 'roof',
  plumbing: 'plumb',
  electrical: 'electric',
  landscaping: 'landscap',
  hvac: 'hvac',
  solar: 'solar',
};

function dataDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'data');
}

function readDoc(file: string): PlaybookDoc {
  return JSON.parse(readFileSync(join(dataDir(), file), 'utf8')) as PlaybookDoc;
}

export function masterPlaybook(): PlaybookDoc {
  return readDoc('master.json');
}

export function tradeKeyOf(trade?: string): string | null {
  const name = (trade || '').toLowerCase();
  return TRADE_KEYS.find((key) => name.includes(key) || name.includes(STEMS[key])) ?? null;
}

/** The playbook Miles should run. Unknown trades get the master template. */
export function tradePlaybook(trade?: string): PlaybookDoc {
  const master = masterPlaybook();
  const key = tradeKeyOf(trade);
  if (!key) {
    return { ...master, id: 'master', label: 'Master template', name: master.name };
  }
  const specific = readDoc(`${key}.json`);
  const negatives = [...new Set([...(master.baseNegatives ?? []), ...specific.negatives])];
  return {
    ...master,
    ...specific,
    version: specific.version || master.version,
    negatives,
    keywords: specific.keywords.length ? specific.keywords : [],
    sections: specific.sections.length ? specific.sections : master.sections,
    masterSections: master.sections,
    operatingRules: master.operatingRules,
    audienceRules: master.audienceRules,
    baseNegatives: master.baseNegatives,
    economics: specific.economics,
  };
}

export interface AudienceSegment {
  id: string;
  name: string;
  demand: string;
  age: string;
  zip_income: string;
  homeowner: string;
  zip_filters: string;
  meta: string;
  google: string;
  seed: string;
}

export interface AudienceFile {
  trade?: string;
  defaults: {
    version: string;
    always_exclude: string[];
    never_use: string[];
    platform_rules: {
      meta: { advantage_plus_audience: boolean; age_note: string };
      google_search: { demographics_mode: string };
      google_lsa: string;
    };
  };
  segments: AudienceSegment[];
}

function audienceDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'audiences');
}

export function audiencesFor(trade?: string): AudienceFile {
  const key = tradeKeyOf(trade);
  const file = key ? `miles_audiences_${key}.json` : 'defaults.json';
  const raw = JSON.parse(readFileSync(join(audienceDir(), file), 'utf8')) as AudienceFile & { trades?: Record<string, { segments: AudienceSegment[] }> };
  if (raw.segments) return raw;
  return { defaults: raw.defaults, segments: [] };
}
