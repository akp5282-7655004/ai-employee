/**
 * Compact account snapshot for one signed-in tenant.
 *
 * The chat route fills this from the same saved profile, Miles file, spend
 * snapshot, connections, approval log, and leads the dashboard pages read.
 * This module does not fetch anything. It only copies the tenant it is given.
 * A journey record owned by someone else is dropped.
 * Sample numbers stay labeled SAMPLE and are never marked live.
 */
import type { MilesMode } from '../agents/policy.js';

export interface SnapshotCaps {
  dailyBudget: number;
  maxChangePct: number;
  monthlyCeiling: number;
  paused: boolean;
}

export interface SnapshotCampaign {
  source: 'miles' | 'journey' | 'plan';
  resource: string | null;
  name: string | null;
  status: string;
  lastReadback: string | null;
}

export interface SnapshotNumber {
  value: number | null;
  sample: boolean;
  note: string;
}

export interface SnapshotLead {
  name?: string;
  service?: string;
  source?: string;
  createdAt?: string;
  contacted?: boolean;
  sample: boolean;
}

export interface AccountSnapshot {
  tenantId: string;
  business: {
    name: string;
    trade: string;
    location: string;
    services: string;
    website: string;
    gbp: string;
    phone: string;
    completeness: { percent: number; filled: number; total: number };
    missing: string[];
  };
  miles: {
    phase: string;
    mode: MilesMode | null;
    paused: boolean;
    caps: SnapshotCaps | null;
    tracking: { leadConversion: boolean; ga4Linked: boolean; method: string | null } | null;
    plan: {
      name: string;
      dailyBudget: number;
      status: string;
      finalUrl: string;
      locations: string[];
      bidding: string;
    } | null;
  };
  campaigns: SnapshotCampaign[];
  performance: {
    spend: SnapshotNumber;
    leads: SnapshotNumber;
    cpl: SnapshotNumber;
    bookedJobs: SnapshotNumber;
    rows: { name: string; platform: string; spend: number; leads: number; sample: boolean }[];
  };
  integrations: {
    google: { oauth: boolean; ready: boolean; customerId: string | null; note: string; error: string | null };
    ghl: { connected: boolean; detail: string };
    speedToLead: { enabled: boolean; today: number; total: number; held: number; canSend: boolean };
    meta: { status: 'coming_later'; note: string };
    social: { facebook: boolean; instagram: boolean; linkedin: boolean; gbp: boolean };
    automations: { noShow: boolean; onboarding: boolean };
  };
  events: { ts: string; text: string }[];
  changeLog: { ts: string; kind: string; title: string }[];
  inbox: { id: string; kind: string; title: string; reason: string }[];
  leads: SnapshotLead[];
}

export interface ChatSources {
  tenantId: string;
  sampleConnector: boolean;
  profile: Record<string, unknown>;
  completeness: { percent: number; filled: number; total: number; missing: string[]; gbp: string };
  phase: string;
  mode: MilesMode | null;
  caps: SnapshotCaps | null;
  tracking: { leadConversion: boolean; ga4Linked: boolean; method: string | null } | null;
  plan: AccountSnapshot['miles']['plan'];
  milesCampaign: { resource?: string; status: string; name?: string; lastReadback?: string } | null;
  /** Included only when ownerId is this tenant. Anything else is another account. */
  journey: { ownerId?: string; rows: { resource?: string; name?: string; status?: string }[] } | null;
  spendRows: { platform: string; name: string; spend: number; leads: number }[];
  spendReadAt: string | null;
  /** Null when this account has no job marks. Zero is a real zero. */
  bookedFromJobs: number | null;
  /** Null when the spend snapshot has no deals. */
  bookedFromDeals: number | null;
  google: AccountSnapshot['integrations']['google'];
  ghl: { connected: boolean; detail: string };
  speedToLead: AccountSnapshot['integrations']['speedToLead'];
  social: AccountSnapshot['integrations']['social'];
  automations: { noShow: boolean; onboarding: boolean };
  events: { ts: string; text: string }[];
  changeLog: { ts: string; kind: string; title: string }[];
  inbox: { id: string; kind: string; title: string; reason: string }[];
  leads: { name?: string; service?: string; source?: string; createdAt?: string; contacted?: boolean }[];
}

const META_NOTE = 'Meta ads are coming later. A Facebook Page is not an ad account, and this build cannot launch Meta campaigns.';

function clean(value: unknown, max = 240): string {
  if (value == null) return '';
  return String(value).replace(/\u2014/g, ', ').replace(/\u2013/g, '-').replace(/\s+/g, ' ').trim().slice(0, max);
}

function roundNum(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Name, service, and source only. Phone and email stay out of the chat prompt. */
export function leadFacts(raw: unknown): { name?: string; service?: string; source?: string; createdAt?: string; contacted?: boolean } | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const name = clean(row.name, 80) || undefined;
  const service = clean(row.service, 80) || undefined;
  const source = clean(row.source, 80) || undefined;
  const createdAt = clean(row.createdAt, 40) || undefined;
  if (!name && !service && !source) return null;
  return { name, service, source, createdAt, contacted: row.contacted === true };
}

function numberNote(sample: boolean, value: number | null, liveNote: string, emptyNote: string): string {
  if (value == null) return emptyNote;
  if (sample) return 'SAMPLE. Example figure from the preview connector. Not a live account number.';
  return liveNote;
}

export function buildAccountSnapshot(sources: ChatSources): AccountSnapshot {
  const p = sources.profile ?? {};
  const location = clean(p.serviceAreas) || [clean(p.city), clean(p.state)].filter(Boolean).join(', ');
  const spendValues = sources.spendRows.map((row) => Number(row.spend) || 0);
  const leadValues = sources.spendRows.map((row) => Number(row.leads) || 0);
  const hasSpend = sources.spendRows.length > 0;
  const spendSample = sources.sampleConnector && hasSpend;
  const spend = hasSpend ? roundNum(spendValues.reduce((a, b) => a + b, 0)) : null;
  const leads = hasSpend ? roundNum(leadValues.reduce((a, b) => a + b, 0)) : null;
  const cpl = spend != null && leads != null && leads > 0 ? roundNum(spend / leads) : null;
  const spendNote = !hasSpend
    ? 'No spend rows are on the snapshot. Miles will not invent a number.'
    : spendSample
      ? 'SAMPLE. Example spend from the preview connector. Not this account\'s live ads.'
      : `From the spend snapshot${sources.spendReadAt ? ` read ${clean(sources.spendReadAt, 40)}` : ''}.`;

  let booked: SnapshotNumber;
  if (sources.bookedFromJobs != null) {
    booked = {
      value: sources.bookedFromJobs,
      sample: false,
      note: 'From jobs marked on this account.',
    };
  } else if (sources.bookedFromDeals != null && sources.sampleConnector) {
    booked = {
      value: sources.bookedFromDeals,
      sample: true,
      note: 'SAMPLE. Example booked jobs from the preview connector. Not live jobs.',
    };
  } else if (sources.bookedFromDeals != null) {
    booked = {
      value: sources.bookedFromDeals,
      sample: false,
      note: 'Won deals on the spend snapshot.',
    };
  } else {
    booked = { value: null, sample: false, note: 'No booked jobs are on file.' };
  }

  const campaigns: SnapshotCampaign[] = [];
  const miles = sources.milesCampaign;
  if (miles && (miles.resource || miles.name)) {
    campaigns.push({
      source: miles.resource ? 'miles' : 'plan',
      resource: clean(miles.resource, 120) || null,
      name: clean(miles.name, 120) || null,
      status: clean(miles.status, 40) || 'unknown',
      lastReadback: clean(miles.lastReadback, 240) || null,
    });
  } else if (sources.plan) {
    campaigns.push({
      source: 'plan',
      resource: null,
      name: sources.plan.name || null,
      status: sources.plan.status || 'unknown',
      lastReadback: null,
    });
  }
  const journey = sources.journey;
  if (journey && journey.ownerId === sources.tenantId) {
    for (const row of journey.rows) {
      const resource = clean(row.resource, 120) || null;
      if (resource && campaigns.some((c) => c.resource === resource)) continue;
      if (!resource && !row.name) continue;
      campaigns.push({
        source: 'journey',
        resource,
        name: clean(row.name, 120) || null,
        status: clean(row.status, 40) || 'unknown',
        lastReadback: null,
      });
    }
  }

  const leadSample = sources.sampleConnector && sources.leads.length > 0;
  const caps = sources.caps
    ? {
        dailyBudget: Number(sources.caps.dailyBudget) || 0,
        maxChangePct: Number(sources.caps.maxChangePct) || 0,
        monthlyCeiling: Number(sources.caps.monthlyCeiling) || 0,
        paused: !!sources.caps.paused,
      }
    : null;

  return {
    tenantId: sources.tenantId,
    business: {
      name: clean(p.businessName, 120),
      trade: clean(p.industry, 80),
      location,
      services: clean(p.services, 240),
      website: clean(p.website, 180),
      gbp: clean(sources.completeness.gbp, 180) || clean(p.gbpUrl, 180),
      phone: clean(p.phone, 40),
      completeness: {
        percent: sources.completeness.percent,
        filled: sources.completeness.filled,
        total: sources.completeness.total,
      },
      missing: sources.completeness.missing.map((item) => clean(item, 80)).filter(Boolean).slice(0, 12),
    },
    miles: {
      phase: clean(sources.phase, 40) || 'crawl',
      mode: sources.mode,
      paused: !!caps?.paused,
      caps,
      tracking: sources.tracking,
      plan: sources.plan,
    },
    campaigns: campaigns.slice(0, 8),
    performance: {
      spend: { value: spend, sample: spendSample, note: spendNote },
      leads: {
        value: leads,
        sample: spendSample,
        note: numberNote(spendSample, leads, 'Lead count from the spend snapshot (platform conversions).', 'No lead count is on the spend snapshot.'),
      },
      cpl: {
        value: cpl,
        sample: spendSample && cpl != null,
        note: cpl == null
          ? 'Cost per lead needs both spend and leads.'
          : numberNote(spendSample, cpl, 'Cost per lead from the spend snapshot.', ''),
      },
      bookedJobs: booked,
      rows: sources.spendRows.slice(0, 8).map((row) => ({
        name: clean(row.name, 80),
        platform: clean(row.platform, 40),
        spend: roundNum(Number(row.spend) || 0),
        leads: roundNum(Number(row.leads) || 0),
        sample: spendSample,
      })),
    },
    integrations: {
      google: {
        oauth: sources.google.oauth,
        ready: sources.google.ready,
        customerId: sources.google.ready ? sources.google.customerId : null,
        note: clean(sources.google.note, 300),
        error: clean(sources.google.error, 300) || null,
      },
      ghl: { connected: sources.ghl.connected, detail: clean(sources.ghl.detail, 240) },
      speedToLead: sources.speedToLead,
      meta: { status: 'coming_later', note: META_NOTE },
      social: sources.social,
      automations: sources.automations,
    },
    events: sources.events.slice(0, 6).map((event) => ({ ts: clean(event.ts, 40), text: clean(event.text, 180) })),
    changeLog: sources.changeLog.slice(0, 6).map((entry) => ({ ts: clean(entry.ts, 40), kind: clean(entry.kind, 40), title: clean(entry.title, 160) })),
    inbox: sources.inbox.slice(0, 6).map((row) => ({
      id: clean(row.id, 40),
      kind: clean(row.kind, 40),
      title: clean(row.title, 120),
      reason: clean(row.reason, 180),
    })),
    leads: sources.leads.slice(0, 6).map((lead) => ({
      name: clean(lead.name, 80) || undefined,
      service: clean(lead.service, 80) || undefined,
      source: clean(lead.source, 80) || undefined,
      createdAt: clean(lead.createdAt, 40) || undefined,
      contacted: lead.contacted === true,
      sample: leadSample,
    })),
  };
}

function money(n: number): string {
  const rounded = roundNum(n);
  return Number.isInteger(rounded) ? `$${rounded}` : `$${rounded.toFixed(2)}`;
}

function numText(n: SnapshotNumber, asMoney = false): string {
  if (n.value == null) return 'none';
  const shown = asMoney ? money(n.value) : String(n.value);
  return n.sample ? `SAMPLE ${shown}` : shown;
}

/** Plain text pasted into the system prompt. Sample figures keep the SAMPLE label. */
export function renderSnapshot(snapshot: AccountSnapshot): string {
  const b = snapshot.business;
  const lines: string[] = [];
  lines.push(`Account: ${b.name || 'unnamed business'}.`);
  lines.push(`Trade: ${b.trade || 'not set'}. Location: ${b.location || 'not set'}. Services: ${b.services || 'not set'}.`);
  lines.push(`Website: ${b.website || 'not set'}. Google Business Profile: ${b.gbp || 'not set'}. Phone: ${b.phone || 'not set'}.`);
  lines.push(`Profile completeness: ${b.completeness.percent}% (${b.completeness.filled} of ${b.completeness.total}). Missing: ${b.missing.length ? b.missing.join(', ') : 'none'}.`);
  const caps = snapshot.miles.caps;
  const modeLabel = snapshot.miles.mode === 'automate' ? 'Do everything' : snapshot.miles.mode === 'manual' ? 'Ask me first' : snapshot.miles.mode === 'hybrid' ? 'Hybrid' : 'not set';
  lines.push(`Miles phase: ${snapshot.miles.phase}. Mode: ${modeLabel}. Kill switch: ${snapshot.miles.paused ? 'on, Miles is paused' : 'off'}.`);
  lines.push(caps
    ? `Caps: ${money(caps.dailyBudget)}/day, max change ${caps.maxChangePct}% a day, monthly ceiling ${money(caps.monthlyCeiling)}.`
    : 'Caps: not set. Miles will not spend until a daily cap, max change, and monthly ceiling are saved.');
  const tracking = snapshot.miles.tracking;
  lines.push(tracking
    ? `Tracking proof: lead conversion ${tracking.leadConversion ? 'yes' : 'no'}, GA4 linked ${tracking.ga4Linked ? 'yes' : 'no'}${tracking.method ? `, method ${tracking.method}` : ''}.`
    : 'Tracking proof: not on file. Lead conversion and GA4 are not confirmed.');
  const plan = snapshot.miles.plan;
  lines.push(plan
    ? `Plan spec: ${plan.name || 'untitled'}, ${money(plan.dailyBudget)}/day, status ${plan.status}, landing ${plan.finalUrl || 'not set'}, locations ${plan.locations.join(', ') || 'not set'}, bidding ${plan.bidding || 'not set'}.`
    : 'Plan spec: none saved.');
  if (!snapshot.campaigns.length) {
    lines.push('Campaigns on file: none. No resource, no status, no read-back.');
  } else {
    lines.push('Campaigns on file:');
    for (const campaign of snapshot.campaigns) {
      lines.push(`- ${campaign.source}: ${campaign.name || 'untitled'}, status ${campaign.status}, resource ${campaign.resource || 'none'}. Last read-back: ${campaign.lastReadback || 'none stored'}.`);
    }
  }
  lines.push(`Spend snapshot: spend ${numText(snapshot.performance.spend, true)}. Leads ${numText(snapshot.performance.leads)}. Cost per lead ${numText(snapshot.performance.cpl, true)}. ${snapshot.performance.spend.note}`);
  if (snapshot.performance.rows.length) {
    const rows = snapshot.performance.rows.map((row) => `${row.sample ? 'SAMPLE ' : ''}${row.name} (${row.platform}) ${money(row.spend)} spend, ${row.leads} leads`);
    lines.push(`Spend rows: ${rows.join('; ')}.`);
  }
  lines.push(`Booked jobs: ${numText(snapshot.performance.bookedJobs)}. ${snapshot.performance.bookedJobs.note}`);
  const google = snapshot.integrations.google;
  const googleId = google.ready && google.customerId ? `Customer id ${google.customerId} is resolved.` : 'Customer id is not resolved.';
  lines.push(`Google Ads: ${google.oauth ? 'signed in' : 'not connected'}. Ready: ${google.ready ? 'yes' : 'no'}. ${googleId} ${google.error || google.note || ''}`.trim());
  lines.push(`GoHighLevel: ${snapshot.integrations.ghl.connected ? 'connected' : 'not connected'}. ${snapshot.integrations.ghl.detail}`);
  const stl = snapshot.integrations.speedToLead;
  lines.push(`Speed-to-lead: ${stl.enabled ? 'on' : 'off'}. Can send: ${stl.canSend ? 'yes' : 'no'}. Today ${stl.today}, total ${stl.total}, held ${stl.held}.`);
  lines.push(`Meta: ${snapshot.integrations.meta.note}`);
  const social = snapshot.integrations.social;
  lines.push(`Social and profile connections: Facebook ${social.facebook ? 'connected' : 'not connected'}, Instagram ${social.instagram ? 'connected' : 'not connected'}, LinkedIn ${social.linkedin ? 'connected' : 'not connected'}, Google Business Profile link ${social.gbp ? 'connected' : 'not connected'}.`);
  lines.push(`Automations: no-show recovery ${snapshot.integrations.automations.noShow ? 'on' : 'off'}, new-customer onboarding ${snapshot.integrations.automations.onboarding ? 'on' : 'off'}.`);
  lines.push(snapshot.events.length ? `Recent Miles events: ${snapshot.events.map((event) => `${event.ts} ${event.text}`).join(' | ')}` : 'Recent Miles events: none.');
  lines.push(snapshot.changeLog.length ? `Change log: ${snapshot.changeLog.map((entry) => `${entry.ts} ${entry.kind} ${entry.title}`).join(' | ')}` : 'Change log: none.');
  lines.push(snapshot.inbox.length ? `Queued approvals: ${snapshot.inbox.map((row) => `${row.title} (${row.reason})`).join(' | ')}` : 'Queued approvals: none.');
  if (!snapshot.leads.length) lines.push('Recent leads: none.');
  else {
    const sample = snapshot.leads.some((lead) => lead.sample);
    lines.push(`${sample ? 'SAMPLE recent leads (example rows, not a live CRM): ' : 'Recent leads: '}${snapshot.leads.map((lead) => `${lead.name || 'unnamed'}, ${lead.service || 'no service'}, ${lead.source || 'no source'}, ${lead.contacted ? 'contacted' : 'not contacted'}`).join('; ')}.`);
  }
  return lines.join('\n');
}
