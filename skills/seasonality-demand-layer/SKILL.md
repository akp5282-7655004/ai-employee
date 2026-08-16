# Seasonality + Demand Layer
Trigger: weekly (Monday), or "what should we push this week".
Inputs required: trade/vertical, service lines, geo.
Reads: vertical playbook; google_ads.search_terms_count and impression trends when connected; weather signals when available.
Writes: none — read only.
Steps:
1. Read the vertical's seasonal demand curve for the current month.
2. Cross-check against live search-term and impression movement where connected.
3. Rank service lines to push this week; produce a budget weighting (winners / seasonal / testing).
Output: weekly demand memo + suggested budget split; feeds the Budget Shifter as advisory input.
Approval: none — informational. Budget changes route through Budget Shifter.
Guardrails: never recommend pushing a service line the business does not offer; label template-driven output as such until live demand reads exist.
