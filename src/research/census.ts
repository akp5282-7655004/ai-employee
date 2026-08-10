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

  const key = process.env.CENSUS_API_KEY ? `&key=${process.env.CENSUS_API_KEY}` : '';
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
