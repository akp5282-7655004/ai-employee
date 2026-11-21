# Tracking & measurement SOPs

Read-only capture from the corresponding ClickMinded SOP Library filter. Full bodies are from the site’s **Download PDF** export; external hyperlinks are listed without opening external documents.

## SOP 137: Exclude staff and test visits from GA4 reports

**URL:** https://tools.clickminded.com/sop/137
**Capture:** Full (PDF export)

**Linked external resources/templates (not opened):**
- [(linked resource)](https://analytics.google.com/)
- [(linked resource)](https://tagmanager.google.com/)

<details><summary>Full SOP text</summary>

```text
SOP 137 · TRACKING & MEASUREMENT


Exclude staff and test visits from GA4
reports
Keep staff browsing and tracking tests out of future GA4 reports after checking both filters in
Testing mode.



  ESTIMATED TIME            TOOLS                            RESPONSIBLE
  45 minutes                Google Analytics 4, Google       People who maintain a website’s Analytics
                            Tag Manager                      reports and test its tracking



Before you start
Requirements
  ●​ Editor access or above to the intended GA4 website property
  ●​ An existing GA4 web data stream receiving website visits
  ●​ Access to the website’s installed Google Tag Manager container so you can start Preview
  ●​ Public IP addresses supplied or confirmed by the website owner for staff networks, plus a different
     network for a visitor check
  ●​ A website owner who can confirm the staff networks and approve permanently excluding their
     future visits


  THIS SOP COVERS                                        THIS DOES NOT COVER
       ●​ Mark staff website visits from known             ●​ Filter app traffic
          public IP addresses                              ●​ Remove historical visits
       ●​ Test internal and developer traffic filters      ●​ Exclude visitors by email, login or
          before activating them                              location
       ●​ Keep debug visits available in                   ●​ Maintain broad or changing IP ranges
          DebugView while excluding them from
          ordinary reports

Related SOPs
  ●​ SOP 012: Install GA4 through Google Tag Manager


1. Choose which visits belong outside reports
Staff network visits and tracking tests are different. Each needs its own filter.

1.1 Open Google Analytics and select the website’s property. Create a note called GA4 filter
setup with sections Property, Staff networks, Tests, and Activation. Open Admin > Property
> Property details and enter the property name and Property ID under Property. Then open
Admin > Data collection and modification > Data streams and the website’s web stream; add its
stream name and Website URL to that section.

1.2 In Staff networks, list each owner-confirmed public IP address and which staff network uses
it. Use the internet-facing address, not a computer’s local address such as 192.168.1.10. A
shared office address identifies everyone on that network; a changing home address can stop
matching later. Use exact addresses for this guide.
     ⚠ Warning: A public Wi-Fi network may include customers. Do not exclude its address. Ask the
     owner for a dedicated staff network instead.

1.3 Open Admin > Data collection and modification > Data filters. Inspect existing Internal traffic
and Developer traffic filters. In Activation, record their names, states and match values. Reuse a
matching filter; create a new one only when it is missing. Testing labels matching visits without
discarding them; Active permanently discards future matches; Inactive does nothing.
     ⚠ Warning: If a matching filter is already Active, have the property owner approve changing it to
     Testing for this check; matching visits will be retained while it is Testing.



2. Mark staff visits and create testing filters
First label staff traffic. Then make Analytics show you what each filter would remove.

2.1 Return to Admin > Data streams and open the web stream. Under Configure tag settings,
click Show more > Define internal traffic. Create one rule for each address in Staff networks.

     a. Name the rule after the network, such as Office staff. Set traffic_type to internal. This label
     connects the network rule to the data filter.

     b. Choose IP address equals and enter that network’s public IP address. Click Create, then repeat
     for the other confirmed addresses.

2.2 Open Admin > Data collection and modification > Data filters. Create Filter > Internal Traffic,
or open the matching existing filter. Name it Staff visits, choose Exclude, set the traffic_type
parameter value to internal, and set its state to Testing. Save.

2.3 Create Filter > Developer Traffic, or open the matching existing filter. Name it Tracking
tests, choose Exclude, set its state to Testing, and save. Developer traffic means events sent
with debug mode on, including tracking tests made with Tag Manager Preview.


3. Prove the filters match the right visits
A saved filter is not enough. Check the visits Analytics actually labels before discarding any
data.

3.1 On a listed staff network, open a fresh ordinary browser tab on your website with a unique
query at the end, such as ?filter_check=staff_20261013. Accept analytics consent if your
banner requires it and visit another page. Keep Tag Manager Preview disconnected for this visit.
In Tests, enter the URL, network, time and “staff, non-debug”.

3.2 Open Google Tag Manager, select the website’s container and click Preview. Connect to a
website URL with a different query, such as ?filter_check=debug_20261013. Accept analytics
consent, then open Admin > Data display > DebugView in GA4 and confirm the visit’s
page_view event. In Tests, enter its URL, time and “debug”. End Preview when finished.

3.3 Using a different network, such as mobile data rather than office Wi-Fi, open the site without
Preview and use a third query, such as ?filter_check=visitor_20261013. Accept analytics
consent and visit another page. In Tests, enter its URL, time and “ordinary visitor”.

3.4 In GA4, open Explore > Blank. Name the exploration GA4 filter test and set the date range
to include all three tests. Import dimensions Test data filter name, Event name, and Page
location, plus metric Event count.

     a. Under Tab settings, choose Free form. Add Test data filter name, Event name and Page location
     to Rows; add Event count to Values. Add a Page location filter that contains filter_check=.

     b. Find each marked URL. The non-debug staff visit must be labeled Staff visits, and the debug
     visit must be labeled Tracking tests. The ordinary visitor must have neither filter’s name. In Tests,
     record each observed label and event count.
         ⚠ Warning: Filters can take 24–36 hours to apply. If a case is missing, leave both filters in
         Testing, check again later and send a new marked visit if needed. Do not activate a filter based
         only on an empty table.

3.5 Compare the three results with the rules. If a staff visit is unlabeled, recheck its current
public IP and the exact stream’s rule. If ordinary visitors are labeled, narrow the incorrect rule
before continuing. If the debug visit is unlabeled, reconnect Preview and check DebugView
again. Repeat the affected visit and report check until all three cases match.


4. Activate only the filters you have checked
Activation changes future data. It does not clean up visits already in your reports.

4.1 Show the owner Staff networks and the three results in Tests. Explain that Active exclusions
permanently discard future matching events from Analytics and BigQuery; switching them off
later cannot recover discarded data. In Activation, record the owner’s confirmation, date and the
two filter names.

4.2 Open Admin > Data collection and modification > Data filters > Staff visits. Change the state
to Active and save. Read any confirmation and confirm the property and filter before accepting
it.

4.3 Open Tracking tests, change its state to Active and save. Reopen it to confirm Active and
Exclude. In Activation, enter the activation time for both filters. Keep using DebugView for future
debug checks.

4.4 Give the owner GA4 filter setup and its exploration. Explain that staff IP changes require an
updated rule and another Testing check. If a rule later excludes the wrong people, set its filter to
Inactive to protect new visits while you investigate; lost data remains lost.




Last updated Oct 14, 2026 · Click here to get the most up-to-date version of this SOP
```

</details>

## SOP 136: Set up cookie consent and Google Consent Mode on WordPress

**URL:** https://tools.clickminded.com/sop/136
**Capture:** Full (PDF export)

**Linked external resources/templates (not opened):**
- [Google Tag Assistant](https://tagassistant.google.com/)

<details><summary>Full SOP text</summary>

```text
SOP 136 · TRACKING & MEASUREMENT


Set up cookie consent and Google Consent
Mode on WordPress
Add a cookie banner that passes visitors’ choices to Google tags, then check acceptance,
refusal and changed preferences.



 ESTIMATED TIME            TOOLS                                RESPONSIBLE
 50 minutes                WordPress, Site Kit by               People who manage a WordPress website
                           Google, Google Analytics 4,          and its visitor tracking
                           Google Tag Assistant



Before you start
Requirements
  ●​ WordPress administrator access and a current site backup
  ●​ Site Kit installed and connected to WordPress, plus an existing GA4 property and web stream
        receiving website visits
  ●​    The intended GA4 web stream’s Measurement ID, starting G-, supplied by the website owner or
        tracking installer
  ●​    The website owner’s approved privacy and cookie policy URLs, business contact details, and
        instructions to use an opt-in banner for the EEA, United Kingdom and Switzerland
  ●​    Owner-confirmed website services, analytics/ad use and any already accepted Google
        data-processing agreement; do not guess these answers
  ●​    A browser test from the EEA, United Kingdom or Switzerland, where this method’s denied defaults
        apply


 THIS SOP COVERS                                         THIS DOES NOT COVER
       ●​ Configure a free Complianz banner with           ●​ Decide which privacy laws apply to the
          Site Kit and WP Consent API                            business
       ●​ Use Site Kit’s consent defaults for the          ●​ Write or approve legal policies or accept
          EEA, United Kingdom and Switzerland                    data-processing agreements
       ●​ Check all four Google consent signals            ●​    Configure worldwide or custom regional
          before and after visitor choices in the                consent defaults
          browser you use for this procedure               ●​    Guarantee legal compliance or future
                                                                 modeled reporting
                                                           ●​    Install tracking for non-Google services
                                                           ●​    Audit compatibility across multiple
                                                                 browsers and devices

Related SOPs
  ●​ SOP 001: Install Google Tag Manager on a WordPress site using Site Kit
  ●​ SOP 012: Install GA4 through Google Tag Manager
  ●​ SOP 135: Create your first Google Analytics account and website setup


1. Match the setup to the website’s privacy instructions
A banner collects choices. Consent Mode tells Google tags how to act on those choices; it does
not write your privacy policy.

1.1 Create a note called Cookie consent setup with sections Website, Owner instructions,
and Checks. Enter the website URL, the intended G- Measurement ID supplied by the website
owner or tracking installer, and the policy URLs. That ID tells Google where this website’s visits
belong. In Owner instructions, enter the supplied business details, services and banner
requirements.

1.2 In WordPress, open Site Kit > Settings > Connected Services and inspect Analytics.
Compare the website’s measurement ID with Website in your note. Inspect Plugins and your
Google Tag Manager container, if installed, to identify any existing cookie banner or Consent
Mode implementation.
     ⚠ Warning: Two banners or Consent Mode managers can send contradictory choices. Have the
     website maintainer remove the conflicting setup before continuing.
     ⚠ Warning: Keep one GA4 installation. If Tag Manager already sends GA4 visits, Site Kit must not
     place a second Analytics tag.

1.3 Connect Site Kit to your existing GA4 stream so its consent controls can work. If Analytics is
already connected, go directly to its saved settings check below.
     ⚠ Warning: Site Kit may turn its Analytics code on when you connect. If another tool already places
     GA4, check and turn Site Kit’s code off immediately after setup, before testing visitors’ choices.

     a. If Analytics is not connected, open Site Kit > Settings > Connect More Services > Analytics > Set
     up Analytics. Sign in with the account that manages the property and allow the requested access.
     On Connect Service, check the selected account, property and web stream against Website in your
     note; change them if they point to another site.

     b. For a new connection, keep Enable enhanced measurement off. That option would enable extra
     automatic visit actions; this guide keeps your existing tracking setup. Click Set up to finish the
     connection, then open Site Kit > Settings > Connected Services > Analytics > Edit.

     c. Check Place Google Analytics code. Turn it off if Tag Manager or another tool already places the
     GA4 tag; keep it on if Site Kit places your website’s only GA4 tag. For a new connection, turn Plugin
     conversion tracking off to avoid adding automatic form or purchase events. Click Confirm changes,
     then reopen Analytics settings to check the saved choices.

1.4 In Checks, add columns Choice, analytics_storage, ad_storage, ad_user_data, and
ad_personalization. The first controls Analytics cookies. The other three control advertising
cookies, sending user data for advertising, and personalized advertising. Denied and Granted
are the states you will check.


2. Install the banner and connect it to Site Kit
Use one manager: Site Kit sends Google consent instructions, WP Consent API carries the
choices, and Complianz displays the banner.

2.1 In WordPress, open Plugins > Add New Plugin, search for Complianz – GDPR/CCPA
Cookie Consent by Complianz, then Install Now > Activate. Choose No, Thanks if an optional
Website Scan offer asks for email registration. Open Complianz > Wizard and use Continue to
proceed past optional scan or external-service connection offers; the local banner setup does
not require those accounts.

2.2 Open Site Kit > Settings > Admin Settings. Turn Consent Mode on. If Site Kit shows an
Install button for WP Consent API, use it to install and activate the plugin.

2.3 Return to Complianz > Wizard. In General, choose the owner-approved region for the opt-in
banner and fill in the supplied business contact details. Select the existing privacy and cookie
policy pages or enter their approved URLs when the wizard asks.
     ⚠ Warning: Use the owner’s actual privacy decisions. A generated page or a plugin’s suggested
     answer does not establish legal compliance. If the required region or policy needs a paid feature,
     stop and ask the owner to choose another supported setup.

2.4 In Wizard > Consent > Statistics, choose the option matching the tool that places your
existing GA4 tag: Yes, and Google Tag Manager fires this script when Tag Manager places it,
or Yes, with Google Analytics when Site Kit places it directly. Choose Yes when asked to
require consent for statistics. Save and continue.
     ⚠ Warning: Select data-processing, sharing or IP-handling assertions only when the owner
     confirms they are true. Leave unknown assertions unchecked and ask the owner; never claim an
     agreement has been accepted.

2.5 In Wizard > Consent > Services, answer the advertising, first-party marketing and
embedded-service questions from the owner’s website inventory. For a third-party service you
use, select it and answer its hosting questions truthfully. Save and continue. The banner may
offer Marketing for third-party services even when the site does not run ads.
     ⚠ Warning: A consent category gives permission; it does not install advertising tags. Keep service
     answers factual rather than inventing ads to make a category appear.

2.6 In Wizard > Consent > Plugins, confirm Google Site Kit is detected. In Statistics
configuration, keep Complianz’s own Google Consent Mode V2 option at No; Site Kit provides
Consent Mode through WP Consent API. Continue without adding another Analytics tag or
signing up for an external cookie-database service.

2.7 Configure the public banner and its persistent preference control in Complianz > Consent
Banner.

     a. Choose Accept - Deny - View Preferences under Categories. Use the wording and policy links
     from Owner instructions. Keep Disable banner off, then save.

     b. Set Manage consent display options to Show everywhere, then save. This prevents the
     plugin’s mobile-hide option from hiding the preference control on smaller screens. On the public
     website, use Manage consent to reopen the choices after an initial selection.

     c. Complete the remaining wizard questions from Owner instructions. At Finish, set Show consent
     banner and Enable script and cookie blocker to Yes, then finish setup. Use Continue for an
     optional external cookie-database connection instead of registering. Clear the site/page cache if the
     website uses one.



3. Check the public website’s consent behavior
The banner must change Google’s signals, not merely disappear. Test the real published
website.

3.1 End any existing Tag Manager Preview session. Clear saved site data for this website only
in your browser’s site settings, then connect its homepage in Google Tag Assistant. Keep the
banner unanswered. Click the intended G- measurement-ID chip along the top, then the
website page-title row in the left timeline, then Consent. This page-level view shows the
page’s current consent. Record the date and test region in Checks.

3.2 Select the earliest Consent event in the left timeline. Under API Call, click the rendered call
to expand its fields. Check that analytics_storage, ad_storage, ad_user_data and
ad_personalization all default to Denied in the taught regions. Add a Before choice row to
Checks. For subsequent choices, return to the page-level Consent view described above: when
On-page Update is a dash, its On-page Default value still applies.
      ⚠ Warning: An empty Consent tab or defaults set after tracking begins means the setup is
      unfinished. Recheck the Site Kit toggle, WP Consent API, conflicting implementations and cache
      before continuing.

3.3 On the website, click Accept. Return to the page-level Consent view and read the effective
values. Statistics consent grants analytics_storage; the visible Marketing category grants the
three advertising signals, even without an Ads tag. If Marketing is absent, those stay Denied.
Add an Accept row to Checks. For command details, select the latest Consent event and
expand its rendered API Call; that event’s table may show the earlier state.

3.4 Open Manage consent on the website. Enable Statistics and turn Marketing off, if present,
then Save preferences. Return to the page-level Consent view, read its effective values, and
add a Statistics only row to Checks.

3.5 Open Manage consent again, refuse Statistics and Marketing, then save or click Deny.
Read the effective values in the page-level Consent view and add a Withdraw after accept row
to Checks. Reload the page, return to that view, and confirm the refusal is retained.

3.6 Disconnect Tag Assistant, clear this website’s saved site data again, and reconnect. Click
Deny on the fresh banner. Select the intended G- measurement-ID chip, the website page-title
row, then Consent. Read the effective values and add a Deny on first visit row to Checks.

3.7 For a denied and an accepted visit, use the intended G- measurement-ID chip, website
page-title row and Consent tab to check the Google tag’s current effective values against
Checks. A tag may load and send requests without consented cookies while consent is denied;
a fired tag alone does not mean consent was ignored. End the session when finished.


4. Give the owner the working setup
Keep the settings and observed choices together so future site changes can be checked.

4.1 Send the website owner Cookie consent setup. Include the policy links, plugin names and
the completed choice table. Ask them to review the public banner wording and repeat these
checks after adding tracking services or changing the banner.




Last updated Oct 14, 2026 · Click here to get the most up-to-date version of this SOP
```

</details>

## SOP 134: Connect Google Ads to a GA4 property

**URL:** https://tools.clickminded.com/sop/134
**Capture:** Reference — full text is in `google-ads-sops.md`.

## SOP 133: Connect Google Search Console to a GA4 property

**URL:** https://tools.clickminded.com/sop/133
**Capture:** Full (PDF export)

**Linked external resources/templates (not opened):**
- [(linked resource)](https://analytics.google.com/)
- [(linked resource)](https://search.google.com/search-console)
- [(linked resource)](https://example.com/)
- [(linked resource)](https://www.example.com/)

<details><summary>Full SOP text</summary>

```text
SOP 133 · TRACKING & MEASUREMENT


Connect Google Search Console to a GA4
property
Connect your website’s search visibility to Google Analytics and make its search reports
available to your team.



  ESTIMATED TIME          TOOLS                            RESPONSIBLE
  20 minutes              Google Analytics 4, Google       People connecting a website’s
                          Search Console                   measurement tools so the team can use
                                                           their reports together



Before you start
Requirements
  ●​ One Google account with Editor or Administrator access to the GA4 property and verified-owner
        status for the Search Console property.
  ●​ The website address, GA4 property name and Property ID, and verified Search Console property
     address agreed with the website owner.
  ●​ A GA4 web data stream that collects visits to the same set of website pages as the Search
     Console property.


  THIS SOP COVERS                                      THIS DOES NOT COVER
       ●​ Connect one verified Search Console            ●​ Create a Search Console property or
          website property to one matching GA4               install Analytics tracking
          web stream                                     ●​ Replace a link to a different website or
       ●​ Confirm the saved website-to-stream link          move historical reporting to another web
          and publish the Search Console report             stream
          collection                                     ●​ Analyze search performance or prove
       ●​ Explain where search queries and                  that search traffic has increased
          landing-page reports appear and when
          data is available

Related SOPs
  ●​    SOP 132: Set up Google Search Console with Yoast SEO
  ●​    SOP 010: Create a GA4 property and website data stream
  ●​    SOP 012: Install GA4 through Google Tag Manager
  ●​    SOP 013: Grant an agency Editor access to a GA4 property
  ●​    SOP 037: Find pages to improve using Google Search Console
  ●​    SOP 072: Measure organic-search traffic, leads, and sales in GA4
1. Match the website and reporting destination
Search Console measures appearances in Google Search. A GA4 web stream collects visits on
the website. Match the two sources before connecting them.

1.1 Open Google Analytics. Use the selector at the top to select the agreed account and
property. Open Admin > Property > Property details and check the Property ID against the value
supplied by the website owner.

1.2 In Admin, open Data collection and modification > Data streams. Open the website’s Web
stream. Check its Website URL and copy its Stream ID. Create a note called “Search Console
connection” with fields for Website, GA4 property name and ID, Web stream name and ID,
Search Console property, Link checked on, and Report location. Fill the website and GA4 fields
now.

1.3 Open Google Search Console in another tab. Select the agreed property. For a URL-prefix
property, match the protocol, hostname and included path to the pages collected by the GA4
stream. For example, https://example.com/ and https://www.example.com/ are different
properties. A Domain property covers every protocol and subdomain; use it only when that
broader scope matches the pages collected by this stream.
       ⚠ Warning: If the two tools cover different pages, ask the website owner to identify the correct
       existing property and stream before linking.

1.4 In Search Console, open Settings > Ownership verification. Confirm that the Google
account you are using is a verified owner. Add the exact property address to your Search
Console connection note.


2. Save the link
The link joins the selected Search Console property to one web stream. Google permits only
one Search Console link per GA4 property.

2.1 Return to the same GA4 property. In Admin > Product links, open Search Console links.
Inspect any existing row. If it already names the intended Search Console property and web
stream, open it and continue to the final checks. If there is no link, click Link.
       ⚠ Warning: An existing link to another property or stream cannot be edited. Replacing it changes
       the stream used across report date ranges; ask the website owner to arrange the replacement
      separately.

2.2 If creating a link, choose the Search Console property.

      a. Click Choose accounts beside “Link to Search Console properties I manage.” Select the property
      address from your connection note, then click Confirm and Next.

      b. Select the web data stream whose name and Stream ID match your connection note. Click Next.

      c. Review the Search Console property and web stream together. If they match your note, click
      Submit.

2.3 Return to Admin > Product links > Search Console links and refresh the page. Open the
saved row and check the Search Console property and Web stream against your note. Enter
today’s date under Link checked on.


3. Make the search reports available
Publishing a report collection adds it to this Analytics property’s report menu. It does not publish
your data on the public web.

3.1 Open Reports > Library. Find the Search Console collection card. If it is Unpublished, open
its three-dot menu and choose Publish. If the collection is missing, choose Create new
collection > Search Console, save the supplied collection, then publish it from its card.

3.2 In Reports, open Search Console > Queries, then Google organic search traffic. The
Queries page may show the heading “Queries: Organic Google Search query”; it lists searches
where your website appeared in Google, with impressions and clicks. The second report
connects landing pages to search and website activity. Enter “Reports > Search Console” under
Report location in your connection note.

3.3 Send the Search Console connection note to the person responsible for website reporting.
Explain that Search Console data can take about 48 hours to appear and is limited to the last 16
months. Data cannot precede the later of web-stream creation and site verification. A new or
rarely visited site may have no report rows yet. Ask them to review an eligible date range during
their normal reporting routine; the saved link and available reports complete this setup.




Last updated Oct 14, 2026 · Click here to get the most up-to-date version of this SOP
```

</details>

## SOP 135: Create your first Google Analytics account and website setup

**URL:** https://tools.clickminded.com/sop/135
**Capture:** Full (PDF export)

**Linked external resources/templates (not opened):**
- [(linked resource)](https://analytics.google.com/)

<details><summary>Full SOP text</summary>

```text
SOP 135 · TRACKING & MEASUREMENT


Create your first Google Analytics account
and website setup
Create the account, reporting property and website data stream you need before installing
Google Analytics on your site.



  ESTIMATED TIME         TOOLS                             RESPONSIBLE
  20 minutes             Google Analytics 4                The person setting up website
                                                           measurement for a business that does not
                                                           yet have a Google Analytics account.



Before you start
Requirements
  ●​ A Google account the business will keep control of, with permission to create its Analytics account
      and accept Google’s service terms.
  ●​ The public website address, business name, industry, employee-count range, reporting time zone
      and currency. Ask the business owner for any missing details.


  THIS SOP COVERS                                     THIS DOES NOT COVER
    ●​ One independent Analytics account with            ●​ Installing tracking or proving that visits
        optional data sharing off                            are collected
    ●​ One Google Analytics 4 property and               ●​ Consent setup, key events and
        web data stream                                      advertising links
    ●​ Saved account, property and stream                ●​ Creating Google identities or granting
        settings; IDs ready for installation                 other people access

Related SOPs
  ●​ SOP 010: Create a GA4 property and website data stream
  ●​ SOP 012: Install GA4 through Google Tag Manager
  ●​ SOP 011: Create a Google Tag Manager account and web container


1. Create the business account
An Analytics account groups the business’s reporting properties; it is different from the Google
login you use to sign in.

1.1 Open Google Analytics and confirm the signed-in Google account belongs to the business.
If the business already has an Analytics account, use that account and the related
property-setup guide instead. Otherwise click Start measuring. If Analytics opens an existing
account belonging to another business, open Admin > Create > Account.
     ⚠ Warning: A new account does not recover access to an existing business account. Ask its
     administrator for access before creating a duplicate.
     Then follow: SOP 010: Create a GA4 property and website data stream

1.2 Enter the business name in Account name, such as “Example Bakery.” If Add this account
to your current organization appears, clear it for this independent business account. An
organization groups accounts and can give its users access; connecting a new business to an
unrelated organization would share control with the wrong group. Turn off the optional Account
Data Sharing Settings, then click Next. These sharing choices control extra sharing with Google,
rather than whether your website can send visits.
     ⚠ Warning: If the business owner wants an account inside an existing organization, have them
     confirm that organization and its access arrangements before using a different account-creation
     path.



2. Create the website reporting property
The property holds the website’s reports. The web stream created next identifies the website
that will send data into it.

2.1 Enter a property name that identifies the website, such as “Example Bakery website.”
Choose the business’s reporting time zone and currency, then click Next. The time zone defines
the beginning and end of each reporting day; use the location whose working day the business
reports on. Currency is the unit used for money in reports.

2.2 Select the closest Industry category and the range containing the business’s employee
count, then click Next. Choose the business objective that matches what the owner wants from
this website. For a first view of visits and page activity, choose Understand web and/or app
traffic; a contact-driven business may choose Generate leads. Click Create an account with a
property.

2.3 Read the Google Analytics Terms of Service Agreement and select the business’s country
or region. Review the Google Ads Data Processing Terms where shown. Have the person
authorized to agree for the business complete the displayed acceptance choices and click I
Accept. Continue after that person has accepted the agreement.
     ⚠ Warning: If you cannot agree on behalf of the business, hand this screen to its authorized
     representative before continuing.



3. Create the website stream
A stream is the source that sends website activity into the property. Creating it does not install
tracking.

3.1 Choose Web. For Website URL, select the website’s protocol (https:// or http://) and enter
the remaining address in the URL field. Enter a descriptive Stream name, such as “Example
Bakery website.” Turn Enhanced measurement off and confirm Turn off so automatic extra
interaction tracking remains off. Click Create & continue.


4. Check the saved setup and keep the installation details
Create a note called “Analytics setup” in the business’s shared working document. These details
let the installer select the correct destination.

4.1 Close the Google tag setup panel, then Web stream details. If asked about unsaved
changes, choose Discard Changes; this discards the tag setup suggestion, not your saved
property or stream. In the stream list, click Next, then Continue to Home. Open Admin and
select the new account and property.

4.2 In Admin, open Account > Account details. Check the saved account name and that the
optional sharing settings are off. In the account selector, confirm the new account is listed
independently of the unrelated organization rather than nested under it. In your Analytics setup
note, write “Google login,” “Account name” and “Account ID,” using the values shown.

4.3 In Admin, open Property > Property details. Check the saved name, reporting time zone
and currency against the business inputs. In your Analytics setup note, write “Property name,”
“Property ID,” “Reporting time zone” and “Currency,” with their saved values.

4.4 In Admin, open Data collection and modification > Data streams and select the new web
stream. Check its saved name and full website URL, and confirm Enhanced measurement is off.
In your Analytics setup note, write “Website URL,” “Stream name,” “Stream ID” and
“Measurement ID.” Copy each matching value. The Measurement ID begins G- and is the value
used for later tag installation.
Last updated Oct 14, 2026 · Click here to get the most up-to-date version of this SOP
```

</details>

## SOP 039: Choose the right Google Ads conversion tracking method

**URL:** https://tools.clickminded.com/sop/39
**Capture:** Reference — full text is in `google-ads-sops.md`.

## SOP 026: Track WooCommerce purchases in GA4 with Google Tag Manager

**URL:** https://tools.clickminded.com/sop/26
**Capture:** Full (PDF export)

**Linked external resources/templates (not opened):**
- [WooCommerce order statuses](https://woocommerce.com/document/managing-orders/order-statuses/)
- [WooCommerce Cash on Delivery](https://woocommerce.com/document/cash-on-delivery/)
- [Google Tag Assistant](https://tagassistant.google.com/)
- [GTM4WP WooCommerce settings reference](https://gtm4wp.com/google-tag-manager-for-woocommerce/woocommerce-settings-reference)
- [GTM4WP container settings reference](https://gtm4wp.com/setup-gtm4wp-features/container-settings-reference)
- [Google Analytics purchase event parameters](https://developers.google.com/analytics/devguides/collection/ga4/reference/events)
- [Google Analytics: measure ecommerce with Google Tag Manager](https://developers.google.com/analytics/devguides/collection/ga4/ecommerce?client_type=gtm)
- [Google Tag Manager Help: Google tag and GA4 Event tags](https://support.google.com/tagmanager/answer/13543899?hl=en)
- [Google Analytics: mark events as key events](https://support.google.com/analytics/answer/13128484?hl=en)
- [Google Analytics: validate ecommerce events](https://developers.google.com/analytics/devguides/collection/ga4/validate-ecommerce)
- [Google Analytics Help: Monitor events in DebugView](https://support.google.com/analytics/answer/7201382?hl=en)
- [(linked resource)](https://support.google.com/analytics/thread/396462393/hi-i-m-experiencing-an-issue-where-the-product-price-in-my-ga4-events-is-being-multiplied-unexpect?hl=en)

<details><summary>Full SOP text</summary>

```text
SOP 026 · TRACKING & MEASUREMENT


Track WooCommerce purchases in GA4 with
Google Tag Manager
Send Google Analytics 4 (GA4) WooCommerce order items, value, currency, and a unique
order number when the buyer’s browser reaches the order confirmation page while the order
has a status the store counts as a purchase. GTM4WP adds the order data to the data layer,
and one Google Tag Manager event tag sends it. A later order-status change in WordPress
does not send this browser event by itself.



  ESTIMATED TIME          TOOLS                            RESPONSIBLE
  45 minutes              Google Analytics 4, Google       WordPress store owners and website
                          Tag Manager, WordPress,          maintainers who need GA4 to receive
                          Woocommerce, Gtm4wp              WooCommerce purchase details through
                                                           an existing Google Tag Manager web
                                                           container.



Before you start
Requirements
  ●​ One Google Tag Manager web container already loads on the store and has a Google tag
        connected to its GA4 web stream. If the base Google tag is missing or connected to another
        stream, the related installation guide is needed first.
  ●​    Access to the existing GTM container so you can create and publish tags, plus access to the
        matching GA4 property so you can check DebugView.
  ●​    WordPress administrator access to an active WooCommerce store with GTM4WP version 2.0.0 or
        newer installed. You can activate the installed plugin in this guide if it is inactive.
  ●​    The store owner’s decision about which WooCommerce order statuses count as a purchase,
        including how payment timing and cash on delivery affect that decision.
  ●​    A maintainer-approved no-charge checkout that returns the buyer’s browser to the order
        confirmation page and creates two test orders with different items or totals.


  THIS SOP COVERS                                      THIS DOES NOT COVER
       ●​ Choose order statuses that match the           ●​ Creating or installing a Google Tag
          store’s purchase rule and the moment the          Manager container, Google Analytics 4
          buyer reaches the order confirmation              property, or Google tag
          page                                           ●​ Adding a second Google Tag Manager
       ●​ Use GTM4WP to add order details to the            loader or setting up a new ecommerce
          data layer without sending customer               platform
        details                                          ●​ Counting a later order-status change
    ●​ Send one GA4 purchase event through                  when the buyer’s browser does not return
       the existing GTM web container with                  to the store; ask for a server-side tracking
       dynamic transaction ID, value, currency,             method for delayed or offline payments
       and item details                                  ●​ Google Ads purchase conversions,
    ●​ Preview safe no-charge orders, publish               advertising attribution, refunds,
       the purchase tag, and check its event                subscriptions, and payment settlement
       and items in GA4 DebugView                        ●​ Sending customer personal data or extra
                                                            order details to the data layer

Related SOPs
  ●​ SOP 012: Install GA4 through Google Tag Manager


1. Choose what the store counts as a purchase
GTM4WP checks the order status, but this setup sends the event from the buyer’s browser. The
buyer must reach the order confirmation page while the order has a selected status. A later
WordPress status change by itself does not send the event.

1.1 Create a note called WooCommerce GA4 purchase note. Use the headings Website,
GA4 property, Stream Measurement ID, Container ID and loader, Purchase rule and
statuses, Test checkout, Preview, and Live.

    a. Add the website address and GA4 property name at the top of the note. Keep customer names,
    email addresses, addresses, and payment details out. It is fine to record the non-personal test order
    ID and totals needed for the test.

    b. In Google Analytics, open Admin > Data collection and modification > Data streams. Choose
    Web, then open the stream for this store. Copy its Measurement ID (starts with G-) into Stream
    Measurement ID in the note.

1.2 Ask the store owner which orders GA4 should count, and when the buyer returns to the
order confirmation page. Use the store’s payment methods to choose the statuses.
    ⚠ Warning: The status alone does not send this event. The buyer’s browser must load the order
    confirmation page while the order qualifies.
    Reference: WooCommerce order statuses · Explain what WooCommerce statuses say about
    payment and fulfillment.
    Reference: WooCommerce Cash on Delivery · Confirm that COD orders can remain Processing
    before payment is collected.

    a. For a typical card order, Processing usually means payment has been received and the order is
     waiting for fulfillment, so it can be the purchase status at checkout. Completed usually means
     fulfillment has finished. If WordPress changes an order from Processing to Completed days later,
     that later change will not send this browser event unless the buyer returns to the confirmation page
     while Completed is selected.

     b. For cash on delivery, Processing can happen before the driver collects payment. Ask the owner
     whether the business counts the order at checkout or only after collection. If payment happens later
     and buyers do not return to the site, ask the maintainer for server-side purchase tracking; this
     browser-based method cannot send the event from a later WordPress status change.

     c. Write the owner’s rule, the selected WooCommerce status or statuses, and whether the buyer
     returns to the confirmation page under Purchase rule and statuses. Keep Pending payment,
     Failed, and On hold out of this recipe because payment is missing or not confirmed.

1.3 Ask the website maintainer for the approved no-charge test checkout. Record where to
start, how to place two orders with different items or totals, and how the buyer reaches the order
confirmation page under a selected status in Test checkout.
     ⚠ Warning: Do not place a paid order for this test. If there is no no-charge route that returns to the
     confirmation page, ask the maintainer for another test method.



2. Connect WooCommerce order data to the existing container
A data layer is a page’s shared list of events and values that Google Tag Manager can read.
GTM4WP adds WooCommerce purchase data to that list; its separate container-code setting
controls whether GTM4WP also loads the GTM container.

2.1 Find the existing GTM container ID and confirm which one component loads it on the store.

     a. Open the existing container in Google Tag Manager and copy the GTM- ID shown near the top
     into Container ID and loader in your note. Ask the site maintainer whether Site Kit, GTM4WP, or
     another snippet loads this container if you are not sure.

     b. Open Google Tag Assistant and connect to the store. Confirm that the same container ID
     appears once. If it is missing or appears more than once, ask the maintainer to fix the loader before
     changing plugin settings.

2.2 Open GTM4WP and turn on its WooCommerce data layer while keeping the container
loader that you confirmed in the previous step.
     ⚠ Warning: If you cannot tell which component loads the container, stop and ask the maintainer
     before changing Container code placement.
    Reference: GTM4WP WooCommerce settings reference · Confirm the current ecommerce and data
    layer settings.
    Reference: GTM4WP container settings reference · Confirm that container placement Off leaves
    the data layer available when another loader owns GTM.

    a. In WordPress, open Plugins > Installed Plugins. If Google Tag Manager for WordPress
    (GTM4WP) is inactive, select Activate. Then open Settings > Google Tag Manager >
    WooCommerce. The settings page is available only while the plugin is active.

    b. Under General, turn Track e-commerce On. This is the switch that lets GTM4WP put
    WooCommerce events into the data layer.

    c. Under Data layer content, leave Customer data in data layer and Order data in data layer
    Off. The purchase event uses the ecommerce item data and does not need customer details or the
    full order record.

    d. Under Google Tag Manager > Container code placement, keep the component confirmed in
    step 2.1 as the only loader. If Site Kit or another snippet loads this container, choose Off –
    container code turned off, data layer only in GTM4WP. If GTM4WP is the confirmed sole loader,
    keep its placement active and make sure the saved container ID matches the ID in your note. Leave
    the data layer name as dataLayer unless the maintainer confirms that the container uses a different
    name.

2.3 Set GTM4WP to send only eligible order data and to keep its repeat-order protection on.
    Reference: GTM4WP WooCommerce settings reference · Check the order-status, tax/shipping,
    transaction ID, and repeat-protection controls.
    Reference: Google Analytics purchase event parameters · Confirm the transaction ID, currency,
    value, and items sent with purchase.

    a. In WooCommerce > Purchase tracking, select only the status or statuses recorded in your
    note. Leave Pending payment, Failed, and On hold unchecked.

    b. Turn Exclude tax from revenue and Exclude shipping from revenue On. Leave Do not flag
    orders as being tracked unchecked; this keeps GTM4WP from sending the same order again
    when its confirmation page is reloaded. Leave Transaction ID prefix empty unless the store already
    uses a prefix convention.

    c. Select Save changes and record the selected statuses, value options, and repeat-protection
    state under Purchase rule and statuses in your note.



3. Create one GA4 purchase event tag
Use the exact purchase event so product views, cart actions, and checkout starts do not count
as orders.

3.1 Confirm the existing Google tag sends to the intended GA4 web stream, then check that no
other tag or plugin is already sending purchases to that stream.

    a. In Google Tag Manager, open the identified container and open its existing Google tag. Confirm
    its destination is the web stream whose Measurement ID is in your note. Keep this Google tag in
    place. If it is missing or points to another stream, follow the related installation guide before
    continuing.
          Then follow: SOP 012: Install GA4 through Google Tag Manager

    b. In the GTM Tags list, open existing Google Analytics: GA4 Event tags and inspect each tag’s
    Event Name and Measurement ID fields for purchase sent to the stream ID in your note. Also
    check Plugins > Installed Plugins for another WooCommerce-to-GA4 tracking plugin. If another
    source may send purchase to the same Measurement ID, ask the maintainer which single sender to
    keep before proceeding.

3.2 Create a GA4 Event tag named GA4 - WooCommerce purchase for the intended web
stream.
    Reference: Google Analytics: measure ecommerce with Google Tag Manager · Confirm the GA4
    Event tag’s Send Ecommerce data and Data Layer configuration.
    Reference: Google Analytics purchase event parameters · Confirm the transaction ID, currency,
    value, and items sent with purchase.
    Reference: Google Tag Manager Help: Google tag and GA4 Event tags · Confirm Google tags use
    Tag ID while GA4 Event tags use Measurement ID for one specific GA4 data stream.

    a. In the same GTM container, create a new tag and choose Google Analytics: GA4 Event as its
    type. Enter purchase in Event Name.

    b. Enter the stream Measurement ID from your note in the tag’s Measurement ID field. Keep the
    existing Google tag in place as the base tag.

    c. Under More Settings > Ecommerce, turn on Send Ecommerce data and choose Data Layer
    as the source. GTM4WP provides each order’s current items, prices, quantities, currency, value, and
    transaction ID; do not enter fixed order values.

3.3 Create a trigger named WooCommerce purchase event. Choose Custom Event, enter
the exact event name purchase, and leave it set to all custom events with that name. Attach it
to GA4 - WooCommerce purchase, then save the trigger and save the tag.
3.4 In the matching GA4 property, open Admin > Data display > Events and check that the
existing purchase event is marked as a key event. If it is already marked, leave it as it is. If it is
listed but not marked, mark that existing event; do not create another event. Record the visible
state in Live in your note.
     Reference: Google Analytics: mark events as key events · Confirm how an existing GA4 event is
     marked as a key event.



4. Test the order data and check the live GA4 event
Preview with two safe no-charge orders first. Then publish the tag and check that GA4 receives
the event details and items.

4.1 Use GTM Preview to connect Tag Assistant to the store, then confirm that no purchase tag
fires before an eligible order.

     a. In the GTM container workspace, select Preview. Enter the test checkout address from your note
     and connect Tag Assistant.

     b. Visit the product, cart, and checkout pages without placing an order. In Tag Assistant, check each
     page’s event list and confirm GA4 - WooCommerce purchase has not fired.

4.2 Place the first approved no-charge order and inspect its purchase event in Tag Assistant.

     a. Use the checkout in your note to place one no-charge test order. Make sure the buyer’s browser
     returns to the order confirmation page while the order has a selected status.

     b. In Tag Assistant, select the purchase event. Confirm GA4 - WooCommerce purchase fired
     once. Open the event’s data and check that transaction_id is the WooCommerce order number,
     currency matches the store, value matches the item total without tax or shipping, and items lists
     the test product with its item ID or name, price, and quantity.

4.3 Place a second approved no-charge order with a different item or total. In Tag Assistant,
check that it has a different transaction ID and that its value and items match the second order.

4.4 Check that unconfirmed orders stay out and a repeat page view does not send the same
order twice.
     ⚠ Warning: If an excluded status sends a purchase or a reload sends the same order again, return
     to the status list and repeat-order setting before publishing.

     a. If the no-charge route can create a Pending payment, Failed, or On hold order, open its
     confirmation page and check that the purchase tag does not fire. If the route cannot create one of
    these statuses safely, record that it was not tested.

    b. Reload the confirmation page for an eligible test order. Check that the purchase tag does not fire
    a second time for that order.

4.5 Review the GTM workspace changes and publish the new purchase tag and trigger to the
existing container. Name the version WooCommerce GA4 purchase and record its version
number under Live in your note.

4.6 Start a fresh Live Tag Assistant check, place a new eligible order, and confirm that GA4
received its purchase event and item details.
    Reference: Google Analytics: validate ecommerce events · Use DebugView to inspect ecommerce
    event parameters and its Items tab.
    Reference: Google Analytics Help: Monitor events in DebugView · Find DebugView in GA4 and
    select the device used for a test.
    Reference: GTM4WP WooCommerce settings reference · Understand that the browser needs to
    return to the order received page and that asynchronous payments without a return require
    server-side tracking.

    a. In Tag Assistant, open the connected container details. Select Change container environment
    or version. Choose Environment ID 1 / Live, then select its Debug link. When Tag Assistant says
    the container is updated for debugging, select Reload page. Before testing, confirm the container
    details show Container Version Live.

    b. Use the approved no-charge checkout for one new eligible order and let the buyer’s browser
    reach the confirmation page. Confirm the purchase tag succeeds once in the Live Tag Assistant
    session.

    c. In Google Analytics, open Admin > Data display > DebugView. In the Debug Device
    dropdown, select the browser used for the live test. Find and select the fresh purchase marker for
    your test order.

    d. With the purchase event selected, open Parameters. Confirm transaction_id matches the test
    order number, value matches its total under your selected tax/shipping rule, and currency matches
    the store.

    e. Open Items and expand the product row. Confirm its item ID or name and quantity match the test
    order.

    f. Compare the item price with the normal price shown in the successful Tag Assistant purchase
    event. DebugView may display an item price multiplied by 1,000,000 (for example, 12.34 as
     12340000); do not change the store price to match that display. Record the event time, order ID,
     value, currency, item ID or name, quantity, and price comparison under Live in your note.
           Reference: Google Analytics Help Community: DebugView product price display · Read the
           Help Product Expert explanation for why DebugView may show item price in microcurrency
           units; it is a community answer, not a normative product specification.




Last updated Sep 24, 2026 · Click here to get the most up-to-date version of this SOP
```

</details>

## SOP 025: Track Contact Form 7 submissions in GA4 with Google Tag Manager

**URL:** https://tools.clickminded.com/sop/25
**Capture:** Full (PDF export)

**Linked external resources/templates (not opened):**
- [Google Analytics](https://analytics.google.com/)
- [(linked resource)](https://support.google.com/analytics/answer/9539598?hl=en)
- [Google Tag Manager](https://tagmanager.google.com/)
- [(linked resource)](https://support.google.com/tagmanager/answer/9442095?hl=en)
- [GTM4WP: Track Contact Form 7 submissions](https://gtm4wp.com/setup-gtm4wp-features/how-to-track-contact-form-7-submissions)
- [(linked resource)](https://gtm4wp.com/setup-gtm4wp-features/container-settings-reference)
- [Google Tag Manager Help: Custom event trigger](https://support.google.com/tagmanager/answer/7679219?hl=en)
- [Google Analytics Help: Set up events in Tag Manager](https://support.google.com/tagmanager/answer/13034206?hl=en)
- [Google Analytics: Recommended event `generate_lead`](https://developers.google.com/analytics/devguides/collection/ga4/reference/events#generate_lead)
- [Google Analytics Help: Set up a key event](https://support.google.com/analytics/answer/12966437?hl=en)
- [Google Analytics Help: Create or modify key events](https://support.google.com/analytics/answer/12844695?hl=en)
- [Google Analytics Help: Report on key events](https://support.google.com/analytics/answer/12571843?hl=en)

<details><summary>Full SOP text</summary>

```text
SOP 025 · TRACKING & MEASUREMENT


Track Contact Form 7 submissions in GA4
with Google Tag Manager
Use Google Analytics 4 (GA4) to count one successful Contact Form 7 response as a lead. The
GTM4WP WordPress plugin sends Google Tag Manager a small message about the form result
and ID; keep what visitors typed out of that message.



 ESTIMATED TIME         TOOLS                              RESPONSIBLE
 60 minutes             Google Analytics 4, Google         A website owner or marketer who needs
                        Tag Manager, WordPress,            GA4 to count a successful same-page
                        Contact Form 7, Gtm4wp             enquiry from one Contact Form 7 form.



Before you start
Requirements
  ●​ SOP 012: Install GA4 through Google Tag Manager
  ●​ Access to the existing GTM Web container loaded on this form page, with permission to edit and
     publish it. If you cannot tell which WordPress tool loads it, ask the maintainer before changing
     container settings.
  ●​ WordPress administrator access, one active Contact Form 7 form that reports success on the
     same page, and the GTM4WP plugin installed. If the plugin is inactive, this guide shows how to
     activate it.
  ●​ Google Analytics property access at Marketer level or higher so you can mark the event as a key
     event.
  ●​ A safe way to test an invalid form and send one successful test using details you control; use an
     inbox you control if the form sends email.


 THIS SOP COVERS                                      THIS DOES NOT COVER
    ●​ Track one Contact Form 7 form that stays         ●​ Other form plugins, forms that redirect to
       on the same page and shows its                      a thank-you page, or a custom form
       successful-send response                            whose success signal is unknown
    ●​ Use GTM4WP's success-only data layer             ●​ Count a Submit click, invalid entry, spam
       event and filter it to the chosen numeric           response, failed mail send, or general
       form ID                                             submission attempt as a lead
    ●​ Send the GA4 recommended event                   ●​ Install a Google Tag Manager container
       generate_lead and mark it as a key event            or GA4 base tag, create a new GA4
    ●​ Keep visitor-entered form values out of             property, or configure Google Ads
       the data layer, test an unsuccessful                conversions
       attempt and a successful submission,             ●​ Prove that a recipient opened the email,
       and confirm GA4 receipt                             that a CRM stored the enquiry, or that a
                                                               lead became a customer
                                                           ●​ Send names, email addresses,
                                                               messages, or a guessed monetary value
                                                               to GA4

Related SOPs
  ●​ SOP 015: Track lead form submissions using a thank-you page in GA4
  ●​ SOP 012: Install GA4 through Google Tag Manager


1. Prepare the Contact Form 7 success signal
GTM4WP is a WordPress plugin that puts a small form-result message in the page's data layer,
a behind-the-scenes message that Google Tag Manager can read. This guide uses the
successful-send message for the lead event and leaves visitor-entered values out.

1.1 Create a note called Contact Form 7 GA4 tracking note with the headings Form and
page, Tag Manager, Preview checks, and Live check. Use it to keep the website, container,
and stream details for this setup.

     a. Create or open the note and add the four headings. Under Form and page, record the Contact
     Form 7 form name and the full page address. Leave the numeric form ID blank until step 2.1.

     b. Open Google Analytics, select the intended property, then open Admin > Data streams and
     choose the Web stream for this site. Check the website address and copy its full Measurement ID
     (starts with G-) under Tag Manager in your note.
          Reference: Google Analytics Help: Find your Google tag ID · Check where to find the
          Measurement ID for a web stream.

     c. Open Google Tag Manager and select the account and existing Web container used by this site.
     Copy the container ID beginning GTM- into Tag Manager in your note. On the form page, use Tag
     Assistant to confirm it detects the same GTM- ID. If the IDs do not match or you cannot tell which
     container is loaded, ask the site maintainer before editing or publishing.
          Reference: Google Tag Manager Help: Set up a Google tag using Google Tag Manager ·
          Identify the selected account and Web container before editing its tags.

1.2 Turn on GTM4WP's Contact Form 7 data-layer message, while keeping the values visitors
type out of it.
     Reference: GTM4WP: Track Contact Form 7 submissions · Check the current Contact Form 7
     integration settings and event names.
     a. In WordPress, open Plugins > Installed Plugins and find Google Tag Manager for WordPress
     (GTM4WP). If its status is Inactive, select Activate; only then is Settings > Google Tag Manager
     available. If GTM4WP is not listed, ask your site administrator to install it before continuing.

     b. Before changing GTM4WP's Container code placement, confirm which WordPress tool adds
     the GTM- container already detected on the form page. Check the active plugins or site settings for
     Site Kit, GTM4WP, or a header/footer snippet. If you cannot confirm which one adds this exact ID,
     ask the site maintainer; do not turn off a loader that may be the only one.

     c. In WordPress, open Settings > Google Tag Manager > Contact Form 7. Turn on the Contact
     Form 7 integration. Set Submitted field values in the data layer to None and keep Also push
     GA4 recommended events off. This guide sends its own filtered generate_lead tag, so turning on
     both sources could count the same successful send twice. Save the settings.
           ⚠ Warning: The field-value control is available in GTM4WP 2.0 and newer. If your settings do
           not offer None, ask the site maintainer to update or safely configure the plugin before
           continuing.
           Reference: GTM4WP: Track Contact Form 7 submissions · Confirm the integration settings
           and the form events sent to the data layer.

     d. Keep exactly one tool loading the connected GTM container. If Site Kit or another confirmed tool
     already adds this same container, set GTM4WP Container code placement to Off – container
     code turned off, data layer only. If GTM4WP is the only tool adding it, keep GTM4WP placement
     enabled and confirm its container ID matches the GTM- ID in your note. Do not add a second loader.

     e. In GTM4WP's Google Tag Manager settings, leave Advanced data layer variable name blank
     to use the standard dataLayer. If the site uses a custom name, ask the maintainer before changing
     it.
           Reference: GTM4WP: Container settings reference · Confirm that a blank field uses the
           standard dataLayer.



2. Build the success-only GA4 event
Use the specific GTM4WP message that follows a successful Contact Form 7 send. The
general submission message also follows unsuccessful attempts, so use the success message
and the chosen form ID.

2.1 In WordPress, open Contact > Contact Forms, find the form on your recorded page, and
select Edit. In the editor address bar, copy the digits after post= (for example, post=274) into
Form and page in your note. Use these digits as the form ID; the shortcode may display a
different hash.
     Reference: GTM4WP: Track Contact Form 7 submissions · Confirm the `formid` value corresponds
     to the Contact Form 7 form ID.

2.2 Create one Google Tag Manager trigger that matches the successful-send event and the
chosen form ID.
     Reference: Google Tag Manager Help: Custom event trigger · Check how a Custom Event trigger
     listens for a named data layer event.

     a. In Google Tag Manager, open Variables. Under User-Defined Variables, select New and
     choose Data Layer Variable. Enter formid for Data Layer Variable Name, keep the default
     data-layer version, and name the variable DLV - formid. Save it.

     b. In Triggers, create a Custom Event trigger. Enter gtm4wp.contactForm7MailSent as the Event
     name. Choose Some Custom Events, then add the condition DLV - formid equals the numeric
     form ID in your note. Save the trigger with a name that identifies the form, such as CF7 - successful
     send - [form name].

2.3 Before adding the tag, open existing Google Analytics: GA4 Event tags in this GTM
container. Inspect each tag’s Event Name and Measurement ID for generate_lead sent to the
G- stream in your note. In WordPress Plugins > Installed Plugins, check whether another form
or Analytics plugin sends GA4 events. If another source may send this form’s generate_lead,
ask the maintainer: “Which one source should send generate_lead for this form?” Keep one
source so a successful send is not counted twice.

2.4 Create a Google Analytics: GA4 Event tag for the selected form's successful send.
     Reference: Google Analytics Help: Set up events in Tag Manager · Check the GA4 Event tag fields
     and Preview, publish, and receipt workflow.
     Reference: Google Analytics: Recommended event `generate_lead` · Check the recommended
     event name and the meaning of a generated lead.

     a. In Tags, create a Google Analytics: GA4 Event tag. Enter the G- Measurement ID from your
     note, set Event Name to generate_lead, and add the event parameter form_id. For its value, select
     the variable-picker icon and choose DLV - formid; do not type the variable name as plain text.
     Select the successful-send trigger you created, then save the tag.

2.5 In Google Analytics, open Admin > Data display > Events. A key event is an action you
choose to highlight as important in reports. This setting is for the generate_lead event name; the
GTM trigger above still limits this tag to the selected form.
     Reference: Google Analytics Help: Set up a key event · Check event marking and the
     few-minutes-to-few-hours setting delay.
     Reference: Google Analytics Help: Create or modify key events · Check the code-based event and
     key-event settings.

     a. Under Recent events, find generate_lead. If its star is not on, click the star to mark it as a key
     event. In Key events, open the row’s Action menu > Change counting method, select Once per
     event, and save if the selection changed. Then open Action menu > Set default key event value
     and choose Don’t set a default key event value; save if the selection changed. If either choice is
     already selected, leave it as it is.

     b. Only if generate_lead is not listed under Recent events, select + Create event, enter
     generate_lead, turn on Mark as key event, choose Once per event and Don’t set a default key
     event value, then choose Create with code and create it. This registers the event your GTM tag
     will send; do not create a page-view rule or a second event source.



3. Check unsuccessful and successful submissions
Preview first so errors and successful sends are easy to tell apart. Publish only after the chosen
form sends the GA4 event once for success and not for an unsuccessful attempt.

3.1 Use Tag Manager Preview with a test entry to check one unsuccessful attempt and one
successful send.
     ⚠ Warning: Use details you control for the test. A valid form may send an email, so use an inbox
     you control.

     a. In the GTM container workspace, select Preview, enter the form page address from your note,
     and connect Tag Assistant. On the connected form page, leave a required field empty and select
     Submit. In Tag Assistant, choose gtm4wp.contactForm7InvalidInput; confirm the generate_lead tag
     did not fire.

     b. Submit one successful test using details you control. In Tag Assistant, choose
     gtm4wp.contactForm7MailSent; confirm DLV - formid matches your form ID and the GA4 Event tag
     fires once. If the following gtm4wp.contactForm7Submitted message appears, confirm the GA4 tag
     does not fire again.

3.2 In Google Tag Manager, review the workspace changes and select Submit. Choose
Publish and Create Version, add a version name and short description for the Contact Form 7
lead event, review the change list, and publish the tested version.
     Reference: Google Tag Manager · Publish the tested container version.

3.3 After the tag is published and the key-event setting has applied, send a new successful test
and check its Live receipt in Tag Assistant and GA4 Realtime.
     Reference: Google Analytics Help: Report on key events · Check Realtime and DebugView
     evidence for a key event.
     Reference: Google Analytics Help: Tutorial to set up a key event · Check the key-event activation
     wait and Realtime confirmation.

     a. If you just marked generate_lead, Google says the setting can take a few minutes to a few hours
     to apply. Check Admin > Data display > Events > Key events until generate_lead is on. Then use
     a new form submission for the receipt check; refreshing an earlier result does not send a new event.
           Reference: Google Analytics Help: Set up a key event · Confirm the setting delay and that a
           fresh event is used to check Realtime.

     b. In the connected Tag Assistant window, open the container details and select Change container
     environment or version. Choose Environment ID 1 / Live, then select its Debug link. When Tag
     Assistant says the container is updated for debugging, select Reload page. Before testing, confirm
     the details show Container Version Live for the GTM- ID in your note.

     c. Submit the form successfully again using details you control. In Tag Assistant, confirm the GA4
     Event tag fires once on gtm4wp.contactForm7MailSent. In Google Analytics, open Reports >
     Realtime and look for the new generate_lead under Event count by Event name. Open its details
     and confirm form_id matches your chosen numeric form ID. Check Key events by Event name for
     the fresh event.

     d. Write the test date, the new generate_lead event, matching form_id, key-event state, and Live
     GTM version under Live check in your note. If Realtime receives the event but the key-event card
     has not updated, wait for Google's setting to apply, then send another new successful test. If the
     event is missing, ask the site maintainer to check the container, stream ID, and form trigger.




Last updated Sep 24, 2026 · Click here to get the most up-to-date version of this SOP
```

</details>

## SOP 028: Check campaign UTM traffic in GA4

**URL:** https://tools.clickminded.com/sop/28
**Capture:** Full (PDF export)

**Linked external resources/templates (not opened):**
- [Google Analytics Help: Traffic acquisition report](https://support.google.com/analytics/answer/12923437?hl=en)
- [Google Analytics](https://analytics.google.com/)
- [Google Analytics Help: Traffic-source dimension scopes](https://support.google.com/analytics/answer/11080067?hl=en)
- [Google Analytics Help: Data freshness](https://support.google.com/analytics/answer/11198161?hl=en)

<details><summary>Full SOP text</summary>

```text
SOP 028 · TRACKING & MEASUREMENT


Check campaign UTM traffic in GA4
Make one clearly labeled visit through a UTM link, a URL with labels for its source, medium, and
campaign. Then check whether Google Analytics 4 (GA4) reports those same values for the
session. Standard reports can take 24–48 hours to process new data and may change while
processing. This is an estimate, not a required wait or guarantee.



  ESTIMATED TIME        TOOLS                             RESPONSIBLE
  15 minutes            Google Analytics 4, Web           People who want to check that a website
                        Browser                           visit from a tagged campaign link appears
                                                          under the expected labels in Google
                                                          Analytics 4.



Before you start
Requirements
  ●​ Viewer access to the GA4 property that should receive visits from the website
  ●​ A page on the website being checked that you can open in a browser, with permission to make one
     analytics test visit
  ●​ A note you can edit to save the test URL, its source, medium, campaign, and report result


  THIS SOP COVERS                                    THIS DOES NOT COVER
    ●​ Make one clearly labeled test visit              ●​ Planning or sending a campaign
       through a UTM link                               ●​ Paid ads, campaign spending, or
    ●​ Find that visit in GA4 Traffic acquisition          campaign performance analysis
       using session-scoped source, medium,             ●​ Installing or repairing GA4 tracking,
       and campaign dimensions                             changing consent settings, or changing
    ●​ Record whether the report values match              report filters
       the values on the link

Related SOPs
  ●​ SOP 008: Create consistent campaign UTM URLs
  ●​ SOP 012: Install GA4 through Google Tag Manager


1. Prepare and open a test visit
1.1 Prepare one tagged link and note its expected labels before you open it.
     a. In your campaign note, create a section named GA4 traffic check.

     b. Choose easy-to-recognize values for the three UTM labels. Source (utm_source) is where the
     link appears; medium (utm_medium) is the type of placement; campaign (utm_campaign) is the
     promotion name. For example, use source sop_test, medium email, and campaign
     ga4_check_20260923; replace the date with your test date.

     c. If you need to build the link, follow the linked SOP. Copy the complete URL into the GA4 traffic
     check section beside its exact utm_source, utm_medium, and utm_campaign values.
         Then follow: SOP 008: Create consistent campaign UTM URLs

1.2 Open the tagged link as the first page in a fresh private or Incognito window so it starts a
new visit; a different UTM link opened during an existing visit does not replace that visit's
campaign labels. After the page loads, record the visit date and time in the GA4 traffic check
section of your campaign note.
     ⚠ Warning: Use the website's usual cookie choices. If you do not allow Analytics cookies, GA4
     may not receive the visit.
     ⚠ Warning: A test visit can add to your GA4 traffic totals. Use a test property if you have one;
     otherwise keep the source and campaign labels clearly marked as a test.

     a. Close any other private or Incognito windows, then open a new one.

     b. Copy the full tagged URL from your campaign note and paste it into the new window. Use your
     usual cookie choices if the website asks.



2. Find the visit in GA4
2.1 Open the standard Traffic acquisition report for the website and set a date range that
includes your visit.
     Reference: Google Analytics Help: Traffic acquisition report · See how Google describes the
     standard report and its session-scoped traffic-source dimensions.

     a. Open Google Analytics and select the property that collects visits for your website. In Reports,
     open Traffic acquisition. Depending on the report collection, it may be under Acquisition or
     Business objectives → Generate leads. If the report is missing, ask a GA4 Editor or Administrator
     to add the standard report to the menu.

     b. Set the date range to include the visit date in your note. If you opened the link today, choose
     Today. For an earlier visit, choose a custom date range starting on the visit date and ending today.
     Then select Apply.
2.2 Set the table to show the source and campaign for this visit. Choose Session source /
medium in the first dimension menu. Click the + beside it, search for Session campaign, and
add that dimension. Use these Session dimensions, not First user: Session means this visit;
First user means the person's first visit, which may have different labels.
     Reference: Google Analytics Help: Traffic-source dimension scopes · Understand why
     session-scoped dimensions describe each new visit while First user dimensions describe a person's
     first visit.

2.3 Compare the row values with your test link, then record what the Traffic acquisition report
shows in your campaign note.
     ⚠ Warning: Use this report to see which labels GA4 gives the visit. The URL and Realtime view
     alone do not show the report's answer.
     Reference: Google Analytics Help: Data freshness · Check Google's current data-processing
     estimates and why a report can change while data is processing.

     a. Search the table for your campaign value. On that row, compare Session source / medium with
     your source and medium, then compare Session campaign with your campaign. All three values
     must match the ones in your note.

     b. In the GA4 traffic check section, record the report date range, the three values shown, and the
     result. Mark Matched only if all three values match on the same row. If a value differs or the row is
     missing, record what GA4 shows and mark the result Pending.

     c. If the result is Pending, check the same report again later. Google says standard reports can
     take 24–48 hours to process and may change during that time. This is an estimate, not a required
     wait or guarantee. If there is still no exact match after that estimate, mark Not confirmed and ask
     the person who manages your site or GA4 to investigate.




Last updated Sep 24, 2026 · Click here to get the most up-to-date version of this SOP
```

</details>

## SOP 024: Choose your GA4 and Google Tag Manager setup steps for WordPress

**URL:** https://tools.clickminded.com/sop/24
**Capture:** Full (PDF export)

**Linked external resources/templates (not opened):**
- [Site Kit Analytics recommendation](https://sitekit.withgoogle.com/documentation/supported-services/tag-manager/)
- [Site Kit Analytics setup](https://sitekit.withgoogle.com/documentation/supported-services/analytics/)
- [Google Analytics website setup](https://support.google.com/analytics/answer/14183469?hl=en)
- [Google Tag Manager accounts and containers](https://support.google.com/tagmanager/answer/14842164?hl=en)
- [(linked resource)](https://tagassistant.google.com/)

<details><summary>Full SOP text</summary>

```text
SOP 024 · TRACKING & MEASUREMENT


Choose your GA4 and Google Tag Manager
setup steps for WordPress
Choose a Google Analytics 4 (GA4) setup for one WordPress site, check what your business
already has, and write the next steps in order. This guide helps you plan the setup; the linked
guides explain how to make each change.



  ESTIMATED TIME          TOOLS                               RESPONSIBLE
  10 minutes              Google Analytics 4,                 People who need to choose a basic GA4
                          WordPress, Google Tag               setup for one WordPress website and
                          Manager, Site Kit by Google         record the next setup steps.



Before you start
Requirements
  ●​ The URL of the WordPress website you are setting up
  ●​ If you cannot tell which Analytics account or tracking code is connected to the site, a way to
        contact the website owner or tracking maintainer (optional)


  THIS SOP COVERS                                       THIS DOES NOT COVER
       ●​ Choose between the Site Kit Analytics            ●​ Create accounts, properties, streams,
          route and the Google Tag Manager route              containers or tags, or connect services in
          for one WordPress website                           WordPress
       ●​ Identify the Analytics property and              ●​ Install or remove tracking code, change
          website stream to use, or record what the           an existing setup, configure consent, or
          Analytics owner needs to decide                     test website data collection
       ●​ Identify the right Tag Manager account           ●​ Set up tracking for non-WordPress
          and Web container, and check whether                websites, mobile apps, ecommerce or
          that container is already installed                 advertising conversions
       ●​ Write the remaining setup tasks in the           ●​ Choose which business account should
          right order without repeating completed             own website data or resolve account
          steps                                               permissions

Related SOPs
  ●​    SOP 011: Create a Google Tag Manager account and web container
  ●​    SOP 022: Create a web container in an existing Google Tag Manager account
  ●​    SOP 001: Install Google Tag Manager on a WordPress site using Site Kit
  ●​    SOP 010: Create a GA4 property and website data stream
  ●​    SOP 012: Install GA4 through Google Tag Manager
1. Choose where to manage website tracking
Google Analytics 4 (GA4) is where you read website visit reports. A GA4 property is the report
space for your website; its web data stream is the feed from that website into the property.
Google Tag Manager (GTM) is a separate place to manage tracking tags: small pieces of code
that send website activity to Google or another service. A Web container groups tags for one
website. Site Kit connects these services to WordPress and can place their code on your site.

1.1 Create a note named Website setup note where your team keeps website handoffs. Add
Website URL, Method, Analytics details, Tag Manager details, Current site tags, Next
steps, and Questions for owner as headings. Leave a detail blank if you cannot confirm it;
write a question instead of guessing.

1.2 Write the website URL in Website setup note. If the team only needs GA4 reports about
website visits, choose Site Kit Analytics. This is the simpler WordPress route, and Google
recommends Site Kit's Analytics module when using Site Kit. Choose Google Tag Manager if
the business already manages other website tags there or its tracking owner wants one place
for those tags. Do not choose Tag Manager only because you want GA4. If neither choice fits,
ask the website owner what the business already uses. Record your choice under Method.
     ⚠ Warning: If someone has already added Analytics or Tag Manager code to the site and you do
     not know who manages it, ask the website owner before planning a change.
     Reference: Site Kit Analytics recommendation · See why Google recommends the Site Kit Analytics
     module for Analytics on a site using Site Kit.



2. Find the right Analytics destination
Both methods need the right GA4 property and website stream. The stream's Measurement ID
starts with G- and identifies where GA4 receives website activity.

2.1 Ask the Analytics owner which business account, GA4 property and website stream belong
to this site. Record their names and the stream's full G- Measurement ID under Analytics
details. If the team chose Site Kit Analytics, Site Kit can also create a missing account,
property or stream during its setup. If you cannot confirm the intended destination, add the
owner's name or question under Questions for owner.
     ⚠ Warning: Do not select a different property just because it is visible in your Google account. The
     website owner must confirm which business property should receive its data.
     Reference: Site Kit Analytics setup · See how Site Kit connects an existing account, property and
     web data stream or creates missing ones.
     Reference: Google Analytics website setup · Check the current names and requirements for a GA4
     property, Web stream and Measurement ID.

2.2 Add the applicable next task to Next steps. Use the substeps to choose the task for your
method and current setup.

     a. If Method is Site Kit Analytics and the account, property or stream still needs to be selected or
     created, write Set up the Analytics destination with Site Kit in Next steps. The official Site Kit
     Analytics guide explains that setup when you begin it.
         Reference: Site Kit Analytics setup · Use this when you begin the Site Kit Analytics setup.

     b. If Method is Google Tag Manager, an Analytics account exists, and it has no GA4 property for
     this site, write Create a GA4 property and Web stream in Next steps and follow the linked SOP
     when you begin that work.
         Then follow: SOP 010: Create a GA4 property and website data stream

     c. If the GTM method is chosen and the right property already exists but has no website stream,
     write Ask the Analytics owner to add a Web stream to the existing property in Next steps. Use
     Google's instructions when you begin that work; do not create another property.

     d. If the GTM method is chosen but the business has no Analytics account, or you cannot tell which
     account or property belongs to this site, write the exact question for the Analytics owner. Wait for the
     owner to confirm the account before choosing a property or adding a tag.



3. Check the Tag Manager account and container
Use this milestone only when Method says Google Tag Manager. If you chose Site Kit
Analytics, go to milestone 4 to record that route.

3.1 Ask the tracking owner which Tag Manager account belongs to this business. Write the
correct account and Web container, or the appropriate setup task, under Tag Manager details
and Next steps.
     ⚠ Warning: If account names are similar, ask the tracking owner to confirm the correct one. Do not
     create a second company account to work around missing access.
     Reference: Google Tag Manager accounts and containers · Learn why an organization has an
     account and a separate Web container for each website.

     a. If the tracking owner confirms the business has no Tag Manager account, write Create a Tag
     Manager account and first Web container in Next steps. Follow the linked SOP when you begin
     that work.
         Then follow: SOP 011: Create a Google Tag Manager account and web container

     b. If the business has the right Tag Manager account but no Web container for this website, write
     Create a Web container in the existing account in Next steps. Follow the linked SOP when you
     begin that work.
         Then follow: SOP 022: Create a web container in an existing Google Tag Manager account

     c. If a Web container for this website already exists, write its account name, container name and
     complete GTM- ID under Tag Manager details. Add Use the existing container in Next steps; do
     not plan to create another one.

3.2 Open Google Tag Assistant, enter the website's homepage URL and select Connect. Then
choose the substep that matches the account and container details in your note. Record what
Tag Assistant finds; this guide only updates your plan.
     ⚠ Warning: If Tag Assistant cannot connect or its results are unclear, record that as a question for
     the website owner instead of assuming no tag is present.
     Reference: Google Tag Assistant · Check which Google tags are detected on the website.

     a. If step 3.1 identified the existing Web container and Tag Assistant shows the same full GTM- ID,
     record Container already installed under Current site tags.

     b. If step 3.1 identified a Web container but Tag Assistant shows a different GTM- ID, record the
     detected ID and ask the tracking owner whether to keep or replace it. Do not plan another
     installation until the owner decides.

     c. If the note has no selected GTM- ID yet because a container still needs to be created, record
     what Tag Assistant detects. If it finds any GTM ID, ask the owner whether that is the company's
     existing container to reuse before planning a new one. If it finds none, keep the create-container
     task followed by an installation task in Next steps.

     d. If the selected Web container exists in the confirmed Tag Manager account and Tag Assistant
     connects successfully but finds no GTM container on the site, write Install the selected container
     with Site Kit under Next steps. Follow the linked SOP when you begin that work. If Tag Assistant
     finds a different container, keep the owner question from the previous substep instead of planning
     another installation.
         Then follow: SOP 001: Install Google Tag Manager on a WordPress site using Site Kit
4. Record the next steps in order
This guide ends with a plan. Use the linked procedures when you are ready to make the
changes.

4.1 If Method says Site Kit Analytics, write one next task in the note: Connect the confirmed
Analytics account, property and stream with Site Kit. If the destination is missing, write Set
up or create the Analytics destination with Site Kit instead. Follow the official Site Kit guide
when you begin setup. If Site Kit is already connected to the matching property and stream,
record Reuse the current Site Kit connection. If a different Analytics tag or property is active,
ask the owner which one should receive website data before planning code changes.
     Reference: Site Kit Analytics setup · Follow the WordPress steps to connect or create the Analytics
     destination when the work begins.

4.2 If Method says Google Tag Manager, build the Next steps list from the substeps below.
Write down only the tasks that are still missing; this guide does not perform them.

     a. First, list the Analytics destination task from step 2.2 if it is missing. If the property and stream
     already exist, record their names and the G- ID as confirmed instead.

     b. Next, list the Tag Manager account/container task from step 3.1 if one is needed. If the right Web
     container exists, record its full GTM- ID for reuse.

     c. After choosing the container, list the WordPress installation step only if Tag Assistant connected
     successfully and found no GTM container at all. If it found the selected ID, record that the container
     is already installed. If it found a different ID or could not connect, keep the owner question from step
     3.2 and do not list another installation yet.
         Then follow: SOP 001: Install Google Tag Manager on a WordPress site using Site Kit

     d. If the owner confirms that an existing tag already sends data to the chosen G- stream, record
     Reuse the current GA4 setup and do not add another tag. If a different property is receiving data,
     record the owner's decision before planning a change.

     e. If no existing tag sends data to the chosen stream, list GA4 through Tag Manager last only after
     the owner confirms the site's privacy and consent setup and there is no conflicting Analytics tag.
     Follow the linked SOP when you begin that work. If any detail is unclear, put the owner's question
     next instead.
         Then follow: SOP 012: Install GA4 through Google Tag Manager
Last updated Sep 24, 2026 · Click here to get the most up-to-date version of this SOP
```

</details>

## SOP 023: Choose how to track leads and purchases in GA4

**URL:** https://tools.clickminded.com/sop/23
**Capture:** Full (PDF export)

**Linked external resources/templates:** No external links detected in the PDF export.

<details><summary>Full SOP text</summary>

```text
SOP 023 · TRACKING & MEASUREMENT


Choose how to track leads and purchases in
GA4
Choose how Google Analytics 4 (GA4), Google's website reporting tool, should count a form
success or store order. Match the method to what the website reports after a form succeeds or a
store records an order: a dedicated thank-you page, a same-page Contact Form 7 success
response, or a completed WooCommerce order.



 ESTIMATED TIME             TOOLS                            RESPONSIBLE
 15 minutes                 Google Analytics 4, Google       Website owners and marketers who need
                            Tag Manager, Contact Form        to choose how GA4 should count
                            7, Woocommerce, Gtm4wp           enquiry-form leads or online-store orders.



Before you start
Requirements
  ●​ Have the website address. You also need to view its public form or store pages, or ask the website
        maintainer what happens after a form succeeds or checkout ends.


 THIS SOP COVERS                                         THIS DOES NOT COVER
       ●​ Choose whether to measure a form                 ●​ Installing or changing GA4, Google Tag
            submission that the website reports as             Manager, website plugins, tags, or events
            successful or an order completed in            ●​ Forms that use another form tool and do
            WooCommerce                                        not redirect to a dedicated success page
       ●​   Match a form that redirects to a dedicated     ●​ Online stores other than WooCommerce,
            success page to its GA4 setup guide               calls, email clicks, offline leads, and
       ●​   Match a same-page Contact Form 7                  appointment outcomes
            success response to its GA4 setup guide        ●​ Proving payment settlement, handling
       ●​   Match a completed WooCommerce order               refunds, or analyzing advertising
            to its GA4 purchase setup guide                   attribution
       ●​   Record a specific question when the
            website or result does not fit these
            methods

Related SOPs
  ●​    SOP 015: Track lead form submissions using a thank-you page in GA4
  ●​    SOP 025: Track Contact Form 7 submissions in GA4 with Google Tag Manager
  ●​    SOP 026: Track WooCommerce purchases in GA4 with Google Tag Manager
  ●​    SOP 012: Install GA4 through Google Tag Manager
1. Name the result you want GA4 to count
A Submit click is an attempt, not proof that the form worked. A success message or thank-you
page shows what the website reports; it does not prove the details were saved or received. For
an order, choose what WooCommerce records after checkout.

1.1 Create a note called GA4 Method Choice. Add four fields: Website, Result to count,
What the site shows after success, and Chosen guide or next question. Enter the website
address under Website. If you want to measure more than one result, add a separate row for
each result.

1.2 Ask the business owner which result GA4 should count. For this guide, choose either a
form submission the website reports as successful or a WooCommerce order the store
records after checkout. If the owner needs to know whether the form details were saved or
received, write that result down and ask the website maintainer which system can confirm it. If
the business wants both forms and orders measured, make a separate row for each in GA4
Method Choice. If it wants calls, offline leads, or a different action, write that result down; the
methods in this guide do not cover it.


2. Choose a lead form method
Choose a form signal that happens after the website reports success. A click on Submit, a
validation error, spam response, or send error is not a successful form. The guide you choose
must follow the form’s success behavior.

2.1 Ask the website maintainer, or use a recent successful form submission, to find out what
happens after the form succeeds. Record the form tool and the success response in What the
site shows after success. A new page, a same-page success message, and an error after an
attempt mean different things.

2.2 Use the form behavior that matches the row in GA4 Method Choice.

     a. The same fixed thank-you URL opens only after the website reports that the form
     succeeded: write Form → thank-you page under Chosen guide or next question, then follow the
     linked guide. This method counts visits to that page. Reloads or return visits can count again, so it is
     not a record of one unique form submission.
         Then follow: SOP 015: Track lead form submissions using a thank-you page in GA4
    b. The page stays open and Contact Form 7 shows that the submission succeeded: write
    Contact Form 7 → successful submission under Chosen guide or next question, then follow
    the linked guide. It is for the Contact Form 7 success response, not a click on Submit.
         Then follow: SOP 025: Track Contact Form 7 submissions in GA4 with Google Tag Manager

    c. Neither form method above fits: for example, the form uses another tool without its own fixed
    thank-you URL that appears only after success, it stays on the same page without Contact Form 7,
    or its success is unclear. Write Website-specific form tracking needed under Chosen guide or
    next question. Ask the website maintainer: What confirms that this form succeeded, separate
    from a button click or an error, and can that success be sent to GA4? Include the form-page
    address.



3. Choose a store purchase method
A purchase is an order the store records after checkout. Clicking Buy or seeing a checkout
page does not by itself prove that an order was completed.

3.1 Ask the website maintainer which store platform creates the orders. Record the platform
and what the store displays after checkout under What the site shows after success in GA4
Method Choice.

3.2 Choose the purchase method that matches the store and whether its eligible order reaches
the buyer’s confirmation page.

    a. WooCommerce order is eligible when the confirmation page loads: write WooCommerce →
    order purchase under Chosen guide or next question, then follow the child guide. It sends the
    browser purchase event only if the buyer reaches the confirmation page while the order has a status
    selected for the store’s purchase rule. A later status change alone does not send it.
         Then follow: SOP 026: Track WooCommerce purchases in GA4 with Google Tag Manager

    b. The store uses another platform, or the business needs to count settled payments,
    refunds, subscriptions, or advertising attribution: write Platform-specific purchase tracking
    needed under Chosen guide or next question. Ask the store maintainer which completed-order
    signal sends the order number, items, amount, and currency to GA4. If an eligible order is created or
    paid after the buyer leaves and the browser will not return to the confirmation page, ask whether the
    platform can send that order server-side. Do not use a WooCommerce guide for another store
    platform or count a Buy click as an order.

    c. Delayed or offline payment may make the order eligible after the buyer leaves, and the
    buyer may not return: this website method cannot see an order paid later. Ask the maintainer
     whether the store can send purchase tracking directly to GA4.



4. Confirm the next step
4.1 Read the selected guide's requirements before starting it. If that guide requires GA4 to be
installed through Google Tag Manager and the site does not have it, follow the related
installation guide first. That installation guide has its own requirements; this chooser does not
install or change tracking.
     Then follow: SOP 012: Install GA4 through Google Tag Manager

4.2 Read each row in GA4 Method Choice. It should name the desired result, what the site
shows after success, and either one matching guide or one exact question for the website
maintainer.




Last updated Sep 24, 2026 · Click here to get the most up-to-date version of this SOP
```

</details>

## SOP 022: Create a web container in an existing Google Tag Manager account

**URL:** https://tools.clickminded.com/sop/22
**Capture:** Full (PDF export)

**Linked external resources/templates (not opened):**
- [(linked resource)](https://tagmanager.google.com/)

<details><summary>Full SOP text</summary>

```text
SOP 022 · TRACKING & MEASUREMENT


Create a web container in an existing
Google Tag Manager account
Add one Web container for a website to the correct existing Google Tag Manager account, then
save the account and container details for the person who will install it.



  ESTIMATED TIME          TOOLS                          RESPONSIBLE
  10 minutes              Google Tag Manager             The person adding one website to an
                                                         existing company Google Tag Manager
                                                         account so its tracking can be managed
                                                         there.



Before you start
Requirements
  ●​ A Google account with Administrator access to the existing Google Tag Manager account
  ●​ The exact name of the existing Tag Manager account that should own this website's container,
     confirmed by the person responsible for its tracking
  ●​ The website's main domain, such as example.com, supplied by the website owner


  THIS SOP COVERS                                   THIS DOES NOT COVER
       ●​ Add one Web container for one website        ●​ Create a Google Tag Manager account or
          to an existing Google Tag Manager                accept account setup terms
          account                                      ●​ Choose how to group several related
       ●​ Read back and save the account name              website domains into containers
          and ID, website container name and ID,       ●​ Install the container on the website, add
          and workspace link in a handoff note            tags or Analytics, or publish container
                                                          changes
                                                       ●​ Change account or container access for
                                                          other people

Related SOPs
  ●​    SOP 011: Create a Google Tag Manager account and web container
  ●​    SOP 024: Choose your GA4 and Google Tag Manager setup steps for WordPress
  ●​    SOP 001: Install Google Tag Manager on a WordPress site using Site Kit
  ●​    SOP 010: Create a GA4 property and website data stream
  ●​    SOP 012: Install GA4 through Google Tag Manager
1. Identify the correct existing account
A Tag Manager account groups containers. Confirm the account before adding a website
container so it is saved in the right place.

1.1 Create a short note named Website setup note where the website team keeps setup
handoffs. Add these headings: Tag Manager account name, Tag Manager account ID,
Container name, Web container ID, and Workspace link.

1.2 Open Google Tag Manager and sign in with the Google account that has Administrator
access. On Accounts, find the account whose name matches the one confirmed for this
website. In that row, open Account actions > Account Settings.
     ⚠ Warning: If more than one account has a similar name, confirm the correct row with the person
     responsible for the website's tracking before adding a container.

1.3 Check that Account Name matches the account name confirmed for this website. Copy the
displayed name and numeric Account ID into Website setup note under their matching
headings. Choose Close screen to return to Accounts.
     ⚠ Warning: If the account name does not match, close Account Settings and ask the account
     owner to confirm the correct account before creating a container.



2. Add one Web container for the website
A container is the Tag Manager space that will hold tags for a website. A Web container is for
desktop and mobile websites.

2.1 Return to Accounts. In the row for the account you just confirmed, open Account actions
and choose Create Container.

2.2 In Container name, enter the website's main domain from your prerequisites, without an
individual page path. Under Target platform, choose Web, then select Create.


3. Save the container details for handoff
The installer needs the container's full ID to connect it to the website. The workspace link opens
this exact container in Tag Manager.

3.1 If an Install Google Tag Manager panel appears after you create the container, close it
with Close (the X) to open the new container workspace.

3.2 At the top of the workspace, copy the displayed container name and full ID, including GTM-,
into Website setup note under Container name and Web container ID. Copy the workspace
address from your browser into Workspace link.

3.3 Return to Accounts and find the container beneath the account name you checked in
Account Settings. Confirm its name and type Web. Open the container and compare its full
GTM- ID and workspace address with Website setup note.




Last updated Sep 24, 2026 · Click here to get the most up-to-date version of this SOP
```

</details>

## SOP 021: Track WooCommerce purchases in Google Ads with Google Tag Manager

**URL:** https://tools.clickminded.com/sop/21
**Capture:** Reference — full text is in `google-ads-sops.md`.

## SOP 020: Track internal link clicks in Google Ads with Google Tag Manager

**URL:** https://tools.clickminded.com/sop/20
**Capture:** Reference — full text is in `google-ads-sops.md`.

## SOP 019: Track Contact Form 7 submissions in Google Ads with Google Tag Manager

**URL:** https://tools.clickminded.com/sop/19
**Capture:** Reference — full text is in `google-ads-sops.md`.

## SOP 017: Track outbound link clicks in Google Ads with Google Tag Manager

**URL:** https://tools.clickminded.com/sop/17
**Capture:** Reference — full text is in `google-ads-sops.md`.

## SOP 015: Track lead form submissions using a thank-you page in GA4

**URL:** https://tools.clickminded.com/sop/15
**Capture:** Full (PDF export)

**Linked external resources/templates (not opened):**
- [(linked resource)](https://analytics.google.com/)

<details><summary>Full SOP text</summary>

```text
SOP 015 · TRACKING & MEASUREMENT


Track lead form submissions using a
thank-you page in GA4
Use Google Analytics 4 (GA4) to count visits to the thank-you page shown after a lead form is
submitted. Create a generate_lead event and mark it as a key event, an action important to your
business. This method counts thank-you page visits, not unique leads.



 ESTIMATED TIME          TOOLS                               RESPONSIBLE
 30 minutes              Google Analytics 4                  Anyone responsible for measuring an
                                                             existing lead form, with Editor or
                                                             Administrator access to its GA4 property.



Before you start
Requirements
  ●​ Editor or Administrator access to the GA4 property, plus its property ID and website stream name.
  ●​ GA4 already installed on the form and confirmation pages, with the website’s consent choices
      working.
  ●​ The URL of a form with a required field, and its dedicated thank-you-page URL: identical after
      every success, including any trailing slash, with no query string or personal information.
  ●​ Permission and suitable details to submit the form, plus access to its saved-submissions list (often
      called Entries or Submissions) so you can confirm the submission was received. Know any
      messages or subscriptions the form will trigger.


 THIS SOP COVERS                                       THIS DOES NOT COVER
    ●​ One existing form with a dedicated, fixed          ●​ Building forms, installing GA4 or
        thank-you-page URL                                    changing consent settings
    ●​ A no-code generate_lead event with an              ●​ Forms that show success without loading
        exact URL match                                      a new page or use changing success
    ●​ Key-event settings and checks in GA4                  URLs
        Realtime                                          ●​ Deduplicating leads, valuing leads or
                                                             connecting a CRM
                                                          ●​ Google Ads conversions and campaigns,
                                                             ecommerce and attribution analysis

Related SOPs
  ●​ SOP 010: Create a GA4 property and website data stream
  ●​ SOP 012: Install GA4 through Google Tag Manager
1. Check the form and existing measurement
First prove that the page represents an accepted submission and that GA4 can receive activity
from the site.

1.1 In the tool that manages the form, open its saved-submissions list (often named Entries or
Submissions). Try submitting the form with a required field empty and confirm it stays on the
form. Then submit valid details, confirm the saved submission appears in the list, and copy the
final thank-you-page URL from the address bar. It must match the fixed URL in your
prerequisites.
     ⚠ Warning: Use a page reserved for this form’s success. A page reachable through ordinary
     navigation can count visits that were never leads. Reloads and direct visits to the success URL can
     also count again.

1.2 Open Google Analytics, select the property matching your property ID, and open Reports
→ Realtime overview. In a normal browser tab, open the form page again. In Event count by
Event name, open page_view, then page_location—GA4’s field for the full page URL,
including its protocol, domain, path and any query string. Look for the form-page URL from this
visit. Continue only after the new visit is received.

1.3 Open Admin → Data display → Events. Check both Key events and Recent events for
generate_lead. Then open Custom configurations → Custom events for your website
stream and inspect its rules. Continue only if generate_lead is not already collected or
configured.
     ⚠ Warning: If generate_lead already exists, stop here. Adding a second rule can double-count
     leads; its existing setup needs a separate review.



2. Create the lead key event
Create a new event for the exact success URL while keeping ordinary page views unchanged.

2.1 Return to Events and click Create event. Enter generate_lead as the event name and turn
on Mark as key event. Choose Once per event for the counting method and Don’t set a
default key event value for the default value.

2.2 Choose Create without code, select your website stream, and use page_view as the
source event. Enter the thank-you-page URL from step 1.1. Click View more options. Set the
two matching conditions to event_name — equals — page_view and page_location —
equals — your full thank-you-page URL. Enable Copy parameters from the source event,
then click Save to return to the event setup.
     ⚠ Warning: Use equals, not contains. The protocol, domain, path and trailing slash must match the
     actual URL. A different query string will not match this fixed-URL rule.

2.3 Click Create. Open Custom configurations → Custom events for the same stream, then
reopen generate_lead. Check the saved name, both matching conditions and Copy
parameters from the source event.

2.4 Return to the Key events tab and find generate_lead. Confirm it is marked as a key event.
Open its action menu and inspect Change counting method and Set default key event value.
Confirm the saved choices are Once per event and no default monetary value.


3. Check a new submission in Realtime
First, wait at least one hour after saving the new configuration before testing. Google says
changes can take an hour or more to become available, so wait longer if checks are incomplete.
After a test submission, allow a few minutes for its Realtime receipt. The 30-minute work
estimate excludes the initial wait.

3.1 Check that a rejected form attempt does not produce a lead key event.

     a. After the one-hour activation wait in this milestone, choose a quiet period with no submissions
     and no generate_lead events in the previous 30 minutes. Open Reports → Realtime overview and
     confirm generate_lead is absent from both the event-count and key-event cards.
         ⚠ Warning: If someone else submits the form while you are testing, restart during a quiet
         period.

     b. Open the form in a normal browser tab without a debugging session. Try submitting it with a
     required field empty. Confirm it stays on the form page.

     c. In Realtime, find the new page_view and open page_location to confirm it shows the form-page
     URL. Confirm generate_lead is still absent from both cards.

3.2 Within the same 30-minute window, submit valid details once and confirm the saved
submission appears in the form tool’s Entries or Submissions list and the form loads the exact
thank-you-page URL. Do not reload it. After a few minutes, in Realtime open generate_lead
under Event count by Event name, then inspect page_location for that thank-you-page URL.
Check that Key events by Event name also records generate_lead. With no other submissions
since your zero baseline, both cards should show one occurrence.
     ⚠ Warning: If the event or key-event receipt is missing, this check is incomplete. Allow
     configuration time and repeat the check later; do not add another rule to force a result.




Last updated Sep 24, 2026 · Click here to get the most up-to-date version of this SOP
```

</details>

## SOP 014: Grant an agency Edit access to a Google Tag Manager container

**URL:** https://tools.clickminded.com/sop/14
**Capture:** Full (PDF export)

**Linked external resources/templates (not opened):**
- [(linked resource)](https://tagmanager.google.com/)

<details><summary>Full SOP text</summary>

```text
SOP 014 · TRACKING & MEASUREMENT


Grant an agency Edit access to a Google
Tag Manager container
Let an agency prepare tag changes in one Google Tag Manager (GTM) container. The agency
can edit the working draft; your publisher keeps control of saving versions and making changes
live.



  ESTIMATED TIME          TOOLS                            RESPONSIBLE
  15 minutes              Google Tag Manager               Anyone with Administrator access to a
                                                           GTM account who needs an agency to
                                                           prepare changes in one web container.



Before you start
Requirements
   ●​ Your Google Account has Administrator access to the GTM account; you have its account name,
      container name and container ID beginning GTM-.
   ●​ The agency person’s exact Google Account email address, with no existing direct or inherited
      access to this GTM account or its containers. The person is available to accept and check access.


  THIS SOP COVERS                                     THIS DOES NOT COVER
        ●​ One agency person’s existing Google           ●​ Administrator, Approve or Publish grants
           Account, newly granted account User           ●​ Changing existing or inherited access
           permission and Edit access to one web         ●​ Editing tags, creating versions or
           container                                        publishing changes
        ●​ Saved account and container
           permissions, recipient activation and
           access checks

Related SOPs
   ●​ SOP 011: Create a Google Tag Manager account and web container
   ●​ SOP 012: Install GA4 through Google Tag Manager
   ●​ SOP 013: Grant an agency Editor access to a GA4 property


1. Open the correct account and container
1.1 Open Google Tag Manager using your Administrator Google Account. Open the account
and web container from your prerequisites. Confirm the container ID beginning GTM- matches
your target ID.

1.2 Open Admin. In the Account column, choose User Management and search for the agency
person’s exact Google Account email address. Continue only if there is no existing access or
pending invitation for that person. If access is inherited through a group or organization, have
the account owner review it before using this new-access procedure.


2. Give access to one container
2.1 In Account User Management, click + > Add users. Enter the agency person’s Google
Account email address. Set Account Permissions to User, with Administrator unselected. In
Container permissions, open the target container’s permission editor and select Edit, including
Read if shown separately. Clear Approve and Publish, then click Done. Check any other
containers show None (no access).

2.2 Review the recipient’s email address, account User permission and the container table: only
the target container has Edit; any other containers show None (no access). Click Invite.

2.3 Ask the agency person to open Google Tag Manager using the exact Google Account you
invited. If an Invitations card appears on the Accounts screen, open it, expand the invitation,
confirm the account name matches your target account, and click Accept. The account may
appear directly when the person has accepted access before. Have them confirm your target
account is now listed.


3. Check the saved permissions and access
3.1 Return to Admin > Account > User Management and reopen the agency person’s entry.
Check these items in order:

     a. Confirm Has access appears. Confirm the account permission is User and Administrator is off.

     b. Click View all containers to open the full list.

     c. Confirm the target container shows Edit in the full list.

     d. If any other container rows are listed, confirm each permission is None.

     e. Close the full list, then open the target container’s row.

     f. Confirm Read and Edit are on and Approve and Publish are off. If inherited permissions or
     another saved grant give broader access, stop and have the account owner review it.

3.2 Ask the agency person to open the container and confirm its GTM- ID matches your target
ID. Have them open Tags > New to confirm the tag editor is available, then close the empty
editor without saving.




Last updated Sep 24, 2026 · Click here to get the most up-to-date version of this SOP
```

</details>

## SOP 013: Grant an agency Editor access to a GA4 property

**URL:** https://tools.clickminded.com/sop/13
**Capture:** Full (PDF export)

**Linked external resources/templates (not opened):**
- [(linked resource)](https://analytics.google.com/)

<details><summary>Full SOP text</summary>

```text
SOP 013 · TRACKING & MEASUREMENT


Grant an agency Editor access to a GA4
property
Let an agency change settings in one Google Analytics 4 (GA4) property without giving it
permission to manage users. A property is the reporting space for your website or app.



 ESTIMATED TIME         TOOLS                             RESPONSIBLE
 10 minutes             Google Analytics 4                Anyone with Administrator access to a
                                                          GA4 property who needs to give an
                                                          agency permission to configure it.



Before you start
Requirements
  ●​ Your Google Account has Administrator access to the target property; you have its Analytics
      account name, property name and numeric Property ID.
  ●​ The agency person's exact Google Account email address, with no existing direct or inherited
     access to this property; the person is available to confirm access.
  ●​ The property owner's decision on whether the agency may see cost metrics and revenue metrics.
     These are two separate choices.


 THIS SOP COVERS                                     THIS DOES NOT COVER
    ●​ One agency Google Account with direct            ●​ Account-wide access, Administrator
       Editor access to one property                        grants and ownership changes
    ●​ Saved role and cost/revenue data                 ●​ Google Tag Manager permissions and
       restrictions checked against your access            tag installation
       plan                                             ●​ Changing existing or inherited access
    ●​ Agency confirmation that the intended
       property opens

Related SOPs
  ●​ SOP 010: Create a GA4 property and website data stream
  ●​ SOP 012: Install GA4 through Google Tag Manager


1. Open the correct property
1.1 Open Google Analytics using your Administrator Google Account. Use the account and
property selector to choose the account and property from your prerequisites. Open Admin >
Property > Property details and confirm the numeric Property ID matches the one in your
prerequisites.

1.2 In Admin, open Property > Property access management. Search for the agency person's
exact Google Account email address. Continue only if the person has no access listed. If direct
or inherited access appears, stop and have the property owner review it before using this
new-access procedure.


2. Add the agency person
2.1 In Property access management, click + > Add users. Enter the agency person's Google
Account email address and select Notify new users by email. Choose Editor. Under Data
restrictions, select No Cost Metrics if the owner does not allow cost data, and No Revenue
Metrics if the owner does not allow revenue data. Clear either restriction when the owner allows
that data. Editor can change property settings but cannot manage users.

2.2 Check the email address, Editor role and both data restrictions against your prerequisites,
then click Add.


3. Check the saved access
3.1 Reopen the saved user entry, then check its roles and data restrictions in order:

     a. In Property access management, search for the agency person’s exact Google Account email
     and open that user’s entry.

     b. Check that the direct role is Editor and the effective role is Editor. The effective role includes
     access the person already has through the Analytics account that owns this property.

     c. In both the direct and effective permission views, check whether No Cost Metrics and No
     Revenue Metrics are selected.

     d. Compare both roles and both restrictions with the property owner’s choices. The role must be
     Editor in both views. No Cost Metrics should be selected only when the owner wants cost data
     hidden; No Revenue Metrics should be selected only when the owner wants revenue data hidden.
     If either view differs from the plan, stop and ask the owner to review access.

3.2 Ask the agency person to open Google Analytics using the Google Account you added.
Have them select the property, open Admin > Property > Property details, and confirm the
displayed Property ID matches your target ID. They should confirm that property settings are
available to edit; they do not need to save a change.




Last updated Sep 24, 2026 · Click here to get the most up-to-date version of this SOP
```

</details>

## SOP 012: Install GA4 through Google Tag Manager

**URL:** https://tools.clickminded.com/sop/12
**Capture:** Full (PDF export)

**Linked external resources/templates (not opened):**
- [(linked resource)](https://analytics.google.com/)
- [(linked resource)](https://tagmanager.google.com/)
- [Tag Assistant](https://tagassistant.google.com/)

<details><summary>Full SOP text</summary>

```text
SOP 012 · TRACKING & MEASUREMENT


Install GA4 through Google Tag Manager
Add one Google tag through Google Tag Manager, test it in Preview, and confirm that GA4
receives a normal page view after publishing.



 ESTIMATED TIME         TOOLS                            RESPONSIBLE
 35 minutes             Google Tag Manager, Google       People responsible for adding Google
                        Analytics 4, Google Tag          Analytics to a website who can publish its
                        Assistant                        Tag Manager container



Before you start
Requirements
  ●​ Editor access to the existing GA4 property and web stream for this website, with Enhanced
     measurement off
  ●​ Publish access to the installed Google Tag Manager Web container, with no active Google tag on
     the website
  ●​ The installed GTM container ID and two public page URLs on your website that load as separate
     pages and contain no personal information
  ●​ An established website privacy and consent setup that covers GA4 and the Google tag, including
     how you should make an analytics-enabled visit


 THIS SOP COVERS                                     THIS DOES NOT COVER
    ●​ One website whose pages load                    ●​ Creating accounts, properties, streams or
       separately                                          access grants
    ●​ One existing GA4 web stream and                 ●​ Installing the Tag Manager container on
       installed Web container                             the website
    ●​ Automatic page-load events, Preview             ●​ Setting up consent controls or deciding
       checks, live receipt and tag diagnostics           privacy requirements
                                                       ●​ Enhanced measurement, single-page
                                                          applications, custom events and key
                                                          events
                                                       ●​ Campaigns and reporting or attribution
                                                          analysis
                                                       ●​ Adding a destination to an existing
                                                          Google tag

Related SOPs
  ●​ SOP 010: Create a GA4 property and website data stream
  ●​ SOP 001: Install Google Tag Manager on a WordPress site using Site Kit
  ●​ SOP 011: Create a Google Tag Manager account and web container
  ●​ SOP 008: Create consistent campaign UTM URLs


1. 1. Check the destination and existing setup
1.1 Open Google Analytics. Select your property, then open Admin → Data streams and
choose the web stream for your website. Check its website URL and that Enhanced
measurement is off. Create or open a note named Measurement handoff note for this setup.
Copy the stream's Measurement ID, which starts with G-, into that note.
     ⚠ Warning: If the stream URL or measurement settings differ from your starting setup, stop before
     adding the tag.

1.2 Open Google Tag Manager and select the installed Web container. Match its GTM- ID to
your website’s container ID. Review Workspace Changes and open Tags to check for an
existing Google tag or GA4 configuration. If old tags are retained, check that they are marked
Paused.
     ⚠ Warning: Continue only with no unrelated pending changes and no active Google tag. This
     procedure is for a first installation; publishing includes every workspace change.

1.3 Confirm that the published container is the starting point and that the live pages do not
already run an active Google tag.
     ⚠ Warning: If another Google tag or Analytics destination appears, stop before adding a new
     installation.

     a. Open Tag Assistant, connect to your first page URL, and follow the website's normal consent flow
     for an analytics-enabled visit.

     b. Select your GTM container. Under Container Version, open the version selector, choose Debug
     for the Live environment, and click Reload page. Confirm that Container Version reads Live.

     c. Inspect the detected tags on the first page, then open the second page in the same connected
     session. Confirm that the expected GTM container loads on both and that no active Google tag or
     Analytics destination appears.

     d. Click Stop debugging when the baseline check is finished.



2. 2. Add the Google tag
2.1 In your GTM workspace, choose Tags → New. Name the tag Google tag – GA4. In Tag
Configuration, select Google tag and paste the G- measurement ID into Tag ID. Under
Triggering, choose Initialization – All Pages, then save. Reopen the saved tag and check that
its Tag ID matches step 1.1 and its trigger is Initialization for all pages.
     ⚠ Warning: Do not add a separate page_view event tag.



3. 3. Test before publishing
3.1 Test one Google tag on two full page loads in Preview. Tag Assistant shows what the draft
sent; the normal GA4 Realtime receipt comes later.
     ⚠ Warning: Stop before publishing if the tag fails, sends to a different destination, or sends
     duplicate page views.
     ⚠ Warning: Preview and Tag Assistant show what the draft sent. GA4 Realtime confirms a normal
     visit; DebugView is for debug visits and does not replace the later Realtime check.

     a. Click Preview in GTM. Enter the first page URL, click Connect, and return to Tag Assistant to
     click Continue. Follow the site's normal consent flow.

     b. Select the page's Initialization event and check that your Google tag fired once. Select the
     Google tag's destination and inspect its page_view event, GA4's record of a page load. Match the
     G- ID and page_location to your stream and first page.

     c. Open the second page in the same connected session and repeat the Initialization, destination,
     G- ID, page_location, and page_view check.

     d. In the Measurement handoff note, record the two checked page URLs and the one page_view
     result for each full page load.



4. 4. Publish and check the live website
4.1 In GTM, click Submit and choose Publish and Create Version. Review the changes: only
the Google tag you tested should be included. Add a version name and description, then click
Publish. Open the published version and check that the saved Google tag still has your G- ID
and the all-page Initialization trigger. Record the version number in Measurement handoff
note.

4.2 Check that the published container sends page views without relying on the workspace
draft.

     a. In GTM Versions, confirm that the version number from step 4.1 is marked Live.

     b. End the Preview session with Stop debugging and close the previewed website window. Start a
     fresh connection from Tag Assistant to your first page. Select your GTM container, open the selector
     under Container Version, choose Debug for the Live environment, and click Reload page.
     Confirm that Container Version reads Live.

     c. Follow the normal consent flow. Select the Google tag destination on the first page and check
     one page_view to your G- ID. Open the second page in the same connected session and repeat the
     check.

     d. Click Stop debugging and close the connected website window when the Live check is finished.

4.3 Confirm that GA4 received a normal visit outside debugging, using Realtime.
     ⚠ Warning: If both pages cannot be matched, the installation is incomplete. Check the property,
     destination, and normal consent flow without bypassing privacy controls.

     a. In GA4, open Reports → Realtime overview and note the current page_view count and the time
     in Measurement handoff note before opening the test pages.

     b. Open your two page URLs in a normal tab and follow the site's consent flow. Use a unique,
     non-personal query label on each URL to distinguish this visit: append ?check= followed by a short
     label you choose, or &check= if the URL already contains a question mark. Confirm that both pages
     load normally and keep each label in the address bar.

     c. Return to Realtime and refresh it. Under Event count by Event name, click page_view, then
     page_location. Find both complete labeled URLs and confirm one new event for each. Realtime is
     the receipt for this normal visit; DebugView is for debug visits and cannot replace this check. Allow
     up to 15 minutes for initial collection and refresh Realtime before deciding.

     d. If the labels disappear or the pages stop working, use two identifiable page URLs and match
     their new events in View user snapshot instead. If both pages cannot be matched, stop and check
     the property, destination, and normal consent flow without bypassing privacy controls.

4.4 In GA4, return to Admin → Data streams, open your web stream, and choose Configure
tag settings. Read Tag quality and open View diagnostics if issues are listed. In
Measurement handoff note, record the status and any collection issues. Treat an issue
reporting blocked, missing, or stopped data collection as an incomplete installation.
Recommendations alone do not invalidate the result; a pending status does not replace the
event checks.




Last updated Sep 24, 2026 · Click here to get the most up-to-date version of this SOP
```

</details>

## SOP 011: Create a Google Tag Manager account and web container

**URL:** https://tools.clickminded.com/sop/11
**Capture:** Full (PDF export)

**Linked external resources/templates (not opened):**
- [(linked resource)](https://tagmanager.google.com/)

<details><summary>Full SOP text</summary>

```text
SOP 011 · TRACKING & MEASUREMENT


Create a Google Tag Manager account and
web container
Create a home for your website’s tracking setup and save the account and container details for
the person who will install it.



  ESTIMATED TIME         TOOLS                          RESPONSIBLE
  10 minutes             Google Tag Manager             People setting up Google Tag Manager for
                                                        a company that does not already have an
                                                        account



Before you start
Requirements
  ●​ An existing Google account controlled by your company that you can sign in to
  ●​ Authority to create the company’s Tag Manager account and accept its terms
  ●​ Your company name and country, plus the website’s main domain for the container name


  THIS SOP COVERS                                  THIS DOES NOT COVER
    ●​ Create one company account and its first       ●​ Add a container to an existing account
       Web container                                  ●​ Install code on a website
    ●​ Save the account ID, container ID, and         ●​ Create tags, set up Analytics, or publish a
       workspace link                                     container
                                                      ●​ Grant other people access

Related SOPs
  ●​ SOP 001: Install Google Tag Manager on a WordPress site using Site Kit
  ●​ SOP 010: Create a GA4 property and website data stream
  ●​ SOP 012: Install GA4 through Google Tag Manager


1. Create the account and its first container
An account groups your company’s tracking resources. A container holds the tags for one
website.

1.1 Open Google Tag Manager and sign in with your company’s Google account. In Accounts,
check whether your company already has an account. After you confirm that no account exists,
select Create Account to open the new-account form.
     ⚠ Warning: If your company already uses Tag Manager, ask its administrator for access instead of
     creating a duplicate account.

1.2 In Account Setup, enter your company name in Account Name and select its Country.
Keep Share data anonymously with Google and others unchecked.

1.3 In Container Setup, enter your website’s main domain in Container name, then choose
Web as the target platform.

1.4 Click Create. Read the terms shown and complete the acceptance only if you are
authorized to agree for your company.
     ⚠ Warning: If you cannot accept the terms for your company, stop here and have the responsible
     person complete this step.



2. Save and check the account and container details
Keep these details with your website setup notes so the right container can be found later.

2.1 Create a Website setup note and save the new container details in it.

     a. Create a simple note named Website setup note with these headings: Account name, Tag
     Manager account ID, Container name, GTM container ID, and Workspace link.

     b. Close the installation instructions with Close (the X) to reach the new container workspace.

     c. In Website setup note, enter your company account name and container name under their
     headings. Copy the complete ID beginning with GTM- into GTM container ID.

2.2 Open Admin > Account Settings. Check that Account Name and Country match your
company details and that Share data anonymously with Google and others is unchecked.
Copy the displayed Account ID into the Website setup note under Tag Manager account ID.

2.3 Open Google Tag Manager again. In Accounts, find your company and check that the
container appears beneath it with type Web and the container ID you saved. Open the container
and copy the workspace address from your browser into the Website setup note under
Workspace link. This link lets the person installing tracking reopen this exact container later.




Last updated Sep 24, 2026 · Click here to get the most up-to-date version of this SOP
```

</details>

## SOP 010: Create a GA4 property and website data stream

**URL:** https://tools.clickminded.com/sop/10
**Capture:** Full (PDF export)

**Linked external resources/templates (not opened):**
- [(linked resource)](https://analytics.google.com/)

<details><summary>Full SOP text</summary>

```text
SOP 010 · TRACKING & MEASUREMENT


Create a GA4 property and website data
stream
Create a Google Analytics 4 (GA4) property and a website data stream, then save their IDs for
the person who will install tracking. A property holds your reporting data; a stream is the website
source inside it.



  ESTIMATED TIME        TOOLS                              RESPONSIBLE
  15 minutes            Google Analytics 4                 Anyone setting up a website in an existing
                                                           Google Analytics account with permission
                                                           to create properties.



Before you start
Requirements
  ●​ A Google account with Editor or Administrator access to the existing Analytics account, plus the
     name of that Analytics account.
  ●​ A property name, reporting time zone and reporting currency chosen for the business.
  ●​ The business industry, employee-count range and main reason for using Analytics.
  ●​ The primary website URL, including https:// or http://, and a stream name. The stream name labels
     the website source and may match the property name.


  THIS SOP COVERS                                     THIS DOES NOT COVER
    ●​ One property and one website data                ●​ Creating an Analytics account or granting
        stream in an existing Analytics account             access
    ●​ Property name, reporting time zone,              ●​ Installing tags, testing data collection or
        currency, website URL and stream name               configuring consent
    ●​ Saved property, stream and                       ●​ Setting up lead events, key events or
        Measurement IDs; enhanced                           reports
        measurement off

Related SOPs
  ●​ SOP 011: Create a Google Tag Manager account and web container
  ●​ SOP 012: Install GA4 through Google Tag Manager


1. Create the property
Add a reporting space inside the account that owns this website.

1.1 Open Google Analytics. Use the account selector at the top to select the existing Analytics
account from your prerequisites. Open Admin, then choose Create > Property.

1.2 Enter the property name. Choose the reporting time zone, which sets when a reporting day
begins and ends, and the currency used for money amounts. Use the values from your
prerequisites, then click Next.

1.3 Select the business industry and employee-count range, then click Next. Choose the
business objective that matches your main reason for using Analytics, then click Create a
property.


2. Create the website stream
Give the website its own source inside the new property.

2.1 Choose Web. For Website URL, select the website’s protocol (https:// or http://) and enter
the remaining address in the URL field. Enter the stream name. Turn Enhanced measurement
off and confirm Turn off so automatic extra interaction tracking remains off. Click Create &
continue.


3. Check the saved setup and copy its IDs
Reopen the saved settings before handing the IDs to the person installing tracking.

3.1 Check the saved property settings and record its Property ID in your Measurement
handoff note.

     a. Close the Google tag setup panel. If asked about unsaved changes, choose Discard Changes;
     this removes only the optional tag setup suggestion, not your saved property or stream. Close Web
     stream details, then click Next and Continue to Home.

     b. Open Admin and check that the account selector shows the intended account and new property.
     Open Property > Property details and compare the saved name, reporting time zone and currency
     with your prerequisites.

     c. Create a simple note named Measurement handoff note with these headings: Property ID,
     Stream ID, and Measurement ID. Copy the Property ID into the note under the Property ID
     heading.
3.2 In Admin, open Data collection and modification > Data streams and select the new web
stream. Check its saved name and full website URL against your prerequisites, and confirm
Enhanced measurement is off. Copy the Stream ID into the Measurement handoff note under
Stream ID and the Measurement ID under Measurement ID. The Measurement ID is the value
used for later tag installation.




Last updated Sep 24, 2026 · Click here to get the most up-to-date version of this SOP
```

</details>

## SOP 002: Track lead form submissions using a thank-you page in Google Ads with Google Tag Manager

**URL:** https://tools.clickminded.com/sop/2
**Capture:** Reference — full text is in `google-ads-sops.md`.

## SOP 008: Create consistent campaign UTM URLs

**URL:** https://tools.clickminded.com/sop/8
**Capture:** Full (PDF export)

**Linked external resources/templates (not opened):**
- [(linked resource)](https://ga-dev-tools.google/campaign-url-builder/)

<details><summary>Full SOP text</summary>

```text
SOP 008 · TRACKING & MEASUREMENT


Create consistent campaign UTM URLs
Build a campaign link with consistent source, medium, and campaign labels, then check the
copied URL. UTM parameters are labels added to a web address to describe where a marketing
link comes from.



 ESTIMATED TIME         TOOLS                             RESPONSIBLE
 10 minutes             Google Campaign Url Builder       People preparing website links for email,
                                                          unpaid social posts, or partner referrals.



Before you start
Requirements
  ●​ The full HTTPS address of the intended page, without existing UTM parameters. Keep any query
      values or page anchor the page needs.
  ●​ The campaign purpose and where each link will appear; existing labels for the same source,
      channel, or campaign, if your team has them.
  ●​ An editable campaign note or file where you can save labels and full URLs.


 THIS SOP COVERS                                      THIS DOES NOT COVER
    ●​ Choose consistent source, medium, and            ●​ Sending emails or publishing campaigns
       campaign labels                                  ●​ Paid advertising, auto-tagging, and
    ●​ Build a full URL and check its destination           spending
       and parameters                                   ●​ Tagging links between pages on your
                                                           own website
                                                        ●​ Analytics setup, attribution proof, and
                                                           redirect testing

Related SOPs
  ●​ SOP 010: Create a GA4 property and website data stream
  ●​ SOP 012: Install GA4 through Google Tag Manager


1. Choose the labels
Give each label one job so you can reuse the same wording across links.

1.1 In your campaign note, choose these three values:
       ●​ Source: the place sending visitors, such as the newsletter name or social platform.
       ●​ Medium: the kind of placement. Use email for email, social for unpaid social posts,
              or referral for a partner website link.
           ●​ Campaign: a short name for the promotion or initiative. Reuse it across that
              campaign’s placements.
     For an existing source, channel, or campaign, reuse your team’s exact label, even if it uses
     a different format. For new labels, use lowercase letters, numbers, and underscores
     between words. The three values may match if their meanings really match; choose each
     by its job.

     ⚠ Warning: Keep names, email addresses, and other personal information out of UTM labels.



2. Build the campaign URL
Let the builder add the labels without hand-editing the address.

2.1 Open Google’s Campaign URL Builder and select WEB. Paste the full destination address
into website URL. Keep its capitalization and any existing query text after ? or page anchor
after #.
     ⚠ Warning: If the destination already contains utm_ parameters, get its untagged version before
     continuing; adding another set can create conflicting labels.

2.2 Enter the source from step 1.1 into campaign source, the medium into campaign
medium, and the campaign into campaign name. Clear any existing values in campaign ID,
campaign term, and campaign content so the result contains only your three campaign labels.
Below the generated URL, make sure Set campaign parameters in the fragment portion of
the URL is unchecked.


3. Check and save the full URL
Check the result before handing it to the person who will use the link.

3.1 Read the generated URL. Check that utm_source=, utm_medium=, and utm_campaign=
each appear once and contain the matching value from your note. Check that there are no other
utm_ parameters, including utm_id, utm_term, or utm_content. Check that the destination’s
domain and path are unchanged, that any original query values remain, and that any # anchor
stays at the end, after the UTM parameters.
     ⚠ Warning: In query values, %20 and + can both mean a space; %2B means an actual plus sign.
     These are URL encoding. Copy the generated form without replacing these codes or encoding the
     full URL again.
3.2 Click inside generated URL, select all its text, and copy it. Paste the full URL into your
campaign note beside its three labels. Read the saved text back and compare it with the
generated URL to catch missing characters. Repeat from step 1.1 for each placement, keeping
the same campaign value for the same initiative.




Last updated Sep 10, 2026 · Click here to get the most up-to-date version of this SOP
```

</details>

## SOP 001: Install Google Tag Manager on a WordPress site using Site Kit

**URL:** https://tools.clickminded.com/sop/1
**Capture:** Full (PDF export)

**Linked external resources/templates (not opened):**
- [(linked resource)](https://tagmanager.google.com/)
- [(linked resource)](https://tagassistant.google.com/)
- [Site Kit by Google](https://wordpress.org/plugins/google-site-kit/)
- [Google's Site Kit setup guide](https://sitekit.withgoogle.com/documentation/getting-started/install/)
- [Troubleshoot Tag Assistant](https://support.google.com/tagmanager/answer/10039345?hl=en)

<details><summary>Full SOP text</summary>

```text
SOP 001 · TRACKING & MEASUREMENT


Install Google Tag Manager on a WordPress
site using Site Kit
Use Google's Site Kit plugin to add an existing Google Tag Manager container to a WordPress
site, then check that it is working correctly.



  ESTIMATED TIME            TOOLS                             RESPONSIBLE
  15 minutes                Google Tag Manager,               Anyone responsible for adding website
                            WordPress, Site Kit by Google     tracking to a WordPress site



Before you start
Requirements
  ●​    Administrator access to the WordPress site
  ●​    An existing Google Tag Manager web container
  ●​    A Google account that can access the Google Tag Manager container
  ●​    The website's homepage URL and one other page you can use for testing


  THIS SOP COVERS                                       THIS DOES NOT COVER
       ●​ Install and set up Google's Site Kit plugin       ●​ Creating a Google Tag Manager account
       ●​ Connect one existing Google Tag                      or container
           Manager web container                            ●​ Adding Google Analytics, advertising, or
       ●​ Check that the container loads across the            conversion-tracking tags
           WordPress site                                   ●​ Configuring consent mode or a cookie
                                                               banner


1. Get the Google Tag Manager container ID
First, copy the ID of the container you want to install and make sure Google Tag Manager has
not already been added to the site.

1.1 Open Google Tag Manager and select the account and container you want to install. Make
sure the container is marked Web, then copy the container ID displayed near the top of the
page. The ID starts with GTM-.

1.2 Open Google Tag Assistant, enter the website's homepage URL, and select Connect.
When the website opens in a new tab, return to Tag Assistant. If it does not find a Google Tag
Manager container, close the test tab and continue.
     ⚠ Warning: If a Google Tag Manager container is already installed, stop here. Adding it again can
     cause duplicate tracking.



2. Install and connect Site Kit
Next, install Google's official WordPress plugin and connect it to your Google account. During
setup, Site Kit will verify the site in Search Console and enable PageSpeed Insights so you can
manage Google's website tools from WordPress.

2.1 In WordPress, go to Plugins > Add Plugin and search for Site Kit by Google. Make sure
the plugin is published by Google, then select Install Now and Activate.

2.2 Open Site Kit > Dashboard and complete the initial setup with the Google account that has
access to the Google Tag Manager container from step 1.1.
     Reference: Google's Site Kit setup guide · Use this if the setup prompts do not match the steps
     below.

     a. Leave Get visitor insights by connecting Google Analytics as part of setup unchecked.
     Google Analytics is outside this SOP.

     b. Select Sign in with Google, choose the Google account that can access your container, and
     approve the requested permissions.

     c. Follow the prompts to verify the site, allow metrics, and set up Search Console. Then choose the
     option that best describes the website's main goal and select Complete setup.

2.3 Go to Site Kit > Settings > Connect More Services and select Set up Tag Manager.
Choose the Google Tag Manager account and web container whose ID matches the one you
copied in step 1.1, then select Complete setup.

2.4 In Site Kit > Settings > Connected Services > Tag Manager, select Edit. Make sure Let
Site Kit place code on your site is turned on, then select Save.
     ⚠ Warning: If Site Kit says Tag Manager code is already on the site, stop and check the existing
     installation instead of adding another copy.



3. Check that Google Tag Manager is working
Finish by checking two pages. This confirms that Site Kit installed the correct container across
the website, not only on the homepage.

3.1 Open Google Tag Assistant, enter the website's homepage URL, and select Connect.
When the website opens, return to Tag Assistant, open the Google Tag Manager result, and
check that its container ID matches the ID you copied in step 1.1.
     Reference: Troubleshoot Tag Assistant · Use this if Tag Assistant cannot connect to the site or does
     not find the container.

3.2 While Tag Assistant is still connected, open one other page on the website, such as the
contact or about page. Return to Tag Assistant and confirm that it shows the container ID from
step 1.1 without listing a second Google Tag Manager container.




Last updated Sep 10, 2026 · Click here to get the most up-to-date version of this SOP
```

</details>

**Summary:** 18 full entries; 7 cross-file references; 0 partial entries.
