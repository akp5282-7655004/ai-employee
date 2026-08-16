# GOOGLE ADS CAMPAIGN BUILD SPECIFICATIONS — MASTER REFERENCE
Last verified: August 2026
Purpose: Complete parameter reference for AI-driven campaign builds. Every asset type, count, character limit, dimension, and campaign setting required to construct and launch each Google Ads campaign type.

Character limits are display-width based. Double-width languages (Chinese, Japanese, Korean) count each character as 2.

---

## SHARED CAMPAIGN-LEVEL PARAMETERS (apply to all campaign types)

| Parameter | Options / Limits |
|---|---|
| Campaign name | Internal only, not shown to users |
| Daily budget | Required. Currency amount. Google may spend up to 2x daily on high-traffic days (monthly cap = daily x 30.4) |
| Start / end dates | Start required (defaults to launch day). End optional |
| Locations | Country, region, city, zip, or radius targeting. Options: "Presence" vs "Presence or interest" |
| Languages | One or more |
| Ad schedule | Day/hour dayparting (not available on all types) |
| Conversion goals | Account-level or campaign-specific. Primary vs secondary actions |
| URL tracking | Tracking template, final URL suffix, custom parameters |
| Audience segments | Targeting mode (restricts reach) or Observation mode (reporting/bid adjust only) |

---

# 1. SEARCH CAMPAIGN

## Campaign settings
| Parameter | Options |
|---|---|
| Networks | Google Search (required), Search Partners (toggle), Display Network expansion (toggle — recommend OFF) |
| Bidding | Manual CPC, Maximize Clicks (+optional max CPC cap), Maximize Conversions (+optional tCPA), Maximize Conversion Value (+optional tROAS), Target Impression Share |
| Keywords | Per ad group. Match types: broad, "phrase", [exact] |
| Negative keywords | Campaign or ad-group level; negative lists at account level |
| Device bid adjustments | -100% to +900% per device (manual/tCPA strategies) |
| Ad rotation | Optimize (default) or Rotate indefinitely |
| AI Max (optional toggle) | Enables keywordless/search term matching, asset optimization (auto text customization), final URL expansion. Brand inclusion/exclusion controls available |

## Ad unit: Responsive Search Ad (RSA)
| Asset | Required | Count | Character limit |
|---|---|---|---|
| Final URL | Yes | 1 | — |
| Headlines | Yes | Min 3, max 15 | 30 chars each |
| Descriptions | Yes | Min 2, max 4 | 90 chars each |
| Display path | No | 2 fields | 15 chars each |
| Pinning | No | Headlines pinnable to positions 1–3; descriptions to 1–2 | — |

Serving: Google shows up to 3 headlines + 2 descriptions per impression. Recommended: max out all 15 headlines / 4 descriptions, include keyword in ≥2 headlines, vary lengths.

## Ad unit: Call Ad (call-only)
| Asset | Required | Count | Character limit |
|---|---|---|---|
| Phone number | Yes | 1 | Verified number |
| Headlines | No | 2 | 30 chars each |
| Descriptions | Yes | 2 | 90 chars each |
| Business name | Yes | 1 | 25 chars |
| Display URL / verification URL | Yes | 1 | Domain must match verification page |

---

# 2. ASSETS (FORMERLY EXTENSIONS) — attach to Search, PMax, Display; some to Demand Gen

## Sitelinks
| Field | Required | Limit |
|---|---|---|
| Link text | Yes | 25 chars |
| Description line 1 | No (rec) | 35 chars |
| Description line 2 | No (rec) | 35 chars |
| Final URL | Yes | Must differ per sitelink |
| Quantity | Min 2 to serve; 4+ recommended; up to 20 per campaign/ad group level |

## Callouts
| Field | Limit |
|---|---|
| Callout text | 25 chars each |
| Quantity | Min 2 to serve; 4–10 recommended; up to 20 |
| Format rule | No punctuation-heavy or duplicate text; non-clickable |

## Structured Snippets
| Field | Limit |
|---|---|
| Header | Choose from Google's fixed list (Amenities, Brands, Courses, Degree programs, Destinations, Featured hotels, Insurance coverage, Models, Neighborhoods, Service catalog, Shows, Styles, Types) |
| Values | Min 3, up to 10 per header; 25 chars each |

## Call Assets
| Field | Requirement |
|---|---|
| Phone number | 1 per asset; verified; call reporting optional (Google forwarding number) |
| Schedule | Optional — show only during business hours |

## Location Assets
| Field | Requirement |
|---|---|
| Source | Linked Google Business Profile (or affiliate location feed) |
| Displays | Address, map pin, distance, call button on mobile |

## Image Assets (Search image extensions)
| Field | Requirement |
|---|---|
| Aspect ratios | 1:1 (required), 1.91:1 (optional) |
| Dimensions | 1:1 — min 300x300, rec 1200x1200. 1.91:1 — min 600x314, rec 1200x628 |
| File | JPG or PNG, max 5,120 KB |
| Quantity | Up to 20 |
| Content rules | No text overlay >20%, no blurring, no logos-as-image, safe crop centered |

## Business Name + Logo
| Field | Requirement |
|---|---|
| Business name | 25 chars. Must match domain/brand. Requires advertiser verification |
| Business logo | 1:1, min 128x128, rec 1200x1200, JPG/PNG, max 5,120 KB. Subject centered within 80% safe area |

## Price Assets
| Field | Limit |
|---|---|
| Type | Choose category (Brands, Events, Locations, Products, Product categories, Product tiers, Services, Service categories, Service tiers) |
| Items | Min 3, max 8 |
| Item header | 25 chars |
| Item description | 25 chars |
| Price | Currency amount + qualifier (From / Up to / Average / None) |
| Final URL per item | Required |

## Promotion Assets
| Field | Limit |
|---|---|
| Occasion | Optional (e.g., Black Friday — from Google's list) |
| Promotion item | 20 chars |
| Discount type | Monetary discount, percent discount, up to monetary, up to percent |
| Promo code / minimum order | Optional; "On orders over $X" |
| Final URL | Required |
| Display dates | Start/end shown in ad; separate from serving dates |

## App Assets
| Field | Limit |
|---|---|
| Link text | 25 chars |
| App | Select from App Store / Google Play listing |

## Lead Form Assets
| Field | Limit |
|---|---|
| Headline | 30 chars |
| Business name | 25 chars |
| Description | 200 chars |
| Questions | Pre-set (name, email, phone, zip, etc.) + up to 10 qualifying questions from Google's category list |
| Privacy policy URL | Required |
| Background image | Optional, 1.91:1, min 600x314 |
| Post-submit message | Headline 25 chars, description 200 chars, optional CTA + URL |
| Delivery | Download CSV (30-day retention) or webhook to CRM |

---

# 3. PERFORMANCE MAX

Structure: Campaign → Asset Groups (up to 100 per campaign; each asset group ≈ a theme/audience). Every asset group needs the full asset set below before it can serve.

## Campaign settings
| Parameter | Options |
|---|---|
| Objective | Sales, Leads, Website traffic, Local store visits |
| Bidding | Maximize Conversions (+optional tCPA) or Maximize Conversion Value (+optional tROAS). Optional: "acquire new customers only" toggle |
| Final URL expansion | ON by default — Google may swap landing pages. Can exclude URLs or turn off |
| Merchant Center feed | Optional (turns it into retail PMax) |
| Location / language / schedule | Standard |
| Brand exclusions | Optional — block serving on branded queries |
| Campaign-level negatives | Limited negative keyword support |

## Per Asset Group — TEXT
| Asset | Required | Count | Character limit |
|---|---|---|---|
| Final URL | Yes | 1 | — |
| Headlines | Yes | Min 3, max 15 | 30 chars |
| Long headlines | Yes | Min 1, max 5 | 90 chars |
| Description (short) | Yes | 1 | 60 chars |
| Descriptions | Yes | Up to 4 more (5 total) | 90 chars |
| Business name | Yes | 1 | 25 chars |
| CTA | Auto or select from list (Learn More, Get Quote, Sign Up, Subscribe, Book Now, Contact Us, Download, Shop Now, etc.) |
| Display path | No | 2 fields | 15 chars each |

## Per Asset Group — IMAGES (max 20 total, JPG/PNG, 5,120 KB each)
| Ratio | Dimensions | Required | Recommended count |
|---|---|---|---|
| Landscape 1.91:1 | Rec 1200x628, min 600x314 | Yes (min 1) | 3–4 |
| Square 1:1 | Rec 1200x1200, min 300x300 | Yes (min 1) | 3–4 |
| Portrait 4:5 | Rec 960x1200, min 480x600 | No (strongly rec — unlocks Discover/YouTube mobile inventory) | 2 |

## Per Asset Group — LOGOS (up to 5, JPG/PNG, 5,120 KB)
| Ratio | Dimensions | Required |
|---|---|---|
| Square 1:1 | Rec 1200x1200, min 128x128 | Yes |
| Landscape 4:1 | Rec 1200x300, min 512x128 | No |

## Per Asset Group — VIDEO
| Field | Requirement |
|---|---|
| Count | Up to 5 (some accounts now allow more) |
| Hosting | Uploaded to YouTube, referenced by URL |
| Duration | Min 10 seconds |
| Orientations | Provide 16:9, 1:1, and 9:16 for full placement coverage |
| Fallback | If no video provided, Google auto-generates slideshow video from your images/text (typically underperforms custom video) |

## Per Asset Group — SIGNALS (guidance, not hard targeting)
| Field | Limit |
|---|---|
| Audience signal | Custom segments, your data (remarketing/customer match), interests, demographics |
| Search themes | Up to 25 per asset group; up to 80 chars each. Function like soft keywords |

## Attachable campaign assets
Sitelinks (4+ recommended), callouts, structured snippets, calls, prices, promotions, lead forms — same specs as Section 2.

---

# 4. DEMAND GEN

Serves: YouTube (in-feed, in-stream, Shorts), Discover, Gmail. Now also absorbs Display inventory (Display campaigns retired into Demand Gen mid-2026).

## Campaign settings
| Parameter | Options |
|---|---|
| Bidding | Maximize Clicks, Maximize Conversions (+tCPA), Maximize Conversion Value (+tROAS) |
| Audiences | Lookalike segments (built from your data lists, min 1,000 members), custom segments, your data, interests/demographics |
| Channel controls | Select/deselect YouTube, Discover, Gmail, Display |
| Product feed | Optional Merchant Center integration for product ads |
| Device targeting | Available |

## Format: Single Image Ad
| Asset | Required | Count | Limit |
|---|---|---|---|
| Final URL | Yes | 1 | — |
| Headlines | Yes | Up to 5 | 40 chars each; at least one must be ≤30 chars |
| Descriptions | Yes | Up to 5 | 90 chars each |
| Business name | Yes | 1 | 25 chars |
| Images | Yes | Up to 20 | 1.91:1 (1200x628), 1:1 (1200x1200), 4:5 (960x1200). JPG/PNG, max 5 MB each |
| Logo | Yes | 1+ | 1:1, rec 1200x1200. Max 150 KB (note: stricter than the 5 MB image cap) |
| CTA | Recommended | 1 | Select from list or custom (custom max 10 chars) |

## Format: Carousel Ad
| Field | Limit |
|---|---|
| Cards | Min 2, max 10 |
| Card image | 1:1 or 1.91:1 — all cards must share the same ratio |
| Card headline | 40 chars per card |
| Card final URL | Per card |
| CTA | Optional per card |

## Format: Video Ad
| Field | Limit |
|---|---|
| Video | YouTube-hosted. Orientations: 16:9, 1:1, 9:16 (9:16 required for Shorts placement) |
| Duration | Min 10 seconds (in-feed); 6 seconds bumper-style |
| Headline | 40 chars |
| Description | 90 chars |
| Business name | 25 chars |
| CTA | Required for video; custom CTA max 10 chars |
| CTV note | Connected TV serves 16:9 only, min 1920x1080 |

---

# 5. VIDEO CAMPAIGNS

Note: Video Action Campaigns no longer exist — conversion-focused video now runs through Demand Gen or PMax. Video campaigns today are awareness/reach/views focused.

## Campaign subtypes
| Subtype | Formats used | Bidding |
|---|---|---|
| Video reach (efficient reach) | Mix of skippable in-stream, bumpers, non-skippable | Target CPM |
| Video reach (non-skippable) | Non-skippable in-stream | Target CPM |
| Video views | Skippable in-stream, in-feed, Shorts | CPV / Target CPV |
| Ad sequence | Ordered series of ads | Target CPM |
| Audio | Audio ads on YouTube | Target CPM |

## Format specs (all videos must be uploaded to YouTube first — public or unlisted)
| Format | Duration | Text fields |
|---|---|---|
| Skippable in-stream | Any length (rec <3 min); skippable after 5s | Display URL; optional companion banner 300x60 (desktop) |
| Non-skippable in-stream | Up to 15s (30s available in some regions) | Display URL |
| Bumper | Exactly 6 seconds | Display URL |
| In-feed video | Any length | Thumbnail (auto or custom), headline 100 chars, descriptions 2 x 35 chars |
| Shorts ads | 9:16 vertical, up to 60s | Pulled from video + CTA |

## Video file guidance
| Field | Spec |
|---|---|
| Resolution | 1080p (1920x1080) recommended; 720p minimum acceptable |
| Aspect ratios | 16:9 (horizontal), 1:1 (square), 9:16 (vertical) |
| Audio | Required track (can be silent bed) |
| Safe zones | Keep text/logos inside center 90% horizontal / 80% vertical to avoid UI overlay clipping |

---

# 6. SHOPPING CAMPAIGNS

No creative assets built in Google Ads — ads are generated entirely from your Merchant Center product feed. The feed IS the ad.

## Prerequisites
| Requirement | Detail |
|---|---|
| Google Merchant Center account | Linked to Google Ads |
| Product feed | Uploaded/synced, approved, country of sale set |
| Website requirements | Secure checkout, return/refund policy, contact info |
| Local inventory ads | As of Aug 31, 2026, local inventory serving is enabled on all Shopping campaigns (opt-out removed) |

## Required feed attributes (per product)
| Attribute | Limit / Rule |
|---|---|
| id | Unique SKU identifier |
| title | 150 chars max (~70 displayed). Front-load brand + product + key attribute |
| description | 5,000 chars max (~175 displayed) |
| link | Product landing page URL |
| image_link | Min 100x100 (non-apparel), 250x250 (apparel). Max 64 MP / 16 MB. White/plain background preferred. NO watermarks, promo text, or borders |
| price | With currency; must match landing page |
| availability | in_stock / out_of_stock / preorder / backorder |
| brand | Required for most products |
| gtin / mpn | GTIN required where one exists; else mpn + brand |
| condition | new / refurbished / used |
| google_product_category | From Google taxonomy |
| Apparel extras | color, size, gender, age_group required (US, UK, DE, FR, JP, BR) |
| Optional but recommended | product_type, sale_price, shipping, additional_image_link (up to 10), custom_label_0–4 (for campaign segmentation) |

## Campaign settings
| Parameter | Options |
|---|---|
| Country of sale | Fixed at creation |
| Inventory filter | Serve all or filter by attribute/custom label |
| Campaign priority | Low / Medium / High (controls which campaign serves when products overlap) |
| Bidding | Manual CPC, Maximize Clicks, Target ROAS |
| Structure | Listing groups — subdivide by brand, product type, item ID, custom label, condition, channel |
| Negative keywords | Supported (no positive keywords — Google matches queries to feed) |

---

# 7. APP CAMPAIGNS

Destination is the app store listing — no landing page URL. Google pulls store listing text/images automatically and combines with your assets. No keyword targeting.

## Campaign subtypes
| Subtype | Goal | Bidding |
|---|---|---|
| App installs | Volume of installs | Target CPI, or tCPA for in-app action |
| App engagement | Re-engage existing users | Target CPA |
| App pre-registration (Android only) | Pre-launch signups | Target CPPre-registration |

## Assets
| Asset | Required | Count | Limit |
|---|---|---|---|
| App selection | Yes | 1 | From Google Play or Apple App Store |
| Headlines | Yes | Up to 5 | 30 chars each |
| Descriptions | Yes | Up to 5 | 90 chars each |
| Images | No (strongly rec) | Up to 20 | Key sizes: 1200x628 (1.91:1), 1200x1200 (1:1), 1200x1500 (4:5). JPG/PNG, max 5 MB |
| Videos | No (strongly rec) | Up to 20 | YouTube-hosted. Provide 16:9, 1:1, 9:16 (portrait critical — most app inventory is mobile) |
| HTML5 assets | No | Up to 20 | Playable ads, eligible accounts only |

## Settings
| Parameter | Detail |
|---|---|
| Budget + target bid | Set daily budget ≥ 50x target CPI (or 10x tCPA) for learning |
| Conversion tracking | Firebase or app attribution partner (AppsFlyer, Adjust, etc.) required for engagement/action bidding |
| Serving | Search, Play, YouTube, Discover, Display — no placement control |

---

# 8. SMART CAMPAIGNS

Simplified SMB product. Minimal inputs, fully automated serving across Search/Maps/Display.

| Asset / Setting | Required | Limit |
|---|---|---|
| Business name | Yes | From Business Profile or manual |
| Headlines | Yes | 3 | 30 chars each |
| Descriptions | Yes | 2 | 90 chars each |
| Keyword themes | Yes | Up to 7–10 themes (not keywords — Google expands) |
| Phone number | Optional | For call reporting |
| Geo target | Yes | Radius around business or defined areas |
| Budget | Yes | Daily; Google auto-bids (no strategy selection) |
| Landing page | Yes | Website URL or auto-generated from Business Profile |

Note: No manual bidding, no placement control, no search terms visibility. Not recommended for professional accounts — build a real Search campaign instead.

---

# 9. LOCAL SERVICES ADS (separate platform — not built in Google Ads)

Managed at ads.google.com/localservices. Pay-per-lead, not per click.

| Requirement | Detail |
|---|---|
| Eligibility | Category + geo must be supported (plumbing, HVAC, roofing, garage door, electrical, etc. — home services core) |
| Verification | Business registration, license checks, insurance proof |
| Background checks | Owner + technicians (varies by category/state) — required for Google Guaranteed badge |
| Badges | Google Guaranteed (home services) or Google Screened (professional services) |
| Profile inputs | Business name, service categories, service areas (zips), hours, photos (min 3–5 rec), license numbers |
| Budget | Weekly budget based on target lead volume |
| Bidding | Maximize leads (auto) or manual max-per-lead bid |
| Reviews | Pulled from Google Business Profile — rating heavily influences ranking |
| Lead management | In-platform inbox; must respond/mark leads to maintain ranking; dispute invalid leads for credit |

---

# QUICK BUILD CHECKLIST PER CAMPAIGN TYPE

**SEARCH:** Final URL, 15 headlines (30c), 4 descriptions (90c), 2 paths (15c), keywords + match types, negatives, bidding strategy, 4+ sitelinks (25c + 2x35c), 4+ callouts (25c), structured snippets (header + 3+ values 25c), business name (25c), logo (1:1 1200x1200), images (1:1 + 1.91:1), call asset, location asset.

**PMAX (per asset group):** Final URL, 15 headlines (30c), 5 long headlines (90c), 1 short description (60c) + 4 descriptions (90c), business name (25c), 3-4 landscape images (1200x628), 3-4 square (1200x1200), 2 portrait (960x1200), square logo (1200x1200), 4:1 logo (1200x300), 1-5 videos (10s+, 3 orientations), audience signal, up to 25 search themes, sitelinks/callouts/snippets.

**DEMAND GEN:** Final URL, 5 headlines (40c, one ≤30c), 5 descriptions (90c), business name (25c), images in 1.91:1 + 1:1 + 4:5 (5MB), logo 1:1 (150KB!), CTA, videos in 16:9 + 1:1 + 9:16 if video format, lookalike/custom audiences.

**VIDEO:** YouTube-hosted video(s) in correct duration for format (6s bumper / ≤15s non-skip / any skippable), 1080p, all 3 orientations, display URL, companion banner optional, in-feed: headline 100c + 2x35c descriptions.

**SHOPPING:** Approved Merchant Center feed (title 150c, description 5000c, compliant images, price/availability synced), country of sale, priority, listing group structure, negatives, tROAS or manual CPC.

**APP:** App store listing, 5 headlines (30c), 5 descriptions (90c), up to 20 images (incl. portrait), up to 20 videos (incl. 9:16), Firebase/MMP tracking, budget = 50x target CPI.

**SMART:** 3 headlines (30c), 2 descriptions (90c), keyword themes, geo radius, budget. (Avoid — use Search.)

**LSA:** Verified licenses/insurance, background checks, service categories + zips, weekly budget, GBP reviews synced.
