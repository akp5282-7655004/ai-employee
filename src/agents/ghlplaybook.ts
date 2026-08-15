/**
 * GoHighLevel Automation Playbook — encodes a veteran operator's 32-recipe
 * workflow library into Miles, tailored to the shop's trade. Honest scope: GHL's
 * workflow *builder* isn't fully API-exposed, so Miles can't silently create these
 * inside a customer's GHL account. Instead it hands over each recipe ready to
 * build (trigger → steps → timing), orders them by ROI, tailors the copy/seasonal
 * timing to the trade, and flags the ones Miles already runs natively through the
 * connected stack (speed-to-lead, review requests, nurture, the daily digest).
 */

export interface GhlRecipe {
  n: number;
  title: string;
  section: string;
  trigger: string;
  steps: string[];
  timing?: string;
  notes?: string;
  /** Miles has a native agent that performs this job through the connected stack. */
  milesRuns?: boolean;
  milesTask?: string;
}
export interface GhlPlaybook {
  business: string;
  trade: string;
  season: { peak: string; note: string };
  sections: string[];
  recipes: GhlRecipe[];
  buildOrder: { week: string; focus: string; recipes: number[] }[];
  globalRules: string[];
  milesRunsCount: number;
}

const SEASON: Record<string, { peak: string; note: string }> = {
  roofing: { peak: 'March (storm season) & October', note: 'Fire the reactivation + seasonal campaigns ahead of spring storms and before winter.' },
  hvac: { peak: 'April (AC) & September (heat)', note: 'Two peaks a year — pre-book tune-ups the month before each.' },
  plumbing: { peak: 'November (winterization)', note: 'Lead with emergencies year-round; push winterization in the fall.' },
  electrical: { peak: 'Year-round (panels & EV chargers)', note: 'Steady demand; spike campaigns around storm outages.' },
  painting: { peak: 'Spring & fall repaint windows', note: 'Book exterior work ahead of the dry seasons.' },
  solar: { peak: 'Before rate hikes / tax-credit deadlines', note: 'Anchor campaigns to utility rate changes and incentive deadlines.' },
  landscaping: { peak: 'Spring cleanup & fall prep', note: 'Anniversary + seasonal recipes drive the recurring revenue.' },
  'garage doors': { peak: 'January (cold snaps break springs)', note: 'Spike outreach during the first hard freeze.' },
};

function tradeKey(trade?: string): keyof typeof SEASON {
  const t = (trade || '').toLowerCase();
  return (Object.keys(SEASON) as (keyof typeof SEASON)[]).find((k) => t.includes(k.split(' ')[0]!.replace('ing', ''))) ?? 'roofing';
}

// The 32 recipes. [Company] and [service] are filled with the shop's real values;
// GHL merge fields ({{...}}) and other [placeholders] are left for the owner.
const RECIPES: GhlRecipe[] = [
  { n: 1, section: 'Speed to Lead', title: 'Instant Lead Response (The 5-Minute Rule)', trigger: 'Form Submitted / Facebook Lead Form / Survey Submitted', steps: ['Add tag: new-lead + source tag (fb-lead, gmb-lead, website-lead)', 'Wait 1 minute', 'SMS: "Hi {{contact.first_name}}, this is [Name] from [Company]. Got your request about [service] — are mornings or afternoons better for a quick call?"', 'Wait 2 minutes', 'Internal notification to sales rep (SMS + app push)', 'Email: confirmation with company info, reviews link, what happens next', 'If no reply in 15 min → trigger call attempt via Power Dialer or manual task'], timing: 'First touch inside 1 minute', notes: 'Conversion drops ~80% after the first 5 minutes. End with a binary question (mornings/afternoons) that’s easy to answer.', milesRuns: true, milesTask: 'speed_to_lead' },
  { n: 2, section: 'Speed to Lead', title: 'Missed Call Text-Back', trigger: 'Call Status = Missed (Incoming)', steps: ['Wait 30 seconds', 'SMS: "Sorry we missed your call! This is [Company]. How can we help — reply here or we’ll call you right back."', 'Add tag: missed-call', 'Create task for front desk: "Return missed call — {{contact.name}}"', 'If reply received → remove from workflow, notify team', 'If no reply in 2 hours → second SMS: "Still want to reach us? We’re open until [time] today."'], timing: '30-second text-back', notes: 'The single highest-ROI automation in GHL for local businesses — most shops miss 20–30% of inbound calls.', milesRuns: true, milesTask: 'speed_to_lead' },
  { n: 3, section: 'Speed to Lead', title: 'Web Chat Widget to SMS Bridge', trigger: 'Customer Replied (channel = Live Chat) with phone captured', steps: ['Auto-reply in widget: "Thanks! We’ll text you at {{contact.phone}} in under 2 minutes."', 'SMS from assigned user: continue the conversation over text', 'Add tag: chat-lead', 'Assign to on-call rep round-robin'], notes: 'Gets the conversation off the website (where they leave) onto SMS (where they answer for days).' },
  { n: 4, section: 'Speed to Lead', title: 'GMB Message Auto-Responder', trigger: 'Customer Replied (channel = GMB)', steps: ['Instant reply: "Thanks for reaching out on Google! What service are you looking for and what’s your zip code?"', 'Notify assigned user', 'Add tag: gmb-message-lead'], notes: 'Google measures response time and shows it publicly — sub-1-minute responses improve GMB conversion.' },
  { n: 5, section: 'Lead Nurture & Follow-Up', title: 'No-Response Lead Nurture (14-Day Sequence)', trigger: 'Tag added new-lead AND no appointment booked', steps: ['Day 0: Instant response (recipe #1)', 'Day 1 AM: SMS — "Quick question {{contact.first_name}} — still need help with [service]?"', 'Day 2: Email — social proof (before/after photos, review screenshots)', 'Day 4: SMS — "We had a cancellation this week — want the slot?"', 'Day 7: Email — objection handler ("What does [service] actually cost?")', 'Day 10: SMS — "Should I close your file?"', 'Day 14: Email — "We’ll be here when you’re ready" + booking link'], timing: '14 days', notes: 'Exit on: replied, appointment booked, or do-not-contact. The Day 10 "should I close your file" message routinely outpulls everything before it.', milesRuns: true, milesTask: 'lead_followup' },
  { n: 6, section: 'Lead Nurture & Follow-Up', title: 'Long-Term Nurture (6-Month Drip)', trigger: 'Tag not-ready, or 14-day sequence finished with no conversion', steps: ['Move pipeline stage to "Long-Term Nurture"', 'Every 3 weeks: alternating value email (seasonal tips, project spotlights, offers)', 'Monthly SMS check-in (rotate 6 templates so nothing repeats)', 'On reply → notify rep, move to "Re-Engaged" stage, exit drip'], notes: 'Tag by service interest so seasonal campaigns (recipe #22) can target precisely.' },
  { n: 7, section: 'Lead Nurture & Follow-Up', title: 'Appointment No-Show Recovery', trigger: 'Appointment Status = No-Show', steps: ['Wait 10 minutes', 'SMS: "Hey {{contact.first_name}}, looks like we missed each other. Want me to grab you another time? {{calendar.link}}"', 'Wait 1 day → email with reschedule link', 'Wait 2 days → SMS: "Last check — should I keep your quote active?"', 'If rebooked → confirmation flow; if not → long-term nurture'], notes: '30–50% of no-shows rebook if contacted within the hour.', milesRuns: true, milesTask: 'lead_followup' },
  { n: 8, section: 'Lead Nurture & Follow-Up', title: 'Quote Follow-Up (Unsigned Estimate Chase)', trigger: 'Pipeline stage changed to "Quote Sent"', steps: ['Hour 2: Email — quote recap + link', 'Day 1: SMS — "Any questions on the numbers I sent over?"', 'Day 3: SMS — value add: financing options / warranty details', 'Day 5: Call task for rep', 'Day 7: SMS — scarcity: "That price is good through [date] — want me to lock it in?"', 'Day 10: Email — case study of a similar completed job', 'Day 14: Move to "Quote — Stale", notify manager for pricing review'], notes: 'For jobs over ~$5K, insert a rep call at day 2 instead of relying on SMS alone.', milesRuns: true, milesTask: 'lead_followup' },
  { n: 9, section: 'Lead Nurture & Follow-Up', title: 'Failed Payment / Declined Card Recovery', trigger: 'Payment Failed (invoice or subscription)', steps: ['Instant email: "Your payment didn’t go through — update here: [link]"', 'Wait 1 day → SMS with payment link', 'Wait 3 days → task for office manager to call', 'Wait 7 days → pause-service tag + escalation notification'], notes: 'Most declines are expired cards, not intent. Keep tone light on the first two touches.' },
  { n: 10, section: 'Appointment & Booking', title: 'Appointment Confirmation + Reminder Stack', trigger: 'Appointment Booked (any calendar)', steps: ['Instant SMS + email confirmation with date, time, tech name, prep instructions', '48 hours before: email reminder', '24 hours before: SMS — "Reply C to confirm or R to reschedule"', 'If "R" → send reschedule link, notify office', '2 hours before: SMS — "[Tech] is scheduled for your [time] appointment. He’ll text when he’s on the way."', 'Add to Google Calendar via integration'], notes: 'The C/R reply mechanic cuts no-shows dramatically vs. passive reminders.' },
  { n: 11, section: 'Appointment & Booking', title: 'Tech En-Route Notification', trigger: 'Manual — tech taps trigger link, or stage moves to "En Route"', steps: ['SMS: "{{custom.tech_name}} is on the way! ETA: {{custom.eta}}. Here’s his photo: [link]"', 'Optional review-priming line: "After your visit you’ll get a quick 2-question survey."'], notes: 'Trigger links let field techs fire this from their phone with one tap.' },
  { n: 12, section: 'Appointment & Booking', title: 'Round-Robin Lead Distribution', trigger: 'Tag added new-lead', steps: ['Assign user (round-robin across sales team)', 'Notify assigned user (push + SMS)', 'Wait 5 minutes → if no call logged/task completed → reassign to next rep + notify manager'], notes: 'The 5-minute reassignment window creates internal speed-to-lead pressure.' },
  { n: 13, section: 'Appointment & Booking', title: 'Calendar Cancellation Backfill', trigger: 'Appointment Cancelled', steps: ['Notify office', 'SMS to contact: reschedule link', 'Trigger secondary workflow: SMS blast to 10 most recent quote-sent contacts — "We just had a [day] slot open up — want it?"'], notes: 'Turns dead calendar time into a scarcity-driven conversion trigger.' },
  { n: 14, section: 'Reviews & Reputation', title: 'Post-Job Review Request', trigger: 'Pipeline stage = "Job Complete" (or invoice paid)', steps: ['Wait 2 hours', 'SMS: "Thanks for choosing [Company]! How did we do, 1-10?"', 'If reply 9-10 → SMS with direct Google review link: "Amazing! Would you mind sharing on Google? Takes 30 seconds: [link]"', 'If reply 1-8 → alert manager, create task: "Service recovery call", do NOT send review link', 'No reply in 1 day → email version of the ask', 'No review in 3 days → one final SMS nudge'], notes: 'The 1-10 gate keeps unhappy customers off Google and routes them to recovery.', milesRuns: true, milesTask: 'review_responder' },
  { n: 15, section: 'Reviews & Reputation', title: 'Review Response Automation', trigger: 'New Google Review received (Reputation trigger)', steps: ['4-5 stars → auto-post templated response (rotate 5 templates), notify team', '1-3 stars → do NOT auto-respond; urgent task to owner + draft response for approval'], notes: 'Never auto-respond to negative reviews — a templated reply to an angry customer reads as dismissive.', milesRuns: true, milesTask: 'review_responder' },
  { n: 16, section: 'Reviews & Reputation', title: 'Referral Ask (Post-Review)', trigger: 'Tag added left-review (from recipe #14)', steps: ['Wait 7 days', 'SMS: "Since you had a great experience — know anyone else who needs [service]? We’ll send you a $[X] gift card for anyone who books."', 'Track via unique referral link or reply capture'], notes: 'Only ask people who already showed goodwill. Review first, referral second.' },
  { n: 17, section: 'Database Reactivation & Retention', title: 'Database Reactivation Campaign', trigger: 'Manual — bulk add tag reactivation to a dormant list (no activity 6+ months)', steps: ['SMS Day 1: "Hey {{contact.first_name}}, it’s [Name] from [Company]. We’re booking [season] [service] slots and you came to mind. Want a quote?"', 'If reply → notify team, move to active pipeline', 'Day 3 (no reply): "Totally fine if not — should I take you off the list?"', 'Day 7: final offer with deadline'], notes: 'Send in batches of 100–200/day to protect sender reputation. The "take you off the list" message forces a yes/no and cleans your database either way.' },
  { n: 18, section: 'Database Reactivation & Retention', title: 'Annual Service Anniversary', trigger: 'Custom date field last_service_date + 11 months', steps: ['SMS: "It’s been almost a year since your [service] — most customers book their annual [maintenance] around now. Want your old time slot?"', 'Email backup 2 days later with booking link', 'Tag annual-due for reporting'], notes: 'Works for tune-ups, gutter cleaning, roof inspections — any recurring service.' },
  { n: 19, section: 'Database Reactivation & Retention', title: 'Membership / Maintenance Plan Renewal', trigger: 'Custom field membership_expiry minus 30 days', steps: ['Day -30: Email — renewal notice + benefits recap ("you saved $X this year")', 'Day -14: SMS — one-click renewal link', 'Day -7: Call task', 'Day 0: lapse tag + win-back sequence entry'], notes: 'Lead with quantified savings, not features.' },
  { n: 20, section: 'Database Reactivation & Retention', title: 'Win-Back (Lost Customer)', trigger: 'Tag lost-customer or pipeline stage "Closed Lost"', steps: ['Wait 30 days (cooling period)', 'Email: "No hard feelings" + 1-question feedback survey', 'Wait 60 days → SMS with come-back offer', 'Wait 90 days → move to long-term drip'], notes: 'The feedback ask at day 30 recovers more customers than the discount at day 90 — people come back when they feel heard.' },
  { n: 21, section: 'Pipeline & Internal Ops', title: 'Stale Opportunity Alert', trigger: 'Opportunity in a stage longer than its limit (stage-duration trigger)', steps: ['Task to opportunity owner: "Deal stale — {{opportunity.name}}"', 'If still stale 3 days later → escalate to manager', 'If 14 days → auto-move to "Stale" + enter nurture'], notes: 'Suggested limits — New Lead: 1 day. Contacted: 3 days. Quote Sent: 7 days. Negotiation: 5 days.' },
  { n: 22, section: 'Pipeline & Internal Ops', title: 'Seasonal Campaign Launcher', trigger: 'Manual bulk tag by service interest (e.g. interest-hvac in April for AC season)', steps: ['3-touch sequence: SMS offer → email detail → SMS deadline', 'Route replies to round-robin', 'Auto-remove tag at campaign end'], notes: 'Time it to your trade’s peak season.' },
  { n: 23, section: 'Pipeline & Internal Ops', title: 'New Customer Onboarding', trigger: 'Pipeline stage = "Closed Won"', steps: ['Welcome SMS + email: what happens next, who’s coming, when', 'Internal: create job in field-service tool (webhook/Zapier/Make)', 'Add to customer list, remove all prospect nurtures', 'Set custom field last_service_date', 'Schedule review request (recipe #14) tied to job completion'], notes: 'The nurture-removal step is critical — nothing kills trust like a "still thinking about it?" SMS after they’ve paid.' },
  { n: 24, section: 'Pipeline & Internal Ops', title: 'Lead Source Attribution Tagging', trigger: 'Form/call/chat submitted (one workflow per source)', steps: ['Tag by source: src-gmb, src-fb, src-lsa, src-website, src-referral', 'Write source to a custom field for reporting', 'Set the opportunity source field'], notes: 'The foundation for every ROI report you’ll build. Do this before scaling spend.', milesRuns: true, milesTask: 'cpa_report' },
  { n: 25, section: 'Pipeline & Internal Ops', title: 'Task Escalation Chain', trigger: 'Task overdue by 24 hours', steps: ['Reminder to task owner', '+24 hours → notify manager', '+48 hours → reassign + flag in daily digest'], notes: 'Keeps follow-ups from dying in someone’s queue.' },
  { n: 26, section: 'Pipeline & Internal Ops', title: 'Daily Lead Digest', trigger: 'Schedule — daily 7:00 AM', steps: ['Internal email/SMS to owner: yesterday’s lead count by source, appointments booked, quotes sent, revenue closed'], notes: 'The "AI employee reports to the boss" pattern — Miles does this out of the box.', milesRuns: true, milesTask: 'morning_brief' },
  { n: 27, section: 'Paid Ads & Campaign Support', title: 'Facebook Lead Ad Instant Qualifier', trigger: 'Facebook Lead Form Submitted', steps: ['Instant SMS: "Thanks for your interest in [offer]! Quick question — what’s your zip code?"', 'Zip reply → check against service area', 'In area → book flow. Out of area → polite decline + tag out-of-area', 'No reply → 3-touch chase over 48 hours'], notes: 'FB leads are lower intent than search — the qualifying question doubles as engagement bait.', milesRuns: true, milesTask: 'speed_to_lead' },
  { n: 28, section: 'Paid Ads & Campaign Support', title: 'LSA (Local Services Ads) Call Handler', trigger: 'Incoming call from LSA tracking number', steps: ['Tag src-lsa', 'If missed → missed-call text-back (recipe #2) with LSA-specific copy', 'Log to LSA pipeline for dispute tracking (missed/invalid leads are refundable)'], notes: 'Tagging LSA calls separately lets you dispute junk leads and track true LSA cost-per-job.' },
  { n: 29, section: 'Paid Ads & Campaign Support', title: 'Retargeting Audience Sync', trigger: 'Tag added (quote-sent, no-show, closed-lost)', steps: ['Webhook → Meta Custom Audience via Make/Zapier (or native integration)', 'Sync tag removal on conversion so you stop paying to retarget customers'], notes: '"Quote sent but not closed" is the highest-converting retargeting audience in home services.' },
  { n: 30, section: 'Paid Ads & Campaign Support', title: 'Promo Code Redemption Tracker', trigger: 'Form with promo field / SMS keyword reply (e.g. text "SAVE50")', steps: ['Tag with the campaign code', 'Instant fulfillment SMS with offer details + booking link', 'Attribution report by tag'], notes: 'SMS keywords make offline media (radio, mailers, yard signs) trackable.' },
  { n: 31, section: 'Advanced / AI-Powered', title: 'AI Conversation Booking Bot', trigger: 'Any inbound SMS reply from a tagged lead', steps: ['GHL Conversation AI (or webhook → LLM) handles Q&A', 'Objective: book an appointment on the connected calendar', 'Handoff rules: pricing objections, complaints, or 3+ unclear turns → human takeover + notify rep', 'Tag all AI conversations ai-handled for QA review'], notes: 'Always set handoff rules before going live. Review transcripts weekly for the first month.' },
  { n: 32, section: 'Advanced / AI-Powered', title: 'Call Recording → Analysis Pipeline', trigger: 'Call Completed (with recording)', steps: ['Webhook fires the recording URL to an external processor (transcription → LLM analysis)', 'Analysis writes back to contact: sentiment, objections, booked Y/N, missed-upsell flags', 'Failed-booking calls with high intent → callback task + coaching flag for manager'], notes: 'Validate the scoring rubric on one client before productizing.' },
];

const BUILD_ORDER = [
  { week: 'Week 1', focus: 'Revenue leaks', recipes: [2, 1, 10] },
  { week: 'Week 2', focus: 'Conversion', recipes: [5, 8, 7] },
  { week: 'Week 3', focus: 'Reputation', recipes: [14, 15, 24] },
  { week: 'Week 4', focus: 'Money in the database', recipes: [17, 18, 13] },
];

const GLOBAL_RULES = [
  'Exit conditions on everything — replied, booked, or DNC exits all nurtures. Nothing burns trust like automation that ignores a reply.',
  'Quiet hours — enforce an 8 AM–8 PM local SMS window at the workflow-settings level.',
  'One workflow, one job — chain workflows with tags instead of building 60-step monsters. Easier to debug and clone.',
  'Tag taxonomy first — set a prefix system (src-, interest-, stage-, campaign-) before you build anything.',
  'A2P 10DLC compliance — register your brand/campaign before SMS volume, and include opt-out language on the first touch.',
  'Test with a seed contact — run yourself through every workflow before activating; check merge fields, links, and human-feeling timing.',
];

function fill(s: string, business: string, service: string, season: string): string {
  return s.replace(/\[Company\]/g, business).replace(/\[service\]/g, service).replace(/\[season\]/g, season);
}

export interface GhlPlaybookCtx {
  business?: string;
  trade?: string;
}

export function buildGhlPlaybook(ctx: GhlPlaybookCtx): GhlPlaybook {
  const business = (ctx.business || 'your company').trim();
  const key = tradeKey(ctx.trade);
  const service = (ctx.trade || 'your service').toLowerCase();
  const season = SEASON[key]!;
  const seasonWord = season.peak.split(' ')[0]!.toLowerCase();
  const recipes = RECIPES.map((r) => ({
    ...r,
    trigger: fill(r.trigger, business, service, seasonWord),
    steps: r.steps.map((st) => fill(st, business, service, seasonWord)),
    notes: r.notes ? fill(r.notes, business, service, seasonWord) : undefined,
  }));
  const sections = [...new Set(RECIPES.map((r) => r.section))];
  return {
    business,
    trade: key,
    season,
    sections,
    recipes,
    buildOrder: BUILD_ORDER,
    globalRules: GLOBAL_RULES,
    milesRunsCount: RECIPES.filter((r) => r.milesRuns).length,
  };
}
