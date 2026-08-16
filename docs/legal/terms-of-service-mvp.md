# Miles AI — Terms of Service (MVP Draft v0.1)

### Purpose of this document
This is a launch-grade draft, not a final legal instrument. It gives Miles a defensible position from customer #1 and hands a lawyer a structure to finish rather than a blank page. **Before charging real money at volume, have a US commercial attorney (a few hundred dollars for a review of a document this size) adapt Sections 6 through 10 to Delaware/Arkansas law and Miles's actual entity.**

Structure and clause functions are modeled on standard US SaaS terms and on the AI-agent-specific provisions used by Viktor, Overtime, and comparable AI marketing tools. Boilerplate concepts (liability caps, damage exclusions, as-is disclaimers, indemnity) are industry-standard and not owned by anyone; the drafting below is original.

**Convention:** ⚖️ = lawyer must confirm/adapt. 🤖 = AI-agent-specific clause that generic templates miss; this is the part that actually protects Miles in the "Miles shut down my account" scenario.

---

## 0. Definitions

- **"Miles," "we," "us"** — [Miles AI, LLC / entity name] ⚖️
- **"Customer," "you"** — the business accepting these Terms
- **"Service"** — the Miles AI platform, dashboards, skills, agents, connectors, and any outputs
- **"Connected Account"** — any third-party account (Google Ads, Google Local Services Ads, Google Business Profile, Meta Business/Ads, CRM, call tracking, or other) that Customer links to the Service
- **"Platform"** — the third party operating a Connected Account (Google, Meta, etc.)
- **"Action"** — any read, write, change, launch, pause, budget adjustment, creative generation, or other operation the Service performs on or with a Connected Account
- **"Proposal"** — an Action the Service recommends but does not execute until approved
- **"Approval"** — Customer's affirmative confirmation of a Proposal, recorded in the Approval Log
- **"Approval Log"** — the Service's record of Proposals, Approvals, Actions, and their timestamps
- **"Autonomy Settings"** — the Customer-configured rules defining which Actions may run without per-Action Approval
- **"Credits"** — units of Service usage as described in Section 4
- **"Aggregated Data"** — data derived from Customer's use of the Service that has been combined with data from other customers such that it does not identify Customer or any individual

---

## 1. Acceptance and eligibility
- Business use only. By accepting, you represent you are authorized to bind the business.
- You must be 18+ and legally able to contract.
- Terms may be updated; material changes get 14 days' notice by email and in-app. Continued use after the effective date is acceptance.

---

## 2. The Service (what Miles is and is not)
- Miles is a software service that monitors, analyzes, proposes, and (where authorized) executes changes to Customer's marketing accounts.
- 🤖 **Miles is not an agency, fiduciary, or advisor.** Miles does not manage Customer's business, does not guarantee results, and does not assume responsibility for Customer's marketing outcomes.
- 🤖 **Miles is not the Platform.** Miles has no control over, and no responsibility for, decisions the Platforms make about Customer's accounts, including policy enforcement, disapprovals, suspensions, billing, or delivery.
- We may modify, add, or remove features. We will not remove monitoring or the Approval Log without notice.

---

## 3. Connected Accounts and authorization 🤖

This is the section that matters most for the "Miles broke my account" scenario. It does three things: makes clear the Customer granted the access, makes clear the Customer set the rules, and makes the Approval Log the record.

**3.1 Grant of access.** By linking a Connected Account, you authorize Miles to access it through the Platform's official API using the permissions you grant during connection, and to perform Actions consistent with your Autonomy Settings and Approvals. You may revoke access at any time by disconnecting the account or revoking the OAuth grant at the Platform.

**3.2 You own the account and the relationship with the Platform.** You are responsible for maintaining your Connected Accounts in good standing, complying with each Platform's terms and advertising policies, and for all charges the Platform bills you, including ad spend resulting from Actions taken under your Autonomy Settings.

**3.3 Autonomy Settings.** The Service defaults to Proposal mode: no write Action is executed without Approval. You may expand autonomy (for example, allowing automatic pauses or budget shifts within caps you set). Any Action executed within Autonomy Settings you configured is deemed executed with your Approval.

**3.4 Approval Log.** The Service records every Proposal, Approval, and Action, with timestamps and the user who approved. **The Approval Log is the authoritative record** of what the Service did and on whose instruction. You agree the Approval Log may be relied on by either party to establish what occurred.

**3.5 Reversibility.** Where technically possible the Service will offer a revert for executed Actions. Reversion is best-effort; some Platform-side effects (spend already incurred, learning-phase resets, review outcomes) cannot be undone.

**3.6 Platform enforcement.** You acknowledge that Platforms may disapprove ads, restrict, suspend, or terminate accounts for reasons including policy interpretation, payment issues, and automated enforcement, and that these decisions are made by the Platform, not Miles. Miles will use commercially reasonable efforts to keep Actions within published Platform policies but does not guarantee any Platform outcome. ⚖️

**3.7 Your obligations.** You will (a) provide accurate business, service-area, and offer information; (b) review Proposals in good faith; (c) not use the Service to violate any Platform policy or law; (d) keep at least one human user with admin access to each Connected Account.

---

## 4. Plans, credits, billing

**4.1 Launch offer.** The first 100 accounts receive the Service at $0/month with $100 in Credits, no expiry, hard cap. When Credits are exhausted, the account is enrolled in the paid plan its trailing-30-day ad spend implies, with 14 days' notice; the first paid month is billed at the Starter rate.

**4.2 Paid plans.** Starter ($149/mo, under $5,000 monthly ad spend, includes $50 in Credits), Growth ($397/mo, $5,000–$15,000, includes $150), Scale ($797/mo, over $15,000, includes $350). Plan is set on each billing date from actual trailing-30-day spend across Connected Accounts. Plans never downgrade automatically; you may request a downgrade effective next billing date. Prices may change with 30 days' notice. ⚖️

**4.3 What Credits meter.** Monitoring (reads, alerts, dashboards) is never metered. Credits are consumed by work items: campaign builds, creative and copy generation, readouts, comparisons, and analyses. Credit consumption is shown in-app.

**4.4 Top-ups.** When included Credits are exhausted, the Service auto-purchases a top-up ($25 / $50 / $100 by plan) unless you cap or disable top-ups in settings, in which case work items pause (monitoring continues) until the next cycle. Unused included Credits roll forward one billing period, then expire.

**4.5 Billing.** Monthly, in advance, by card on file. Failed payments: 7-day grace, then the account moves to read-only monitoring, then suspension at 30 days. Taxes are your responsibility. ⚖️

**4.6 Cancellation.** Cancel any time in-app; effective at the end of the current billing period; access continues until then.

**4.7 No refunds.** Fees and Credits are non-refundable. Credits represent computing resources consumed on your instructions and cannot be reversed. Unused Credits at cancellation expire with no cash value. ⚖️ (confirm against any state auto-renewal / refund statutes)

---

## 5. Data

**5.1 Your data.** You own your business data and your Connected Account data. You grant Miles a license to process it to provide the Service.

**5.2 Aggregated Data and benchmarks.** 🤖 You grant Miles a perpetual, irrevocable, royalty-free right to create, use, and commercialize Aggregated Data (including industry benchmarks, model training and evaluation, and product improvement), provided it does not identify you, your customers, or any individual. This right survives termination.

**5.3 Confidentiality.** Miles will not disclose your non-aggregated account data except to sub-processors needed to run the Service, or as required by law.

**5.4 Sub-processors and AI providers.** The Service uses third-party model providers and infrastructure (listed at [URL]). Prompts and account data may be sent to these providers to perform the Service. Miles selects providers with contractual no-training commitments where available. ⚖️ (privacy policy + DPA to match)

**5.5 Security.** Commercially reasonable safeguards; OAuth tokens encrypted at rest; least-privilege scopes. No absolute guarantee. Notice of a confirmed breach affecting your data without undue delay.

**5.6 Retention.** Account data retained while the account is active plus 90 days, then deleted or de-identified. Aggregated Data is retained. Approval Log retained 24 months for dispute purposes. ⚖️

---

## 6. Intellectual property
- Miles owns the Service, its models, prompts, playbooks, benchmarks, and all improvements.
- You own the outputs the Service generates for you (ad copy, creative, plans) to the extent permitted by the underlying model provider's terms, and grant Miles a license to use them within the Service and in Aggregated Data.
- Feedback you provide may be used freely.
- 🤖 **AI outputs.** Outputs are generated by AI, may be inaccurate, and are provided for your review. You are responsible for reviewing outputs before use, including for legal compliance, accuracy of claims about your business, and Platform policy.

---

## 7. Disclaimers ⚖️
THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE." MILES DISCLAIMS ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.

🤖 MILES DOES NOT WARRANT THAT THE SERVICE WILL IMPROVE ANY MARKETING METRIC, GENERATE LEADS OR REVENUE, REDUCE COSTS, OR THAT ANY ACTION WILL PRODUCE ANY PARTICULAR RESULT. MILES DOES NOT WARRANT THAT ANY PLATFORM WILL APPROVE, DELIVER, OR CONTINUE TO PERMIT ANY AD, CAMPAIGN, OR ACCOUNT. MILES DOES NOT WARRANT THAT AI-GENERATED OUTPUTS ARE ACCURATE, COMPLETE, OR COMPLIANT.

Illustrative savings, benchmarks, or projections shown in the Service are informational and not guarantees.

---

## 8. Limitation of liability ⚖️
TO THE MAXIMUM EXTENT PERMITTED BY LAW, MILES AND ITS OFFICERS, EMPLOYEES, AND SUPPLIERS SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, OR FOR LOST PROFITS, LOST REVENUE, LOST LEADS, LOST BUSINESS OPPORTUNITY, BUSINESS INTERRUPTION, LOSS OF DATA, OR WASTED OR UNAUTHORIZED AD SPEND, ARISING OUT OF OR RELATING TO THESE TERMS OR THE SERVICE, HOWEVER CAUSED AND UNDER ANY THEORY OF LIABILITY, EVEN IF ADVISED OF THE POSSIBILITY.

🤖 WITHOUT LIMITING THE FOREGOING, MILES SHALL NOT BE LIABLE FOR ANY LOSS ARISING FROM (A) ANY ACTION EXECUTED WITHIN YOUR AUTONOMY SETTINGS OR PURSUANT TO YOUR APPROVAL; (B) ANY DECISION, ENFORCEMENT, DISAPPROVAL, RESTRICTION, SUSPENSION, OR TERMINATION BY A PLATFORM; (C) YOUR USE OF AI-GENERATED OUTPUTS; OR (D) YOUR REVOCATION OF, OR FAILURE TO MAINTAIN, ACCESS TO A CONNECTED ACCOUNT.

MILES'S TOTAL AGGREGATE LIABILITY ARISING OUT OF OR RELATING TO THESE TERMS OR THE SERVICE SHALL NOT EXCEED THE FEES ACTUALLY PAID BY YOU TO MILES IN THE TWELVE (12) MONTHS PRECEDING THE EVENT GIVING RISE TO THE CLAIM. FOR ACCOUNTS ON THE $0 LAUNCH OFFER, THAT AMOUNT IS ZERO. ⚖️ (some states restrict; lawyer to add the "some jurisdictions do not allow" carve-out)

---

## 9. Indemnification ⚖️
You will defend and indemnify Miles against third-party claims arising from (a) your Connected Accounts, ads, offers, or business practices; (b) your breach of Platform terms or law; (c) content or data you provide; (d) your use of outputs. Miles will defend and indemnify you against third-party claims that the Service itself (excluding your data and outputs) infringes a US patent, copyright, or trademark, subject to standard exclusions.

---

## 10. Term, suspension, termination
- Term is monthly, renewing until cancelled.
- Miles may suspend for non-payment, security risk, Platform-policy risk, or breach, with notice where practical.
- On termination, access ends, tokens are revoked, and Section 5.6 retention applies.
- Survival: Sections 4.7, 5.2, 5.6, 6, 7, 8, 9, 11.

---

## 11. General ⚖️
- **Governing law / venue:** [State], courts of [County]. Consider binding arbitration with small-claims carve-out and class-action waiver (lawyer to advise; standard for consumer-adjacent SMB SaaS).
- Entire agreement; severability; no waiver; assignment (Miles may assign on merger/sale; you may not without consent); notices by email to the account address; force majeure.
- Export/sanctions compliance; US-only availability at launch.

---

## Companion documents needed (not drafted here)
1. **Privacy Policy** (required by Google/Meta API terms; must name AI sub-processors)
2. **Data Processing Addendum** (only if selling into CA/EU-touching customers)
3. **Acceptable Use Policy** (short; ban prohibited verticals, deceptive ads, scraping Platforms via Miles)
4. **In-app consent screens** — the OAuth scope screen and the Autonomy Settings screen should each restate 3.1–3.4 in one sentence; that in-product acknowledgement is worth as much as the ToS in a dispute.

## Build-side requirements this document assumes
- Approval Log exists, is immutable, timestamped, exportable, retained 24 months.
- Autonomy Settings UI with defaults = Proposal mode, per-skill toggles, caps/floors.
- Credit meter visible in-app; top-up controls.
- Sub-processor list page.
- ToS/Privacy acceptance checkbox at signup with version stamped to the account.
