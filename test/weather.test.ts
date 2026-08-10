import { describe, expect, it } from 'vitest';
import { computeFeelsLike, evaluateWeatherTriggers, matchWeatherRule, type WeatherNow, type WeatherRule } from '../src/research/weather.js';

const base = (over: Partial<WeatherNow>): WeatherNow => ({
  zip: '19104',
  tempF: 70,
  feelsLikeF: 70,
  alerts: [],
  source: 'mock',
  ...over,
});

describe('computeFeelsLike', () => {
  it('applies heat index when hot and humid', () => {
    const fl = computeFeelsLike(95, 60);
    expect(fl).toBeGreaterThan(95); // feels hotter than ambient
  });

  it('applies wind chill when cold and windy', () => {
    const fl = computeFeelsLike(20, undefined, 20);
    expect(fl).toBeLessThan(20); // feels colder than ambient
  });

  it('returns ambient in mild conditions', () => {
    expect(computeFeelsLike(68, 50, 2)).toBe(68);
  });
});

describe('evaluateWeatherTriggers', () => {
  it('fires extreme heat above 95 feels-like', () => {
    const t = evaluateWeatherTriggers(base({ feelsLikeF: 98 }));
    expect(t.map((x) => x.id)).toContain('extreme_heat');
    expect(t[0]!.intensity).toBe('urgent');
  });

  it('fires a heat surge in the 85–94 band, not extreme', () => {
    const t = evaluateWeatherTriggers(base({ feelsLikeF: 88 }));
    const ids = t.map((x) => x.id);
    expect(ids).toContain('heat_surge');
    expect(ids).not.toContain('extreme_heat');
  });

  it('fires a hard freeze at/below 20', () => {
    const t = evaluateWeatherTriggers(base({ feelsLikeF: 12 }));
    expect(t.map((x) => x.id)).toContain('hard_freeze');
  });

  it('fires storm damage on a severe alert', () => {
    const t = evaluateWeatherTriggers(
      base({ alerts: [{ event: 'Severe Thunderstorm Warning', severity: 'Severe' }] }),
    );
    const storm = t.find((x) => x.id === 'storm_damage');
    expect(storm).toBeDefined();
    expect(storm!.category).toBe('roofing');
  });

  it('respects the vertical filter', () => {
    const w = base({ alerts: [{ event: 'Flood Warning', severity: 'Severe' }], feelsLikeF: 98 });
    // roofing vertical should see storm damage but not the HVAC heat trigger
    const roofing = evaluateWeatherTriggers(w, 'roofing').map((x) => x.id);
    expect(roofing).toContain('storm_damage');
    expect(roofing).not.toContain('extreme_heat');
  });

  it('stays quiet in mild weather', () => {
    expect(evaluateWeatherTriggers(base({ feelsLikeF: 68 }))).toHaveLength(0);
  });
});

describe('matchWeatherRule (custom triggers)', () => {
  const rule = (o: Partial<WeatherRule>): WeatherRule => ({ id: 'r', name: 'r', metric: 'feelsLike', op: '>=', value: 90, action: 'a', ...o });
  it('fires a numeric >= rule when met', () => {
    expect(matchWeatherRule(base({ feelsLikeF: 92 }), rule({}))).toBe(true);
    expect(matchWeatherRule(base({ feelsLikeF: 80 }), rule({}))).toBe(false);
  });
  it('fires a <= rule', () => {
    expect(matchWeatherRule(base({ feelsLikeF: 20 }), rule({ op: '<=', value: 32 }))).toBe(true);
  });
  it('matches an alert keyword', () => {
    const w = base({ alerts: [{ event: 'High Wind Warning', severity: 'Severe' }] });
    expect(matchWeatherRule(w, rule({ metric: 'alert', op: 'contains', value: 'wind' }))).toBe(true);
    expect(matchWeatherRule(w, rule({ metric: 'alert', op: 'contains', value: 'flood' }))).toBe(false);
  });
  it('respects the enabled flag and missing metrics', () => {
    expect(matchWeatherRule(base({ feelsLikeF: 99 }), rule({ enabled: false }))).toBe(false);
    expect(matchWeatherRule(base({ windMph: undefined }), rule({ metric: 'wind', value: 20 }))).toBe(false);
  });
});
