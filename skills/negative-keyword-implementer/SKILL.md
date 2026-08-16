---
name: negative-keyword-implementer
description: Turn wasted search terms into a campaign-level negative-keyword block list with estimated monthly savings, ready to apply. Use when the user says 'block those searches', 'add negatives', or after search-term-gold-miner finds waste. For finding the waste itself, see search-term-gold-miner.
metadata:
  author: Miles AI
  version: 1.0.0
---
# Negative Keyword Implementer
Trigger: "block those searches", "add negatives", after a Gold Miner run.
Inputs required: the waste list (from Gold Miner) or live search-term data.
Reads: search-term report via the connector; Gold Miner output.
Writes: negative keywords — on approval once negative-keyword write access exists; until then outputs a paste-ready list with exact placement instructions.
Steps:
1. Take every term meeting the waste rule (>= $10, zero conversions, 30d).
2. Normalize to phrase-match negatives; dedupe against existing negatives.
3. Present the block list with estimated $ saved per month.
4. On approval (when write access exists): apply at campaign level, log to the Approval Log with a revert path.
Output: paste-ready negative list + $ saved + placement instructions.
Approval: every applied negative requires approval; with no write path the Approve action is disabled with the reason shown.
Guardrails: phrase match by default (never broad); never negate terms containing the business name or an offered service; always campaign level unless the user picks an ad group.
