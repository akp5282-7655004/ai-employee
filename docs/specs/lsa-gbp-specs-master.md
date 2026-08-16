# GOOGLE LOCAL SERVICES ADS + GOOGLE BUSINESS PROFILE — MASTER REFERENCE
Last verified: August 2026. Companion to the Google Ads and Meta Ads master specs.
Purpose: everything Miles needs to (a) audit, (b) build/optimize, and (c) validate an LSA and GBP presence for a home services contractor. Neither product uses "campaigns" the way Google Ads does; both are profile-driven, so the spec is a profile-completeness spec plus the handful of levers that exist.

Benchmarks: the benchmark tab that accompanies this doc is labeled **"Industry benchmarks, aggregated from public sources"** and is public-source until Miles has its own account volume. Never label it as proprietary or attribute it to any named third party.

---

# PART A — LOCAL SERVICES ADS (ads.google.com/localservices)

## A1. What it is
Pay-per-lead (not per click) unit that appears above regular search ads for supported service + geo combinations. Ranking is driven by proximity, review score/volume, responsiveness, business hours, and budget, plus a badge tier. For most home services trades it is the highest-intent channel available.

## A2. Eligibility gate (verify before anything else)
| Requirement | Detail |
|---|---|
| Category supported | Core home services: plumbing, HVAC, electrical, roofing, garage door, water damage/restoration, pest, lawn/tree, cleaning, movers, locksmith, appliance repair, windows/doors/siding, foundation, fencing, flooring, painting, handyman, pool, junk removal, and more. Category list varies by country/state; check the LSA eligibility tool for the exact market. |
| Geo supported | US, CA, UK, DE, FR, ES, IT, IE, AT, BE, NL, CH + limited others. Coverage is metro-level; rural service areas may be unsupported. |
| Verification | Business registration, license check (category/state dependent), insurance proof, owner background check. Technician background checks required for Google Guaranteed in most home services categories. |
| Badge | **Google Guaranteed** (home services; Google backs jobs up to a per-market cap, US $2,000) or **Google Screened** (professional services). Guaranteed is what makes LSA convert. |
| Approval timeline | Typically 1–4 weeks after full submission. Ads do not serve until approved. |

## A3. Profile inputs (the "build")
| Field | Requirement / Limit | Miles validation rule |
|---|---|---|
| Business name | Legal/DBA name; must match license/GBP. No keywords stuffed. | Exact match to GBP name |
| Phone | Google may assign a forwarding number for lead tracking | Must route to a line answered live during hours |
| Service categories | Primary + secondary. Each has its own job-type list. | ≥1 primary; all offered job types checked |
| Job types | Checkbox list per category (e.g. plumbing: drain cleaning, water heater install, leak repair, sewer line...) | Every job type the business actually does is ON; everything else OFF (unchecked jobs = leads that get disputed) |
| Service areas | By zip, city, or radius. Add/remove freely. | Matches actual dispatch footprint; no zips outside license coverage |
| Business hours | Regular + special hours. Affects ranking and lead delivery. | Complete; 24/7 only if a human actually answers |
| Bio / highlights | Short business description; highlight chips (e.g. "Family-owned", "Free estimates", "Licensed & insured", "Serves X area", "Emergency service"). | Highlights present; description mentions trade + area |
| Photos | Min 3–5 recommended; team, trucks, work. No stock. | ≥5 photos |
| License numbers | Required per category/state; displayed on ad | Present and unexpired |
| Booking | Optional Reserve-with-Google/booking link | On if the CRM supports it |
| Messaging | Optional message leads in addition to calls | Recommend ON only with a documented <15-min response process |

## A4. Budget + bidding
| Setting | Options | Notes |
|---|---|---|
| Budget | Weekly budget (Google converts from your target monthly). Google can exceed weekly by up to ~2x in a week but not the monthly cap. | Set from target leads × expected cost per lead for the category/market |
| Bidding | **Maximize leads** (auto, default) or **Max per lead** (manual bid cap) | Start auto; move to manual bid once 30+ leads of history exist |
| Lead types charged | Phone calls (typically ≥30s), messages, bookings | Missed calls still charged; disputes available |
| Cost per lead range | Varies wildly by category and metro (roughly $15 to $300+); water damage, roofing, HVAC replacement at the top; cleaning, handyman at the bottom | Use benchmark tab; never promise a number |

## A5. Ranking levers (what Miles can actually move)
| Lever | Weight (Google's stated factors) | Miles action |
|---|---|---|
| Responsiveness | High | Alert on unanswered leads within 15 min; weekly missed-lead count |
| Review rating + count | High | Review velocity tracker; solicit after job (via CRM) |
| Proximity to searcher | High | Cannot change; but service area hygiene matters |
| Business hours | Medium | Keep accurate; extend if staffed |
| Budget/bid | Medium | Weekly pacing check |
| Complaints / lead marking | Medium | Mark every lead (booked / not booked / spam) within 24h |

## A6. Lead management rules (affect ranking + billing)
- Every lead must be marked with a status in the LSA inbox; unmarked leads hurt ranking.
- Dispute window: within ~30 days for invalid leads (spam, wrong service, outside area, solicitation). Credit is issued as budget, not cash.
- Archive after resolution; keep the inbox clean.
- Call recording is on by default in most markets; use it for lead-quality QA.

## A7. Reporting fields Miles reads
`lsa.leads_total`, `lsa.leads_charged`, `lsa.leads_booked`, `lsa.leads_disputed`, `lsa.cost`, `lsa.cost_per_lead`, `lsa.cost_per_booked`, `lsa.response_rate`, `lsa.avg_response_minutes`, `lsa.rating`, `lsa.review_count`, `lsa.impressions` (where exposed), `lsa.budget_weekly`, `lsa.budget_utilization`.

## A8. LSA launch / audit checklist
Category + geo eligible → license/insurance/background docs submitted → Guaranteed badge live → business name matches GBP → all job types checked → service areas = dispatch footprint → hours complete → ≥5 real photos → highlights set → phone answered live → weekly budget set from target leads → auto bidding → lead-marking SLA 24h → review solicitation live → dispute process documented.

---

# PART B — GOOGLE BUSINESS PROFILE (business.google.com)

## B1. What it is
The free listing that powers Maps, the local pack, and Knowledge Panel. It is the review source for LSA, the location asset source for Search/PMax, and often the largest organic lead source a contractor has. Miles treats it as a connector (read via Business Profile API) and as a completeness/hygiene target.

## B2. Profile fields + limits
| Field | Limit / Rule | Miles validation |
|---|---|---|
| Business name | Real-world name only. No keywords, taglines, service areas, or phone in name (suspension risk). | Flag any name containing a service or city word not in the legal name |
| Primary category | 1. Single most important ranking input. Pick the most specific match (e.g. "Plumber", "HVAC contractor", "Roofing contractor"). | Present; matches primary trade |
| Additional categories | Up to 9 more. | Add every category the business legitimately serves; no unrelated ones |
| Address vs service area | Storefront businesses show address. **Service-area businesses (most contractors) hide address and set service areas** (up to 20 areas by city/zip/region; ~2-hour drive limit). | SAB: address hidden; ≥1 service area; areas match dispatch |
| Phone | Primary + up to 2 additional. Local number preferred; call tracking numbers only as additional/secondary. | Primary = the number on website + LSA + citations (NAP consistency) |
| Website | Homepage or location page URL | Reachable, HTTPS, matches brand |
| Hours | Regular + special hours + "more hours" (e.g. emergency) | Complete; holiday hours set |
| Business description | **750 chars max**; first ~250 shown before "more". No URLs, no promotional pricing, no keyword stuffing. | Present; mentions trade + area + differentiators |
| Opening date | Optional | Set (helps "years in business") |
| Attributes | Category-dependent chips: "Identifies as veteran-owned", "Online estimates", "Onsite services", accessibility, payment types, etc. | All applicable ON |
| Services | Per category, add services with name (**≤120 chars**), optional description (**≤300 chars**), optional price/price range. Google also auto-suggests services. | ≥5 services under primary category; each with description |
| Products | Optional. Product name ≤58 chars, description ≤1,000 chars, image 1:1 (min 250x250), price optional, button (Order/Buy/Learn more/Get offer). | Not required for contractors; use for financing/maintenance plans if desired |
| Photos | Logo (1:1, min 250x250, rec 720x720+), cover (16:9, rec 1024x576+, Google may crop), then business photos. **JPG/PNG, 10 KB to 5 MB, min 720x720, well-lit, no heavy filters/text.** | ≥20 photos total; logo + cover present; new photos monthly |
| Videos | ≤30 sec, ≤75 MB, min 720p | Optional |
| Booking / appointment link | Reserve with Google partner or URL | On if available |
| Messaging | Chat toggle; must respond within 24h or Google may disable | ON only with response process |
| Q&A | Public. Business can seed and answer. | Seed 5–10 FAQ pairs; monitor weekly |
| Posts | Update / Offer / Event types. **Text ≤1,500 chars (~80–100 shown in card)**; image 4:3 rec 1200x900 (min 480x270 / 400x300); optional CTA button (Book, Order, Buy, Learn more, Sign up, Call). Offers need title + start/end. Posts expire from the carousel after ~6 months (offers/events at end date). | ≥1 post every 7–14 days |
| Reviews | Owner replies (public); can request reviews via short link (`g.page/r/.../review`). Cannot gate or incentivize. | Reply to 100% of reviews within 48h; reply length ≥1 sentence, no templates verbatim |

## B3. Ranking inputs (Google's three: relevance, distance, prominence)
| Lever | Miles action |
|---|---|
| Primary category correctness | Audit; recommend change if wrong |
| Review count, rating, recency, keyword content | Velocity tracker; solicitation flow via CRM; reply monitor |
| Profile completeness | Score against B2; flag gaps |
| Photo volume/recency | Monthly photo prompt to owner |
| Posts cadence | Draft posts from seasonality skill |
| NAP consistency across web | Citation check (name/address/phone match on site, LSA, top directories) |
| Website landing relevance | Link to service pages; ensure page mentions city + service |
| Spam competitors | Suggest edit / redressal form for keyword-stuffed competitor names |

## B4. Reporting fields Miles reads (Business Profile Performance API)
`gbp.impressions_search`, `gbp.impressions_maps`, `gbp.calls`, `gbp.website_clicks`, `gbp.direction_requests`, `gbp.messages`, `gbp.bookings`, `gbp.review_count`, `gbp.rating`, `gbp.reviews_new_30d`, `gbp.reviews_replied_pct`, `gbp.avg_reply_hours`, `gbp.photos_count`, `gbp.posts_last_30d`, `gbp.completeness_score` (calc).

## B5. GBP audit / build checklist
Claimed + verified → real name only → correct primary category + up to 9 secondary → SAB address hidden + service areas set → primary phone = website = LSA → hours + special hours → 750-char description → ≥5 services w/ descriptions → attributes → logo + cover + ≥20 photos → messaging on/off decision → 5–10 seeded Q&A → posting cadence set → review link in CRM post-job flow → 100% reply SLA → citation consistency check.

---

# PART C — HOW THE THREE PLATFORMS RELATE (for the Channel Comparator skill)
- GBP reviews → LSA rating → LSA rank. GBP is upstream of LSA.
- GBP → Location asset in Search/PMax; profile quality shows in ad.
- LSA leads are pay-per-lead; Search/PMax are pay-per-click; GBP is free. Comparator must normalize on **cost per booked job**, not CPL, and treat GBP cost as $0 + Miles time.
- Missed-call leak applies to all three: an unanswered LSA lead is still charged; an unanswered GBP call is lost for free; an unanswered Search call cost a click. Dollarize each separately in the CPL + Funnel Reader.
