/**
 * Media generation via fal.ai — the visuals behind every marketing asset.
 * Enabled by setting FAL_KEY. The SDK is loaded dynamically so the app ships
 * without the dependency until this is switched on, and every failure returns
 * null so the UI falls back to a templated preview. Flux Schnell is the default
 * image model — cheap and fast, the right pick for high-volume local-service work.
 */
export function falReady(): boolean {
  return !!process.env.FAL_KEY;
}

/** fal.ai image_size tokens per aspect ratio (the studio's ratio chips map to these). */
export type Aspect = '1:1' | '16:9' | '9:16' | '4:5' | '3:4';
const IMAGE_SIZE: Record<Aspect, string> = {
  '1:1': 'square_hd',
  '16:9': 'landscape_16_9',
  '9:16': 'portrait_16_9',
  '4:5': 'portrait_4_3',
  '3:4': 'portrait_4_3',
};

export interface ImageOpts {
  aspect?: Aspect;
  model?: string;
  /** "premium" swaps the fast default for a higher-quality model. */
  quality?: 'standard' | 'premium';
}

async function falClient(key: string): Promise<any> {
  const importDynamic = new Function('m', 'return import(m)') as (m: string) => Promise<any>;
  const mod = await importDynamic('@fal-ai/client');
  const fal = mod.fal ?? mod.default ?? mod;
  fal.config({ credentials: key });
  return fal;
}

export async function falGenerateImage(prompt: string, opts: ImageOpts = {}): Promise<string | null> {
  const key = process.env.FAL_KEY;
  if (!key) return null;
  try {
    const fal = await falClient(key);
    const model =
      opts.model ||
      (opts.quality === 'premium'
        ? process.env.FAL_IMAGE_MODEL_PREMIUM || 'fal-ai/flux/dev'
        : process.env.FAL_IMAGE_MODEL || 'fal-ai/flux/schnell');
    const res = await fal.subscribe(model, {
      input: { prompt, image_size: IMAGE_SIZE[opts.aspect ?? '1:1'], num_images: 1 },
      logs: false,
    });
    const url = res?.data?.images?.[0]?.url ?? res?.images?.[0]?.url ?? null;
    return typeof url === 'string' ? url : null;
  } catch {
    return null;
  }
}

export interface VideoOpts {
  aspect?: Aspect;
  model?: string;
  /** Seconds; the model may clamp this. */
  duration?: number;
}

/**
 * Text-to-video via a fal.ai video model (Kling-class by default). Video is slow
 * (a minute or more) and the priciest credits, so callers surface that cost. Any
 * error returns null and the UI stays graceful.
 */
export async function falGenerateVideo(prompt: string, opts: VideoOpts = {}): Promise<string | null> {
  const key = process.env.FAL_KEY;
  if (!key) return null;
  try {
    const fal = await falClient(key);
    const model = opts.model || process.env.FAL_VIDEO_MODEL || 'fal-ai/kling-video/v1/standard/text-to-video';
    const input: Record<string, unknown> = { prompt };
    if (opts.aspect) input.aspect_ratio = opts.aspect;
    if (opts.duration) input.duration = String(opts.duration);
    const res = await fal.subscribe(model, { input, logs: false });
    const url = res?.data?.video?.url ?? res?.video?.url ?? res?.data?.videos?.[0]?.url ?? null;
    return typeof url === 'string' ? url : null;
  } catch {
    return null;
  }
}
