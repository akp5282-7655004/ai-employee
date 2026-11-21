/**
 * SOP 147 pre-launch review for one Search plan.
 * Ready means every required row passed. A blocker or an unknown holds the
 * approval card. Ads stay paused either way. Licensed SOP text is not copied here.
 */
import type { CampaignSpec } from './campaign.js';

export interface SopCheck {
  area: string;
  result: 'pass' | 'blocker' | 'unknown';
  detail: string;
}

export interface SopReview {
  ready: boolean;
  rows: SopCheck[];
}

export interface ReviewInput {
  /** Owner confirmed a lead form or call is the conversion. */
  trackingLead?: boolean;
  /** Saved daily cap. 0 means no cap is stored. */
  dailyCap?: number;
  /** Dollars the owner just named. Compared with the spec. */
  requestedDaily?: number;
}

function row(area: string, result: SopCheck['result'], detail: string): SopCheck {
  return { area, result, detail };
}

export function reviewSearchPlan(spec: CampaignSpec, input: ReviewInput = {}): SopReview {
  const rows: SopCheck[] = [];
  const cap = Number(input.dailyCap) || 0;
  const asked = Number(input.requestedDaily) || spec.dailyBudget;

  rows.push(spec.status === 'PAUSED'
    ? row('Campaign state', 'pass', 'The plan is paused. SOP 147 stops the review if the campaign is already on.')
    : row('Campaign state', 'blocker', 'The plan is not paused. SOP 147 does not review an enabled campaign as if it were off.'));

  rows.push(input.trackingLead
    ? row('Goals', 'pass', 'Calls or form fills are confirmed as the lead. That is the conversion this campaign is for.')
    : row('Goals', 'unknown', 'No proof yet that a call or a form fill is counted. SOP 147 keeps Hold until that is confirmed. A green setup page is not proof.'));

  if (!(spec.dailyBudget > 0) || Math.abs(spec.dailyBudget - asked) > 0.001) {
    rows.push(row('Budget', 'blocker', `The plan is $${spec.dailyBudget}/day and the owner asked for $${asked}/day. SOP 147 treats a different amount as a blocker.`));
  } else if (cap > 0 && spec.dailyBudget > cap + 0.001) {
    rows.push(row('Budget', 'blocker', `$${spec.dailyBudget}/day is above the $${cap}/day cap. Nothing was created.`));
  } else if (spec.biddingStrategy === 'MAXIMIZE_CLICKS' && spec.trafficTest) {
    rows.push(row('Budget', 'pass', `$${spec.dailyBudget}/day. Maximize Clicks because the owner asked for a traffic test. The CPC cap is a Miles default, not a promise.`));
  } else if (spec.biddingStrategy === 'MAXIMIZE_CLICKS') {
    rows.push(row('Budget', 'blocker', 'SOP 146 uses Maximize clicks only for a traffic test the owner asked for. A lead campaign stays on Maximize conversions.'));
  } else if (spec.biddingStrategy === 'MAXIMIZE_CONVERSIONS' && !spec.bidPlan?.targetCpa) {
    rows.push(row('Budget', 'pass', `$${spec.dailyBudget}/day. Planned Maximize conversions with no target CPA. SOP 146 keeps this unpublished until the lead is confirmed.`));
  } else {
    rows.push(row('Budget', 'blocker', 'SOP 146 does not invent a target CPA. Start without one unless the owner supplied it.'));
  }

  const networks = (spec.networks || []).join(' ');
  const targeting = spec.targeting as { presence?: string; searchPartners?: boolean; display?: boolean } | undefined;
  const presence = targeting?.presence === 'PRESENCE';
  const partners = targeting?.searchPartners === true || /partner/i.test(networks);
  const display = targeting?.display === true || /display/i.test(networks);
  rows.push(!partners && !display && /google search/i.test(networks) && presence
    ? row('Network and location', 'pass', 'Google Search only. Presence is on. Search partners and Display are off.')
    : row('Network and location', 'blocker', 'SOP 147 keeps the first campaign on Google Search with Presence. Display and Search partners stay off.'));

  const controls = spec.copyControls;
  rows.push(controls && controls.aiMax === false && controls.textCustomization === false && controls.finalUrlExpansion === false
    ? row('Copy settings', 'pass', 'AI Max, text customization, and final URL expansion are off (SOP 130).')
    : row('Copy settings', 'blocker', 'AI Max, text customization, and final URL expansion must be off before the ad is saved.'));

  const urlOk = /^https:\/\/.+\..+/.test(spec.finalUrl || '') && !/example\.com/i.test(spec.finalUrl || '');
  rows.push(urlOk
    ? row('Landing page', 'pass', spec.finalUrl)
    : row('Landing page', 'blocker', 'Each ad needs the real https page for that service. Miles will not invent one.'));

  if (!spec.adGroups.length) rows.push(row('Ad groups', 'blocker', 'There is no ad group. SOP 145 needs one group per service and landing page.'));
  for (const group of spec.adGroups) {
    const texts = group.keywords.map((keyword) => keyword.text);
    const dup = texts.length !== new Set(texts).size;
    const broad = group.keywords.some((keyword) => keyword.match === 'broad');
    const empty = group.keywords.length === 0 || (group.rsa?.headlines.length ?? 0) < 8 || (group.rsa?.descriptions.length ?? 0) < 2;
    const long = (group.rsa?.headlines ?? []).some((line) => line.length > 30) || (group.rsa?.descriptions ?? []).some((line) => line.length > 90);
    const tooMany = (group.rsa?.headlines.length ?? 0) > 10 || (group.rsa?.descriptions.length ?? 0) > 4;
    if (dup || broad || empty || long || tooMany) {
      rows.push(row('Keywords and ads', 'blocker', `${group.name} breaks SOP 145 or SOP 130. One match type per phrase, exact for a specific task, phrase when added words still fit the page, 8 to 10 headlines, 2 to 4 descriptions.`));
    }
    const blocked = group.keywords.find((keyword) => (spec.negatives || []).some((neg) => keyword.text.includes(neg.toLowerCase())));
    if (blocked) rows.push(row('Negatives', 'blocker', `"${blocked.text}" is both a keyword and covered by a negative. SOP 129 will not block a search this campaign wants.`));
    const required = (spec.requiredWording || '').trim();
    if (required && !group.rsa?.pinDescription1) {
      rows.push(row('Pins', 'blocker', `${group.name} does not pin the required wording to description 1.`));
    }
  }
  if (spec.adGroups.length && !rows.some((item) => item.area === 'Keywords and ads' || item.area === 'Negatives')) {
    rows.push(row('Keywords and ads', 'pass', 'Each group has one service, phrase or exact keywords, and an 8 to 10 headline ad. The same phrase is not in both match types.'));
  }
  if (!(spec.requiredWording || '').trim() && spec.adGroups.every((group) => !group.rsa?.pinDescription1)) {
    rows.push(row('Pins', 'pass', 'No pins. SOP 130 pins only wording the owner said must always show.'));
  }

  const badLink = (spec.sitelinks ?? []).find((link) => link.text.length > 25 || (link.desc1 && link.desc1.length > 35) || (link.desc2 && link.desc2.length > 35) || !/^https:\/\//.test(link.url));
  const badCallout = (spec.callouts ?? []).find((line) => line.length > 25);
  const snippet = spec.structuredSnippet;
  const snippetOk = !!snippet && snippet.header === 'Service catalog' && snippet.values.length >= 3 && snippet.values.every((value) => value.length <= 25);
  if (badLink || badCallout || !snippetOk || (spec.callouts?.length ?? 0) < 4) {
    rows.push(row('Assets', 'blocker', 'A sitelink, callout, or snippet breaks SOP 149. Sitelink text is 25, descriptions 35, callouts 25, and a snippet needs at least 3 values under a preset header.'));
  } else if ((spec.sitelinks?.length ?? 0) < 4) {
    rows.push(row('Assets', 'pass', `Callouts and the service-catalog snippet are on the plan. ${(spec.sitelinks?.length ?? 0)} sitelink${(spec.sitelinks?.length ?? 0) === 1 ? '' : 's'} came from real pages. SOP 149 wants 4, and Miles does not invent the rest.`));
  } else {
    rows.push(row('Assets', 'pass', 'Sitelinks, callouts, and the service-catalog snippet fit SOP 149.'));
  }

  rows.push(row('Policy', 'pass', 'Policy review is still pending. Saving this plan does not mean Google approved the ad.'));

  return { ready: rows.every((item) => item.result === 'pass'), rows };
}
