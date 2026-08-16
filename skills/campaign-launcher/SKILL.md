# Campaign Launcher
Trigger: "launch a campaign", "build me ads", a brief (vertical, service line, offer, budget, geo).
Inputs required: service line, offer, daily budget, landing URL, geo; pulls the rest from the business profile.
Reads: specs/google_ads.json, specs/meta_ads.json (all limits come from these files — never hardcoded); business profile; audience spec if present.
Writes: Google Ads campaign chain (budget → campaign → ad group → keywords → RSA), Meta campaign chain — ONLY after explicit approval on the launch page; everything is created PAUSED.
Steps:
1. Build the full campaign object: Google Search RSA (15 headlines/4 descriptions), keywords + match types + negatives, sitelinks/callouts/snippets/business name; or Meta Leads (objective, ad set, instant form, creative spec).
2. Validate every field against the spec files (counts, character limits, required assets); run the launch spec-check.
3. Render the human preview (review page) for line-by-line edit.
4. On approval, execute the write chain; verify the result exists in the platform before reporting success.
Output: structured campaign object + review UI + per-step launch log; if no write access, exports the build as JSON + copy-paste sheet.
Approval: every launch requires the explicit confirm; campaigns are created PAUSED and never enabled by Miles.
Guardrails: never change objective or billing; never enable a campaign; never exceed the stated daily budget; honest per-step error reporting.
