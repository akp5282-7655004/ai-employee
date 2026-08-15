/**
 * Market research from real US Census data (American Community Survey 5-year) —
 * the "customer & demographic data" behind the Research tab and the vision's
 * saturation/competitor meter (docs/VISION.md §5, feature #11). No API key
 * required for this volume. Called server-side; the app never needs the raw API.
 */
export interface RaceBreakdown {
  white: number;
  hispanic: number;
  black: number;
  asian: number;
  americanIndian: number;
  islander: number;
  multiRacial: number;
  nonwhite: number;
}

export interface Demographics {
  zip: string;
  name: string;
  place?: string;
  lat?: number;
  lng?: number;
  population: number;
  households: number;
  medianIncome: number;
  medianHomeValue: number;
  medianAge: number;
  homeownershipPct: number;
  race: RaceBreakdown;
  /** Housing-stock layer — signals repair/replacement demand for the trades. */
  medianYearBuilt: number;
  housingUnits: number;
  /** Share of homes built before 1980 (aging stock → more roofing/HVAC/plumbing work). */
  pctOlderHomes: number;
  /** Construction & trade businesses in the ZIP (competition), when available. */
  competition?: number;
  insight: string;
  /** A trade-focused read of the market (housing age + income + competition). */
  marketFit: string;
}

// population, income, home value, age, occupancy, and race/ethnicity (B03002, not-Hispanic breakdown).
const VARS = [
  'B01003_001E', // total population
  'B19013_001E', // median household income
  'B25077_001E', // median home value
  'B01002_001E', // median age
  'B25003_001E', // occupied housing units
  'B25003_002E', // owner-occupied
  'B03002_001E', // race universe (total)
  'B03002_003E', // White, not Hispanic
  'B03002_004E', // Black, not Hispanic
  'B03002_005E', // American Indian, not Hispanic
  'B03002_006E', // Asian, not Hispanic
  'B03002_007E', // Native Hawaiian / Pacific Islander, not Hispanic
  'B03002_009E', // Two or more races, not Hispanic
  'B03002_012E', // Hispanic or Latino
  'B25035_001E', // median year structure built
  'B25001_001E', // total housing units
  'B25034_001E', // year-built universe (total)
  'B25034_007E', // built 1970–1979
  'B25034_008E', // built 1960–1969
  'B25034_009E', // built 1950–1959
  'B25034_010E', // built 1940–1949
  'B25034_011E', // built 1939 or earlier
];

const num = (s: string | undefined): number => {
  const n = Number(s);
  return Number.isFinite(n) && n > -1_000_000 ? Math.max(0, Math.round(n)) : 0;
};

export async function fetchDemographics(zipInput: string): Promise<Demographics | null> {
  const zip = (zipInput || '').replace(/\D/g, '').slice(0, 5);
  if (zip.length !== 5) return null;

  const key = process.env.CENSUS_API_KEY ? `&key=${process.env.CENSUS_API_KEY.replace(/[^a-zA-Z0-9]/g, '')}` : '';
  const url =
    `https://api.census.gov/data/2022/acs/acs5?get=NAME,${VARS.join(',')}` +
    `&for=zip%20code%20tabulation%20area:${zip}${key}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = (await res.json()) as string[][];
  if (!Array.isArray(data) || data.length < 2) return null;
  const r = data[1]!;

  // r[0] is NAME; values follow in VARS order.
  const [pop, income, homeValue, age, occ, owner, raceTotal, white, black, amInd, asian, islander, multi, hisp] = [
    num(r[1]), num(r[2]), num(r[3]), num(r[4]), num(r[5]), num(r[6]),
    num(r[7]), num(r[8]), num(r[9]), num(r[10]), num(r[11]), num(r[12]), num(r[13]), num(r[14]),
  ];
  // Housing-stock layer.
  const medianYearBuilt = num(r[15]);
  const housingUnits = num(r[16]);
  const ybTotal = num(r[17]);
  const olderHomes = num(r[18]) + num(r[19]) + num(r[20]) + num(r[21]) + num(r[22]); // pre-1980
  const pctOlderHomes = ybTotal ? Math.round((olderHomes / ybTotal) * 1000) / 10 : 0;
  const competition = await fetchCompetition(zip);
  const pct = (v: number) => (raceTotal ? Math.round((v / raceTotal) * 1000) / 10 : 0);
  const race: RaceBreakdown = {
    white: pct(white),
    hispanic: pct(hisp),
    black: pct(black),
    asian: pct(asian),
    americanIndian: pct(amInd),
    islander: pct(islander),
    multiRacial: pct(multi),
    nonwhite: raceTotal ? Math.round((1 - white / raceTotal) * 1000) / 10 : 0,
  };

  const geo = await geocodeZip(zip);

  return {
    zip,
    name: (r[0] ?? `ZCTA ${zip}`).replace(/^ZCTA5\s*/, 'ZIP '),
    place: geo?.place,
    lat: geo?.lat,
    lng: geo?.lng,
    population: pop,
    households: occ,
    medianIncome: income,
    medianHomeValue: homeValue,
    medianAge: age,
    homeownershipPct: occ ? Math.round((owner / occ) * 100) : 0,
    race,
    medianYearBuilt,
    housingUnits,
    pctOlderHomes,
    competition,
    insight: insightFor(income, homeValue, occ ? Math.round((owner / occ) * 100) : 0),
    marketFit: marketFitFor(income, occ ? Math.round((owner / occ) * 100) : 0, pctOlderHomes, medianYearBuilt, competition),
  };
}

/** Construction & specialty-trade businesses in the ZIP (competition). Best-effort:
 * ZIP Business Patterns is 2018-vintage and needs a Census key for reliable access. */
async function fetchCompetition(zip: string): Promise<number | undefined> {
  try {
    const key = process.env.CENSUS_API_KEY ? `&key=${process.env.CENSUS_API_KEY}` : '';
    // NAICS 238 = Specialty Trade Contractors (plumbing, HVAC, electrical, roofing, painting…).
    const url = `https://api.census.gov/data/2018/zbp?get=ESTAB&for=zipcode:${zip}&NAICS2017=238${key}`;
    const res = await fetch(url);
    if (!res.ok) return undefined;
    const data = (await res.json()) as string[][];
    if (!Array.isArray(data) || data.length < 2) return undefined;
    return num(data[1]![0]);
  } catch {
    return undefined;
  }
}

function marketFitFor(income: number, ownership: number, pctOlder: number, medianYearBuilt: number, competition?: number): string {
  const parts: string[] = [];
  const age = medianYearBuilt ? new Date().getFullYear() - medianYearBuilt : 0;
  if (pctOlder >= 55 || (age && age >= 45)) {
    parts.push(`Aging housing stock (${pctOlder}% built before 1980${medianYearBuilt ? `, median built ${medianYearBuilt}` : ''}) — strong, steady demand for roofing, HVAC replacement, and plumbing repair.`);
  } else if (pctOlder <= 25) {
    parts.push(`Newer housing here (${pctOlder}% pre-1980) — lean toward installs, upgrades, and maintenance plans over emergency repair.`);
  } else {
    parts.push(`Mixed-age housing (${pctOlder}% pre-1980) — a healthy blend of repair and upgrade demand.`);
  }
  if (ownership >= 60) parts.push('High homeownership means decision-makers who pay for their own repairs.');
  if (competition !== undefined) {
    parts.push(
      competition >= 40
        ? `Competitive market — ~${competition} specialty-trade contractors here. Win on speed, reviews, and a sharp offer.`
        : competition > 0
          ? `Relatively open market — only ~${competition} specialty-trade contractors in this ZIP.`
          : 'Few registered trade contractors in this ZIP — potential underserved demand.',
    );
  }
  return parts.join(' ');
}

/** Free ZIP → lat/lng + place name for the map (no key). Best-effort. */
async function geocodeZip(zip: string): Promise<{ lat: number; lng: number; place: string } | undefined> {
  try {
    const res = await fetch(`https://api.zippopotam.us/us/${zip}`);
    if (!res.ok) return undefined;
    const j = (await res.json()) as any;
    const p = j?.places?.[0];
    if (!p) return undefined;
    return {
      lat: Number(p.latitude),
      lng: Number(p.longitude),
      place: `${p['place name']}, ${p['state abbreviation'] ?? p.state ?? ''}`.trim().replace(/,\s*$/, ''),
    };
  } catch {
    return undefined;
  }
}

function insightFor(income: number, homeValue: number, ownership: number): string {
  const affluent = income >= 90_000 || homeValue >= 450_000;
  const midMarket = income >= 55_000;
  const owners = ownership >= 60;
  if (affluent && owners) {
    return 'High-income, high-ownership market — strong fit for premium, high-ticket offers (roofing, solar, remodeling). Lead with quality and financing, not discounts.';
  }
  if (midMarket && owners) {
    return 'Solid middle-market with high homeownership — a healthy home-services market. Balance value offers with quality signals.';
  }
  if (!owners) {
    return 'Lower homeownership here — more renters. Favor services that fit renters/landlords, or widen the radius to nearby owner-heavy ZIPs.';
  }
  return 'Value-sensitive market — lead with strong front-door offers and volume; keep budgets efficient and cost-per-lead tight.';
}

// ── Affluence targeting — rank a service area's ZIPs by ability-to-spend ──
// So Miles sends premium offers where the money is, value offers everywhere.

export interface ZipAffluence {
  zip: string;
  medianIncome: number | null;
  perCapita: number | null;
  /** Share of households earning $150k+ (%) — the cleanest capacity-to-spend signal. */
  pctHighEarner: number | null;
  medianHomeValue: number | null;
  /** 0–100 blended affluence score. */
  affluenceScore: number;
  /** Modeled annual discretionary income ($) — an estimate, NOT a measured figure. */
  discretionaryEst: number | null;
  tier: 'premium' | 'mid' | 'value';
  demo?: boolean;
}

const AFF_VARS = ['B19013_001E', 'B19301_001E', 'B25077_001E', 'B19001_001E', 'B19001_016E', 'B19001_017E'];
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

function affScore(medianIncome: number | null, pctHigh: number | null, homeValue: number | null): number {
  const inc = medianIncome != null ? clamp01((medianIncome - 40000) / 160000) : 0;
  const high = pctHigh != null ? clamp01(pctHigh / 30) : 0;
  const home = homeValue != null ? clamp01((homeValue - 150000) / 850000) : 0;
  return Math.round((0.5 * inc + 0.3 * high + 0.2 * home) * 100);
}
/** Modeled discretionary income: after-tax income minus baseline + housing-cost necessities. */
function discretionaryOf(medianIncome: number | null, homeValue: number | null): number | null {
  if (medianIncome == null) return null;
  const necessities = 25000 + (homeValue != null ? homeValue * 0.04 : medianIncome * 0.25);
  return Math.max(0, Math.round(medianIncome * 0.78 - necessities));
}
const affTier = (s: number): ZipAffluence['tier'] => (s >= 66 ? 'premium' : s >= 33 ? 'mid' : 'value');

function affAssemble(zip: string, medianIncome: number | null, perCapita: number | null, pctHigh: number | null, homeValue: number | null, demo = false): ZipAffluence {
  const affluenceScore = affScore(medianIncome, pctHigh, homeValue);
  return { zip, medianIncome, perCapita, pctHighEarner: pctHigh, medianHomeValue: homeValue, affluenceScore, discretionaryEst: discretionaryOf(medianIncome, homeValue), tier: affTier(affluenceScore), demo };
}

/** Deterministic demo figures from the ZIP digits, so the UI is populated offline.
 *  Spread across value→premium (income ~$38k–$250k) so the ranking is illustrative. */
function affDemo(zip: string): ZipAffluence {
  let h = 0; for (const c of zip) h = (h * 131 + c.charCodeAt(0)) % 1_000_000;
  const pct = (h % 1000) / 1000; // 0..1
  const medianIncome = Math.round(38000 + Math.pow(pct, 0.85) * 212000);
  const pctHigh = Math.round(clamp01((medianIncome - 40000) / 180000) * 42 * 10) / 10;
  const homeValue = Math.round(medianIncome * (2.0 + (h % 40) / 10));
  return affAssemble(zip, medianIncome, Math.round(medianIncome * 0.42), pctHigh, homeValue, true);
}

/** Fetch one ZCTA, trying the newest ACS 5-year that responds. Returns the row
 *  plus a diagnostic string so a live-but-empty result explains itself. */
async function affFetch(zip: string, key: string): Promise<{ row: ZipAffluence; err?: string }> {
  let lastErr = '';
  for (const year of ['2023', '2022']) {
    try {
      const url = `https://api.census.gov/data/${year}/acs/acs5?get=NAME,${AFF_VARS.join(',')}&for=zip%20code%20tabulation%20area:${zip}&key=${encodeURIComponent(key)}`;
      const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'miles-ai/1.0' } });
      const text = await res.text();
      if (!res.ok) { lastErr = `ACS${year}: HTTP ${res.status} ${text.slice(0, 140).replace(/\s+/g, ' ')}`; continue; }
      const t = text.trimStart();
      if (!t.startsWith('[') && !t.startsWith('{')) {
        // Census serves an HTML/text error page for a bad request — almost always
        // the API key is missing, invalid, not yet activated, or has a stray space.
        lastErr = `Census returned a non-JSON page — your CENSUS_API_KEY is likely missing, invalid, not yet activated, or has a stray space/newline. Re-check it on Render.`;
        continue;
      }
      const rows = JSON.parse(text) as string[][];
      const header = rows[0]; const data = rows[1];
      if (!header || !data) { lastErr = `ACS${year}: no ZCTA row for ${zip} (may be a PO-box-only ZIP with no Census area)`; continue; }
      const v = (name: string) => { const i = header.indexOf(name); const n = Number(data[i]); return Number.isFinite(n) && n > -1_000_000 ? n : null; };
      const total = v('B19001_001E'); const h150 = v('B19001_016E'); const h200 = v('B19001_017E');
      const pctHigh = total && total > 0 && h150 != null && h200 != null ? Math.round(((h150 + h200) / total) * 1000) / 10 : null;
      return { row: affAssemble(zip, v('B19013_001E'), v('B19301_001E'), pctHigh, v('B25077_001E')) };
    } catch (e) {
      lastErr = `ACS${year}: ${(e as Error).message}`;
    }
  }
  return { row: affAssemble(zip, null, null, null, null), err: lastErr };
}

/** Rank a set of ZIPs by affluence. Live via Census when CENSUS_API_KEY is set,
 *  otherwise clearly-labeled demo figures so the feature is usable offline. */
export async function zipAffluence(zips: string[]): Promise<{ live: boolean; zips: ZipAffluence[]; diag?: string }> {
  const clean = [...new Set(zips.map((z) => (z || '').replace(/\D/g, '').slice(0, 5)).filter((z) => z.length === 5))].slice(0, 40);
  const byScore = (a: ZipAffluence, b: ZipAffluence) => b.affluenceScore - a.affluenceScore;
  if (!process.env.CENSUS_API_KEY) return { live: false, zips: clean.map(affDemo).sort(byScore) };
  // Census keys are pure alphanumeric hex — strip any stray punctuation/space a
  // paste may have added (e.g. a trailing period copied from the email sentence).
  const key = process.env.CENSUS_API_KEY.replace(/[^a-zA-Z0-9]/g, '');
  const out: ZipAffluence[] = [];
  let diag = '';
  for (const zip of clean) {
    const r = await affFetch(zip, key);
    if (r.err && !diag) diag = r.err;
    out.push(r.row);
  }
  const anyData = out.some((z) => z.medianIncome != null);
  return { live: true, zips: out.sort(byScore), diag: anyData ? undefined : diag || 'Census returned no data for these ZIPs. Check the key is valid/activated and the ZIPs are US ZCTAs.' };
}
