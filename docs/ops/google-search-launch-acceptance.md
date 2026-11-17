# Operator checklist — Pipedream ads and a paused Search create

Akhil’s operator playbook for scaling businesses is **pending**. It is not in this repo and it has not been validated. Do not treat these steps as that playbook.

Miles does not hold a contractor’s ad login. App credentials (`PIPEDREAM_PROJECT_ID`, `PIPEDREAM_CLIENT_ID`, `PIPEDREAM_CLIENT_SECRET`) identify the Miles Pipedream project. Each contractor still has to Connect their own `google_ads`, `tiktok_ads_manager`, `facebook_pages`, or `highlevel_oauth` account. Whether any of those connections exist in the project is **unknown from this code**.

## Launch day checklist

Added 2026-11-17. Work down this list in order. Each box is ticked by a person looking at the live site, not by a passing test. The sections further down this page are the detail behind steps 3 and 4.

### 1. Settings

- [ ] Open `/admin` on the live site as the owner and press **Run launch check**. Every line marked FIX is cleared. The lines marked NOTE are read and accepted.
- [ ] `ADMIN_RESET_SECRET` is not set on the host.

### 2. Payments

Stripe has only ever been used in test mode. Until this section is done, real cards are declined.

- [ ] In Stripe live mode, the three products exist as monthly prices: Starter $149, Growth $397, Scale $797.
- [ ] On the host, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_GROWTH`, and `STRIPE_PRICE_SCALE` are the live-mode values. A test value beside a live one fails at checkout.
- [ ] In Stripe live mode, a webhook destination points at `{APP_URL}/api/stripe/webhook` and sends `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, and `customer.subscription.deleted`. Adding `customer.subscription.created`, `payment_intent.succeeded`, and `payment_intent.payment_failed` is optional. Test mode and live mode each need their own destination and their own signing secret.
- [ ] Run the launch check again. Stripe live mode, the three prices, and the webhook line all read OK.
- [ ] One real subscription, on a new account, with a real card, on Starter. Plan & Credits shows Starter, Active, and $50 of credits. Never seen on the live site before this.
- [ ] On that account, press **Add $25.00 of credits** once. The balance goes up by $25. Stripe shows exactly one $25 payment. Never run against a real card before this.
- [ ] In Stripe, the `invoice.paid` delivery for that subscription shows 200.
- [ ] Refund both payments in Stripe and cancel the subscription.

### 3. A customer can connect and create a campaign

- [ ] The Pipedream workspace is on a plan that includes "Run in production". Without it a customer can connect Google Ads and still cannot create a campaign. See "What Akhil still has to do" below.
- [ ] The eight steps under "Steps" below pass on a test Google Ads account. The campaign is left paused.

### 4. Running out of credits

- [ ] On a test account with an empty balance, a skill run or a campaign build is refused, and the message names the right next step: pick a plan for a free account, add credits for a paying one, update the card after a failed payment.
- [ ] The same account still loads its dashboard and its reports.

### 5. What is sold matches what exists

- [ ] The sales site does not promise anything in the list below.
- [ ] The sales site carries no customer count, managed-spend figure, or testimonial that is not real.

Not built or not working on 2026-11-17. Do not sell these:

- Meta (Facebook and Instagram) ads. The launch route refuses and creates nothing.
- TikTok ads, Local Services Ads, and Performance Max. Not part of any plan Miles runs.
- Ad schedule. Hours are shown on the plan and are not sent to Google.
- GoHighLevel pipeline stages. Contacts are created. Opportunities are not moved.
- Automatic top-up. The server supports it and the app has no switch for it. The manual button is the only way to add credits.
- Learning across accounts. Each account only sees its own results.
- CallRail, Yelp, Nextdoor, and Yext. CallRail can be connected on the Integrations page and Miles reads nothing from it. The other three have no connection.

Unused credits do carry into the next month and do not expire. Checked 2026-11-17 by running two renewals in a row. The site may say so.

## Catalog versus wiring

Public catalog read 2026-11-07. See `GET /api/integrations/pipedream` and `src/connectors/pipedreamCatalog.ts`.

| Product | Slug | Campaign create in catalog | Wired in Miles |
|---|---|---|---|
| Google Ads | `google_ads` | `google_ads-create-or-update-campaign` plus budget, ad group, keywords, RSA | Yes. Status is forced to `PAUSED`. |
| TikTok Ads | `tiktok_ads_manager` | `tiktok_ads_manager-create-or-update-campaign` | No. Not called. |
| Meta Ads | none verified | No prebuilt action. `facebook_graph_api` has zero actions. | Refused. No Graph proxy. |
| Facebook Pages | `facebook_pages` | `facebook_pages-create-post` is a Page post, not an ad | Not used for campaigns. |
| Instagram | none verified | Not found | Not a campaign writer. |
| GoHighLevel | `highlevel_oauth` | `highlevel_oauth-upsert-contact` (CRM, not ads) | Journey lead ingest only, and only after that user connects `highlevel_oauth`. |

## What Akhil still has to do (names only)

1. Set `CONNECTOR=pipedream`, `PIPEDREAM_ENVIRONMENT=production` for customer connects, `PIPEDREAM_PROJECT_ID`, `PIPEDREAM_CLIENT_ID`, `PIPEDREAM_CLIENT_SECRET`, `DATABASE_URL`, `ADMIN_EMAIL`, `APP_URL`. Production is the right environment for customers. It is not a substitute for the Connect entitlement below, and development accounts must not be reused for a production user.
2. On the Pipedream workspace, enable Connect in production. A healthy Google OAuth account can still list (GET accounts returns 200) while `actions.run` returns 400 `Tool calling via Pipedream Connect in production is not available`. Miles cannot resolve a Google customer id or create a paused campaign until that tool call is allowed. The pricing page checked on 2026-11-07 lists Free as development-only and Startup or Business as including “Run in production”: https://pipedream.com/pricing?plan=Connect. Do not point Miles at `development` to get around it.
3. In the Pipedream project, enable the Google Ads app. Miles does not store a Google developer token; Connect OAuth uses scopes `email`, `profile`, and `https://www.googleapis.com/auth/adwords`.
4. Each contractor connects Google Ads in Miles. The Google user must be allowed to create campaigns on the client account they pick (`accountId` login customer, `customerClientId` managed account). Another external user’s healthy connection must not be reused.
5. Do not expect `META_ADS_ACCESS_TOKEN` to create a customer’s Facebook campaign. There is no verified Meta campaign action to enable.
6. TikTok, if wanted later, is a separate Connect of `tiktok_ads_manager` plus an advertiser id. It is not wired.
7. GoHighLevel follow-up needs the contractor’s `highlevel_oauth` connection (`contacts.write` is among the published scopes). Turning speed-to-lead on is a separate consent switch. This checklist does not send a message.

## Paused Search check (test account only)

Do not enable the campaign. Do not run this against a production customer.

1. Sign in as a contractor. With `CONNECTOR=pipedream`, `GET /demo` redirects to `/login?error=demo_off`.
2. Connect Google Ads. Open Launch and use “Show the $20/day plan”. Facebook and Google Leads (Local Services Ads) must show as not created. Competitor spend must say unavailable.
3. Approve a Search create. Miles must report PAUSED and a budget, campaign, ad group, keywords, and responsive search ad.
4. In the test Google Ads account, confirm the campaign is paused. Do not enable it.
5. Disconnect Google Ads and approve again. Miles must say it is not connected.
6. POST a lead to `/api/journey/leads/{userId}.{secret}` only against a test GoHighLevel location. A repeat of the same event id must not create a second contact. `consent: false` must not send SMS.

Automated tests in `test/campaignlaunch.test.ts` and `test/plumberloop.test.ts` do not call Google, TikTok, Meta, or GoHighLevel.

This is the manual check for a **test Google Ads account** after the code in this
repo is deployed by an operator. Do not run it against a production customer
account. Miles must leave the campaign **paused**. Do not enable it.

Automated coverage for the same rules is in `test/campaignlaunch.test.ts`.
That suite does not call Google or Pipedream.

## Configuration that must be set (names only)

On the host, not in the repo:

- `DATABASE_URL` — accounts and sessions
- `ADMIN_EMAIL` — the operator. With this unset, nobody is an operator, including the oldest signup
- `APP_URL` — the public origin, used for return links
- `CONNECTOR=pipedream`
- `PIPEDREAM_ENVIRONMENT=production` when real customers connect their own accounts (`development` only lets the Pipedream project owner connect)
- `PIPEDREAM_PROJECT_ID`
- `PIPEDREAM_CLIENT_ID`
- `PIPEDREAM_CLIENT_SECRET`

Do not set `ADMIN_RESET_SECRET` for this check. Do not set `META_ADS_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`, or `META_PAGE_ID` expecting a customer Meta campaign — those are one shared account and Meta create is refused.

The Google account used in the test needs permission, in Google Ads, to create campaigns on the client account you will pick (a manager login must include that client). The Pipedream Google Ads connection is the customer's OAuth grant, not a key in this repo.

## Steps

1. Sign in as a normal contractor account. Confirm `GET /demo` redirects to `/login?error=demo_off` while `CONNECTOR=pipedream`.
2. Connect Google Ads from Integrations. Confirm the connect link is minted for the signed-in account.
3. Open Launch a Campaign. Build a Search campaign from a brief. The review must say it will be created paused, with no control that enables it.
4. Pick the test ad account. If the login manages more than one, submitting with no pick must refuse and create nothing.
5. Approve. The result must list a daily budget, a campaign, an ad group, keywords, and a responsive search ad, and it must say **PAUSED**.
6. In Google Ads, open that account and confirm the campaign exists, is paused, and has the budget, ad group, keywords, and ad. Do not enable it.
7. Disconnect Google Ads and approve again. Miles must say the account is not connected and must not report a created campaign.
8. Approve a Meta campaign. Miles must refuse and must not create an ad in any Meta account.

## Full contractor loop (code)

Checked 2026-11-09. Automated tests do not call Pipedream, Google, TikTok, Meta, or GoHighLevel.

1. Profile. Launch uses the profile trade, service area, daily or monthly budget, target cost per lead, average job value, and landing page. A missing field is listed. Miles does not substitute $20 or a national location. Logo is optional and the plan says when none is attached. A painting company stays on painting.
2. Plan. Google Search is the only channel created. At $20/day Meta, Local Services Ads, Performance Max, and TikTok are not given budget. A trade with emergency demand and at least $10/day gets two paused Search campaigns (emergency and planned), each with its own keywords and a schedule note. The schedule is on the plan. The Google create chain has no verified ad-schedule action, so hours are not sent to Google. Locations come from the profile ZIPs, cities, and radius. Seasonal notes shift which service line leads (air conditioning in summer, furnace in fall, exterior painting in spring and fall). The executed daily total does not exceed the approved total.
3. Create. Approval creates those campaigns paused. A separate approval sets status ENABLED through `google_ads-create-or-update-campaign` (`operationType` update, `updateMask` status). One-click revert sets PAUSED. Both record who and when. A production tool-call block, a demo connector, a budget over the cap, or another tenant stops the call before it is sent.
4. Leads. `highlevel_oauth-upsert-contact` still runs only for the signed-in user's own GoHighLevel connection. Pipeline stages are stored on the account. Pipedream's HighLevel page lists six actions and none upsert an opportunity, so Miles does not call one. https://pipedream.com/apps/highlevel-oauth
5. Follow-up. Speed-to-lead and missed-call texts send only when GoHighLevel is connected, speed-to-lead is on, and the person has not opted out. Otherwise the text is a draft or it is skipped. Forwarded Local Services notices are not texted.
6. Jobs. Mark a lead qualified, booked, or won with a job value. The performance rollup reports CPL, cost per qualified lead, cost per booked job, CAC, and ROI from those marks and recorded spend. The dashboard labels mock figures as sample data. A live connector with no rows shows no sample numbers.
7. Optimization. Pause, budget-shift, channel comparison, and missed-call dollar estimates are proposals. Missed-call dollars use this account's own booked rate and average job value. They are not a guarantee. Applying a proposal is a later approval. The proposal endpoint itself does not change Google.
8. TikTok. `tiktok_ads_manager-create-or-update-campaign` can be approved with `operationStatus` DISABLE. TikTok's campaign create doc names DISABLE as disabled when created: https://business-api.tiktok.com/portal/docs/create-a-campaign/v1.3. Pipedream's prop is `operationStatus`, "Status when created". This creates a paused campaign shell. It does not create an ad group or an ad, and it is not part of the $20 Search plan.
9. Meta. Rechecked 2026-11-09. https://pipedream.com/apps/facebook-ads returned 404. Facebook Graph API lists zero actions. Facebook Pages posts are not ads. The Meta launch route still refuses. The shared `META_*` env path is not used.

## Still owner or provider setup

- Enable Connect production access (Startup or Business on https://pipedream.com/pricing?plan=Connect). Keep `PIPEDREAM_ENVIRONMENT=production`. Do not point customer traffic at development and do not reuse another external user's accounts.
- Until that entitlement is on, customer-id resolution, paused create, enable, and revert stay blocked in production.
- GoHighLevel opportunity stages need a published Pipedream action. There is not one in the six actions listed.
- Meta ads need a published campaign or lead-form action. There is not one.
- Billing enforcement is on for a production deploy (`NODE_ENV=production` or `RENDER` set) unless `BILLING_ENFORCE=0`. Set `BILLING_ENFORCE=1` if the host is production but neither of those is set. Auto top-up grants credits only after `payment_intent.succeeded`. A failed payment grants nothing. The webhook returns 500 when a grant cannot be saved so Stripe retries. Credit writes merge under a row lock. The launch offer is the first 100 accounts at $0 with $100 in credits. Starter is $149, Growth is $397, Scale is $797.

## What this does not prove

A green automated suite does not prove a paused campaign exists in Google, that enable or revert was accepted, or that a TikTok campaign was created. Only the operator, on a test account, after Connect production access is on, can confirm those writes. Do not enable a customer campaign during that check unless the owner has approved that specific test.
