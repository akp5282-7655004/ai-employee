/**
 * Google Imagen via the Gemini API — a third image provider, enabled by
 * GEMINI_API_KEY. Plain HTTPS. Like every generator here it degrades honestly:
 * no key or any error returns null and the studio falls back to the default model.
 */
import type { Aspect } from './fal.js';

export function googleImageReady(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

/** Imagen accepts these aspect ratios; map our chips to the closest. */
const AR: Record<Aspect, string> = {
  '1:1': '1:1',
  '16:9': '16:9',
  '9:16': '9:16',
  '4:5': '3:4',
  '3:4': '3:4',
};

export async function googleGenerateImage(prompt: string, opts: { aspect?: Aspect } = {}): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key || !prompt.trim()) return null;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ instances: [{ prompt }], parameters: { sampleCount: 1, aspectRatio: AR[opts.aspect ?? '1:1'] } }),
      },
    );
    if (!res.ok) return null;
    const j = (await res.json()) as { predictions?: Array<{ bytesBase64Encoded?: string }> };
    const b64 = j?.predictions?.[0]?.bytesBase64Encoded;
    return b64 ? `data:image/png;base64,${b64}` : null;
  } catch {
    return null;
  }
}
