# Site Sourcery Website Terms V3 engineering review — 2026-08-08

Status: **proposed-diff review only; owner approval required**

Exact code candidate reviewed: `12c5c2da13de65b33f2add57fcef62d8e8c49d66`

Review branch: `release/website-terms-v3-review-20260808`

This document is engineering issue spotting, not legal advice. It does not
approve legal copy, release a service, authorize a charge, or assign a Website
Terms version, effective date, byte count, digest, or acceptance-authority
constant. The owner must approve the exact final rendered bytes before any
release wiring. Optional counsel review is outside this engineering review.

No Website Terms source, hosted fragment, accepted archive, hosted-truth
manifest, runtime composition, migration, release control, provider
configuration, or deployed system is changed by this review.

## 1. Bottom line

The current public Website Terms and the accepted hosted Website Terms V2 are
not one truthful first-dollar terms set:

- the public source still describes real billing and provider-side storage as
  future services even though the candidate contains the signed-in `$5`
  Download and authenticated assessment/Custom commerce paths;
- both current Terms surfaces incorrectly say refresh clears guest work even
  though made versions use tab `sessionStorage` and are restored after refresh
  or a payment return;
- both surfaces overstate unconditional repeat Download availability, and the
  hosted V2 fragment incorrectly applies a short-lived delivery-token concept
  to the direct HTML Download rather than the separate ZIP export;
- the hosted V2 fragment omits the fixed assessment scope and the implemented
  Custom payment, change, completion, final-payment, handoff, ownership, and
  workmanship boundaries;
- the hosted V2 fragment still describes a legacy Hive conversation while the
  exact candidate makes The Responder held and inquiry-only; and
- the public source has the owner-confirmed filed name in its hero but uses a
  different `DBA Site Sourcery` rendering in its footer, while the hosted V2
  fragment does not state the operator/filed-name relationship.

The smallest truthful first-dollar denominator supported by the exact
candidate is:

1. the signed-in one-time `$5` HTML Download per retained editor project;
2. the authenticated fixed `$200` Website assessment; and
3. authenticated, separately quoted Custom builds from Card through Scale.

The Responder is **not** supported as a first-dollar offer by the exact
candidate. Alakazam remains held and does not block this terms set. Keeping
both held is the fastest path that preserves executable and public truth.

The accepted Website Terms V2 artifact is historical evidence and must remain
byte-identical. A coordinated replacement must be a new source/hosted artifact
and new acceptance authority after owner approval; it must not rewrite V2.

## 2. Evidence hierarchy and scope

This review used, in descending order:

1. executable behavior and database constraints at the exact candidate;
2. maintained tests and the current completion matrix;
3. the current commercial catalog and dated owner-contract evidence; and
4. current public/legal copy.

The full audited copy surfaces were:

- `legal/website-terms/index.html`;
- `scripts/hosted-truth/fragments/legal-website-terms-head.html`; and
- `scripts/hosted-truth/fragments/legal-website-terms-main.html`.

The accepted V2 identifiers and hashes in
`scripts/hosted-truth/manifest.mjs`, the V2 legal artifact, and the existing V2
runtime acceptance constants were read only. This review intentionally does
not propose exact release identifiers or artifact hashes.

Domain storefront commerce, Alakazam subscription lifecycle, Responder
telephony, optional Care plans, outside-site management, and the broader
Expansion catalog are outside the first-dollar denominator. Copy may describe
their current hold, but must not make them sellable.

## 3. Ranked owner decisions

### Decision 1 — P0: is The Responder held, or is it a first-dollar in-person sale?

**Recommended decision: keep it held and exclude it from GO-LIVE.**

The supplied 2026-08-08 architecture brief says The Responder is “sold in
person.” The exact candidate says the opposite:

- `responder/index.html:6-7,40-45,55-66,146,193-196` says it is held, not
  currently sold, has no quote/invoice/payment/setup, and accepts inquiries
  only;
- `scripts/check-pricing.mjs:178,310-316` and
  `scripts/check-site.mjs:236-242,435` classify Responder sales and the old
  `$300`/`$250` prices as forbidden held semantics;
- `ops/SITESOURCERY-100-PERCENT-COMPLETION-MATRIX-2026-08-06.md:294-300,
  327-333,491-501` records held Responder truth as complete and telephony/A2P
  fulfillment as unbuilt Expansion work; and
- no exact-candidate Responder billing, telephony, A2P, consent, opt-out,
  delivery, monitoring, support, or cancellation journey authorizes a sale.

Terms copy cannot convert that held implementation into an in-person offer.
If the owner chooses “sold in person,” that is a scope expansion requiring a
separate accepted agreement and reconciled offer, invoice/payment,
telephony/A2P, consent/opt-out, support, lifecycle, and proof surfaces. Until
then, the exact replacement in proposed diff WT-10 is the only source-backed
position.

### Decision 2 — P0: approve the customer-facing refund/dispute boundary

**Recommended decision: approve the narrow, behavior-backed wording in WT-05
and do not advertise a blanket refund promise.**

The `$5` Download has an implemented defensive reversal state machine. A full
refund or lost dispute revokes future service Download authority; a partial
refund or other dispute state suspends it for review. A file already saved on
the customer’s device or independent host cannot be recalled.

Assessment and Custom checkout paths verify provider payment facts before
settlement. Assessment and the first Custom installment reject refunded Charge
evidence; change and final installments additionally require uncontested
Charge evidence. The candidate does **not** contain one general
post-settlement assessment/Custom refund-and-dispute lifecycle that safely
supports a more specific customer promise. Each accepted professional-service
agreement must therefore identify earned milestones, uncharged future work,
and legally required remedies without claiming an unimplemented automated
policy.

### Decision 3 — P1: approve the integrated first-dollar product wording

Approve or revise WT-01 through WT-09 as one coordinated set. The current
public source is closer to merged Custom truth; the hosted V2 fragment is
closer to the signed-in Download acceptance flow. Neither one can simply
replace the other without the corrections below.

### Decision 4 — P1: approve exact operator and contact presentation

Approve the exact relationship and spelling:

> Desiderata Labs LLC is the legal seller and operates Site Sourcery under the
> filed alternate name SITESOURCERY.

The owner has confirmed `SITESOURCERY`, `(856) 244-1220`, and
`sitesourcery@proton.me` as current operating facts. That is owner-supplied
verification, not independent official-record proof. The owner must decide
whether the filing certificate is required as release evidence; the copy must
not alternate between the filed spelling and `DBA Site Sourcery`.

### Decision 5 — P2: approve new-version release mechanics after copy approval

Preserve accepted V2 bytes and receipts. After the owner approves exact new
rendered bytes, a separate release lane may assign the new version/effective
date/digests, add new immutable artifacts and authority, require fresh
acceptance where appropriate, and update proof surfaces. None of those values
is chosen in this review.

## 4. Numbered proposed diffs

Every replacement below is proposed engineering copy. The quoted existing
sentences are exact at the reviewed candidate.

### WT-01 — P1: replace the obsolete “no real billing/storage” product boundary

**Targets**

- `legal/website-terms/index.html:67-68`
- `scripts/hosted-truth/fragments/legal-website-terms-main.html:46`

**Exact existing public-source sentence**

> These terms apply to the public pages and the current device-local Abracadabra maker. Provider hosting, public Internet publication, real billing, DNS work, and provider-side storage require a separately released service and explicit acceptance of its then-current terms. Custom work receives its own written scope and agreement.

**Exact existing hosted-fragment sentence**

> Building, revising, and testing the private preview does not create an account, save a project, authorize payment, order a domain, publish a site, or accept these terms. The account shows the terms and privacy versions being accepted before a preview is saved as an editor project. The person accepting represents that they are old enough to contract and authorized to act for the named organization. The exact $5 quote receives its own review and acceptance before payment. A separate written agreement controls made-for-you, publishing, domain, Care, or other scoped work.

**Proposed replacement**

> These terms apply to the public pages, the free guest maker, the signed-in saved-project path, and the one-time $5 HTML Download. Browsing, making, revising, or testing a guest preview does not create an account, save a project, authorize payment, publish a site, or record acceptance. Before Site Sourcery saves an editor project or requests its Download payment, the signed-in customer reviews and affirmatively accepts the exact terms and privacy versions shown for that project; the exact Download quote receives its own review and acceptance before payment. A person accepting for an organization represents that they are old enough to contract and authorized to act for it.
>
> A Website assessment or Custom build begins only through the signed-in account path after the customer accepts its exact written quote, scope, payment schedule, responsibilities, and applicable agreement. An inquiry or payment by itself does not authorize work, publication, domain action, or another service. Separately scoped publishing, domain, Care, and other work is controlled by its accepted written agreement.

**Source evidence**

- `server/commerce-v2/hosted-download.mjs` requires a signed-in actor and delegates
  only the scoped project Download path.
- `server/commerce-v2/payment.mjs:978-1040` resolves one project/version
  artifact and invokes project-entitlement authorization.
- `server/hosted/custom-services-assessment-quote.mjs:504-555,887-924` exposes
  the exact `$200`, full-before-work, bounded-scope, accepted-date quote.
- `server/data-plane/supabase/migrations/202608050035_custom_service_quotes.sql`
  and migrations `038` through `047` retain assessment/Custom acceptance,
  invoice, payment, job, completion, and handoff authority.
- `ops/SITESOURCERY-100-PERCENT-COMPLETION-MATRIX-2026-08-06.md:120-124,
  263-290,308-311` distinguishes implemented backend authority from final
  release/browser proof.

**Rationale**

The public sentence is obsolete for the candidate’s real signed-in storage and
billing paths. The hosted sentence correctly describes Download acceptance but
omits the implemented account-first assessment/Custom paths. The replacement
limits acceptance to the actual first-dollar services without implying that a
guest action, inquiry, or payment alone creates work or publication.

### WT-02 — P1: correct refresh and tab-session persistence

**Targets**

- `legal/website-terms/index.html:76`
- `scripts/hosted-truth/fragments/legal-website-terms-main.html:55`

**Exact existing public-source sentence**

> Facts and made versions stay only in the current tab; refreshing the page or closing the tab clears them.

**Exact existing hosted-fragment sentence**

> The free preview stays in the editor tab and is cleared by refreshing or closing that tab.

**Proposed replacement**

> Before a guest saves a project, made versions are stored in that tab’s session storage so they can ordinarily survive a refresh or a payment return in the same tab. Closing the tab or clearing its session storage ordinarily removes them, subject to the browser’s controls. Unsaved edits may still be lost, so the customer should review the current version before navigating away.

**Source evidence**

- `abracadabra/app/abracadabra-app.js:597-610` writes made-version raw facts and
  the selected version index to `sessionStorage`.
- `abracadabra/app/abracadabra-app.js:613-638,958-961` restores and recompiles
  the stored versions on load and reports that work stayed in the tab.
- `abracadabra/app/abracadabra-app.js:692-703,942-948` saves on version render
  and before unload.
- `scripts/hosted-truth/fragments/legal-privacy-main.html` already distinguishes
  refresh/payment-return survival from tab close/session-storage clearing.

**Rationale**

Both existing Terms sentences contradict the browser implementation. The
replacement describes what is actually retained without promising behavior
beyond the browser’s session-storage controls or implying that every unsaved
form edit is durable.

### WT-03 — P1: qualify repeat Download availability

**Targets**

- `legal/website-terms/index.html:102`
- `scripts/hosted-truth/fragments/legal-website-terms-main.html:84`

**Exact existing public-source sentence**

> Later accepted versions and repeat downloads from the same retained project do not require another Site Sourcery purchase.

**Exact existing hosted-fragment sentence**

> Later accepted versions and repeat downloads from the same retained editor project do not require another Site Sourcery purchase.

**Proposed replacement**

> Later accepted versions and repeat downloads for that same retained editor project do not require another Site Sourcery purchase while the project, requested accepted file, and Download entitlement remain active and available. A different editor project has its own one-time $5 Download purchase. The Download does not renew or start a subscription. Customers should keep copies of files they need.

**Source evidence**

- `server/commerce-v2/entitlement.mjs:52-99` requires the exact tenant,
  customer, project, accepted-version action, `editor_project` scope, and
  `active` entitlement state. This Download entitlement is non-expiring, but it
  is not unconditional.
- `server/commerce-v2/payment.mjs:978-1040` requires the requested stored
  artifact to resolve, checks active entitlement, and verifies its digest.
- `scripts/hosted-truth/fragments/legal-privacy-main.html` already uses the
  project/file/entitlement active-and-available qualification and tells the
  customer to keep their own files.

**Rationale**

“No second purchase” is price truth, not a promise of permanent storage or
access after deletion, reversal, safety restriction, or missing artifact. The
replacement preserves the one-purchase rule while stating the actual
authorization and availability boundary.

### WT-04 — P1: split authenticated HTML Download from ZIP export authorization

**Target**

- `scripts/hosted-truth/fragments/legal-website-terms-main.html:93`

**Exact existing sentence**

> The service prepares the accepted saved version for Download and can use a short-lived delivery token.

**Proposed replacement**

> An entitled, signed-in customer requests an accepted project version through the authenticated HTML Download route, and the browser receives that version as an HTML attachment. A separate project ZIP export, when available, has its own short-lived, one-time download authorization. That ZIP authorization is not the $5 HTML Download entitlement.

**Source evidence**

- `server/hosted/http.mjs:2437-2462` calls the authenticated Download boundary
  and returns `text/html; charset=utf-8` as an attachment; this route accepts no
  delivery token.
- `server/hosted/http.mjs:2703-2757` has separate project export routes and
  returns ZIP bytes from a token-bearing export-download request.
- `server/hosted/postgres-service.mjs:49,8310-8366,8439-8507` creates a
  five-minute export authorization, requires it to be unconsumed and
  unexpired, consumes it, and returns `application/zip`.
- `server/data-plane/supabase/migrations/202607280007_hosted_api_edges.sql`
  defines the separate export authorization boundary.

**Rationale**

The existing hosted sentence conflates two different services and authorities.
The direct `$5` product delivers one accepted HTML version through signed-in
project entitlement. The short-lived token belongs to the separate ZIP export
path. The replacement prevents customers from assuming that the HTML route
depends on an expiring link or that ZIP export is the purchased `$5` artifact.

### WT-05 — P0: state only implemented Stripe and reversal consequences

**Targets**

- `scripts/hosted-truth/fragments/legal-website-terms-main.html:80-84`
- `legal/website-terms/index.html:102`
- the currently missing assessment/Custom reversal clause

**Exact existing hosted-fragment sentence**

> Payment questions can be sent through the public contact routes; rights that applicable law cannot waive remain available.

**Exact existing public-source sentence**

> A held, expired, declined, cancelled, or otherwise incomplete checkout creates no Download entitlement.

**Proposed replacement**

> Secure card entry is handled by Stripe at checkout. Site Sourcery verifies the exact quote, project or service purpose, amount, currency, tax, Checkout, PaymentIntent, and Charge evidence before recording a completed payment; Site Sourcery does not ask for the full card number or card security code. A held, expired, declined, cancelled, or otherwise incomplete Checkout creates no Download entitlement or paid professional-service authority.
>
> For the $5 Download, a full refund or a lost dispute revokes future Site Sourcery Download access for that project; a partial refund or another dispute state suspends future access for review. Those service-side changes cannot retrieve an HTML file already saved on the customer’s device or independent host. Refund availability, restoration, and remedies are governed by the accepted purchase terms and applicable law; these terms do not promise a blanket refund.
>
> Website assessment and Custom agreements must state what is earned at each delivered milestone, what later work remains uncharged if it does not begin, and any rights required by applicable law. The current service does not promise one automated post-settlement refund or dispute outcome for all professional-service payments.

**Source evidence**

- `server/commerce-v2/payment.mjs:393-458` maps full Download refunds and lost
  disputes to revoked authority, and partial refunds/other dispute states to
  suspended review states.
- `server/hosted/http.mjs:2437-2462` and the existing hosted safety paragraph
  establish that Site Sourcery cannot recall a file already delivered outside
  its service.
- `server/commerce/adapters/stripe.mjs:1947-2078` and
  `server/commerce/test/stripe-provider.test.mjs:3527-3558` reject refunded
  assessment Charge evidence before settlement.
- `server/commerce/adapters/stripe.mjs:2358-2487` rejects refunded first Custom
  installment evidence. Lines `2858-3000` and `3415-3592` require change and
  final Charge evidence to be captured, unrefunded, and uncontested.
- `server/data-plane/supabase/migrations/202608060047_custom_build_handoff.sql`
  lines `994-1057` refuse final handoff when final-payment evidence is refunded or
  disputed.
- `ops/SITESOURCERY-CUSTOM-SERVICES-COMMERCIAL-CONTRACT-2026-08-05.md:10-45`
  requires each paid agreement to identify scope, payment schedule, earned
  milestones, uncharged later work, and applicable-law rights without
  advertising a blanket refund.

**Rationale**

The replacement distinguishes payment verification, implemented defensive
Download consequences, and the narrower professional-service evidence gates.
It does not invent a post-settlement assessment/Custom lifecycle or imply that
a service restriction can erase an independently held customer file. The
owner must approve this customer-facing policy boundary before sealing.

### WT-06 — P2: preserve the independent self-host boundary

**Targets**

- `scripts/hosted-truth/fragments/legal-website-terms-main.html:62,93-94`
- `legal/website-terms/index.html:105,113-114`

**Exact existing hosted-fragment sentences**

> The customer may place the downloaded file with a hosting provider they choose. Site Sourcery does not promise a hostname, hosting plan, access-controlled site, certificate, DNS change, or publication state through this Download.
>
> Downloading does not place the page on the public Internet. Once the customer edits, shares, or hosts the file outside Site Sourcery, the customer is responsible for that copy, the chosen hosting and domain services, security, backups, accessibility, lawful content, and any third-party terms. Site Sourcery cannot remove or update a file held on the customer’s device or another provider.

**Exact existing public-source sentence**

> A signed-in retained project’s $5 Download likewise delivers an HTML file without publishing or hosting it.

**Proposed replacement**

> The $5 Download delivers an HTML file; it does not create a public Internet address, Site Sourcery hosting, publication, DNS change, certificate, maintenance plan, backup duty, or ongoing support duty. The customer may edit, copy, and self-host that file with a provider they choose without another Site Sourcery payment for the same project entitlement. The customer selects and manages that independent host and is responsible for the outside copy, lawful content, security, backups, accessibility, provider terms, and testing. Site Sourcery cannot update or remove a file held on the customer’s device or independent host.
>
> Any later Site Sourcery-managed publication or domain work is a separate service requiring its own releasable authority and accepted written scope. The current $5 Download does not authorize it, and current Alakazam publication remains held.

**Source evidence**

- `server/hosted/http.mjs:2437-2462` performs file delivery without a
  publication command.
- `server/hosted/selfhost-publication-port.mjs:104-306` treats provider-managed
  publication as a separate, fail-closed path requiring an active project,
  accepted version, passed screening, paid entitlement, and verified address.
- `server/hosted/test/selfhost-publication-port.test.mjs:300-389` proves that
  invalid, refunded, disputed, or revoked publication authority cannot publish.
- `scripts/hosted-truth/fragments/legal-privacy-main.html` already separates
  direct HTML delivery, customer-selected independent hosting, and held
  Alakazam publication.

**Rationale**

The current hosted copy is substantially correct and should be preserved, but
the integrated replacement should explicitly separate customer self-hosting
from Site Sourcery’s distinct publication machinery and from Care/support.
This avoids turning permission to use a downloaded file into an implied
hosting, security, maintenance, or publication obligation.

### WT-07 — P1: use one exact operator, filed-name, and contact presentation

**Targets**

- `legal/website-terms/index.html:42,223`
- `scripts/hosted-truth/fragments/legal-website-terms-main.html:193`

**Exact existing public hero sentence**

> Site Sourcery is the brand presentation of the filed alternate name SITESOURCERY. Desiderata Labs LLC is the legal seller.

**Exact existing public footer sentence**

> © 2026 Desiderata Labs LLC · DBA Site Sourcery

**Exact existing hosted contact sentence**

> Questions and notices can be sent to (856) 244-1220 or sitesourcery@proton.me.

**Proposed replacement**

> Desiderata Labs LLC is the legal seller and operates Site Sourcery under the filed alternate name SITESOURCERY. Site Sourcery is the public brand presentation. Questions and notices can be sent to (856) 244-1220 or sitesourcery@proton.me.

For shared footers, use this consistent identity rendering instead of the
current mixed spelling:

> © 2026 Desiderata Labs LLC · filed alternate name SITESOURCERY

**Source evidence**

- `ops/SITESOURCERY-PRIVACY-V3-ENGINEERING-LEGAL-REVIEW-2026-08-08.md:7,
  36,42,48,76,172,425-441` records the owner-confirmed exact filed spelling and
  contact routes, while explicitly distinguishing owner confirmation from
  independent official-record proof.
- The current public Terms hero already uses exact `SITESOURCERY`; the footer
  does not.

**Rationale**

Customers should not have to infer whether the legal seller, filed alternate
name, and display brand are different businesses. The proposed wording uses
one owner-confirmed spelling across the public and accepted surfaces while
preserving the evidence limitation for the release record.

### WT-08 — P1: replace the generic assessment clause with the implemented offer

**Targets**

- `scripts/hosted-truth/fragments/legal-website-terms-main.html:135-139`
- `legal/website-terms/index.html:151-155`

**Exact existing hosted-fragment sentence**

> The exact scope, price, turnaround, and any later credit are shown in writing before purchase. The assessment diagnoses and does not itself change the site.

**Exact existing public-source sentence**

> The standard $200 assessment covers one customer, business, public website, and primary goal; up to five representative public pages or page types; phone and desktop review; and up to ten important findings with screenshot evidence and a recommended order of work. The accepted offer states the delivery date. The assessment diagnoses; remediation requires a separate accepted scope. Its full $200 may credit one qualifying Custom base build under the written customer, site, timing, and no-double-credit rules.

**Proposed replacement**

> The standard Website assessment costs $200 and is paid in full before assessment work begins. Its accepted quote covers one customer organization, one existing public website, and one primary goal; up to five representative public pages or page types; desktop and phone review; and up to ten important findings with screenshot evidence, severity, practical importance, and a recommended order of work. The accepted quote states the delivery date. Larger or denser assessments are separately quoted before expanded inspection begins.
>
> The assessment diagnoses the existing public site. It does not include repairs, an exhaustive page-by-page crawl, authenticated admin or source-code review, malware cleanup, account recovery, penetration testing, legal advice, or accessibility certification. Remediation requires a separate accepted scope.
>
> After the report is delivered, its full $200 is a one-use, non-cash credit toward one accepted Custom base build from Card through Scale for the same organization and project if that build is accepted within 90 days of assessment delivery. The credit is not transferable, cannot be applied twice, and does not pay tax, provider costs, ongoing service, or unrelated work.

**Source evidence**

- `data/public-catalog.json:342-374` fixes `$200`, one website, five
  representative targets, desktop/phone, ten findings, separate expanded
  assessment, and the one-use same-organization/same-project 90-day non-cash
  credit.
- `server/hosted/custom-services-assessment-quote.mjs:504-555,887-924` rejects
  drift from those money, scope, payment-schedule, and delivery-date facts.
- `server/data-plane/supabase/migrations/202608050040_custom_service_assessment_delivery.sql`
  lines `201-321,502-684` bind the delivered report, zero-to-ten findings, 90-day
  cutoff, `$200` one-use non-cash Card-through-Scale credit, and exact paid job.
- `ops/SITESOURCERY-CUSTOM-SERVICES-COMMERCIAL-CONTRACT-2026-08-05.md:47-91`
  supplies the agreed exclusions and no-remediation boundary.

**Rationale**

The hosted clause is too generic for the fixed first-dollar offer. The public
clause is substantially correct but omits implemented payment timing, specific
exclusions, exact 90-day/one-use/non-cash/same-project conditions, and eligible
base-build range. The replacement makes the purchase boundary match the quote
and database authority without inventing a standard delivery duration.

### WT-09 — P1: carry implemented Custom obligations into the accepted terms

**Targets**

- `scripts/hosted-truth/fragments/legal-website-terms-main.html:126-130`
- `legal/website-terms/index.html:142-147`

**Exact existing hosted-fragment sentence**

> The Abracadabra account or $5 Download does not order made-for-you design, writing, migration, integrations, human revision work, a domain, hosting, or publication. Those services begin only after the customer and Site Sourcery accept a separate written scope covering the job, price, responsibilities, and next step.

**Exact existing public-source sentences**

> Custom work begins only through a written quote or scope and a separately accepted agreement. Payment alone does not authorize work or publication.
>
> Card and Card Plus are paid in full before work starts. Site through Scale use 50% before work; the final 50% becomes due only after completion and before final handoff. Completion does not authorize an automatic charge. Ownership of the agreed client deliverables transfers only after final payment, subject to third-party materials, licenses, and retained Site Sourcery tools identified in the agreement. The 30-day workmanship correction window begins only when final handoff is recorded after final payment. Completion or launch by itself does not start that clock.

**Proposed replacement**

> Custom work begins only after the signed-in customer and Site Sourcery accept an exact written quote, scope, responsibilities, dependencies, payment schedule, completion evidence, and separate agreement. Payment alone does not authorize work, publication, domain action, or work outside the accepted scope. Provider fees are separate unless the quote expressly includes them. Added or changed work requires a written change order, customer acceptance, and its required payment before the added work begins; it is not silently performed or charged.
>
> Card and Card Plus are paid in full before work starts. Site through Scale require 50% before work; the final 50% becomes payable only after Site Sourcery records completion evidence and before final handoff. Completion does not authorize an automatic charge. Final handoff requires the exact completed scope plus provider-confirmed final payment or the accepted quote’s explicit zero-balance clearance. Ownership of the agreed client deliverables transfers only after final payment, subject to third-party materials, licenses, and retained Site Sourcery tools identified in the agreement.
>
> The included 30-day workmanship correction window starts only when the immutable final handoff is recorded after financial clearance. Completion or launch alone does not start that window. It covers reproducible defects in accepted deliverables, not new content, new features, changed decisions, third-party changes, damage by another operator, provider incidents, or work outside the accepted scope. Ongoing Care requires a separate written scope.

**Source evidence**

- `data/public-catalog.json:8-165` fixes Card through Scale prices and the
  full-before-work versus half-before-work/half-before-handoff schedules, with
  ownership after final payment.
- `server/data-plane/supabase/migrations/202608060044_custom_build_change_completion.sql`
  lines `63,190-345,616-705,1810-2055` bind added scope to accepted/paid change
  orders and requires completed milestones, distinct desktop/phone evidence,
  passed checks, no open work request, and no unresolved change order before
  completion.
- `server/data-plane/supabase/migrations/202608060046_custom_build_final_payment.sql`
  lines `840-1022` derive the exact final obligation only from accepted scope,
  completed work, all effective changes, and the correct installment schedule.
- `server/data-plane/supabase/migrations/202608060047_custom_build_handoff.sql`
  lines `790-1138` permit handoff only after exact completion and financial
  clearance; lines `528-534` set workmanship start equal to handoff and end at
  720 hours.
- `ops/SITESOURCERY-100-PERCENT-COMPLETION-MATRIX-2026-08-06.md` lines
  `286-288,401-416` record the ordered quote/change/completion/final-payment/handoff
  path as done and the handoff-derived correction clock as canonical.

**Rationale**

The hosted V2 paragraph only says a separate scope is required and therefore
does not describe the implemented first-dollar build obligations. The public
paragraph already captures the latest handoff-only clock and should be the
base, with the exact change-order, completion-evidence, zero-balance, provider
fee, and workmanship exclusions added. The older commercial-contract phrase
“launch or final handoff” is superseded by migration 47 and current public
Terms: launch alone must not start the clock.

### WT-10 — P0: replace legacy Hive/in-person copy with candidate Responder truth

**Targets**

- `scripts/hosted-truth/fragments/legal-website-terms-main.html:26,143-148`
- retain and coordinate `legal/website-terms/index.html:159-163`

**Exact existing hosted-fragment sentences**

> Hive is a short phone or in-person conversation with Zack and does not place an order or start work.
>
> Hive is a short phone or in-person conversation with Zack about one task that keeps slipping. The conversation does not activate an integration, send a message, make a booking, request a review, change an invoice, contact a provider, order work, or replace legal, compliance, accounting, safety, or industry advice. If work could be useful, its scope and price are stated separately in writing before the customer decides.

**Exact existing public-source sentence**

> The Responder remains held until its telephony, A2P registration, message delivery, opt-out handling, monitoring, lifecycle terms, and customer proof are complete. Its page describes an intended missed-call flow; it does not activate an integration, send a message, save a setup, create a quote, take payment, contact a provider, or operate a business process. Earlier setup, monthly-price, and cancellation drafts are not a public offer. The page is not legal, compliance, accounting, safety, or industry-specific advice.

**Proposed replacement — recommended candidate-truth path**

> The Responder is held from sale. Its page describes an intended missed-call flow, but it does not connect a phone number, activate an integration, send a message, save a setup, create a quote or invoice, take payment, contact a provider, or operate a business process. A call or email may record an inquiry only; it does not order Responder work or start setup. Earlier setup prices, monthly prices, cancellation drafts, and legacy Hive descriptions are not current offers. The page is not legal, compliance, accounting, safety, or industry-specific advice.

**Source evidence**

- `responder/index.html:6-7,40-45,55-66,146,193-196` is explicit held,
  inquiry-only, no-quote/no-payment/no-setup public truth.
- `scripts/check-pricing.mjs:310-316` and `scripts/check-site.mjs:236-242`
  reject the old Responder prices and operational claims.
- `ops/SITESOURCERY-100-PERCENT-COMPLETION-MATRIX-2026-08-06.md:294-300,
  327-333,491-501` keeps real telephony/A2P fulfillment in Expansion and holds
  active sales.
- The supplied architecture brief’s “sold in person” statement conflicts with
  every exact-candidate authority above and is therefore not treated as
  executable offer evidence.

**Rationale**

The hosted fragment is stale branding and can be read as an available
in-person service. The exact candidate permits a direct inquiry but not an
order, quote, invoice, payment, or setup. Choosing the alternative “sold in
person” path requires a separate build and proof project; it cannot be achieved
by changing this paragraph.

### WT-11 — P2: add the explicit held Alakazam boundary to the accepted terms

**Targets**

- the hosted fragment’s missing Alakazam clause
- coordinate `legal/website-terms/index.html:101-104,111-114`

**Exact existing public-source sentence**

> Alakazam subscriptions are deferred and unavailable. No Alakazam subscription, hosting activation, publication, or tier feature is offered. These public terms do not authorize an Alakazam payment.

**Exact existing hosted-fragment sentence at the closest product boundary**

> The $5 Download provides an HTML file. It does not include a web address, hosting, or Site Sourcery publication.

**Proposed replacement/addition**

> Alakazam subscriptions, hosting activation, publication, and tier features remain held and unavailable. These terms do not authorize an Alakazam payment or promise an Alakazam cancellation, grace, suspension, export, retention, deletion, refund, or other account-lifecycle rule. A later Alakazam release requires its separately approved service, privacy, billing, publication, support, and lifecycle terms before acceptance or payment. The held Alakazam work does not limit the separately purchased $5 HTML Download or a customer’s independent self-hosting of that file.

**Source evidence**

- `server/hosted/alakazam-release-config.mjs:6-50` defaults to exact `held`
  mode; approved mode requires an explicit reviewed tax mode and readiness.
- `data/release-control.json` holds commercial deployment and provider effects.
- `ops/SITESOURCERY-100-PERCENT-COMPLETION-MATRIX-2026-08-06.md:141-152,
  163-180,210-237,324-328` excludes held Alakazam lifecycle work from the
  first-dollar finish line while requiring the held disclosure.
- `ops/SITESOURCERY-ALAKAZAM-LIFECYCLE-INVENTORY-2026-08-04.md` records open
  renewal, cancellation, retention, refund/dispute, and support policy and
  implementation work that must not be invented as current customer terms.

**Rationale**

Hosted V2 is focused on Download and can be read without the explicit current
Alakazam hold. The addition keeps dormant/incomplete Alakazam machinery from
becoming an accidental offer while making clear that Alakazam is not a blocker
for the independent HTML product.

### WT-12 — P1: make a new accepted version; never rewrite V2

**Targets**

- `legal/website-terms/index.html:203`
- `scripts/hosted-truth/fragments/legal-website-terms-main.html:193`

**Exact existing public-source sentence**

> These public terms may be revised by posting an updated effective date and text on this page.

**Exact existing hosted-fragment sentence**

> A material change receives a new effective date and any notice or fresh acceptance required by law.

**Proposed replacement**

> A material change receives a new terms version and effective date, with any notice or fresh acceptance required for the affected service. Site Sourcery preserves the version a customer accepted as transaction evidence. Questions and notices can be sent to (856) 244-1220 or sitesourcery@proton.me.

**Source evidence**

- `scripts/hosted-truth/legal-artifacts.mjs:18-29` describes the existing hosted
  Website Terms V2 artifact.
- `scripts/hosted-truth/manifest.mjs:112-125,326,384-414` pins the current
  source/hosted fragments, V2 identifier, and required copy.
- `server/hosted/project-legal-authority.mjs:22` and
  `server/data-plane/supabase/migrations/202608010021_hosted_legal_authority.sql`
  bind current acceptance to V2.
- `ops/SITESOURCERY-100-PERCENT-COMPLETION-MATRIX-2026-08-06.md:120-124,
  311,328,512-534` requires a coordinated new terms release while preserving
  accepted V2 bytes.

**Rationale**

The accepted document is evidence, not mutable site copy. The replacement
makes the customer-facing principle explicit. Engineering must implement a
new artifact/authority after approval rather than rewriting V2 in place. This
review deliberately does not choose the future version, date, digest, or byte
count.

## 5. Material areas with no separate adverse finding

Subject to owner review of the full final text, the following current concepts
do not materially contradict the exact candidate and can be carried forward:

- customer ownership of lawful supplied content and responsibility for its
  accuracy and rights;
- prohibited-use language against fraud, malware, impersonation, infringement,
  access-control bypass, and payment abuse;
- customer ownership of a customer-owned domain and the separation of domain
  work from the `$5` Download;
- permission to use, copy, modify, and independently self-host delivered HTML,
  subject to identified third-party materials/licenses;
- separation of ongoing Care from Download and from the included Custom
  workmanship window; and
- the principle that a separately signed project agreement can control
  project-specific commitments and remedies.

This engineering review does not determine the legal adequacy or enforceability
of warranty, liability, statutory-remedy, age/authority, governing-law, or
similar clauses. Those remain owner approval questions for the exact final
document.

## 6. Release implementation sequence after owner approval

1. Resolve Decisions 1 and 2. If Responder remains held, keep it outside the
   first-dollar completion denominator and use WT-10.
2. Apply the owner-approved WT-01 through WT-12 language to a **new** coordinated
   Website Terms source and hosted artifact. Do not alter accepted V2 bytes.
3. Render and review the exact new full-page artifact, including shared footer,
   navigation, summaries, closed/open details, phone/email links, and mobile
   presentation.
4. Only after exact-byte owner approval, assign the new version, effective
   date, byte count, hashes, immutable artifact records, and legal-acceptance
   authority in the release lane.
5. Reconcile the legal center, FAQ, Abracadabra landing copy, Privacy release,
   account acceptance UI, quote disclosures, and browser proof to the same
   offer denominator. Do not weaken the held Responder or Alakazam controls.
6. Run fresh database migration proof, legal/artifact checks, hosted account
   journeys, `$5` payment/reversal journeys, assessment-through-report/credit,
   Custom-through-final-handoff, and desktop/phone browser audits against the
   exact release candidate.
7. Push, deploy, provider-live effects, and public cutover remain separate
   owner-authorized actions.

## 7. Owner sign-off record to obtain

- [ ] Decision 1: Responder remains held and excluded from first-dollar
  GO-LIVE, or a separately scoped sale-enablement project is authorized.
- [ ] Decision 2: WT-05 refund/dispute and professional-service milestone
  boundary is approved or revised.
- [ ] WT-01 through WT-04 Download/account/session wording is approved.
- [ ] WT-06 self-host/publication boundary is approved.
- [ ] WT-07 exact operator name and contact presentation is approved.
- [ ] WT-08 assessment scope, exclusions, delivery-date, and credit conditions
  are approved.
- [ ] WT-09 Custom scope/payment/change/completion/handoff/ownership/workmanship
  wording is approved.
- [ ] WT-10 and WT-11 held-product wording is approved.
- [ ] WT-12 new-version/archive principle is approved.
- [ ] Owner decides whether independent filed-name documentation is required
  in addition to the recorded owner confirmation.
- [ ] Owner approves one exact rendered artifact by hash and byte count in the
  later release lane; no approval is inferred from this review.
