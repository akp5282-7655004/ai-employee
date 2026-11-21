/**
 * Trade keys for the living playbook.
 * A combined sample ("HVAC & Plumbing") is not a trade and returns ''.
 */
import type { Platform } from './types.js';

const LABELS: Record<string, string> = {
  hvac: 'HVAC',
  plumbing: 'Plumbing',
  electrical: 'Electrical',
  roofing: 'Roofing',
  painting: 'Painting',
  solar: 'Solar',
  landscaping: 'Landscaping',
  garage_door: 'Garage Door',
  drain: 'Drain / Sewer',
  water_heater: 'Water Heater',
};

export function tradeKey(raw: string | undefined | null): string {
  const t = (raw || '').toLowerCase().trim();
  if (!t) return '';
  if (t.includes('&') || /\band\b/.test(t)) return '';
  if (t.includes('all trades') || t.includes('general')) return '';
  if (t.includes('garage')) return 'garage_door';
  if (t.includes('water heater')) return 'water_heater';
  if (t.includes('drain') || t.includes('sewer')) return 'drain';
  if (t.includes('hvac') || t.includes('air condition') || t.includes('heating') || t.includes('furnace')) return 'hvac';
  if (t.includes('plumb')) return 'plumbing';
  if (t.includes('electric')) return 'electrical';
  if (t.includes('roof') || t.includes('gutter')) return 'roofing';
  if (t.includes('paint')) return 'painting';
  if (t.includes('solar')) return 'solar';
  if (t.includes('landscap') || t.includes('lawn')) return 'landscaping';
  return '';
}

export function tradeLabel(key: string): string {
  return LABELS[key] || (key ? key.charAt(0).toUpperCase() + key.slice(1) : 'this trade');
}

export function platformOf(raw: string | undefined | null): Platform | null {
  const t = (raw || '').toLowerCase();
  if (!t) return null;
  if (/local.?service|\blsa\b|google_lsa/.test(t)) return 'google_lsa';
  if (/tiktok/.test(t)) return 'tiktok';
  if (/meta|facebook|instagram/.test(t)) return 'meta';
  if (/google|adwords|gads/.test(t)) return 'google_ads';
  return null;
}

export function platformLabel(platform: Platform): string {
  if (platform === 'google_ads') return 'Google Ads';
  if (platform === 'google_lsa') return 'Local Services Ads';
  if (platform === 'meta') return 'Meta';
  return 'TikTok';
}

export function metricLabel(metric: string): string {
  if (metric === 'cpl') return 'cost per lead';
  if (metric === 'cpc') return 'cost per click';
  if (metric === 'cpa') return 'cost per booked job';
  return 'return on ad spend';
}
