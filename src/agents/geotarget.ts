/**
 * Service area to Google geo target constants, without a place id.
 *
 * The GAQL is the same query Google documents for geo_target_constant:
 * name or ZIP, country_code US, target_type City, Postal Code, or County.
 * Pipedream's create-report action only allows campaign, ad_group,
 * ad_group_ad, and customer, so it rejects FROM geo_target_constant.
 * Miles still sends that GAQL on the report action when the action has a
 * query prop. Otherwise it uses Google's published geo target list
 * (2026-10-06), which is the same constant ids the query returns.
 *
 * A campaign does not launch when none of those match.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

export type GeoKind = 'City' | 'County' | 'Postal Code';

export interface GeoTarget {
  id: string;
  name: string;
  /** Lowercase state name. Empty for a ZIP or a target that came from a saved plan. */
  state?: string;
  targetType: GeoKind;
  resourceName: string;
}

export interface AreaTerm {
  kind: 'city' | 'county' | 'postal';
  name: string;
  state?: string;
  raw: string;
}

const STATES: Record<string, string> = {
  al: 'alabama', ak: 'alaska', az: 'arizona', ar: 'arkansas', ca: 'california', co: 'colorado',
  ct: 'connecticut', de: 'delaware', dc: 'district of columbia', fl: 'florida', ga: 'georgia',
  hi: 'hawaii', id: 'idaho', il: 'illinois', in: 'indiana', ia: 'iowa', ks: 'kansas', ky: 'kentucky',
  la: 'louisiana', me: 'maine', md: 'maryland', ma: 'massachusetts', mi: 'michigan', mn: 'minnesota',
  ms: 'mississippi', mo: 'missouri', mt: 'montana', ne: 'nebraska', nv: 'nevada', nh: 'new hampshire',
  nj: 'new jersey', nm: 'new mexico', ny: 'new york', nc: 'north carolina', nd: 'north dakota',
  oh: 'ohio', ok: 'oklahoma', or: 'oregon', pa: 'pennsylvania', ri: 'rhode island', sc: 'south carolina',
  sd: 'south dakota', tn: 'tennessee', tx: 'texas', ut: 'utah', vt: 'vermont', va: 'virginia',
  wa: 'washington', wv: 'west virginia', wi: 'wisconsin', wy: 'wyoming',
};

const STATE_NAMES = new Set(Object.values(STATES));

function stateOf(token: string | undefined): string | undefined {
  const text = (token || '').trim().toLowerCase().replace(/\./g, '');
  if (!text) return undefined;
  if (STATES[text]) return STATES[text];
  if (STATE_NAMES.has(text)) return text;
  return undefined;
}

/** Cities, counties, and ZIPs named in a service area. */
export function areaTerms(input: string | string[] | undefined): AreaTerm[] {
  const raw = (Array.isArray(input) ? input.join('; ') : input || '').trim();
  if (!raw) return [];
  const terms: AreaTerm[] = [];
  const seen = new Set<string>();
  const add = (term: AreaTerm) => {
    const key = `${term.kind}:${term.name}:${term.state || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    terms.push(term);
  };
  for (const match of raw.matchAll(/\b(\d{5})(?:-\d{4})?\b/g)) add({ kind: 'postal', name: match[1]!, raw: match[1]! });
  const text = raw.replace(/\b\d{5}(?:-\d{4})?\b/g, ' ');
  for (const chunk of text.split(/;|\||\n|\band\b/i)) {
    const piece = chunk.replace(/\s+/g, ' ').replace(/^[, ]+|[, ]+$/g, '').trim();
    if (!piece || /^\d+$/.test(piece)) continue;
    const county = piece.match(/^(.*?)(?:\s+county)(?:\s*,\s*|\s+)?([A-Za-z .]+)?$/i);
    if (county && county[1]?.trim()) {
      const state = stateOf(county[2]);
      add({ kind: 'county', name: `${county[1].trim()} County`, state, raw: piece });
      continue;
    }
    const parts = piece.split(',').map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const state = stateOf(parts[parts.length - 1]);
      const name = state ? parts.slice(0, -1).join(', ') : parts[0]!;
      if (name && !stateOf(name)) add({ kind: 'city', name, state, raw: piece });
      continue;
    }
    const tail = piece.match(/^(.*\S)\s+([A-Za-z]{2})$/);
    const state = stateOf(tail?.[2]);
    if (tail && state) add({ kind: 'city', name: tail[1]!.trim(), state, raw: piece });
    else if (!stateOf(piece)) add({ kind: 'city', name: piece, state: undefined, raw: piece });
  }
  return terms;
}

export function geoTargetGaql(term: AreaTerm): string {
  const type = term.kind === 'postal' ? 'Postal Code' : term.kind === 'county' ? 'County' : 'City';
  const name = term.name.replace(/'/g, "''");
  return [
    'SELECT geo_target_constant.id, geo_target_constant.name, geo_target_constant.canonical_name, geo_target_constant.country_code, geo_target_constant.target_type',
    'FROM geo_target_constant',
    `WHERE geo_target_constant.country_code = 'US'`,
    `AND geo_target_constant.target_type = '${type}'`,
    `AND geo_target_constant.name = '${name}'`,
  ].join(' ');
}

/**
 * Props for the same create-report action the status read uses.
 * segments is empty so no date filter is added. query carries the GAQL for
 * an action that still accepts one. resource is geo_target_constant.
 */
export function geoReportProps(args: {
  appName: string;
  authId: string;
  accountId: string;
  customerClientId?: string;
  term: AreaTerm;
}): Record<string, unknown> {
  const props: Record<string, unknown> = {
    [args.appName]: { authProvisionId: args.authId },
    accountId: args.accountId,
    resource: 'geo_target_constant',
    fields: ['id', 'name', 'canonical_name', 'country_code', 'target_type'],
    segments: [],
    query: geoTargetGaql(args.term),
  };
  if (args.customerClientId) props.customerClientId = args.customerClientId;
  return props;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function kindOf(value: unknown): GeoKind | undefined {
  const text = String(value ?? '').toLowerCase().replace(/_/g, ' ');
  if (text === 'city') return 'City';
  if (text === 'county') return 'County';
  if (text === 'postal code' || text === 'postalcode') return 'Postal Code';
  return undefined;
}

/** Rows from a geo_target_constant search. Country is US. Other types are skipped. */
export function parseGeoTargets(payload: unknown): GeoTarget[] {
  const found: GeoTarget[] = [];
  const seen = new Set<string>();
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const row = node as Record<string, unknown>;
    const geo = asRecord(row.geoTargetConstant) ?? asRecord(row.geo_target_constant);
    if (geo) {
      const country = String(geo.countryCode ?? geo.country_code ?? '').toUpperCase();
      const targetType = kindOf(geo.targetType ?? geo.target_type);
      const id = String(geo.id ?? String(geo.resourceName ?? geo.resource_name ?? '').split('/').pop() ?? '');
      const name = String(geo.name ?? '').trim();
      if (country === 'US' && targetType && /^\d+$/.test(id) && name && !seen.has(id)) {
        const canon = String(geo.canonicalName ?? geo.canonical_name ?? '');
        const state = canon.split(',')[1]?.trim().toLowerCase() || '';
        seen.add(id);
        found.push({ id, name, state, targetType, resourceName: `geoTargetConstants/${id}` });
      }
    }
    for (const value of Object.values(row)) walk(value);
  };
  walk(payload);
  return found;
}

/** Location criteria already on a campaign. The criterion id for a location is the geo constant id. */
export function parseLocationCriteria(payload: unknown): { id: string; negative: boolean }[] {
  const found: { id: string; negative: boolean }[] = [];
  const seen = new Set<string>();
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const row = node as Record<string, unknown>;
    const criterion = asRecord(row.campaignCriterion) ?? asRecord(row.campaign_criterion);
    if (criterion) {
      const type = String(criterion.type ?? '').toUpperCase();
      const location = asRecord(criterion.location);
      const fromLocation = String(location?.geoTargetConstant ?? location?.geo_target_constant ?? '').split('/').pop() || '';
      const resource = String(criterion.resourceName ?? criterion.resource_name ?? '');
      const fromResource = resource.match(/campaignCriteria\/\d+~(\d+)/)?.[1] || '';
      const criterionId = String(criterion.criterionId ?? criterion.criterion_id ?? '');
      const isLocation = type === 'LOCATION' || type === '7' || !!fromLocation;
      const id = /^\d+$/.test(fromLocation) ? fromLocation : (isLocation ? (criterionId || fromResource) : '');
      if (/^\d+$/.test(id) && !seen.has(id)) {
        seen.add(id);
        found.push({ id, negative: criterion.negative === true });
      }
    }
    for (const value of Object.values(row)) walk(value);
  };
  walk(payload);
  return found;
}

interface Index {
  city: Map<string, GeoTarget[]>;
  county: Map<string, GeoTarget[]>;
  zip: Map<string, GeoTarget>;
}

let index: Index | undefined;

function loadIndex(): Index {
  if (index) return index;
  const path = join(dirname(fileURLToPath(import.meta.url)), '../../data/us-geo-targets.tsv.gz');
  const text = zlib.gunzipSync(readFileSync(path)).toString('utf8');
  const city = new Map<string, GeoTarget[]>();
  const county = new Map<string, GeoTarget[]>();
  const zip = new Map<string, GeoTarget>();
  const push = (map: Map<string, GeoTarget[]>, key: string, target: GeoTarget) => {
    const list = map.get(key);
    if (list) list.push(target);
    else map.set(key, [target]);
  };
  for (const line of text.split('\n')) {
    if (!line) continue;
    const [flag, name, state, id] = line.split('\t');
    if (!name || !id) continue;
    const targetType: GeoKind = flag === 'Z' ? 'Postal Code' : flag === 'K' ? 'County' : 'City';
    const target: GeoTarget = { id, name, state: state || '', targetType, resourceName: `geoTargetConstants/${id}` };
    if (flag === 'Z') zip.set(name, target);
    else if (flag === 'K') push(county, name.toLowerCase(), target);
    else push(city, name.toLowerCase(), target);
  }
  index = { city, county, zip };
  return index;
}

function pick(list: GeoTarget[] | undefined, state?: string): GeoTarget | 'ambiguous' | undefined {
  if (!list?.length) return undefined;
  if (state) {
    const hits = list.filter((row) => row.state === state);
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) return 'ambiguous';
    return undefined;
  }
  if (list.length === 1) return list[0];
  return 'ambiguous';
}

export interface GeoResolution {
  targets: GeoTarget[];
  /** Plain reason when nothing matched. Empty when at least one target matched. */
  block: string;
}

export function resolveAreas(input: string | string[] | undefined): GeoResolution {
  const terms = areaTerms(input);
  if (!terms.length) {
    return { targets: [], block: 'Add a US city and state, or a ZIP, before Miles can target the service area. Nothing was created.' };
  }
  const book = loadIndex();
  const targets: GeoTarget[] = [];
  const seen = new Set<string>();
  const problems: string[] = [];
  for (const term of terms) {
    if (term.kind === 'postal') {
      const hit = book.zip.get(term.name);
      if (!hit) problems.push(`${term.raw} is not a US ZIP in Google's location list.`);
      else if (!seen.has(hit.id)) { seen.add(hit.id); targets.push(hit); }
      continue;
    }
    const map = term.kind === 'county' ? book.county : book.city;
    const picked = pick(map.get(term.name.toLowerCase()), term.state);
    if (picked === 'ambiguous') {
      problems.push(`${term.raw} matches more than one US ${term.kind}. Add the state, for example Philadelphia, PA.`);
    } else if (!picked) {
      problems.push(`${term.raw} did not match a US ${term.kind} in Google's location list.`);
    } else if (!seen.has(picked.id)) {
      seen.add(picked.id);
      targets.push(picked);
    }
  }
  if (!targets.length) {
    return { targets: [], block: `${problems[0] || 'No Google location matched this service area.'} Approve and launch stays off until one matches.` };
  }
  return { targets, block: '' };
}

/** Choose rows from a live geo_target_constant response for one area term. */
export function chooseGeoHits(term: AreaTerm, rows: GeoTarget[]): GeoTarget | 'ambiguous' | undefined {
  const typed = rows.filter((row) => {
    if (term.kind === 'postal') return row.targetType === 'Postal Code' && row.name === term.name;
    if (term.kind === 'county') return row.targetType === 'County' && row.name.toLowerCase() === term.name.toLowerCase();
    return row.targetType === 'City' && row.name.toLowerCase() === term.name.toLowerCase();
  });
  return pick(typed, term.state);
}

export function locationCriterion(target: GeoTarget): { geoTargetConstant: string } {
  return { geoTargetConstant: target.resourceName };
}

export function locationReadbackOk(wanted: GeoTarget[], found: { id: string; negative: boolean }[], presence?: string): { ok: boolean; reason: string } {
  const positive = new Set(found.filter((row) => !row.negative).map((row) => row.id));
  const missing = wanted.filter((row) => !positive.has(row.id));
  if (missing.length) return { ok: false, reason: `Google did not show location ${missing.map((row) => row.name).join(', ')} on the campaign.` };
  if (presence && presence.toUpperCase() !== 'PRESENCE' && presence !== '5' && presence !== '7') {
    return { ok: false, reason: `Google reports location targeting as ${presence}, not Presence only.` };
  }
  return { ok: true, reason: `Presence only for ${wanted.map((row) => row.name).join(', ')}.` };
}
