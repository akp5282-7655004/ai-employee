/**
 * Image generation via fal.ai — the "photo" behind each ad. Enabled by setting
 * FAL_KEY (fal.ai). The SDK is loaded dynamically so the app ships without the
 * dependency until this is switched on, and every failure returns null so the UI
 * simply falls back to a templated preview card. Flux Schnell is the default —
 * cheap and fast, the right pick for high-volume local-service ad creative.
 */
export function falReady(): boolean {
  return !!process.env.FAL_KEY;
}

export async function falGenerateImage(prompt: string): Promise<string | null> {
  const key = process.env.FAL_KEY;
  if (!key) return null;
  try {
    const importDynamic = new Function('m', 'return import(m)') as (m: string) => Promise<any>;
    const mod = await importDynamic('@fal-ai/client');
    const fal = mod.fal ?? mod.default ?? mod;
    fal.config({ credentials: key });
    const model = process.env.FAL_IMAGE_MODEL || 'fal-ai/flux/schnell';
    const res = await fal.subscribe(model, {
      input: { prompt, image_size: 'landscape_16_9', num_images: 1 },
      logs: false,
    });
    const url = res?.data?.images?.[0]?.url ?? res?.images?.[0]?.url ?? null;
    return typeof url === 'string' ? url : null;
  } catch {
    return null;
  }
}
