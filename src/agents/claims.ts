/**
 * Facts about a business that only its owner can vouch for.
 *
 * A model asked for ad copy reaches for the lines every ad has: licensed and
 * insured, 5-star rated, satisfaction guaranteed, free estimates. Each one is a
 * statement of fact made in the owner's name. If it is not true of this
 * business, the ad is a false claim, and the platform's misrepresentation
 * policy lands on the owner's account.
 *
 * So a line that makes one of these claims is kept only when the owner's own
 * words (the saved profile, services, offers) say the same thing.
 */
const CLAIMS: { name: string; re: RegExp }[] = [
  { name: 'licensed', re: /\blicen[sc]ed\b/i },
  { name: 'insured', re: /\binsured\b/i },
  { name: 'bonded', re: /\bbonded\b/i },
  { name: 'certified', re: /\bcertified\b/i },
  { name: 'rated', re: /\b\d(\.\d)?[- ]star|\btop[- ]rated\b|\b5\s?stars?\b|\bhighly rated\b/i },
  { name: 'reviews', re: /\breviews?\b|\breviewed\b/i },
  { name: 'guarantee', re: /\bguarantee[ds]?\b/i },
  { name: 'warranty', re: /\bwarrant(y|ies)\b/i },
  { name: 'award', re: /\baward/i },
  { name: 'number one', re: /#\s*1\b|\bnumber[- ]one\b|\bno\.\s*1\b|\bbest\b/i },
  { name: 'free', re: /\bfree\b/i },
  { name: 'locally owned', re: /\blocally owned\b|\bfamily[- ]owned\b/i },
  { name: 'years', re: /\b\d+\+?\s*years\b|\bsince (19|20)\d{2}\b/i },
  { name: 'price', re: /\$\s?\d|\b\d+\s?% off\b/i },
];

/**
 * Credential claims an ad may make only when the business shows them.
 * "Licensed And Insured", "Experienced Crew", and "Locally Owned" are
 * statements of fact about the business, so Miles does not print them on a
 * guess. Every field defaults to false.
 */
export interface VerifiedClaims {
  licensed?: boolean;
  insured?: boolean;
  experienced?: boolean;
  locallyOwned?: boolean;
}

/** Read the claims a site's own text makes. Nothing found means nothing claimed. */
export function claimsFromText(text: string | undefined): VerifiedClaims {
  const t = (text || '').replace(/\s+/g, ' ');
  return {
    licensed: /(?<!\bnot\s)\blicen[sc]ed\b|\blicen[sc]e\s*(#|no\.?|number)\s*\w/i.test(t),
    insured: /(?<!\bnot\s)\b(fully\s+)?insured\b/i.test(t),
    experienced: /\b\d{1,3}\+?\s*(years?|yrs)\b(\s+of)?\s+(experience|in business)/i.test(t) || /\bsince\s+(19|20)\d{2}\b/i.test(t),
    locallyOwned: /\b(locally|family)[\s-]+owned\b/i.test(t),
  };
}

/** True when both licensing and insurance are backed up. */
export function licensedAndInsured(claims?: VerifiedClaims): boolean {
  return !!(claims?.licensed && claims?.insured);
}

/**
 * Credential claims with a structured check. For these, the owner's text is
 * read with claimsFromText (which ignores "not licensed" and the like), and
 * claims already verified from the business's own site count too. That is the
 * same rule the default templates use to print "Licensed And Insured".
 */
const CREDENTIAL: Record<string, keyof VerifiedClaims> = {
  licensed: 'licensed',
  insured: 'insured',
  'locally owned': 'locallyOwned',
  years: 'experienced',
};

/** The claim a line makes that the owner's own text (or verified claims) does not back, or null. */
export function unvouchedClaim(line: string, ownerText = '', verified?: VerifiedClaims): string | null {
  const fromOwner = claimsFromText(ownerText);
  for (const claim of CLAIMS) {
    if (!claim.re.test(line)) continue;
    const key = CREDENTIAL[claim.name];
    if (key ? fromOwner[key] || verified?.[key] : claim.re.test(ownerText)) continue;
    return claim.name;
  }
  return null;
}

/** Keep only the lines the owner's text (or verified claims) supports. */
export function vouchedLines(lines: string[], ownerText = '', verified?: VerifiedClaims): string[] {
  return lines.filter((line) => !unvouchedClaim(line, ownerText, verified));
}

