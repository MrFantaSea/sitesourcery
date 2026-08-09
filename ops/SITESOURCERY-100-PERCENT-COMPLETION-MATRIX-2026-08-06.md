# Site Sourcery 100 percent completion matrix — 2026-08-06

Updated at: 2026-08-08T20:15:00-0400 (EDT)

Repository snapshot:

- Matrix branch: feat/privacy-v3-matrix-20260808, starting at 797d36d
- Historical integrated candidate: a0f024d (evidence reconciliation on top of
  checker-authority, held-Alakazam and migration-47 checkpoints)
- Current held go-live executable checkpoint:
  0dfd87e90d2142e78e9915951dcdffc866d6cacc, integrated fresh from a0f024d;
  exact proof is retained in
  ops/SITESOURCERY-GO-LIVE-CANDIDATE-EVIDENCE-2026-08-08.md.
- Roadmap reviewed completely: ops/SITESOURCERY-MULTI-AGENT-ROADMAP-2026-08-04.md, 921 lines
- Active ledger reviewed completely through the migration-47 seal:
  ops/SITESOURCERY-ACTIVE-RUN.md
- Package gates reviewed: package.json and server/data-plane/package.json
- H1M remains sealed at c4277ce, the distinct local public-page visual
  checkpoint is sealed at 2b0f9e0, and H1N Purpose 1 is sealed at 9a9511c.
  H1N migration 47 is sealed at f1c265e. Checker authority is integrated at
  81075b7 and held Alakazam surfaces at 3c008bb. The combined public/legal/
  checker/Work checkpoint is part of this evidence reconciliation. The exact
  held-tier public-truth correction is sealed at 1b73ce2, and migration 48 is
  sealed separately at bf53972.

## Authority, status, and percentage rules

This matrix is the deterministic source for completion reporting. The primary
operational metric is now the exact 12-row first-dollar launch-gate set below.
The full 136-checkbox roadmap plus checkpoint, aesthetic, architecture,
Privacy V3 and Responder rows remains visible as a separate historical inventory
metric. That broader number describes implemented scope; it is not a claim that
the release is ready for its first real customer payment.

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
- DEFERRED — deliberately outside the first-dollar and Expansion denominators
  until a dated owner ruling promotes it. A public promise can make held work a
  closure dependency of a first-dollar truth gate without creating a thirteenth
  denominator row.

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

- First-dollar launch-gate closure percent = 100 × DONE / 12, where the
  denominator is exactly J-01, J-05, TRUTH-05, AESTH-08, J-02, J-09, J-07,
  J-06, J-08, SURFACE-04, J-10 and J-11.
- Full-scope Core inventory percent =
  100 × CORE DONE / (CORE DONE + CORE PARTIAL + CORE NOT STARTED +
  CORE EXTERNAL BLOCKER). This is historical scope telemetry only.
- Expansion percent =
  100 × EXPANSION DONE / (EXPANSION DONE + EXPANSION PARTIAL +
  EXPANSION NOT STARTED + EXPANSION EXTERNAL BLOCKER).
- DEFERRED rows are listed but excluded from all active denominators.
- Percentages are rounded to one decimal place only after applying the formula.
- PARTIAL earns zero completion credit. This is intentionally strict.

Strict 100 percent rule:

First-dollar launch-gate closure is 100 percent only when all 12 exact rows are
DONE. A parent row cannot be DONE while one of its mapped Privacy V3 or held-
offer truth dependencies is open. The worktree used for release proof must be
explained and sealed; every sellable promise must pass its authenticated
end-to-end journey; every unavailable offer must be visibly held; the complete
Node 24 and clean-room PostgreSQL gates must pass against that exact source;
authenticated desktop/mobile/accessibility/security/staging proof, provider
test/live readiness, cutover and rollback must all be verified. Expansion
reaches 100 percent only when every non-deferred Expansion row is DONE. An
Expansion external blocker does not lower first-dollar closure when its public
offer is truthfully held and non-sellable.

## Derived snapshot

Counts and percentages are filled from the rows below and rechecked at the end
of this file.

| Finish line | DONE | PARTIAL | NOT STARTED | EXTERNAL BLOCKER | Denominator | Percent |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| FIRST-DOLLAR LAUNCH-GATE CLOSURE | 0 | 11 | 1 | 0 | 12 | 0.0% |
| FULL-SCOPE CORE INVENTORY (historical) | 106 | 34 | 6 | 0 | 146 | 72.6% |
| EXPANSION | 1 | 8 | 14 | 1 | 24 | 4.2% |
| DEFERRED inventory (5 rows) | 0 | 0 | 0 | 0 | excluded | n/a |

The non-credit progress signal is **11 PARTIAL / 1 NOT STARTED**. It shows that
substantial implementation exists without awarding release credit before any
whole launch gate is actually closed.

## Exact first-dollar launch-gate set

This table is the operational completion denominator. Its 12 IDs are existing
authority rows, not new requirements. H-AUTH-05 is absorbed into SURFACE-04 for
this finish line and is not counted a second time. Privacy V3 rows remain
explicit dependencies later in this file, but they do not increase this
denominator; an unresolved dependency keeps its mapped parent row open.

| ID | Status | Current evidence boundary | Required closure |
| --- | --- | --- | --- |
| J-01 | PARTIAL | 0dfd87e integrates held-offer/public truth and passes site/catalog/legal plus 45/45 browser gates. Privacy content is owner-approved at the exact review hash and nondeployably sealed; its actual-cutover tuple and replacement Website Terms remain open. | Approve and seal exact Website Terms, then finalize Privacy at the actual cutover UTC and rerun the exact-file gate. |
| J-05 | PARTIAL | Custom milestone/workmanship/payment truth passes on 0dfd87e and accepted Terms V2 remains immutable. The 12-item Website Terms V3 engineering diff has not received owner rulings or exact-artifact approval. | Approve one internally consistent replacement terms set for the three first-dollar offers and seal it as a new version. |
| TRUTH-05 | PARTIAL | Privacy review SHA-256 `1fdc50606115e31e61aad1063e724949f0e2efb3444aaba775a7db9c14523a14` at 25,994 bytes is owner-approved and content-sealed as `b040ee6c95830b732e18859eec6fe5ddfec56325e7357269fc5f0f14e6861d92`; release constants remain null and replacement Website Terms are proposed only. | Approve and finalize Website Terms, then finalize Privacy at the actual publication instant without changing V2 evidence. |
| AESTH-08 | PARTIAL | 0dfd87e legal routes pass all 320/390/1440 browser checks; the prior exact-candidate Lighthouse audit records accessibility 100 on every legal route. Approved Privacy content preserves the presentation, but the final Privacy tuple and canonical Terms bytes remain owner-gated. | Preserve this presentation while sealing the actual-cutover Privacy tuple and approved Website Terms artifact. |
| J-02 | PARTIAL | The exact candidate passes the authenticated assessment/quote/invoice/payment components in PostgreSQL, HTTP and browser tests; no one browser journey yet crosses public inquiry, account activation, quote, invoice, Stripe TEST payment and receipt. | Run and retain that bounded browser-to-database journey on the sealed legal candidate. |
| J-09 | PARTIAL | 0dfd87e passes 53 migrations, 22 real PostgreSQL journeys, 52 ops tests and provider contracts; no real Stripe TEST payment has been retained for the $200 assessment, variable Custom build and $5 Download on this candidate. | Execute the three provider test-mode payments plus the current-candidate operations evidence bundle in private staging. |
| J-07 | PARTIAL | Older private-staging evidence exists; 0dfd87e is locally proved but was not deployed because the current assignment prohibits deployment. | After owner authorization, deploy the exact sealed candidate privately and run new- and returning-customer journeys. |
| J-06 | PARTIAL | 0dfd87e passes 45/45 responsive browser checks and npm audit remains zero; the prior exact-candidate Lighthouse audit records accessibility/SEO 100, best-practices min 96 and performance average 89.1 with four routes at 71/78/81/84. | Correct the app/shared-asset performance cost without changing the design, then rerun Lighthouse on 0dfd87e or its legal-only successor. |
| J-08 | PARTIAL | 0dfd87e passes authenticated owner/customer fixtures at 390×844 and 1440×1000, but the owner has not completed and signed the physical Mac/Pixel operations walk. | Run the exact checklist on owner devices after private staging approval. |
| SURFACE-04 | PARTIAL | 0dfd87e passes fresh PostgreSQL 53/53, 22/22 journeys, 699/699 main Node, 19/19 self-host, 444 hosted passes plus 5 intentional skips, cross-tenant/failure/race/safe-projection proof and 45/45 browser widths, absorbing H-AUTH-05. Real Stripe TEST and one browser-to-database journey remain absent. | Add provider test-mode and integrated browser-to-database evidence on the exact sealed candidate. |
| J-10 | NOT STARTED | No owner walkthrough or reviewed production cutover record exists. | Complete internal gates, conduct the owner walkthrough and record explicit cutover approval. |
| J-11 | PARTIAL | The old release is retained, but the new build has no post-cutover DNS/TLS/live verification or exercised rollback. | After approved cutover, verify DNS/TLS/live behavior and prove exact rollback. |

Exact arithmetic: **0 DONE / 12 total = 0.0% first-dollar launch-gate
closure**. PARTIAL earns zero release credit. The 11 PARTIAL rows are a
non-credit signal of work in progress, not eleven nearly closed gates.

### Explicitly outside the 12-row first-dollar denominator

- Every full-scope row not named above remains useful historical inventory, but
  is not a current first-dollar blocker unless its public claim prevents J-01,
  J-05 or TRUTH-05 from closing.
- Remaining held Alakazam subscription work is deferred from this finish line:
  A-03, E-08, E-09, F-03, F-04, F-06, F-08 and G-02 through G-06. Its existing
  source and tests earn historical inventory status only; they do not delay a
  first dollar while the offer remains non-sellable.
- TRUTH-01 and TRUTH-02 are not standalone denominator rows. Under the owner's
  explicit held-posture ruling, they are DONE because 1b73ce2 makes the planned
  $25/$35/$50 tiers and every tier feature visibly unavailable, preserves zero
  commerce authority, and keeps existing customer code hidden/held. This
  satisfies their dependency without closing J-01 or TRUTH-05; those whole-row
  gates still require one integrated canonical candidate and its release proof.
- Registrar commerce, Responder telephony and the remaining Expansion catalog
  stay held/deferred until separately promoted by the owner.

## Full-scope Core inventory (historical)

### Lane A — customer billing truth and API

| ID | Requirement | Owner lane | Status | Exact proof location | Next action |
| --- | --- | --- | --- | --- | --- |
| A-01 | One bounded customer-safe subscription projection | Build | DONE | server/commerce-v2/alakazam-account.mjs:829-872; server/hosted/alakazam-postgres.mjs:5764; server/hosted/test/alakazam-account-postgres.test.mjs; commit 671e094 | Preserve contract while adding later reads. |
| A-02 | Read tier, status, paid period, renewal, pending change, cancellation and receipts from PostgreSQL | Build | DONE | server/hosted/alakazam-postgres.mjs:5764-6020; server/data-plane/tests/alakazam-postgres-contract.integration.test.mjs; commit 671e094 | Keep projection tests current through lifecycle work. |
| A-03 | Customer Alakazam invoice retrieval | Build | DONE | L3 is sealed at 793aaf7 and wired by 719b2ed: account-bound invoice projection/repository, exact GET route and browser view pass fresh PostgreSQL, HTTP, schema and three-width tests on 0dfd87e. The whole product remains held. | Preserve the exact read-only customer boundary while Alakazam remains outside first dollar. |
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
| E-09 | Stable retry, replay and reconciliation states in account UI | Build | DONE | L3 is sealed at 793aaf7 and wired into 0dfd87e: exact customer retry/replay/reconciliation projections and responsive billing views pass 3/3 real PostgreSQL journeys, schema tests and three widths while provider effects remain held. | Preserve the fail-closed projection and held provider boundary. |

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
| F-08 | Safe customer-authorized publication/rollback/unpublish controls | Build | DONE | L1 is sealed at 0c71cf7 and integrated/wired at 2d12155/2246aa1/0dfd87e: migration 101, project-bound PostgreSQL authority, exact authenticated GET/POST routes and responsive customer controls pass focused, full Node, 5 Alakazam core PostgreSQL and 45/45 browser proof. Every command remains immutable and held with `providerEffects:false`. | Preserve the held authorization boundary; no provider/apply route is authorized. |

### Lane G — lifecycle and reconciliation

| ID | Requirement | Owner lane | Status | Exact proof location | Next action |
| --- | --- | --- | --- | --- | --- |
| G-01 | Inventory events, schema capacity, missing transitions and decisions | Build | DONE | ops/SITESOURCERY-ALAKAZAM-LIFECYCLE-INVENTORY-2026-08-04.md; commit 3ad0911 | Use inventory as implementation order. |
| G-02 | Renewal success and new-period projection | Build | DONE | L2 is sealed at 0c9362a and wired by 719b2ed; migration 49 plus the renewal service/repository pass 3/3 exact real-PostgreSQL renewal, idempotency and projection-fence journeys inside the 22/22 release proof on 0dfd87e. Provider effects remain held. | Preserve the readback/event/receipt fences while the offer stays unavailable. |
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
| H-AUTH-05 | Cross-tenant/site denial and no browser claim of money, credit, units, job or provider authority | Build | PARTIAL | Extensive request/quote/payment/job denial tests exist in custom-service-quotes-postgres.integration.test.mjs and hosted HTTP tests; canonical site asset and all remaining commands are incomplete | Extend adversarial proof to site asset, support and every final owner operation; for first-dollar arithmetic this evidence is absorbed by SURFACE-04, not counted again. |

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
| QIJ-04 | Invoice, deposit/milestone/balance, provider settlement, receipt, retry and uncertain-payment reconciliation | Build | DONE | Assessment and first Custom payment are sealed through migration 42; accepted-change payment is sealed at 9a9511c; final obligation/payment is sealed at f9950ae; durable provider-confirmed receipt, exact zero-balance clearance, retry and command-bound owner reconciliation are exercised by the maintained all-47 PostgreSQL and hosted/API suites recorded in the active ledger | Preserve each financial purpose and its no-browser-mark-paid boundary. |
| QIJ-05 | Job, checklist, dependency, safe access, evidence, deliverable, completion, 30-day correction and handoff | Build | DONE | Migrations 43/44 retain progress/completion; migration 47 and custom-services-custom-build-handoff-postgres.mjs add one immutable delivery document, terminal write guards and database-derived 30-day `[start,end)` window; maintained PostgreSQL/API/browser proof is recorded in the active ledger | Preserve completion/handoff finality and the handoff-derived clock. |
| QIJ-06 | Paid-job subset: three stages, four milestones, one bounded request and owner resolution | Build | DONE | migration 202608060043; custom-build-progress-postgres.mjs and tests; commit a46fb40; H1M post-completion finality sealed by c4277ce | Preserve the sealed progress and completion finality through H1N. |
| QIJ-07 | Formal change orders, completion evidence, final payment, delivery receipt and 30-day boundary | Build | DONE | H1M is sealed at c4277ce, accepted-change payment at 9a9511c, final payment at f9950ae, and migration 47 provides the settlement/clearance-gated immutable handoff and exact workmanship interval; all-47 PostgreSQL and three-width browser journeys prove the ordered path | Preserve the one-way sequence and rerun it in final staging. |
| SURFACE-01 | Responsive Mac/Pixel owner assessment review and quote issue | Build | DONE | owner quote desk source/tests; browser controls; commit f2ee0b5 | Re-run in final owner journey. |
| SURFACE-02 | Customer views for full assessment/onboarding/quote/invoice/payment/job/access/change/handoff/management/recovery lifecycle | Build | PARTIAL | Assessment and Custom-through-H1M completion views are sealed; onboarding, H1N payment/handoff, management, tickets and some recovery states do not exist | Complete H1N and only then Expansion views. |
| SURFACE-03 | Mac/Pixel owner search and bounded operations for full client/site/payment/job/access/management/ops/reconciliation lifecycle | Build | PARTIAL | Owner assessment, paid-job, progress and H1M change/completion controls are sealed at c4277ce; broad search, final settlement, management and reconciliation are absent | Add launch-critical owner operations and prove no mark-paid shortcut. |
| SURFACE-04 | Every journey against fresh PostgreSQL, provider test mode, authenticated desktop/mobile, race/failure and safe projections | Polish/Integration | PARTIAL | 0dfd87e passes fresh PostgreSQL 53/53, 22/22 journeys, cross-tenant/failure/race/safe-projection proof and 45/45 browser widths; first-dollar closure absorbs H-AUTH-05 here. Real Stripe TEST and one integrated browser-to-database journey remain absent. | Run the three real provider test-mode payments and the exact browser-to-database journey on the sealed legal candidate. |

### Core truth holds for Domains and Responder

| ID | Requirement | Owner lane | Status | Exact proof location | Next action |
| --- | --- | --- | --- | --- | --- |
| I-08 | Remove direct domain Stripe checkout, charge-before-registration and refund promises | Aesthetic + Polish/Integration | DONE | commit ea38093; domains/domain-search.js and domains/index.html expose inquiry/preflight only; server/commerce/rails.mjs and maintained domain public-truth/site/artifact tests prove zero public Checkout, charge or refund authority | Keep registrar commerce held until its separate Expansion authority is releasable. |
| I-10 | Keep held domain storefront distinct from paid email/domain configuration, move and rescue work | Aesthetic + Polish/Integration | PARTIAL | Commercial contract/audit separates services; current Domains page still presents active buy/manage offers without a complete held boundary | Make storefront visibly non-sellable and cross-link separately scoped services only. |
| I-11 | Keep The Responder operationally and commercially held until telephony fulfillment is real | Aesthetic + Polish/Integration | DONE | commit ea38093; responder/index.html, FAQ/legal truth and maintained release/public-copy tests classify the examples as held and non-sellable; server/commerce/rails.mjs exposes no Responder checkout authority | Preserve the hold until real telephony/A2P fulfillment is independently released. |
| I-12 | Expansion items do not block platform-subdomain launch | Build + Polish/Integration | DONE | Separate Alakazam release config/holds and this Core/Expansion split; roadmap:417-418 | Keep held public truth while Expansion proceeds independently. |

### Lane J — release and proof

| ID | Requirement | Owner lane | Status | Exact proof location | Next action |
| --- | --- | --- | --- | --- | --- |
| J-01 | Reconcile all public copy, links, legal, support and pricing | Aesthetic + Polish/Integration | PARTIAL | 0dfd87e integrates held-offer/public truth and passes catalog/site/legal plus 45/45 browser gates. Privacy content is approved and nondeployably sealed; its cutover tuple and replacement Terms are open. | Approve exact Terms and seal the actual-cutover legal set, then rerun its exact-file gate. |
| J-02 | Replace direct assessment payment with account offer/invoice/payment and exact bounded scope | Build + Aesthetic | PARTIAL | 0dfd87e passes authenticated assessment/Custom PostgreSQL, HTTP and browser component proof, but no one browser journey crosses public inquiry, activated account, quote, invoice, Stripe TEST payment and receipt. | Run that exact browser-to-database journey on the sealed legal candidate. |
| J-03 | One restrained “Have a website already?” section for five later lanes | Aesthetic | NOT STARTED | No consolidated five-lane section found in current homepage/custom candidate; homepage is design-locked | Add only in an approved non-home route or obtain cross-lane decision if homepage placement is required. |
| J-04 | Publish approved starting prices/exclusions and explain stacking without duplicate work | Aesthetic + Polish/Integration | PARTIAL | Custom prices exist; overlap engine/later services are incomplete and public stacking language is not reconciled | Publish only currently supported prices; hold Expansion offers and add dedup language. |
| J-05 | Reconcile terms for onboarding, milestones, workmanship, management, plan changes, provider costs and lawful cancellation | Polish/Integration + Aesthetic | PARTIAL | 0dfd87e proves Custom milestone, settlement, handoff and workmanship truth while accepted Terms V2 remains immutable; the 12-item Website Terms V3 review remains owner-gated. | Approve and seal one exact replacement terms set for only the first-dollar offers. |
| J-06 | Complete mobile, desktop, accessibility, performance and security audits | Polish/Integration | PARTIAL | 0dfd87e passes 45/45 responsive checks and npm audit remains 0/67; prior candidate Lighthouse accessibility/SEO is 100 on all routes, best-practices min 96 and performance average 89.1 with four routes at 71/78/81/84. | Correct the app/shared-asset performance cost without changing the design, then rerun the same audit on the final legal candidate. |
| J-07 | New and returning customer journeys in private staging | Polish/Integration | PARTIAL | The exact candidate is locally proved; private staging still serves older d7c33c7 evidence because current authority prohibits deployment. | After owner authorization, deploy the exact sealed candidate privately and run both journeys. |
| J-08 | Owner Mac and Pixel operations journeys | Polish/Integration | PARTIAL | 0dfd87e passes authenticated owner/customer browser fixtures at 390×844 and 1440×1000; no physical owner-device sign-off exists. | Run the owner checklist on Mac and Pixel after private staging approval. |
| J-09 | Prove email, Stripe test payments, hosting, support, invoice, backup, restore, monitoring, alerting and rollback | Polish/Integration | PARTIAL | 0dfd87e passes 53 migrations, 22 real PostgreSQL journeys, provider contracts and 52 ops tests, but no real Stripe TEST payment exists for assessment, Custom and Download on this candidate. | Execute those three payments plus current-candidate staging/operations evidence. |
| J-10 | Owner walkthrough and reviewed production cutover | Owner/cutover | NOT STARTED | Public production remains July 22 predecessor per active ledger:32-34; no cutover record exists | Complete internal gates, conduct walkthrough, request explicit cutover approval. |
| J-11 | Verify DNS/TLS/post-cutover and retain old-release rollback | Owner/cutover | PARTIAL | Old release is retained as fallback; no new-build cutover, post-cutover DNS/TLS or rollback exercise exists | At approved cutover, verify DNS/TLS/live behavior and rehearse exact rollback. |
| J-12 | One Core release command runs fresh empty PostgreSQL migration replay and Custom-services PostgreSQL journeys | Build + Polish/Integration | DONE | scripts/core-release.mjs and scripts/test/core-release.test.mjs; commit 3f10235; exact Node 24 all-47 command recorded in the active ledger created one named disposable database, replayed all migrations, passed 4/4 Custom-services journeys, removed it and returned `databaseAbsent:true` before the complete candidate gates passed | Keep this exact command mandatory for every final release candidate. |

### Accepted launch-truth gates

| ID | Requirement | Owner lane | Status | Exact proof location | Next action |
| --- | --- | --- | --- | --- | --- |
| TRUTH-01 | Keep planned $25/$35/$50 Alakazam subscriptions and $20/$30/$45 first-payment outcomes visibly unavailable while subscription fulfillment is held | Aesthetic + Polish/Integration | DONE | Owner approved visible unavailability as closure; sealed commit 1b73ce2 puts exact $25/$35/$50 unavailable copy in FAQ and non-accepted public Website Terms, offers no subscription/hosting activation/publication/tier feature, preserves zero commerce authority, and passes the focused 99/99 suite plus independent `BLOCKER: NO` | Preserve the exact unavailable disclosure and narrow checker exception until the owner separately promotes and proves subscription fulfillment. |
| TRUTH-02 | Keep $35+ version-history and $50 Cash App/Venmo tier features visibly unavailable and hidden while those tiers are held | Build + Aesthetic | DONE | Sealed commit 1b73ce2 states that no tier feature is offered; narrow pricing/site checks allow the exact unavailable disclosure only and still reject any other held-tier price occurrence, while existing customer implementation remains excluded/hidden and commerce authority stays absent; independent review reports `BLOCKER: NO` | Implement or expose premium controls only after a separate owner promotion, complete authority, and end-to-end proof. |
| TRUTH-03 | Replace “$25 = your own .com” with label.sitesourcery.me | Aesthetic + Polish/Integration | DONE | Combined public-truth/legal checkpoint at 81075b7 and 3c008bb reconciles hosted fragments and legal language to `label.sitesourcery.me`; checker-authority and 99/99 public/legal/Work preflight gates pass | Preserve the platform-subdomain truth until a registrar/product authority is released. |
| TRUTH-04 | Remove invented cancellation, grace, suspension, retention, deletion and refund language until policy is approved | Aesthetic + Polish/Integration | DONE | Combined legal/public truth at 81075b7 and 3c008bb removes unsupported lifecycle/refund claims; 99/99 public-truth, legal, checker-authority and Work preflight proof is green | Reintroduce policy only from a separately approved, executable authority. |
| TRUTH-05 | Canonical legal/privacy for accounts, billing changes, publication, support and all tiers | Polish/Integration + Aesthetic | PARTIAL | 0dfd87e reproduces the owner-approved Privacy review SHA-256 `1fdc50606115e31e61aad1063e724949f0e2efb3444aaba775a7db9c14523a14`, 25,994 bytes, and content seal `b040ee6c95830b732e18859eec6fe5ddfec56325e7357269fc5f0f14e6861d92`; release constants remain null and replacement Terms remain proposed only. | Approve exact Terms, finalize both artifacts at actual cutover without changing V2 evidence, then rerun legal/copy/browser proof. |
| TRUTH-06 | Remove five legacy direct Stripe Payment Links from all public and production artifacts | Build + Aesthetic | DONE | commit ea38093 removes the direct-link rails and legacy paid bridge from reviewed artifacts; scripts/check-site.mjs, domain-public-truth and hosted-artifact tests require zero public checkout rails while authenticated purpose-specific server Checkout remains private | Preserve zero direct payment links in both Pages and hosted artifacts. |
| TRUTH-07 | Assessment intake, written offer, account invoice and payment sequencing | Build | DONE | migrations 34-39; authenticated routes/tests; commits ccce671 through 5c34845 | Re-run as part of final public-to-account journey. |
| TRUTH-08 | Minimum Custom estimate/invoice/deposit/milestone/job ledger before advertised operational | Build | DONE | Migrations 41-47, commits 9221072/52644fa/a46fb40/c4277ce/9a9511c/f9950ae and the migration-47 checkpoint provide estimate, accepted scope, first/change/final invoices and settlement, retained job/progress/completion, immutable handoff and 30-day workmanship authority; active ledger records all-47 PostgreSQL and browser proof | Preserve the full ordered ledger in staging and production release proof. |
| TRUTH-09 | Hold domain storefront and remove direct Stripe, charge and refund language until registrar authority is releasable | Aesthetic + Polish/Integration | DONE | commit ea38093; domain storefront is inquiry/preflight-only, server rails expose no charge/refund action, and maintained domain/site/artifact checks reject direct payment or refund authority | Keep held until registrar/reseller Expansion proof is complete. |
| TRUTH-10 | Hold active Responder sales and operational claims until telephony/A2P is real | Aesthetic + Polish/Integration | DONE | commit ea38093; Responder examples are explicitly held/non-sellable in public, FAQ and legal truth; maintained release tests and zero public rails enforce the hold | Reopen only after telephony/A2P journey proof. |
| TRUTH-11 | Exclude legacy browser localStorage accounts, honor-paid state and direct-payment scripts from both GitHub Pages and hosted production artifacts | Build | DONE | commit ea38093; the reviewed 74-file Pages artifact and hosted artifact exclude legacy account/honor-paid/direct-payment scripts; hosted-artifact/site checks fail on their return | Preserve authenticated server authority and exact artifact allowlists. |
| TRUTH-12 | Reconcile the inquiry-only public catalog with the release checker's five-sellable-rails model | Build + Polish/Integration | DONE | commit ea38093; data/public-catalog.json, server/commerce/rails.mjs and scripts/check-site.mjs classify seven offers explicitly and report zero public checkout rails; exact public/catalog/site tests are green | Require per-offer fulfillment authority before any rail becomes sellable. |

### Privacy V3 program

These rows are full-scope Core addenda beyond the 136 canonical roadmap
checkboxes. They stay visible as critical dependencies, but do not add ten more
items to the 12-row first-dollar denominator. A sealed isolated branch remains
PARTIAL until its authority and maintained proof are integrated into the release
candidate. Dirty work earns no completion credit.

Dependency mapping for first-dollar closure:

- PV3-01, PV3-02, PV3-07 and PV3-10 feed J-01, J-05, TRUTH-05 and AESTH-08.
- PV3-03 through PV3-06, PV3-08 and PV3-09 feed J-02, J-09, J-07, J-06,
  J-08 and SURFACE-04.
- Every unresolved PV3 row remains part of the evidence boundary for J-10 and
  J-11. No PV3 row is counted again as a thirteenth launch gate.

Owner decisions recorded for this program on 2026-08-07 and retained here as
durable matrix authority:

- Existing V2 projects are not forced to re-accept V3.
- Cutover may hold only new project creation; reads, static pages, sign-in,
  recovery, existing-project read/edit, already-paid repeat Download, export,
  deletion and contact stay live.
- The V3 version, effective UTC time, byte count and digests are frozen only
  after the owner reviews the exact rendered artifact.

| ID | Requirement | Owner lane | Status | Exact proof location | Next action |
| --- | --- | --- | --- | --- | --- |
| PV3-01 | Retain and publish the exact immutable Privacy V2 evidence artifact without changing its bytes | Build + Polish/Integration | DONE | Phase A and B are integrated in 0dfd87e; the exact-file release gate and direct hash proof retain `legal/privacy/versions/SS-HOSTED-PRIVACY-2026-07-30-V2/index.html` at 19,935 bytes and SHA-256 `b57979f99f7176b7d83d7d9efad9893fb87605c2f51511ced79982675f98a06b`. | Preserve this byte identity through legal finalization and cutover. |
| PV3-02 | Produce byte-identical hosted Privacy V3 live/versioned artifacts and a deterministic fail-closed finalizer after separately reviewed copy | Aesthetic + Polish/Integration | PARTIAL | 0dfd87e reproduces the approved review and release-normalized template, with content seal `b040ee6c95830b732e18859eec6fe5ddfec56325e7357269fc5f0f14e6861d92`; published/deployable are false and release constants remain null. | At the actual cutover UTC, run the finalizer once, integrate byte-identical current/versioned artifacts and rerun the exact gate. |
| PV3-03 | Add transactional migration 48 for legal artifacts, exact project acceptance receipts, immutable history, RLS, privileges, and runtime contract | Build | PARTIAL | commit bf53972 seals `202608060048_hosted_privacy_v3.sql` and its structure/empty-migration proof changes; the migration deliberately aborts while its release tuple is unsealed, so no executable release claim exists | After PV3-10 freezes the exact constants, integrate the sealed migration and prove it in fresh PostgreSQL; do not treat structural proof as release proof. |
| PV3-04 | Make PostgreSQL readiness prove exact v48 catalog, V2/V3 artifacts, authority constants, and fail-closed project creation | Build | PARTIAL | commit f60e933 seals the six-file backend authority correction and bf53972 seals the migration/readiness structure; no integrated exact-v48 PostgreSQL run with a final tuple exists | Prove the exact sealed tuple and fail-closed boundary in fresh PostgreSQL after owner-approved constants are available. |
| PV3-05 | Expose the four-key public project legal authority and require exact three-document acceptance only on project creation | Build | PARTIAL | commit f60e933 seals differentiated held/ready authority, exact bundle validation, rogue-artifact rejection, 409 behavior and private user-agent handling; bf53972 seals migration-48 receipt authority, but end-to-end PostgreSQL/HTTP evidence is absent | After the legal tuple is frozen, prove receipt idempotency, V2 history, tenant denial and forwarded-IP handling end to end. |
| PV3-06 | Render unchecked consent, exact links/version, save-path acceptance, 409 recovery, invalidation, and V2 history in Abracadabra | Build + Aesthetic | DONE | UI commit de7b446 is integrated after L1 at 2246aa1/0dfd87e. Focused API/DOM tests and the 45/45 browser gate prove unchecked exact capture, stale 409 recapture, session/organization invalidation, V2 history, keyboard focus and zero overflow. | Preserve the exact authority shape and fail-closed recapture behavior through final legal constants. |
| PV3-07 | Show Domains just-in-time DNS disclosure immediately before Check, with no pre-action DNS request | Aesthetic + Polish/Integration | DONE | Phase A and B are integrated in 0dfd87e; domain-public-truth proves zero pre-action request and exactly three cleaned Cloudflare NS queries after click or Enter, while the 45-width browser gate proves the integrated Domains layout. | Preserve the exact disclosure and no-registrar boundary. |
| PV3-08 | Preserve existing V2 acceptance without forced reacceptance and hold only project creation during cutover | Build + Owner/cutover | PARTIAL | Owner decisions freeze no forced V2 reacceptance and a project-creation-only hold; f60e933 reads required-term history and bf53972 adds sealed continuity proof scaffolding, but no integrated v48 proof exists | Prove V2 current/history after later acceptance and show that all non-creation continuity routes remain live during the hold. |
| PV3-09 | Prove the Privacy-specific v47-to-v48 upgrade, unchanged V2 evidence/current pointers, exact V3 receipt bundle, and fresh empty-v48 replay | Polish/Integration | PARTIAL | Commit bf53972 seals the executable migration 48 and disposable-database proof harness; final V3 constants and a retained successful exact-tuple run are absent | After PV3-10, run the dedicated upgrade/empty-database proof and obtain an independent blocker verdict; general release/browser gates remain owned by Lane J. |
| PV3-10 | Obtain owner/legal approval of the exact rendered V3 artifact and freeze its version, effective UTC, byte count and digests exactly once | Owner/cutover + Polish/Integration | PARTIAL | Owner approved exact review SHA-256 `1fdc50606115e31e61aad1063e724949f0e2efb3444aaba775a7db9c14523a14` at 25,994 bytes; content seal `b040ee6c95830b732e18859eec6fe5ddfec56325e7357269fc5f0f14e6861d92` records no release constants. Actual publication UTC, matching version, final bytes and authority digest remain intentionally open. | At the owner-gated cutover moment, capture actual UTC, use its UTC date for the V3 version, run the finalizer once and carry the tuple unchanged. |

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
| H1N-CO-01 | Enforce the financial-purpose ordering gate for every accepted_payment_required change before completion/final obligation | Build | DONE | migrations 44/45; v45 shared H1M lock and receipt-only effective transition; executable lock-order test at custom-services-custom-build-change-payment-postgres.test.mjs:747; active ledger Purpose-1 checkpoint; checkpoint commit containing this matrix | Preserve the gate; Purpose 2 may reserve nothing until every accepted change is effective. |
| H1N-CO-02 | Materialize one exact immutable change-order invoice and line set for every accepted_payment_required change | Build | DONE | migration 202608060045:128-406 materializes immutable invoice/line authority at exactly `$125 × units`; PostgreSQL Custom-services journey and migration structure proof; active ledger Purpose-1 checkpoint | Preserve one invoice per accepted change and its quote/disclosure/scope digest binding. |
| H1N-CO-03 | Use a dedicated change-order Checkout purpose with retained attempt/event authority | Build | DONE | migration 202608060045 Checkout attempt/event tables; custom-services-custom-build-change-payment-postgres.mjs; Stripe adapter and provider tests; HTTP/composition/webhook tests; active ledger Purpose-1 checkpoint | Keep this purpose isolated from assessment, first-payment and future final-payment authority. |
| H1N-CO-04 | Record a provider-confirmed change-order settlement receipt bound to the exact invoice and Checkout attempt | Build | DONE | migration 202608060045:940-1167 immutable receipts and provider-fact validation; durable reconciliation commands at 664-797; service replay/conflict test at lines 848-925; focused 54/54 and integrated 186/186 evidence in active ledger | Preserve provider readback, immutable evidence and owner-only ambiguity handling; never add browser mark-paid authority. |
| H1N-CO-05 | Atomically record the confirmed receipt and transition accepted_payment_required to effective | Build | DONE | migration 202608060045:1292-1518 receipt-triggered effective transition; PostgreSQL assessment-to-paid-change journey; customer/owner projections and exact three-viewport browser audit; active ledger Purpose-1 checkpoint | Start Purpose 2 only from the resulting all-changes-effective boundary. |

#### Purpose 2 — final obligation, settlement and handoff

| ID | Requirement | Owner lane | Status | Exact proof location | Next action |
| --- | --- | --- | --- | --- | --- |
| H1N-FINAL-01 | After all accepted changes are effective and completion is evidenced, derive the exact final obligation from accepted quote/installment and effective scope | Build | DONE | migration 202608060046 obligation/completion prerequisites and immutable digests; final-payment PostgreSQL service/tests; active-ledger migration-46 checkpoint; checkpoint commit containing this matrix | Preserve this exact obligation as migration 47 consumes it for handoff. |
| H1N-FINAL-02 | Materialize the final invoice and immutable line items, including an explicit zero-balance path | Build | DONE | migration 202608060046 final invoice/line and explicit zero-balance-clearance authority; migration structure and real all-46 replay; active-ledger migration-46 checkpoint | Keep zero clearance explicit and prohibit zero/forged Checkout creation. |
| H1N-FINAL-03 | Use a dedicated final-payment Checkout purpose with retained attempt and event ledger | Build | DONE | final-payment service, Stripe adapter/config, migration-46 attempts/events/global purpose fence, HTTP/composition/webhook tests; active-ledger migration-46 checkpoint | Preserve global first/change/final effect isolation and held-by-default new creation. |
| H1N-FINAL-04 | Require provider-confirmed final settlement or explicit database-authorized zero-balance clearance | Build | DONE | migration-46 immutable receipt/clearance triggers; exact provider line-item/readback checks; durable owner replay/conflict; 7/7 service, 195/195 independent and all-46 clean-room proof in active ledger | Permit migration-47 handoff only from these two exact authorities. |
| H1N-FINAL-05 | Create immutable handoff/delivery receipt only after final settlement/clearance and close later work writes | Build | DONE | migration 202608060047 creates one unique-job immutable handoff receipt and canonical customer document only after exact provider receipt or zero-balance clearance; H1M advisory-lock serialization, terminal write guards, receipt-count/race proof and handoff service tests are maintained; active ledger records all-47 PostgreSQL proof | Preserve unique `job_id`, financial prerequisites, exact command replay and terminal finality. |
| H1N-FINAL-06 | Expose bounded customer and owner final-obligation/payment/handoff projections and responsive journeys | Build | DONE | custom-services-account-hosted.mjs, http.mjs, abracadabra-api.js and customer controls keep payment and two-capability handoff readiness separate; maintained API/DOM/browser proof covers paid and zero paths, retained errors, delayed authority, no provider IDs, 44px controls and exact 320/390/1440 widths | Preserve capability separation and fail-closed terminal/unknown rendering. |
| H1N-FINAL-07 | Derive immutable 30-day workmanship start/end in PostgreSQL from evidenced handoff | Build | DONE | migration 202608060047 derives exact UTC start at handoff and end at 720 hours with `[start,end)` semantics; stored canonical document carries the same millisecond-Z facts; real PostgreSQL and both paid/zero browser journeys assert exact dates and coverage wording | Keep the clock database-derived from immutable handoff only. |

### Owner-directed aesthetic launch corrections

The aesthetic lane owns vnext.css, visual assets, and the listed public route
presentation. Commit 2b0f9e0 proves the local visual portion for AESTH-01
through AESTH-08 and leaves the homepage design locked. Rows that also require
commercial/public truth remain PARTIAL until that separate lane is sealed.

| ID | Requirement | Owner lane | Status | Exact proof location | Next action |
| --- | --- | --- | --- | --- | --- |
| AESTH-01 | Domains uses its own storefront background, no floating duplicate, readable frosted hero and mobile containment | Aesthetic | DONE | commit 2b0f9e0; page-scoped environment/CSS/assets; maintained 15-route exact-width browser audit | Preserve the visual checkpoint while the separate Domains truth lane finishes. |
| AESTH-02 | Custom Sorcery route has unique page presentation and no arbitrary floating repeated graphics | Aesthetic | DONE | commit 2b0f9e0; distinct Custom environment and exact-width browser audit | Preserve presentation; commercial authority remains a separate truth obligation. |
| AESTH-03 | Responder removes planner/floating art, shows the whole five-step flow directly and is held/non-sellable | Aesthetic | DONE | visual presentation is sealed at 2b0f9e0; held/non-sellable public, FAQ and legal truth plus maintained checks are sealed at ea38093; current 15-route exact-width browser audit is green | Preserve the visual flow and operational hold until Responder Expansion is real. |
| AESTH-04 | Work/Spell Book is an explorable work gallery without clutter or invented client claims | Aesthetic | DONE | Visual gallery is sealed at 2b0f9e0; Work public-truth/preflight and founder/fictional-claim audit are sealed by the integrated 81075b7/3c008bb checkpoint with 99/99 combined public/legal/checker/Work proof | Preserve the explorable gallery and claim boundaries. |
| AESTH-05 | About has its own awesome page background/presentation | Aesthetic | DONE | commit 2b0f9e0; `one-person-studio` asset/page class; exact-width browser audit | Preserve. |
| AESTH-06 | Contact has its own awesome page background/presentation | Aesthetic | DONE | commit 2b0f9e0; `signal-room` asset/page class; exact-width browser audit | Preserve form/contact readability. |
| AESTH-07 | FAQ has its own awesome page background/presentation | Aesthetic | DONE | commit 2b0f9e0; `index-room` asset/page class; exact-width browser audit | Preserve visual behavior while FAQ copy is sealed separately. |
| AESTH-08 | Legal routes have their own readable presentation and canonical copy | Aesthetic + Polish/Integration | PARTIAL | 0dfd87e integrates the `archive-room` legal presentation and passes 320/390/1440 browser checks; prior exact-candidate Lighthouse records accessibility 100 on every legal route. Privacy content is approved, but the actual-cutover tuple and final Terms copy remain owner-gated. | Preserve the proved presentation while sealing the exact canonical legal release set. |
| AESTH-09 | Homepage design remains locked and is not altered by route corrections | Aesthetic | DONE | commit 2b0f9e0 excludes homepage visual changes; coordination directive locks its design | Keep visual design unchanged unless the owner explicitly reopens it; truth-only work remains separate. |

## EXPANSION matrix

These rows do not lower first-dollar launch-gate closure while their public
offers are explicitly held and non-sellable. They determine the separate
Expansion percentage.

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
| DEF-HQ-01 | Expose same contracts to Fantasealand Desiderata Labs HQ without second authority | Deferred Integration | DEFERRED | Roadmap:380-381; no HQ integration in this repo | Promote only after first-dollar launch is sealed and the owner reopens this scope. |
| DEF-B2D-01 | Decide whether HTTP command identity enters durable downgrade scheduler | Deferred Build | DEFERRED | Roadmap:878-880; current durable quote/application idempotence is tested | Promote only on a concrete audit finding. |
| DEF-B2D-02 | Add application-layer scheduled-boundary assertion beyond PostgreSQL enforcement | Deferred Build | DEFERRED | Roadmap:881-883; database already enforces boundary | Promote during nearby lifecycle work if low-risk. |
| DEF-B2D-03 | Move temporary successful-schedule/failed-refresh Chrome case into maintained harness | Deferred Polish | DEFERRED | Roadmap:884-887; source regression and historical Chrome proof exist | Promote when browser harness is standardized. |

## Immediate next action

Close the 12-row finish line in dependency order. First complete owner/legal
approval of the exact Privacy V3 tuple, integrate sealed migration-48 commit
bf53972, review/seal the remaining Abracadabra work, and carry the sealed
1b73ce2 Website Terms/FAQ held-tier correction into one canonical candidate
without changing accepted hosted Terms V2 bytes. Then close J-01, J-05,
TRUTH-05 and AESTH-08. Prove J-02 and SURFACE-04 next, followed by
the exact-candidate provider, staging, audit and owner journeys in J-09, J-07,
J-06 and J-08. J-10 and J-11 remain last. Keep merge, push, deployment, live
provider effects and DNS held until their explicit gates authorize them.

## Current evidence gaps that control the next actions

1. H1N Purpose 1 is sealed at 9a9511c, migration 46 at f9950ae, and migration
   47 at f1c265e. The historical integrated candidate proves the complete
   Custom handoff path and its combined public/legal/checker/Work truth, but it
   predates all Privacy V3 work.
2. Privacy V3 Phase B, backend, migration 48 and Abracadabra UI are integrated
   in 0dfd87e. The owner-approved review has a nondeployable content seal, and
   the 53-migration disposable-tuple proof plus legal browser journey pass. The
   actual publication UTC, matching version, final artifact digest/bytes and
   authority digest remain intentionally unset until cutover.
3. The non-accepted public Website Terms and FAQ held-tier correction is sealed
   at 1b73ce2 with focused 99/99 proof and independent `BLOCKER: NO`. It must be
   integrated into the coordinated versioned legal release while accepted
   hosted Website Terms V2 remains byte-identical.
4. Alakazam invoice, lifecycle, reconciliation and held publication authority
   are integrated, but Portal/cancellation effects, $35/$50 commerce and every
   provider/publication effect remain outside the first-dollar finish line.
   Commit 1b73ce2 closes the visible-unavailability dependency with no commerce
   authority; every subscription rail remains held.
5. Public/catalog/domain/Responder hold truth is sealed through ea38093,
   81075b7 and 3c008bb. That proves non-sellability, not fulfillment readiness.
6. Exact Node 24 Core run on executable checkpoint 0dfd87e created
   `ss_core_release_20260809t002028962z_ef642e68df59`, replayed all 53
   migrations, passed 22/22 real PostgreSQL journeys, removed and proved
   absence, then passed 699/699 main Node, 19/19 self-host, 444 hosted-service
   passes plus 5 intentional skips, 52/52 ops, 76/76 Pages files and the 45/45 browser gate.
   Result: `databaseAbsent:true`. Provider test mode, private staging, owner
   devices, cutover and rollback execution remain held.

## Row coverage and recount

- Canonical roadmap checkbox rows represented: 136 of 136.
- Added current checkpoint rows: H1M 5, H1N 12, aesthetic 9, Core architecture
  addendum 2, Privacy V3 10, Responder expansion 1.
- Total classified rows: 175.
- Deferred rows excluded from denominators: 5.
- First-dollar operational denominator: exactly 12 existing IDs; the PV3 rows
  and absorbed H-AUTH-05 evidence must not be counted again.
- Count every exact status token in the historical Core and Expansion tables;
  do not infer completion from prose, commit count, elapsed time, or historical
  test totals.

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

- First-dollar launch gates: 0 DONE + 11 PARTIAL + 1 NOT STARTED + 0 EXTERNAL
  BLOCKER = 12; 0 / 12 = 0.0%. Non-credit progress signal: 11/12 have partial
  implementation or evidence.
- Core roadmap rows 108 + H1M 5 + H1N 12 + aesthetic 9 + architecture addendum 2 + Privacy V3 10 = 146.
- Historical Core status recount: 106 DONE + 34 PARTIAL + 6 NOT STARTED + 0
  EXTERNAL BLOCKER = 146; 106 / 146 = 72.6% after one-decimal rounding.
- Expansion roadmap rows 23 + Responder telephony 1 = 24.
- Deferred roadmap rows = 5.
- 146 + 24 + 5 = 175 total classified rows.
