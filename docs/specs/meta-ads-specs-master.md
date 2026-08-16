# META ADS CAMPAIGN BUILD SPECIFICATIONS — MASTER REFERENCE
Last verified: August 2026
Purpose: Complete parameter reference for AI-driven campaign builds on Meta (Facebook, Instagram, Messenger, Threads, Audience Network). Companion doc to the Google Ads master spec.

Structure rule: Meta is a strict 3-tier hierarchy — CAMPAIGN (objective + budget mode) → AD SET (audience, placements, optimization, schedule, budget if not CBO) → AD (creative, copy, URL, CTA). The objective is the ONLY setting that cannot be changed after launch.

---

## 1. CAMPAIGN LEVEL — THE 6 OBJECTIVES (ODAX)

There are exactly six campaign objectives. The objective determines which optimization events, formats, and tools are available downstream.

| Objective | Optimizes for | Unlocks | Use when |
|---|---|---|---|
| Awareness | Ad recall, reach, video views | Reach & frequency buying, brand lift | Launches, new markets, top of funnel |
| Traffic | Link clicks, landing page views | — | Content promotion only. Almost never for lead gen or ecommerce (trains algorithm on clickers, not buyers) |
| Engagement | Post engagement, video views, messages, Page likes, event responses | Click-to-Messenger/WhatsApp/IG Direct ads | Community building, message-based selling |
| Leads | Lead form submissions, calls, conversions, sign-ups | Instant Forms, call ads, conditional/qualifying forms | Home services, B2B, any lead gen |
| App Promotion | App installs, app events | Advantage+ App Campaigns, SKAdNetwork/AEM setup | App installs and re-engagement |
| Sales | Purchases, add-to-cart, initiated checkout | Advantage+ Sales, Advantage+ catalog ads (DPA), dynamic creative | Ecommerce, any purchase-tracked business |

### Campaign-level parameters
| Parameter | Options |
|---|---|
| Campaign name | Internal |
| Buying type | Auction (default) or Reservation (Awareness/Engagement only, fixed CPM) |
| Special Ad Category declaration | REQUIRED if ads relate to: Credit, Employment, Housing, Social issues/elections/politics, or Financial products & services. Restricts targeting (no age/gender/zip/detailed targeting; audiences become "Special Ad Audiences") |
| Advantage+ Campaign Budget (CBO) | ON = Meta distributes budget across ad sets dynamically. OFF = manual budget per ad set |
| Daily or lifetime budget | Daily can overspend up to 75% on strong days (weekly average holds). Lifetime enables ad scheduling/dayparting |
| A/B test toggle | Optional split test at creation |
| Advantage+ ON/OFF | For Sales, App, Leads objectives: enabling Advantage+ automation (now the default path) hands audience, placement, and budget decisions to Meta |
| Spending limit | Optional campaign cap |

### Advantage+ automated campaign types (built on top of objectives)
| Type | Underlying objective | What Meta automates | Manual inputs remaining |
|---|---|---|---|
| Advantage+ Sales (formerly ASC) | Sales | Audience (full country), placements, budget allocation | Country, budget, existing-customer % cap, creative, optional catalog |
| Advantage+ App Campaigns | App Promotion | Audience, placements | Country, budget, app, creative |
| Advantage+ Leads | Leads | Audience expansion, placements | Form, budget, creative |

---

## 2. AD SET LEVEL — PARAMETERS

| Parameter | Options / Limits |
|---|---|
| Conversion location | Website, App, Website+App, Messenger, WhatsApp, Instant Forms, Calls, In-ad (varies by objective) |
| Performance goal (optimization event) | Objective-dependent. Sales: Purchase, Add to Cart, Initiate Checkout, Value (ROAS). Leads: Leads, Conversion Leads, Calls. Awareness: Reach, Ad Recall Lift, ThruPlay, 2-sec views |
| Pixel / dataset | Required for website conversion optimization. Conversions API (CAPI) strongly recommended alongside pixel |
| Cost controls | Optional: Cost per result goal (cost cap), Bid cap, ROAS goal. Default = Highest volume (no cap) |
| Budget (if not CBO) | Daily or lifetime per ad set. Learning phase needs ~50 optimization events per ad set per week |
| Schedule | Start/end. Dayparting only with lifetime budgets |
| Audience — Advantage+ Audience (default) | You provide audience *suggestions* (custom audiences, interests, age floor); Meta expands freely |
| Audience — original/manual | Locations (country/region/city/zip/radius, min 1-mile radius), age 18–65+, gender, languages, Detailed Targeting (interests/behaviors/demographics), Connections |
| Custom Audiences | Sources: customer list (email/phone upload), website visitors (pixel, 1–180 days), app activity, engagement (IG/FB profile, video views, lead forms, events), offline activity. Include or exclude |
| Lookalike Audiences | Source audience min 100 people (1,000+ recommended) from one country; size 1%–10% of target country. Largely superseded by Advantage+ Audience but still buildable |
| Placements — Advantage+ (default, recommended) | Meta serves everywhere: FB Feed, IG Feed, FB/IG Stories, FB/IG Reels, Reels overlay, In-stream video, FB Marketplace, FB Right column, IG Explore, IG Search, Messenger Inbox/Stories, Threads, Audience Network |
| Placements — manual | Select individual placements; device (mobile/desktop); OS; Wi-Fi only toggle |
| Brand safety | Inventory filter (Expanded / Moderate / Limited), block lists, content exclusions |
| Attribution setting | 1-day click, 7-day click (default), +1-day view / 1-day engaged view (video) |

---

## 3. AD LEVEL — TEXT FIELDS (all formats)

| Field | Recommended (visible) limit | Hard max | Notes |
|---|---|---|---|
| Primary text | 125 chars before "See more" truncation on mobile | ~2,200 | Up to 5 variations allowed per ad (Meta rotates/optimizes). First 2–3 lines are what matters |
| Headline | 27 chars safe; 40 chars on most placements | 255 | Up to 5 variations |
| Description | 27–30 chars | ~30 | Shows on some placements only (link description below headline). Up to 5 variations |
| Display link | Auto from URL | — | — |
| Final URL | Required (website conversions) | — | UTM parameters field built in |
| CTA button | Select from fixed list | — | Shop Now, Learn More, Sign Up, Get Quote, Contact Us, Book Now, Subscribe, Download, Get Offer, Apply Now, Call Now, Send Message, etc. (objective-dependent list) |

Placement quirks: Reels Overlay headline caps at 10 chars; Facebook Reels gives headline (55) more room than primary text (40); Threads is text-first (80–160 primary text works). Use Placement Asset Customization to serve different copy/creative per placement from one ad.

---

## 4. AD FORMATS + CREATIVE SPECS

## 4a. Single Image
| Placement | Ratio | Recommended size | Min |
|---|---|---|---|
| FB/IG Feed | 1:1 | 1080x1080 | 600x600 |
| Feed (portrait) | 4:5 | 1080x1350 | — |
| Stories / Reels | 9:16 | 1080x1920 | 500 px wide |
| Right column (desktop) | 1.91:1 | 1200x628 | — |

| Field | Spec |
|---|---|
| File type | JPG or PNG |
| Max file size | 30 MB |
| Text-on-image | No hard rule (20% rule retired) but low-text images perform better |
| Safe zones (Stories/Reels) | Keep critical content in center ~1080x1330; avoid top 250 px and bottom 340 px (UI overlays) |

## 4b. Video
| Field | Spec |
|---|---|
| File type | MP4 or MOV (GIF accepted) |
| Codec | H.264, AAC audio 128 kbps+ |
| Frame rate | 30 fps minimum |
| Max file size | 4 GB (keep under 1 GB for upload reliability) |
| Resolution | 1080p baseline; 1080x1080 (1:1) feed, 1080x1920 (9:16) Stories/Reels |
| Duration — Feed | 1 second to 241 minutes (keep 15–30s for performance) |
| Duration — Stories/Reels | Up to 60s recommended (Reels supports longer); first 3 seconds decide everything |
| Duration — In-stream | 5–15s non-skippable window |
| Captions | Burn in or upload SRT — majority of feed video is watched muted |
| Thumbnail | Auto or custom upload |

## 4c. Carousel
| Field | Spec |
|---|---|
| Cards | Min 2, max 10 |
| Card media | Image (30 MB) or video (4 GB) — can mix, but ALL cards must share the same aspect ratio or Meta crops to the first card's ratio |
| Ratio | 1:1 (1080x1080) standard; 4:5 available for Advantage+ catalog carousels |
| Primary text | Ad-level (one for whole carousel), 125 chars visible |
| Per-card headline | 40 chars |
| Per-card description | ~20 chars |
| Per-card URL | Required per card |
| Per-card CTA | Optional |
| Options | Auto-order best-performing card first (toggle); end card with Page profile (toggle) |

## 4d. Collection (mobile only)
| Field | Spec |
|---|---|
| Hero (cover) asset | 1 image or video, 1:1 (1080x1080) or 4:5 (1080x1350) |
| Product grid | 4 product images pulled from catalog (min 4 products in catalog) |
| Destination | Instant Experience (required) |
| Primary text | 125 chars |
| Headline | 40 chars |

## 4e. Instant Experience (full-screen mobile landing inside Meta)
| Field | Spec |
|---|---|
| Templates | Storefront, Lookbook, Customer Acquisition, Storytelling, Sell Products (catalog), Custom |
| Components | Images (up to 20), video (up to 2 min total), carousels, buttons, text blocks, product sets, tilt-to-pan photos |
| Image spec | 1080 px wide recommended; full-width renders at 1080x1920 |
| Buttons/links | Multiple allowed — place throughout, not just at end |

## 4f. Advantage+ Catalog Ads (formerly Dynamic Product Ads)
| Requirement | Detail |
|---|---|
| Catalog | Commerce Manager catalog with product feed (or Shopify/WooCommerce sync) |
| Feed fields required | id, title, description, availability, condition, price, link, image_link, brand |
| Product image | Min 500x500; 1024x1024+ recommended; 1:1; 8 MB max; no watermarks/promo text |
| Pixel events required | ViewContent, AddToCart, Purchase with content_ids matching catalog IDs |
| Audience modes | Retargeting (viewed/carted, custom windows) or broad prospecting |
| Creative overlays | Price, discount, shipping frames (toggle); catalog info layered on template |

## 4g. Flexible Ads / Advantage+ Creative
| Field | Spec |
|---|---|
| Flexible format | Upload up to 10 images/videos in one ad; Meta assembles per user (single, carousel, collection) |
| Advantage+ Creative enhancements | Toggles: brightness/contrast, music, 3D motion, text improvements, image expansion (AI-generated), template variation, catalog info. Each individually on/off — audit AI image expansion output before enabling for brand-sensitive accounts |
| Site links | Optional — up to 4 additional links below the ad (title + URL each) |

## 4h. Instant Forms (Lead Ads) — Leads objective
| Field | Spec |
|---|---|
| Form types | More Volume (fastest), Higher Intent (adds review step), Rich Creative (adds context cards) |
| Intro | Greeting headline 60 chars + optional bullet/paragraph text; background image 1200x628 or pulled from ad |
| Prefill questions | Email, phone, name, address, zip, DOB, gender, company, job title (auto-filled from profile) |
| Custom questions | Short answer, multiple choice, conditional logic (qualifying), appointment request, store locator. Keep to 1–3 custom qualifiers — each added question drops completion rate |
| Privacy policy | URL + link text REQUIRED |
| Completion screen | Headline 60 chars, description, CTA button (View Website / Download / Call) + URL |
| Lead delivery | Ads Manager CSV download (90-day retention), or CRM sync via integrations/webhooks/Zapier/CAPI — sync to CRM immediately; speed-to-lead is the whole game |
| Conversion Leads optimization | Optional: pipe CRM lead-quality data back so Meta optimizes for qualified leads, not raw form fills |

## 4i. Click-to-Message Ads (Engagement objective)
| Field | Spec |
|---|---|
| Destinations | Messenger, WhatsApp, Instagram Direct (select one or more) |
| Creative | Standard image/video/carousel specs |
| Message template | Greeting + up to 5 suggested customer replies (FAQ/icebreakers) or custom flow |

## 4j. Call Ads (Leads objective)
| Field | Spec |
|---|---|
| Phone number | Required; country code |
| Creative | Standard image/video specs |
| CTA | Call Now |
| Serving | Mobile only, business hours scheduling recommended (lifetime budget) |

---

## 5. PLACEMENT QUICK-REFERENCE MATRIX

| Placement | Ratio | Size | Notes |
|---|---|---|---|
| Facebook Feed | 1:1 or 4:5 | 1080x1080 / 1080x1350 | Workhorse |
| Instagram Feed | 1:1 or 4:5 | 1080x1080 / 1080x1350 | 4:5 wins more screen |
| FB + IG Stories | 9:16 | 1080x1920 | Safe zones apply |
| FB + IG Reels | 9:16 | 1080x1920 | Video-first; overlay headline 10 chars |
| In-stream video | 16:9 or 1:1 | 1080p | 5–15s |
| Marketplace | 1:1 | 1080x1080 | High commercial intent |
| Right column | 1.91:1 | 1200x628 | Desktop only, retargeting |
| Messenger inbox | 1:1 | 1080x1080 | — |
| Threads | 1:1 / text-first | 1080x1080 | Longer primary text OK (80–160) |
| Audience Network | 9:16, 1:1 | Native/banner/interstitial/rewarded | Consider excluding for lead-quality-sensitive accounts |

---

## 6. TRACKING PREREQUISITES (blockers — verify before any build)

| Item | Requirement |
|---|---|
| Meta Pixel | Installed on all pages; standard events mapped (Lead, Purchase, AddToCart, etc.) |
| Conversions API (CAPI) | Server-side events deduplicated with pixel (event_id match). Required for reliable optimization post-iOS |
| Domain verification | Verify domain in Business Manager |
| Aggregated events | Prioritize up to 8 conversion events per domain |
| Business verification | Required for some categories and higher spend |
| Page + IG account | Ad must publish from a Facebook Page; link IG account for IG placements |
| Catalog (if Sales/DPA) | Commerce Manager catalog synced, product-level IDs matching pixel content_ids |

---

# QUICK BUILD CHECKLIST PER CAMPAIGN TYPE

**SALES (manual or Advantage+):** Objective=Sales, pixel+CAPI verified, performance goal=Purchase (or Value/ROAS), CBO on, 1–3 ad sets max, Advantage+ audience with customer-list suggestions, Advantage+ placements, per ad: 5 primary texts (125c), 5 headlines (27–40c), 5 descriptions (27c), 1:1 + 4:5 + 9:16 creative, CTA=Shop Now, catalog attached if ecommerce, existing-customer cap set (Advantage+).

**LEADS:** Objective=Leads, conversion location (Instant Form / website / calls), Instant Form: greeting 60c + prefill fields + 1–3 qualifying questions + privacy URL + completion CTA, CRM sync live before launch, Conversion Leads optimization if CRM feedback available, creative in 1:1 + 9:16, primary text 125c, headline 27c, CTA=Get Quote.

**AWARENESS:** Objective=Awareness, goal=Reach or ThruPlay, frequency cap, broad geo, video-first creative 9:16 + 1:1, 15s with 3-second hook, captions burned in.

**TRAFFIC:** Only for content distribution. Goal=Landing Page Views (never Link Clicks), otherwise standard creative set.

**ENGAGEMENT (click-to-message):** Objective=Engagement, destination=Messenger/WhatsApp/IG Direct, greeting + 3–5 suggested replies, standard creative, response SLA in place.

**APP PROMOTION:** Objective=App Promotion (Advantage+ default), app store link, SKAdNetwork/AEM configured (iOS), MMP or Meta SDK events, up to 50 creative assets, portrait video priority.

**CAROUSEL (any objective):** 2–10 cards, uniform ratio (1:1), per-card headline 40c + URL, best-card-first toggle, front-load strongest 2 cards.

**CATALOG/DPA:** Commerce Manager catalog approved, product images 1024x1024 1:1 no watermarks, pixel content_ids matched, retargeting windows set (e.g., viewed 14d / carted 7d), broad prospecting set separate.
