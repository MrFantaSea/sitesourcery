# Site Sourcery 100 percent completion matrix — 2026-08-06

Generated at: 2026-08-06T18:41:36-0400 (EDT)

Repository snapshot:

- Branch: build/sitesourcery-v2-20260730
- HEAD: c4277ceffc66186e9f3b7fd7aa64467966a15ccf
- Roadmap reviewed completely: ops/SITESOURCERY-MULTI-AGENT-ROADMAP-2026-08-04.md, 921 lines
- Active ledger reviewed completely: ops/SITESOURCERY-ACTIVE-RUN.md, 1,437 lines
- Package gates reviewed: package.json and server/data-plane/package.json
- The H1M backend/Abracadabra/browser checkpoint is sealed at HEAD. The remaining mixed worktree contains owner-lane Custom, Domains, Responder, Work and vnext.css changes plus untracked coordination documents. This matrix does not treat those dirty public/aesthetic files or stale prose as completed proof.

## Authority, status, and percentage rules

This matrix is the deterministic source for completion reporting. It covers all
136 checkbox requirements in the canonical roadmap and adds explicit rows for
the current H1M seal, the ordered two-purpose H1N finish line, owner-directed
public-page corrections, release/public-truth architecture addenda, and
Responder telephony expansion.

Status meanings:

- DONE — matching authority exists in current code, maintained proof exists,
  and the implementation is in a sealed commit or otherwise has current,
  non-contradicted completion evidence.
- PARTIAL — some matching code or proof exists, but the exact requirement is
  incomplete, dirty, unsealed, stale, or lacks an end-to-end release gate.
- NOT STARTED — no authoritative implementation and proof for the requirement
  was found. Reusable primitives do not change this status.
- EXTERNAL BLOCKER — the remaining outcome depends on an outside party or
  external system and no internal implementation work can resolve that fact.
- DEFERRED — deliberately outside both active finish-line denominators until a
  dated owner ruling promotes it. A public promise automatically promotes its
  matching row to CORE LAUNCH.

Evidence policy:

1. Roadmap or ledger prose alone is not proof.
2. DONE requires current source plus a maintained test/proof location and a
   sealed history checkpoint, unless the requirement is purely a durable policy.
3. Current dirty implementation with tests is at most PARTIAL until its fresh
   proof and independent recheck are recorded.
4. H1M is DONE because commit c4277ce seals its exact source and tests,
   ops/SITESOURCERY-ACTIVE-RUN.md:1293-1381 records the corrected clean-room,
   decoder, dependency, browser and uninterrupted release evidence, and lines
   1295-1301 record the fresh independent `BLOCKER: NO`. This H1M seal does not
   prove or upgrade either H1N financial purpose.
5. No historical browser, PostgreSQL, staging, or broad-suite result proves
   later uncommitted source. Current release proof is tracked separately below.
6. A cited contradictory checker, unsafe script, active held-offer claim or
   omitted release gate is defect evidence only. It can justify PARTIAL or NOT
   STARTED, never DONE or release readiness.

Deterministic formulas:

- Core Launch percent =
  100 × CORE DONE / (CORE DONE + CORE PARTIAL + CORE NOT STARTED +
  CORE EXTERNAL BLOCKER).
- Expansion percent =
  100 × EXPANSION DONE / (EXPANSION DONE + EXPANSION PARTIAL +
  EXPANSION NOT STARTED + EXPANSION EXTERNAL BLOCKER).
- DEFERRED rows are listed but excluded from both denominators.
- Percentages are rounded to one decimal place only after applying the formula.
- PARTIAL earns zero completion credit. This is intentionally strict.

Strict 100 percent rule:

Core Launch is 100 percent only when every non-deferred Core row is DONE, the
worktree used for release proof is explained and sealed, every public sellable
promise passes its authenticated end-to-end journey, every unavailable offer is
visibly held, the complete Node 24 and clean-room PostgreSQL gates pass against
that exact source, authenticated desktop/mobile/accessibility/security/staging
proof passes, provider test/live readiness is reviewed, and cutover plus
rollback are verified. Expansion reaches 100 percent only when every
non-deferred Expansion row is DONE. An Expansion external blocker never lowers
Core Launch when its public offer is truthfully held and non-sellable.

## Derived snapshot

Counts and percentages are filled from the rows below and rechecked at the end
of this file.

| Finish line | DONE | PARTIAL | NOT STARTED | EXTERNAL BLOCKER | Denominator | Percent |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| CORE LAUNCH | 64 | 44 | 28 | 0 | 136 | 47.1% |
| EXPANSION | 1 | 8 | 14 | 1 | 24 | 4.2% |
| DEFERRED inventory (5 rows) | 0 | 0 | 0 | 0 | excluded | n/a |

## CORE LAUNCH matrix

### Lane A — customer billing truth and API

| ID | Requirement | Owner lane | Status | Exact proof location | Next action |
| --- | --- | --- | --- | --- | --- |
| A-01 | One bounded customer-safe subscription projection | Build | DONE | server/commerce-v2/alakazam-account.mjs:829-872; server/hosted/alakazam-postgres.mjs:5764; server/hosted/test/alakazam-account-postgres.test.mjs; commit 671e094 | Preserve contract while adding later reads. |
| A-02 | Read tier, status, paid period, renewal, pending change, cancellation and receipts from PostgreSQL | Build | DONE | server/hosted/alakazam-postgres.mjs:5764-6020; server/data-plane/tests/alakazam-postgres-contract.integration.test.mjs; commit 671e094 | Keep projection tests current through lifecycle work. |
| A-03 | Customer Alakazam invoice retrieval | Build | NOT STARTED | Roadmap:112-114; current projection only exposes invoiceAvailable at server/hosted/alakazam-postgres.mjs:4857-4859; no Alakazam invoice retrieval route exists in server/hosted/http.mjs | Add account-bound invoice read, safe document response, and PostgreSQL/HTTP/browser proof. |
| A-04 | Bind reads to authenticated organization and selected project | Build | DONE | server/commerce-v2/hosted-alakazam-account.mjs; server/hosted/http.mjs:1527-1538; server/hosted/test/http-alakazam-account.test.mjs; commit 671e094 | Retain on all new reads. |
| A-05 | Same-origin read-only account route | Build | DONE | server/hosted/http.mjs:1527-1538; server/hosted/test/http-alakazam-account.test.mjs; commit 671e094 | Preserve GET-only boundary. |
| A-06 | Cross-project and cross-tenant denial | Build | DONE | server/hosted/test/alakazam-account-postgres.test.mjs; server/data-plane/tests/alakazam-postgres-contract.integration.test.mjs; active ledger:95-100 corroborates sealed run | Re-run in final clean room. |
| A-07 | Real PostgreSQL and HTTP contract tests | Build | DONE | server/data-plane/tests/alakazam-postgres-contract.integration.test.mjs; server/hosted/test/http-alakazam-account.test.mjs; package.json test:pg:alakazam | Include in final release command. |

### Lane B — customer account experience

| ID | Requirement | Owner lane | Status | Exact proof location | Next action |
| --- | --- | --- | --- | --- | --- |
| B-01 | Client adapter for billing projection | Build | DONE | abracadabra/app/abracadabra-api.js; scripts/test/abracadabra-alakazam-account.test.mjs:561; commit 671e094 | Preserve exact schema in lifecycle additions. |
| B-02 | Render tier, renewal, payment and pending change | Build | DONE | abracadabra/app/abracadabra-customer-control-dom.js:420-860,1800-1900; scripts/test/abracadabra-alakazam-account.test.mjs:1625; commit 671e094 | Extend only from canonical projection. |
| B-03 | Truthful held, empty and error states | Build | DONE | scripts/test/abracadabra-alakazam-account.test.mjs:1625-1840; scripts/browser-audit-current.mjs; commit 671e094 | Re-run against final source. |
| B-04 | Disable controls until exact commands exist | Build | DONE | server/commerce-v2/alakazam-account.mjs:855-861; scripts/test/abracadabra-alakazam-account.test.mjs:949-1020; commit 23fced6 | Continue capability-by-capability. |
| B-05 | Responsive/accessibility Chrome proof at desktop and 320px | Polish/Integration | DONE | scripts/browser-audit-current.mjs; scripts/test/abracadabra-alakazam-account.test.mjs:1861,2077; sealed evidence active ledger:104-112 and commits 671e094/47ba558 | Final release audit must rerun after current dirty UI settles. |

### Lane C — held Stripe Alakazam bindings

| ID | Requirement | Owner lane | Status | Exact proof location | Next action |
| --- | --- | --- | --- | --- | --- |
| C-01 | Held parsing for Product, three Prices, $5 Coupon and Portal config | Build | DONE | server/hosted/stripe-production-config.mjs:350-470; server/hosted/test/stripe-production-config.test.mjs; commits 671e094/e9a38cf | Supply reviewed real IDs only at cutover. |
| C-02 | Complete capability set required for approval | Build | DONE | server/hosted/stripe-production-config.mjs:20-40,350-470; server/hosted/test/stripe-production-config.test.mjs | Recheck with final provider config. |
| C-03 | Bind deployment, mode, API version, tax, returns and IDs | Build | DONE | server/hosted/stripe-production-config.mjs; server/hosted/test/stripe-production-config.test.mjs; commit 671e094 | Final test-mode and live-readiness proof. |
| C-04 | Reject partial, extra, duplicate or cross-mode config; held forwards nothing | Build | DONE | server/hosted/stripe-production-config.mjs; server/hosted/test/stripe-production-config.test.mjs; active ledger:73-74 | Preserve fail-closed parsing. |
| C-05 | No secrets, real calls or release opened by configuration work | Build | DONE | server/hosted/alakazam-release-config.mjs; server/hosted/PUBLICATION_HOLD; git history e9a38cf/82bf959 contains no IDs | Keep held until reviewed cutover. |

### Lane D — public truth and journey audit

| ID | Requirement | Owner lane | Status | Exact proof location | Next action |
| --- | --- | --- | --- | --- | --- |
| D-01 | Map visible offers, prices, links, refunds, domains, care and support to backend | Polish/Integration | DONE | ops/SITESOURCERY-PUBLIC-TRUTH-AUDIT-2026-08-04.md; ops/SITESOURCERY-CUSTOM-SERVICES-POLISH-AUDIT-2026-08-05.md; commit 671e094 | Reconcile findings into current public source. |
| D-02 | Exact KEEP/CHANGE/REMOVE/HOLD list with locations | Polish/Integration | DONE | ops/SITESOURCERY-PUBLIC-TRUTH-AUDIT-2026-08-04.md; commit 671e094 | Close every remaining CHANGE/REMOVE/HOLD row. |
| D-03 | Separate launch-critical work from expansion | Polish/Integration | DONE | canonical roadmap:79-103,383-440; this matrix Core/Expansion split | Keep public promises from promoting expansion accidentally. |
| D-04 | No copy edits before audit acceptance | Polish/Integration | DONE | roadmap:142-154; commit sequence 671e094 then later public work; audit exists before changes | Continue coordinated aesthetic ownership. |
| D-05 | Custom/existing-site truth audit against August 5 contract | Polish/Integration | DONE | ops/SITESOURCERY-CUSTOM-SERVICES-POLISH-AUDIT-2026-08-05.md; ops/SITESOURCERY-CUSTOM-SERVICES-COMMERCIAL-CONTRACT-2026-08-05.md | Reconcile public and legal source. |
| D-06 | One account-first assessment-to-receipt journey map | Polish/Integration | DONE | ops/SITESOURCERY-H1-ASSESSMENT-POLISH-MATRIX-2026-08-05.md; roadmap:500-541 | Extend map through H1N handoff. |
| D-07 | Remove every duplicate service name and double-charge path | Polish/Integration | PARTIAL | Contract/audits exist, but roadmap:153-154 remains open; later overlap rows are absent and public source still mixes Care/domain/management terms | Complete service-name inventory, overlap keys, and public/legal reconciliation. |

### Lane E — customer billing commands

| ID | Requirement | Owner lane | Status | Exact proof location | Next action |
| --- | --- | --- | --- | --- | --- |
| E-01 | Disclosure acceptance before Customer/Checkout effect | Build | DONE | server/data-plane/supabase/migrations/202608020024_alakazam_customer_provisioning.sql; 202608020025_alakazam_checkout_dispatch.sql; integration test; commits 4dd4bad/fefcf58 | Re-run in final clean room. |
| E-02 | Start quote and one-use $5 credit through held route/UI | Build | DONE | server/commerce-v2/alakazam-billing.mjs; abracadabra customer control; browser tests; commits 3ad0911/47ba558 | Preserve exact $20/$30/$45 first-payment truth. |
| E-03 | Checkout dispatch, disclosure gate, safe handoff and account return | Build | DONE | server/commerce-v2/hosted-alakazam-billing.mjs; server/hosted/http.mjs:2068-2130; tests; commits fefcf58/47ba558 | Final Stripe test-mode journey. |
| E-04 | Fixed-difference upgrade backend and atomic application | Build | DONE | migrations 202608040028 and 202608040029; server/commerce-v2/alakazam-upgrade.mjs; commits ebe1626/6b08b54 | Final provider replay proof. |
| E-05 | Customer-safe upgrade review, Checkout and refresh | Build | DONE | abracadabra customer control; scripts/test/abracadabra-alakazam-account.test.mjs:1082; commit c641898 | Re-run final desktop/mobile journey. |
| E-06 | Renewal-boundary downgrade schedule and activation backend | Build | DONE | migrations 202608040030 and 202608040031; downgrade services/tests; commits 55c7580/0995c33 | Preserve no-charge/no-refund boundary. |
| E-07 | Customer-safe downgrade schedule and review | Build | DONE | scripts/test/abracadabra-alakazam-account.test.mjs:1225,1359; commit 23fced6 | Re-run final browser recovery case. |
| E-08 | Billing Portal and exact cancellation preview/confirmation | Build | PARTIAL | Generic legacy routes exist at server/hosted/http.mjs:2206-2235 and postgres-service.mjs:2213+, but canonical Alakazam actions remain false at server/commerce-v2/alakazam-account.mjs:855-861; no current Alakazam proof | Implement canonical Alakazam portal/cancel authority, lifecycle policy, account controls and proof. |
| E-09 | Stable retry, replay and reconciliation states in account UI | Build | PARTIAL | Start/downgrade retry tests exist; provider reconciliation states exist in Alakazam migrations; owner reconciliation UI and complete lifecycle recovery are absent | Add exact customer/owner states and end-to-end retry/replay proof. |

### Lane F — tier fulfillment and publication

| ID | Requirement | Owner lane | Status | Exact proof location | Next action |
| --- | --- | --- | --- | --- | --- |
| F-01 | $25 accepted source, platform address, looks, compiler, queue, publication and compensation | Build | DONE | migration 202608040032; server/hosted/alakazam-compiler-policy.mjs; fulfillment worker; selfhost port/tests; commit c2a3bc3 | Final hosted staging and release proof. |
| F-02 | $25 customer setup path and responsive browser journey | Build | DONE | account schema v2 and setup controls/tests; commit 5b24b00 | Re-run against final artifact. |
| F-03 | $35 photo header, fonts, toggles, three-version history and modest care | Build | NOT STARTED | Roadmap:183-184; compiler explicitly freezes standard font/border at server/hosted/alakazam-compiler-policy.mjs:207-210; no $35 editor/care authority found | Freeze exact contract, migrate authority, implement controls and proof. |
| F-04 | $50 Cash App/Venmo, menu, font/border controls and additional care | Build | PARTIAL | Cash App/Venmo compiler gating exists at alakazam-compiler-policy.mjs:212-216 and spark-compiler tests; no menu/font/border/care editor or durable authority exists | Implement remaining $50 authority and customer/owner controls. |
| F-05 | Preserve premium facts while lower tiers mask output | Build | DONE | server/hosted/alakazam-compiler-policy.mjs; test/alakazam-compiler-policy.test.mjs:66; commit c2a3bc3 | Extend tests with every new premium field. |
| F-06 | Prove retained premium read/edit behavior | Build | NOT STARTED | Roadmap:190-191; no premium editor or retained edit journey exists | Add migration, projections, downgrade/upgrade retention and browser proof. |
| F-07 | Exact policy artifact, replay, rollback, unpublish and dark compensation | Build | DONE | selfhost-publication-port.test.mjs:386-470; fulfillment-worker tests; commit c2a3bc3 | Repeat in private staging. |
| F-08 | Safe customer-authorized publication/rollback/unpublish controls | Build | NOT STARTED | Customer UI explicitly says no manual action at abracadabra-customer-control-dom.js:2154-2158; only generic hosted routes exist at http.mjs:2248-2263 | Decide launch controls, implement canonical authorization and browser proof. |

### Lane G — lifecycle and reconciliation

| ID | Requirement | Owner lane | Status | Exact proof location | Next action |
| --- | --- | --- | --- | --- | --- |
| G-01 | Inventory events, schema capacity, missing transitions and decisions | Build | DONE | ops/SITESOURCERY-ALAKAZAM-LIFECYCLE-INVENTORY-2026-08-04.md; commit 3ad0911 | Use inventory as implementation order. |
| G-02 | Renewal success and new-period projection | Build | NOT STARTED | No canonical Alakazam renewal-success service/event route found; existing tests cover downgrade boundary, not recurring invoice settlement | Implement provider readback, atomic new period, receipt and account proof. |
| G-03 | Payment failure, past-due, grace, suspension and restoration | Build | PARTIAL | Schema/projector can represent grace/suspended; generic legacy postgres-service tests exist, but canonical Alakazam transitions and approved policy do not | Freeze policy, implement event transitions, serving effects and restoration proof. |
| G-04 | Period-end cancellation and retained export | Build | PARTIAL | Generic cancellation/export machinery exists; canonical Alakazam actions are false and lifecycle copy is unapproved | Implement canonical cancellation, export retention and final browser/provider proof. |
| G-05 | Defensive refunds/disputes without customer refund offer | Build | PARTIAL | Download/generic webhook tests handle refund/dispute; canonical Alakazam consequence and reconciliation path are absent | Add provider readback, entitlement/publication consequence and owner proof. |
| G-06 | Owner-only uncertain-effect reconciliation | Build | PARTIAL | Durable reconciliation_required states exist across Alakazam migrations; no bounded owner UI/command resolves the full set | Build capability-gated queue, evidence reads and exact resolution commands. |

### Lane H — Custom commercial contract and account/site authority

| ID | Requirement | Owner lane | Status | Exact proof location | Next action |
| --- | --- | --- | --- | --- | --- |
| H-01 | Freeze August 5 Custom/existing-site commercial contract | Build + Polish/Integration | DONE | ops/SITESOURCERY-CUSTOM-SERVICES-COMMERCIAL-CONTRACT-2026-08-05.md; continuity and roadmap; commit d18afb3 | Keep public/legal copy subordinate to this contract. |
| H-02 | Reconcile $200 assessment, maximum $200 credit and obsolete Care prices | Build + Polish/Integration | DONE | scripts/test/custom-services-catalog.test.mjs; migration 202608050034; active ledger:574-595; commit d18afb3 | Preserve in every later catalog version. |
| H-AUTH-01 | Require account before quote acceptance, payable invoice, payment, private access, job or support; retain anonymous inquiry | Build | PARTIAL | Assessment and Custom quote/payment/job routes are authenticated in http-custom-services-account.test.mjs; anonymous inquiry and support-ticket authority are absent | Add safe anonymous inquiry-to-claim and enforce account authority on remaining support/access paths. |
| H-AUTH-02 | Owner-assisted invitation/claim for in-person customers without owner-held password | Build | NOT STARTED | Foundation has generic invited membership, but no custom-services invitation/claim route, projection, QR or journey was found | Implement expiring invite/claim, customer-set credentials and owner/customer proof. |
| H-AUTH-03 | Owner opens same quote/invoice on Mac/Pixel and presents secure customer link/QR; manual payment evidence is reconciled | Build | PARTIAL | Owner quote desk exists in custom-services-owner-postgres.mjs and commit f2ee0b5; invoice/customer routes exist; no secure payment link/QR or manual evidence authority exists | Add account-bound presentation token/QR and explicitly bounded manual-evidence reconciliation. |
| H-AUTH-04 | One customer-owned site asset with alakazam/custom/external origin and support/access truth | Build | PARTIAL | External site profile exists in migration 202608050034 and custom-services-account.mjs:350,836; Alakazam site authority is separate; no canonical three-origin asset exists | Add canonical site asset without duplicating existing project/address truth, then migrate projections. |
| H-AUTH-05 | Cross-tenant/site denial and no browser claim of money, credit, units, job or provider authority | Build | PARTIAL | Extensive request/quote/payment/job denial tests exist in custom-service-quotes-postgres.integration.test.mjs and hosted HTTP tests; canonical site asset and all remaining commands are incomplete | Extend adversarial proof to site asset, H1N, support and every final owner operation. |

### Lane H1 — pre-commerce through paid Custom job

| ID | Requirement | Owner lane | Status | Exact proof location | Next action |
| --- | --- | --- | --- | --- | --- |
| H1-01 | Additive retained migration-34 namespace over canonical roots | Build | DONE | migration 202608050034_custom_services_foundation.sql; migration-structure tests; commit 56bf996 | Preserve additive namespace. |
| H1-02 | Actor-bound request writes and stale/cross-tenant denial | Build | DONE | custom-services foundation PostgreSQL integration test; repository-postgres.mjs; commit 56bf996 | Re-run final clean room. |
| H1-03 | Bounded typed external-site facts with database digest/revision | Build | DONE | migration 202608050034; custom-services-foundation-postgres.integration.test.mjs; commit 56bf996 | Reuse for canonical site asset. |
| H1-04 | Hold operator/document/access/commerce/job/report/credit authority; no destructive privilege/cascade | Build | DONE | migration 202608050034 privilege checks; verify-empty-postgres-migrations.mjs; commit 56bf996 | Retain least privilege in later migrations. |
| H1-05 | Readiness verifies exact $200 policy, legal digest, scope and RLS | Build | DONE | migration 202608050034 readiness function; repository-postgres tests; commit 56bf996 | Keep marker and semantic checks current. |
| H1-06 | Fresh 34-migration structural/adversarial/broad proof and cleanup | Build | DONE | maintained migration/foundation tests; sealed evidence active ledger:637-649; commit 56bf996 | Superseded final release must replay all current migrations. |
| H1-07 | Customer request, owner quote, current quote and acceptance surface | Build | DONE | migration 202608050036; request/quote repositories; Abracadabra controls/tests; commits ccce671/f2ee0b5 | Preserve through H1N. |
| H1-08 | Simple anonymous inquiry/claim without pre-account commerce authority | Build | NOT STARTED | Roadmap:258-259; no matching anonymous custom-services route or claim journey found | Implement anonymous inquiry, expiring claim and activated-account continuation. |
| H1-09 | Versioned exact $200 assessment quote and immutable account acceptance | Build | DONE | migration 202608050035; assessment quote service/tests; commit 7cf5699 | Final clean-room replay. |
| H1-10 | Authenticated held custom-services account read | Build | DONE | custom-services-account-hosted.mjs; http.mjs custom-services GET; tests; commit 8c8a61f | Extend projection only with exact H1N truth. |
| H1-11 | Exact account-bound assessment invoice and no-charge projection | Build | DONE | migration 202608050037; custom-services-invoice-postgres.mjs; tests; commit 7369145 | Retain immutable invoice. |
| H1-12 | Automatic-tax assessment Checkout dispatch with ambiguity fences | Build | DONE | migration 202608050038; assessment-payment-postgres.mjs; Stripe adapter/tests; commit 69e47db | Final Stripe test-mode proof. |
| H1-13 | Provider-confirmed assessment settlement, receipt and one job | Build | DONE | migration 202608050039; assessment-settlement service; webhook tests; commit 5c34845 | Final replay/mismatch proof. |
| H1-14 | Bounded findings, report delivery and one-use $200 credit | Build | DONE | migration 202608050040; assessment-work service/HTTP/browser tests; commit 0a14aa2 | Preserve report/credit immutability. |

### Assessment and Custom-build outcome

| ID | Requirement | Owner lane | Status | Exact proof location | Next action |
| --- | --- | --- | --- | --- | --- |
| ASSESS-01 | Bounded $200 assessment: one site, five representative targets, two viewports, ten findings, expanded hold | Build | DONE | migrations 202608050034/035/040; assessment quote/work tests; commits 7cf5699/0a14aa2 | Reconcile exact public copy. |
| ASSESS-02 | One non-cash same-project 90-day $200 Custom base-build credit | Build | DONE | migration 202608050040; assessment work service; integration journey; commit 0a14aa2 | Keep database-derived expiry. |
| ASSESS-03 | Atomic one-use credit reserve/apply with unsettled-void release | Build | DONE | migration 202608050041; custom-build-postgres.mjs; tests; commit 9221072 | Preserve through final payment. |
| ASSESS-04 | Accepted Custom quote to first invoice, credit, Checkout, settlement and retained job | Build | DONE | migrations 202608050041/042; custom-build payment service/tests; commit 52644fa | Extend only via H1N final obligation. |
| ASSESS-05 | Customer and private Mac/Pixel paid-job projection | Build | DONE | custom-build-work-postgres.mjs; browser and owner tests; commit 62aaae8 | Re-run with H1N projections. |

### Launch-critical quote, invoice, job and owner/customer surfaces

| ID | Requirement | Owner lane | Status | Exact proof location | Next action |
| --- | --- | --- | --- | --- | --- |
| QIJ-03 | Versioned estimate/quote, disclosure, expiry, acceptance, credit, scope reuse and change-order authority | Build | PARTIAL | Assessment/Custom quote authority is sealed through migration 42; H1M change-order authority is sealed in migration 44 and commit c4277ce; generic cross-service scope reuse is absent | Preserve the sealed H1M authority and add only launch-required scope reuse. |
| QIJ-04 | Invoice, deposit/milestone/balance, provider settlement, receipt, retry and uncertain-payment reconciliation | Build | PARTIAL | Assessment and first Custom payment are sealed through migration 42; H1M intentionally leaves accepted changes payment-required; H1N change-order and final invoices/settlement remain absent | Implement H1N's ordered change-payment purpose before its separate final-payment purpose. |
| QIJ-05 | Job, checklist, dependency, safe access, evidence, deliverable, completion, 30-day correction and handoff | Build | PARTIAL | Migration 43 progress and migration 44 completion are sealed through c4277ce; no immutable handoff or handoff-derived workmanship clock exists | Implement H1N final settlement, handoff and database-derived window without weakening H1M finality. |
| QIJ-06 | Paid-job subset: three stages, four milestones, one bounded request and owner resolution | Build | DONE | migration 202608060043; custom-build-progress-postgres.mjs and tests; commit a46fb40; H1M post-completion finality sealed by c4277ce | Preserve the sealed progress and completion finality through H1N. |
| QIJ-07 | Formal change orders, completion evidence, final payment, delivery receipt and 30-day boundary | Build | PARTIAL | H1M change orders and completion evidence are sealed at c4277ce with active ledger:1293-1381; both H1N payment purposes, delivery and workmanship authority are absent | Complete every ordered H1N row below. |
| SURFACE-01 | Responsive Mac/Pixel owner assessment review and quote issue | Build | DONE | owner quote desk source/tests; browser controls; commit f2ee0b5 | Re-run in final owner journey. |
| SURFACE-02 | Customer views for full assessment/onboarding/quote/invoice/payment/job/access/change/handoff/management/recovery lifecycle | Build | PARTIAL | Assessment and Custom-through-H1M completion views are sealed; onboarding, H1N payment/handoff, management, tickets and some recovery states do not exist | Complete H1N and only then Expansion views. |
| SURFACE-03 | Mac/Pixel owner search and bounded operations for full client/site/payment/job/access/management/ops/reconciliation lifecycle | Build | PARTIAL | Owner assessment, paid-job, progress and H1M change/completion controls are sealed at c4277ce; broad search, final settlement, management and reconciliation are absent | Add launch-critical owner operations and prove no mark-paid shortcut. |
| SURFACE-04 | Every journey against fresh PostgreSQL, provider test mode, authenticated desktop/mobile, race/failure and safe projections | Polish/Integration | PARTIAL | H1M has fresh all-44 PostgreSQL, real queued-race and authenticated Chrome proof at active ledger:1361-1375; H1N, provider test-mode, current public/aesthetic and final-candidate proof remain absent | Run exact final clean-room and browser/provider matrix after H1N and public truth stabilize. |

### Core truth holds for Domains and Responder

| ID | Requirement | Owner lane | Status | Exact proof location | Next action |
| --- | --- | --- | --- | --- | --- |
| I-08 | Remove direct domain Stripe checkout, charge-before-registration and refund promises | Aesthetic + Polish/Integration | PARTIAL | domains/domain-search.js:43-46 maps two direct Stripe links, lines 120-131 render active Buy buttons, and lines 169-172 promise registrar confirmation plus a full refund; current domains/index.html has dirty copy changes but no sealed held journey | Remove every direct payment/refund path, retain truthful preflight/inquiry only, and prove the exact Pages/hosted artifacts. |
| I-10 | Keep held domain storefront distinct from paid email/domain configuration, move and rescue work | Aesthetic + Polish/Integration | PARTIAL | Commercial contract/audit separates services; current Domains page still presents active buy/manage offers without a complete held boundary | Make storefront visibly non-sellable and cross-link separately scoped services only. |
| I-11 | Keep The Responder operationally and commercially held until telephony fulfillment is real | Aesthetic + Polish/Integration | PARTIAL | responder/index.html:7,42-44,54-66,76-81 and 101-146 claim texts in seconds, working call paths, setup, monitoring and active $300/$250 pricing; lines 45 and 146 say it is not a button/order, but that does not retract the active fulfillment claims; server/commerce/rails.mjs:188-194 says no working Responder exists | Convert every route to clearly hypothetical examples plus inquiry-only hold; publish operational/pricing claims only after telephony/A2P proof. |
| I-12 | Expansion items do not block platform-subdomain launch | Build + Polish/Integration | DONE | Separate Alakazam release config/holds and this Core/Expansion split; roadmap:417-418 | Keep held public truth while Expansion proceeds independently. |

### Lane J — release and proof

| ID | Requirement | Owner lane | Status | Exact proof location | Next action |
| --- | --- | --- | --- | --- | --- |
| J-01 | Reconcile all public copy, links, legal, support and pricing | Aesthetic + Polish/Integration | PARTIAL | Audits exist; current legal/website-terms/index.html:96-101 still publishes only $25 and invented cancellation/grace/retention; direct links remain | Finish aesthetic pass, commercial/legal truth reconciliation and automated checks. |
| J-02 | Replace direct assessment payment with account offer/invoice/payment and exact bounded scope | Build + Aesthetic | PARTIAL | Backend journey is sealed through H1G; custom/index.html:134 has correct scope and inquiry, but full public-to-account journey is not release-proven | Connect and browser-prove public inquiry/account/quote/invoice journey. |
| J-03 | One restrained “Have a website already?” section for five later lanes | Aesthetic | NOT STARTED | No consolidated five-lane section found in current homepage/custom candidate; homepage is design-locked | Add only in an approved non-home route or obtain cross-lane decision if homepage placement is required. |
| J-04 | Publish approved starting prices/exclusions and explain stacking without duplicate work | Aesthetic + Polish/Integration | PARTIAL | Custom prices exist; overlap engine/later services are incomplete and public stacking language is not reconciled | Publish only currently supported prices; hold Expansion offers and add dedup language. |
| J-05 | Reconcile terms for onboarding, milestones, workmanship, management, plan changes, provider costs and lawful cancellation | Polish/Integration + Aesthetic | PARTIAL | Custom milestone text exists; legal file contains stale lifecycle and no complete outside-management/H1N terms | Finish H1N policy and held Expansion terms, then update legal source/tests. |
| J-06 | Complete mobile, desktop, accessibility, performance and security audits | Polish/Integration | PARTIAL | browser-audit-current.mjs covers responsive/browser checks; no final-source run and no complete performance/security release report exists | Run all audits on sealed candidate and store exact evidence. |
| J-07 | New and returning customer journeys in private staging | Polish/Integration | PARTIAL | ops/HOSTED-STAGING-VERIFICATION-2026-08-01.md proves an older staging build; current 44-migration/H1N candidate is not staged | Deploy reviewed private candidate and run both journeys. |
| J-08 | Owner Mac and Pixel operations journeys | Polish/Integration | PARTIAL | H1K/L and sealed H1M authenticated owner journeys exist, including 390x844 and 1440x1000 evidence at active ledger:1368-1375; no H1N/final launch owner journey exists | Run the complete authenticated owner walk after H1N. |
| J-09 | Prove email, Stripe test payments, hosting, support, invoice, backup, restore, monitoring, alerting and rollback | Polish/Integration | PARTIAL | Individual ops proofs and Stripe mock/test boundaries exist in ops docs/tests and hosted tests; no single current-candidate integrated release proof exists | Execute full provider/staging/ops proof against exact candidate. |
| J-10 | Owner walkthrough and reviewed production cutover | Owner/cutover | NOT STARTED | Public production remains July 22 predecessor per active ledger:32-34; no cutover record exists | Complete internal gates, conduct walkthrough, request explicit cutover approval. |
| J-11 | Verify DNS/TLS/post-cutover and retain old-release rollback | Owner/cutover | PARTIAL | Old release is retained as fallback; no new-build cutover, post-cutover DNS/TLS or rollback exercise exists | At approved cutover, verify DNS/TLS/live behavior and rehearse exact rollback. |
| J-12 | One Core release command runs fresh empty PostgreSQL migration replay and Custom-services PostgreSQL journeys | Build + Polish/Integration | PARTIAL | package.json:37-39 defines test:pg:migrations and test:pg:custom-services separately, but package.json:54 npm test invokes neither; test:node includes only PostgreSQL structure checks, so a green npm test is not green database release proof | Add a fail-fast Node 24 Core release command that provisions a fresh named disposable database, runs the complete empty migration replay and Custom-services journeys, verifies cleanup, and records the exact candidate digest. |

### Accepted launch-truth gates

| ID | Requirement | Owner lane | Status | Exact proof location | Next action |
| --- | --- | --- | --- | --- | --- |
| TRUTH-01 | Publish $25/$35/$50 ladder and $20/$30/$45 first-payment outcomes | Aesthetic + Polish/Integration | PARTIAL | Backend/account tests carry exact tiers and outcomes; public FAQ, Domains and legal still say only $25 at faq/index.html:57, domains/index.html:44 and legal terms:96-100 | Publish canonical ladder only after $35/$50 fulfillment is launch-ready or clearly mark unavailable tiers. |
| TRUTH-02 | Cash App/Venmo only at $50 and three-version history at $35+ | Build + Aesthetic | PARTIAL | $50 compiler gating is tested; $35 history/editor authority and reconciled public copy are absent | Implement retained tier controls then update copy/tests. |
| TRUTH-03 | Replace “$25 = your own .com” with label.sitesourcery.me | Aesthetic + Polish/Integration | PARTIAL | Account/terms use label.sitesourcery.me; hosted fragments still advertise own-domain hosting at scripts/hosted-truth/fragments/abracadabra-landing-main.html:80-90 | Remove tier/domain conflation from every public/hosted source. |
| TRUTH-04 | Remove invented cancellation, grace, suspension, retention, deletion and refund language until policy is approved | Aesthetic + Polish/Integration | PARTIAL | Audit exists, but legal/website-terms/index.html:96-101 and source-only controls still state invented clocks | Remove/hold public claims now; reintroduce only after Lane G policy/proof. |
| TRUTH-05 | Canonical legal/privacy for accounts, billing changes, publication, support and all tiers | Polish/Integration + Aesthetic | PARTIAL | Hosted legal fragments exist for earlier Download authority; current public legal source conflicts with hosted account reality and all-tier contract | Rewrite from canonical contracts, then run legal/copy tests and browser audit. |
| TRUTH-06 | Remove five legacy direct Stripe Payment Links from all public and production artifacts | Build + Aesthetic | NOT STARTED | Direct links remain in domains/domain-search.js:45-46, abracadabra/app/abracadabra-paid-download.js:122-137 and server/commerce/rails.mjs:95-177; scripts/check-site.mjs:270-275 currently blesses five rails by count | Remove direct links and the count-based blessing from Pages/hosted candidates; use only account-bound server Checkout with purpose-specific authority. |
| TRUTH-07 | Assessment intake, written offer, account invoice and payment sequencing | Build | DONE | migrations 34-39; authenticated routes/tests; commits ccce671 through 5c34845 | Re-run as part of final public-to-account journey. |
| TRUTH-08 | Minimum Custom estimate/invoice/deposit/milestone/job ledger before advertised operational | Build | PARTIAL | Estimate, acceptance, first invoice/payment and job exist through migration 43; H1M change/completion is sealed at c4277ce; H1N change-payment, final balance and handoff are absent | Implement both ordered H1N financial purposes before any public operational claim. |
| TRUTH-09 | Hold domain storefront and remove direct Stripe, charge and refund language until registrar authority is releasable | Aesthetic + Polish/Integration | NOT STARTED | domains/domain-search.js:43-46,120-131 creates direct Stripe Buy actions and lines 169-172 promises post-search registrar confirmation/refund; server/commerce/rails.mjs:128-162 records charged-today/refund fulfillment while registrar resale remains held | Make search explicitly non-authoritative and inquiry/preflight-only, remove all direct charge/refund paths, then test Pages and hosted artifacts for zero domain payment authority. |
| TRUTH-10 | Hold active Responder sales and operational claims until telephony/A2P is real | Aesthetic + Polish/Integration | PARTIAL | responder/index.html:7,42-44,54-66,76-81 and 101-146 presents an operating seconds-fast service at $300 setup/$250 monthly; no-button/order caveats at lines 45 and 146 are only partial truth; server/commerce/rails.mjs:188-194 says there is no working Responder | Convert all current-tense fulfillment and sellable pricing to unmistakable held/hypothetical inquiry copy across every route; require telephony/A2P journey proof before activation. |
| TRUTH-11 | Exclude legacy browser localStorage accounts, honor-paid state and direct-payment scripts from both GitHub Pages and hosted production artifacts | Build | PARTIAL | Hosted build correctly excludes the bridges at scripts/build-hosted.mjs:35-40,631-640, but scripts/build-pages.mjs:25,30 includes them, abracadabra/app/index.html:20,22 loads them, abracadabra-account.js:5-10,24-28 stores browser accounts, and abracadabra-paid-download.js:7-11,122-137 trusts an honor gate/direct Stripe link | Remove the legacy bridges from the Pages artifact and runtime, replace them with authenticated server authority, and make both artifact gates fail on localStorage/honor/direct-payment regressions. |
| TRUTH-12 | Reconcile the inquiry-only public catalog with the release checker's five-sellable-rails model | Build + Polish/Integration | NOT STARTED | data/public-catalog.json:4-5 and scripts/check-pricing.mjs:240-249 require inquiry-only/no checkout endpoints, while scripts/check-site.mjs:270-275,404-408 requires and reports exactly five sellable rails from server/commerce/rails.mjs:95-177,214-215, including held/direct-payment offers | Replace the pinned rail count with per-offer availability and fulfillment authority; fail when any inquiry-only/held offer is classified sellable or a public artifact carries its checkout. |

### Sealed H1M checkpoint — H1N is next

| ID | Requirement | Owner lane | Status | Exact proof location | Next action |
| --- | --- | --- | --- | --- | --- |
| H1M-01 | Add-only $125-unit change orders with issue/accept/decline/void/expiry and no browser money authority | Build | DONE | migration 202608060044, custom-services-custom-build-change-completion-postgres.mjs and maintained tests; active ledger:1303-1312,1329-1332,1361-1369; sealed commit c4277ce | Preserve exact quote/digest and no-browser-money authority while H1N adds its separate payment records. |
| H1M-02 | Current-scope, current-progress, real decodable 2-12-image completion evidence with distinct desktop/phone proof | Build | DONE | service-image-evidence.mjs, migration 44 and decoder tests; active ledger:1313-1343 proves current revision/scope binding, pinned sharp@0.35.3 full-pixel decode, adversarial JPEG/WebP rejection and zero known production vulnerabilities; active ledger:1361-1375 proves real desktop/phone evidence | Preserve decoder pins and evidence invariants; rerun them from the final Core release command. |
| H1M-03 | Two-session completion race and post-completion progress/request/delegated-access finality | Build | DONE | migration 44 and custom-service-quotes-postgres.integration.test.mjs; active ledger:1344-1347,1361-1367 records the real queued completion/progress race and every post-completion progress/request/delegated-access denial 1/1; sealed commit c4277ce | Preserve the shared transaction lock and terminal write denial through H1N. |
| H1M-04 | Customer/owner projections, routes, responsive controls and production hold until H1N | Build | DONE | Abracadabra/API/HTTP/composition source and custom-build-change-completion-production-hold.test.mjs sealed by c4277ce; active ledger:1348-1353,1368-1379 proves exact controls, held production composition, real 390x844/1440x1000 evidence and bound manifest digests | Keep production held until H1N has verified final settlement or exact zero-balance clearance. |
| H1M-05 | Fresh corrected clean-room, broad/browser gates and independent BLOCKER: NO | Build + Polish/Integration | DONE | active ledger:1295-1301 records independent `BLOCKER: NO`; lines 1361-1367 record codex13 all-44 replay, full journey 1/1, zero sessions, exact drop and verified absence; lines 1368-1375 record focused 146/146 plus one uninterrupted Node 24 npm test and exact Chrome evidence; commit c4277ce | Begin H1N Purpose 1 from the sealed checkpoint; retain H1M proof and release hold. |

### H1N — ordered change-order payment, final payment and immutable handoff

Critical path is strict and one-way:

`H1M seal [DONE at c4277ce] -> H1N-CO-01 ordering gate -> H1N-CO-02 exact change-order invoice -> H1N-CO-03 dedicated change-order Checkout -> H1N-CO-04 provider-confirmed receipt -> H1N-CO-05 atomic effective transition -> no accepted_payment_required change remains -> completion evidence -> H1N-FINAL-01 final obligation -> H1N-FINAL-02 final invoice -> H1N-FINAL-03/04 payment or explicit zero-balance clearance -> H1N-FINAL-05 handoff -> H1N-FINAL-06/07 projections and workmanship window`.

Phase 2 may not derive or reserve a final obligation before every accepted
change order for that job is effective. Completion evidence is not payment,
settlement, handoff, or permission to skip either financial purpose.

#### Purpose 1 — accepted change-order payment and effect

| ID | Requirement | Owner lane | Status | Exact proof location | Next action |
| --- | --- | --- | --- | --- | --- |
| H1N-CO-01 | Enforce the financial-purpose ordering gate for every accepted_payment_required change before completion/final obligation | Build | PARTIAL | Sealed migration 202608060044:1105-1107 creates accepted_payment_required and lines 1946-1956 block completion while issued/accepted changes remain; no payment orchestration, effective transition or phase-2 reservation guard exists | From sealed H1M, add a database-enforced gate that enumerates every accepted change and forbids completion/final-purpose reservation until all are effective. |
| H1N-CO-02 | Materialize one exact immutable change-order invoice and line set for every accepted_payment_required change | Build | NOT STARTED | migration 202608060044:710-730 explicitly says v44 has no payment evidence relation; no change-order invoice table/materializer/service/test exists | Bind invoice identity, amount, scope/quote/disclosure digests, customer, job and change number; prove one invoice per accepted change under replay/race. |
| H1N-CO-03 | Use a dedicated change-order Checkout purpose with retained attempt/event authority | Build | NOT STARTED | Existing Custom Checkout purpose covers the first build payment; no change-order Checkout purpose, attempt or route is present in migration 44/services/tests | Add reserve-before-provider-call Checkout bound only to the exact change-order invoice; never reuse assessment, first-payment or final-payment purpose. |
| H1N-CO-04 | Record a provider-confirmed change-order settlement receipt bound to the exact invoice and Checkout attempt | Build | NOT STARTED | migration 202608060044:710-730 is deliberately fail-closed until a named receipt relation exists; no provider readback/receipt/reconciliation path exists for change orders | Implement provider readback, immutable receipt/event evidence, idempotent replay and owner-only uncertain-effect reconciliation; no browser mark-paid authority. |
| H1N-CO-05 | Atomically record the confirmed receipt and transition accepted_payment_required to effective | Build | NOT STARTED | migration 202608060044:934-1008 allows issued-to-accepted/declined/expired/voided transitions but has no accepted_payment_required-to-effective transition; the effective scope can therefore never include an accepted paid change | Add one transaction that validates receipt/invoice/change digests, appends settlement, changes state to effective exactly once and survives duplicate/lost responses; prove completion remains blocked until commit. |

#### Purpose 2 — final obligation, settlement and handoff

| ID | Requirement | Owner lane | Status | Exact proof location | Next action |
| --- | --- | --- | --- | --- | --- |
| H1N-FINAL-01 | After all accepted changes are effective and completion is evidenced, derive the exact final obligation from accepted quote/installment and effective scope | Build | NOT STARTED | Active ledger:1383-1409 defines the requirement; no migration 45 or final-obligation table/service exists; latest migration is 44 | Design immutable obligation/digest authority with database prerequisites on CO-05 and completion evidence. |
| H1N-FINAL-02 | Materialize the final invoice and immutable line items, including an explicit zero-balance path | Build | NOT STARTED | Current migration 42 stores final_due_minor/final_payment_state only; no final invoice materializer exists | Add additive migration and exact invoice projection without treating zero due as an implicit payment. |
| H1N-FINAL-03 | Use a dedicated final-payment Checkout purpose with retained attempt and event ledger | Build | NOT STARTED | Existing custom-build payment purpose covers first payment only; no final-purpose code/test found | Reuse reserve-before-effect patterns with a distinct final purpose that cannot settle a change-order invoice. |
| H1N-FINAL-04 | Require provider-confirmed final settlement or explicit database-authorized zero-balance clearance | Build | NOT STARTED | No final receipt/clearance authority found; active ledger:1394-1399 states the exact requirement | Implement readback, atomic settlement/clearance, replay and ambiguity reconciliation. |
| H1N-FINAL-05 | Create immutable handoff/delivery receipt only after final settlement/clearance and close later work writes | Build | NOT STARTED | No service handoff receipt/table exists; migration 44 explicitly says completion is not handoff | Add evidenced handoff transaction, financial prerequisite and terminal write guards. |
| H1N-FINAL-06 | Expose bounded customer and owner final-obligation/payment/handoff projections and responsive journeys | Build | NOT STARTED | No H1N schema/routes/controls/tests exist | Add account-safe and private owner surfaces with authenticated desktop/mobile proof across both financial purposes. |
| H1N-FINAL-07 | Derive immutable 30-day workmanship start/end in PostgreSQL from evidenced handoff | Build | NOT STARTED | Quote promises 30 days in migration 41 and UI, but no handoff-derived clock exists; completion UI says clock has not started | Materialize start/end only from handoff time and prove exact inclusive/exclusive boundaries and immutable replay. |

### Owner-directed aesthetic launch corrections

The aesthetic lane owns vnext.css, visual assets, and the listed public route
presentation. The homepage remains design-locked. Dirty aesthetic source is
evidence of work in progress, not completion.

| ID | Requirement | Owner lane | Status | Exact proof location | Next action |
| --- | --- | --- | --- | --- | --- |
| AESTH-01 | Domains uses its own storefront background, no floating duplicate, readable frosted hero and mobile containment | Aesthetic | PARTIAL | Dirty domains/index.html and vnext.css contain a page class/background attempt; owner still observed wizard background and prior phone render overflowed; no final browser proof exists | Correct actual routed selector/artifact, remove duplicate, then verify desktop and Pixel screenshots. |
| AESTH-02 | Custom Sorcery route has unique page presentation and no arbitrary floating repeated graphics | Aesthetic | NOT STARTED | custom/index.html has no current worktree change; no page-specific verified background proof exists | Audit complete route, implement unique visual, and verify mobile/desktop without changing commercial authority. |
| AESTH-03 | Responder removes planner/floating art, shows the whole five-step flow directly and is held/non-sellable | Aesthetic | PARTIAL | Dirty responder/index.html removes planner and exposes five steps, but still carries active pricing/outcome claims; no final CSS/background/browser proof | Finish visual and truth hold, validate HTML and responsive route. |
| AESTH-04 | Work/Spell Book is an explorable work gallery without clutter or invented client claims | Aesthetic | PARTIAL | Dirty work/index.html and work/work.css; work meta already distinguishes founder sites and fictional studies; no final route proof | Finish gallery structure and responsive/accessibility review. |
| AESTH-05 | About has its own awesome page background/presentation | Aesthetic | NOT STARTED | No current about/index.html or page-specific asset/CSS change in worktree | Implement and browser-prove without touching locked homepage. |
| AESTH-06 | Contact has its own awesome page background/presentation | Aesthetic | NOT STARTED | No current contact/index.html or page-specific asset/CSS change in worktree | Implement and browser-prove form/contact readability. |
| AESTH-07 | FAQ has its own awesome page background/presentation | Aesthetic | NOT STARTED | No current faq/index.html or page-specific asset/CSS change in worktree | Implement after copy truth is reconciled; verify details controls. |
| AESTH-08 | Legal routes have their own readable presentation and canonical copy | Aesthetic + Polish/Integration | NOT STARTED | No current legal route visual changes; legal copy remains commercially stale | Reconcile legal truth first, then implement/readability-test all legal routes. |
| AESTH-09 | Homepage design remains locked and is not altered by route corrections | Aesthetic | DONE | index.html has no current worktree modification; coordination directive explicitly locks homepage | Keep it unchanged unless the owner explicitly reopens it. |

## EXPANSION matrix

These rows do not lower Core Launch while their public offers are explicitly
held and non-sellable. They determine the separate Expansion percentage.

### Assessment reuse and later selected-findings work

| ID | Requirement | Owner lane | Status | Exact proof location | Next action |
| --- | --- | --- | --- | --- | --- |
| EXP-ASSESS-06 | Record structured reused findings on Rescue, Move, onboarding and management quotes | Expansion Build | NOT STARTED | Delivered findings exist in migration 40; no overlap/reuse rows on later-service quotes exist | Add overlap keys and immutable reuse lines when the first later service is implemented. |
| EXP-ASSESS-08 | Customer selects safe delivered findings for later fixed Rescue quote | Expansion Build | NOT STARTED | Customer can read report; no finding-selection command or Rescue quote service exists | Implement only with fixed quote review and no automatic charge. |

### Outside-site onboarding and management

| ID | Requirement | Owner lane | Status | Exact proof location | Next action |
| --- | --- | --- | --- | --- | --- |
| EXP-MGMT-01 | Staged $200 review, then $100/$400 balance or complex from $900 | Expansion Build | NOT STARTED | Pricing is frozen in commercial contract/roadmap; no onboarding invoice/job authority exists | Build assessment-reuse, acceptance and staged invoice journey. |
| EXP-MGMT-02 | Declined outside site receives paid written result with no monthly charge | Expansion Build | NOT STARTED | Assessment/report primitives exist; no outside-supportability result or management-start fence exists | Add explicit decline result and no-subscription invariant. |
| EXP-MGMT-03 | Delegated access, supportability, baseline backup, monitoring, backlog gate and first record | Expansion Build | NOT STARTED | Access-request primitives and platform ops exist separately; no outside-site onboarding composition exists | Compose only after canonical site asset. |
| EXP-MGMT-04 | Monthly $125/$225/custom-from-$400 bases billed in advance | Expansion Build | NOT STARTED | Contract text only; no recurring management catalog/subscription/invoice state exists | Add versioned recurring catalog and provider-confirmed billing. |
| EXP-MGMT-05 | Optional 2-unit/$250 and 4-unit/$500 capacity, rollover, tickets and approved response promise | Expansion Build | NOT STARTED | No capacity/ticket engine found; response promise remains owner-held | Freeze response policy, then build usage/rollover/ticket authority. |
| EXP-MGMT-06 | Keep Outside Management, Custom Care and Alakazam care distinct on one reusable engine | Expansion Build | PARTIAL | Commercial contract/audits distinguish names; no shared ticket/capacity/receipt engine exists | Design one engine with separate catalog products and projections. |

### Reusable later-service commerce

| ID | Requirement | Owner lane | Status | Exact proof location | Next action |
| --- | --- | --- | --- | --- | --- |
| EXP-QIJ-01 | Versioned service catalog with fixed/banded/custom/recurring/prerequisite/exclusion/provider/overlap rules | Expansion Build | PARTIAL | Exact assessment and Custom build catalogs exist in migrations 34/41; no general later-service rules or overlap engine exists | Extend narrowly when first Expansion service is built. |
| EXP-QIJ-02 | Internal $125 repair units, $250 Rescue minimum, dedup and rebuild review above eight units | Expansion Build | NOT STARTED | H1M has $125 add-only build change units, not Rescue unit quoting/dedup; no Rescue catalog exists | Implement separate Rescue policy from selected findings. |

### Five existing-site revenue lanes

| ID | Requirement | Owner lane | Status | Exact proof location | Next action |
| --- | --- | --- | --- | --- | --- |
| EXP-SVC-01 | Website Rescue and Tune-Up from paid findings | Expansion Build | NOT STARTED | Assessment report exists; no Rescue quote/invoice/job path exists | Build selected-finding fixed quote and dedup units. |
| EXP-SVC-02 | Outside Website Management after paid onboarding | Expansion Build | NOT STARTED | Commercial contract only; no onboarding/management runtime | Complete EXP-MGMT rows. |
| EXP-SVC-03 | Business Email and Domain Connect $200, Move from $500, Rescue investigation $300 | Expansion Build | NOT STARTED | Public/audit concepts and domain primitives exist; no service catalog/quote/job path | Build as account-bound quote-only service with provider costs separate. |
| EXP-SVC-04 | Website Move/Platform Escape: assessment + $500 base + scoped components | Expansion Build | NOT STARTED | No transition-base catalog or migration/redirect job engine exists | Implement inventory reuse, exclusions, rollback and fixed quote. |
| EXP-SVC-05 | Local Presence $400/$300/$650 plus reviewed bands and no ranking guarantee | Expansion Build | NOT STARTED | Commercial planning only; no catalog/proof/job path exists | Freeze exact deliverables and build account-bound quote/job flow. |

### Registrar automation and commercial contingency

| ID | Requirement | Owner lane | Status | Exact proof location | Next action |
| --- | --- | --- | --- | --- | --- |
| EXP-DOM-01 | Provider-neutral two-slot contingency core with safe preflight, no mutation fallback and registrar pin | Expansion Build | DONE | server/domain/provider-contingency.mjs; provider contingency tests; commit 581627b | Preserve while adding hosted persistence. |
| EXP-DOM-02 | Interchangeable Spaceship primary and approved reseller secondary for preflight | Expansion Build | PARTIAL | Two-slot core exists; production composition injects an unavailable held secondary and no real secondary adapter | Select/review reseller and compose test adapter. |
| EXP-DOM-03 | Automatic fallback only before provider contact/quote/mutation; uncertainty stays pinned | Expansion Build | PARTIAL | Core service/provider-contingency tests enforce rule; real hosted secondary/persistence journey absent | Add hosted PostgreSQL composition and real-adapter contract proof. |
| EXP-DOM-04 | Persist provider route, quote, attempts, operation ID and registrar-of-record for DNS/renewal/support/transfer | Expansion Build | PARTIAL | In-memory/core durable model and existing domain tables exist; active ledger:1265-1269 says hosted PostgreSQL pin routing unfinished | Add additive hosted persistence and end-to-end pin proof. |
| EXP-DOM-05 | Customer registrant, registrar disclosure, upstream cost plus visible fees, prepaid renewal and transfer | Expansion Build | PARTIAL | Agency/registrant core and docs exist; exact current upstream pricing, production disclosure and renewal mutation do not | Prove reseller pricing/fees, customer consent and transfer/handoff. |
| EXP-DOM-06 | Spaceship written commercial consent or reviewed reseller alternative | External/provider | EXTERNAL BLOCKER | Consent request recorded at active ledger:1265-1269 and roadmap:406-410; no response/consent reference exists in repo | Await response while internally evaluating a reseller API; do not make offer sellable. |
| EXP-DOM-07 | Registrar authority, recheck, capture-after-registration, DNS, renewal and transfer proof | Expansion Build | PARTIAL | Spaceship adapter/core tests cover many mocked boundaries; renewal mutation and complete hosted/provider journey remain unsupported | Finish reseller-capable adapter, persistence and provider test-mode journey. |
| EXP-DOM-09 | Reconcile separate Custom care plans | Expansion Build + Polish/Integration | PARTIAL | Contract distinguishes care categories; no final catalog/ticket/capacity implementation or public reconciliation | Freeze exact Care scopes with management engine. |

### Responder telephony fulfillment

| ID | Requirement | Owner lane | Status | Exact proof location | Next action |
| --- | --- | --- | --- | --- | --- |
| EXP-RESP-01 | Real telephony/A2P fulfillment, consent, monitoring, support and billing behind Responder offer | Expansion Build | NOT STARTED | ops/RESPONDER-PREFLIGHT.md and RESPONDER-SETUP.md are plans; no telephony provider runtime, A2P approval, durable messages or billing journey exists | Keep public offer held; later choose provider, complete compliance registration and build/test the full service. |

## DEFERRED inventory

| ID | Requirement | Owner lane | Status | Exact proof location | Promotion rule |
| --- | --- | --- | --- | --- | --- |
| DEF-ASSESS-07 | Optional evidence-bound AI first draft with mandatory owner review | Deferred Expansion | DEFERRED | Roadmap:307-309; no implementation | Promote only after human-authored assessment delivery remains stable and owner requests it. |
| DEF-HQ-01 | Expose same contracts to Fantasealand Desiderata Labs HQ without second authority | Deferred Integration | DEFERRED | Roadmap:380-381; no HQ integration in this repo | Promote after Site Sourcery Core Launch is sealed. |
| DEF-B2D-01 | Decide whether HTTP command identity enters durable downgrade scheduler | Deferred Build | DEFERRED | Roadmap:878-880; current durable quote/application idempotence is tested | Promote only on a concrete audit finding. |
| DEF-B2D-02 | Add application-layer scheduled-boundary assertion beyond PostgreSQL enforcement | Deferred Build | DEFERRED | Roadmap:881-883; database already enforces boundary | Promote during nearby lifecycle work if low-risk. |
| DEF-B2D-03 | Move temporary successful-schedule/failed-refresh Chrome case into maintained harness | Deferred Polish | DEFERRED | Roadmap:884-887; source regression and historical Chrome proof exist | Promote when browser harness is standardized. |

## Immediate next action

Begin H1N Purpose 1 from sealed commit c4277ce: materialize the exact accepted-
change-order invoice and lines, add its dedicated Checkout/Stripe purpose and
append-only events, require provider-confirmed settlement, and atomically move
that exact order from `accepted_payment_required` to `effective`. Preserve every
H1M invariant and keep production, provider release, push, deployment and DNS
held. Only after every accepted change is effective may Purpose 2 derive the
completion-bound final obligation.

## Current evidence gaps that control the next actions

1. H1N has two unimplemented financial purposes. Accepted change orders have no
   exact invoice, dedicated Checkout, provider-confirmed receipt or atomic
   effective transition. Until every accepted change is effective, completion
   may not derive the also-absent final obligation/invoice, final Checkout,
   settlement/zero-balance clearance, handoff, projections or workmanship clock.
2. Canonical Alakazam invoices, Portal/cancellation, lifecycle transitions,
   $35/$50 controls/care, customer publication controls and owner
   reconciliation remain incomplete.
3. Public/legal truth is not launch-ready: an inquiry-only catalog conflicts
   with the five-sellable-rails checker, direct Stripe/domain charge/refund paths
   remain, Responder claims active fulfillment despite held telephony, legacy
   GitHub Pages account/honor-payment scripts ship, legal lifecycle terms are
   stale, and the all-tier ladder is not published truthfully.
4. The current mixed aesthetic work has no final mobile/desktop/browser seal.
5. npm test omits both the fresh empty PostgreSQL replay and Custom-services
   PostgreSQL journeys. Final clean-room Node 24, authenticated browser,
   provider test-mode, staging, operations, cutover and rollback proof has not
   run against one exact sealed candidate either.

## Row coverage and recount

- Canonical roadmap checkbox rows represented: 136 of 136.
- Added current checkpoint rows: H1M 5, H1N 12, aesthetic 9, Core architecture
  addendum 2, Responder expansion 1.
- Total classified rows: 165.
- Deferred rows excluded from denominators: 5.
- Count every exact status token in the Core and Expansion tables above; do not
  infer progress from prose, commit count, elapsed time, or historical test
  totals.

Roadmap coverage audit:

| Canonical roadmap section | Checkbox rows | Matrix IDs |
| --- | ---: | --- |
| Lane A | 7 | A-01 through A-07 |
| Lane B | 5 | B-01 through B-05 |
| Lane C | 5 | C-01 through C-05 |
| Lane D | 7 | D-01 through D-07 |
| Lane E | 9 | E-01 through E-09 |
| Lane F | 8 | F-01 through F-08 |
| Lane G | 6 | G-01 through G-06 |
| Lane H commercial contract | 2 | H-01 through H-02 |
| Lane H account/site authority | 5 | H-AUTH-01 through H-AUTH-05 |
| Lane H1 pre-commerce foundation | 14 | H1-01 through H1-14 |
| Assessment and findings | 8 | ASSESS-01 through ASSESS-05, EXP-ASSESS-06, DEF-ASSESS-07, EXP-ASSESS-08 |
| Outside-site onboarding/management | 6 | EXP-MGMT-01 through EXP-MGMT-06 |
| Quotes, invoices and jobs | 7 | EXP-QIJ-01, EXP-QIJ-02, QIJ-03 through QIJ-07 |
| Five existing-site revenue lanes | 5 | EXP-SVC-01 through EXP-SVC-05 |
| Customer and owner surfaces | 5 | SURFACE-01 through SURFACE-04, DEF-HQ-01 |
| Lane I domains/deferred offers | 12 | EXP-DOM-01 through EXP-DOM-07, I-08, EXP-DOM-09, I-10 through I-12 |
| Lane J release/proof | 11 | J-01 through J-11 |
| Deferred Batch 2D polish | 3 | DEF-B2D-01 through DEF-B2D-03 |
| Accepted launch-truth gates | 11 | TRUTH-01 through TRUTH-11 |
| Total | 136 | All represented exactly once |

Recount arithmetic:

- Core roadmap rows 108 + H1M 5 + H1N 12 + aesthetic 9 + architecture addendum 2 = 136.
- Core status recount: 64 DONE + 44 PARTIAL + 28 NOT STARTED + 0 EXTERNAL BLOCKER = 136; 64 / 136 = 47.1% after one-decimal rounding.
- Expansion roadmap rows 23 + Responder telephony 1 = 24.
- Deferred roadmap rows = 5.
- 136 + 24 + 5 = 165 total classified rows.
