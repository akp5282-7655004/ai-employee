import type { Intake } from '../intake.js';
import { checkClaims, type CommandPack } from '../packs/index.js';
import type { AdDraft, ChannelAllocation } from './types.js';

/**
 * Ad-copy drafting. Every draft is run through the pack's claims checklist BEFORE
 * it could publish — universal rules plus the vertical's own compliance patterns
 * (docs/VISION.md §5). Trust signals are built only from verified intake facts.
 */

/** Prioritize services: want-more-of first, drop want-less-of, then the rest. */
export function featuredServices(intake: Intake): string[] {
  const less = new Set(intake.wantLessOf.map((s) => s.toLowerCase()));
  const wanted = intake.wantMoreOf.filter((s) => !less.has(s.toLowerCase()));
  const rest = intake.services.filter(
    (s) => !less.has(s.toLowerCase()) && !wanted.some((w) => w.toLowerCase() === s.toLowerCase()),
  );
  return [...wanted, ...rest];
}

function trustLine(intake: Intake): string {
  const bits: string[] = [];
  if (intake.licensing.yearsInBusiness) bits.push(`${intake.licensing.yearsInBusiness}+ yrs`);
  if (intake.licensing.licenseNumber || intake.licensing.licensedStates.length) bits.push('Licensed');
  if (intake.licensing.insured) bits.push('Insured');
  if (intake.emergency) bits.push('Same-day service');
  return bits.join(' · ');
}

export function draftAds(pack: CommandPack, intake: Intake, allocations: ChannelAllocation[]): AdDraft[] {
  const brand = intake.businessName;
  const trust = trustLine(intake);
  const city = intake.serviceArea.cities[0] ?? 'your area';
  const drafts: AdDraft[] = [];

  for (const alloc of allocations) {
    if (alloc.channel === 'managed_profile' || alloc.monthlyBudget <= 0) continue;
    for (const service of alloc.targets.slice(0, 2)) {
      const s = service.toLowerCase();
      const headline = alloc.channel === 'lsa' ? `${title(s)} in ${city}` : `${title(s)} — ${brand}`;
      const body =
        alloc.channel === 'social'
          ? `Need ${s}? ${brand} can help.${trust ? ' ' + trust + '.' : ''} Tap for a fast quote.`
          : `${brand} handles ${s}${intake.emergency ? ', same day' : ''}.${trust ? ' ' + trust + '.' : ''}`;
      const cta = intake.emergency ? 'Call now' : 'Get a quote';
      const full = `${headline}\n${body}\n${cta}`;
      drafts.push({ channel: alloc.channel, service, headline, body, cta, claims: checkClaims(pack, full) });
    }
  }
  return drafts;
}

function title(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
