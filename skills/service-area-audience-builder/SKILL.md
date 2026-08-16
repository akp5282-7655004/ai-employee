---
name: service-area-audience-builder
description: Build geo + homeowner audience specs for Google, LSA, and Meta from ZIPs, radius, and service lines. Use when the user says 'build my audience', 'who should we target', or before any campaign launch. For the campaign build itself, see campaign-launcher.
metadata:
  author: Miles AI
  version: 1.0.0
---

# Service Area Audience Builder
Trigger: "build my audience", "who should we target", new account onboarding, before any campaign launch.
Inputs required: ZIPs / radius / cities served, service lines, seasonality profile (from business profile); asks only for what is missing.
Reads: business profile; gbp.* (service areas), lsa.* (job types) when connected.
Writes: none — proposal only.
Steps:
1. Resolve the geographic footprint (ZIPs > radius > city, in that order of precision).
2. Build Google Search location targeting (setting: presence, never presence-or-interest).
3. Build the LSA service-area list (must equal the dispatch footprint; job types all-offered-ON).
4. Build Meta geo (min 1-mile radius) + interest/behavior stack: homeowners, home improvement, recent movers; age floor 25; exclude Audience Network.
Output: audience spec per platform, ready for the Campaign Launcher.
Approval: applying the spec to any platform requires approval; with no write access the Approve action is disabled with the reason shown.
Guardrails: never target outside licensed service areas; never use interest stacks that skew to renters; respect Special Ad Category rules if a financing offer is attached.
