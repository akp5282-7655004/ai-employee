# Miles autopilot plan

For the owner. Implementation is paused. This file is the plan, not a claim that the new journey is built.

Miles replaces a marketing agency. The owner answers calls, books jobs, and finishes jobs.

Two modes:

- **Automate everything.** Business info, connected accounts, and three answers (goal, daily budget, leads per day). Miles does the work. The owner only approves spend, or sets caps in advance. Default.
- **Manual.** The same tools, visible and editable, for an owner who wants to run a piece themselves.

Nothing spends or turns on without an approval, unless the owner has already set a cap and the move is inside it. Every automatic move is logged and reversible. Numbers come from the account or from the Searchlight benchmark file. If a number is not there, Miles says so.

Labels used below: **works**, **partial**, **broken**, **fake-or-misleading**, **dead**.

---

## 1. What is in the app today

The app is one large screen (`web/index.html`) plus API routes in `src/server.ts`. Most pages are real code. The problem is that the home screen still looks like a toolbox, several screens show sample or invented numbers, and a few buttons claim a create that Pipedream cannot do.

### Pages

| Page | Status | Evidence |
| --- | --- | --- |
| Dashboard | partial | Real spend, leads, and reviews when a snapshot exists. Also loads the command-center widgets underneath, which can show sample metrics. |
| Launch → Plan | partial | `POST /api/journey/plan` builds a paused Search plan from the profile. It still asks the owner to press a button, and it refuses if profile fields are empty. |
| Launch → Google Ads | partial | Paused Search create is wired through Pipedream (`google_ads-create-or-update-campaign` and the ad-group, keyword, and RSA steps). The form still says Miles does not fill in the goal, budget, or landing page. |
| Launch → Facebook | fake-or-misleading | Builds a Meta spec. `POST /api/meta/launch` always returns 409. Pipedream has no verified Meta campaign action (`facebook-ads` 404, Graph API has zero actions). |
| Launch → Ad Copy | partial | Trade packs and copy tools exist. They are a manual studio, not the automatic plan. |
| Studio → Create / Edit / Schedule | partial | Image, voice, and video generation is real when a media key is set, and it is the thing credits are meant to pay for. Scheduling a post needs an asset URL. Nothing auto-creates a week of posts. |
| Ads Manager | partial | Reads campaign rows from the stored snapshot and can queue budget changes. It is not the home. |
| Local Presence | partial | A checklist the owner answers by hand. It does not crawl Google Business Profile. |
| Competitors → Ads & Market Scan | partial | Website competitive audit is a real crawl. Google Ads Transparency and the Meta Ad Library are labeled capture-only. US commercial ads are not returned by the Ad Library API. |
| Competitors → Market Map | partial | Census affluence by ZIP when `CENSUS_API_KEY` is set. Empty and honest when it is not. |
| Competitors → Demographics | partial | Same research stack. Not part of a guided crawl. |
| Audits | works | Homepage score is computed from the HTML (HTTPS, phone, H1, schema). The written summary is a fixed fallback unless an LLM key is set. |
| Analytics | fake-or-misleading | Trade charts fall back to sample ranges (painting CPL 28 / 41 / 96 and similar) when live numbers are missing. |
| Benchmarks | works | Searchlight figures already live in `src/packs/benchmarks.ts` (LSA, Google Ads, Facebook ROAS). The page label still says "public sources" and does not say Searchlight. Painting has no Google Ads CPL row. |
| Recommendations | partial | Built from real spend, leads, reviews, and scheduled posts. Applying one queues a deploy item. It does not change Google by itself. |
| Growth Autopilot | partial | Proposes budget moves from real spend and booked jobs. Apply requires confirm. Default autonomy is 50, and the screen copy says Miles runs day-to-day optimization on its own. |
| Playbooks → Skills | partial | Eight marketplace packs (Google, Meta, LSA, SEO, reviews, weather, email, calls). A play returns LLM text, or a template if no key. It does not launch ads. |
| Playbooks → Marketplace | fake-or-misleading | About 69 vendored marketing-skill essays plus the 11 Miles skills. They are documents. The storefront can look like Miles runs them. |
| Playbooks → GHL Workflows | partial | 32 recipes with real steps. Nine are flagged `milesRuns` in data. Only instant lead response and missed-call text-back are actually sent, and only when GoHighLevel is connected and the owner turned speed-to-lead on. There is no opportunity-create action in the Pipedream HighLevel list. |
| Business Profile | partial | Editable form. "Import" crawls a URL (`POST /api/import-site`) and fills what is on the page. Hours, license, logo, and colors are filled only when the HTML contains them. Google Business Profile is not read. |
| Brand / Assets | partial | Brand kit and saved files. Not filled by the signup crawl. |
| Integrations | partial | Pipedream Connect is the only connector. The page says Miles runs across all of them and "3,000+ apps". Most catalog apps have no Miles action. Meta Ads in the fallback list is not a verified campaign app. |
| Automations → Plays | partial | Speed-to-lead, review ask, no-show, and new-customer welcome. Each sends only through a connected GoHighLevel action. Off until the owner turns it on. |
| Scheduled tasks | partial | Sixteen task types (morning brief, performance, social, SEO, competitor watch, and others). They run on the 60-second scheduler only after the owner deploys one. Competitor watch is an LLM write-up, not a crawl. |
| Weather | partial | Live weather by ZIP, plus suggested triggers. It does not change ad spend. |
| Autonomy | fake-or-misleading | Levels 10 / 20 / 50 / 100. The recommended 50% copy says Miles runs optimization on its own. Nothing in that screen enforces a weekly spend cap. |
| Approvals | partial | A real log (who, when, what) plus per-skill propose vs auto for loser-pauser and budget-shifter. Approving a skill records the decision. It does not write the change to Google. |
| Account | works | Password, session, Google sign-in when configured. |
| Plan & Credits | partial | Launch offer ($0, first 100 accounts, $100 media credits), Stripe checkout, and webhook grant-after-payment exist on `main`. The live billing page the owner saw hid the $100 line when Stripe was connected. This branch shows it. An empty balance still blocks skill runs and ad create. The page must not say those are unlimited until that code changes. |
| System Health | partial | Lists automations, data sources, and missing keys from stored state. It is not the morning home. |
| Change Log | partial | Deploy queue and versions. Useful. Buried under Settings. |
| Ask Miles / Chat | partial | Real chat when an LLM key is set. Demo-safe fallback when it is not. Not the onboarding path. |
| What Miles Does (`agents`) | fake-or-misleading | Hardcoded "4 Running" and "$110 Market Median". Not in the nav. Reachable only as page id `agents`. |
| Agent wireframe | dead | A designer for custom agents. Not on the path to leads. |
| Campaigns (`team`) | partial | Another campaign builder. Overlaps Launch. |
| Command center (under the dashboard) | fake-or-misleading | Custom KPI widgets. Sample series are still in the page. |
| Sidebar "New project" and "Active playbooks" | fake-or-misleading | Static pills: Home Services, Roofing Restoration, Dental Practice, Solar Energy. They are not accounts. |
| Onboarding overlay | partial | First login asks for a website and a long form. It is not "a URL, then Crawl", and it does not run the three audits. |
| Login, signup, password reset, terms | works | Covered by tests. Signup seeds the launch offer when a slot remains (cap 100). |

### Dashboard sections on the home screen

| Section | Status | Evidence |
| --- | --- | --- |
| Greeting and date range | works | Cosmetic. The range is sent to `/api/dashboard`. |
| 30-second read | partial | Uses dashboard KPIs. Empty or sample depends on the snapshot. |
| Decisions waiting | partial | Recommendation cards. Not the only approval inbox. Skill proposals live on another page. |
| Pending approvals, agents, credits, weather | partial | Counts from stored data. "Credits used" reads like a meter on monitoring. |
| Speed-to-lead card | partial | Real toggle and webhook. Sends only when GoHighLevel is connected. |
| Review card | partial | Drafts a review ask. Sends when the review automation is on. |
| More instant automations | partial | No-show and welcome texts. Same GoHighLevel limit. |
| Marketing performance | works | Shows spend only when the snapshot has it. Says Meta is not connected. |
| Leads and reputation | partial | Real when CRM or reviews are in the snapshot. |
| Social | partial | Reads connected social metrics. Does not mean Miles is posting. |
| Upcoming posts | works | Lists posts the owner scheduled. |
| Recent agent activity | works | Lists scheduler runs. Empty until a task is deployed. |

### The 11 scheduled skills

All 11 exist in `src/skills/seven.ts`. None has its own clock. They run when the owner presses Run, or when that skill is deployed onto the generic scheduler. Approving one writes a log line. It does not push negatives, pauses, or budget edits to Google.

| Skill | Status | Evidence |
| --- | --- | --- |
| Search Term Gold Miner | partial | Uses real search terms when the snapshot has them. This branch stops the fake "painter jobs near me / $42" rows. |
| Negative Keyword Implementer | partial | Same. Empty state no longer invents a list or "$86". Apply is still "paste into Google Ads". |
| Loser Pauser | partial | Real rows only, and only when spend is on file. Approve does not pause the campaign. |
| Budget Shifter | partial | Proposes a move from real rows. Caps are described in text. The daily percent, floor, and monthly ceiling are not enforced on a Google write. |
| Spend Pacing Monitor | partial | Real math when spend and a monthly budget exist. Empty state still says `source: 'sample'`. |
| CPL + Funnel Reader | partial | Reads the metrics resolver. With no data the readout is zeros, which can look like a real "$0 spent → 0 leads" report. |
| Channel Comparator | partial | Adds Google, LSA, and Meta spend from the resolver, including zeros. Cost per booked job is only as real as the CRM ledger. |
| Ad Copy Performance Ranker | fake-or-misleading | Always `source: 'sample'`. No per-headline stats are read. |
| Service Area Audience Builder | partial | Builds a targeting note from profile ZIPs. Marked `sample`. Does not create an audience. |
| Seasonality + Demand Layer | partial | Month plus profile services. The note says the weights are a template. |
| Campaign Launcher | partial | Points at the Launch pages. It does not launch. The Meta line still describes a Facebook launch that cannot be created. |

### Other features

| Feature | Status | Evidence |
| --- | --- | --- |
| Paused Google Search create | works | Live create already succeeded once for the painting account. This branch tightens the copy rules and treats any failed ad as a partial, not a success. |
| Enable / pause revert | partial | Separate approval calls `setGoogleCampaignStatus`. It is not one button on the home screen. |
| Website crawl | works | `parseSiteHtml` / `importSite`. Server-side fetch. Tests can pass HTML. |
| Google Business Profile crawl | dead | No Places read on signup. Local Presence is a questionnaire. |
| Competitor crawl | partial | Needs the owner to type competitor URLs, or Places when `GOOGLE_PLACES_KEY` is set. Never invents their spend. |
| Performance vs benchmark | partial | Benchmarks module is real. It is not run automatically after connect, and the customer-facing label hides "Searchlight". |
| SEO page drafts | dead | The SEO scheduled task writes a blog outline when someone deploys it. Nothing saves site pages or publishes them. |
| Organic social, approval-gated | partial | Captions can be generated. Posts publish only if a platform is connected and the owner scheduled an asset. No automatic week of posts. |
| Booked jobs / cost per booked job | partial | `POST /api/jobs/mark` and the CRM ledger. Empty until someone marks jobs. |
| Morning brief | partial | A schedulable task, not the default home. |
| Monitoring on an empty credit balance | partial | Dashboard reads are not metered. Skill runs and "output" work still stop at $0 in `chargeCredits` / `canAfford`. Ad create stops in `adSpendAllowed` when credits remaining are 0. |
| Launch offer | partial | Granted on signup in the database. Easy to miss on the billing page when Stripe is connected. This branch makes the $100 line show. Not deployed. |
| Admin invites | works | Owner-only routes. |

### Integrations (what Pipedream actually allows)

| Connection | Status | Evidence |
| --- | --- | --- |
| Google Ads | works | Verified actions for paused campaign, budget, ad group, keywords, RSA, and reporting. Customer id must be selected. A manager account with no client looks blank if that step is skipped. |
| TikTok Ads | partial | Create exists and is forced `DISABLE` (off). It is a campaign shell, not an ad, and it is not part of a $20 Search plan. |
| Meta Ads | broken | No verified create action. Launch is refused on purpose. |
| Facebook Page posts | partial | `facebook_pages-create-post` exists. That is an organic post, not an ad. Not wired as the campaign path. |
| Instagram | broken | Catalog pages 404. A Facebook connection is not an Instagram ad account. |
| GoHighLevel | partial | `highlevel_oauth` has six actions, including upsert contact. No opportunity action. Workflows are not created inside GHL. |
| Google Business Profile | dead | Not in the verified catalog wiring used for crawl or reviews. |
| Email / SMS delivery | partial | Needs the host email provider. Drafts always work. |
| Stripe | partial | Checkout, portal, and webhook exist. Credits are granted only after a succeeded payment. Needs the owner's Stripe keys and webhook on the host. |
| Google Places, Census, media keys | partial | Features stay empty or demo-safe until the key is on the host. |

### Routes

Auth and account: `/auth/signup`, `/auth/login`, `/auth/logout`, `/auth/forgot`, `/auth/reset`, `/auth/google`, `/auth/me`, `/auth/change-password`. **Works.**

Billing: `GET /api/billing`, checkout, portal, auto-top-up, top-up, `POST /api/stripe/webhook`. **Partial.** Money path is real. Empty-balance rules do not match the marketing promise yet.

Google create: `/api/campaign/draft`, `/autofill`, `/speccheck`, `/launch`, `/api/gads/targets`, `/api/google-ads/customer`, `/api/journey/plan`, `/approve`, `/activate`, `/revert`. **Partial.** Paused create works. The journey still depends on a filled profile and a separate goal.

Meta and TikTok: `/api/meta/status`, `/api/meta/build`, `/api/meta/launch`, `/api/tiktok/launch`. Meta launch is **broken** by missing Pipedream actions (refused in code). TikTok is **partial**.

Profile and research: `/api/profile`, `/api/import-site`, `/api/audit`, `/api/competitive/audit`, `/api/competitors`, `/api/market/*`, `/api/benchmarks`. **Partial.** Each is a separate tool.

Skills and schedule: `/api/skills7/:key/run`, `/api/skills7/act`, `/api/skills`, `/api/skills/play`, `/api/schedules`, `/api/cron/tick`, `/api/wireframes/*`. **Partial.** The tick runs every 60 seconds unless `MILES_NO_SCHEDULER` is set.

CRM and leads: `/api/speed-to-lead`, `/api/hooks/lead/:token`, `/api/journey/leads/:token`, `/api/jobs/mark`, `/api/review-request`, `/api/hooks/job/:token`, `/api/automations`, `/api/hooks/appointment/:token`, `/api/hooks/deal/:token`, `/api/ghl-playbook`. **Partial.**

Home and inbox: `/api/dashboard`, `/api/recommendations`, `/api/approvals`, `/api/autonomy`, `/api/autopilot`, `/api/health`, `/api/growth/plan`, `/api/growth/apply`. **Partial.** Several inboxes, not one.

Creative: `/api/studio`, `/api/creative`, `/api/posts`. **Partial.** Media is the metered part.

Connections: `/api/connections`, `/api/connect-token`, `/api/apps`, `/api/integrations/pipedream`. **Partial.**

---

## 2. Promises and the owner's flow

### Marketing-site checklist

| Promise | Today | Gap |
| --- | --- | --- |
| Onboarding is a URL, not a form. Crawl fills profile, services, areas, hours, license, colors, logo. | **Partial.** Import-from-URL exists and only keeps facts present in the HTML. | Signup is still a long form. Google Business Profile and social profiles are not crawled. Missing hours or license stay blank, which is correct. The wizard that runs crawl then audits is not built. |
| 11 skills, each on its own daily, weekly, or monthly schedule, each returning approve or dismiss. | **Partial.** The 11 runners exist. | No per-skill cadence unless the owner deploys them by hand. Approve does not apply the change in Google. Four of them still look like samples or zero-filled reports. |
| Approvals queue | **Partial.** `/api/approvals` plus recommendation cards. | Split across Dashboard, Approvals, Growth, and Skills. |
| Autonomy: start cautious, loosen one area at a time | **Fake-or-misleading.** | Default stored autonomy is 50, and the copy recommends co-pilot. Rules that auto-approve only inside a cap are not built. New file `src/agents/autopilot.ts` sketches this and is not called. |
| Change log with who approved and when | **Works.** The approval log stores actor and time. | It is under Settings, not on the home screen. |
| System health | **Partial.** | A settings tab, not a home alert. |
| Scheduled tasks | **Partial.** | Owner-built schedules, not the 11 skills on their own clocks. |
| One morning brief: yesterday, and what needs a decision today | **Partial.** | A task the owner must turn on. The dashboard greeting is not that brief. |
| Recommendations list | **Partial.** | Real when data exists. Easy to confuse with sample analytics. |
| Growth Autopilot inside guardrails | **Partial.** | Proposals are real. The guardrail is a percent on the autonomy screen, not a hard ceiling on the Google write. |
| Monitoring never stops on an empty credit balance. Credits only for images $0.10, voice $0.50, video $1.50. Campaigns, launches, and skill runs are unlimited. | **Partial.** | Prices match `WORK_COSTS`. Monitoring reads are not charged. Skill runs and other "output" still stop at $0. Ad create stops when the plan has no credits left. |
| GoHighLevel: Miles already runs the top speed-to-lead recipes and hands the rest over as build-ready recipes. | **Partial.** | Instant response and missed-call text-back can send. The other 30 are recipes. The data file still marks nine as `milesRuns`. This branch's screen copy is closer to the truth. Opportunity create is not in Pipedream. |

### Owner's flow

| Step | Today | Blocker |
| --- | --- | --- |
| 1. Sign up. Name, location, email, Google Business Profile. Click Crawl. | Signup collects email and password. The overlay then asks for a website and a long profile. | No single Crawl step. GBP is not read. Social links are stored only if the website HTML contains them. |
| 2a. Business and website audit | **Works** as a separate Audits page. | Not stored as part of onboarding. Not shown on the home screen. |
| 2b. Competitor audit from public data only | **Partial.** Site crawl and, with a Places key, nearby listings. | Google Ads Transparency has no API. Meta Ad Library does not return US commercial ads. Miles must say "not available" and must not invent spend. |
| 2c. Performance audit of connected accounts vs Searchlight | **Partial.** Snapshot spend is real. Benchmarks are real. | Not run in order after connect. Painting has no Searchlight Google Ads CPL. The page does not say Searchlight. |
| 3. Build ads, SEO pages, campaigns, and scheduled organic posts | Ads and a paused Search campaign can be built. | SEO pages are not saved. Social posts are not auto-created. Meta and LSA campaigns cannot be created. |
| 4. Connect Google, Facebook, and the rest. Three questions only: goal, daily budget, leads per day. Show budget ÷ leads = required CPL vs the benchmark. Split budget. Build paused. One approval to go live. | Google connect and paused create exist. The launch form asks for more than three answers and does not show the feasibility math. | Facebook create is impossible until Pipedream has a campaign action. At $20/day Miles should not pretend to split onto Meta. LSA has no create action. "Go live" must stay a second approval. The first approval only creates paused. |
| 5. Autopilot loop | Scheduler, proposals, and a change log exist as separate tools. | They are not one loop on the home screen, and they do not run the 11 skills on their own from real data only. |

---

## 3. Proposed shape

### Automate everything (the home)

After signup the owner sees one path:

1. Name, location, email, website, Google Business Profile link. One Crawl button.
2. Three saved audit cards: website, competitors, performance. Each card says where the number came from. Missing data says "not found" or "coming soon".
3. Connect Google. Facebook, Instagram, and Local Services Ads show as connected or as coming soon. A Facebook Page is not shown as an ad account.
4. Three questions: goal, daily budget, leads wanted per day.
5. The math: daily budget ÷ leads per day = the cost per lead those answers require, next to the Searchlight figure for that trade. If Searchlight has no painting row, say so. If $20 a day and 2 leads a day need a $10 lead, and the nearest Searchlight Google Ads figures are over $100, say the target is not realistic and still allow a paused campaign.
6. One plan: Google Search, created paused. Meta and Local Services Ads get a written plan and ad drafts marked **coming soon**. No spend.
7. One approval creates the paused campaign. A second approval turns it on.
8. From the next morning the home is only: what happened yesterday (real numbers or "nothing on file"), what needs a decision today, health (disconnected account, missing ad, low budget vs target, credits), and the change log.

Spend approvals stay on that list. Optional rules, off by default: auto-approve a pause or a budget move inside a weekly cap and a max percent. Never auto-create and never auto-enable.

### Manual mode

One section, not the default, labeled Manual:

- Edit the business profile, the paused campaign, keywords, and ads.
- Ads Manager and the change log.
- Creative Studio and the content calendar.
- The 11 skills, run by hand.
- Audits, benchmarks, and the GoHighLevel recipe book.
- Billing.

### Remove, merge, or hide

Remove from the default view:

- Sidebar "New project" and the four fake playbook pills.
- The "What Miles Does" page with "4 Running" and "$110 Market Median".
- Sample analytics charts and sample command-center widgets.
- The Facebook launch button, until a real create exists. Keep the draft behind "coming soon".
- The line that says Miles runs day-to-day optimization on its own, until a capped rule actually does that.
- The 69 generic skill essays from the default nav.

Merge:

- Launch, journey plan, team campaign, and Campaign Launcher into the one paused plan.
- Recommendations, Growth Autopilot, and skill proposals into one approval list.
- Morning brief, daily recommendations, and the 6pm wrap into the one morning card.
- Website import, website audit, and competitor audit into the Crawl step.

---

## 4. Build order

No production changes in this step. Later deploys are the owner's call.

### Phase 1. A painting contractor can get Google leads on autopilot

This is the smallest path that matches the promise for one trade and one channel.

Scope:

- Finish the Search copy rules already started on this branch, and add tests for them (no offer phrases as ad groups, no all-caps, no mid-sentence cuts, no negative word inside a keyword, Search only, honest campaign name).
- Replace the launch form with Crawl plus three questions. Show the CPL math and the Searchlight comparison.
- Create one paused Google Search campaign. Warn when the budget is far below the target. Second approval to enable. If one ad fails, say which ad group has no ad.
- Home screen: yesterday, decisions, health, change log. Hide the fake pills and the sample widgets.
- Run the 11 skills from real snapshot data on a schedule. Empty data stays empty. Approve and dismiss land in the log. Do not write to Google until that specific approval exists.
- Credits: monitoring, campaign create, and skill runs keep going at $0. Credits charge only for image, voice, and video. This is not how the code works today.
- Billing page shows the $0 plan and the $100 media credits for launch-offer accounts.

Risks:

- Painting has no Searchlight Google Ads cost-per-lead. The screen has to say "estimate" or "not in the benchmark". Do not invent one.
- A paused campaign does not produce leads until the owner approves enable, and a $20/day budget may not buy a lead a day.
- Customer id must be selected or the create has nowhere to go.

Needs the owner, not this draft:

- Say yes to this phase before more code.
- Google Ads connected on the live account, with the right customer id.
- A later deploy. This draft does not deploy.
- Stripe keys only if you want paid bands beyond the launch offer.

### Phase 2. The three audits, saved and shown

Scope: after Crawl, store the website audit, a competitor card (public sites and Places only), and a performance card against the Searchlight file. Show them on the home screen.

Risk: competitor ad spend will stay "not available" for Google Transparency and Meta. That is the honest result.

Needs the owner: `GOOGLE_PLACES_KEY` if nearby competitors should include ratings. Without it, Miles only uses websites the crawl or the owner supplied.

### Phase 3. Drafts Miles can hand over, not publish

Scope: SEO page drafts from real service lines. A week of organic captions saved as posts that wait for approval. Meta and Local Services Ads plans and ad text, labeled coming soon, with no create button.

Needs the owner: nothing to go live. Publishing to a Facebook Page is a later, separate approval, and it is still not an ad.

### Phase 4. Follow-up that actually sends

Scope: keep instant lead response and missed-call text-back as the only recipes Miles runs. Leave the other 30 as paste-ready recipes. Add opportunity create only if Pipedream lists that action.

Needs the owner: GoHighLevel connected on `highlevel_oauth`, and speed-to-lead turned on.

### Phase 5. Manual mode as a tidy toolbox

Scope: move the remaining pages under Manual. Turn off the co-pilot wording. Drop or hide the unused skill library from the nav.

---

## 5. What this branch already changed

Branch `cursor/search-copy-quality-0b66`, based on `main` at `c23d58a`. Not deployed. No live Google, Stripe, Pipedream, or GoHighLevel calls were made for this work.

Done in code, not finished as a product:

- Search campaign copy in `src/agents/campaign.ts`. Ad groups come from trade service lines. Offer phrases such as "free quote" are stripped. Headlines are title case. Networks are Google Search only. The campaign name is trade, city, Search, and Planned or Emergency. Business names are shortened so "Philadelphia's #1" does not become the asset.
- A failed responsive search ad no longer counts as a successful launch. The response can name the missing ad (`src/agents/googlelaunch.ts`). There is no retry button yet.
- Four skills stop inventing sample dollars when no spend or search terms are on file (loser pauser, budget shifter, gold miner, negative keywords). The other seven were not all cleaned. Spend pacing still marks an empty run as `sample`. The ad-copy ranker is still a sample.
- Billing API returns `launchGrant: 100` and a launch-offer note even when Stripe is connected. The billing page shows "$100 in media credits" and the remaining balance, and it labels the band "Launch offer". The note does **not** say campaigns and skill runs are unlimited, because the code still pauses them at $0.
- GoHighLevel screen: recipes 1 and 2 say Miles runs them when GoHighLevel is connected. Other `milesRuns` recipes say partial. The rest say build-ready. The underlying flags were not changed, so older copy elsewhere can still overclaim.

Started and not wired:

- `src/agents/autoplan.ts` can build a sourced plan from HTML plus the profile. Nothing calls it.
- `src/agents/autopilot.ts` sketches inbox cards, a morning brief, and rules that default to off. Nothing calls it. `src/server.ts` imports both files and does not use them.
- The launch screen still has the old goal form.
- The guided wizard (crawl, three audits, three questions, one approval) is not built. That is what this plan is for.

Checks run on this branch before the plan was committed:

- `npx tsc -p tsconfig.json --noEmit` passed.
- `npx tsc -p tsconfig.build.json` passed.
- `npx vitest run` passed: 66 files, 722 tests.

Those tests are the existing suite. There is no new test yet for the painting copy rules, the failed-ad case, or the billing-page wording. The old campaign tests still passed, which means the generator did not break their assertions. It does not prove the live painting bugs are covered.

Do not merge this draft. Phase 1 should be reviewed from this document first.
