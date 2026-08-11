# Building Miles

Miles is a vertical AI marketing employee for local-service businesses. See
[`docs/VISION.md`](docs/VISION.md) for the product thesis.

## The covenant (binding on every change)

Every decision in this repo is held to the four promises in
[`docs/COVENANT.md`](docs/COVENANT.md): **Trust, Value, Experience, Expertise** —
and its **honesty clause**, which outranks the rest. Before shipping anything,
check it against them:

- **Trust** — Nothing spends, launches, or changes without the owner's
  permission at their chosen autonomy level. Every change is logged and
  reversible. Money-moving actions keep the safety floor. Never hold a customer's
  credentials or fake a number.
- **Value** — Default to the cheapest path that clears the quality bar. Respect
  budget guardrails. Prove outcomes with real attribution, not claims.
- **Experience** — Plain English in, real work out. Demo-safe and unbreakable
  when empty. One employee, not a toolbox.
- **Expertise** — Ship trade-specific knowledge (packs, benchmarks, curated
  integrations), never a blank box.
- **Honesty clause** — If it isn't built, say so — in the product and to the
  user. Under-claim and over-deliver. This beats the other four when they
  conflict.

## Engineering guardrails

- **Mock-safe by default.** Every feature must work offline/empty until a key or
  connection is added (`ANTHROPIC_API_KEY`/`OPENROUTER_API_KEY`, `DATABASE_URL`,
  `PIPEDREAM_*`, `FAL_KEY`, `CENSUS_API_KEY`, `GOOGLE_PLACES_KEY`). No feature may
  hard-depend on an external service being reachable.
- **Verify before claiming done.** `npx tsc -p tsconfig.json --noEmit`,
  `npx vitest run`, and `npx tsc -p tsconfig.build.json` must all pass. If a
  behavior can't be verified from here, say so rather than assert it works.
- **Secrets never touch the repo.** Keys live as environment variables on the
  host (Render), never in code, commits, or the browser.
