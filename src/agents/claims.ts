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

/** The claim a line makes that the owner's own text does not back, or null. */
export function unvouchedClaim(line: string, ownerText = ''): string | null {
  for (const claim of CLAIMS) {
    if (!claim.re.test(line)) continue;
    if (claim.re.test(ownerText)) continue;
    return claim.name;
  }
  return null;
}

/** Keep only the lines the owner's text supports. */
export function vouchedLines(lines: string[], ownerText = ''): string[] {
  return lines.filter((line) => !unvouchedClaim(line, ownerText));
}
