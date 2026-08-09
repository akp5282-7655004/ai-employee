# AI Employee (working name)

> A horizontal **AI marketing employee** — sold through vertical doors. Same
> category as Viktor and Marcus, but instead of a blank prompt box we ship a
> **pre-built specialist**: a business picks "Plumbing" or "Dental" and gets a
> marketing agent that already knows the playbook.

This is a **new, standalone product** — not a rebrand of any prior project. The
full thesis (business, competitive landscape, moat, features, marketplace,
revenue, naming, and the seven stress-tested objections) is in
[`docs/VISION.md`](docs/VISION.md).

The repo name `ai-employee` is a placeholder until the brand name is chosen.

## The idea in one picture

```
                 ┌──────────────── shared engine (the chassis) ────────────────┐
  plain-English  │  agent loop · claims checklist · budget math · connectors    │
  request  ─────▶│                          │                                   │
                 │              ┌───────────┴───────────┐                       │
                 │      command pack:  Home Services / Dental / … (the packs)    │
                 └──────────────────────────┬──────────────────────────────────┘
                                            ▼
                         channel mix · offers · compliant copy · actions
```

The engine is universal. A **vertical is a data file** (a command pack) that
turns four knobs — urgency, proximity, offer wording, economics + compliance.
That same pack shape is the surface a marketplace creator will author a *skill*
against (VISION §6).

## What's built (v0)

The command-pack foundation (the moat artifact) **and a runnable planner** that
turns it into real output — all offline, no API keys:

- **`src/packs/`** — the `CommandPack` format (the four knobs), the first two
  verticals (home services + dental), the universal math (`channelWeights`,
  `budgetBand`, `suggestOffers`, `checkClaims`), and the registry. Dental proves
  the pattern: a considered-purchase mix (Search-led, not LSA-led), dental offers,
  and health-claim compliance (`pain-free`, guaranteed-outcome, HIPAA) the trades
  never see.
- **`src/intake.ts`** — the strict intake; the category is validated against the
  chosen vertical.
- **`src/plan/`** — the deterministic planner: intake → channel mix + budget split
  + featured services + proven offers + **claims-checked ad drafts** + a
  plain-English summary. This is the "brain"; an LLM planner can later emit the
  same `CampaignPlan` with richer copy (VISION §3, §8).

```bash
npm install
npm run demo      # two businesses, two verticals, one engine → two plans + the guardrail
npm test          # 15 tests: packs, the four knobs, per-vertical compliance, the planner
npm run typecheck
```

`npm run demo` runs a plumbing shop and a dental practice through the same engine
and prints their (different) plans — then shows the claims checklist rejecting a
`"pain-free, guaranteed results, #1 dentist"` ad.

## What's next

The hard 70% (VISION §8) is the **LLM agent loop** — plain-English request → plan
→ tool calls → approval → post back — wrapping this deterministic planner, plus
the first **surface** (Slack or web) and first **connector** (Pipedream). See the
checklist in [`docs/VISION.md`](docs/VISION.md) §11.
