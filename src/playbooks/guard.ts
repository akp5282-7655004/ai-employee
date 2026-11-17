/**
 * Audience rules from the master template. Miles does not target or exclude
 * people by protected traits, or by stand-ins for those traits.
 */
import { tradePlaybook, type AudienceSegment } from './load.js';
import { financingWarnings, hasFinancingTerms } from '../packs/apply.js';

const PROTECTED = /\b(race|racial|ethnicity|ethnic|religion|religious|national origin|sexual orientation|disability|disabled people|gender identity)\b/i;
const FAKE_CLAIM = /fake review|guaranteed results?|#\s*1|\bnumber[- ]one\b/i;

export function usesProtectedTrait(text: string): boolean {
  return PROTECTED.test(text || '');
}

export function guardCopy(text: string): { ok: boolean; text: string; reason?: string } {
  if (usesProtectedTrait(text)) {
    return { ok: false, text: '', reason: 'Miles does not target or exclude by protected traits or by proxies for them.' };
  }
  const claim = text.match(FAKE_CLAIM);
  if (claim) {
    return { ok: false, text: '', reason: `Miles will not write "${claim[0]}". That claim was not on the profile.` };
  }
  // One financing rule: a credit offer (either check's wording) needs a terms line
  // (either check's wording: "subject to credit", "APR and terms apply", "With approved credit. See terms.").
  const creditOffer = /\b(financing|0%\s*apr|monthly payments?)\b/i.test(text) || financingWarnings(text).length > 0;
  const termsLine = /\b(subject to credit|terms apply|apr)\b/i.test(text) || hasFinancingTerms(text);
  if (creditOffer && !termsLine) {
    return { ok: false, text: '', reason: 'Financing copy needs the terms disclaimer, including APR and that it is subject to credit.' };
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
