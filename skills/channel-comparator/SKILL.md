---
name: channel-comparator
description: Compare Google Search, LSA, PMax, and Meta on cost per qualified lead and cost per booked job for the same service line and geo, never on raw CPL. Use when the user asks 'which channel is best'. Hands execution to budget-shifter.
metadata:
  author: Miles AI
  version: 1.0.0
---

# Channel Comparator
Trigger: monthly, "which channel is best", Placements panel callout refresh.
Inputs required: service line + geo (defaults to whole account).
Reads: google_ads.cost, lsa.spend, meta.spend, per-channel leads and crm booked jobs, calc.cost_per_booked per channel.
Writes: none — proposal only; hands execution to Budget Shifter.
Steps:
1. Normalize every channel on cost per BOOKED JOB (never CPL — LSA leads and Search clicks are not comparable raw).
2. Treat GBP as $0 media cost, upstream of LSA (reviews drive LSA rank).
3. Dollarize the missed-call leak per channel (an unanswered LSA lead is still charged).
4. Recommend the shift; write the Placements panel callout.
Output: channel comparison table + one-sentence callout + recommended shift (handed to Budget Shifter).
Approval: the recommendation itself is informational; any resulting budget move goes through Budget Shifter's approval.
Guardrails: never compare on CPL; never recommend dropping a channel on under 30 days of data; label sample data as sample.
