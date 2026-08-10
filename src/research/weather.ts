/**
 * Weather-triggered marketing — Miles's native answer to weather-based ad
 * platforms (WeatherAds et al.). Weather is the single biggest demand driver for
 * HVAC and storm-exposed home services (roofing), so Miles watches the forecast
 * for each workspace's ZIP and recommends campaign actions when conditions fire.
 *
 * Data source is the US National Weather Service (api.weather.gov) — free, no key,
 * US-wide. The trigger-evaluation logic is pure and deterministic (see
 * evaluateWeatherTriggers) so it's fully testable without the network.
 */

export interface WeatherAlert {
  event: string;
  severity: string;
  headline?: string;
}

export interface WeatherNow {
  zip: string;
  place?: string;
  lat?: number;
  lng?: number;
  tempF: number;
  feelsLikeF: number;
  humidity?: number;
  windMph?: number;
  shortForecast?: string;
  alerts: WeatherAlert[];
  source: 'nws' | 'mock';
}

export interface FiredTrigger {
  id: string;
  label: string;
  action: string;
  /** Service category the trigger points at (matches pack category ids where possible). */
  category?: string;
  /** Urgency of the recommended change. */
  intensity: 'watch' | 'act' | 'urgent';
}

/**
 * "Feels like": NWS-style heat index when hot & humid, wind chill when cold &
 * windy, otherwise the ambient temperature. Formulas are the standard NOAA ones.
 */
export function computeFeelsLike(tempF: number, humidity?: number, windMph?: number): number {
  if (tempF >= 80 && humidity !== undefined && humidity >= 40) {
    const T = tempF;
    const R = humidity;
    const hi =
      -42.379 +
      2.04901523 * T +
      10.14333127 * R -
      0.22475541 * T * R -
      6.83783e-3 * T * T -
      5.481717e-2 * R * R +
      1.22874e-3 * T * T * R +
      8.5282e-4 * T * R * R -
      1.99e-6 * T * T * R * R;
    return Math.round(hi);
  }
  if (tempF <= 50 && windMph !== undefined && windMph > 3) {
    const V = Math.pow(windMph, 0.16);
    const wc = 35.74 + 0.6215 * tempF - 35.75 * V + 0.4275 * tempF * V;
    return Math.round(wc);
  }
  return Math.round(tempF);
}

const SEVERE = /(storm|hail|hurricane|tornado|flood|wind|thunderstorm|blizzard|ice)/i;

/**
 * The trigger rules. Pure functions of the weather — no I/O — so they're testable
 * and deterministic. Each returns a FiredTrigger when its condition holds.
 */
const RULES: Array<{ verticals: string[]; test: (w: WeatherNow) => FiredTrigger | null }> = [
  {
    verticals: ['home_services', 'roofing'],
    test: (w) => {
      const a = w.alerts.find((x) => SEVERE.test(x.event));
      return a
        ? {
            id: 'storm_damage',
            label: `Severe weather: ${a.event}`,
            action:
              'Activate storm-damage roofing & emergency-repair ads in this ZIP and raise budget — demand surges during and right after severe weather. Keep running ~1 week after it clears.',
            category: 'roofing',
            intensity: 'urgent',
          }
        : null;
    },
  },
  {
    verticals: ['home_services'],
    test: (w) =>
      w.feelsLikeF >= 95
        ? {
            id: 'extreme_heat',
            label: `Extreme heat — feels like ${w.feelsLikeF}°F`,
            action:
              'Push AC-repair & emergency-cooling ads hard. Raise bids on "AC not working" / "same-day AC repair" — conversion intent peaks in extreme heat.',
            category: 'hvac',
            intensity: 'urgent',
          }
        : null,
  },
  {
    verticals: ['home_services'],
    test: (w) =>
      w.feelsLikeF >= 85 && w.feelsLikeF < 95
        ? {
            id: 'heat_surge',
            label: `Heat surge — feels like ${w.feelsLikeF}°F`,
            action:
              'Boost AC tune-up & repair ads. Warm spells drive a 24% AC sales spike per 1°F — get ahead of it with cooling offers.',
            category: 'hvac',
            intensity: 'act',
          }
        : null,
  },
  {
    verticals: ['home_services'],
    test: (w) =>
      w.feelsLikeF <= 20
        ? {
            id: 'hard_freeze',
            label: `Hard freeze — feels like ${w.feelsLikeF}°F`,
            action:
              'Run frozen-pipe emergency plumbing + heating-repair ads. Hard freezes drive burst-pipe and no-heat calls — capture the emergency demand.',
            category: 'plumbing',
            intensity: 'urgent',
          }
        : null,
  },
  {
    verticals: ['home_services'],
    test: (w) =>
      w.feelsLikeF > 20 && w.feelsLikeF <= 35
        ? {
            id: 'cold_snap',
            label: `Cold snap — feels like ${w.feelsLikeF}°F`,
            action:
              'Boost furnace & heating-repair ads. Cold snaps spike no-heat service calls — lead with fast-response heating offers.',
            category: 'hvac',
            intensity: 'act',
          }
        : null,
  },
];

/** A customer-defined weather trigger: "when <metric> <op> <value> → <action>". */
export interface WeatherRule {
  id: string;
  name: string;
  metric: 'feelsLike' | 'temp' | 'wind' | 'humidity' | 'alert';
  op: '>=' | '<=' | 'contains';
  /** Number for numeric metrics; a keyword (e.g. "storm") for `alert`. */
  value: number | string;
  action: string;
  category?: string;
  intensity?: 'watch' | 'act' | 'urgent';
  enabled?: boolean;
}

/** Does a custom rule fire against the current weather? Pure + testable. */
export function matchWeatherRule(w: WeatherNow, rule: WeatherRule): boolean {
  if (rule.enabled === false) return false;
  if (rule.metric === 'alert') {
    const kw = String(rule.value ?? '').toLowerCase();
    return !!kw && w.alerts.some((a) => (a.event || '').toLowerCase().includes(kw));
  }
  const v =
    rule.metric === 'feelsLike' ? w.feelsLikeF :
    rule.metric === 'temp' ? w.tempF :
    rule.metric === 'wind' ? (w.windMph ?? NaN) :
    rule.metric === 'humidity' ? (w.humidity ?? NaN) : NaN;
  if (!Number.isFinite(v)) return false;
  const t = Number(rule.value);
  if (!Number.isFinite(t)) return false;
  return rule.op === '>=' ? v >= t : rule.op === '<=' ? v <= t : false;
}

/** Evaluate all rules against current weather, optionally filtered to a vertical. */
export function evaluateWeatherTriggers(w: WeatherNow, vertical?: string): FiredTrigger[] {
  const out: FiredTrigger[] = [];
  for (const rule of RULES) {
    if (vertical && !rule.verticals.includes(vertical)) continue;
    const fired = rule.test(w);
    if (fired) out.push(fired);
  }
  // De-dupe by id (a vertical filter can't produce dupes, but be safe).
  return out.filter((t, i) => out.findIndex((x) => x.id === t.id) === i);
}

const UA = { 'User-Agent': 'miles.ai weather (support@miles.ai)', Accept: 'application/geo+json' };

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

/** Live current conditions for a ZIP via the National Weather Service (free, no key). */
export async function fetchWeather(zipInput: string): Promise<WeatherNow | null> {
  const zip = (zipInput || '').replace(/\D/g, '').slice(0, 5);
  if (zip.length !== 5) return null;
  const geo = await geocodeZip(zip);
  if (!geo) return null;

  try {
    const pts = await fetch(`https://api.weather.gov/points/${geo.lat},${geo.lng}`, { headers: UA });
    if (!pts.ok) return null;
    const pj = (await pts.json()) as any;
    const hourlyUrl: string | undefined = pj?.properties?.forecastHourly;
    if (!hourlyUrl) return null;

    const [hourlyRes, alertsRes] = await Promise.all([
      fetch(hourlyUrl, { headers: UA }),
      fetch(`https://api.weather.gov/alerts/active?point=${geo.lat},${geo.lng}`, { headers: UA }),
    ]);
    if (!hourlyRes.ok) return null;
    const hj = (await hourlyRes.json()) as any;
    const p0 = hj?.properties?.periods?.[0] ?? {};
    const tempF = Number(p0.temperature);
    const humidity = p0.relativeHumidity?.value != null ? Number(p0.relativeHumidity.value) : undefined;
    const windMph = p0.windSpeed ? Number(String(p0.windSpeed).replace(/[^\d.]/g, '')) : undefined;

    let alerts: WeatherAlert[] = [];
    if (alertsRes.ok) {
      const aj = (await alertsRes.json()) as any;
      alerts = (aj?.features ?? []).map((f: any) => ({
        event: f?.properties?.event ?? 'Alert',
        severity: f?.properties?.severity ?? 'Unknown',
        headline: f?.properties?.headline,
      }));
    }

    return {
      zip,
      place: geo.place,
      lat: geo.lat,
      lng: geo.lng,
      tempF: Math.round(tempF),
      feelsLikeF: computeFeelsLike(tempF, humidity, windMph),
      humidity,
      windMph: windMph != null ? Math.round(windMph) : undefined,
      shortForecast: p0.shortForecast,
      alerts,
      source: 'nws',
    };
  } catch {
    return null;
  }
}
