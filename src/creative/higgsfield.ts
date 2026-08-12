/**
 * Higgsfield — premium, cinematic image (and, next, video) generation via the
 * official @higgsfield/client v2 SDK. Enabled by HIGGSFIELD_API_KEY_ID +
 * HIGGSFIELD_API_KEY_SECRET (auth format "Key ID:SECRET"). The SDK is imported
 * dynamically so the app ships without it loaded until the keys are set, and every
 * failure returns { url: null, error } so the studio can fall back to the default
 * model and surface the real reason for debugging.
 */
import type { Aspect } from './fal.js';

export function higgsfieldReady(): boolean {
  return !!(process.env.HIGGSFIELD_API_KEY_ID && process.env.HIGGSFIELD_API_KEY_SECRET);
}

// Soul's width_and_height must be one of its allowed SoulSize strings — map our
// aspect chips to the closest valid size (verified against the SDK's SoulSize enum).
const WH: Record<Aspect, string> = {
  '1:1': '1536x1536',
  '16:9': '1696x960',
  '9:16': '960x1696',
  '4:5': '1152x1536',
  '3:4': '1152x1536',
};

export interface HfResult {
  url: string | null;
  error?: string;
}

async function hfClient(): Promise<any> {
  const importDynamic = new Function('m', 'return import(m)') as (m: string) => Promise<any>;
  const mod = await importDynamic('@higgsfield/client/v2');
  const credentials = `${process.env.HIGGSFIELD_API_KEY_ID}:${process.env.HIGGSFIELD_API_KEY_SECRET}`;
  if (typeof mod.config === 'function') mod.config({ credentials });
  if (mod.higgsfield) return mod.higgsfield;
  if (typeof mod.createHiggsfieldClient === 'function') return mod.createHiggsfieldClient({ credentials });
  throw new Error('higgsfield client entry not found');
}

/** Text-to-image via Higgsfield Soul. Returns the image URL or a clear error. */
export async function higgsfieldGenerateImage(prompt: string, opts: { aspect?: Aspect } = {}): Promise<HfResult> {
  if (!higgsfieldReady()) return { url: null, error: 'Higgsfield keys not set' };
  if (!prompt.trim()) return { url: null, error: 'empty prompt' };
  try {
    const hf = await hfClient();
    const res = await hf.subscribe('/v1/text2image/soul', {
      input: {
        prompt,
        width_and_height: WH[opts.aspect ?? '1:1'],
        quality: '1080p',
        batch_size: 1,
        enhance_prompt: true,
      },
      withPolling: true,
    });
    if (res?.status && res.status !== 'completed') return { url: null, error: `higgsfield status: ${res.status}` };
    const url = res?.images?.[0]?.url ?? null;
    return url ? { url } : { url: null, error: 'higgsfield returned no image url' };
  } catch (err) {
    return { url: null, error: `higgsfield: ${(err as Error).message}` };
  }
}

/**
 * Text-to-video via Higgsfield's two-step pipeline: text→image (Soul) then
 * image→video (DoP). Returns the video URL or a clear error. Slow (two model runs).
 */
export async function higgsfieldGenerateVideo(prompt: string, opts: { aspect?: Aspect } = {}): Promise<HfResult> {
  if (!higgsfieldReady()) return { url: null, error: 'Higgsfield keys not set' };
  if (!prompt.trim()) return { url: null, error: 'empty prompt' };
  try {
    const hf = await hfClient();
    // 1) generate a first frame
    const img = await hf.subscribe('/v1/text2image/soul', {
      input: { prompt, width_and_height: WH[opts.aspect ?? '9:16'], quality: '1080p', batch_size: 1, enhance_prompt: true },
      withPolling: true,
    });
    const imgUrl = img?.images?.[0]?.url;
    if (!imgUrl) return { url: null, error: 'higgsfield image step returned no url' };
    // 2) animate it
    const vid = await hf.subscribe('/v1/image2video/dop', {
      input: { model: 'dop-turbo', prompt, input_images: [{ type: 'image_url', image_url: imgUrl }], enhance_prompt: true },
      withPolling: true,
    });
    if (vid?.status && vid.status !== 'completed') return { url: null, error: `higgsfield video status: ${vid.status}` };
    const url = vid?.video?.url ?? null;
    return url ? { url } : { url: null, error: 'higgsfield video returned no url' };
  } catch (err) {
    return { url: null, error: `higgsfield video: ${(err as Error).message}` };
  }
}
