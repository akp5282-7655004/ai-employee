/**
 * Media costs — the half of the pricing model that spends real money.
 *
 * Text work (campaigns, skills, readouts, email, copy) costs fractions of a
 * cent to serve, so rationing it bought nothing and made the product feel
 * metered. It is unlimited. Media does cost money — one video is roughly a
 * thousand skill runs — so media is where the credit meter lives, priced in
 * billing/credits.ts against the vendor costs below.
 *
 * The bug this module exists to prevent: video used to be priced in
 * usage/meter.ts and billed from billing/credits.ts, two tables that never
 * met. The result was that video was unlimited and free on every plan without
 * anyone having decided that. One kind, one cost, one price, one place.
 *
 * COSTS ARE INPUTS, NOT FACTS. These are what these classes of model were
 * quoted at on COSTS_STAMPED. Vendors change prices — override with
 * MEDIA_COSTS_JSON rather than trusting a constant forever, and re-check the
 * stamp before quoting a margin to anyone.
 */

export type MediaKind = 'video' | 'image' | 'audio';

export const MEDIA_KINDS: MediaKind[] = ['video', 'image', 'audio'];

export function isMediaKind(x: string): x is MediaKind {
  return (MEDIA_KINDS as string[]).includes(x);
}

/** When MEDIA_COST was last checked against vendor pricing. */
export const COSTS_STAMPED = '2026-08-23';

/**
 * What one unit costs to serve, in USD.
 *
 * video — ~$0.07/second for a Kling-class model at a 5-second default clip.
 * image — FLUX-schnell class at 1024x1024. FLUX-dev is roughly 18x this; if
 *         FAL_IMAGE_MODEL_PREMIUM ever becomes the default, re-check this row.
 * audio — ASSUMPTION, not a measured or quoted figure. TTS is small enough not
 *         to move plan margin, but it is the one number here nobody has
 *         verified. Do not quote it; measure it and replace it.
 */
export const MEDIA_COST: Record<MediaKind, number> = {
  video: 0.35,
  image: 0.0005,
  audio: 0.03,
};

export const MEDIA_LABEL: Record<MediaKind, string> = {
  video: 'video',
  image: 'image',
  audio: 'voiceover',
};

/** Operator-supplied costs, read once from MEDIA_COSTS_JSON. */
let costOverrides: Record<string, number> | undefined;
function overrides(): Record<string, number> {
  if (costOverrides) return costOverrides;
  costOverrides = {};
  try {
    const raw = JSON.parse(process.env.MEDIA_COSTS_JSON ?? '{}') as Record<string, unknown>;
    for (const [k, v] of Object.entries(raw)) {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) costOverrides[k] = n;
    }
  } catch {
    /* a malformed override never takes the pricing table down */
  }
  return costOverrides;
}

/** For tests and for a config reload. */
export function resetMediaCostCache(): void {
  costOverrides = undefined;
}

/** What one unit of `kind` costs to serve, honouring MEDIA_COSTS_JSON. */
export function mediaCost(kind: MediaKind): number {
  const o = overrides()[kind];
  return typeof o === 'number' ? o : MEDIA_COST[kind];
}
