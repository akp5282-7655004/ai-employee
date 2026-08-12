/**
 * Media model catalog — the models the Creative Studio can generate with, per
 * asset kind, each with its credit cost and what it's best for. The philosophy:
 * always DEFAULT to a reliable model that gets the job done, and separately
 * RECOMMEND the best-quality model for what the user is making (and, when their
 * prompt hints at it, the model that fits the prompt). Only models we can actually
 * call are listed; premium picks always fall back to the default so nothing dead-ends.
 */

export type MediaKind = 'image' | 'video' | 'audio';
export type MediaProvider = 'fal' | 'openai' | 'higgsfield';

export interface MediaModel {
  id: string;
  kind: MediaKind;
  label: string;
  /** One line: what this model is best for. */
  blurb: string;
  /** Credit cost per generation. */
  credits: number;
  provider: MediaProvider;
  /** fal endpoint (when provider === 'fal'). */
  falModel?: string;
  /** The reliable default for its kind — always selectable, always works when FAL_KEY is set. */
  default?: boolean;
  /** Env var required to activate this model (e.g. a different provider's key). */
  requiresEnv?: string;
  /** When the prompt matches this, recommend this model. */
  recommendFor?: RegExp;
  /** Higher = better quality; used to pick the "for best results" recommendation. */
  quality: number;
  /** Typical time to generate, in seconds — drives the estimated progress bar. */
  etaSec: number;
}

export const MEDIA_MODELS: MediaModel[] = [
  // ── images ──
  { id: 'flux-schnell', kind: 'image', label: 'Flux Schnell — Fast', blurb: 'Fast everyday images. Great for social posts and high volume.', credits: 5, provider: 'fal', falModel: 'fal-ai/flux/schnell', default: true, quality: 1, etaSec: 8 },
  { id: 'flux-dev', kind: 'image', label: 'Flux Dev — Balanced', blurb: 'Sharper detail and cleaner text-in-image. Best for flyers, cards, and logos.', credits: 8, provider: 'fal', falModel: 'fal-ai/flux/dev', recommendFor: /logo|flyer|card|invite|poster|text|headline|menu/i, quality: 2, etaSec: 20 },
  { id: 'flux-pro', kind: 'image', label: 'Flux Pro 1.1 — Photoreal', blurb: 'Highest quality, most photorealistic. Best for hero shots and polished ads.', credits: 12, provider: 'fal', falModel: 'fal-ai/flux-pro/v1.1', recommendFor: /photo|realistic|hero|portrait|product|professional|lifestyle/i, quality: 3, etaSec: 25 },
  { id: 'gpt-image', kind: 'image', label: 'ChatGPT Image (GPT-Image-1)', blurb: 'OpenAI’s image model — excellent at following detailed instructions and rendering text.', credits: 15, provider: 'openai', requiresEnv: 'OPENAI_API_KEY', quality: 3, etaSec: 25 },
  { id: 'hf-soul', kind: 'image', label: 'Higgsfield Soul — Cinematic', blurb: 'Higgsfield’s cinematic image model — director-grade, premium quality.', credits: 18, provider: 'higgsfield', requiresEnv: 'HIGGSFIELD_API_KEY_SECRET', recommendFor: /cinematic|dramatic|film|movie|hero|editorial|moody/i, quality: 4, etaSec: 30 },
  // ── video ──
  { id: 'kling-std', kind: 'video', label: 'Kling — Standard', blurb: 'Reliable everyday video. The safe default that gets the job done.', credits: 20, provider: 'fal', falModel: 'fal-ai/kling-video/v1/standard/text-to-video', default: true, quality: 1, etaSec: 60 },
  { id: 'kling-pro', kind: 'video', label: 'Kling Pro — Cinematic', blurb: 'Smoother motion and more detail. Best for polished ads and hero videos.', credits: 35, provider: 'fal', falModel: 'fal-ai/kling-video/v1.5/pro/text-to-video', recommendFor: /.*/, quality: 2, etaSec: 90 },
  // ── audio ──
  { id: 'playai-tts', kind: 'audio', label: 'PlayAI Voice', blurb: 'Natural voiceover from any script.', credits: 3, provider: 'fal', falModel: 'fal-ai/playai/tts/v3', default: true, quality: 1, etaSec: 15 },
];

export function modelsForKind(kind: MediaKind): MediaModel[] {
  return MEDIA_MODELS.filter((m) => m.kind === kind);
}

export function modelById(id: string | undefined): MediaModel | undefined {
  return id ? MEDIA_MODELS.find((m) => m.id === id) : undefined;
}

export function defaultModel(kind: MediaKind): MediaModel {
  return modelsForKind(kind).find((m) => m.default) ?? modelsForKind(kind)[0]!;
}

/** Is a model usable right now? fal models need FAL_KEY; others need their own env key. */
export function modelActive(m: MediaModel, env: NodeJS.ProcessEnv = process.env): boolean {
  if (m.provider === 'fal') return !!env.FAL_KEY;
  if (m.provider === 'higgsfield') return !!(env.HIGGSFIELD_API_KEY_ID && env.HIGGSFIELD_API_KEY_SECRET);
  return !!(m.requiresEnv && env[m.requiresEnv]);
}

export interface Recommendation {
  id: string;
  reason: string;
}

/**
 * The "for best results" recommendation for this kind + prompt, chosen among
 * models that are actually active. Prefers a model whose recommendFor matches the
 * prompt; otherwise the highest-quality active model. Falls back to the default.
 */
export function recommendModel(kind: MediaKind, prompt: string, env: NodeJS.ProcessEnv = process.env): Recommendation {
  const active = modelsForKind(kind).filter((m) => modelActive(m, env));
  const pool = active.length ? active : modelsForKind(kind);
  const text = prompt || '';

  // 1) A model explicitly suited to the prompt wins (highest quality among matches).
  const matches = pool.filter((m) => m.recommendFor && m.recommendFor.source !== '.*' && m.recommendFor.test(text));
  if (matches.length) {
    const best = matches.sort((a, b) => b.quality - a.quality)[0]!;
    return { id: best.id, reason: `Your prompt looks like a job for ${best.label} — ${best.blurb}` };
  }
  // 2) Otherwise the best-quality model above the default.
  const byQuality = [...pool].sort((a, b) => b.quality - a.quality);
  const best = byQuality[0]!;
  const def = defaultModel(kind);
  if (best.id === def.id) return { id: def.id, reason: `${def.label} is the right pick here — ${def.blurb}` };
  return { id: best.id, reason: `For the best result, use ${best.label} (${best.credits} credits) — ${best.blurb}` };
}
