# Meta and TikTok leads campaigns for home services

Reviewed 21 November 2026. This is the build Miles follows for Facebook, Instagram, and TikTok. It is written in the same shape as a pre-launch review: what the plan must contain, what blocks creation, and what an approval does.

The ClickMinded ad-platform inventory has no Meta or TikTok SOP. The Meta baseline is the owner's Notion set, Meta Ads Specialist SOPs, March 2025, read with the in-repo Meta spec, the trade playbooks, and the audience files. Current platform docs were checked where a March 2025 line is out of date. Disagreements are listed at the end, with the choice Miles uses.

## This covers

- One Leads campaign per channel, built from the saved profile and the trade playbook (Roofing, HVAC, Plumbing, Electrical, Painting, Solar, Landscaping).
- The ad sets or ad groups, the ads, the lead form or website destination, the budget split, and the names.
- A pre-launch review the owner sees before anything is created.
- Creating that structure paused. Turning it on is a second, explicit approval.

## This does not cover

- Local Services Ads.
- Enabling a campaign, raising a budget, or editing a live ad without a separate approval.
- Guaranteed cost per lead, lead quality, or booked jobs.
- Deleting a campaign. Undo pauses a campaign Miles turned on, or puts a budget back. It does not remove objects from the ad account.
- A shared Meta token. Each business uses its own Pipedream connection.

## Before you start

- Business name, trade, city or service-area ZIPs, website, and a daily cap.
- Meta: a Facebook connection that can see an ad account and a Page, with permission to manage ads. A Page alone is not enough. Pipedream's managed Facebook Graph scopes do not include `ads_management`. The Facebook Graph API app has no prebuilt campaign action (rechecked 21 November 2026). Miles calls the Marketing API through the Connect proxy.
- TikTok: TikTok Ads Manager connected in Pipedream. Prebuilt actions used: `tiktok_ads_manager-create-or-update-campaign`, `tiktok_ads_manager-create-or-update-ad-group`, `tiktok_ads_manager-create-or-update-ad`, and `tiktok_ads_manager-upload-creative`.
- An https image for Meta. A public 9:16 video URL for TikTok. Miles does not inspect the file's length or ratio.
- Nothing in this SOP spends. Status on create is `PAUSED` (Meta) or `DISABLE` (TikTok).

## 1. Campaign

**Meta.** Objective `OUTCOME_LEADS`. Buying type auction. Special ad categories empty. See the disagreement note before changing that.

Budget mode is campaign budget optimization, including when there is one ad set. The daily amount sits on the campaign. Ad set amounts on the plan are weights. Notion's setup SOP (March 2025) starts bidding at Lowest Cost. The scaling SOP moves to a Cost Cap once the campaign is profitable. For these trades the cap is the high end of the playbook cost-per-lead band, not a 3x return on ad spend. Create sends Lowest Cost only. A Cost Cap is a later approval.

Daily budget, not lifetime. Dayparting needs a lifetime budget, and Miles does not guess a timezone. A scale is 10-20% and waits 48 hours (Notion scaling SOP). It also stays inside the owner's max percent change when that cap is tighter. Frequency above 3 means do not scale.

**TikTok.** Objective `LEAD_GENERATION`. Daily budget. Campaign budget optimization off, so each ad group has its own budget. Smart+ is not used: a contractor's service area has to stay a real location, and full automation can widen it.

TikTok's budget article (updated July 2026) says a daily campaign budget must exceed $50 and a daily ad group budget must exceed $20. A plan under that is shown and then blocked. Miles will not raise the owner's budget to clear the minimum.

Both channels are created paused.

## 2. Ad sets and ad groups

Miles starts from the trade audience file.

Included:

- Planned segments first (replacement, exterior, panels, and the same kind of job).
- Event, seasonal, then recurring segments if the budget can feed another ad set.

Held, and not created:

- Segments whose Meta note says they are not primary, retargeting only, or a custom audience / lookalike. Miles has no customer list to attach, so it will not invent one.
- Storm or event segments that need a ZIP list the profile does not have. The saved service area is not a stand-in for a hail map.

**Meta location.** ZIP codes from the service area when the profile has them. Otherwise the city plus a 15 mile radius. The radius is not stacked on top of a ZIP list. Country-only targeting is a block.

**Meta audience.** Advantage+ audience on. Location is a hard control. The hard age minimum is 25, which is the highest the Marketing API allows while Advantage+ audience is on. The segment age (often 35–65) is a suggestion, not a lock. No gender, no interest lock, no protected trait.

**Meta placements.** Advantage+ placements stay on. Excluding a placement turns an Advantage+ leads campaign off.

**Meta optimization.** Instant form: `LEAD_GENERATION`, destination on the ad, promoted object is the Page. Website: only when a pixel id is saved, optimization `OFFSITE_CONVERSIONS`, event `LEAD`. A website destination without a pixel is a block. The default is the instant form.

**TikTok.** Placement `PLACEMENT_TIKTOK` only. Optimization `LEAD_GENERATION` with `OCPM` when the ad can optimize for a lead, otherwise clicks (`CPC`) when there is no pixel and the destination is the website. Bid `BID_TYPE_NO_BID`. Pacing smooth. Schedule from the moment of creation, in UTC. Miles does not invent business hours.

The city is resolved to a TikTok location id at create time. If none comes back, nothing is created. Miles will not substitute the whole United States.

## 3. Ads and the form

Names:

- Campaign: `{Business} | Leads | {City}`
- Meta ad set / TikTok ad group: `{Trade} | {Segment} | {ZIPs or radius}`
- Ad: `{Segment} | {Angle}`

The primary message is always created. Extra messages are A/B variations. The allowance is Starter none, Growth up to 1, Scale up to 3, or 1 variation when no paid plan is on the account. "Up to" also stops at the learning ceiling `(daily budget × 14) / (2 × the playbook's high cost per lead)`. Notion's A/B SOP (March 2025) says one variable, equal budgets, and 5 to 7 days. Miles changes only the message, leaves the test for 5 to 7 days, and puts the variation on the first ad set. The variations share that ad set, so Miles does not assign them separate equal budgets. The playbook can write two alternate messages, so Scale's allowance of 3 includes those two and the plan says the third is not available.

**Meta creative.** One https image can be reused. The review warns when every ad shares it. Primary text, headline, and description come from the trade and the offer. No "best", no star rating, no "licensed and insured" unless the profile says so. CTA is Get Quote, or Call Now on an emergency segment that is actually included. Notion's creative SOP and compliance SOP still say to keep text under 20% of the image. The in-repo spec, verified August 2026, says that rule is retired. Miles does not check it and does not reject an image for text.

**Meta form.** Higher intent (`is_optimized_for_quality`). Prefill name, phone, email, and ZIP. Two custom questions: "Do you own this home?" and one trade question (roof type, what is broken, interior or exterior, and so on). Privacy policy URL is the website. The playbook lists more questions, including a typed phone number and a timeline. More than three custom questions hurts completion, so those two stay off the form and on the review as a follow-up the owner can add.

**TikTok creative.** Vertical video, 9:16, about 5 to 60 seconds, hook in the first 3 seconds, captions because most people watch with sound off. Miles uploads the URL through the creative action and then creates the ad as `SINGLE_VIDEO`. It does not check duration. Ad text stays within 100 characters. CTA `CONTACT_US`.

**TikTok destination.** The website. TikTok instant forms exist, and Pipedream has no verified create-form action, so Miles does not pretend to create one. The same two qualifying questions are printed on the plan for the landing page. A pixel id, when saved, is the optimization event. Without it, the ad group optimizes for the click.

## What every build includes

Every Meta plan and every TikTok plan states these items. A/B testing is the one item that follows the paid plan.

1. Strategy summary. Who the campaign is for, the leads objective, the budget, and where the click goes.
2. Competitor research. Names the owner already saved. If none are saved, the plan says so and does not invent competitors or copy their ads.
3. Monthly performance report. Reports shows spend and leads for the channel. A weekly check, after the campaign is turned on, does not change the budget by itself.
4. Campaign creation. The paused campaign, ad sets or ad groups, and ads.
5. Creatives. The primary message, plus any A/B messages the allowance includes.
6. Geography targeting. Service-area ZIPs, or the city plus 15 miles.
7. Budget management. Where the daily amount sits, the cap, and that a later change is a separate approval with undo.
8. A/B testing. Starter: no variations. Growth: up to 1. Scale: up to 3. No plan on the account: 1 variation. One variable, the message.

The lead form or landing page, and retargeting, stay on the plan as well. Retargeting is named and is not created until a real list is connected.

## 4. Pre-launch review

Each line is pass, warn, or block. Any block stops the create. Nothing is sent to Meta or TikTok until the owner approves, and a block cannot be approved away.

| Check | Pass | Block |
|---|---|---|
| Objective | Leads | Anything else |
| Status | Every object paused | Any enabled status in the plan |
| Special category | Empty, with the reason in the note | A category Miles did not intend |
| Location | Service-area ZIPs, or city plus 15 miles | Country only, or a radius under 10 or over 50 miles |
| Age | Hard minimum 25, segment age called a suggestion | A hard age above 25 while Advantage+ audience is on |
| Budget | Inside the daily cap and the monthly cap | Over either cap, or a TikTok budget that does not clear $50 / $20 |
| Ad sets | Two or more sets only when each is at least $10 a day | A split that puts a set under $10. One set under $10 is a warning, not a block. |
| Destination | Instant form with privacy URL and two questions, or website plus pixel | Website with no pixel, or a form with no privacy URL |
| Creative | Meta https image. TikTok https video URL | Missing |
| Copy | No protected trait, no banned claim | Either one |
| Learning | Warn when the daily budget cannot buy about 50 leads a week | Not a block. Say so. |
| Go live | Not part of this approval | A plan that asks to enable on create |

## 5. After approval

1. Create the objects that are marked included, in order: form (Meta), campaign, ad sets or ad groups, creatives, ads.
2. Read the campaign status back. Meta must report paused. TikTok create calls send `DISABLE` only.
3. Log the approval and the result. The log says the campaign was not deleted and is not spending.
4. A later "turn on" approval is the only path that sends `ACTIVE` or `ENABLE`. It is refused when the account is paused or the daily amount is over the cap.
5. A budget change has to stay inside the daily cap and inside the saved max percent change. Undo puts the previous daily amount back.
6. Undo of a go-live pauses the campaign again. Undo of a create does not call a delete.

## Notion Meta Ads Specialist SOPs, March 2025

Cited by title. E-commerce lines are not used for these trades.

| SOP | What Miles uses | What Miles does not use |
|---|---|---|
| Setting Up a Meta Ads Campaign | Leads, because that is the funnel stage for a local trade. Daily budget. Lowest Cost at create. Advantage+ placements. | Catalog sales and store traffic. |
| Audience Targeting & Custom Audiences Setup | Core location from the service area. Custom audiences: site visitors 30 days, engagers, CRM list, refreshed every 30-60 days. Lookalikes at 1%, then 2-5%. | Creating any of those audiences before a pixel, page, or list exists. |
| Creating High-Converting Ad Creatives | Image or video, short primary text, one message test. | The 20% image-text rule. Collection ads. |
| Optimizing Meta Ads for Performance | Overlap under 20%. Advantage+ placements. | A 3x return-on-ad-spend kill rule. Miles uses the playbook cost per lead. |
| Meta Ads Reporting & Analysis | Monthly report. Weekly read of cost per lead and frequency. | Scaling because return on ad spend is above 3x. |
| Scaling Meta Ad Campaigns Successfully | CBO. 10-20% every 48 hours. Do not scale when frequency is above 3. Cost Cap after the cost per lead is inside the playbook band. 50-100 conversions in 7 days is the Notion bar for "enough". Miles states that bar and does not invent the count. | The 3x return rule and the automated rule that raises budget from it. |
| Retargeting Strategies for Maximum Conversions | Exclusions for people who already became leads. Overlap under 20%. Frequency above 5 means refresh the creative. | Cart abandoners, dynamic product ads, and catalogs. |
| A/B Testing Strategies for Meta Ads | One variable. 5 to 7 days. | A second change during the test. Equal budgets per variation, because these variations share one ad set. |
| Using Meta Advantage+ Campaigns | Advantage+ placements and Advantage+ audience, with location kept as a hard control. | Advantage+ Shopping. |
| Managing Meta Ad Accounts & Compliance | No misleading claims. Privacy policy on the lead form. | The 20% text rule in section D. |

## Sources

- Notion, Meta Ads Specialist SOPs, March 2025. Ten SOPs, titled in the table above. Supplied by the owner. Not a public URL.
- In-repo: `docs/specs/meta-ads-specs-master.md` (verified August 2026), `specs/meta_ads.json`, `skills-library/ads/references/meta-decision-system.md`, `platform-setup-checklists.md`, `audience-targeting.md`, `ad-copy-templates.md`, `conversion-tracking.md`, `skills-library/tools/integrations/meta-ads.md`, `skills-library/tools/integrations/tiktok-ads.md`, `src/agents/playbook.ts`, `src/playbooks/audiences/miles_audiences_*.json`.
- Meta, Special Ad Categories, Marketing API (read 21 November 2026): https://developers.facebook.com/docs/marketing-api/audiences/special-ad-category/
- Meta, Advantage+ audience, Marketing API, updated 26 June 2026: https://developers.facebook.com/docs/marketing-api/audiences/reference/targeting-expansion/advantage-audience/
- Meta, About ads for housing: https://www.facebook.com/business/help/837655677217892
- Meta, Advantage+ leads campaigns: https://www.facebook.com/business/help/992035952809423
- TikTok, About budgets, updated July 2026: https://ads.tiktok.com/help/article/budget
- Pipedream, TikTok Ads Manager actions (15), rechecked 21 November 2026: https://pipedream.com/apps/tiktok-ads-manager.md
- Pipedream, Facebook Graph API, 0 actions, managed scopes omit `ads_management`: https://pipedream.com/apps/facebook-graph-api.md

## Where sources disagree

**Housing category.** Meta's housing examples are listings, insurance, mortgages, appraisals, and house hunting. Home repair is not in that list. Meta also says the examples are not complete and are not legal advice. A 2026 home-services guide (Rouillard) reaches the same reading and warns that an ad whose product is financing can be a financial-products ad. The audience files say none for home services, and financial products only when the ad is the loan. Miles leaves the category empty. It does not declare Housing, because that would ban ZIP targeting and force a wide radius on a repair ad that the official examples do not describe. If financing is on, the review warns that Meta may misread the copy. The category field is still empty.

**Advantage+ versus a tight local audience.** The playbook wants homeowners 35+ in owner-occupied ZIPs. The Marketing API, with Advantage+ audience on, only accepts a hard age minimum from 18 to 25, and it fixes the maximum at 65. Location stays hard. Miles uses Advantage+ audience, age minimum 25, and the older range as a suggestion. Original audience (Advantage+ off) would allow a hard 35, and it would also turn off the Advantage+ leads setup. That switch is a later review, not the default. The audience file already says to move only if too much spend lands under the segment age.

**Placements.** The spec says Audience Network can be dropped when lead quality matters. Meta's Advantage+ leads description, and a 2026 write-up of the help page, say excluding any placement turns Advantage+ off. Miles keeps Advantage+ placements and warns about Audience Network. It does not exclude it in the create.

**How many campaigns.** The Meta decision system splits testing and scaling into two campaigns. That system is written for a large B2B budget. A contractor at the saved cap usually cannot feed two campaigns and still leave learning. Miles uses one paused leads campaign.

**Form length.** The playbook asks five questions, including a phone number typed by hand. The spec and the decision system say one to three custom questions. Miles sends two custom questions plus the prefilled contact fields.

**Lead form versus the website.** The playbook says start on instant forms. The spec requires a pixel for website optimization. Miles defaults to the instant form. The website is used only when a pixel id is already saved.

**TikTok Smart+ versus manual.** TikTok is moving lead generation toward Upgraded Smart+. Smart+ can set the location loosely and asks for more creative than a local budget can feed. Miles uses a manual lead campaign with an explicit location and TikTok placement only. The July 2026 budget minimums still apply.

**City radius.** The in-repo spec allows a radius from 1 mile. The March 2025 audience SOP gives a 10-mile store radius as an example. A 2026 targeting guide says Meta's city radius runs about 10 to 50 miles. Miles uses 15 miles, inside the 2026 range and above both the spec minimum and the SOP example.

**20% image text.** The March 2025 creative SOP and compliance SOP still tell the specialist to stay under 20% text and to use the text overlay tool. The in-repo spec says that rule is retired. Miles does not apply it.

**Return on ad spend.** The March 2025 optimization, reporting, scaling, and retargeting SOPs use a 3x or 4x return as the scale line, and they use cart abandoners, catalogs, and dynamic product ads. Those are e-commerce. For these trades Miles uses the playbook cost-per-lead band.

**Equal A/B budgets.** The March 2025 setup SOP and A/B SOP say each variation gets the same budget. A message test inside one ad set does not have a per-ad budget. Miles keeps one audience and one budget for that test, and says so on the plan.

**Lookalikes and custom audiences.** The March 2025 audience and scaling SOPs say to build them. Miles names the 30-day site visitors, engagers, CRM list, 1% lookalike, and later 2-5% lookalikes. It does not create them until the pixel, page, or list is actually connected.
