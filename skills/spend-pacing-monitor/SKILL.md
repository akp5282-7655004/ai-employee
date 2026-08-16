---
name: spend-pacing-monitor
description: Track ad spend against the monthly budget, project month-end totals, and flag over- or under-pacing. Use when the user asks 'are we on budget', 'how much have we spent', or on a weekly check. For moving budget between campaigns, see budget-shifter.
metadata:
  author: Miles AI
  version: 1.0.0
---
# Spend Pacing Monitor
Trigger: weekly check, "are we on budget", "how much have we spent".
Inputs required: monthly ad budget (Business Profile); real spend from the connector.
Reads: per-campaign 30-day spend; profile monthly budget.
Writes: none — read only.
Steps:
1. Sum trailing-30-day spend across connected ad platforms.
2. Project month-end: (spend/30) x days-in-month.
3. Compare to the monthly budget: over 110% = OVER (trim or expect capping), under 80% = UNDER (headroom to scale winners), else on track.
4. Note Google's overspend mechanics: up to 2x a daily budget on strong days; monthly cap = daily x 30.4.
Output: pacing % + projection + per-campaign breakdown; feeds the budget_pacing dashboard metric.
Approval: none — informational. Budget changes route through budget-shifter.
Guardrails: never average away a mid-month budget change; label the projection as a projection.
