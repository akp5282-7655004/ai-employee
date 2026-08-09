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
  insight: string;
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
];

const num = (s: string | undefined): number => {
  const n = Number(s);
  return Number.isFinite(n) && n > -1_000_000 ? Math.max(0, Math.round(n)) : 0;
};

export async function fetchDemographics(zipInput: string): Promise<Demographics | null> {
  const zip = (zipInput || '').replace(/\D/g, '').slice(0, 5);
  if (zip.length !== 5) return null;

  const url =
    `https://api.census.gov/data/2022/acs/acs5?get=NAME,${VARS.join(',')}` +
    `&for=zip%20code%20tabulation%20area:${zip}`;
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
    insight: insightFor(income, homeValue, occ ? Math.round((owner / occ) * 100) : 0),
  };
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
