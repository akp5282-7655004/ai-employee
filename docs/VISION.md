# Vision — the vertical AI marketing employee

> The category is "AI employee." The competitors (Viktor, Marcus, and the rest)
> all sell the same thing: a blank box wired to ~3,000 apps. We sell the opposite
> — a **pre-built specialist**. A plumber picks "Plumbing" and gets a marketing
> agent that already knows the playbook. Same engine behind every door; marketed
> through the vertical door where we win, not the crowded generic door where we
> don't.

This is the north star for a **new, standalone product** — not a rebrand of any
prior project. This document is the plan; the code is a fresh build.

---

## 1. What the business is

A horizontal AI marketing employee — you message it in plain English and it does
real marketing work: builds campaigns, runs ad budgets, optimizes spend, reports
outcomes. Structurally the same category as Viktor and Marcus.

The difference is the go-to-market, not the chassis. We do **not** ship a blank
prompt box. Every customer enters through a vertical they recognize and receives
a specialist that already knows their offers, economics, urgency profile, and
compliance rules. Home services first (the wedge), then adjacent trades, then
other local-service verticals.

**The one-line pitch:** *"Not an AI that can do marketing. A marketing employee
who already runs plumbing accounts."*

And it's **two-sided**: we ship the first specialists, but expert operators can
publish their own **skills** to a marketplace and get paid every time another
account installs one (§6). The engine is the chassis; the skills are the economy
on top of it.

---

## 2. The competitive landscape

### Viktor vs. Marcus — near-identical twins

| Axis | Viktor | Marcus (Zavo LTD) |
|------|--------|-------------------|
| Surfaces | Slack, Teams, email, web | Slack, Teams, email, web |
| Integrations | ~3,000 apps (Pipedream-style) | ~3,000 apps (Pipedream-style) |
| Pricing | Credit-based, ~$50/mo, $100 free, no sales call | Credit-based, ~$50/mo, $100 free, no sales call |
| Model choice | Pick your LLM (Claude/GPT/Gemini/Grok) | Pick your LLM |
| Lean | Slightly agency/ops, tighter approvals | Multi-surface team collab, enterprise compliance badges |

Functionally you couldn't slide a piece of paper between them. **That is the
signal:** the horizontal "AI employee" is already commoditized. Each new launch
makes the generic "AI does your marketing" pitch cheaper and less defensible.

### Why that's validation, not threat

All of them are generalists for teams that **already have** clean Salesforce or
HubSpot data and know what to type. A sub-$3M local business has neither. The gap
they structurally can't close cheaply — vertical playbooks, LSA/GBP expertise,
category-specific commands ready on day one — is exactly our wedge.

### Their landing pages are a swipe file worth studying

- The animated **multi-surface demo** (same task shown in Slack / Teams / email).
- Customer **proof tiles with hard numbers**.
- The **"start free, no sales call"** self-serve motion.

---

## 3. Architecture — chassis + packs

The strategic insight: don't choose horizontal vs. vertical. Use the **horizontal
engine as the chassis** and sell **verticalized packs** on top.

### Foundation (owned) vs. extensions (swappable)

| Layer | What | Ownership |
|-------|------|-----------|
| **Foundation** | Our dashboard, the agent engine, the command packs, the data | Proprietary core — the moat lives here |
| **Extensions** | CRMs (GoHighLevel, ServiceTitan, HubSpot), ad platforms (Google, Meta), the ~3,000-app long tail | Swappable plumbing behind connector seams |

We are **not** locked to anyone's ecosystem. Launch on Pipedream for integration
speed; bring the critical few connections native over time. The intelligence
lives on our infrastructure; every CRM/ad platform is plumbing behind a seam.

### Universal engine vs. command packs — the "four knobs"

Marketing psychology, the buying journey, funnel stages, and the free-front-door
offer structure are **universal** across every industry. A pack is not a rewrite
— it turns exactly four knobs:

| Knob | Example: Plumbing | Example: Dental |
|------|-------------------|-----------------|
| **Urgency** | Emergency, now (burst pipe) | Scheduled, considered (cleaning, whitening) |
| **Location / proximity** | Tight radius, "near me" dominant | Wider catchment, destination-tolerant |
| **Offer wording** | "$49 drain clear, same-day" | "$99 new-patient exam + X-rays" |
| **Economics + compliance** | Avg ticket, license claims, LSA rules | Avg patient value, health-claim / HIPAA rules |

Everything else — the agent loop, the claims checklist, the budget math, the
optimization logic — is shared engine. A new vertical is a data file plus a
compliance profile, not a new product.

### The pack format is the authoring surface

The command-pack shape (`src/packs/`) is deliberately the same surface a
marketplace creator authors a skill against (§6). Home services is the reference
pack; dental proves the pattern (a considered-purchase channel mix, dental
offers, and health-claim compliance the trades never see). The universal math
that turns those knobs into a channel mix / offer shortlist / compliance verdict
lives in `src/packs/apply.ts`.

---

## 4. The moat

The software is **not** the moat — anyone can build the chassis; Viktor and
Marcus already did. Five layers that compound:

1. **The playbooks.** Proven vertical campaign playbooks, deepest in home
   services. A customer launches a proven campaign in ~10 minutes; a copycat
   needs 10–20 hours to reverse-engineer a single static snapshot.
2. **The data network effect.** Every account feeds aggregated benchmarks that
   make every other account smarter. A competitor can copy today's playbook but
   can't reproduce a live, continuously-updating optimization loop without first
   having hundreds of accounts.
3. **The flywheel: start shared, refine private, learn collective.** The shared
   playbook is only the ignition. Post-launch, each account's optimization
   diverges into a unique fingerprint; the aggregated learning feeds back into
   smarter launches for everyone.
4. **Strategic-choice moat.** The horizontal giants likely won't verticalize —
   they don't want to become marketing experts in 50 industries. Our
   disadvantage (narrow) is the exact thing they won't copy.
5. **The marketplace flywheel (§6).** Creators publish skills, and because the
   skills run on our rails we measure their real lift. A creator's track record
   can't be ported elsewhere, and buyers trust rankings no static marketplace can
   fake. More accounts → better measurement → better ranking → more creators →
   more skills → more accounts.

---

## 5. Features

### Three trust meters

| Meter | What it shows | Problem it solves |
|-------|---------------|-------------------|
| **CPA/CPL range meter** | Low / median / high for your market, shown like a credit score or speedometer | Cold-start + expectation churn: sets outcomes as a *range*, never a promise |
| **Saturation / competitor meter** | Market density (census) + competitor spend | Discloses upfront why a hard market ramps in 6 months, not 90 days — turns hidden failure into an agreed condition |
| **Offer library** | Proven, seasonally-refreshed benchmark offers per vertical | Customers can't type a weak offer; they pick from what works |

### Intake validation

Customer states offer, location, budget, lead goal. The agent checks the math
against benchmarks and **pushes back on impossible asks** ("1,000 leads at $100
isn't possible").

### Diagnostic chatbot (wired to live campaign data)

Crawls the account, explains anomalies ("CPA doubled because quality score
dropped — we're fixing it"), offers one-click fixes, and messages proactively
during the learning phase. This collapses support cost toward zero and is what
makes **email-only support** viable at scale.

### Account-ownership model

The customer owns their own ad accounts, billing, and pages. The agent connects
in and operates. Clear terms + connection-health monitoring. We never hold the
customer's spend hostage.

---

## 6. The skills marketplace

A two-sided marketplace where expert operators publish **skills** and any account
installs them with one click. A skill is a packaged, runnable capability — e.g.
*"Facebook Ads Remarketing ROAS Booster," "Google LSA Dispute Recovery,"
"Seasonal HVAC Tune-Up Funnel."* User A (an agency or a top-performing operator)
authors it; User B (a business owner) buys it and it runs on their account.

This is the command-pack idea (§3) **opened to third parties**: we author the
first packs; the community authors the long tail. It's the app-store model on top
of the chassis — but for marketing skills that *execute*, not documents you read.

### Verified performance is the unfair advantage

Because we run the accounts, we measure a skill's **actual** lift across every
account that installs it. The marketplace ranks by *measured* results, not
seller-claimed hype.

> A listing that shouts *"increase your ROAS 700%"* is not a headline the seller
> gets to type. It's a number our data either **confirms and displays** or
> **refuses to show.** This is the same honesty guardrail as the claims checklist
> (§5), applied to the marketplace.

No competing marketplace can do this, because none of them run the accounts. We
turn the claims problem into the thing that makes our marketplace trustworthy.

### Economics & guardrails

- **Creators price skills** — one-time, subscription, or rev-share on measured
  lift. We take a marketplace cut (revenue stream #3, §7).
- **Every skill clears the same gates before listing** — the claims checklist and
  intake validation (§5) run on the skill itself.
- **Same-ZIP competitor guardrail** — a top-performing skill isn't sold to direct
  competitors in the same radius without variation or an operator cap.
- **Automatic quality floor** — skills that underperform their category benchmark
  across N accounts get flagged or delisted. The data enforces quality.

---

## 7. Revenue streams

1. **Core subscription** — the vertical AI marketing employee.
2. **Benchmark intelligence product** — "the top 10 campaigns working in plumbing
   in the Northeast right now, CPL by region, one-click copy." Structurally
   impossible for a horizontal player to build (no vertical-clustered data).
   - **Guardrail:** never hand the identical play to direct competitors in the
     same ZIP. Rotate variations or cap operators per radius.
3. **Marketplace take rate** — a cut of every skill sold (§6). Compounds with
   scale: more accounts → better measurement → better ranking → more creators →
   more skills → more accounts.

---

## 8. The build reality (clone cost & timeline)

Reference point for "should we just build a Viktor/Marcus?" — the answer is
**no, build this instead**, but the numbers are worth keeping honest.

- **Integrations are ~30% of the product.** Pipedream collapses them. The hard
  **70%** is the agent orchestration layer: read a plain-English request, plan
  multi-step actions, call tools in order, handle errors, wait for approvals,
  keep persistent per-workspace context, post back cleanly into Slack/Teams.
- **Hire a developer:** a rough working version (Slack + Pipedream + agent loop)
  ≈ **3–4 months** solo; a polished multi-tenant product with Teams, email,
  approvals, billing, security ≈ **6–9 months** with 1–2 engineers. At
  $8–15k/mo/contractor that's roughly **$40k–$110k**, plus ongoing AI + Pipedream
  usage.
- **Drive it with Claude Code:** a working Slack→Pipedream→agent-loop demo in a
  few weekends. **The trap:** the demo is easy; the reliability for paying
  strangers is the whole business, and that's where the months actually go.

**"Pretty easy" is a trap. The demo is easy. The reliability is the business.**

---

## 9. Naming

Working repo name is a placeholder (`ai-employee`). Going with a **male first
name** for fast credibility in a budget-running, decision-making role. Brand name
and chatbot voice kept separate.

**Shortlist to clear (domain + trademark):** Miles *(lead candidate)*, Sterling,
Vaughn, Beckett, Sawyer, Roman, Dalton, Hayes, Cole, Dexter, Griffin, Reed,
Nash, Emerson.

---

## 10. The seven objections — stress-tested and answered

| # | Objection | Answer |
|---|-----------|--------|
| 1 | Cold-start data | Trust meters frame outcomes as a market *range*, not a promise, from day one |
| 2 | Garbage input | Offer library + intake validation stop weak offers and impossible asks before launch |
| 3 | Account ownership | Customer owns accounts/billing/pages; agent connects in with clear terms |
| 4 | Pipedream dependency | Launch fast on Pipedream, bring the critical few native over time — it's one connector behind a seam |
| 5 | Support at scale | Diagnostic chatbot + proactive messaging collapse support toward email-only |
| 6 | Playbook / skill copying | A snapshot is copyable in 10–20h, but the *proof* isn't: a skill's track record is measured on our rails (§6) and can't be ported |
| 7 | Defensibility vs. giants | They won't verticalize into 50 industries — strategic-choice moat |

---

## 11. Open next steps

- [ ] Clear the name shortlist (domains + trademark).
- [x] Command-pack format + registry + two verticals (home services, dental) with
      the universal apply-math. → `src/packs/`.
- [ ] Build the agent loop: plain-English request → plan → tool calls → approval →
      post back. This is the hard 70%.
- [ ] Wire the first surface (Slack or web) and the first connector (Pipedream).
- [ ] Spec the three trust meters against real benchmark data
      (`avgTicketRange` per pack is the first input).
- [ ] Spec the skill manifest + the performance-measurement harness that ranks
      skills by measured lift, and the listing gates (claims checklist, same-ZIP
      guardrail, quality floor). The pack shape is the authoring surface.
