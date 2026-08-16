---
name: loser-pauser
description: Find campaigns, ad groups, ad sets, and keywords spending above threshold with zero or above-target results, and propose a pause list with dollars saved. Use when the user asks 'what is wasting money' or on a weekly scan. Executes only on approval; for moving budget instead, see budget-shifter.
metadata:
  author: Miles AI
  version: 1.0.0
---

# Loser Pauser
Trigger: weekly scan, "what's wasting money".
Inputs required: spend threshold (default $50), lookback (default 30d), CPL/cost-per-booked target if set.
Reads: per-campaign spend + conversions (google_ads.*, meta.* when connected).
Writes: pause actions — only on explicit approval, with one-click revert.
Steps:
1. Find campaigns / ad groups / ad sets / keywords with spend ≥ threshold and zero conversions (or cost per booked above target) over the lookback.
2. Build the pause list with the $ saved per item and totals.
3. Present the proposal; on approval execute pauses; log prior state for revert.
Output: pause list with $ impact + revert path; feeds Skill Activity.
Approval: every pause requires approval; with no write access the Approve action is disabled with the reason shown.
Guardrails: never pause a campaign in its first 14 days (learning); never pause the only active campaign on a platform; every action logged to skill_runs with revert data.
