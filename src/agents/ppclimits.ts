/**
 * Elements a Google draft includes.
 * Checklists name those elements. They are not Starter, Growth, or Scale caps.
 * See docs/reference/BUILD-GUIDANCE.md.
 */
import type { CampaignSpec, KeywordSpec } from './campaign.js';

export interface BuildElements {
  spec: CampaignSpec;
  brand: CampaignSpec | null;
  note: string;
  checklist: string[];
}

function fitBrand(line: string): string {
  const text = line.replace(/\s+/g, ' ').trim();
  return text.length <= 30 ? text : '';
}

function withVariant(spec: CampaignSpec): CampaignSpec {
  return {
    ...spec,
    adGroups: spec.adGroups.map((group) => {
      const lines = group.rsa.headlines;
      const rsaVariant = lines.length > 1
        ? { headlines: [...lines.slice(1), lines[0]!], descriptions: [...group.rsa.descriptions], pinDescription1: false }
        : undefined;
      return { ...group, keywords: [...group.keywords], rsa: { ...group.rsa, headlines: [...lines], descriptions: [...group.rsa.descriptions] }, rsaVariant };
    }),
  };
}

function brandSpec(source: CampaignSpec, brand: string, city: string): CampaignSpec {
  const name = brand.replace(/\s+/g, ' ').trim();
  const lower = name.toLowerCase();
  const place = city.split(',')[0]?.trim().toLowerCase() || '';
  const keywords: KeywordSpec[] = [{ text: lower, match: 'exact' }];
  if (place && !lower.includes(place)) keywords.push({ text: `${lower} ${place}`, match: 'exact' });
  const seed = source.adGroups[0]?.rsa;
  const headlines = [fitBrand(name), ...(seed?.headlines ?? [])].filter((line, index, all) => line && all.indexOf(line) === index).slice(0, 10);
  const placeLabel = place ? place.replace(/\b\w/g, (letter) => letter.toUpperCase()) : 'Search';
  return withVariant({
    ...source,
    name: `Brand | ${placeLabel} | Search`.slice(0, 120),
    adGroups: [{
      name,
      keywords,
      finalUrl: source.finalUrl,
      rsa: {
        headlines: headlines.length ? headlines : [fitBrand(name) || 'Local Service'],
        descriptions: seed?.descriptions?.length ? seed.descriptions : [`${name}. Call to schedule a visit.`.slice(0, 90)],
        pinDescription1: false,
      },
    }],
  });
}

/** Add the branded campaign and the checklist elements. Does not drop services, ad groups, or keywords for a plan tier. */
export function includeBuildElements(spec: CampaignSpec, brandName?: string): BuildElements {
  const next = withVariant({
    ...spec,
    negatives: [...(spec.negatives || [])],
  });
  const city = (next.locations[0] || '').split(',')[0]?.trim() || '';
  const brand = brandName?.trim() ? brandSpec(next, brandName.trim(), city) : null;
  const brandLower = brandName?.trim().toLowerCase() || '';
  if (brandLower && !next.adGroups.some((group) => group.keywords.some((keyword) => keyword.text.includes(brandLower)))) {
    next.negatives = [...new Set([...next.negatives, brandLower])];
  }
  const note = brand
    ? `Branded campaign: ${brand.name}. Service ad groups follow the owner's services. No plan tier removed any.`
    : 'No brand name is saved, so this draft has the service campaign only.';
  const checklist = [
    'Keyword competition: not available. No score was invented.',
    'Negative keywords, headlines, descriptions, and bid management are in this draft.',
    'A second responsive ad is included so headlines can be tested. Variant count is not a plan tier.',
    'Display and retargeting stay off inside this Search campaign. They belong beside it only when the offer needs them.',
    'Each ad group uses its landing page. Miles does not invent a new page.',
    'Weekly optimization, keyword performance, monitoring, and the monthly report stay with the account.',
  ];
  return { spec: next, brand, note, checklist };
}
