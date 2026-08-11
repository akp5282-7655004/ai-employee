import { describe, expect, it } from 'vitest';
import { ASSET_TYPES, specFor, buildVisualPrompt, buildTextPrompt, fallbackText } from '../src/creative/studio.js';

const brand = { business: 'Rivera Plumbing', category: 'plumbing', city: 'Phoenix', services: ['drain cleaning', 'water heaters'] };

describe('asset catalog', () => {
  it('offers the marketing asset types with a kind each', () => {
    expect(ASSET_TYPES.map((a) => a.type)).toEqual(['image', 'logo', 'social', 'flyer', 'card', 'video', 'copy', 'doc']);
    expect(specFor('logo')!.kind).toBe('image');
    expect(specFor('video')!.kind).toBe('video');
    expect(specFor('copy')!.kind).toBe('text');
    expect(specFor('nope')).toBeUndefined();
  });
});

describe('buildVisualPrompt', () => {
  it('weaves the brand and trade into a logo prompt', () => {
    const p = buildVisualPrompt('logo', 'a water droplet mark', brand);
    expect(p).toContain('Rivera Plumbing');
    expect(p).toContain('plumbing');
    expect(p).toContain('water droplet');
  });
  it('a flyer prompt includes the city and the request', () => {
    const p = buildVisualPrompt('flyer', '$59 drain special', brand);
    expect(p).toContain('Phoenix');
    expect(p).toContain('$59 drain special');
  });
  it('appends a chosen style but not "Auto"', () => {
    expect(buildVisualPrompt('image', 'a van', brand, 'Photorealistic')).toContain('photorealistic');
    expect(buildVisualPrompt('image', 'a van', brand, 'Auto')).not.toContain('Style:');
  });
});

describe('text prompts + fallback', () => {
  it('copy prompt names the business and asks for options', () => {
    const { system, user } = buildTextPrompt('copy', 'summer AC promo', brand);
    expect(system.toLowerCase()).toContain('copywriter');
    expect(user).toContain('Rivera Plumbing');
    expect(user).toContain('summer AC promo');
  });
  it('fallback copy is usable and mentions the business', () => {
    const t = fallbackText('copy', 'spring tune-up', brand);
    expect(t).toContain('Rivera Plumbing');
    expect(t.split('\n').length).toBeGreaterThanOrEqual(3);
  });
});
