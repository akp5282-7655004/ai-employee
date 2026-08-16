---
name: search-term-gold-miner
description: Analyze 30 days of Google Ads search terms to find wasted spend (terms with cost and zero conversions) and hidden winners (converting terms worth promoting to exact-match keywords). Use when the user asks 'what searches are we paying for', 'where is spend being wasted', or on a weekly scan. To block the waste, see negative-keyword-implementer.
metadata:
  author: Miles AI
  version: 1.0.0
---
# Search Term Gold Miner
Trigger: weekly scan, "what searches are we paying for", "where is spend wasted".
Inputs required: none (30-day window and $10 waste threshold by default).
Reads: Google Ads search-term report (term, cost, clicks, conversions) via the connector; falls back to a clearly-labeled sample when the report is not exposed.
Writes: none — proposal only; blocking hands off to negative-keyword-implementer.
Steps:
1. Pull 30 days of search terms with cost, clicks, conversions.
2. WASTE: terms with >= $10 spend and zero conversions, ranked by cost.
3. GOLD: converting terms with cost/conversion under target, ranked by conversions — candidates for exact-match keywords.
4. Total the wasted dollars; output both lists with per-term evidence.
Output: waste list (-> negatives), gold list (-> new keywords), $ wasted/mo.
Approval: informational; blocking requires the implementer skill's approval.
Guardrails: never flag a term with under $10 spend (noise); never propose negating a brand or service term the business actually offers.
