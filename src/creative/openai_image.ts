/**
 * ChatGPT Image (GPT-Image-1) via the OpenAI API — a second image provider the
 * Creative Studio can use when OPENAI_API_KEY is set. Plain HTTPS (no SDK). Like
 * every generator here, it degrades honestly: no key or any error returns null, and
 * the studio falls back to the default fal model so a generation never dead-ends.
 */
import type { Aspect } from './fal.js';

export function openaiImageReady(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

/** GPT-Image-1 supports these sizes; map our aspect chips to the closest one. */
const SIZE: Record<Aspect, string> = {
  '1:1': '1024x1024',
  '16:9': '1536x1024',
  '9:16': '1024x1536',
  '4:5': '1024x1536',
  '3:4': '1024x1536',
};

export async function openaiGenerateImage(prompt: string, opts: { aspect?: Aspect } = {}): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key || !prompt.trim()) return null;
  try {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-image-1', prompt, size: SIZE[opts.aspect ?? '1:1'], n: 1 }),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
    const d = j?.data?.[0];
    if (d?.b64_json) return `data:image/png;base64,${d.b64_json}`;
    if (d?.url) return d.url;
    return null;
  } catch {
    return null;
  }
}
