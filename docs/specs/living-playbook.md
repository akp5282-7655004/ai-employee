# Living playbook

Miles collects each account's ad performance, aggregates it anonymously by trade and platform, and every budget check, chat line, and dashboard benchmark uses one resolver. The number on screen names its source.

This is the rule sheet. It is not a privacy policy and it is not legal advice.

## What is stored

Daily rows, one per account, day, platform, and campaign type:

- Platforms: `google_ads`, `google_lsa`, `meta`, `tiktok`. A platform with no read is not invented.
- Campaign type is a label from the campaign name (`search`, `pmax`, `brand_search`, `lsa`, `lead_ads`, `crm`, `other`). It is not a new benchmark.
- Counts: spend, clicks, impressions, leads (platform conversions), conversions, booked jobs, revenue.
- Derived on the row: CPL = spend / leads, CPC = spend / clicks, CPA = spend / booked jobs, ROAS = revenue / spend. A zero denominator is stored as empty, not zero.
- Flags on the row: trade, tracking verified, account active, consent.

Membership, one per account: trade, active, consent, tracking verified, connected platforms. This is how N is counted. An account with the platform connected and no spend still counts in N.

The aggregate table, one per trade, platform, and metric (CPL, CPC, CPA, ROAS), over the trailing 90 days:

- median, 25th percentile, 75th percentile, after winsorizing
- contributor count, N, required count, published or not, spend-cap result, reason

Account ids exist only on the daily and membership tables so a deletion can find the rows. The aggregate table has no account id. No table has a name, phone, email, or address.

Tables are created in `PostgresStore.init` from `src/benchmarks/schema.ts` (`CREATE TABLE IF NOT EXISTS`, the same pattern as the other tables). With no database, the memory store holds the same rows and tests use that.

## Who counts

A contributor is an account that, in the trailing 90 days, is all of:

- active (not paused)
- consented (benchmark sharing on; a missing flag counts as on, matching new signups)
- tracking verified (lead-conversion proof or GA4 linked on the account)
- at least $100 spend and at least 5 leads on that platform

Those two minimums are `minSpend` and `minLeads` in `src/benchmarks/config.ts`.

N is different. N is every active account in that trade with that platform connected, including accounts that opted out or have not verified tracking. Opted-out accounts raise the bar and do not fill it.

Rates are computed per account for the whole window (spend and leads summed across days and campaign types), then the cohort median is taken. Miles does not average daily CPLs.

Winsorizing clips each account's rate to the 5th and 95th percentile of that cohort when there are at least four accounts, then p25, median, and p75 are taken on the clipped values. Percentiles use linear interpolation.

## Minimum group size

```
p = 0.50 when N <= 10
p = 0.75 when N >= 100
p = 0.50 + 0.25 * (N - 10) / 90 otherwise

required = max(5, ceil(p * N))
```

Only clean-tracking contributors count toward `required`. The hard floor is 5.

| N | p | ceil(p * N) | required |
| --- | --- | --- | --- |
| 5 | 0.50 | 3 | 5 |
| 10 | 0.50 | 5 | 5 |
| 25 | 0.5417 | 14 | 14 |
| 50 | 0.6111 | 31 | 31 |
| 100 | 0.75 | 75 | 75 |
| 200 | 0.75 | 150 | 150 |

Spend cap: if any one contributor is more than 40% of that cohort's spend, the cohort is not publishable. The median is not stored for show.

## Priority

For each trade, platform, and metric, in order. The first hit is the whole number. Nothing is blended.

1. Miles aggregate, when `required` is met and the spend cap passes. Label: `Miles data, 82 plumbing accounts, last 90 days`.
2. Searchlight, from `src/packs/benchmarks.ts`. The HVAC Google Ads 4.37x ROAS cell is flagged `unverified` and is skipped. It was not on the Searchlight source page (checked 21 Nov 2026).
3. A verified external figure for that exact trade, from `src/benchmarks/external.ts` (LocaliQ 2025 search medians, and category rows that are recorded but not applied to a trade). Label: `LocaliQ 2025` or `WordStream 2026`.
4. The trade playbook's own estimate. Plumbing's $110 cost per lead (Search, LSA, and Meta). Roofing's $2,000 allowable cost per booked job. The older Meta planning range in `src/agents/playbook.ts` is a range for Meta only, not a midpoint, and not a Google Ads number. Label: `Playbook estimate`.
5. No benchmark. Solar has no verified CPL or ROAS on these platforms, and the playbook does not state one, so the answer is no benchmark.

The function the chat launcher calls is `resolveBenchmark({ trade, platform, metric, leadType? })`. Metrics are `cpl`, `cpc`, `cpa`, and `roas`. The result always has `value`, `source`, `label`, `sampleSize`, and `minimumMet`. `source` is `miles`, `searchlight`, `localiq`, `wordstream`, `playbook`, or `none`. `minimumMet` is true only when the value is a published Miles median. `sampleSize` is the published sample when the source states one, and null when it does not. `leadType` is optional. There is no separate published cut by lead type, so a lead type uses the trade figure and the label says "Trade-level figure. No separate benchmark for {lead type} leads."

Category averages (home-services $90.92, Home & Home Improvement Meta $42.95) are not used as a trade's number. The two LocaliQ HVAC rows (air conditioning $127.74, heating $129.02) are not averaged into one HVAC cost per lead. Stale 2020-2021 LocaliQ rows are stored with `current: false` and are not used.

When Miles is not the source, the screen also says `Not enough Miles data yet (x of y accounts)`, where x is clean contributors and y is required. If the count is met but one account is over 40% of spend, the line says that instead, and the next source is used.

## Where the label shows

- Budget and goal check (`src/agents/goalcheck.ts`, `src/agents/budgetexpect.ts`)
- Launch feasibility (`src/agents/feasibility.ts`)
- Weekly report cost-per-lead line
- Skills board "Cost per lead Miles uses"
- Operator dashboard compare line
- Chat snapshot and the `get_benchmarks` / `get_playbook` tools
- Admin cohort table (owner only)

Customer copy may name Searchlight, LocaliQ, or WordStream because that is the source of the number. Study URLs are not sent to the browser.

## Privacy

- `GET /api/benchmarks/living` returns aggregates only. Unpublished cohorts omit the median.
- No route, chat tool, or page returns another business's daily row or per-account spend.
- Admin `GET /api/admin/benchmarks` lists N, required, contributors, published, and source. It does not list businesses.
- Opting out (`POST /api/benchmarks/sharing` with `share: false`) deletes that account's daily rows and keeps membership with consent off, then rebuilds aggregates.
- Deleting the account deletes daily rows and membership, then rebuilds aggregates.
- New signups set `benchmarkShare: true`. The Terms placeholder in `docs/legal/terms-of-service-mvp.md` section 5.2a says so. Settings has the switch.
- The collector does not run against the preview connector, and unit tests do not call a live ad API. The daily job asks the existing spend reader for `YESTERDAY` and reads CRM outcomes already stored on the account.

CRM adapters: GoHighLevel maps the existing lead and opportunity ledger to counts. HubSpot, ServiceTitan, and Jobber have no verified Pipedream action key in `src/connectors/pipedreamCatalog.ts` (catalog read 2026-11-07). Those readers return a TODO and do not call the network. Shape mappers exist for a future payload and drop name, phone, email, and address.

## Needs the owner or a lawyer

These are not resolved by this code.

1. Terms and privacy policy wording for benchmark sharing, including whether consent must be opt-in in any state, and how section 5.2a should read. The in-app sentence is a placeholder.
2. Google Ads API terms on using advertiser data beyond the account that granted access. Start with the [Google Ads API terms](https://developers.google.com/google-ads/api/terms) and the [data use policy](https://developers.google.com/google-ads/api/docs/api-policy/data-use). A lawyer has to say whether an anonymized median across customers is allowed.
3. Meta Platform terms on aggregating advertiser insights. Start with the [Meta Platform Terms](https://developers.facebook.com/terms/) and [Developer Policies](https://developers.facebook.com/devpolicy/). Same question, unanswered here.
4. TikTok Business API terms, if TikTok spend is collected the same way. No verified home-services benchmark was found, and no legal review was done.
5. Whether Searchlight's own terms allow Miles to keep citing those published pages by name. The product now shows the name as the source label.
6. Confirm the HVAC Google 4.37x cell stays unverified until someone finds it on the Searchlight page it claims.
