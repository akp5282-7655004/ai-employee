import type { CampaignLaunchStep } from '../connectors/types.js';

/** Shared public demo account. Never an operator, and never a live ad account. */
export const DEMO_ACCOUNT_EMAIL = 'demo@miles.local';

/**
 * META_ADS_ACCESS_TOKEN, META_AD_ACCOUNT_ID, and META_PAGE_ID are one ad
 * account for the whole server. A customer approval must not create campaigns
 * there. Per-customer Meta is not part of this launch slice.
 */
export const META_SHARED_ACCOUNT_NOTE =
  'Coming later. Meta, TikTok, and Local Services Ads are not in this version. Miles will not create a Meta campaign, and a shared META_ADS_ACCESS_TOKEN would put every customer in one ad account. Nothing was created and nothing can spend.';

export function isDemoAccount(email: string | undefined): boolean {
  return (email ?? '').trim().toLowerCase() === DEMO_ACCOUNT_EMAIL;
}

/** The only status Miles is allowed to send to Google Ads. */
export function forcePausedSearchSpec<T extends { status?: string }>(spec: T): T & { status: 'PAUSED' } {
  return { ...spec, status: 'PAUSED' };
}

/**
 * A Search create is complete only when the budget, the campaign, an ad group,
 * its keywords, and a responsive search ad all succeeded. A later verify step,
 * when present, must also succeed. Anything else is a partial or a miss.
 */
export function judgeSearchLaunch(steps: CampaignLaunchStep[]): { ok: boolean; partial: boolean; missing: string[]; adsMissing: { name: string; adGroupResource?: string; error?: string }[] } {
  const succeeded = (re: RegExp) => steps.some((s) => re.test(s.step) && s.ok);
  const missing: string[] = [];
  if (!succeeded(/budget/i)) missing.push('daily budget');
  if (!succeeded(/create campaign/i)) missing.push('campaign');
  if (!succeeded(/ad group/i)) missing.push('ad group');
  const keywords = steps.filter((s) => /keyword/i.test(s.step));
  if (!keywords.length || keywords.some((s) => !s.ok)) missing.push('keywords');
  const rsaSteps = steps.filter((s) => /responsive search ad/i.test(s.step));
  const rsaFails = rsaSteps.filter((s) => !s.ok);
  if (!rsaSteps.length || rsaFails.length) missing.push('responsive search ad');
  const verify = steps.find((s) => /verify campaign/i.test(s.step));
  if (verify && !verify.ok) missing.push('verification');
  const created = steps.some((s) => s.ok && !!s.resource);
  const ok = missing.length === 0;
  const adsMissing = rsaFails.map((s) => {
    const name = s.step.match(/in "([^"]+)"/)?.[1] || 'ad';
    const adGroup = steps.find((step) => step.ok && step.resource && new RegExp(`ad group "${name}"`, 'i').test(step.step));
    return { name, adGroupResource: adGroup?.resource, error: s.error };
  });
  return { ok, partial: created && !ok, missing, adsMissing };
}

/** Plain sentences for the steps Google rejected. Empty when every step succeeded. */
export function plainStepErrors(steps: { step: string; ok: boolean; error?: string }[]): string {
  const bad = steps.filter((step) => !step.ok);
  if (!bad.length) return '';
  return bad.map((step) => `${step.step}: ${step.error || 'Google did not confirm this step.'}`).join(' ');
}

/** Resource names Miles can enable again on a later Start. */
export function resourcesFromSteps(steps: { step: string; ok: boolean; resource?: string }[]): { adGroupResources: string[]; adResources: string[] } {
  return {
    adGroupResources: steps.filter((step) => /create ad group/i.test(step.step) && step.resource).map((step) => step.resource!),
    adResources: steps.filter((step) => /responsive search ad/i.test(step.step) && step.resource).map((step) => step.resource!),
  };
}

export function searchLaunchNote(args: {
  live: boolean;
  ok: boolean;
  partial: boolean;
  missing: string[];
  customerLabel?: string;
  name: string;
}): string {
  const paused = 'It is PAUSED. Miles does not enable campaigns and does not spend. Turn it on only in Google Ads after you review it there.';
  if (!args.live) {
    return `Demo mode — no campaign was created in Google Ads and nothing was deployed. ${paused}`;
  }
  if (args.ok) {
    const where = args.customerLabel ? ` in ${args.customerLabel}` : '';
    return `Paused Search campaign "${args.name}" was created${where}, including its budget, ad group, keywords, and responsive search ad. ${paused}`;
  }
  if (args.partial) {
    return `The create stopped partway (still missing: ${args.missing.join(', ')}). Anything already created is PAUSED and is not spending, but this is not a complete campaign. ${paused}`;
  }
  const why = args.missing.length ? `Missing: ${args.missing.join(', ')}. ` : '';
  return `No campaign was created. ${why}${paused}`;
}
