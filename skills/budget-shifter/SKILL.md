---
name: budget-shifter
description: Move daily budget from underperformers to winners within user-set caps (max percent per day, budget floor, monthly ceiling). Use when the user says 'move budget to what works'. Proposes first; executes on approval. For which channel deserves the budget, see channel-comparator.
metadata:
  author: Miles AI
  version: 1.0.0
---

# Budget Shifter
Trigger: weekly, after Loser Pauser or Channel Comparator, "move budget to what works".
Inputs required: user caps — max % move per day (default 20%), min budget floor per campaign (default $5/day), monthly ceiling.
Reads: per-campaign spend, conversions, cost per booked (google_ads.*, meta.*, calc.*).
Writes: daily budget changes — only on explicit approval, with one-click revert to logged prior values.
Steps:
1. Rank campaigns by cost per booked job (fallback: cost per conversion).
2. Compute the shift: take from the worst within caps, give to the best, floors respected.
3. Present what moves, why (metrics cited), $ impact, revert path; execute on approval.
Output: budget-change proposal + execution log.
Approval: every shift requires approval; with no write access the Approve action is disabled with the reason shown.
Guardrails: never exceed the daily % cap; never go below the floor; never touch the monthly ceiling; never change bidding strategy or objective; revert data logged before any change.
