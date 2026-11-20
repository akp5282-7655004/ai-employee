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
- **`src/agent/`** — the **agent loop**, the spine that makes it an *employee*:
  plain-English message → intake → clarifying question or plan → proposed
  connector actions → **approval** → execute. The interpreter is a seam
  (`MockInterpreter` today, an LLM one later — same loop underneath), so it runs
  fully offline now and upgrades to real Claude understanding when a key is added.

```bash
npm install
npm run demo:agent    # the whole thing: chat → plan → "approve" → actions run through the connector
npm run demo          # two businesses, two verticals, one engine → two plans + the guardrail
npm run demo:connect  # the connector seam: connect link → accounts → run an action (mock)
npm test              # 27 tests: packs, planner, connectors, interpreter, agent loop
npm run typecheck
```

`npm run demo:agent` holds a real conversation offline: *"I run a plumbing shop
in Chicago, 24/7, $3k/month, more calls"* → a plan + the actions it will run →
`approve` → Google Ads + Business Profile launch, and LSA comes back with a
connect link because that app isn't connected yet.

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

## Run the app (real backend)

```bash
npm install
npm run build && npm start      # or: npm run dev
# open http://localhost:3000
```

The server ([`src/server.ts`](src/server.ts)) serves the dashboard and runs the
**actual TypeScript engine** over HTTP — one source of truth, no browser copy:

- `POST /api/message {sessionId, text}` → the agent loop (plan / clarify / approve)
- `POST /api/connect-and-run {sessionId, actions}` → connect apps, run the blocked actions
- `GET /health` → which interpreter + connector are live

It upgrades in place: **Claude** understanding when `ANTHROPIC_API_KEY` is set
(else the deterministic mock), **Pipedream** actions when its credentials are set
(else the mock). The dashboard ([`web/index.html`](web/index.html)) calls this API
when served, and falls back to an inline copy of the engine only when opened as a
standalone file (the shareable demo).

## Stripe billing

Stripe holds the card and the subscription. Miles stores the customer id, subscription id, plan, status, the amount Stripe actually charged, and the period end. If the env vars are empty, plan actions say "Stripe not connected" and the rest of the app still runs.

Set these in the host environment (see `.env.example`):

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_STARTER`
- `STRIPE_PRICE_GROWTH`
- `STRIPE_PRICE_SCALE`
- `APP_URL` (public origin, no trailing path)
- `ADMIN_EMAIL` (the only account that can open `/admin`)

Webhook URL to register: `https://<APP_URL host>/api/stripe/webhook`

Events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`. Also register `payment_intent.succeeded` and `payment_intent.payment_failed` if you use credit top-ups.

In the Stripe Dashboard:

1. Create three recurring monthly Prices, one each for Starter, Growth, and Scale. Copy each Price id into the matching env var. The charge is whatever amount you set on that Price.
2. Developers, Webhooks, Add endpoint. Paste the webhook URL. Select the events above. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
3. Settings, Billing, Customer portal. Turn the portal on. Allow customers to switch plans and cancel. Save.

Customers upgrade from Plan and Credits (Stripe Checkout) and manage or cancel from the same page (Customer Portal). The owner dashboard is `/admin`.

## Chat with Miles

Chat is a read-only agent for the signed-in account. It can look up the profile, playbook, connections, campaigns, metrics, leads, approvals, the change log, daily findings, and benchmarks. It cannot spend, launch, pause, send, or change settings. A complete Google Ads setup request can open a draft in Launch for review. Creating the paused campaign requires a separate approval there. Use **Clear chat history** to start over.

Set these on the host when you want live answers (see `.env.example`):

- `OPENROUTER_API_KEY`
- `MILES_AGENT_MODEL` (default `openai/gpt-4o-mini`)
- `MILES_AGENT_MODEL_STRONG` (reserved for later builds, default `anthropic/claude-sonnet-4.5`)

Text is billed at OpenRouter cost times 4. With no key, chat still answers from the saved account snapshot.

## What's next

The engine, connector, agent loop, and a web surface all exist and run offline.
The remaining pieces to make it *live* (VISION §8, §11):

- **Wire the surface to the real backend** — the page currently runs the mock
  engine in-browser; point it at the TypeScript engine over HTTP for one source
  of truth.
- **The LLM interpreter** — swap `MockInterpreter` for a Claude-backed one (needs
  an `ANTHROPIC_API_KEY`); the loop, planner, and connector stay unchanged.
- **Live Pipedream `runAction`** — fill in the one stubbed method once its docs
  are reachable, then flip `CONNECTOR=pipedream`.
