import { describe, expect, it } from 'vitest';
import { generateAdCopy } from '../src/creative/creative.js';

describe('generateAdCopy', () => {
  it('returns three distinct angles', () => {
    const ads = generateAdCopy({ vertical: 'home_services', category: 'hvac', businessName: 'Acme Air', city: 'Philadelphia, PA' });
    expect(ads).toHaveLength(3);
    expect(new Set(ads.map((a) => a.angle)).size).toBe(3);
    for (const a of ads) {
      expect(a.headline.length).toBeGreaterThan(0);
      expect(a.body).toContain('Acme Air');
      expect(a.cta.length).toBeGreaterThan(0);
      expect(a.imagePrompt).toContain('photography');
    }
  });

  it('features the given offer in the copy', () => {
    const ads = generateAdCopy({ vertical: 'home_services', category: 'plumbing', offer: '$49 drain clearing, same-day', businessName: 'Bob Plumbing' });
    expect(ads[0]!.headline).toBe('$49 drain clearing, same-day');
    expect(ads.some((a) => a.body.includes('$49 drain clearing'))).toBe(true);
  });

  it('uses an urgency angle for high-urgency trades and value for low', () => {
    const hvac = generateAdCopy({ vertical: 'home_services', category: 'hvac' });
    const painting = generateAdCopy({ vertical: 'home_services', category: 'painting' });
    expect(hvac[1]!.angle).toBe('Urgency');
    expect(painting[1]!.angle).toBe('Value');
  });

  it('falls back gracefully with no inputs', () => {
    const ads = generateAdCopy({});
    expect(ads).toHaveLength(3);
    expect(ads[0]!.body).toContain('Your Company');
  });

  it('tailors the image prompt to the trade', () => {
    const roofing = generateAdCopy({ vertical: 'home_services', category: 'roofing' });
    expect(roofing[0]!.imagePrompt).toContain('roof');
  });
});
