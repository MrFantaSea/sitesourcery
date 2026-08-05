# Site Sourcery custom-services backend inventory — 2026-08-05

## Status and scope

This is the bounded Build-lane inventory for Custom sites and the five approved
existing-site service lanes. It is an architecture and sequencing document,
not an implementation or release authorization.

Implementation update: H1A through H1F now occupy actual migrations 34–38:
foundation, quotes, customer commands, the assessment invoice, and its exact
automatic-tax Stripe Checkout dispatch. The
numbered migration headings below preserve the original inventory and are no
longer filename assignments. Use `SITESOURCERY-ACTIVE-RUN.md` and the canonical
roadmap for current sequence and completion state. Checkout now collects the
billing address and calculates tax at Stripe while Site Sourcery holds the
immutable `$200` subtotal. Its separate release defaults held, its returned
Session must preserve the exact invoice purpose, and no raw provider identity
crosses the browser boundary; verified settlement, jobs/reports, and credit
remain unfinished.

The unfinished Batch 3C Alakazam tier-fulfillment slice is protected. Migration
`202608040033_alakazam_tier_fulfillment.sql` and every pre-existing worktree
change must be reviewed and sealed before any migration proposed here is
created. Nothing in this document authorizes a push, deploy, DNS/provider
change, provider object, credential read, payment effect, or public promise.

The governing rule is additive integration with the canonical hosted platform:

```text
first-party account
  -> customer organization
    -> one canonical project/site anchor
      -> paid assessment or paid outside-site onboarding
        -> findings/inventory
          -> customer-selected work
            -> immutable fixed quote + acceptance
              -> local invoice + provider-confirmed payment
                -> job + checklist + evidence
                  -> completion + handoff
                    -> optional recurring management
```

There must not be a second account system, customer database, project table,
payment truth, domain registry, support system, or audit log.

## Executive verdict

The repository already has a strong production-shaped foundation:

- verified first-party accounts, sessions, recovery, organizations, roles, and
  tenant/project ownership;
- serializable PostgreSQL transactions, forced RLS, idempotent command rows,
  append-only provider evidence, an outbox, and audit events;
- exact Stripe Checkout/readback/settlement patterns for Download and
  Alakazam;
- accepted website versions, addresses, publication, support tickets, exports,
  and a substantial domain-procurement contract;
- fresh-database, HTTP, provider-fake, browser, backup, and restoration test
  harnesses.

The first custom-services commercial spine now exists through an authenticated
external-site intake, deployment-authorized owner quote operation, exact
customer acceptance, immutable assessment invoice, and one safely replayable
automatic-tax Checkout destination. This is not yet a complete sellable
lifecycle: provider-confirmed settlement, the assessment job and findings,
report delivery, service credit, client-work checklist/handoff, outside-site
takeover, recurring management ledger, and the broader owner workbench remain.

The fastest safe route is therefore to reuse the platform primitives and add
one narrow `service_*` vertical, not to stretch the old Spark commerce tables
or build a parallel CRM.

## Owner inputs this backend must preserve

### Account and inspection boundary

- A client must have a verified Site Sourcery account and active organization
  before accepting a quote or making a payment.
- A public inquiry may repeat facts supplied by the prospect, but it creates no
  diagnosis, finding, recommendation, or free inspection.
- Outside websites begin with a paid USD 200 supportability/takeover review.
  If Site Sourcery accepts the site, the remaining onboarding balance must be
  paid before delegated access, baseline setup, or recurring management can
  begin. A declined site receives the paid written result but no balance or
  monthly charge.
- Access is requested through customer-owned delegated accounts. No password,
  recovery code, API key, registrar secret, mailbox password, or payment secret
  may be submitted through an intake, support message, quote, access request,
  document, or chat field.

### Standard assessment

The standard assessment is exactly USD 200 and is bounded to:

- one website;
- up to five representative public pages or page types;
- desktop and phone review;
- up to ten prioritized findings with screenshot evidence;
- one written report ordered by severity and importance.

It does not include repairs, private admin/code inspection, account recovery,
malware cleanup, legal/accessibility certification, or an exhaustive large-site
audit. Larger or materially different sites receive a separately quoted
expanded assessment. If the submitted description proves inaccurate, work
stops at the purchased boundary: Site Sourcery may deliver the bounded sample
and quote the expansion, but does not silently perform free additional review.

### Assessment-credit canonical freeze

The canonical commercial contract now freezes this rule:

- one fully paid **and delivered** standard assessment creates one USD 200
  non-cash credit;
- the credit belongs to the same customer organization and same website
  project;
- it applies once to one accepted Site Sourcery Custom build from Card through
  Scale;
- it does not apply to Rescue, onboarding, management, Alakazam, Local
  Presence, email/domain work, provider costs, cash, or another customer;
- the Custom build must be accepted within 90 days of assessment delivery;
- after that window—or after a material site change—Site Sourcery may require
  and separately price a refresh before reissuing the same one-use USD 200
  credit; the lapsed grant cannot be spent while refresh is required, and a
  refresh cannot mint an additional simultaneous credit;
- the credit applies to the first required build installment. For example, a
  Card leaves USD 200 due, Card Plus leaves USD 450 due, and a USD 1,200 Site
  needs USD 400 additional at acceptance so USD 600 total value is credited
  toward the 50% start threshold, with USD 600 due on completion;
- a voided build quote releases only a reserved, unsettled credit. A settled
  credit cannot be transferred or cashed out. Payment reversal or dispute
  enters reconciliation and can revoke unearned credit without inventing a
  customer refund offer.

The catalog policy and each grant must pin the governing contract digest,
delivery date, 90-day acceptance cutoff, and any refresh/reissue lineage before
the credit migration is implemented.

### Service composition, not duplicate offers

The backend must retain the Custom build ladder and Alakazam while adding these
five lanes:

1. Website Rescue & Tune-Up.
2. Outside Website Management.
3. Business Email & Domain setup, move, and rescue.
4. Website Move / Platform Escape.
5. Local Presence.

Existing components are composed under those lanes rather than renamed and
sold twice. In particular:

- `additional_connection` remains the USD 200 ordinary connect component;
- Website Move composes the existing redirect bands, migration units, build
  tiers, and connections;
- Local Presence cannot charge again for baseline search plumbing already
  included in a Site Sourcery build or Alakazam output;
- a form, interactive tool, hosted provider, static collection, writing,
  revision round, rush window, and migration unit remain existing Custom
  components;
- Outside Website Management and future Site Sourcery Custom Care may share
  an internal engine, but remain separate contracts, prices, risk classes, and
  customer-facing products;
- Alakazam care remains tier-specific and is not a Custom/management SKU;
- the domain storefront registers/renews a name, while email/domain service
  configures, moves, or investigates customer-owned accounts.

### Commercial defaults the catalog must be able to encode

The canonical commercial contract freezes these service prices and boundaries;
the backend catalog must encode them before any public release:

| Lane/component | Working price rule | Hard boundary |
| --- | --- | --- |
| Standard assessment | USD 200 | Bound as stated above; expanded assessment is custom-quoted |
| Rescue labor | USD 125 per internal repair unit; two-unit/USD 250 minimum | Quick finding 1 unit, ordinary finding 2, complex finding 4+; over 8 units requires a custom/rebuild comparison; one shared root cause is charged once |
| Local Presence website foundation | USD 400 | One business/location/site and up to five key pages; no ranking, indexing, traffic, or lead guarantee |
| Google Business Profile setup/cleanup | USD 300 | Ordinary eligible customer-owned profile; customer remains owner and Site Sourcery is manager |
| Combined Local Presence | USD 650 | Website foundation plus ordinary profile setup; add USD 150 per additional five key pages and USD 250 per additional location |
| Email/domain Connect | USD 200 | Reuses `additional_connection`: one customer-owned domain, one ordinary mailbox/provider destination, ordinary DNS verification and mail-authentication records, up to three ordinary mailboxes or aliases, and completion testing; no historic-mail migration, provider subscription, registrar purchase, or access recovery |
| Email/domain Move | From USD 500 | One domain, one source, one destination, and up to three ordinary mailboxes of up to 10 GB each; USD 100 per additional ordinary mailbox up to 10 GB; larger archives, calendars, contacts, shared mailboxes/drives, compliance retention, and unsupported/proprietary systems are custom |
| Email/domain Recover investigation | USD 300 | Paid ownership/access/provider map and written recovery path; recovery execution is separately quoted and never guaranteed |
| Website Move transition base | USD 500 after the paid assessment | Inventory, backup/export attempt, destination preparation, cutover, launch checks, rollback, and handoff; add build, redirect, data, provider, and connection components only where needed |
| Outside management: simple/static | USD 300 paid onboarding, then USD 125/month | Monitoring, backup/check responsibility, ticket access, and monthly receipt; ordinary change labor is not included |
| Outside management: supported CMS | USD 600 paid onboarding, then USD 225/month | Same boundary with the higher takeover/platform risk |
| Outside management: commerce/membership/custom/unknown | Separately quoted onboarding from USD 900; monthly from USD 400 | Case-by-case acceptance; Site Sourcery may refuse unsafe, inaccessible, unsupported, or unmaintainable systems |
| Optional management labor | Two units USD 250/month or four units USD 500/month | Unused included capacity may carry into the immediately following cycle only, then expires; no indefinite rollover |

Assessments/investigations are paid in full before work. Card and Card Plus are
paid in full before work. Site through Scale use 50% before work and 50% on
completion. Other one-time work below USD 1,000 is paid in full; work at or
above USD 1,000 uses 50/50 unless the written quote states a safer milestone
schedule. Monthly services are billed in advance.

Outside-site onboarding is staged: the first USD 200 supportability review is
paid before inspection; a declined site owes no remaining balance; an accepted
site pays the balance to reach its USD 300, USD 600, or separately quoted total
before takeover setup. A current assessment may satisfy overlapping facts, but
the quote must show that scope reuse instead of charging for the same inspection
twice.

For Outside Website Management v1, all plan upgrades, downgrades, and
cancellations take effect at the next renewal boundary, with no mid-cycle
credit/refund or included-unit recomputation. Urgent work before that boundary
is a separately accepted one-time quote. This is simpler and safer than
prorating labor capacity.

No refund is advertised as a product entitlement. The ledger must still
handle legally required or owner-approved refunds, chargebacks, disputes, and
provider reversals defensively and truthfully.

A Site Sourcery Custom build includes a 30-day workmanship correction period
for defects in the agreed work, not free ongoing changes or management. Exact
paid Custom Care plans remain held until separately frozen.

## Exact current reuse map

| Current authority | Exact reuse | Missing boundary / prohibited shortcut |
| --- | --- | --- |
| `auth.users`, `hosted_account_profiles`, password credentials, registration requests, sessions, recovery | Reuse unchanged for customer and operator authentication. Verified registration already creates the user, organization, owner membership, and session atomically. | No operator authorization or MFA exists. Being a normal customer account must never grant owner-workbench access. |
| `organizations` and `organization_memberships` | Reuse as customer/business tenant and customer authorization. Owner/admin may accept commercial scope; billing may pay but must not silently gain content/ownership authority. | There is no structured client/contact profile beyond login email, display name, and organization name. Add contact metadata only when actually needed and encrypt sensitive values. |
| `projects` | Reuse as the one canonical site/work anchor. A Custom or outside-site engagement must point to an existing project rather than create a shadow project. | The row has no site origin, external platform, management eligibility, or takeover state. Add a one-to-one service profile; do not overload Alakazam fields. |
| `legal_documents` and `term_acceptances` | Reuse immutable document/version/digest and signer evidence. | Legal kinds currently stop at product/privacy/website/domain documents. Add explicit Custom-services and management document kinds; quote acceptance needs its own exact acceptance row. Do not reuse old simulated cancellation text. |
| `project_addresses`, address projection, verification requests/attempts | Reuse only when Site Sourcery actually configures or verifies an address. | An outside URL is not automatically a configured project address. Store an observed external hostname in the service profile until authority is granted and verified. |
| `fact_sets`, `site_versions`, artifacts, release/publication tables | Reuse for Abracadabra/Alakazam and any later Custom build path that genuinely produces canonical Site Sourcery artifacts. | `artifacts` is constrained to HTML and is not a report/screenshot/contract vault. Assessment evidence and handoffs need a separate immutable document store. |
| `idempotency_keys` and the `projectWrite` pattern | Reuse for authenticated customer/operator HTTP commands and exact request replay. | The 24-hour HTTP command row is not enough for money or external effects. Quote acceptance, credit application, payment dispatch, handoff, and plan change also need durable semantic unique constraints. |
| `audit_events` and `ss.write_audit_event` | Reuse as the one audit stream; custom commands must write safe action metadata in the same transaction. | The current hash-chain function reads the prior hash without an organization-scoped serialization lock, so concurrent events can fork. Harden it before relying on the chain as tamper-evident owner/payment evidence. Never place secrets or raw private reports in metadata. |
| `transactional_outbox` | Reuse for invoice, assessment-ready, access-needed, job, renewal, and handoff notifications with deterministic dedupe keys. | There is no worker/notification contract for these events yet. A queued row alone is not proof that mail was delivered. |
| `lifecycle_jobs` | Reuse only as a pattern for leases, retries, and machine work. | It is an operational scheduler with a closed `job_type` list, not a client-work job ledger. Do not call it the Custom job backend or mix human checklist state into it. |
| `provider_receipts` | Reuse unchanged for immutable Stripe, email, registrar, storage, and monitoring evidence. | A receipt is evidence, not invoice/payment/business state. New service records must bind exact receipts atomically. |
| `stripe_customers` | Reuse the one Stripe Customer binding per customer organization. | Existing customer provisioning is Alakazam-shaped. Custom payment preparation still needs its own exact reservation/readback contract. |
| legacy `commerce_quotes`, price lines, checkout intents/bindings | Reuse the immutable-quote, disclosure-digest, accepted-snapshot, and server-money **design** only. | These tables are database-constrained to `product_id='spark'`, legacy `rent/own/owned_managed`, a required website address, and source kinds `abracadabra_product/domain`. They cannot represent assessments, repair units, custom lines, installments, provider-direct costs, or management without a dangerous rewrite. Do not widen them in place. |
| Commerce v2 canonicalization, boundary inspection, command claim/replay | Reuse canonical JSON/digest discipline, exact body allowlists, browser-money rejection, and project/customer scoping. | Download and Alakazam catalogs, metadata, prices, entitlements, and provider methods are product-specific. Custom services need separate schemas and metadata, not a fake Download/Alakazam offer. |
| Download/Alakazam dispatch, webhook, readback, receipt, reversal patterns | Reuse the no-retry reservation, webhook-as-wakeup, exact readback, atomic settlement, safe replay, and reconciliation patterns. | Current Stripe methods and tables are hard-bound to Download or Alakazam. Add a narrow service-payment provider port and webhook branch. Never add a `mark paid` button. |
| `support_tickets` and `support_messages` | Reuse as the customer/support conversation record and add links to a service job or management agreement. | Only customer ticket creation is currently exposed. There is no customer list/read/reply, operator assignment/reply/state command, SLA/care accounting, or unit-use link. Intake and findings must not be disguised as support tickets. |
| exports and private object-store patterns | Reuse exact-byte digest, immutable object, one-time authorization, backup, restoration, and worker-fence patterns. | Current export objects are project archive ZIPs. Service reports, screenshots, quote PDFs, and handoffs need their own allowlisted document port and backup inventory. |
| domain quotes, registrations, DNS operations, provider receipts, registrar debits | Reuse exact provider/customer price separation, customer-as-registrant evidence, no-retry operations, DNS types, and provider readback where the existing domain runtime actually owns the registration. | DNS writes require a Site Sourcery-procured `domain_registration`; BYOD/external registrars and mailbox migrations are not represented. Auto-renew, renewal, and transfer remain held. Do not claim the domain storefront completes email/domain service. |
| production readiness, held modes, workers, backup/monitoring | Reuse fail-closed composition and explicit release capabilities. | Readiness currently knows nothing about custom-service tables, documents, payment provider methods, management billing, or the owner workbench. |
| existing tests | Reuse empty-database migration replay, forced-RLS tests, two-tenant denial, HTTP CSRF/idempotency tests, provider fakes, restart/replay tests, real Postgres journeys, Chrome mobile/desktop journeys, and backup/restore proof. | No test currently proves a custom assessment-to-handoff journey or a Mac/Pixel operator journey. |

## Durable gaps

The minimum new durable concepts are:

1. A service catalog policy that can point to existing generic
   `catalog_plans/catalog_prices` for fixed components while supporting
   banded, unit, percentage, recurring, and custom-quoted lines.
2. A one-to-one service profile classifying a project as
   `sitesourcery_custom` or `external`, with observed hostname/platform and
   takeover state. Alakazam remains outside this classification.
3. A structured, account-bound service case/intake that stores customer-stated
   facts without implying an inspection.
4. Paid assessment and onboarding records with exact scope snapshots,
   findings/inventory, evidence documents, and customer work selections.
5. Access requests that record requested delegated role, customer response,
   and operator verification—but have no credential-value column.
6. Immutable quote revisions, normalized quote lines, overlap coverage keys,
   payment schedule, exact disclosure digests, and account-bound acceptance.
7. Local invoices, invoice lines, provider dispatches, verified events,
   payment receipts/allocations, provider-cost records, and a reconciliation
   queue.
8. A service-credit grant/application ledger with one-use eligibility and
   reversal fencing.
9. Human work jobs, job items, checklists, evidence, completion, and handoff.
10. Paid outside-site onboarding and recurring management agreements, plan
    revisions, billing periods, included-unit usage, renewal-boundary changes,
    monthly receipts, and support links.
11. A separately authorized operator identity/permission boundary plus
    customer and owner read projections that work from Mac and Pixel.
12. Terminal-purge, accounting-retention, private-document backup, restore,
    monitoring, and readiness coverage for every new record.

## Proposed additive migration sequence

Names are proposals. Numbers start after the protected migration 33 and must
not be claimed until Batch 3C is sealed. Each slice must add forced RLS,
privilege revocation, invariants, terminal-state guards, structural tests, and
a `hosted_runtime_contract_vNN()` marker before the next slice begins.

### 034 — custom-services foundation

Proposed file:
`202608050034_custom_services_foundation.sql`

Add:

- `ss.service_catalog_policies`: immutable/versioned service keys, display
  identity, pricing mode, billing cadence, optional generic plan/price link,
  scope boundary digest, active window, and publication state;
- `ss.service_catalog_coverage`: normalized reusable coverage keys such as
  `site_inventory`, `backup_baseline`, `dns_connection`, `redirect_plan`,
  `search_foundation`, `business_profile_intake`, and `launch_checks`;
- `ss.service_project_profiles`: one row per Custom/external project with
  origin, observed hostname, platform family, takeover requirement/state,
  supportability state, revision, and timestamps;
- `ss.service_cases` and `ss.service_case_offerings`: one account/project-bound
  commercial case with one or more selected service keys; stacking is explicit
  instead of encoded as duplicate SKUs;
- `ss.service_intakes`: bounded customer-stated facts, source, revision, and
  submission state; no diagnosis fields;
- `ss.service_documents`: immutable metadata for report, screenshot, quote,
  invoice, checklist evidence, and handoff objects—object key, SHA-256, media
  type, byte count, visibility, and retention class;
- `ss.service_access_requests`: provider/account label, delegated role needed,
  reason, due state, customer confirmation, operator verification, and
  expiration. Explicit database checks forbid a credential payload;
- `ss.operator_profiles` and `ss.operator_permissions`: service-role-only
  mapping from a first-party user to bounded operator capabilities and state;
- explicit `custom_services` and `outside_management` legal-document kinds.

Foundation invariants:

- one service profile per project;
- an `external` profile always requires paid takeover before management;
- no customer can read another organization, and no customer role can select
  operator tables;
- observed external hostname does not create address/DNS authority;
- catalog keys are unique per catalog version and cannot silently change a
  price/scope snapshot;
- no service case is payable without an activated account/organization.

### 035 — fixed quotes, overlap control, and acceptance

Proposed file:
`202608050035_custom_service_quotes.sql`

Add:

- `ss.service_quotes`: stable envelope, project/case owner, purpose
  (`assessment`, `onboarding`, `selected_work`, `custom_build`, `management`,
  or `change_order`), current revision, and state;
- `ss.service_quote_revisions`: immutable issued snapshot with catalog/terms
  versions, gross service amount, direct-provider amount, credit eligibility,
  payment schedule, assumptions, exclusions, issue/expiry, disclosure JSON,
  disclosure digest, and complete snapshot digest;
- `ss.service_quote_lines`: normalized component key, quantity, unit, unit
  amount, customer amount, line category (`service`, `provider_direct`,
  `provider_advanced`, or `informational`), custom-price reason where allowed,
  and scope digest;
- `ss.service_quote_line_coverages`: each delivered coverage key and scope
  identity, with a unique quote-revision guard so the same work cannot be
  charged twice;
- `ss.service_quote_installments`: full/start/balance/milestone/recurring
  schedule, amount, trigger, and order;
- `ss.service_quote_acceptances`: exact revision/snapshot/disclosure/legal
  document, accepting account user, authorized organization role, request/IP/
  user-agent evidence, and acceptance time;
- `ss.service_quote_finding_links`: optional links from a later selected
  finding/root-cause group to the exact repair line that prices it.

Quote invariants:

- only an operator command can author or issue money;
- customer bodies contain only route IDs, accepted digests, and an explicit
  acceptance statement—never amount, units, credit, provider, tax, or state;
- only one issued revision can be current; revision replaces rather than
  mutates an offered quote;
- acceptance requires an active verified account, active organization,
  authorized membership, unexpired current revision, and exact digests;
- `provider_direct` lines are disclosed but excluded from Site Sourcery amount
  due; an advanced provider cost is a separate line and any handling fee is a
  separate named service line;
- coverage collisions fail the composer unless one line is explicitly
  zero-priced as “included above”; no hidden duplicate charge;
- Card/Card Plus/full, Site-through-Scale 50/50, and assessment/onboarding
  payment schedules are validated server-side.

### 036 — invoices, payments, provider costs, and credits

Proposed file:
`202608050036_custom_service_payments.sql`

Add:

- `ss.service_invoices` and `ss.service_invoice_lines`: local invoice number,
  accepted quote revision, installment, immutable amounts, due state, balance,
  issue/due timestamps, and customer-safe digest;
- `ss.service_provider_costs`: provider, billing owner
  (`customer_direct`/`sitesourcery_advanced`), quoted/exact cost, currency,
  receipt link, and reconciliation state;
- `ss.service_payment_dispatches`: one exact invoice-purpose reservation,
  Stripe Customer binding, lease/fence, idempotency key, request digest,
  Checkout destination evidence, and no-effect/ambiguous state;
- `ss.service_stripe_events`: verified-event evidence and processing state in a
  custom-service metadata namespace;
- `ss.service_payment_receipts` and `ss.service_payment_allocations`: exact
  provider readback, subtotal/tax/total/currency, invoice allocation, settled
  time, and reversal state;
- `ss.service_credit_grants` and `ss.service_credit_applications`: source
  assessment/payment/delivery, USD 200 maximum, same-org/project/build scope,
  governing contract digest, delivery date, 90-day acceptance cutoff,
  refresh/reissue lineage, reservation/application/release/reversal state, and
  one-use uniqueness;
- `ss.service_payment_reconciliation`: owner-only queue for ambiguous effects,
  mismatched readback, reversals, and provider-cost evidence.

Payment invariants:

- a local invoice derives only from an accepted quote revision/installment;
- a payment command derives money from the invoice and never the browser;
- one Stripe Customer per organization is reused;
- reservation commits before Stripe, webhook is only a wake-up signal, exact
  provider readback precedes one atomic local settlement, and ambiguous effects
  never retry automatically;
- no owner `mark paid` command exists in v1. Any future offline-payment path
  requires a separate evidence contract and redline;
- assessment credit cannot exist until the assessment invoice is settled and
  the assessment is delivered; a deferred trigger verifies both;
- credit application is serialized per grant and invoice, excludes provider
  costs, cannot exceed the eligible first installment, and requires Custom
  quote acceptance by the grant's cutoff unless a valid refresh/reissue
  supersedes it without increasing the one-use USD 200 total;
- refunds/disputes/reversals append evidence and adjust availability without
  deleting the original payment.

This slice requires a new narrow provider port—for example
`createServiceCheckout`, `retrieveServicePayment`, and reversal readback—and a
separate held-by-default production configuration. Existing Download and
Alakazam provider methods stay unchanged.

### 037 — assessments, findings, selections, and paid takeover

Proposed file:
`202608050037_custom_service_assessment_onboarding.sql`

Add:

- `ss.service_assessments`: standard/expanded kind, exact paid invoice line,
  scope snapshot, state, started/delivered time, report document, and freshness
  date;
- `ss.service_assessment_targets`: normalized public URL/page-type target and
  desktop/phone coverage;
- `ss.service_findings`: priority/severity/category, customer-safe summary,
  detailed recommendation, repair-unit classification, shared-root-cause key,
  evidence document, and state;
- `ss.service_work_selections`: immutable customer selection revision and
  digest;
- `ss.service_work_selection_items`: selected finding/root-cause identities;
- `ss.service_onboardings`: staged paid outside-site takeover, platform/risk
  class, quoted total, exact USD 200 review invoice line, remaining-balance
  invoice line when accepted, stage, access readiness, inventory/backup/check
  evidence, supportability decision, accepted responsibilities, and
  completion/decline facts;
- `ss.service_onboarding_inventory`: pages, platform/plugins/integrations,
  domain/DNS/mail ownership observations, provider billing owner, and rollback
  facts, with no credentials.

Assessment/onboarding invariants:

- standard assessment cannot start before its USD 200 invoice is paid;
- standard assessment permits at most five target pages/page types and ten
  findings; expanded work requires an expanded quote rather than a flag flip;
- repair units and root-cause grouping are operator-authored evidence, not
  customer price input;
- customer selection names finding IDs only; quote composition calculates the
  price and shared-root dedupe;
- no supportability inspection begins until the exact USD 200 first-stage
  invoice settles; a decline delivers its written result and makes the
  remaining balance and recurring charge ineligible;
- an accepted site must settle the remaining onboarding balance before
  delegated-access establishment, baseline setup, or management activation;
- no outside management agreement or recurring Checkout can exist until paid
  onboarding is completed, required access is verified, baseline/rollback
  evidence exists where possible, and Site Sourcery explicitly accepts the
  platform;
- declining an unsupported takeover does not create a recurring charge or a
  false promise of management.

### 038 — human jobs, checklist, completion, and handoff

Proposed file:
`202608050038_custom_service_jobs.sql`

Add:

- `ss.service_jobs`: accepted quote/invoice basis, kind, customer/project,
  state, start gate, owner assignment, target dates, and revision;
- `ss.service_job_items`: exact quote line/finding/root-cause work and
  acceptance criteria;
- `ss.service_job_checklist_items`: ordered customer/owner/system tasks,
  dependencies, state, completion actor/time, and evidence requirement;
- `ss.service_job_events`: append-only state history and reason codes;
- `ss.service_deliverables`: immutable document/release/provider evidence,
  customer visibility, acceptance state, and delivery receipt;
- `ss.service_handoffs`: completed scope digest, final-payment state, account/
  domain/provider ownership statement, rollback/export receipt, ownership
  transfer time, and 30-day workmanship-correction end date;
- `ss.service_change_orders`: a link to a new quote rather than mutation of an
  active job.

Job invariants:

- required start payment and access/checklist prerequisites gate `ready` and
  `in_progress`;
- work outside the accepted digest is a change order, never a silent line edit;
- “work complete” and “handed off/ownership transferred” are separate states;
  final payment and required deliverables gate handoff;
- completion evidence is immutable; correction work references the original
  handoff and cannot become free ongoing management;
- no machine scheduler row is presented as a human job.

### 039 — outside management and support accounting

Proposed file:
`202608050039_outside_site_management.sql`

Add:

- `ss.service_management_agreements`: separate `outside_management` and future
  `custom_care` kinds, exact project/profile/onboarding, active plan revision,
  billing owner, state, current period, and cancellation boundary;
- `ss.service_management_plan_revisions`: immutable plan, monthly amount,
  included units, responsibilities, exclusions, response wording, effective
  period, and provider binding;
- `ss.service_management_change_requests`: requested target plan/state,
  accepted digest, request time, and renewal-boundary effective time;
- `ss.service_management_periods`: billed period, invoice/payment receipt,
  included units, used units, eligible carry-in from the immediately previous
  period, expiring units, monthly check/receipt, and state;
- `ss.service_unit_usage`: job/ticket/finding basis, units, operator evidence,
  period allocation, and customer-visible explanation;
- `ss.service_support_links`: link existing support tickets to a service job,
  onboarding, or management agreement without replacing ticket/message tables;
- operator assignment, reply, and state-event support additions while keeping
  existing customer ticket identity.

Management invariants:

- outside management requires the exact completed paid onboarding for the same
  external project;
- recurring billing is separate from Alakazam and legacy
  `stripe_subscriptions`, whose one-project constraints and product semantics
  cannot be reused;
- monthly plan changes take effect at the next renewal boundary; no mid-cycle
  refund, credit, proration, or unit rewrite;
- unused included capacity may carry into the immediately following paid
  period only; carried capacity expires at that period's close and can never
  cascade into a third period. Overage/urgent work requires a separately
  accepted one-time quote;
- provider subscriptions and provider costs remain separate;
- a support message cannot consume units by itself. An audited operator usage
  command must link the approved work and evidence.

### 040 — projections, retention, reconciliation, and runtime seal

Proposed file:
`202608050040_custom_services_runtime_seal.sql`

Complete:

- customer and operator read projections described below;
- operator work/reconciliation queue indexes;
- organization-scoped audit-chain serialization or an equivalent append proof;
- terminal-purge activation, exact removal counts, and retained financial/legal
  evidence rules for every `service_*` table;
- private service-document object deletion/retention jobs;
- backup manifest, clean-room restore, monitor, readiness, and alert checks;
- hosted runtime v40 readiness markers and structural migration tests.

Financial receipts, invoices, accepted quote/terms, provider-cost evidence, and
required accounting/audit records must follow a written retention policy and
must not disappear through a casual `ON DELETE CASCADE`. Customer-uploaded
materials, access-request details, private reports, and working documents must
be purgeable. The project tombstone records exact removed/retained counts.

## Route and service boundaries

All writes keep the existing same-origin CSRF and `Idempotency-Key` gates.
Customer routes require an authenticated session and exact organization/project
membership. Operator routes require a separate active operator permission and
recent reauthentication; payment, credit, handoff, access verification, and
plan-change commands should require MFA before the Pixel-accessible workbench
is released outside a private network.

### Customer/account routes

| Route | Service command/read | Accepted authority |
| --- | --- | --- |
| `GET /api/v1/service-catalog` | `getServiceCatalog` | Customer-safe released catalog only; no held prices/promises |
| `POST /api/v1/organizations/{organizationId}/service-projects` | `createServiceProject` | Name, observed hostname/platform statement, and origin selection; server creates canonical project/profile |
| `POST /api/v1/projects/{projectId}/service-cases` | `submitServiceIntake` | Selected service keys and customer-stated facts only |
| `GET /api/v1/projects/{projectId}/services` | `getCustomerServiceAccount` | One bounded customer projection |
| `GET /api/v1/projects/{projectId}/service-quotes/{quoteId}` | `getServiceQuote` | Exact current customer-safe quote revision |
| `POST /api/v1/projects/{projectId}/service-quotes/{quoteId}/acceptance` | `acceptServiceQuote` | Accepted snapshot/disclosure/legal digests and statement only |
| `GET /api/v1/projects/{projectId}/service-invoices/{invoiceId}` | `getServiceInvoice` | Local invoice, credit, balance, due state, and safe receipts |
| `POST /api/v1/projects/{projectId}/service-invoices/{invoiceId}/checkout-command` | `createServiceInvoiceCheckout` | Accepted invoice digest only; no money/provider fields |
| `GET /api/v1/projects/{projectId}/assessments/{assessmentId}` | `getAssessment` | Scope, state, report, customer-safe findings, credit state |
| `POST /api/v1/projects/{projectId}/assessments/{assessmentId}/work-selections` | `selectAssessmentWork` | Finding IDs and current assessment/selection digest only |
| `POST /api/v1/projects/{projectId}/access-requests/{requestId}/confirmation` | `confirmAccessRequest` | “Invitation sent/access granted/cannot grant” plus safe note; never credentials |
| `GET /api/v1/projects/{projectId}/service-jobs/{jobId}` | `getServiceJob` | Status, customer tasks, checklist summary, deliverables, payment/handoff state |
| `GET /api/v1/projects/{projectId}/management` | `getManagementAccount` | Current plan/period, included and used units, pending change, next renewal, monthly receipts |
| `POST /api/v1/projects/{projectId}/management/change-requests` | `requestManagementChange` | Target released plan/cancel intent plus accepted consequences digest |
| existing project support routes plus list/read/reply additions | `open/read/replySupportTicket` | Customer content; no unit or billing authority |

No route accepts `amount`, `amountMinor`, `price`, `currency`, `repairUnits`,
`credit`, `providerCost`, Stripe/provider IDs, invoice state, job state,
entitlement, password, token, secret, or access credential from a customer.

### Operator Mac/Pixel routes

| Route | Bounded operation |
| --- | --- |
| `GET /api/v1/operator/clients?query=` | Search authorized client projection by account email/name, organization, project, safe hostname, invoice number, or receipt reference |
| `GET /api/v1/operator/clients/{organizationId}` | One client/account/project/payment/tier/ticket/services view with no credentials |
| `GET /api/v1/operator/work-queue` | Assessments, onboarding, access, invoices, jobs, management checks, support, and reconciliation needing action |
| `POST /api/v1/operator/projects/{projectId}/service-quotes` | Create draft quote from catalog/components and explicit custom-line reasons |
| `POST /api/v1/operator/service-quotes/{quoteId}/revisions` | Replace—not mutate—the commercial snapshot |
| `POST /api/v1/operator/service-quotes/{quoteId}/issue` | Issue exact revision after overlap/payment checks |
| `POST /api/v1/operator/service-invoices` | Issue only an accepted quote installment; no arbitrary receivable |
| `POST /api/v1/operator/assessments/{assessmentId}/findings` | Record bounded finding, unit class, root cause, and evidence |
| `POST /api/v1/operator/assessments/{assessmentId}/deliver` | Freeze/deliver report after cap/scope proof |
| `POST /api/v1/operator/onboardings/{onboardingId}/transitions` | Advance paid takeover stages and supportability decision |
| `POST /api/v1/operator/access-requests/{requestId}/verify` | Verify delegated access without recording the credential |
| `POST /api/v1/operator/service-jobs/{jobId}/checklist-events` | Complete/reopen a bounded item with evidence and reason |
| `POST /api/v1/operator/service-jobs/{jobId}/completion` | Freeze completed-work digest; does not transfer ownership |
| `POST /api/v1/operator/service-jobs/{jobId}/handoff` | Handoff only after exact final-payment and deliverable proof |
| `POST /api/v1/operator/management/{agreementId}/plan-revisions` | Issue a renewal-boundary plan change; no casual proration |
| `POST /api/v1/operator/support/{ticketId}/messages` and `/state-events` | Audited support reply/state handling |
| `POST /api/v1/operator/reconciliation/{itemId}/decisions` | Narrow evidence-bound reconciliation; never “make it green” |

Operator commands run behind an application service that establishes operator
identity first, then uses the service-role transaction only for the exact
authorized tenant/project. A hidden membership in every customer organization
is not an acceptable operator model.

### Provider/worker services

- `servicePaymentDispatcher`: reserve once, create one Checkout, persist one
  destination, and stop on ambiguity.
- `servicePaymentSettlement`: accept a verified webhook as wake-up only,
  retrieve exact provider payment, and atomically settle receipt/invoice/credit
  or recurring period.
- `serviceDocumentWorker`: write and read back exact immutable report/handoff
  bytes; mail contains a time-bounded same-origin link, not an attachment as
  sole authority.
- `serviceNotificationWorker`: outbox-driven, provider-receipted notices for
  quote, invoice, assessment, access, job, handoff, and renewal.
- `serviceManagementWorker`: generate the next advance invoice/period,
  schedule renewal-boundary changes, run bounded checks, and stop in
  reconciliation on uncertain provider effects.
- `serviceRetentionWorker`: purge expired private service documents while
  preserving required accounting/legal evidence and recording exact results.

## Customer and owner read projections

### `sitesourcery.custom-services-account/v1`

One project-scoped customer response should contain:

- safe project/service profile and observed/verified website distinction;
- cases and intake status;
- assessment/onboarding scope, status, report, findings, and selected work;
- current quote revision, acceptance state, assumptions/exclusions, lines,
  installments, and overlap explanations;
- invoices, balance/due state, payment receipts, provider-direct disclosures,
  and assessment credit grant/application;
- job state, customer-needed checklist items, deliverables, completion, and
  handoff;
- management plan/current period, included/used/carried/expiring units,
  pending change, next renewal, monthly checks/receipts, and linked support
  tickets;
- server-computed action flags such as `acceptQuote`, `payInvoice`,
  `selectFindings`, `confirmAccess`, `requestPlanChange`, and `openSupport`.

It must exclude operator notes, internal margin/cost except customer-disclosed
provider costs, provider IDs, worker leases, raw failures, reconciliation
details, other tenants, credentials, report object keys, and private audit
metadata.

### `sitesourcery.operator-client-workbench/v1`

The Mac/Pixel projection should combine—not rederive—the existing account,
organization, project, Download/Alakazam, address/domain, support, and new
service authorities. It needs:

- verified account and organization identity;
- all customer projects and safe live/observed hostnames;
- Download/Alakazam tier/payment/publication summary from their existing read
  models;
- service cases, assessments, onboarding, access needs, quotes, invoices,
  credits, jobs, handoffs, management periods/usage, and tickets;
- provider-effect certainty and reconciliation state without secrets;
- next bounded owner action and why it is available or blocked.

Mac and Pixel use the same API and responsive web app. There is no field-device
shadow database. High-sensitivity reads and every mutation are audit logged.

### `sitesourcery.operator-work-queue/v1`

Queue items must carry organization/project/case identity, kind, severity,
due/age, safe summary, and exact next route. The queue is a projection of
durable state, not a mutable checklist that can drift from invoices/jobs.

## Overlap and stacking rules

The quote composer must calculate coverage, not merely add cards together.

Examples:

- Assessment diagnoses; Rescue fixes. They stack, but the assessment is not
  charged again as a Rescue “fit check.”
- Two broken pages caused by one template defect share one root-cause charge;
  separate causes may price separately.
- Website Move charges one `site_inventory`, one `backup_baseline`, one
  `redirect_plan`, and one `launch_checks` coverage. A build tier, redirect
  band, migration unit, or connection adds only its non-overlapping coverage.
- Email/domain Connect reuses `additional_connection`; the quote does not add a
  renamed “DNS setup” line for the same five changes.
- Local Presence on a Site Sourcery build does not rebill included sitemap,
  canonical, robots, and baseline search plumbing. Google Business Profile,
  extra locations, and expanded external-site cleanup can remain separate.
- Outside management onboarding may reuse a recent paid assessment document,
  but takeover inventory/access/backup/risk acceptance remains paid onboarding
  work. Reuse reduces duplicated tasks; it does not turn outside takeover into
  a free inspection.
- Custom Care and Outside Management can reuse monitoring/ticket/unit tables,
  but their quote keys and responsibilities cannot collide.

The normalized quote coverage table should reject a duplicate coverage key for
the same scoped asset/location/mailbox/root cause unless one row explicitly
references the first as included at zero additional charge.

## Test journeys required before implementation can be called usable

### 1. Account and tenant gate

- An unverified or signed-out client can browse released public information but
  cannot create/accept a payable quote or start Checkout.
- Verified registration creates exactly one account, organization, membership,
  and session; replay creates no duplicate.
- Two organizations with similar project/site names cannot read or mutate each
  other's case, assessment, finding, quote, invoice, credit, job, document,
  access request, management agreement, or ticket.

### 2. Standard paid assessment

- Account -> project/profile -> intake -> exact USD 200 quote -> account-bound
  acceptance -> invoice -> one provider Checkout -> verified readback -> one
  receipt -> assessment opened.
- Restart and duplicate webhook replay return the same result without another
  Checkout, receipt, invoice, or assessment.
- A sixth standard target and eleventh standard finding fail at the database
  boundary. Expanded work requires a new expanded quote.
- Desktop/phone evidence and the immutable report deliver successfully; only
  then does one USD 200 build credit become available.

### 3. Finding selection and Rescue

- Customer sends finding IDs only. Server groups shared root causes, enforces
  the two-unit minimum, calculates USD 125 units, and issues one fixed quote.
- Same-template two-page damage is not charged twice for one root repair.
- More than eight units forces a custom/rebuild comparison rather than an
  automatic oversized tune-up.
- A precise customer-instructed mechanical edit can be directly quoted, but no
  operator inspection/diagnosis occurs before paid scope.

### 4. Assessment build credit

- A delivered/paid assessment followed by Card produces USD 200 remaining;
  Card Plus produces USD 450 remaining.
- A USD 1,200 Site uses the credit toward the 50% start threshold, requires USD
  400 additional before work, and USD 600 on completion.
- Cross-project, cross-organization, second-use, cash, Rescue, management,
  Alakazam, and provider-cost applications fail.
- A build accepted inside the 90-day window can reserve the credit. Outside
  that window the lapsed grant fails closed until any required paid refresh
  reissues the same one-use USD 200 eligibility; changing a date or refreshing
  cannot mint a second credit.
- Reversal/dispute and simultaneous quote acceptance cannot double-apply the
  credit.

### 5. Invoice, installment, and job gates

- Under-USD-1,000/full-payment jobs cannot start until paid. Site-through-Scale
  jobs can start after the exact required starting value; handoff/ownership
  cannot occur before final payment.
- Browser amounts and owner attempts to casually mark paid are rejected.
- Provider ambiguity creates one reconciliation item and no automatic retry.
- A change in scope creates a new quote/change order; prior quote/invoice/job
  evidence remains immutable.

### 6. Paid outside-site onboarding and management

- No supportability inspection occurs before the first USD 200 review invoice
  settles. If the site is declined, the written result is delivered and no
  balance or recurring invoice is created.
- If accepted, no delegated-access establishment, baseline setup, monitoring,
  backup claim, or recurring payment occurs until the remaining onboarding
  balance settles. A current assessment can satisfy named overlapping facts
  without producing a second cash credit or duplicate inspection charge.
- Access requests ask for delegated invitations and contain no password/token
  path. A malicious nested secret field fails before persistence.
- Unsupported/insecure/inaccessible platforms can be declined after paid
  onboarding without creating a monthly agreement.
- Supported takeover requires inventory, access verification, baseline and
  rollback evidence where possible, and an accepted responsibility digest.
- Monthly billing is in advance. Plan changes/cancellation become effective at
  renewal with no mid-cycle refund/proration/unit rewrite. Unused capacity can
  carry into the immediately following paid period only; tests expire that
  carry before a third period. Extra work uses a separate quote.

### 7. Email/domain service

- Connect uses the existing USD 200 component exactly once for one domain,
  one ordinary destination, and up to three ordinary mailboxes or aliases;
  historic-mail migration, provider subscription, registrar purchase, and
  access recovery fail outside that scope.
- Move includes one source/destination and three mailboxes up to 10 GB each,
  then prices each additional ordinary mailbox up to 10 GB once; larger or
  complex archives/calendars/contacts/shared mailboxes fail into custom scope.
- Recover charges the investigation before provider/ownership diagnosis;
  execution remains separately quoted and cannot promise success/timing.
- Customer-direct provider charges are disclosed but excluded from Site
  Sourcery invoice totals. Advanced costs and handling appear as separate
  lines with receipts.
- Existing domain registration/DNS authority is used only for registrations it
  actually controls; an external registrar is never falsely projected as a
  Site Sourcery domain registration.

### 8. Website Move and Local Presence overlap

- A move composes assessment, transition base, build, redirect, migration, and
  connection components without duplicate inventory/backup/DNS/launch lines.
- Rollback and handoff checklist evidence is required before completion.
- A Site Sourcery-built site cannot be charged for baseline search plumbing
  twice. External cleanup, Google Business Profile, additional locations, and
  expanded page sets price separately.
- Customer owns Search Console/Business Profile; Site Sourcery manager access
  is recorded without credentials. No ranking/indexing/lead guarantee appears
  in quote or projection.

### 9. Support and unit accounting

- Customer and operator can read/reply to the same tenant/project ticket.
- Operator assignment and state changes are audited.
- Linking work to management units requires an explicit usage command and
  evidence; messages alone cannot consume units.
- Concurrent unit allocation cannot exceed the active period allowance.

### 10. Owner Mac/Pixel workbench

- Customer credentials cannot enter operator routes; customer accounts receive
  opaque denial.
- Active operator permission, recent reauthentication, CSRF, idempotency, and
  MFA/release mode gate sensitive commands.
- Client search and every required assessment/quote/invoice/job/management/
  ticket action work at desktop and Pixel widths without exposing provider IDs
  or secrets.
- A late response for one client cannot replace the newly selected client.

### 11. Retention, backup, and recovery

- Terminal purge deletes private working documents/access details and records
  exact counts while preserving only approved financial/legal/accounting
  evidence.
- Service document objects and database rows restore together; digest mismatch
  fails closed.
- Monitoring detects stuck payment dispatch, overdue access, failed document
  delivery, job blockage, management renewal failure, and reconciliation age.
- Clean-room restore proves customer and operator projections without making a
  provider call.

### 12. Public-polish release gate

- Customer-facing cards, prices, terms, FAQs, account actions, and legal copy
  are updated only after their matching fresh-Postgres and browser journeys
  pass.
- Held catalog entries never render as sellable actions.
- One full customer walk and one Mac/Pixel owner walk prove every public
  promise before production cutover.

## Risk order

### P0 — fix/freeze before any custom payment code

1. **Assessment money authority conflicts today.**
   `data/public-catalog.json` says `priceCents: 20000` but still permits
   `buildCredit.maximumCents: 35000`; `scripts/check-pricing.mjs` explicitly
   requires the obsolete USD 350 assessment. If reused blindly, the system can
   charge USD 200 while granting USD 350, fail its own catalog gate, or let two
   surfaces disagree. Freeze USD 200/USD 200 and regenerate every derived
   digest/check before seeding backend authority.
2. **The generic-looking quote/payment path is not generic.** It is
   database-bound to old Spark tenure/address semantics. Widening it risks
   corrupting existing Download/Alakazam/domain evidence and resurrecting
   retired offers. Build additive `service_*` commerce.
3. **There is no operator authorization boundary.** A Pixel-accessible
   cross-tenant workbench cannot be built on raw service-role access or hidden
   customer memberships. Operator permission, recent reauthentication, MFA,
   bounded commands, and audited reads precede release.
4. **There is no custom invoice/payment/job authority.** Public copy must stay
   inquiry-only until provider-confirmed payment, start gates, completion, and
   handoff agree.
5. **Batch 3C is unfinished and owns migration 33/shared repository files.** Do
   not start migration 34 or shared composition until Batch 3C is sealed and
   its worktree ownership is clear.

### P1 — close before owner/customer staging

1. Serialize the audit hash chain under concurrent organization writes.
2. Define financial/legal retention versus private-document purge before
   adding cascades.
3. Build provider-cost separation so customer-direct costs, advanced costs,
   handling, and Site Sourcery revenue never collapse into one number.
4. Prove access requests cannot store credentials, including nested payloads,
   documents, logs, and audit metadata.
5. Add semantic uniqueness in addition to 24-hour HTTP idempotency for quote
   acceptance, credit application, payment effects, handoff, and recurring
   plan changes.
6. Keep outside management, future Custom Care, and Alakazam care separate at
   the catalog/contract layer even if they share tables.

### P2 — close before public polish/cutover

1. Reconcile public copy/legal text with the exact released catalog and remove
   every held/direct-payment shortcut.
2. Prove responsive customer and owner journeys, accessibility, stale-response
   rejection, and safe failure language.
3. Extend backup, restore, monitoring, alerts, and runbooks to service
   documents, payment reconciliation, and management periods.
4. Integrate the same bounded projections into Fantasealand Desiderata Labs HQ
   only after Site Sourcery operates independently; HQ is a later consumer,
   not a second authority.

## Build-lane handoff to the lead

The first implementation checkpoint should be migration 034 plus its structural
and two-tenant tests only, after Batch 3C is sealed. The next vertical proof is
not all five public cards; it is one complete paid standard-assessment journey
through quote, acceptance, invoice, provider-confirmed payment, bounded
findings, report delivery, and exact USD 200 build credit. That journey proves
the shared commercial spine. Rescue, Custom builds, onboarding, management,
email/domain, Website Move, and Local Presence then compose it without creating
new payment or customer authorities.

The Polish lane may prepare a private copy matrix and responsive shells in
parallel, but sellable public copy and controls remain held until the Build lane
provides the matching durable projection and test evidence.
