---
name: cpl-funnel-reader
description: Weekly plain-English readout of spend, leads, qualified, booked, and cost per booked job per channel and blended; names the leaking funnel stage and dollarizes the missed-call leak. Use when the user asks 'how are we doing' or for the weekly readout. For channel decisions, see channel-comparator.
metadata:
  author: Miles AI
  version: 1.0.0
---

# CPL + Funnel Reader
Trigger: weekly readout, "how are we doing", funnel panel refresh.
Inputs required: none.
Reads: calc.blended_spend, calc.blended_leads, crm.qualified_leads, crm.booked_jobs, calc.cost_per_booked, calls.missed, calc.lead_leak_dollars — per channel and blended.
Writes: none — read only.
Steps:
1. Pull spend, leads, qualified, booked per channel and blended for the range.
2. Compute stage-to-stage conversion; identify the largest drop (the leaking stage).
3. Dollarize the missed-call leak (missed × call-to-booked rate × avg ticket).
4. Write the plain-English readout and the funnel panel callout.
Output: readout in chat/dashboard + red callout sentence on the Funnel panel.
Approval: none — informational.
Guardrails: never average daily rates (recompute ratios from summed numerators/denominators); label sample data as sample; no revenue promises.
