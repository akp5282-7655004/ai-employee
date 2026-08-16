# Marketing Skills Library (vendored)

49 marketing skills from [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills)
by Corey Haines, vendored under the MIT license (see LICENSE in this directory).

- Format: [Agent Skills specification](https://agentskills.io/specification.md)
- Versions: VERSIONS.md (compare against upstream to check for updates)
- Update: re-clone upstream and copy `skills/*` over this directory
- Validation: `test/skilllibrary.test.ts` enforces the spec (frontmatter,
  name rules, description limits) on every test run; `scripts/validate-skills.sh`
  is the equivalent standalone bash check (run with SKILLS_DIR=skills-library)

Miles surfaces these in the Skills & Playbooks page and uses them as
reference frameworks when doing marketing work. Miles' own seven
home-services skills live in `skills/` and follow the same spec.

## Tools (vendored from the same repo)

- `tools/clis/` — 65 zero-dependency Node.js CLI tools for marketing APIs
  (Ahrefs, Amplitude, GA4, Stripe, Mailchimp, CallRail, …). Each reads its
  API key from environment variables, supports `--dry-run`, and prints
  JSON. Run with no args for usage. All syntax-checked in the test suite.
- `tools/integrations/` — per-tool API integration guides.
- `tools/composio/` — Composio layer notes for OAuth-heavy tools.
- `tools/REGISTRY.md` — the index of tools and capabilities.

These are reference implementations for future direct API integrations;
Miles' live integrations run through its connector layer (Pipedream).
