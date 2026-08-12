import { describe, expect, it } from 'vitest';
import {
  parseColors,
  deriveKit,
  resolveKit,
  kitHasGuidance,
  brandVisualDirective,
  brandVoiceDirective,
  emptyKit,
} from '../src/brand/kit.js';
import { buildVisualPrompt, buildTextPrompt, brandVisualLine, brandVoiceLine } from '../src/creative/studio.js';

describe('parseColors', () => {
  it('extracts and normalizes hex colors, dedups, caps at 5', () => {
    expect(parseColors('#12A08F, 0F1216 and #12a08f')).toEqual(['#12a08f', '#0f1216']);
    expect(parseColors('no colors here')).toEqual([]);
    expect(parseColors(undefined)).toEqual([]);
  });
});

describe('deriveKit', () => {
  it('seeds from profile + assets without inventing missing fields', () => {
    const kit = deriveKit(
      { businessName: 'Rivera Plumbing', brandColors: '#12a08f #0f1216', serviceAreas: 'Austin, TX' },
      { logo: 'data:image/png;base64,AAAA' },
    );
    expect(kit.name).toBe('Rivera Plumbing');
    expect(kit.colors).toEqual(['#12a08f', '#0f1216']);
    expect(kit.logoUrl).toBe('data:image/png;base64,AAAA');
    expect(kit.audience).toContain('Austin');
    expect(kit.voice).toBeUndefined(); // not given → stays empty
  });
});

describe('resolveKit', () => {
  it('overlays a stored kit on the derived base', () => {
    const kit = resolveKit(
      { voice: 'bold and local', colors: ['#ff0000'] },
      { businessName: 'Rivera', brandColors: '#12a08f' },
      {},
    );
    expect(kit.name).toBe('Rivera'); // from base
    expect(kit.voice).toBe('bold and local'); // from stored
    expect(kit.colors).toEqual(['#ff0000']); // stored wins when present
  });
  it('falls back to derived colors when stored has none', () => {
    const kit = resolveKit({ voice: 'x', colors: [] }, { brandColors: '#12a08f' }, {});
    expect(kit.colors).toEqual(['#12a08f']);
  });
});

describe('kitHasGuidance', () => {
  it('is false for an empty kit and true once anything steers output', () => {
    expect(kitHasGuidance(emptyKit())).toBe(false);
    expect(kitHasGuidance({ colors: ['#fff'], keywords: [] })).toBe(true);
    expect(kitHasGuidance({ colors: [], keywords: [], voice: 'warm' })).toBe(true);
  });
});

describe('brand directives are honest (empty when no data)', () => {
  it('visual/voice directives are empty without guidance', () => {
    expect(brandVisualDirective(emptyKit())).toBe('');
    expect(brandVoiceDirective(emptyKit())).toBe('');
  });
  it('visual directive carries palette + feel + avoid', () => {
    const d = brandVisualDirective({ colors: ['#12a08f'], voice: 'trustworthy', avoid: 'no clichés', keywords: [] });
    expect(d).toContain('#12a08f');
    expect(d).toContain('trustworthy');
    expect(d).toContain('no clichés');
  });
});

describe('brand flows into studio prompts', () => {
  const brand = {
    business: 'Rivera Plumbing',
    city: 'Austin',
    colors: ['#12a08f', '#0f1216'],
    voice: 'friendly and trustworthy',
    tagline: 'Fast, honest plumbing',
    keywords: ['reliable', 'local'],
    avoid: 'no stock clichés',
  };
  it('a social image prompt includes the palette and feel', () => {
    const p = buildVisualPrompt('social', 'a summer AC promo', brand);
    expect(p).toContain('#12a08f');
    expect(p).toContain('friendly and trustworthy');
    expect(p).toContain('no stock clichés');
  });
  it('a logo prompt uses brand feel but does not add the leave-room-for-logo clause', () => {
    const p = buildVisualPrompt('logo', 'a water drop mark', brand);
    expect(p).not.toContain('where the logo can be placed');
  });
  it('ad copy carries the brand voice and tagline', () => {
    const { system } = buildTextPrompt('copy', 'promote AC tune-ups', brand);
    expect(system).toContain('friendly and trustworthy');
    expect(system).toContain('Fast, honest plumbing');
  });
  it('an empty brand adds nothing', () => {
    expect(brandVisualLine({})).toBe('');
    expect(brandVoiceLine({})).toBe('');
  });
});
