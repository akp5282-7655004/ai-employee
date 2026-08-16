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
