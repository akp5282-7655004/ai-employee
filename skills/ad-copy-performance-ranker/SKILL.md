---
name: ad-copy-performance-ranker
description: Rank responsive search ad headlines and descriptions by Google's asset performance labels and CTR, then propose replacements for the weak ones. Use when the user asks 'which headlines work', 'improve my ad copy', or monthly. For building new ads from scratch, see campaign-launcher.
metadata:
  author: Miles AI
  version: 1.0.0
---
# Ad Copy Performance Ranker
Trigger: monthly, "which headlines work", "improve my ad copy".
Inputs required: none.
Reads: per-asset RSA performance (Best/Good/Low labels, impressions) via the connector when exposed; clearly sample-labeled otherwise.
Writes: none — proposal only; edits apply through the campaign editor after approval.
Steps:
1. Pull per-asset performance for every running RSA.
2. Rank assets within each ad; flag "Low"-rated assets with meaningful impressions.
3. Propose replacements built from the winning assets' patterns (structure of the top performer, new angle) — never touch winners.
4. Package as an edit list for the ad, pinned assets respected.
Output: ranked asset table + proposed swap list per ad.
Approval: applying swaps requires approval; with no asset read the Approve action is disabled with the reason shown.
Guardrails: minimum 2 weeks / 1,000 impressions before judging an asset; never replace an asset rated Good or Best; keep 15/4 slots full after any swap.
