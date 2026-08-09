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

The command-pack foundation — the moat artifact — is in place and tested:

- **`src/packs/types.ts`** — the `CommandPack` format (the four knobs).
- **`src/packs/homeServices.ts`**, **`dental.ts`** — the first two verticals.
  Dental proves the pattern: a considered-purchase channel mix (Search-led, not
  LSA-led), dental offers, and health-claim compliance (`pain-free`,
  guaranteed-outcome, HIPAA) the trades never see.
- **`src/packs/apply.ts`** — the universal math: `channelWeights`, `budgetBand`,
  `suggestOffers`, and the `checkClaims` honesty guardrail (universal rules +
  each pack's own compliance patterns).
- **`src/packs/index.ts`** — the registry (`getPack` / `listPacks`).

```bash
npm install
npm test        # 9 tests: registry, the four knobs moving the mix, per-vertical compliance
npm run typecheck
```

## What's next

The hard 70% (VISION §8) is the **agent loop** — plain-English request → plan →
tool calls → approval → post back — plus the first **surface** (Slack or web) and
first **connector** (Pipedream). See the checklist in
[`docs/VISION.md`](docs/VISION.md) §11.
