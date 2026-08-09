/**
 * Market research from real US Census data (American Community Survey 5-year) —
 * the "customer & demographic data" behind the Research tab and the vision's
 * saturation/competitor meter (docs/VISION.md §5, feature #11). No API key
 * required for this volume. Called server-side; the app never needs the raw API.
 */
export interface Demographics {
  zip: string;
  name: string;
  population: number;
  households: number;
  medianIncome: number;
  medianHomeValue: number;
  medianAge: number;
  homeownershipPct: number;
  insight: string;
}

// population, median household income, median home value, median age, occupied units, owner-occupied
const VARS = ['B01003_001E', 'B19013_001E', 'B25077_001E', 'B01002_001E', 'B25003_001E', 'B25003_002E'];

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

  const row = data[1]!;
  // Census uses large negative sentinels (e.g. -666666666) for suppressed values.
  const num = (s: string | undefined) => {
    const n = Number(s);
    return Number.isFinite(n) && n > -1_000_000 ? Math.max(0, Math.round(n)) : 0;
  };
  const population = num(row[1]);
  const medianIncome = num(row[2]);
  const medianHomeValue = num(row[3]);
  const medianAge = num(row[4]);
  const households = num(row[5]);
  const owner = num(row[6]);
  const homeownershipPct = households ? Math.round((owner / households) * 100) : 0;

  return {
    zip,
    name: (row[0] ?? `ZCTA ${zip}`).replace(/^ZCTA5\s*/, 'ZIP '),
    population,
    households,
    medianIncome,
    medianHomeValue,
    medianAge,
    homeownershipPct,
    insight: insightFor(medianIncome, medianHomeValue, homeownershipPct),
  };
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
