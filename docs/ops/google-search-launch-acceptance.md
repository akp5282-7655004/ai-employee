# Google Search paused-create — operator checklist

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

## What this does not prove

A green automated suite does not prove step 6. Only the operator, on a test account, can confirm Google accepted the write.
