/**
 * Audience rules from the master template. Miles does not target or exclude
 * people by protected traits, or by stand-ins for those traits.
 */
import { tradePlaybook, type AudienceSegment } from './load.js';

const PROTECTED = /\b(race|racial|ethnicity|ethnic|religion|religious|national origin|sexual orientation|disability|disabled people|gender identity)\b/i;

export function usesProtectedTrait(text: string): boolean {
  return PROTECTED.test(text || '');
}

export function guardCopy(text: string): { ok: boolean; text: string; reason?: string } {
  if (usesProtectedTrait(text)) {
    return { ok: false, text: '', reason: 'Miles does not target or exclude by protected traits or by proxies for them.' };
  }
  return { ok: true, text };
}

export interface AppliedAudience {
  metaAgeControl: number;
  metaAgeSuggestion: string;
  googleDemographics: string;
  lsaDemographics: string;
  alwaysExclude: string[];
  neverUse: string[];
  segments: AudienceSegment[];
  blocked: string[];
}

export function applyAudienceRules(trade: string | undefined, segments: AudienceSegment[]): AppliedAudience {
  const rules = tradePlaybook(trade).audienceRules;
  const blocked: string[] = [];
  const clean = segments.filter((segment) => {
    const blob = `${segment.name} ${segment.meta} ${segment.google} ${segment.zip_filters} ${segment.homeowner}`;
    if (usesProtectedTrait(blob)) {
      blocked.push(segment.name);
      return false;
    }
    return true;
  });
  return {
    metaAgeControl: rules?.metaAdvantageAgeControl ?? 25,
    metaAgeSuggestion: clean[0]?.age || `${rules?.plannedAgeMin ?? 30}+`,
    googleDemographics: 'Observe first. Bid adjustments only after 30 conversions. Do not exclude Lower 50% or Unknown.',
    lsaDemographics: 'No demographic targeting. Service area and job types only.',
    alwaysExclude: rules?.alwaysExclude ?? [],
    neverUse: rules?.neverUse ?? [],
    segments: clean,
    blocked,
  };
}
