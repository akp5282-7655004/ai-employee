import { describe, expect, it } from 'vitest';
import { modelsForKind, modelById, defaultModel, modelActive, recommendModel, MEDIA_MODELS } from '../src/creative/models.js';

describe('media model catalog', () => {
  it('every kind has exactly one default, and defaults are fal (work with FAL_KEY)', () => {
    for (const kind of ['image', 'video', 'audio'] as const) {
      const defaults = modelsForKind(kind).filter((m) => m.default);
      expect(defaults).toHaveLength(1);
      expect(defaults[0]!.provider).toBe('fal');
    }
  });
  it('fal models are active with FAL_KEY; other providers need their own key', () => {
    const withFal = { FAL_KEY: 'x' } as unknown as NodeJS.ProcessEnv;
    expect(modelActive(defaultModel('image'), withFal)).toBe(true);
    const gpt = modelById('gpt-image')!;
    expect(modelActive(gpt, withFal)).toBe(false);
    expect(modelActive(gpt, { FAL_KEY: 'x', OPENAI_API_KEY: 'y' } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });
  it('Higgsfield needs BOTH the key id and secret to be active', () => {
    const hf = modelById('hf-soul')!;
    expect(hf.provider).toBe('higgsfield');
    expect(modelActive(hf, { HIGGSFIELD_API_KEY_ID: 'a' } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(modelActive(hf, { HIGGSFIELD_API_KEY_SECRET: 'b' } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(modelActive(hf, { HIGGSFIELD_API_KEY_ID: 'a', HIGGSFIELD_API_KEY_SECRET: 'b' } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });
  it('recommends a prompt-fit model when the prompt hints at it', () => {
    const env = { FAL_KEY: 'x' } as unknown as NodeJS.ProcessEnv;
    expect(recommendModel('image', 'a clean logo with our name in text', env).id).toBe('flux-dev');
    expect(recommendModel('image', 'a photorealistic product hero shot', env).id).toBe('flux-pro');
  });
  it('recommends the reliable DEFAULT for a generic prompt (never pushed onto a pricier model)', () => {
    const falOnly = { FAL_KEY: 'x' } as unknown as NodeJS.ProcessEnv;
    const rec = recommendModel('image', 'something generic', falOnly);
    expect(rec.id).toBe('flux-schnell'); // the reliable image default, not flux-pro/hf-soul
    expect(modelActive(modelById(rec.id)!, falOnly)).toBe(true);
  });
  it('a generic video prompt recommends the reliable default, not the pricier pro tier', () => {
    expect(recommendModel('video', 'a promo clip', { FAL_KEY: 'x' } as unknown as NodeJS.ProcessEnv).id).toBe('kling-std');
  });
  it('unknown model id resolves to nothing; ids are unique', () => {
    expect(modelById('nope')).toBeUndefined();
    const ids = MEDIA_MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
