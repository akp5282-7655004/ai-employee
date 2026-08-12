/**
 * The Creative Studio brain — turns a plain request + the customer's brand into a
 * generation-ready prompt for any marketing asset type, from one place. Pure and
 * tested; the fal.ai / LLM calls plug in on top (server.ts). Visual types render
 * an image or video; "copy"/"doc" render text.
 */
import type { Aspect } from './fal.js';

export type AssetKind = 'image' | 'video' | 'text' | 'audio';
export type AssetType = 'image' | 'logo' | 'social' | 'flyer' | 'card' | 'video' | 'voiceover' | 'copy' | 'doc';

export interface AssetTypeSpec {
  type: AssetType;
  label: string;
  kind: AssetKind;
  defaultAspect: Aspect;
  hint: string;
}

/** The one-place menu of marketing assets a customer can make. */
export const ASSET_TYPES: AssetTypeSpec[] = [
  { type: 'image', label: 'Image', kind: 'image', defaultAspect: '16:9', hint: 'A marketing photo or graphic' },
  { type: 'logo', label: 'Logo', kind: 'image', defaultAspect: '1:1', hint: 'A clean brand mark' },
  { type: 'social', label: 'Social post', kind: 'image', defaultAspect: '4:5', hint: 'A thumb-stopping social graphic' },
  { type: 'flyer', label: 'Flyer', kind: 'image', defaultAspect: '4:5', hint: 'A printable promo / ad' },
  { type: 'card', label: 'Card / Invite', kind: 'image', defaultAspect: '4:5', hint: 'A card or invitation' },
  { type: 'video', label: 'Video clip', kind: 'video', defaultAspect: '16:9', hint: 'A short AI video (slow + pricier)' },
  { type: 'voiceover', label: 'Voiceover', kind: 'audio', defaultAspect: '1:1', hint: 'Text-to-speech from a script' },
  { type: 'copy', label: 'Ad copy', kind: 'text', defaultAspect: '1:1', hint: 'Headlines + ad text' },
  { type: 'doc', label: 'Doc / Email', kind: 'text', defaultAspect: '1:1', hint: 'An email, blog, or one-pager' },
];

export function specFor(type: string): AssetTypeSpec | undefined {
  return ASSET_TYPES.find((a) => a.type === type);
}

/**
 * The system prompt for the "Optimize prompt" button — turns a customer's rough,
 * vague idea into an expert, detailed prompt for the asset type, so people who
 * don't know prompt engineering still get great results. Returns ONLY the rewritten
 * prompt so it can drop straight back into the input for the customer to review.
 */
export function optimizerSystem(kind: AssetKind): string {
  if (kind === 'image')
    return "You are a world-class prompt engineer and photographer for AI image generation. Rewrite the user's rough idea into ONE vivid, detailed prompt. Specify: subject; composition and framing; setting; camera and lens (e.g. 50mm, shallow depth of field); lighting (direction, quality, time of day); color palette; mood; and quality cues (sharp, photorealistic, professional, high detail). Keep it realistic and on-brand for their business, and honor any specifics they gave (logo, offer text, colors). Return ONLY the improved prompt as plain text — no preamble, no quotes, no explanation, no lists.";
  if (kind === 'video')
    return "You are a film director and world-class prompt engineer for AI text-to-video (Veo / Kling / Sora class). Rewrite the user's rough idea into ONE cinematic, shot-designed prompt. Specify: the subject and its action/motion; shot type and composition (e.g. wide establishing shot, low-angle hero shot); camera body and lens (e.g. shot on ARRI Alexa, 35mm anamorphic); a single deliberate camera move (e.g. slow dolly-in, orbiting tracking shot, crane up); lighting (e.g. golden-hour rim light, volumetric haze); color grade (e.g. filmic teal-and-orange); and atmosphere (particles, reflections, shallow depth of field). Keep it ONE continuous, physically-plausible shot, and on-brand for their business; honor any specifics they gave. Return ONLY the improved prompt as plain text — no preamble, no quotes, no explanation.";
  if (kind === 'audio')
    return "You are an expert voiceover scriptwriter. Rewrite the user's rough idea into a natural, engaging spoken script — clear, warm, well-paced, ready to read aloud in about the requested length. On-brand for their business. Return ONLY the script text — no preamble, no stage directions, no quotes.";
  return "You are an expert marketing brief writer. Rewrite the user's rough idea into a clear, specific, effective brief that will produce great marketing content — spell out the audience, angle, key points, tone, and call to action. On-brand for their business. Return ONLY the improved brief as plain text — no preamble, no quotes.";
}

export interface BrandContext {
  business?: string;
  vertical?: string;
  category?: string;
  city?: string;
  services?: string[];
}

function trade(brand: BrandContext): string {
  return brand.category?.replace(/_/g, ' ') || brand.vertical?.replace(/_/g, ' ') || 'local-service';
}
function bizLine(brand: BrandContext): string {
  const biz = brand.business || 'a local business';
  const loc = brand.city ? ` in ${brand.city}` : '';
  return `${biz}, a ${trade(brand)} business${loc}`;
}

// Strip meta-instructions ("use my logo", "add my brand") so the image model
// doesn't paint those words onto the artwork as literal text.
const META_RE = /\b(?:use|add|put|include|with|and)\s+(?:my\s+|our\s+|the\s+)?(?:logo|branding|brand)\b/gi;
function cleanIdea(s: string): string {
  return (s || '')
    .replace(META_RE, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/^[,.\s]+|[,\s]+$/g, '')
    .trim();
}
// Guardrails for text-bearing designs — AI image models can't spell reliably, so
// keep text minimal, real, and correctly spelled, and never invent contact info.
const TEXT_RULES =
  ' Text on the design must be limited to the business name and the offer, spelled correctly. Do NOT invent phone numbers, websites, addresses, or any placeholder/gibberish text. Leave a clean empty area for the logo. Clean, professional, legible typography.';

/** Build a generation-ready image/video prompt for a visual asset type. */
export function buildVisualPrompt(type: AssetType, prompt: string, brand: BrandContext = {}, style?: string): string {
  const idea = cleanIdea(prompt);
  const styleTag = style && style !== 'Auto' ? ` Style: ${style.toLowerCase()}.` : '';
  const base: Record<string, string> = {
    logo: `Minimalist, professional vector logo for "${brand.business || 'the business'}", a ${trade(brand)} company. ${idea}. Flat, clean, memorable, centered on a plain background. The only text is the business name, correctly spelled — no other words, no gibberish.`,
    social: `Eye-catching social media graphic for ${bizLine(brand)}. ${idea}.${TEXT_RULES} Bold, thumb-stopping, high contrast.`,
    flyer: `Professional marketing flyer for ${bizLine(brand)}. ${idea}.${TEXT_RULES} Clean layout, trustworthy local-service look.`,
    card: `Elegant card or invitation for ${brand.business || 'the business'}. ${idea}.${TEXT_RULES}`,
    image: `High-quality, photorealistic marketing photo for ${bizLine(brand)}. ${idea}. Cinematic lighting, shallow depth of field, sharp detail, authentic — not stocky. No text overlay.`,
    video: `Cinematic marketing video for ${bizLine(brand)}. ${idea}. One continuous, physically-plausible shot with a deliberate camera move (dolly, orbit, or crane), professional cinematic lighting, filmic color grade, shallow depth of field, and a strong opening frame. Smooth, high-quality motion; no text overlay.`,
  };
  return `${base[type] ?? `${idea} — for ${bizLine(brand)}.`}${styleTag}`.trim();
}

/** System + user prompts for the text asset types (copy / doc), for the LLM. */
export function buildTextPrompt(type: AssetType, prompt: string, brand: BrandContext = {}): { system: string; user: string } {
  const who = `${brand.business || 'a local business'} (${trade(brand)}${brand.city ? `, ${brand.city}` : ''})`;
  const svc = brand.services?.length ? ` Services: ${brand.services.join(', ')}.` : '';
  const system =
    type === 'copy'
      ? `You are a direct-response marketing copywriter for local-service businesses. Write tight, benefit-led ad copy that drives calls and bookings — no fluff, no clichés. Return 3 options, each as a short headline + one line of body. Plain text, numbered.`
      : `You write clear, friendly marketing content (emails, blog intros, one-pagers) for local-service businesses. Warm, credible, concrete. Return ready-to-send text with a subject/title line. Plain text.`;
  const user = `Business: ${who}.${svc}\nRequest: ${prompt || 'a strong general promotion'}`;
  return { system, user };
}

/** A deterministic text fallback when no LLM key is set (demo-safe). */
export function fallbackText(type: AssetType, prompt: string, brand: BrandContext = {}): string {
  const biz = brand.business || 'Your business';
  const t = trade(brand);
  if (type === 'copy') {
    return [
      `1) “${biz}: ${t} done right, today.” — Book online in 60 seconds. Same-day slots open.`,
      `2) “Trusted ${t} your neighbors call first.” — Upfront pricing, no surprises. Call now.`,
      `3) “${prompt || 'Need it fixed fast?'}” — ${biz} has you covered. Reserve your time →`,
    ].join('\n');
  }
  return `Subject: A quick note from ${biz}\n\nHi there —\n\n${prompt || `Whenever you need ${t}, ${biz} is here to help`}. We show up on time, do honest work, and stand behind it.\n\nReady when you are — reply or call and we'll get you scheduled.\n\n— The ${biz} team\n\n(Add an OpenRouter key to have Miles write this custom for each request.)`;
}
