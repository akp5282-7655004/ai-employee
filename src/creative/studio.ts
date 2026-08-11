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

/** Build a generation-ready image/video prompt for a visual asset type. */
export function buildVisualPrompt(type: AssetType, prompt: string, brand: BrandContext = {}, style?: string): string {
  const idea = (prompt || '').trim();
  const styleTag = style && style !== 'Auto' ? ` Style: ${style.toLowerCase()}.` : '';
  const base: Record<string, string> = {
    logo: `Minimalist, professional vector logo for "${brand.business || 'the business'}", a ${trade(brand)} company. ${idea}. Flat, clean, memorable, centered on a plain background, no lorem text.`,
    social: `Eye-catching social media graphic for ${bizLine(brand)}. ${idea}. Bold and thumb-stopping, high contrast, clear space for a short headline, on-brand and trustworthy.`,
    flyer: `Professional marketing flyer / advertisement for ${bizLine(brand)}. ${idea}. Clean layout with a clear headline area, trustworthy local-service look, print-ready.`,
    card: `Elegant card or invitation design for ${brand.business || 'the business'}. ${idea}. Tasteful, balanced composition, print-ready.`,
    image: `High-quality, realistic marketing photo for ${bizLine(brand)}. ${idea}. Professional lighting, sharp, authentic — not stocky.`,
    video: `Short, dynamic marketing video clip for ${bizLine(brand)}. ${idea}. Professional, engaging first second, smooth motion.`,
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
