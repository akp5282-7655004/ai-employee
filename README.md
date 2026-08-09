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

- **`src/connectors/`** — the connector seam (the "hands"): a `Connector`
  interface, an offline `MockConnector`, and a live `PipedreamConnector`
  (Pipedream Connect via `@pipedream/sdk/server`). Mock by default; set
  `CONNECTOR=pipedream` + credentials to go live. The engine talks only to the
  seam and never knows which is behind it.

```bash
npm install
npm run demo          # two businesses, two verticals, one engine → two plans + the guardrail
npm run demo:connect  # the connector seam: connect link → accounts → run an action (mock)
npm test              # 20 tests: packs, the four knobs, compliance, the planner, connectors
npm run typecheck
```

`npm run demo` runs a plumbing shop and a dental practice through the same engine
and prints their (different) plans — then shows the claims checklist rejecting a
`"pain-free, guaranteed results, #1 dentist"` ad.

## Going live with Pipedream (the "hands")

The connector is coded against Pipedream Connect and ships mock-first. To switch
it live:

1. Install the CLI and run the setup on **your** machine (it authenticates to your
   Pipedream account and creates a project):
   ```bash
   curl https://cli.pipedream.com/install | sh
   pd init connect
   ```
2. Put the project's Connect credentials in `.env` (see [`.env.example`](.env.example))
   and install the SDK:
   ```bash
   npm install @pipedream/sdk
   ```
3. Set `CONNECTOR=pipedream`. `getConnector()` now returns the live client.

`createConnectToken` and `listAccounts` are implemented against the published
Connect API reference. `runAction` (running a component on a user's behalf) is
stubbed with a clear TODO — the action-run docs weren't reachable from the build
environment, so it's left explicit rather than shipped half-known; the mock
implements it for now.

## What's next

The hard 70% (VISION §8) is the **LLM agent loop** — plain-English request → plan
→ tool calls (through the connector) → approval → post back — wrapping this
deterministic planner, plus the first **surface** (Slack or web). See the
checklist in [`docs/VISION.md`](docs/VISION.md) §11.
