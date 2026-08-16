# Miles AI — Pricing Model v1
### Working document from pricing debate, August 15, 2026. v1.3 — adds spend verification, onboarding, cancellation/refunds, benchmark data labeling. All questions closed. Phase-two items marked ⏸.

---

## 1. Market anchors (verified August 2026)

| Player | Segment | Price | Model | What it tells us |
|---|---|---|---|---|
| Viktor | Horizontal AI employee (Slack) | $100 free credits, then $50/mo for 20K credits, ladder to $300+ | Credit-metered, workspace-based | Sets the "AI employee should be ~$50–100" anchor. Reviews say real spend lands $150–400/mo once usage climbs. |
| Okara (AI CMO) | Horizontal AI marketing | Free (20 credits) → $99/mo, $66/mo annual | Flat + credits | Direct price collision if Miles lands at $99. |
| Avoca | Vertical AI front office, home services | ~$1,000–$3,500/mo, per-minute, quote-only | Usage-metered, enterprise | Sets the "serious home services AI is four figures" anchor. |
| Netic | Vertical AI revenue engine, enterprise | Unpublished, sold on top of FSM | Enterprise contract | Not reachable by sub-$3M contractors. |
| Jobber / Housecall / QuoteIQ | Field service tooling | $30–$450/mo | Seat/plan | The "tools" price band contractors already budget for. |
| Agencies (the real competitor) | Managed paid media | 10–15% of spend or $1,000–$2,500/mo retainer | % of media | What the contractor is currently paying to get worse results. |

**Gap:** Nothing sits between $100 horizontal toys and $1,000+ vertical enterprise for a $500K–$3M contractor. That gap is Miles.

---

## 2. Settled positions

### ✅ 2.1 Launch offer (first 100 customers)
- $0 monthly fee. $100 in Miles credits, no expiry, no day-count. Burn it in a month or six months, either way.
- Real cost to Miles: ~$20 per account at current credit unit economics.
- Language: **"Launch offer — first 100 accounts."** Not "beta." Not "design partner program." They are customers receiving real value (benchmarks, optimization, lower CPL); the free tier is a promo, not a research exchange.
- **Condition (non-negotiable):** Terms of service from customer #1 grant Miles the right to use anonymized, aggregated account performance data for cross-account benchmarks. Retrofitting this after 100 accounts is a mess and any investor/acquirer will ask.
- **Caution on the pitch:** Lead with expertise ("built by someone who ran $30M+ across 50+ trades accounts"), not with "benchmarks from 500 accounts." Until Miles has its own volume, the benchmark data claim leans on prior-employer client data, which is a legal exposure. Expertise claim is safe; data-set claim is not, yet.

### ✅ 2.2 Paid tier metering: bundled credits, monitoring never metered (revised v1.2)
- Akhil's position, and it holds: Miles pays per token no matter what it charges. Pure flat pricing hands cost control to the heaviest user. Credits go on paid tiers.
- Guardrails so the meter doesn't kill usage:
  - **Monitoring is unmetered.** Daily reads (metric pulls, pacing checks, loser scans, alerts, dashboard) never draw credits. Contractors must never feel punished for letting Miles watch the account. These run on sub-$0.30/M models and are cheap enough to eat.
  - **Credits draw only on work:** campaign builds, ad copy / creative generation, weekly readouts, channel comparisons, budget-shift proposals, deep analysis.
  - **Bundles are sized so a normal month never runs out.** Meter is present in the terms, invisible in practice.
  - **Auto top-up** at a fixed increment when the bundle empties, so nothing halts mid-optimization. Customer can cap top-ups or turn them off (Miles then pauses work items, not monitoring, until next cycle).
  - Unused credits roll one month, then expire.
- Credits denominated at retail, metered off real token cost × markup (Section 4.1). Routing stays invisible; margin is protected on every band and every top-up.

### ✅ 2.3 Paid tier structure: flat bands by ad spend under management, no percentage
- Rejected: $99/mo + credit top-ups (collides with Okara; prices Miles as a toy after arguing it is a hire).
- Rejected: $149 base + 10% of ad spend. Reasons: (a) percentage-of-media is the exact billing shape of every agency the contractor has fired, so Miles reads as an agency, not software; (b) it taxes the behavior Miles is supposed to unlock (scaling spend into winners); (c) it invites the "you make more for the same work" renewal fight.
- Adopted: **flat monthly price, tiered by total monthly ad spend across all connected platforms.** Revenue tracks value and cost of service, bill is predictable, no percentage language anywhere.

### ✅ 2.4 Band assignment and boundary behavior
- **Band is set on billing day from actual trailing-30-day spend** read from the connected platforms (Google Ads + LSA + Meta, summed). Not daily budget × 30: budgets are what was authorized, not what was spent (Google under-delivers on capped campaigns and can 2× on any single day; PMax and seasonal accounts swing).
- **New accounts with no history:** provisional band = sum of current daily budgets × 30, corrected at the next billing day once real spend exists.
- **Zero-spend accounts** land on Starter. Starter is the floor for every account, spend or not.
- Crossing a threshold mid-month does not change that month's bill; the account moves up on the next billing day.
- **Never auto-downgrade.** A dead February should not drop a plumber to Starter and bump him back in March. Downgrades are manual, on request, and take effect at the next billing day.
- Band assignment is logged with the spend figure used, so disputes are answerable in one screen.

## 3. Bands (✅ locked, v1.2)

| Band | Monthly ad spend under management | Monthly price | Credits included | Top-up | Rationale |
|---|---|---|---|---|---|
| Launch (first 100) | Any | $0 | $100 one-time, no expiry, hard cap | None — upgrade | Acquisition + benchmark seed |
| Starter | Under $5,000 (incl. $0) | **$149** | $50 retail credits/mo | $25 auto | Floor for every account, spend or not. Above the toy line, below tooling ceiling. |
| Growth | $5,000 – $15,000 | **$397** | $150 retail credits/mo | $50 auto | Agency retainer at this spend is $1,000–$1,500. |
| Scale | Over $15,000 | **$797** | $350 retail credits/mo | $100 auto | Agency is $2,000+ or 10%. Still cheaper. |

Every band: all seven skills, all connectors, unlimited users, all dashboards, unmetered monitoring. Bands differ by spend under management and credit bundle only. No feature gating.

Bundle sizing logic: at ~$0.20 real cost per $1 retail credit (Section 4.2), Starter's $50 bundle costs Miles ~$10 (margin ~93%), Growth's $150 ~$30 (~92%), Scale's $350 ~$70 (~91%). Top-ups sold at retail carry the same ~80% margin. Bundles are deliberately generous relative to expected work volume: a Starter account running two campaign builds, four weekly readouts and a channel comparison per month should sit well under $50 retail. If real usage data shows accounts routinely topping up, raise the bundle before raising the price.

Locked at $149 / $397 / $797. Entry sits inside the "tools" budget line contractors already carry; top band stays clearly under Avoca's floor. Anything above Scale is phase two (Section 5).

---

### ✅ 2.5 Conversion off the launch tier
- When the $100 in credits is exhausted, the account auto-enrolls into the band its ad spend implies. No hard stop (teaches them Miles is free), no permanent grandfathering (locks best-fit accounts at lowest ARPU).
- **Step-down:** first paid month is billed at Starter ($149) for everyone regardless of band. True band from month two.
- **Notice:** 14 days before the switch, in-app + email, showing exactly what Miles did and saved during the free period. Nobody sees an invoice they weren't warned about.
- Credits are a hard cap: burn $100 in a day and the account pauses until upgrade. Downside per free account is bounded.

### ✅ 2.6 Simplicity rule
Monthly only. No annual discount, no agency tier, no multi-location pricing, no percentage anywhere until Miles is past 100 paying customers. Goal in phase one is customer count, not ARPU optimization.

### ✅ 2.7 Onboarding
- **No setup fee, ever.** A fee adds friction at the exact point Miles is proving it has none versus an agency.
- Onboarding is conditional, not blanket. Miles tracks connection count during the launch/trial period. If an account has **fewer than 3 connections**, a persistent dashboard prompt appears: *"Book a 15-minute setup call with our founder or team and get this account set up properly."* Fully connected accounts never see it.
- **Day-3 email:** if still under 3 connections on day 3, one email from Miles with the call link. Not a drip; one email. Dashboard prompt stays up.
- Calls are 15 minutes, screen share, Miles-side drives. Unblock, not consulting.
- **Metric to track from day one:** connections completed by day 7. Expected to predict conversion better than anything else measurable early.
- Every call run is a note on what to automate; target is mostly self-serve by customer ~30 and no founder-run calls past ~20.

### ✅ 2.8 Cancellation and refunds
- **Cancel anytime**, effective end of the current billing period. Access and monitoring stay live through the paid period.
- **No refunds.** Reason stated plainly in the terms: credits are consumed compute and cannot be unspent. Not a policy that sounds stingy; a factual one.
- Unused bundle credits at cancellation expire with no cash value. Say so in the terms.
- No annual plans, so nothing pro-rated.

### ✅ 2.9 Benchmark data labeling
- Current benchmark tab is built from publicly scraped sources (incl. SearchLight's public site). There is no partnership and no agreement.
- **Do not name the source** on any customer-facing tab: it implies a relationship that doesn't exist. **Do not call it "our data"** either: it isn't, yet.
- Label: **"Industry benchmarks, aggregated from public sources."** Accurate, defensible, free.
- Internal note kept alongside the tab marking which figures are public-source vs. Miles-native, so sales claims later can be checked against provenance.
- Marketing claim to lead with is expertise, not data set: $30M+ across 50+ trades accounts is true and owned outright. The data-moat claim becomes true once Miles has its own account volume; ToS grants aggregated benchmark rights from customer #1 to make that happen.

---

## 4. Credit economics (the $100 free offer)

### 4.1 What a credit is
- Credits are denominated at **retail**, metered off **real token cost × markup**. Model routing (cheapest trusted model that clears the quality bar, per the routing spec already built) is invisible to the customer; margin is preserved regardless of which model runs, including manual model overrides.
- Reference point: Viktor and Marcus sell 20,000 credits for $50 → 1 credit = $0.0025 retail. "$100 free" = 40,000 credits at sticker.

### 4.2 What it costs Miles
| Assumption | Real cost of $100 retail credits |
|---|---|
| Everything on Sonnet-class ($3 in / $15 out per M via OpenRouter, +5.5% fee) | ~$95–100 (zero margin — never do this) |
| Standard AI-app gross margin (60–80%) | $20–40 |
| Aggressive routing: Flash/Haiku/open-weight for reads, Sonnet-class only for reasoning + writes | ~$15–20 |

Akhil's $20 assumption is at the optimistic end and holds **only if** the read/reason/write split is routed. Reads (metric pulls, pacing checks, loser scans) are the bulk of volume and must run on sub-$0.30/M models.

Blended token cost reference (~85% input / 15% output agent workload): Haiku-class ~$1.28/M, Sonnet-class ~$4.80/M, Opus-class ~$24/M. $100 at cost buys ~78M / ~21M / ~4.2M tokens respectively.

### 4.3 Exposure on the launch cohort
100 accounts × $20 real cost = **~$2,000 total** to seed 100 customers plus the benchmark data set. Worst case (poor routing) ~$4,000. Either number is trivial against the value of the first 100 accounts.

### 4.4 Paid-tier credits
Paid bands include a monthly credit bundle (Section 3). Monitoring never draws credits; work items do. Real cost per $1 retail credit is ~$0.20 with routing, so bundles are cheap for Miles and generous for the customer. Top-ups sold at retail. If real token cost on an account runs hot, first fix routing, then check whether the account belongs in a higher band; the meter is the backstop, not the first lever.

---

## 5. Deferred to phase two (⏸ revisit after 100 paying customers)

| Item | Sketch for when it's time |
|---|---|
| Agency / wholesale | Different product. Price per connected account (~$50–80/mo each, 10-account floor), not per spend. Decide first whether you want agencies at all: fast distribution vs. arming competitors with your benchmarks. |
| Multi-location / enterprise (e.g. 10-location plumber at $1M/mo spend) | Price **per location** at the location's band; above ~5 locations or ~$50K/mo spend becomes "contact us" with pilot + onboarding fee. Real blocker isn't price — it's references, security review, SLA. Don't chase until ~10 paying contractors + one multi-location logo exist. |
| Band above Scale | Either Scale → $997 or a fourth band above $30K/mo spend. Only matters once accounts that size actually show up. |
| Annual discount | Okara gives 4 months free. Cash-flow lever later. |

---

## 6. One-line summary
**Free for the first 100 ($100 in credits, hard cap, benchmark rights in ToS) → auto-enroll with 14-day notice, first month at $149 → bands by ad spend: $149 under $5K with $50 credits, $397 to $15K with $150, $797 above with $350. Monitoring unmetered; credits draw only on work; auto top-up. Band set on billing day from actual trailing-30 spend, never auto-downgraded. No setup fee; 15-min call offered to under-connected accounts + one day-3 email. Cancel anytime, no refunds (credits are consumed compute). All features on every band. Monthly only. Everything else waits until 100 paying.**
