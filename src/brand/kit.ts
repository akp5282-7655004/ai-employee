/**
 * The Brand Kit — one source of truth for a customer's brand, so everything Miles
 * creates comes out on-brand. It's auto-seeded from the business profile + uploaded
 * assets (logo, colors, description) the first time, then editable. Every creative
 * surface (Creative Studio, Ad Studio, the social agents, Optimize Prompt) pulls the
 * kit into its BrandContext, so a generated or optimized asset follows the same
 * palette, voice, and rules without the customer re-specifying them each time.
 */

export interface BrandKit {
  name?: string;
  tagline?: string;
  /** Brand colors as hex, primary first. */
  colors: string[];
  /** Freeform type direction, e.g. "Poppins for headlines, Inter for body". */
  fonts?: string;
  /** Logo image (data URL or link) — composited in the editor, not painted by AI. */
  logoUrl?: string;
  /** Tone/voice descriptors, e.g. "friendly, trustworthy, local, no jargon". */
  voice?: string;
  /** Who the brand speaks to. */
  audience?: string;
  /** Words/phrases to lean into. */
  keywords: string[];
  /** Do-nots: "no stock-photo clichés, no emojis, never say 'cheap'". */
  avoid?: string;
}

const HEX_RE = /#?[0-9a-fA-F]{6}\b/g;

/** Pull hex colors out of a freeform string (profile brandColors field, etc.). */
export function parseColors(raw?: string): string[] {
  if (!raw) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of raw.match(HEX_RE) ?? []) {
    const hex = ('#' + m.replace('#', '')).toLowerCase();
    if (!seen.has(hex)) {
      seen.add(hex);
      out.push(hex);
    }
  }
  return out.slice(0, 5);
}

export function emptyKit(): BrandKit {
  return { colors: [], keywords: [] };
}

/**
 * Seed a kit from what we already know (profile + assets). Never invents specifics
 * it doesn't have — an unknown field stays empty so the UI can prompt for it.
 */
export function deriveKit(
  profile: Record<string, unknown> = {},
  assets: Record<string, unknown> = {},
): BrandKit {
  const p = profile as Record<string, string>;
  const colors = parseColors(p.brandColors || (assets as Record<string, string>).brandColors);
  const kit: BrandKit = {
    name: p.businessName || undefined,
    tagline: p.tagline || p.slogan || undefined,
    colors,
    fonts: p.fonts || undefined,
    logoUrl: ((assets as Record<string, string>).logo as string) || p.logo || undefined,
    voice: p.brandVoice || undefined,
    audience: p.audience || (p.serviceAreas ? `homeowners in ${p.serviceAreas.split(',')[0]?.trim()}` : undefined),
    keywords: [],
    avoid: p.brandAvoid || undefined,
  };
  return kit;
}

/** Merge a stored (possibly partial) kit over a freshly derived one. */
export function resolveKit(
  stored: Partial<BrandKit> | undefined,
  profile: Record<string, unknown> = {},
  assets: Record<string, unknown> = {},
): BrandKit {
  const base = deriveKit(profile, assets);
  if (!stored) return base;
  return {
    name: stored.name ?? base.name,
    tagline: stored.tagline ?? base.tagline,
    colors: stored.colors?.length ? stored.colors.slice(0, 5) : base.colors,
    fonts: stored.fonts ?? base.fonts,
    logoUrl: stored.logoUrl ?? base.logoUrl,
    voice: stored.voice ?? base.voice,
    audience: stored.audience ?? base.audience,
    keywords: stored.keywords?.length ? stored.keywords.slice(0, 20) : base.keywords,
    avoid: stored.avoid ?? base.avoid,
  };
}

/** True when the kit carries enough to meaningfully steer output. */
export function kitHasGuidance(kit: BrandKit): boolean {
  return !!(kit.colors.length || kit.voice || kit.tagline || kit.fonts || kit.keywords.length || kit.avoid);
}

/**
 * A compact brand directive for image/video prompts — palette + feel + do-nots.
 * Deliberately does NOT ask the model to draw the logo (it can't reproduce it);
 * the logo is composited in the editor. Returns '' when there's nothing to say.
 */
export function brandVisualDirective(kit: BrandKit): string {
  const parts: string[] = [];
  if (kit.colors.length) parts.push(`use the brand color palette ${kit.colors.join(', ')} as the dominant colors`);
  if (kit.voice) parts.push(`overall feel: ${kit.voice}`);
  if (kit.avoid) parts.push(`avoid: ${kit.avoid}`);
  if (!parts.length) return '';
  return ` Brand guidelines: ${parts.join('; ')}. Leave a clean, uncluttered area where the logo can be placed.`;
}

/** Brand-voice guidance for text/copy/voiceover system prompts. Returns '' if empty. */
export function brandVoiceDirective(kit: BrandKit): string {
  const parts: string[] = [];
  if (kit.voice) parts.push(`Voice & tone: ${kit.voice}.`);
  if (kit.tagline) parts.push(`Tagline to stay consistent with: "${kit.tagline}".`);
  if (kit.keywords.length) parts.push(`Lean into these words/themes: ${kit.keywords.join(', ')}.`);
  if (kit.avoid) parts.push(`Never do this: ${kit.avoid}.`);
  if (!parts.length) return '';
  return ' Follow the brand guidelines: ' + parts.join(' ');
}
