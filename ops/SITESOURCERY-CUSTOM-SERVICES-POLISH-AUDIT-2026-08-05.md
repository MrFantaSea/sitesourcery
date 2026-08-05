# Site Sourcery custom-services polish audit — 2026-08-05

Status: bounded polish-lane audit only. This document changes no public page,
catalog, checker, backend, provider, release control, DNS, or deployment state.
The unfinished Batch 3C Alakazam fulfillment work remains untouched.

Repository and branch inspected:

- `/Users/fantaseamac/sitesourcery-build`
- `build/sitesourcery-v2-20260730`

This packet extends the accepted
`ops/SITESOURCERY-PUBLIC-TRUTH-AUDIT-2026-08-04.md` for Custom services. It does
not replace that audit's Alakazam, domain-storefront, Responder, or production
release findings.

The build lane produced
`ops/SITESOURCERY-CUSTOM-SERVICES-COMMERCIAL-CONTRACT-2026-08-05.md` while this
audit was in progress. This packet was cross-checked against that newer
contract. Its frozen prices, 90-day credit window, staged outside-site
onboarding, one-cycle allowance rollover, and 30-day workmanship correction
window are reflected below. Two new timing promises in that contract are
called out for explicit owner confirmation before they enter public copy.

## 1. Executive verdict

The five new service lanes fit the existing site without five new pages or a
second commercial system. The simplest truthful shape is:

1. Keep `/custom/` as the one public home for made-for-you builds and help with
   an existing website.
2. Add one compact “Have a website already?” section containing five service
   cards: Rescue & Tune-Up, Outside Website Management, Business Email & Domain,
   Website Move / Platform Escape, and Local Presence.
3. Keep the first inquiry open by phone or email. Do not require an account just
   to ask a question.
4. Require an activated Site Sourcery account before any customer accepts a
   quote or makes a payment, including an assessment or paid onboarding.
5. Send every paid path through one account-bound service catalog, quote,
   acceptance, invoice/Checkout, payment-evidence, job, deliverable, and credit
   ledger.
6. Publish no service price, guarantee, checkout action, or recurring promise
   until that exact backend path and its customer/owner views are proven.

The current source is not ready to publish this offer set. Its highest-risk
customer-facing mismatch is `custom/index.html:134`: a live direct Stripe link
can take $200 for an unbounded assessment before account creation, written
scope, quote acceptance, invoice creation, job creation, or build-credit
tracking. That is the opposite of the newly accepted sequence.

The next largest risk is catalog split-brain. The checked-in public-safe catalog,
the optional sibling private catalog, the pricing checker, the release checker,
and visible HTML disagree about assessment price and credit, Custom build
prices, Scale units, redirect/migration bands, and Care. A developer can make
one surface “green” while leaving another commercially false.

## 2. Owner decisions treated as authority

The following are accepted inputs to this audit:

- Paying clients must have an activated Site Sourcery account before quote
  acceptance or payment.
- A free public inquiry may collect customer-stated facts, but no free website
  inspection, diagnosis, technical inventory, access review, or recovery work
  is promised.
- An outside website requires paid onboarding/takeover before Site Sourcery
  assumes operational responsibility or changes the site.
- The standard website assessment is $200 and is bounded to:
  - one public website;
  - up to five representative public pages or page types;
  - desktop and phone review;
  - up to ten prioritized findings;
  - written findings and screenshot evidence;
  - no repairs, admin/code audit, credential recovery, malware cleanup, or
    legal/accessibility certification.
- A larger or materially more complex site receives a separately priced expanded
  assessment. No 100-page audit is implied by the $200 offer.
- The full $200 assessment amount can be credited once toward one accepted Site
  Sourcery Custom base build for the same customer, business, and site when the
  build is accepted within 90 days of assessment delivery. After 90 days Site
  Sourcery may require and price a refresh before reissuing the credit. The
  credit is one-use, noncash, nontransferable, and excludes provider costs, tax,
  ongoing service, and unrelated work.
- The existing Custom build ladder and Alakazam ladder remain. A new name must
  not duplicate an existing SKU or included capability.
- Custom Care for Site Sourcery-built websites, Alakazam tier care, and Outside
  Website Management are different customer promises even if they share backend
  primitives.
- Public claims follow working backend truth. They do not lead it.

## 3. Cross-lane commercial schedule

These values match the build lane's commercial contract. They are commercial
truth for implementation, not permission to publish: public publication remains
held until the corresponding backend and proof gates pass.

| Item | Frozen price model | Hard boundary |
| --- | --- | --- |
| Standard website assessment | $200, paid in full before work | The bounded public review above; diagnosis only |
| Expanded assessment | Separately quoted | Scope and price approved before inspection begins |
| Rescue & Tune-Up | $125 internal repair unit; two-unit/$250 repair minimum after diagnosis | Customer receives a fixed plain-language repair quote, not a mystery-unit bill |
| Outside-site supportability/takeover review | First $200, paid before review | Platform, ownership/access, dependencies, backup/recovery state, material risks, and supportability decision; delivers a written result even if declined |
| Outside-site onboarding: simple/static | $300 total, including the first $200 | If accepted, charge the remaining $100 before delegated access, baseline, monitoring, and monthly responsibility begin |
| Outside-site onboarding: ordinary supported CMS | $600 total, including the first $200 | If accepted, charge the remaining $400 before the CMS/plugin/theme/host baseline and monthly responsibility begin |
| Outside-site onboarding: commerce, membership, custom, unknown, or high risk | Separately quoted, starting at $900 total, including the first $200 | No automatic acceptance; no remaining balance or monthly plan if declined |
| Outside Website Management: simple/static | From $125/month after paid onboarding | Monitoring, baseline checks, backup responsibility where technically available, ticket path, monthly receipt; ordinary change labor excluded |
| Outside Website Management: ordinary supported CMS | From $225/month after paid onboarding | Same boundary with CMS responsibility |
| Outside Website Management: commerce, membership, custom, or high risk | Separately quoted, starting at $400/month | Exact systems, hours, response duty, exclusions, and exit plan required |
| Optional management work allowance | Two units +$250/month or four units +$500/month | No unlimited edits; unused included capacity rolls into the immediately following cycle only; no implied emergency response |
| Business Email & Domain — Connect | $200 | Reuse existing `additional_connection`: one customer-owned domain and one provider/mail outcome, ordinary DNS and mail-auth work, and up to three ordinary mailboxes or aliases; no historic-mail move or recovery |
| Business Email & Domain — Move | From $500 | One domain, one source and destination, up to three ordinary mailboxes of up to 10 GB each, supported export/import, cutover tests, and handoff; +$100 per additional ordinary mailbox up to 10 GB |
| Business Email & Domain — Recovery investigation | $300 | Investigation and written recovery path only; provider/registrar access or data recovery is not guaranteed; execution is separately quoted |
| Website Move / Platform Escape transition base | $500, in addition to any assessment/build/data/redirect components | One source/destination inventory, source backup/export attempt, destination preparation, cutover, launch checks, rollback plan where available, and handoff |
| Local Presence — Website Visibility Foundation | $400 | One business, location, and site; up to five key pages; concrete technical/search setup only |
| Local Presence — Google Business Profile setup/cleanup | $300 | One ordinary eligible customer-owned profile; customer remains owner, Site Sourcery is a manager when access is needed |
| Local Presence bundle | $650 | The $400 and $300 scopes together; no duplicate $700 charge |
| Local Presence expansion | +$150 per additional five key pages; +$250 per additional location | Exact pages/locations listed in the quote |

Frozen payment rules:

- Assessment and recovery investigation: 100% before bounded work begins.
- Outside-site onboarding: the first $200 buys the supportability/takeover
  review. If the site is accepted, only the remaining balance of the accepted
  $300/$600/from-$900 total is charged before operational onboarding begins. If
  declined, no remaining balance or monthly plan is charged.
- Other one-time jobs under $1,000: 100% before work begins.
- One-time jobs at or above $1,000: 50% before work and 50% at the accepted
  completion boundary, unless the written quote names a safer milestone plan.
- Existing Custom rule remains: after any valid assessment credit, Card and Card
  Plus are paid in full before build work; Site through Scale use 50% of the
  accepted total before work and 50% before final launch/handoff, with the
  credited assessment payment counting toward the first half.
- Recurring management: billed in advance and starts only after paid onboarding
  is complete and Site Sourcery accepts the platform for management.
- No refund is advertised as a product feature or customer control. Applicable
  law and the accepted agreement still control mandatory remedies. A paid
  assessment, onboarding, or recovery investigation buys the stated work even
  when the result is “do not proceed,” “unsupported,” or “provider recovery is
  unavailable.”

### Cross-lane timing redlines still required

The commercial contract now freezes the 90-day assessment-credit window,
30-day workmanship correction window, one-cycle-only management allowance
rollover, and case-by-case outside-platform acceptance. The polish lane should
carry those exact boundaries and must not silently broaden them.

The same contract introduces two customer-service timing promises that were not
part of the owner decisions supplied to this audit:

1. `ops/SITESOURCERY-CUSTOM-SERVICES-COMMERCIAL-CONTRACT-2026-08-05.md:60`
   says the standard assessment is normally delivered within five business
   days after payment and required facts are ready.
2. `ops/SITESOURCERY-CUSTOM-SERVICES-COMMERCIAL-CONTRACT-2026-08-05.md:191-192`
   says a standard Outside Management request is acknowledged within two
   business days.

Both are **HOLD FOR EXPLICIT OWNER CONFIRMATION** before public, legal, quote,
or account copy adopts them. A response-time promise creates staffing and
remedy expectations; it cannot become public truth merely because it appeared
in an implementation contract.

## 4. SKU composition and no-double-billing rules

The five public cards are customer choices, not five isolated backends. The
private catalog and quote composer need reusable components and overlap keys.
The customer sees plain line items, one subtotal, explicit credits, and any
deduplicated work.

Recommended overlap keys:

- `public_site_assessment`
- `external_site_takeover`
- `site_inventory`
- `backup_baseline`
- `rollback_baseline`
- `dns_connection`
- `mail_provider_connection`
- `redirect_plan`
- `data_migration`
- `search_foundation`
- `business_profile`
- `launch_checks`
- `handoff_record`

Required composition rules:

| Combination | Required quote behavior |
| --- | --- |
| Assessment + Custom build | Apply the one $200 credit once to the Custom base-build portion for the same customer/business/site when accepted within 90 days; after that, a priced refresh may be required before the credit is reissued |
| Assessment + Rescue | Assessment remains the paid diagnosis; it is not automatically credited to repairs |
| Assessment + Website Move with a Custom rebuild | Credit $200 to the Custom build portion, not to transition, provider, migration, or redirect work |
| Rescue + Outside Management | Diagnose once, perform external takeover once, capture one backup baseline, then price selected repairs and management separately |
| Two broken pages with one shared template defect | Charge the shared cause once; do not bill the same root cause once per page |
| Website Move + outside-site onboarding | The $500 transition base subsumes the matching source/destination inventory and takeover work; do not add a duplicate $300/$600 onboarding line for the same move |
| Website Move + redirects/data migration | Use the retained redirect bands and data-migration rule as visible component lines; do not bury them in a mystery move fee |
| Custom build + Business Email/Domain Connect | Reuse the existing $200 `additional_connection` component; do not create a second “email/domain setup” charge for identical DNS work |
| Local Presence + a Site Sourcery-built site | Ordinary launch plumbing must be either included in the build or charged once, never both. This “included” claim stays held until the build lane proves the exact sitemap, metadata, canonical, structured-data, and Search Console behavior |
| Local Presence + outside website | Charge external onboarding only when Site Sourcery must enter/change the outside site. Profile-only work does not silently become website takeover |
| Local Presence + Email/Domain | Shared DNS verification records are made and charged once |
| Custom Care + Outside Website Management | Never combine the names. Custom Care is for a Site Sourcery-built asset; Outside Management prices takeover risk for an externally built asset |
| Alakazam care + either management product | Keep Alakazam entitlement/accounting separate; no monthly payment buys an unstated second care product |

An exact customer instruction such as “replace this phone number with this new
number” may be directly quoted without a diagnostic assessment when no
inspection or troubleshooting is needed. The moment Site Sourcery must determine
why something is broken or what else will be affected, the paid assessment or
paid onboarding boundary applies.

## 5. The simplest account-first customer journey

This is the customer journey the copy and backend must agree on:

1. **Browse.** The customer sees the Custom build ladder, the bounded $200
   assessment, and the five existing-site help cards. No checkout is present.
2. **Ask.** The customer calls or emails with their business, public URL,
   customer-stated problem, desired result, and important date. Site Sourcery
   does not inspect the site for free and does not request passwords in the
   inquiry.
3. **Qualify without diagnosing.** Zack decides whether the described category
   is potentially in scope. A brief “this may fit” is not a technical finding or
   free assessment.
4. **Create/activate account.** Before any quote can be accepted or paid, the
   customer creates or activates a Site Sourcery account and the business/site
   asset is attached to it.
5. **Issue exact paid entry quote.** The first quote is normally the bounded
   assessment, the first $200 outside-site supportability/takeover review, or an
   exact non-diagnostic change. It states scope, exclusions, timing, price,
   account/site identity, and whether a later credit can apply.
6. **Review and accept.** The account shows the exact current quote and terms.
   Acceptance is affirmative, versioned, and bound to that quote.
7. **Pay securely.** Only the accepted account-bound invoice/Checkout can open
   payment. Provider readback and a local receipt settle it; a browser redirect
   alone is not payment truth.
8. **Do and show the work.** The customer account shows assessment/onboarding/job
   status, access requests, approved changes, deliverables, invoices, receipts,
   credits, and next step. It never exposes provider IDs or internal notes.
9. **Owner operation.** The Mac/Pixel workbench shows the same customer, asset,
   quote, invoice, payment evidence, job, findings, credits, tickets, and
   recurring responsibility. Zack does not reconstruct state from email and
   Stripe tabs.
10. **Continue deliberately.** The customer selects assessment findings for a
    repair quote, accepts a build/move quote, or completes paid onboarding before
    monthly management starts. No result silently starts another service.

If the paid supportability/takeover review determines that Site Sourcery should
not manage an outside platform, the customer still receives the promised
written report. No remaining onboarding balance or recurring subscription is
charged. The account may then show a Rescue, Move, or rebuild quote, but no
second purchase is automatic.

## 6. Public-surface map

### 6.1 Homepage

| Classification | Exact location | Obligation |
| --- | --- | --- |
| CHANGE | `index.html:144-174`, existing-site assessment card | Keep the $200 entry point, add the five-page/ten-finding boundary, replace “ranked by what each problem costs you” with prioritized severity/importance, and state that diagnosis starts only after paid scope/acceptance |
| CHANGE | `index.html:152` | “Full $200 comes off any build” needs the frozen one-use, same-customer/business/site, eligible Custom base-build, 90-day, refresh, and exclusion boundaries |
| CHANGE | `index.html:164-167`, sample findings | “Not showing on Google Maps” and “Every fix priced and ranked” can imply outcome/repair certainty. Use concrete sample evidence and “selected repairs quoted separately” |
| KEEP | `index.html:110-121`, Custom card and accepted starting ladder reference | Retain Custom from $400 and assessment-credit concept after catalog reconciliation |
| HOLD | `index.html:172+`, active Responder sales language | Inherited from the prior public-truth audit; unrelated to Custom services and still release-held |

The homepage should remain a sorter. It should link to
`/custom/#existing-site-help`, not reproduce five full service descriptions.

### 6.2 `/custom/` — canonical public service home

| Classification | Exact location | Obligation |
| --- | --- | --- |
| KEEP | `custom/index.html:35-57`, hero and principles | Keep made-for-you Custom as the primary page promise and one hero CTA |
| KEEP | `custom/index.html:120-158`, build ladder | Retain $400/$650/$1,200/$1,800/$2,800/$4,000 starting prices and written-quote boundary once one catalog proves them |
| REMOVE | `custom/index.html:134`, direct assessment Payment Link | Replace with an inquiry/account path. No public “Book one” payment destination |
| CHANGE | `custom/index.html:134` and `:195-205`, duplicate assessment descriptions | State one canonical bounded assessment offer; keep a short cross-link elsewhere rather than two slightly different promises |
| CHANGE | `custom/index.html:163-193`, `#other-jobs` | Replace the vague three-card taxonomy with `#existing-site-help` and five exact cards: Rescue, Outside Management, Email & Domain, Website Move, Local Presence |
| CHANGE | `custom/index.html:208-216`, closing intake | Let one shared CTA carry a selected service topic to contact/account intake; do not create five unrelated checkout funnels |
| CHANGE | `custom/index.html:8`, metadata | Broaden from only new builds to made-for-you builds and bounded help for an existing site, without keyword-stuffed SEO claims |

Recommended closed-card summary order on phone:

1. Customer outcome.
2. Fixed starting price or “custom after paid onboarding.”
3. Required paid prerequisite.
4. One plain boundary.
5. “See scope” native disclosure and one inquiry link.

### 6.3 `/custom/scope/`

| Classification | Exact location | Obligation |
| --- | --- | --- |
| KEEP | `custom/scope/index.html:52-265` | Keep the Custom size/design/tool catalog as the Custom-build scope page |
| KEEP/REUSE | `custom/scope/index.html:254-261` | Reuse `basic_form`, `hosted_provider`, `additional_connection`, revision, and priority components; do not relabel them as new standalone SKUs |
| CHANGE | `custom/scope/index.html:267-286`, `scope-move` | Name Website Move / Platform Escape, require paid inventory, state that not every feature/account/data set can move, and list redirects, DNS, launch checks, missing features, and rollback as explicit scope |
| CHANGE | `custom/scope/index.html:288-299`, final quote panel | Add account-before-accept/pay and state that combined work is deduplicated in one quote |

The five service cards do not belong on this page; it remains the detailed
Custom-build calculator boundary.

### 6.4 `/custom/process/`

| Classification | Exact location | Obligation |
| --- | --- | --- |
| CHANGE | `custom/process/index.html:35-50`, hero | Keep inquiry-only wording but add that an account is required before acceptance/payment |
| CHANGE | `custom/process/index.html:52-86`, six steps | Thread account activation and paid diagnostic/onboarding into the first two steps without adding a confusing second process |
| CHANGE | `custom/process/index.html:90-115`, quote anatomy | Add service kind, prerequisite, selected findings, recurring boundary, overlap removals/credits, provider costs, and explicit no-guarantee exclusions where applicable |
| CHANGE | `custom/process/index.html:126-150`, readiness and acceptance | Sequence must be account → exact quote → acceptance → required payment → work. Current copy omits the account gate |
| KEEP | `custom/process/index.html:167-181`, launch/handoff | Keep backup, redirect, safe-way-back, access-list, and handoff concepts, qualified by technical availability |
| CHANGE | `custom/process/index.html:175-180`, “Handoff and Care” | Distinguish workmanship correction, optional Custom Care, and Outside Management; do not imply one inherits from another |

### 6.5 FAQ

| Classification | Exact location | Obligation |
| --- | --- | --- |
| CHANGE | `faq/index.html:34-46`, hero and topic navigation | Add account-before-pay, existing-site help, and stacking without turning the FAQ into five sales pages |
| CHANGE | `faq/index.html:49`, “main ways” | Include existing-site help and remove/hold any product described as active beyond backend truth |
| KEEP/EXPAND | `faq/index.html:51-53`, payment/ownership | Keep Custom payment and ownership; add account-before-accept/pay and provider-account ownership |
| CHANGE | `faq/index.html:54`, assessment | State $200, five representative pages/page types, phone+desktop, ten findings, expanded assessment, no repairs, and the frozen same-customer/business/site, one-use Custom base-build credit with 90-day acceptance/refresh boundary |
| CHANGE | `faq/index.html:55`, care | Explain three separate promises: Alakazam tier care, optional Custom Care for Site Sourcery builds, and paid-onboarding Outside Management |
| ADD | after `faq/index.html:55` | “Can services be combined?” Answer: yes, one quote removes duplicate inventory/DNS/backup/launch work |
| ADD | after `faq/index.html:55` | “Can you guarantee recovery or search ranking?” Answer: no; provider recovery, transfer, verification, indexing, ranking, traffic, and leads are not guaranteed |
| ADD | before `faq/index.html:61` | “Do I need an account?” Answer: not to browse or ask; yes before accepting a quote or paying |

`scripts/hosted-truth/fragments/faq-missed-payment.html:1` still promises a
14-day grace period, day-15 suspension, and 90-day retention. It is not a
Custom-services rule and must remain out of customer release unless the
Alakazam lifecycle contract separately approves and proves it.

### 6.6 Contact and intake

| Classification | Exact location | Obligation |
| --- | --- | --- |
| KEEP | `contact/index.html:34-55`, direct inquiry | Keep phone/email and “scope and price in writing” |
| CHANGE | `contact/index.html:47-52`, next steps | Add account creation/activation between fit and quote acceptance/payment; clarify that initial fit does not include free inspection |
| CHANGE | `contact/index.html:67-80`, topic list | Replace vague/overlapping topics with stable IDs for Custom build, assessment, Rescue, Outside Management, Email & Domain, Website Move, Local Presence, Alakazam/account help, and held/deferred products only when appropriate |
| CHANGE | `contact/index.html:98-110`, “three paths” | Remove the stale three-path explanation or make it match the actual canonical navigation; current copy conflicts with the missing `/solutions/` assumptions in checkers |
| KEEP/EXPAND | `contact/index.html:115-127`, first note | Keep public URL, problem, goal, and date. Add platform/provider as customer-stated information; continue forbidding passwords, card data, health data, and sensitive customer records |

The public contact page may stay a no-form phone/email guide until the real
account intake exists. Do not add a decorative form that cannot create the
customer/site record used by quotes.

### 6.7 Account wording and customer projection

The currently proven hosted account entry is Abracadabra-specific:

- `scripts/hosted-truth/fragments/abracadabra-app-customer-control.html:1-25`
  opens the account rail.
- `:27-126` provides create, activation, sign-in, and recovery.
- `:128-150` creates an Abracadabra editor project.
- `:152-198` provides the exact $5 quote/payment/Download path.
- `:200-203` sends publishing/domain work back to direct contact.

Classify this as **KEEP for Abracadabra, DO NOT PRETEND it is the Custom-service
account backend**. `abracadabra/app/abracadabra-account.js:5-15` is a browser
local prototype and remains **HOLD/QUARANTINE**, not customer authority.

The build lane should add one customer-safe services projection, preferably in
a shared account dashboard linked from the Maker rather than forcing Custom
jobs into the four-step Download widget. Required customer fields are:

- business/site asset and whether it is `alakazam`, `sitesourcery_custom`, or
  `external`;
- service inquiry and selected lane;
- quote version, scope, exclusions, price, expiry, acceptance state, and next
  action;
- invoice/deposit/balance and customer-safe receipts;
- assessment/onboarding/job status and promised deliverables;
- outside-site supportability decision, total onboarding band, first $200 paid,
  remaining balance only if accepted, and monthly eligibility;
- findings selected for a later repair quote;
- assessment credit available/applied/consumed with no internal source IDs;
- recurring management scope, current period, included allowance and usage,
  next invoice, and pending end/change only after those lifecycle rules exist;
- access requests that ask the customer to authorize a provider connection,
  never to paste a password into chat or an ordinary form;
- support/ticket status and handoff documents.

Every write action remains hidden or disabled unless the server projection says
that exact action is available. Browser flags, query parameters, local storage,
or visible DOM state never authorize a quote, credit, payment, repair, or
management entitlement.

## 7. Legal and privacy map

### 7.1 Current public legal source

| Classification | Exact location | Obligation |
| --- | --- | --- |
| CHANGE | `legal/index.html:35-44` | Replace the browser-only/current-product split when the account service becomes the public same-origin service; link to account, Custom-service, and recurring-service terms without implying release early |
| CHANGE | `legal/website-terms/index.html:62-70`, acceptance | Paying-service acceptance must be account-bound and quote-version-bound; browsing/inquiry remains non-acceptance |
| HOLD/REMOVE | `legal/website-terms/index.html:79-103`, address and lifecycle | Four address modes, $25-only Alakazam, broad cancel-any-time, 14-day grace, day-15 suspension, and 90-day retention exceed approved/proven lifecycle and domain-storefront truth |
| CHANGE | `legal/website-terms/index.html:136-143`, `custom-work` | Name the five service lanes, account-before-accept/pay, payment schedule, change orders, provider costs, outside-site onboarding, and separately accepted recurring responsibility |
| CHANGE | `legal/website-terms/index.html:145-151`, `assessment` | Replace “exact scope/price later” with the frozen standard $200 boundary, expanded-assessment rule, no repairs, and exact credit conditions |
| CHANGE | `legal/website-terms/index.html:161-166`, `care` | Separate workmanship correction, Custom Care, Alakazam care, and Outside Management. Define that management starts only after paid onboarding and platform acceptance |
| ADD | Custom-service terms topic | State that Rescue does not promise every defect is repairable; Move does not promise every page, account, feature, history, or record can transfer; recovery investigation does not guarantee access/data; rollback is only where technically available |
| ADD | Local Presence terms topic | State that Site Sourcery charges for labor, not Google placement; customer owns/controls the business profile; provider eligibility/verification/indexing/ranking/traffic/leads are not guaranteed |
| ADD | One-time/recurring payment topic | No refund offer or self-service refund control; accepted quote governs work/cancellation, subject to nonwaivable law; recurring management is advance-billed only after onboarding |
| CHANGE | `legal/privacy/index.html:70-100`, public pages/accounts/projects | Describe the real account and service records once public; keep unauthenticated browsing and direct inquiry separate |
| CHANGE | `legal/privacy/index.html:119-142`, domains/billing/retention | Add provider authorization, quotes, invoices, payment evidence, assessment credit, and job records; remove invented 14/90 lifecycle text until approved |
| CHANGE | `legal/privacy/index.html:152-165`, communications/choices | Cover assessment screenshots, findings, onboarding inventory, job files, support records, provider-manager access, and account requests |
| KEEP | `legal/privacy/index.html:157` and contact safety copy | Continue forbidding secrets and sensitive customer data in initial email/chat |

### 7.2 Hosted legal projection

The public source and hosted fragments are different legal projections today:

- `scripts/hosted-truth/fragments/legal-website-terms-main.html:41-166`
  contains account, $5 Download, made-for-you, assessment, and Care terms.
- `scripts/hosted-truth/fragments/legal-privacy-main.html:41-166` contains the
  account/project/payment privacy notice.
- `scripts/hosted-truth/manifest.mjs:88-132` binds legal source slots to hosted
  fragments by exact digest.
- `scripts/hosted-truth/manifest.mjs:163-255` separately requires held and
  hosted phrases.

Classify the dual projection as **CHANGE, then converge**. While it exists,
Custom-service legal edits must be coordinated in both the public source and
hosted fragment or deliberately proven in only the released variant. The final
public account service should not show a browser-only notice on one route and an
account-aware notice on another.

## 8. No-fake-SEO and no-guaranteed-recovery obligations

### Local Presence may promise

- client-owned Search Console setup where supported;
- sitemap submission and verification;
- robots, canonical, and ordinary indexability checks;
- consistent supplied business name/address/phone facts;
- agreed title/description cleanup on scoped pages;
- basic local-business structured information where appropriate;
- connection to a customer-owned Google Business Profile;
- one setup receipt and one later technical recheck;
- separately priced extra pages and locations.

### Local Presence must not promise

- “SEO results,” first-page placement, a ranking increase, indexing by a date,
  map-pack placement, profile verification/approval, traffic, calls, leads,
  reviews, revenue, or exclusivity;
- that Google charges the customer for ordinary profile placement;
- that Site Sourcery owns the customer's profile;
- that Search Console or a sitemap forces indexing.

Use “Local Presence” or “Website Visibility Foundation,” not an undefined
“visibility boost.” Public copy should say that Site Sourcery charges for the
listed setup and cleanup work and that search providers make their own
verification, indexing, and ranking decisions.

### Recovery and move work must not promise

- recovery of a registrar/provider account, domain, mailbox, archive, deleted
  message, website admin, or compromised credential;
- transfer completion by a fixed date;
- that every source feature, plugin, account, redirect, order, member, post, or
  data record can move;
- a rollback when the source/provider offers no usable backup or restoration
  path;
- successful malware cleanup under an ordinary $200 assessment.

The $300 Recovery purchase is an investigation and written path. Any execution
is a second accepted quote. The Website Move quote must explicitly name what
moves, what is rebuilt, what is excluded, who controls each account, launch
checks, known provider constraints, and the available rollback.

## 9. Catalog and checker audit

### 9.1 Catalog conflicts

| Classification | Exact location | Current mismatch and required action |
| --- | --- | --- |
| CHANGE | `data/public-catalog.json:340-355` | Assessment price is $200 but `buildCredit.maximumCents` is stale at $350. Freeze one $200 credit contract |
| CHANGE | `data/public-catalog.json:293-338` | Old Host/Care Lite/Care/Care Plus/Partner prices, minutes, caps, and overage remain projected. Remove from releasable projection or mark held in a schema the public UI cannot sell |
| CHANGE | `data/public-catalog.json:134`, `:269-291` | Public Scale unit and redirect/migration figures reflect newer decisions but disagree with sibling private authority; reconcile from one source |
| CHANGE | `/Users/fantaseamac/commercial/catalog.mjs:9-21` | Private authority explicitly forbids customer quote/invoice/payment; it cannot authorize the new backend until lead creates a reviewed released catalog version |
| CHANGE | `/Users/fantaseamac/commercial/catalog.mjs:35-60` | Private Custom ladder is stale at $350/$600/$1,000/$1,600/$2,400/$3,600 versus accepted $400/$650/$1,200/$1,800/$2,800/$4,000 |
| CHANGE | `/Users/fantaseamac/commercial/catalog.mjs:80-96`, `:181-193` | Private Scale is $240/unit and first redirect/migration bands are $350; public/accepted figures are $270 and $200 respectively |
| CHANGE | `/Users/fantaseamac/commercial/catalog.mjs:204-241` | Private catalog retains old Care and $350 assessment/credit |
| CHANGE | catalog architecture | The sibling `commercial/public-catalog.mjs` expected by lineage verification is absent. The check silently skips lineage unless `--require-root-lineage` is used. Put one canonical versioned source and projector under an enforced build path |

Recommended private service-catalog fields:

- stable service/component ID and version;
- state: held, inquiry-open, quote-enabled, payment-enabled, or recurring-enabled;
- kind: diagnostic, one-time, banded, custom, or recurring;
- customer asset origin and supported-platform policy;
- fixed/starting/private-unit price and provider/pass-through treatment;
- included/excluded scope and maximum quantities;
- prerequisites, especially account, assessment, and external onboarding;
- overlap keys and precedence;
- credit eligibility/consumption rules;
- no-guarantee disclosures;
- payment schedule and completion boundary;
- customer-safe projection fields versus private effort/risk fields.

### 9.2 Checker conflicts

Read-only diagnostics on 2026-08-05 produced these current facts:

- `node scripts/check-pricing.mjs` fails five checks: stale projection digest,
  direct Payment Links in Abracadabra and Custom, old flyer Care copy, and the
  checker's demanded $350 assessment.
- `node scripts/check-customer-copy.mjs --report` cannot run because it requires
  missing `solutions/index.html`.
- `node scripts/check-legal-copy.mjs --report` passes the current fixed legal
  shape. That is byte/structure evidence, not evidence that the pinned clauses
  match the newest owner decisions.

Required checker changes after the backend contract is frozen:

| Classification | Exact location | Obligation |
| --- | --- | --- |
| CHANGE | `scripts/check-pricing.mjs:10-90` | Require real canonical lineage; do not silently accept a missing projector |
| CHANGE | `scripts/check-pricing.mjs:161-196` | Continue forbidding direct Payment Links and released old Care, but replace the hard-coded $350 and “only $5 may be public” rule with catalog-state-aware approved prices |
| CHANGE | `scripts/check-static.mjs:61-179` | Replace stale catalog IDs/digests and add new service-state/overlap/account requirements |
| CHANGE | `scripts/verify-public-truth-release.mjs:21`, `:2235-2270` | Replace stale source digest only after the canonical catalog is regenerated and reviewed |
| CHANGE | `scripts/check-customer-copy.mjs:13-24` | Resolve missing `/solutions/`; recommended canonical route is `/custom/`, not a duplicate service page |
| CHANGE | `scripts/check-site-vnext.mjs:393-489` | Replace `/solutions/` paid-route contracts/topics/copy with the five exact `/custom/#existing-site-help` lanes and account sequence |
| CHANGE | `scripts/check-site-vnext.mjs:491-547` | Update legal topic IDs and FAQ anchors together with copy; add no-ranking/no-recovery/account/stacking checks |
| CHANGE | `scripts/check-legal-copy.mjs:27-64` | Recompute clause digests only after substantive review. Never alter digests merely to make changed text pass |
| CHANGE | `scripts/customer-section-ledger.mjs:177-228`, `:933-1019` | Add exact five-card, assessment, account, and contact units and remove dead-route assumptions |
| CHANGE | `scripts/hosted-truth/manifest.mjs:88-132`, `:163-255` | Update source/hosted digests and required phrases only with reviewed dual-projection changes |
| CHANGE | `scripts/build-pages.mjs:18-93` | Keep an explicit public allowlist; add a new account route only after its source and privacy boundary are reviewed |
| ADD | pricing tests | Reject assessment credit above $200, duplicate onboarding, duplicate `additional_connection`, duplicate DNS/backup/inventory lines, and assessment credit applied to repairs/management |
| ADD | copy tests | Reject “free assessment/fit check,” ranking/indexing/leads guarantees, guaranteed recovery/transfer, unlimited edits, implied emergency response, refund-product language, and unapproved assessment-delivery/management-response clocks |
| ADD | journey tests | Prove inquiry without account, account before acceptance/payment, paid onboarding before outside management, and one settled payment/job/credit result |

### 9.3 Missing-route convergence

Current routing is internally inconsistent:

- `services/index.html:1-14` redirects to `/custom/`.
- `websites/index.html:1-14` also redirects to `/custom/`.
- No `solutions/index.html` exists.
- `scripts/check-customer-copy.mjs:18`,
  `scripts/check-site-vnext.mjs:393-489`,
  `scripts/customer-section-ledger.mjs:983`,
  `scripts/verify-public-truth-release.mjs:54`, `vnext.js:364-412`, and multiple
  browser tests still require or link to `/solutions/`.

Recommendation: freeze `/custom/` as canonical, retain `/services/` as a
noindex redirect, remove `/solutions/` from active navigation/contracts, and
route all five service selections to `/custom/#existing-site-help` or stable
anchors within it. Do not build and polish a second storefront merely to satisfy
stale tests.

## 10. Obsolete/conflicting promise register

### REMOVE

- `custom/index.html:134`: direct $200 assessment Payment Link.
- `abracadabra/app/index.html:318` and `:320`: legacy direct $5/$25 Payment
  Links; inherited from the prior audit and incompatible with account-bound
  server quotes.
- `domains/domain-search.js:45-46`: legacy $40/$45 direct domain Payment Links.
- `domains/domain-search.js:171`: charge-first/full-refund-if-taken promise.
- `flyer.html:377`: old Host $25/Care $69 public price fragment.
- Any public old Care price/minute/edit/overage projection from
  `data/public-catalog.json:293-338`.
- “Free assessment,” “free fit check,” “free audit,” or copy that implies Zack
  will inspect an outside site during an inquiry.

### CHANGE

- `index.html:152` and `custom/index.html:134,202`: unqualified full build-credit
  claims.
- `index.html:152,166` and legal assessment wording that ranks findings by cost
  rather than severity/importance.
- `faq/index.html:54`: variable price/scope language now that the standard $200
  boundary is approved.
- `faq/index.html:55` and `legal/website-terms/index.html:161-166`: generic Care
  wording that does not distinguish three products.
- `contact/index.html:47-52`: payment sequence without the account gate.
- `legal/website-terms/index.html:96,100,109` and
  `legal/privacy/index.html:141`: unsupported cancel-any-time/14-day/90-day
  lifecycle and $25-only Alakazam terms.
- All `/solutions/` links and checker contracts, including `vnext.js:364-412`.

### HOLD

- Exact Custom Care recurring prices, minutes, edit counts, response times, and
  overages.
- Any public five-business-day assessment-delivery promise from
  `ops/SITESOURCERY-CUSTOM-SERVICES-COMMERCIAL-CONTRACT-2026-08-05.md:60`
  until the owner explicitly confirms the staffing commitment.
- Any public two-business-day Outside Management acknowledgement promise from
  `ops/SITESOURCERY-CUSTOM-SERVICES-COMMERCIAL-CONTRACT-2026-08-05.md:191-192`
  until the owner explicitly confirms the staffing commitment.
- Alakazam modest/more-care quantities and response promises.
- Any recovery success, transfer deadline, rollback certainty, search ranking,
  indexing, traffic, lead, or profile-verification promise.
- Domain storefront sales and exact domain retail price until registrar/cost
  authority is released.
- Any refund button, refund API, or refund-as-benefit copy. Defensive payment
  reversals are not a customer product.
- Public publication of the recommended new-service prices until the service
  catalog, quote/invoice/job path, and customer/owner projections are real.

### KEEP

- Free Abracadabra preview, $5 account-bound Download, and the retained
  $25/$35/$50 Alakazam concept, subject to the separate fulfillment/lifecycle
  release gates.
- The accepted Custom build ladder, design premiums, add-ons, redirect/data
  components, written quote, payment schedule, and ownership-after-final-payment
  model after catalog convergence.
- Phone and `sitesourcery@proton.me` as direct public inquiry routes.
- Customer ownership of business data, provider accounts, and customer-owned
  domains.
- Assessment as diagnosis and separately accepted repairs.
- No passwords, full card data, health data, or sensitive customer records in
  initial contact.

## 11. Copy obligations by service

These are obligations, not final prose.

### Shared account/payment strip

- Asking a question does not require an account.
- Before accepting a quote or paying, the customer creates or activates a Site
  Sourcery account.
- The account shows the exact scope, exclusions, price, invoice/payment status,
  and deliverables.
- No direct public checkout.

### Website Rescue & Tune-Up

- Begins with the paid bounded assessment unless the customer requests one
  exact non-diagnostic change.
- Customer chooses which findings to quote/fix.
- Repairs start at $250 after diagnosis; exact fixed quote comes first.
- Shared root causes are not charged repeatedly.
- No promise every defect is repairable or that a repair creates a business,
  search, accessibility-certification, or security outcome.

### Outside Website Management

- Built elsewhere means paid onboarding first.
- The first $200 buys the supportability/takeover review. Onboarding can
  conclude that the platform is unsupported; in that case the customer gets
  the written result and owes no remaining onboarding balance or monthly plan.
- Monthly management starts only after supportability acceptance.
- Base monthly responsibility is distinct from change/repair allowance.
- No unlimited edits; unused included capacity rolls into the immediately
  following cycle only. No emergency or response-time promise appears publicly
  unless the owner approves it and the accepted plan states it.

### Business Email & Domain

- Connect, Move, and Recovery Investigation are three distinct levels.
- Customer owns the domain/provider/mail accounts.
- Provider costs and terms are separate.
- Recovery investigation is paid even when recovery is unavailable.
- No credential requests in public contact; use provider delegation or a secure
  account access request.

### Website Move / Platform Escape

- Inventory first; not every feature/data/account can move.
- Quote names pages, content, accounts, redirects, DNS, data, missing features,
  launch checks, rollback, and handoff.
- Transition base composes with a build and existing redirect/migration/add-on
  lines.
- “Escape” must not imply Site Sourcery can override provider locks, contracts,
  export limits, or ownership disputes.

### Local Presence

- Name concrete setup work and limits.
- Separate Website Visibility Foundation, Google Business Profile work, bundle,
  extra pages, and extra locations.
- Customer remains profile owner; Site Sourcery is a manager when needed.
- No ranking, indexing, verification, traffic, lead, review, or revenue
  guarantee.
- Do not charge again for a baseline that a Site Sourcery build demonstrably
  includes.

## 12. Mobile and accessibility design/proof

### Presentation contract

- At 320, 390, and 430 CSS pixels, use one column. No horizontal price table,
  comparison carousel, clipped dollar amount, or side-by-side five-card grid.
- Keep each service name, starting price/custom status, and paid prerequisite
  visible before opening details. A customer must not open five disclosures just
  to learn which paths cost money.
- Use native `<details>/<summary>` for optional scope. Do not nest buttons or
  links inside `<summary>`.
- Preserve one H1, logical H2/H3 order, landmark labels, skip link, and a single
  primary hero action.
- All service links/buttons need a minimum 44-by-44 CSS-pixel target and visible
  focus. Keyboard order follows visual order.
- Hash-selected contact topics must receive visible focus without trapping it;
  the unselected list remains understandable without JavaScript.
- Prices cannot rely on color alone. “Held,” “from,” “one-time,” “monthly,” and
  prerequisite labels must be text.
- At 200% zoom and large mobile text, summaries, prices, exclusions, and CTAs
  remain readable without overlap.
- Honor `prefers-reduced-motion`; service comprehension cannot depend on reveal
  animation.
- Account quote/payment/job status uses server-derived text and a restrained
  `aria-live="polite"` status. Errors remain near the relevant control and are
  programmatically associated.
- Registration/sign-in/recovery retain explicit labels and correct autocomplete
  tokens. Provider access requests never render a generic password field.
- Legal details remain native, keyboard-operable, closed by default, with the
  plain-language summary outside the hidden clause.

### Required browser proof

1. 390×844 Pixel-class journey: `/custom/` → selected service → contact →
   account creation/activation → exact quote → acceptance → test payment → job
   status/deliverable.
2. 1440×900 Mac journey: owner finds the same client/site/payment/job and can
   prepare the next quote without re-entering data.
3. 320px and 200% zoom sweeps: no overflow, clipped pricing, hidden prerequisite,
   or unreachable CTA.
4. Keyboard-only: skip, service disclosure, contact topic, registration,
   acceptance, payment continuation, invoice/job detail, and sign-out.
5. Screen-reader semantics: headings/landmarks, disclosure state, field labels,
   errors, status announcements, currency/interval, and selected topic.
6. Reduced-motion and high-contrast checks.
7. Negative proof: no account means no quote acceptance/payment; stale quote
   cannot pay; unsupported outside site cannot start monthly management;
   assessment credit cannot apply twice; duplicate overlap keys cannot charge
   twice.

## 13. Two coordinated implementation lanes

### Build lane — backend truth

- [ ] Encode the frozen commercial contract in one vNext private service
  catalog: owner pricing, 90-day credit, payment terms, 30-day workmanship,
  one-cycle rollover, management/Care distinction, and overlap rules.
- [ ] Extend the existing account/organization model; do not build a second
  identity system for Custom clients.
- [ ] Add customer site assets with origin `alakazam`,
  `sitesourcery_custom`, or `external`.
- [ ] Add service inquiry/intake records without performing a free inspection.
- [ ] Add bounded assessment/expanded-assessment jobs, findings, screenshot
  deliverables, severity/importance, repair-unit estimate, and shared root cause.
- [ ] Add paid external onboarding/supportability records and platform bands.
- [ ] Build the stack-aware quote composer with prerequisites, overlap keys,
  credits, pass-through costs, exclusions, expiry, and immutable acceptance.
- [ ] Build invoice/deposit/balance, Checkout dispatch, provider readback,
  receipts, and no-double-charge reconciliation.
- [ ] Build jobs, checklists, access requests, deliverables, change orders,
  handoff, and assessment-credit consumption.
- [ ] Build recurring Outside Management contract, advance billing, allowance
  usage and one-cycle rollover, tickets, monitoring/monthly receipt, and
  end/change behavior. Keep response-time fields held until owner confirmation.
- [ ] Build customer-safe service/account projection and Mac/Pixel owner
  workbench from the same durable records.
- [ ] Prove unit, fresh-PostgreSQL migration, API, Stripe test-mode, restart,
  duplicate/replay, and complete customer/owner journeys.

### Polish lane — customer truth

- [x] Produce this read-only surface, mismatch, journey, mobile, and launch-gate
  audit.
- [ ] Freeze `/custom/` as the canonical route and reconcile stale
  `/solutions/` contracts.
- [ ] Draft five-card public copy from the released service catalog and backend
  capabilities.
- [ ] Reconcile homepage, Custom, scope, process, FAQ, contact, account, legal,
  privacy, metadata, and redirects as one copy packet.
- [ ] Regenerate public-safe catalog projections and reviewed digests from one
  private source; remove old Care leakage.
- [ ] Update copy/price/legal/route/section/browser checkers from reviewed
  obligations, never merely to silence failures.
- [ ] Add explicit no-free-inspection, no-ranking, no-recovery, no-unlimited-
  care, and no-refund-product rejection tests.
- [ ] Run mobile, keyboard, screen-reader, zoom, reduced-motion, and negative
  account/payment/stacking proof against the real backend.
- [ ] Release public promises only after the build-lane gates below are green.

Lane rule: the build lane owns services, state, calculations, payment effects,
and projections. The polish lane owns names, explanation, layout, legal copy,
accessibility, and customer proof. Neither lane invents the other's truth. One
lead reconciles shared catalog/contracts and commits each integrated checkpoint.

## 14. Launch gates

The five service lanes are not public-sale ready until every applicable box is
green:

- [ ] The executable catalog enforces the frozen 90-day assessment-credit
  window/refresh treatment, 30-day workmanship window, and one-cycle-only
  management allowance rollover.
- [ ] Owner explicitly approves or removes the five-business-day assessment
  delivery and two-business-day management acknowledgement promises before
  either appears in public, legal, quote, or account copy.
- [ ] One versioned private catalog contains the accepted Custom ladder, new
  service components, states, prerequisites, overlap rules, and held Care items.
- [ ] Public-safe projection is generated from that source and its digest is
  independently verified.
- [ ] No stale sibling catalog or optional lineage check can override/skip the
  canonical source.
- [ ] All paying paths require an activated account before acceptance/payment.
- [ ] Standard/expanded assessment scope and delivery are backend-enforced.
- [ ] Assessment credit is ledgered, one-use, bounded to $200, and proven against
  eligible/ineligible/duplicate cases.
- [ ] Outside-site onboarding is paid, produces a deliverable, and gates monthly
  management activation.
- [ ] Stack composer removes duplicate inventory, backup, DNS, redirect,
  connection, launch, and handoff work.
- [ ] Exact accepted quote produces one invoice/Checkout and one settled local
  payment record under retries, redirects, webhooks, and uncertainty.
- [ ] Customer account shows quote, invoice, receipts, job, deliverables, credit,
  recurring scope, and support without provider/internal identifiers.
- [ ] Owner Mac/Pixel view can search and operate the same client/site records.
- [ ] Direct $5/$25/$200/$40/$45 Payment Links are absent from the reviewed
  artifact.
- [ ] Old Care prices/caps and domain charge-then-refund language are absent.
- [ ] Unsupported Alakazam cancellation/grace/retention wording is removed or
  separately proven and approved.
- [ ] Rescue, recovery, move, and Local Presence no-guarantee terms are visible
  before acceptance.
- [ ] Public/legal/privacy/hosted projections and their digests agree.
- [ ] `/custom/`/`/services/`/`/solutions/` routing and all checker expectations
  agree on one canonical destination.
- [ ] Pricing, copy, legal, section-ledger, route, artifact-safety, and browser
  suites pass for the right contract.
- [ ] Fresh PostgreSQL, Stripe test-mode, email, backup/restore, monitor/alert,
  customer journey, owner journey, mobile, accessibility, and post-deploy proof
  pass.
- [ ] Owner walks and approves one assessment-to-build-credit journey, one
  outside-management journey, one stacked move journey, and one declined/
  unsupported recovery or management journey.
- [ ] Lead explicitly authorizes the public copy/release packet. This audit does
  not authorize push or deploy.

## 15. Risk order for the lead

1. **P0 — Unbound money path:** remove/disable the direct assessment link before
   any new-site publication; it can take money for work the backend cannot yet
   bind or deliver.
2. **P0 — Catalog split-brain:** freeze one source before implementing quotes;
   otherwise correct code can charge the wrong accepted price or credit.
3. **P0 — Account/custom backend gap:** do not advertise five new sale-ready
   services until account, quote, invoice, job, credit, onboarding, and owner
   views exist.
4. **P1 — Legal contradiction:** browser-only, hosted-account, $25-only, and
   invented lifecycle terms cannot coexist at launch.
5. **P1 — Dead route/checker loop:** resolve `/solutions/` before polishing so
   work is not duplicated into a route the owner did not ask for.
6. **P1 — Overlap leakage:** build deduplication before bundles, or stacking will
   overcharge customers and create owner-side manual corrections.
7. **P1 — Promise inflation:** no ranking, recovery, migration-completeness,
   rollback, response-time, unlimited-care, or refund-product language.

The correct next integration order is catalog freeze → account/site asset →
assessment/onboarding → stack-aware quote → acceptance/invoice/payment → job/
credit/recurring state → customer/owner projections → public/legal/mobile
polish → private proof → release decision.
