/**
 * Campaign Playbook engine — turns a trade + offer into an expert, ready-to-run
 * paid-social build the way a veteran home-services media buyer would: unit
 * economics first (the math that sets the budget), an engineered offer (not a
 * naked discount), a segmented campaign architecture, a creative battery, an
 * instant-form spec, retargeting, and a weekly scorecard. Deterministic so it
 * always produces a full plan; the LLM can enrich the copy but never the logic.
 */

export interface PlaybookInput {
  offer?: string; // e.g. "$500 off a new roof"
  ticket?: number; // average job value
  financing?: boolean;
  zips?: string[];
  crm?: string;
  channel?: 'meta' | 'google';
}
export interface PlaybookCtx {
  business?: string;
  trade?: string;
  city?: string;
  services?: string;
  targetCpa?: number | null;
}

export interface AdSetPlan {
  name: string;
  segment: string;
  who: string;
  geo: string;
  dailyBudget: number;
  creative: string[];
}
export interface CampaignPlaybook {
  headline: string;
  trade: string;
  channel: 'meta' | 'google';
  economics: {
    ticket: number; marginPct: number; grossProfit: number; allowableCac: number;
    funnel: { contactRatePct: number; apptRatePct: number; showRatePct: number; closeRatePct: number; leadsPerSold: number };
    targetCplLow: number; targetCplHigh: number; testBudgetDaily: number; scaleBudgetDaily: number; monthlyTest: number;
  };
  offer: { engineered: string; deadline: string; reasonWhy: string; stack: string[]; financing: string | null; riskReversal: string[] };
  architecture: { prospecting: AdSetPlan[]; retargeting: AdSetPlan };
  instantForm: { intro: string; questions: string[]; completion: string };
  cadence: { launchChecklist: string[]; optimizeTriggers: string[]; scorecard: string[]; targets: string[] };
  surround: string[];
  notes: string[];
}

const round = (n: number) => Math.round(n);
const money = (n: number) => '$' + round(n).toLocaleString();

/** Per-trade economics + market CPL band (grounded in 2026 home-services data). */
const TRADE: Record<string, { ticket: number; margin: number; cplLow: number; cplHigh: number; season: string; segments?: 'roof' }> = {
  roofing: { ticket: 14000, margin: 0.4, cplLow: 45, cplHigh: 90, season: 'before storm season / before winter', segments: 'roof' },
  hvac: { ticket: 8000, margin: 0.35, cplLow: 40, cplHigh: 95, season: 'before the summer heat / winter freeze' },
  plumbing: { ticket: 1400, margin: 0.45, cplLow: 35, cplHigh: 80, season: 'year-round (lead with emergencies)' },
  painting: { ticket: 3500, margin: 0.4, cplLow: 40, cplHigh: 90, season: 'spring & fall repaint windows' },
  solar: { ticket: 25000, margin: 0.25, cplLow: 60, cplHigh: 140, season: 'before rate hikes / tax-credit deadlines' },
  electrical: { ticket: 1500, margin: 0.45, cplLow: 40, cplHigh: 95, season: 'year-round (panels & EV chargers trending)' },
  landscaping: { ticket: 4000, margin: 0.4, cplLow: 35, cplHigh: 85, season: 'spring cleanup & fall prep' },
};
function tradeKey(trade?: string): keyof typeof TRADE {
  const t = (trade || '').toLowerCase();
  return (Object.keys(TRADE) as (keyof typeof TRADE)[]).find((k) => t.includes(k.replace('ing', '')) || t.includes(k)) ?? 'roofing';
}

function engineerOffer(raw: string, financing: boolean, season: string): CampaignPlaybook['offer'] {
  const base = (raw || '$500 off a new roof').trim();
  const now = new Date();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const deadline = `${monthEnd.toLocaleString('en-US', { month: 'long' })} ${monthEnd.getDate()}`;
  return {
    engineered: `${base} — booked by ${deadline}`,
    deadline,
    reasonWhy: `We're filling our install calendar ${season} — that's the honest reason for the discount (roofing/home-services buyers are suspicious of naked discounts).`,
    stack: ['+ free 10-point inspection with photos', '+ free gutter cleaning with every install'],
    financing: financing ? 'Payments as low as ~$149/mo — the monthly-payment reframe is what actually moves five-figure decisions. Put it in every ad.' : 'No financing yet — get Service Finance / GreenSky / Hearth before scaling spend; on big-ticket trades it out-pulls the discount.',
    riskReversal: ['Licensed & insured (show the license #)', 'Multi-year workmanship warranty', 'Manufacturer certification badges (GAF / Owens Corning where applicable)', 'Real local crew — not a storm-chaser'],
  };
}

/** The math that sets the budget — work backwards from the job, never forwards. */
function economics(input: PlaybookInput, t: (typeof TRADE)[keyof typeof TRADE]): CampaignPlaybook['economics'] {
  const ticket = input.ticket && input.ticket > 0 ? input.ticket : t.ticket;
  const marginPct = t.margin;
  const grossProfit = ticket * marginPct;
  const allowableCac = round(grossProfit * 0.3); // ~30% of gross profit is a healthy CAC ceiling
  // Funnel WITH speed-to-lead (the whole plan assumes tight follow-up).
  const funnel = { contactRatePct: 65, apptRatePct: 45, showRatePct: 75, closeRatePct: 35, leadsPerSold: 0 };
  const l2c = (funnel.contactRatePct / 100) * (funnel.apptRatePct / 100) * (funnel.showRatePct / 100) * (funnel.closeRatePct / 100);
  funnel.leadsPerSold = Math.round(1 / l2c);
  const avgCpl = (t.cplLow + t.cplHigh) / 2;
  const monthlyTest = Math.max(3000, round((55 * avgCpl) / 100) * 100); // ~40–70 leads/mo
  const testBudgetDaily = round(monthlyTest / 30 / 10) * 10;
  return { ticket, marginPct, grossProfit, allowableCac, funnel, targetCplLow: t.cplLow, targetCplHigh: t.cplHigh, testBudgetDaily, scaleBudgetDaily: testBudgetDaily * 2, monthlyTest };
}

function architecture(input: PlaybookInput, ctx: PlaybookCtx, t: (typeof TRADE)[keyof typeof TRADE], eco: CampaignPlaybook['economics'], offer: CampaignPlaybook['offer']): CampaignPlaybook['architecture'] {
  const city = ctx.city || 'your metro';
  const zips = input.zips && input.zips.length ? input.zips.join(', ') : `your service-area ZIPs (use Market Map to pick the owner-occupied, higher-affluence ones)`;
  const dealHook = offer.engineered;
  const trade = ctx.trade || 'roofing';
  const prospecting: AdSetPlan[] =
    t.segments === 'roof'
      ? [
          { name: 'Pitched / Shingle — suburbs', segment: 'Pitched (replacement-cycle, higher ticket)', who: 'Homeowners 30–65+, both genders (don’t cap seniors — they own outright & close highest)', geo: `Suburban/collar ZIPs: ${zips}`, dailyBudget: Math.round(eco.testBudgetDaily * 0.5), creative: ['Owner-on-camera (offer + reason-why + financing)', 'Before/after carousel with neighborhood names', 'Static: crew-on-roof + offer + trust bar'] },
          { name: 'Flat / Rubber — city rowhomes', segment: 'Flat (leak-driven, price-sensitive, landlords)', who: 'Homeowners 28–65+ + small landlords (add Real-estate-investing interest)', geo: `Rowhome ZIPs: ${zips}`, dailyBudget: Math.round(eco.testBudgetDaily * 0.35), creative: ['Problem-aware video (ceiling stain → "your flat roof is leaking")', 'Static: rowhome block aerial + offer', 'Educational Reel: coating vs. replacement (honest read)'] },
        ]
      : [
          { name: `${trade} — core prospecting`, segment: `${trade} replacement/repair`, who: 'Homeowners 30–65+, both genders, geo is the homeowner filter', geo: `Owner-heavy ZIPs: ${zips}`, dailyBudget: Math.round(eco.testBudgetDaily * 0.85), creative: ['Owner-on-camera (offer + reason-why' + (input.financing ? ' + financing' : '') + ')', 'Before/after carousel (real local jobs)', `Static: job-site photo + "${dealHook}" + trust bar`] },
        ];
  return {
    prospecting,
    retargeting: { name: 'Retargeting — warm', segment: 'Video viewers + engagers + form-abandons + site visitors', who: 'Everyone who touched you (exclude past customers & open leads)', geo: `Same ZIPs, "people living in"`, dailyBudget: Math.max(20, Math.round(eco.testBudgetDaily * 0.15)), creative: ['Testimonial/porch video', 'Objection-crusher: "what a ' + trade + ' job actually costs here, honestly"', `Deadline: "${offer.engineered.split('—')[1]?.trim() || 'offer ends soon'}"`] },
  };
}

export function buildPlaybook(input: PlaybookInput, ctx: PlaybookCtx): CampaignPlaybook {
  const key = tradeKey(ctx.trade);
  const t = TRADE[key] ?? TRADE.roofing!;
  const channel = input.channel === 'google' ? 'google' : 'meta';
  const eco = economics(input, t);
  const offer = engineerOffer(input.offer || '', !!input.financing, t.season);
  const arch = architecture(input, ctx, t, eco, offer);
  const crm = input.crm || ctx.services && '' || 'your CRM';
  return {
    headline: `${ctx.business || 'Your'} ${key} — ${channel === 'meta' ? 'Meta' : 'Google'} campaign build`,
    trade: key,
    channel,
    economics: eco,
    offer,
    architecture: arch,
    instantForm: {
      intro: `Claim ${(offer.engineered.split('—')[0] || offer.engineered).trim()} + free inspection. Next: 1) quick call to schedule, 2) free inspection with photos, 3) written quote — discount if booked by ${offer.deadline}.`,
      questions: [
        'Do you own this home? (Yes / No, I rent) — the single highest-value filter',
        t.segments === 'roof' ? 'Roof type? (Flat/rubber / Shingle / Not sure) — routes the lead & tells sales what truck to send' : `Which service? (${(ctx.services || 'repair / replacement / maintenance').split(',')[0]})`,
        'How soon? (ASAP–2 weeks / 1–3 months / Just researching) — tag researchers for nurture, don’t disqualify',
        'Roughly how old is it? (0–10 / 10–20 / 20+ / No idea)',
        'Best phone number (typed, not prefilled) — a manually typed phone is the strongest quality signal a form can capture',
      ],
      completion: `You're booked for a callback! We'll call from your tracking number within 15 minutes during business hours — save it so you don't miss us.`,
    },
    cadence: {
      launchChecklist: ['Pixel + CAPI firing & deduplicating (Test Events)', `Test lead flows Form → ${crm} → SMS in under 60s (test it twice)`, 'Tracking number live + missed-call text-back', 'Suppression lists attached (past customers, open leads, employees)', 'Submit ads 24h early — financing language can trip a false "financial services" flag; appeal clears it', 'Page admin ready to answer comments (comments are conversions locally)'],
      optimizeTriggers: ['Days 1–3: touch nothing — every edit resets learning', 'Day 4–7: first read — CPL by ad set, CTR ≥1.5%, CPM $18–$35, form open→submit ≥30%, and the sales team’s quality verdict', 'Kill only ads with spend > 3× target CPL and zero leads', 'Refresh creative when frequency > 2.5–3.0, CTR down 25% from peak, or CPL creeps 3 weeks straight', 'Scale winners ~20% every 3–4 days (bigger jumps reset learning)', 'Month 2: switch to "Conversion Leads" once the CRM passes Appointment-Set back through CAPI — cuts junk-lead rate 20–40%'],
      scorecard: ['Spend', 'Leads', 'CPL', 'Contact rate', 'Appointments', 'Cost/Appt', 'Appts sat', 'Jobs sold', 'CAC', 'Revenue booked', 'ROAS'],
      targets: [`CPL ≤ ${money(t.cplHigh)}`, 'Contact rate ≥ 65%', 'Cost/appt ≤ $250', `CAC ≤ ${money(eco.allowableCac)}`, 'Booked ROAS ≥ 8x'],
    },
    surround: ['Run Google LSA + Search in parallel — Meta creates demand that converts through Google; judge blended CAC', 'Google Business Profile: weekly job photos + a post-install review ask (every Meta lead Googles you first)', 'Seed finished-job posts in Nextdoor + local FB groups in the exact ZIPs you’re paying to reach — free frequency'],
    notes: [
      'The metric that decides everything is cost per APPOINTMENT, not cost per lead — a $45 CPL that sets 15% loses to a $75 CPL that sets 40%.',
      'The #1 failure mode is the follow-up gap: leads called in under 5 min convert ~8x vs. after 30. Ads get blamed; the corpse is in the CRM.',
      'Start on Instant Forms (2–3x cheaper CPL); add website-form leads in Week 4–6 and let blended cost-per-appointment pick the mix.',
    ],
  };
}
