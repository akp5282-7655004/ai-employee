# Google Ads SOP map

The licensed SOP text is not copied here. SOP 146 is the backbone of the shared plan. Launch and chat both build it with `buildSearchPlan`, which runs `enforceRulebook` and `reviewSearchPlan`. Keyword research follows SOP 144 (Keyword Planner) and SOP 145 (Semrush). Miles does not call either tool. It applies the structure those SOPs hand to the builder: one campaign, ad groups by service and page, exact or phrase, and negatives that do not block the offer.

| SOP | Rule Miles enforces | Code |
| --- | --- | --- |
| 146 | One Search campaign for one offer and market. Ad groups split by service when they share the budget. A different budget, market, or goal would be a separate campaign. | `buildSearchPlan` in `src/agents/campaignplan.ts`; `draftCreate` refuses a second campaign when one is already saved |
| 146 | The customer action is a lead, not a page view. The draft is saved paused. Nothing is published, and Miles does not enable it and then pause it. | `spec.status = 'PAUSED'` in `buildSearchPlan` and `enforceRulebook`; create calls `launchCampaign` only after Approve, and enable is a separate approval |
| 146 | A lead campaign is planned as Maximize conversions with no target CPA. If the lead is not confirmed, the strategy stays planned and the draft stays unpublished. Maximize clicks is used only when the owner asks for a traffic test. | `enforceRulebook` bidding fields; `trafficTest` on `CampaignSpec`; Budget row in `reviewSearchPlan` |
| 146 | A monthly amount is divided by 30.4 and rounded down so the average daily budget stays inside it. A named daily amount is used as given. | `dailyAmount` in `src/chat/act.ts` |
| 146 | Google Search only, Presence, schedule from the owner's hours, language aligned with the page. Search partners, Display, AI Max, text customization, final URL expansion, and Dynamic Search Ads stay off. | `enforceRulebook` networks, `targeting`, and `copyControls` |
| 144 | Keywords are grouped by buyer task and landing page. Exact for a specific task, phrase when added words still fit the page, never both for the same phrase. Broad waits. A missing page holds the group instead of inventing one. Low volume does not drop a precise phrase. Negatives do not expand, so `course` and `courses` are separate, and a negative must not block the service. | `keywordsFor`, `reviewSearchPlan`, `STANDARD_NEGATIVES` (`course` and `courses`) |
| 145 | One ad group per service. Exact for a specific buyer task (service plus city). Phrase when the page can answer extra words. The same phrase is not saved as both match types. Broad is not used at launch. | `keywordsFor` in `src/agents/campaign.ts`, keyword focus in `src/agents/campaignplan.ts`, match collapse in `enforceRulebook` |
| 145 | Negatives are proposed from the trade list and checked so they do not block a keyword the campaign wants. | `STANDARD_NEGATIVES` and trade playbook negatives in `src/agents/rulebook.ts`; `draftNegatives` in `src/chat/act.ts` |
| 130 | 8 to 10 headlines, each at most 30 characters, and 2 to 4 descriptions, each at most 90. Miles does not invent numbered lines to reach Google's maximum of 15. | `rsaFor` in `src/agents/campaign.ts`, `RULEBOOK_DEFAULTS.headlines` and `headlineMin` in `src/agents/rulebook.ts` |
| 130 | Pin description 1 only when the owner required that exact wording. Otherwise no pins. | `requiredWording` and `pinDescription1` in `enforceRulebook` |
| 130 | AI Max, text customization, and final URL expansion stay off. | `copyControls` set in `enforceRulebook`, checked in `reviewSearchPlan` |
| 130 | The ad opens the real https page for the service. Display paths do not change that page. | `finalUrl` check in `enforceRulebook` and `reviewSearchPlan` |
| 149 | At least 4 sitelinks (text 25, descriptions 35, https URL), at least 4 callouts (25), and a Service catalog snippet with at least 3 values. | `sitelinksOf`, `calloutsOf`, `snippetOf` in `src/agents/campaign.ts`; asset checks in `reviewSearchPlan` and `sop149-assets` in `src/agents/sopgate.ts` |
| 147 | The plan is paused. Google Search only. Presence. No Display and no Search partners. | `enforceRulebook` targeting and networks; `reviewSearchPlan` rows Campaign state and Network and location |
| 147 | The saved daily amount has to match what the owner asked, and it cannot sit above the cap. The approval card stays hidden while any review row is a blocker or unknown. Going live still waits for the lead. | `reviewSearchPlan`; `overDailyCap` in `src/agents/policy.ts`; `draftCreate` |
| 147 | Goals stay unknown until the owner confirms calls or form fills. The approval card is not shown while any row is a blocker or unknown. | `reviewSearchPlan` Goals row; `draftCreate` |
| 147 | Policy review is named as pending. Saving the plan is not an approval from Google. | `reviewSearchPlan` Policy row |
| 129 | A new negative is refused when it would block a keyword already in the plan. | `sop129-protect` in `runSopGate`; `draftNegatives` |
| 039 | Turning a campaign on waits for the same lead confirmation. | `draftResume` and `sop039-lead` on `campaign_enable` |
| 018 | A budget change is logged and stays inside the approved cap and the daily change percent. | `sop018-loop` on `budget_change`; `capBlock` in `src/chat/act.ts` |

Starter, Growth, and Scale set how much of that structure goes in one draft. An unknown plan uses Starter. The numbers are limits on the draft, not a block: services past the limit are named and left off. A branded campaign is added when the owner has a brand name, on top of the service-campaign limit.

| Plan | Service campaigns | Ad groups per campaign | Keywords | Display and retargeting | Landing page creation | A/B ads |
| --- | --- | --- | --- | --- | --- | --- |
| Starter | 1 | 5 | 50 | No | No | No |
| Growth | 5 | 10 | 100 | Yes | Yes | No |
| Scale | 10 | 20 | 200 | Yes | Yes | Yes |

Every plan still includes keyword competition (left as not available when Keyword Planner did not return a score), negatives, headlines and descriptions, bid management, weekly optimization, keyword performance, monitoring, and the monthly report. `applyPpcLimits` in `src/agents/ppclimits.ts` applies the table. Ad groups still come from the owner's services, up to that plan's number.

A complete Google build includes the elements below. Miles builds the ones the Search SOPs cover and says when an element is not in this draft.

| Element | In this Search draft |
| --- | --- |
| Branded campaign beside the service campaign | Not created on its own. SOP 144 keeps brand searches separate only when the owner asks. A brand campaign needs its own budget, and Miles does not invent one. |
| Keyword competition | Not available. Miles does not invent a CPC, a competition score, or a Keyword Planner bid. |
| Negative keywords | Phrase negatives from the trade list, checked so they do not block a wanted service. `course` and `courses` are separate because negatives do not expand. |
| Headlines and descriptions | One responsive Search ad per ad group, 8 to 10 headlines and 2 to 4 descriptions, from confirmed facts. |
| Bid management | Planned Maximize conversions with no target CPA. Maximize clicks only when the owner asks for a traffic test. |
| Retargeting and Display | Off. SOP 146 keeps the first campaign on Google Search. |
| Landing page per ad group | The crawled page for that service when one exists. Otherwise the saved website. Miles does not invent a URL. |
| A/B ad testing | One RSA per ad group. Google rotates its headlines and descriptions. A second RSA is not written. |
| Weekly optimization | Later search-term and keyword proposals. They do not change Google until the owner approves. |
| Monthly performance report | The existing report, for a named period. |

Chat does not call Google while it drafts a card. `POST /api/chat/act` runs `runSopGate` and then the existing `launchCampaign`, `setGoogleCampaignStatus`, `updateGoogleDailyBudget`, or `addGoogleNegativeKeywords` path. The last two use the same Pipedream components the launch path already uses for budgets and phrase negatives.
