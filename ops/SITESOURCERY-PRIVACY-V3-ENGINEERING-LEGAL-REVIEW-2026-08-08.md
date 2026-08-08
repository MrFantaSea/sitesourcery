# Site Sourcery Privacy V3 engineering and legal-operations review — 2026-08-08

> **Status: engineering owner-review and correction record. The source remains unsealed; do not publish it or treat this record as legal advice.**
>
> This is an engineering review of whether the draft describes the code and database truth, plus legal-operations issue spotting. It is not a legal opinion and does not decide which statutes apply. Optional counsel review is recommended but is separate and nonblocking; the owner gives the final content sign-off in this engineering workflow.
>
> **2026-08-08 owner-fact update:** the owner supplied the exact New Jersey filed alternate name and current privacy contact routes recorded below. This is owner-supplied verification, not independent official-record proof or approval of the exact rendered review bytes.

The Phase-B checkpoint at commit `2222f3beac6528df3ce633ca62982efee578e725` is a pre-review draft checkpoint, not approved immutable evidence. This review does not change either privacy fragment. No Privacy V3 release version, effective time, full-page release digest, release byte count, or authority digest is assigned here.

## Scope and method

This review read the complete contents of:

- `scripts/hosted-truth/fragments/legal-privacy-head.html`
- `scripts/hosted-truth/fragments/legal-privacy-main.html`

It compared each material privacy claim with the guest-maker JavaScript, customer-control bridge, hosted HTTP service, commerce service, identity service, domain preflight, release configuration, mail transport, and PostgreSQL migrations currently in this worktree. “Supported” below means supported by this repository snapshot. It does **not** prove the deployed environment, reverse proxy, provider dashboard, DNS, backup destination, runtime environment variables, or corporate filing.

The legal section uses current official government or provider primary sources accessed on 2026-08-08. A New Jersey LLC can have obligations based on where consumers live and what the service does; New Jersey formation alone neither creates nor removes every state or federal obligation. Threshold-dependent statutes require an owner-maintained applicability record.

## Pre-correction executive decision

**Do not approve or seal pre-correction checkpoint `2222f3b`.** The source was correctly marked unsealed, but at least two statements contradicted the implementation and several material categories or qualifications were missing. The findings below describe that checkpoint; the later implementation-status section records the correction pass separately.

Ranked release issues:

1. **P0 — guest refresh statement is false.** Made versions are written to `sessionStorage` and restored after refresh; closing the tab ordinarily clears that tab-scoped storage.
2. **P0 — deletion residue is not “text-free.”** Deletion tombstones can retain customer domain names, identifiers, accepted-term IDs, billing lifecycle facts, actor IDs, timestamps, and removal counts.
3. **P0 — the retained-data inventory is materially incomplete.** Identity delivery metadata, organization roles, rate-limit/security records, acceptance IP/user-agent evidence, artifact replicas, Stripe identifiers, tax facts, and reversal events exist in migrations but are not clearly disclosed.
4. **P1 — Download language conflates two delivery paths.** Direct paid HTML Download is an authenticated API response from stored HTML; the short-lived token belongs to the separate project ZIP export path.
5. **P1 — “does not publish or host” is too categorical.** Download creates no public hosted website, but Site Sourcery stores accepted HTML and serves it from its authenticated backend.
6. **P1 — “does not contact a registrar” is too broad.** The browser calls Cloudflare’s DoH resolver rather than a registrar commerce API, but a recursive resolver can contact authoritative nameservers, including infrastructure operated by a registry or registrar.
7. **P1 — held-service and security claims need deployment evidence.** Alakazam defaults to held but has an approved environment mode; TLS, backups, tracker absence, and provider settings are runtime facts that source code alone cannot prove.
8. **P1 — the notice lacks a complete operational rights, appeal, retention, provider-category, cross-site-tracking, and material-change process.** Which items are legally mandatory depends on consumers served and statutory thresholds, but CalOPPA may apply independently of CCPA thresholds when California residents’ personally identifiable information is collected.
9. **P2 — filed alternate-name fact resolved as an owner-supplied operating fact, not independent legal proof.** The owner directly verified the exact New Jersey filed name `SITESOURCERY`; an official filing record remains release evidence if the owner or release policy requires independent verification.

## Owner correction direction and implementation status

At 2026-08-08 13:33 EDT, the owner directed the engineering lane to “fix what you gotta fix and get back to work.” This authorizes a source correction pass for the substantiated findings; it is not approval of unsupported deployment facts, the exact review artifact, or release constants.

The correction pass addresses the source-level issues behind E-01 through E-16 in the Privacy V3 source and its exact-copy proof surfaces. Where a proposed sentence depended on missing production evidence or an unapproved fixed retention schedule, the implementation uses narrower source-backed language and keeps the corresponding pre-seal evidence condition open. The operator clause uses the exact owner-verified New Jersey filed alternate name `SITESOURCERY`; this review records the source of that fact without upgrading it to independent official-record proof or exact-artifact approval. Older separately versioned or public legal surfaces remain a distinct evidence/versioning follow-up and were not rewritten in place. No V3 release version, effective date, full-page release digest, release byte count, or authority digest has been assigned.

Accepted historical Website Terms bytes were not rewritten. Their older refresh, Download, and entitlement wording requires a separately versioned correction before Privacy V3 can become an integrated operative release. This is an open cross-document release blocker, not a reason to mutate prior acceptance evidence.

This review remains the audit of pre-correction checkpoint `2222f3b`. The corrected source must pass focused tests and a new independent blocker review before a later path-limited correction commit. The owner retains final sign-off on the exact rendered notice; any counsel review is optional and nonblocking for this engineering gate.

The current real hosted review artifact is SHA-256 `1fdc50606115e31e61aad1063e724949f0e2efb3444aaba775a7db9c14523a14`, 25,994 bytes. The owner has separately verified the exact filed-name spelling `SITESOURCERY`, phone `(856) 244-1220`, and email `sitesourcery@proton.me` as current operating facts. Those fact confirmations do **not** approve that exact review artifact: explicit owner approval bound to this digest and byte count remains open. The separately versioned Website Terms correction also remains an open integrated-release blocker.

## ACCURACY — sentence-by-sentence findings

### Unsupported, incorrect, incomplete, or deployment-dependent claims

| ID | Priority | Draft sentence or claim | Engineering finding | Evidence / required decision |
|---|---:|---|---|---|
| A-01 | P0 | “Refreshing or closing the tab clears that unsaved work.” | **Incorrect as written.** Once at least one version has been made, its raw facts and current version index are saved to `sessionStorage` on unload and restored on refresh. Closing the tab ordinarily ends that tab-scoped storage, subject to browser behavior. | `abracadabra/app/abracadabra-app.js` (`TABWORK_KEY`, `saveTabWork()`, `restoreTabWork()`, boot restore). Replace both occurrences, including the Retention clause. |
| A-02 | P0 | “Guest work clears with the tab.” | **Incomplete summary.** It is reasonable shorthand for closing the tab, but it obscures refresh restoration and the browser’s control of session storage. | Same evidence as A-01. Say made versions may survive reload in the same tab and are removed when that tab session/storage is cleared. |
| A-03 | P0 | “...minimal transaction, accepted-document, fraud-prevention, security, legal, and text-free lifecycle records may remain...” | **Incorrect and unmeasured.** Retained tombstones are not text-free: they can contain customer domain names, project/organization/deletion identifiers, accepted-term IDs, billing-policy and lifecycle JSON, address disposition, removal counts, event kind, actor kind/ID, and timestamps. “Minimal” is not proved by a minimization assessment. | `202607280003_commerce_serving_operations.sql` (`project_deletion_tombstones`) and `202607280004_workflow_boundaries.sql` (`project_retained_events`, purge workflow). Replace with named retained categories and approved retention purposes/criteria. |
| A-04 | P0 | “Account records can include a person’s name, organization, email address, protected credential digest, activation and recovery-token digests and expiries, session identifiers, accepted document versions, account state, and security timestamps.” | **Directionally true but materially incomplete for a category disclosure.** The schema also holds organization membership role/state; password-verifier parameters and revision; registration command/request digests; delivery provider and receipt metadata; rate-limit subject digests and counters; recovery-delivery request/provider/failure metadata; session revocation and reauthentication facts; and audit/security records. | Identity migrations `202607280000`, `202607280008`, `202607280017`, `202607280018`, and `202607280020`; `server/hosted/identity-postgres.mjs`. Expand categories without exposing security secrets. |
| A-05 | P0 | “When a signed-in customer chooses to save, the retained editor project can include organization and project identifiers, its name, customer-supplied facts, selected look, generated HTML, version and content digests, accepted version, Download entitlement and transaction status, security checks, and lifecycle timestamps.” | **Directionally true but materially incomplete.** The migrations also retain creator/user and membership relations, raw and normalized fact sets, compiler/schema revisions, artifact bytes and replica provider/object keys, screening findings and attestations, request/idempotency/audit records, export authorization metadata, and acceptance-bound IP address and user-agent digest. | `202607280001_foundation.sql`, `202607280002_projects_content.sql`, `202607280007_hosted_api_edges.sql`, and `202607280010_hosted_edge_terminal_purge.sql`. Expand the project/technical categories and explain the purpose. |
| A-06 | P1 | “For a retained project, the service records the accepted version and can use a short-lived token, filename, content digest, status, request identifier, and timestamps to prepare and deliver its HTML file.” | **Conflates two implementations.** Direct paid HTML Download resolves stored `htmlBytes`, verifies the entitlement and digest, then returns an authenticated `text/html` attachment. A five-minute authorization token exists for the separate ZIP project export path. | `server/commerce-v2/payment.mjs` (`download()`); `server/hosted/http.mjs` (version Download route); `server/hosted/postgres-service.mjs` (`getExport()` / `downloadExport()`); `202607280007_hosted_api_edges.sql` (`export_download_authorizations`). Split Download from Export. |
| A-07 | P1 | “Download delivers accepted project HTML but does not publish or host it.” / “Download does not publish or host the page.” | **First half supported; second half ambiguous and overbroad.** The product does not create a public website or ongoing web-hosting service through Download. It does store accepted HTML in PostgreSQL and serves the file through an authenticated Site Sourcery route. | `202607280002_projects_content.sql` (`artifacts.html_bytes`); `server/commerce-v2/payment.mjs`; `server/hosted/http.mjs`. Say “does not create a public website or ongoing hosting,” then disclose storage and authenticated delivery. |
| A-08 | P1 | “A completed one-time $5 payment unlocks Download for that retained editor project. Later accepted versions and repeat downloads from the same retained project do not require another Site Sourcery purchase.” | **Needs an active-entitlement qualification.** Refund/dispute reversal evidence can suspend or revoke the project entitlement, and later delivery also depends on retained project/artifact availability. | `202608020022_commerce_v2_download_settlement.sql` (`commerce_v2_project_entitlements`, reversal events) and `server/commerce-v2/entitlement.mjs`. Add “while the entitlement and retained project remain active and available.” |
| A-09 | P1 | “Site Sourcery can receive and store the account, editor-project and accepted-version identifiers, quote and checkout identifiers, $5 amount and currency, customer and transaction references, payment status, accepted document versions, and timestamps.” | **True but incomplete.** Current Download migrations also retain command/fingerprint/result data, quote snapshots and disclosure digests, Stripe checkout-session URL/ID, Stripe event ID/type/livemode and payload digest, PaymentIntent and customer IDs, tax/total/tax-mode facts, receipt evidence, entitlement state, and refund/dispute/reversal facts. | `202607280019_commerce_v2_download_preparation.sql` and `202608020022_commerce_v2_download_settlement.sql`. Expand categories and distinguish identifiers/digests from full provider payloads. |
| A-10 | P1 | “Before a guest saves, the business facts ... are not sent to Site Sourcery merely because a preview is made.” | **Supported only when read narrowly.** `abracadabra:versionmade` holds a candidate in browser memory and calls `saveCandidate()` only when both an account and project exist. The sentence must not imply that the page makes no ordinary HTTP requests or that infrastructure keeps no access/security records. | `abracadabra/app/abracadabra-customer-control-dom.js` (`abracadabra:versionmade`, `saveCandidate()`). Say the business facts are not included in an API request solely because Make Preview is pressed. |
| A-11 | P1 | “The lookup ... does not contact a registrar...” | **Too categorical.** The page itself calls only `https://cloudflare-dns.com/dns-query` and calls no registrar availability, pricing, reservation, or purchase API. Cloudflare is a recursive resolver and can issue logged subrequests to authoritative nameservers; some authoritative infrastructure may be registry- or registrar-operated. | `domains/domain-search.js`; Cloudflare Public DNS Resolver privacy documentation. Limit the claim to no direct registrar commerce/API check. |
| A-12 | P1 | “Cloudflare also receives ordinary request and network metadata, such as the IP address, request URL, time, and user-agent information, under its own terms and privacy practices.” | **Directionally reasonable but not a durable disclosure by itself.** Cloudflare’s current resolver notice describes query names/types, technical/timing fields, truncated source-IP handling, limited APNIC access, authoritative subrequest logs, and aggregates. The draft neither links the exact resolver notice nor distinguishes processing from retained resolver-log fields. | Link `https://developers.cloudflare.com/1.1.1.1/privacy/public-dns-resolver/` and describe the query plus the provider-policy boundary without promising a static field list. |
| A-13 | P1 | “Alakazam subscription sales remain held...” / “Alakazam publication remains held...” / “Alakazam subscription checkout, status, renewal, and lifecycle handling remain held...” | **Supported by source default, not proved for a deployment.** `SITESOURCERY_ALAKAZAM_MODE` defaults to `held`, but exact `approved` mode exists and enables release subject to readiness/tax requirements. Extensive dormant subscription migrations also exist. | `server/hosted/alakazam-release-config.mjs`; migrations `202608020023` through `202608040033`. Obtain a deployed capability/config attestation immediately before sealing. Do not imply the lifecycle machinery does not exist. |
| A-14 | P1 | “The account service ... uses ... encrypted transport, request controls, backups, and security records.” | **Mixed.** Password verifiers, boundaries, request controls, and security records are source-supported. Live TLS, backup execution, off-machine retention, and restore success are runtime/operations facts. | Identity/runtime migrations plus `ops/PRODUCTION-BACKUP-CADENCE-2026-08-02.md`, `ops/PRODUCTION-BACKUP-RESTORE-2026-08-02.md`, and live release evidence. Do not publish TLS/backup claims without dated production proof. |
| A-15 | P1 | “The ordinary marketing pages contain no ... advertising tracker, or page-level analytics code.” | **Supported for the inspected public source/artifact, but deployment-dependent.** The inspected public pages use local scripts; the Start chooser is local DOM logic; no tracker/pixel/analytics endpoint was found. This does not rule out CDN, tag-manager, reverse-proxy, injected, or later release changes. | Current HTML/script inventory and `vnext.js`. Add this assertion to the compiled-artifact and browser-network release gate. Keep ordinary access/security logs separate from analytics. |
| A-16 | P1 | “Applicable legal rights to access, correct, delete, restrict, or receive information remain available.” | **Vague and potentially overpromising.** “Restrict” is not a uniform US consumer right; “receive information” does not explain portability; no response timing, denial explanation, appeal path, authorized-agent handling, or opt-out mechanism is stated. | Replace with jurisdiction-dependent rights and a real request/appeal process. NJDPA duties apply only if its thresholds are met; CalOPPA disclosures can apply independently. |
| A-17 | P1 | “Those [support] records are limited to support, security, fraud prevention, abuse handling, legal compliance, and service protection.” | **Purpose promise not demonstrated end to end.** The schema supports records and controls, but the repository alone cannot prove staff access, exports, provider handling, or secondary-use restrictions. | Require an access/purpose runbook, provider contracts, and audit checks before retaining “limited to.” |
| A-18 | P1 | “Do not put ... health information, regulated records, or sensitive customer data in a page.” | **Warning exists; prevention is not proved.** Validation and HTML escaping protect rendering, but free-text facts can still contain sensitive data. A warning is not a technical rejection or sensitive-data consent process. | `abracadabra` compiler/validation protects output syntax, not data classification. Add product controls or a documented sensitive-data incident/removal path. |
| A-19 | P1 | “The services ... are not designed for children under 13.” | **Product-position statement, not a complete handling rule.** COPPA can still matter if a general-audience operator has actual knowledge it collected personal information from a child under 13. | Keep the audience statement only with an owner-approved actual-knowledge escalation, parental-contact, and deletion runbook; optional counsel review is advisable but nonblocking. |
| A-20 | P1 | “A material change ... receives a new effective date and, where required, a direct notice or fresh acceptance...” | **Reasonable promise, but the operational process is not evidenced here.** The draft does not say where the new notice appears, which customers receive direct notice, how lead time is determined, or how fresh acceptance is recorded. | Legal-document/acceptance tables exist, but require a material-change runbook and release test before this promise is sealed. |
| A-21 | P2 | “Desiderata Labs LLC operates this website under the filed alternate name SITESOURCERY.” | **External fact not proved by source; exact spelling now directly verified by the owner.** The 2026-08-08 official-source search did not produce a public filing record sufficient for independent verification. The owner-supplied confirmation resolves the engineering fact question but is not official-record proof or exact-artifact approval. | Record the owner verification as the fact source. Attach the New Jersey alternate-name filing/certificate if the owner or release policy requires independent evidence; do not infer any different spelling from branding or repository text. |
| A-22 | P2 | “A customer-owned domain remains the customer’s.” | **Contract/policy promise, not a privacy implementation fact.** Dormant domain-procurement tables include provider receipts and domain lifecycle operations, but ownership/control depends on the written scope, registrar account arrangement, and provider terms. | Keep only if the customer agreement and operating procedure guarantee registrant/account control; otherwise say that the separate written scope states ownership and access. |
| A-23 | P2 | “Website, account, database, backup, transactional-email, payment, file-delivery, and network providers can process records needed for their assigned role.” | **Category statement is plausible but too generic to validate sharing.** The notice does not map data categories to provider categories or clearly address Cloudflare DNS/APNIC, Stripe, transactional email, Proton Mail, object/file storage, and infrastructure logs. | Build a current subprocessor/data-flow inventory and align provider contracts/configuration with the notice. `server/hosted/resend-mail-transport.mjs` requires open/click tracking disabled, but deployment proof is still needed. |
| A-24 | P2 | “Site Sourcery does not store the readable password.” | **Supported, with a wording improvement.** The service transiently receives the password to derive a salted scrypt PHC verifier; the database stores the verifier and parameters, not a readable password. | Identity migrations and `server/hosted/identity-postgres.mjs`. Prefer “stores a password verifier, not the readable password.” |
| A-25 | P1 | “Project content can be removed when deletion is completed...” | **Supported for the active PostgreSQL purge path, but incomplete for backup copies.** The operations evidence describes immutable age-encrypted off-machine backups, and expressly says the scheduled retention interval remains a separate owner decision. A completed active-system deletion therefore must not imply immediate removal from existing backups. | `202607280004_workflow_boundaries.sql`; `202607280010_hosted_edge_terminal_purge.sql`; `ops/PRODUCTION-BACKUP-CADENCE-2026-08-02.md`; `ops/PRODUCTION-BACKUP-RESTORE-2026-08-02.md`. Distinguish active-system deletion from restricted backup residuals and state the approved aging/destruction criterion before sealing. |

### Claims supported by the inspected source, subject to release drift

- Guest HTML compilation and preview rendering are browser-local; opening the preview creates a Blob/Object URL, not a public Internet address.
- Pressing Make Preview does not by itself send guest business facts through the signed-in project-save API.
- The current Start chooser changes the page locally and contains no fetch, cookie, or storage path.
- The current Domains button cleans one candidate and sends `.com`, `.net`, and `.org` NS queries to Cloudflare’s DoH JSON endpoint. It is a signal, not availability, a quote, a reservation, or a purchase.
- The current paid HTML Download path requires an authenticated project entitlement, verifies the stored artifact digest, and returns an attachment with `Cache-Control: no-store`.
- Stripe-hosted card entry is separate from the application’s stored payment evidence; no full card number or security-code column/path was found in the inspected commerce implementation.
- Current identity storage uses scrypt PHC verifiers rather than readable passwords.
- Resend readiness code rejects domains with open or click tracking enabled. This supports intended configuration, not proof of the live Resend dashboard state.
- Alakazam’s source default is held. Final truth still requires deployed environment and capability evidence.

## Stored-field reconciliation against migrations

The final notice need not enumerate every column, but its categories must be complete enough that an ordinary customer understands what is kept and why. The current draft should be reconciled to at least the following groups:

| Data group | Repository truth that should inform the notice |
|---|---|
| Account and organization | Email, display name, organization name, user/account/organization identifiers, membership roles and states, activation/disable/lifecycle timestamps. |
| Credentials and sessions | Scrypt PHC password verifier and version parameters, session-token digests, expiry/revocation/rotation/reauthentication facts, recovery-token digests and expiry/use facts. |
| Registration and recovery delivery | Command/request/idempotency digests, email, requested names, temporary password verifier, token digest, provider and delivery receipt metadata, delivery/failure/state timestamps, rate-limit subject digests and counters. |
| Project and content | Project name and IDs, raw and normalized customer facts, offerings/look choices, compiler/schema revision, made/accepted version state, generated HTML bytes, content/artifact digests and byte counts, screening findings, attestations, and lifecycle timestamps. |
| Acceptance and security evidence | Document IDs/versions, request IDs, acceptance time, optional IP address, user-agent digest, audit/security event metadata, actor IDs, rate-limit and request-control state. |
| Artifact and export delivery | Artifact replica provider/object keys and state, export job state, short-lived export authorization digest/token metadata, filename/digest/status/request/timestamps. Direct paid HTML Download should be described separately from ZIP export. |
| Download commerce | Quote and checkout preparation IDs, command fingerprints/results, quote snapshots and disclosure digests, Stripe checkout session URL/ID, event ID/type/livemode/payload digest, PaymentIntent/customer identifiers, amount/tax/total/currency/tax mode, payment status/timestamps, receipt evidence, entitlement state, and reversal/refund/dispute events. |
| Deletion residue | Project/organization/deletion IDs, policy version, accepted-term IDs, billing policy and lifecycle timestamps/status/subscription IDs, address disposition, retained customer domain names, removal counts, retained event kind, actor kind/ID, and timestamps. These records are not “text-free.” |
| Held future products | Alakazam, domain procurement, and custom-service migrations contain broader billing, fulfillment, quote, assessment, build, message, provider-receipt, and lifecycle fields. A held schema is not necessarily current collection, but each product must receive a fresh data-flow, retention, deletion, and notice review before activation. |

## LIABILITY EXPOSURE — engineering issue spotting, not legal advice

### L-01 — false or overly categorical privacy promises

The refresh, “text-free,” direct-Download token, hosting, and registrar statements are inconsistent with or broader than the implementation. Publishing known inaccurate privacy representations creates avoidable consumer-deception risk. The FTC states that it brings privacy and security enforcement when companies fail to honor privacy promises or maintain appropriate safeguards. New Jersey’s Consumer Fraud Act addresses deception, false promise, misrepresentation, and knowing concealment or omission in connection with sales.

**Engineering control:** no sentence may be sealed until it has a source owner, deployment owner where applicable, and reproducible evidence. Categorical words such as “nothing,” “never,” “only,” “does not,” and “text-free” require especially strong proof.

### L-02 — California Online Privacy Protection Act exposure can exist below CCPA thresholds

California Business and Professions Code § 22575 applies to an operator of a commercial website or online service that collects personally identifiable information through the Internet about California-resident consumers. Its posted-policy requirements include categories collected, categories of third parties, any maintained review/change process, material-change notification process, an effective date, the response to browser Do Not Track or comparable mechanisms if the operator engages in covered cross-site collection, and whether other parties may collect activity over time across different sites.

The signed-in account path collects at least name/email-related information, so the owner should not assume that being a New Jersey LLC or falling below CCPA thresholds avoids CalOPPA. The current unsealed draft correctly has no effective date yet, but it must not be published until an effective date and the other applicable disclosures are present. The tracker statement also needs a release-time artifact and network attestation.

### L-03 — New Jersey Data Privacy Act applicability and notice duties are unresolved

The NJDPA applies only if the controller conducts business in New Jersey or targets New Jersey residents **and**, during a calendar year, processes at least 100,000 consumers’ personal data excluding payment-only processing, or processes at least 25,000 consumers’ data and receives revenue or a discount from selling personal data. The repository does not establish annual consumer counts, revenue/discount from sale, or whether any data is sold. The owner must record those facts annually rather than merely assuming the small-business posture.

If the NJDPA applies, its notice provisions require categories processed, processing purposes, all third-party categories, categories shared, rights and appeal instructions, a material-change process and effective date, and an active email or online contact. It also includes request/appeal timing, minimization, purpose limitation, reasonable security, sensitive-data consent, processor-contract, and risk-assessment obligations where applicable. The current draft does not provide a complete appeal flow, third-party/category mapping, or operational request timing.

New Jersey proposed implementing rules for N.J.A.C. 13:45L were published in 2025, with an adoption notice expected in 2026. The official search used for this review did not establish a final adoption. **Do not treat the proposal as binding or absent; the owner must verify the official adoption page immediately before release, optionally with counsel.**

### L-04 — retention and deletion disclosure is not operationally complete

“No fixed period” does not itself explain how retention decisions are made. The application retains content, commerce evidence, acceptances, security events, and deletion tombstones with different purposes and deletion behavior. California’s CCPA/CPRA, if its business thresholds apply, requires category-level retention periods or criteria and prohibits retaining personal information longer than reasonably necessary for disclosed purposes. Other laws and ordinary deception principles make an unsupported “minimal” claim risky even when the CCPA does not apply.

**Engineering control:** approve a category-by-category retention schedule, encode or test it where feasible, document legal/tax/dispute holds, and prove deletion across primary storage, replicas, exports, logs, support systems, and backups. The newer held custom-service migrations also need terminal-purge coverage before those services activate.

### L-05 — privacy-request and appeal operations are underspecified

Phone and email are contact routes, not a complete verified-request system. The owner needs a documented intake log, identity/authority verification, response deadline calculation, correction/export/deletion execution, exception approval, denial explanation, appeal path when required, and proof of completion. The notice should not promise “restrict” as a universal right, and “receive information” should be replaced with plain portability language when applicable.

**Engineering control:** run a full request rehearsal for account access, correction, portable copy, deletion, unauthenticated request, authorized agent, denial, and appeal before sealing any procedural promise.

### L-06 — security and breach-response claims need production evidence

The code contains meaningful access, hashing, session, RLS, audit, request-control, and backup machinery. That does not prove live TLS configuration, current dependencies, secrets handling, backup execution, off-machine storage, restoration, monitoring, or incident response. The FTC’s business guidance emphasizes inventory, minimization, protection, disposal, and incident planning. New Jersey’s Identity Theft Prevention Act procedure requires covered businesses operating in or serving clients in New Jersey to notify the New Jersey State Police before customer breach disclosure in covered circumstances.

**Engineering control:** attach live TLS/header scans, secret/config review, backup and restore evidence, dependency/security results, access review, provider contacts, and a New Jersey-aware breach-notification runbook to the release record.

### L-07 — sensitive free text and children require an operating path

Escaping and validation reduce injection risk but do not stop a user from entering health, financial, child, or other sensitive information into free-text business facts or support email. If the NJDPA applies, sensitive-data processing can require consent and a documented assessment. Regardless of NJDPA threshold, data minimization and truthful purpose disclosure remain important engineering controls.

The service may be general audience and directed to businesses, but the FTC’s COPPA guidance explains that a general-audience service can acquire obligations upon actual knowledge that it collected personal information from a child under 13. “Not designed for children” is therefore not a complete response plan.

**Engineering control:** add input guidance at collection points, a sensitive-data escalation/removal process, and an owner-approved under-13 actual-knowledge runbook. Optional counsel review remains advisable but nonblocking for the engineering gate.

### L-08 — provider and cross-site disclosures need a maintained data-flow inventory

The code identifies Cloudflare DNS, Stripe, Resend, and Proton Mail, plus hosting/database/backup/file-delivery roles. Cloudflare’s current resolver notice says it processes resolver query and technical data, briefly handles truncated source-IP data, permits limited APNIC access to anonymized resolver data, logs authoritative subrequests, and may retain aggregates. The privacy draft’s generic provider paragraph does not map what each category receives or what the user action triggers.

**Engineering control:** maintain a provider register with service, data categories, purpose, region, retention/control settings, contract/DPA, subprocessors, deletion route, incident contact, and owner. Revalidate Resend open/click tracking, Stripe checkout settings, Cloudflare resolver policy, Proton handling, and infrastructure logs at release.

### L-09 — “held” must be an externally proved state, not merely a default

The Alakazam mode defaults to held, but source explicitly supports an approved mode. Similar future domain/custom-service machinery exists in migrations. If a deployment variable, route, provider credential, or capability flips, the notice becomes wrong immediately.

**Engineering control:** privacy publication must be coupled to the exact deployed capability manifest. Activating Alakazam, registrar work, custom-service checkout, publication, analytics, or a new provider must block on privacy/data-flow/retention review.

### L-10 — operator identity and sale/share facts need owner evidence

The engineering repository cannot prove the alternate-name filing, annual statutory thresholds, or a universal “no sale/share” fact across staff, vendors, and future tooling. The owner has now supplied the exact filed-name spelling and current phone/email as operating facts, but those remain owner assertions rather than repository or independent official-record proof. The other assertions remain open and have legal consequences.

**Engineering control:** retain the official alternate-name filing if the owner or release policy requires independent evidence; maintain an annual state-law applicability worksheet; and keep a signed owner statement covering sale, sharing, targeted advertising, profiling, and financial incentives. If any answer changes, the notice and opt-out controls must be reviewed before the processing starts.

## ENHANCE — proposed plain-language replacements for owner decision

These are proposals only. Checking **APPROVE** authorizes a later, separately reviewed source edit; it does not edit the fragments, make the notice effective, or seal anything. Counsel may revise any proposal.

### E-01 — Guest work and refresh behavior

**Proposed summary replacement**

> Guest facts stay in this browser tab. Made versions may survive a reload in tab storage; they are sent to the project service only after a signed-in save.

**Proposed full-clause replacement**

> Before a guest saves, making a preview keeps the business facts, selected look, review confirmation, and made versions in the browser. Pressing Make Preview does not by itself include those business facts in a Site Sourcery project API request. Made versions are stored in this tab’s session storage so they can survive a refresh or a payment return. Closing the tab or clearing its session storage ordinarily removes them, subject to the browser’s controls. Ordinary page and security requests may still create the network records described below.

**Rationale:** Matches `sessionStorage` restore and narrows the no-transmission promise to the facts/API event the code actually controls.

- [ ] **APPROVE E-01**
- [ ] **REJECT E-01**

### E-02 — Direct HTML Download versus project export

**Proposed summary replacement**

> Download serves the accepted HTML file to the signed-in customer. It does not create a public website or ongoing hosting service.

**Proposed full-clause replacement**

> For a retained project, Site Sourcery stores the accepted HTML and its integrity details. An entitled, signed-in customer can request that HTML through an authenticated Download route; the browser then saves it under the customer’s browser, operating-system, and device controls. Download does not create a public Internet address or ongoing website hosting. A separate project ZIP export, when used, has its own short-lived download authorization. Site Sourcery does not receive edits made only to a file after it is downloaded.

**Rationale:** Accurately separates stored/authenticated HTML delivery from the tokenized ZIP-export implementation.

- [ ] **APPROVE E-02**
- [ ] **REJECT E-02**

### E-03 — Download entitlement duration

**Proposed summary replacement**

> One completed $5 purchase unlocks Download for that retained project while its entitlement and files remain active and available.

**Proposed full-clause replacement**

> A completed one-time $5 payment activates Download for that retained editor project. Later accepted versions and repeat downloads from the same project do not require another Site Sourcery purchase while the project, accepted file, and Download entitlement remain active and available. A refund, dispute, reversal, deletion, or other lawful entitlement change can suspend or end Download. A different editor project has its own Download purchase.

**Rationale:** Preserves the one-project purchase promise without contradicting reversal and deletion state.

- [ ] **APPROVE E-03**
- [ ] **REJECT E-03**

### E-04 — Domains, Cloudflare DoH, and no registrar commerce call

**Proposed summary replacement**

> Domain preflight sends the cleaned `.com`, `.net`, and `.org` candidates to Cloudflare’s public DNS resolver. It does not call a registrar availability, price, reservation, or purchase service.

**Proposed full-clause replacement**

> When you press the Domains check button, your browser cleans the typed candidate and sends its `.com`, `.net`, and `.org` names in NS queries to Cloudflare’s public DNS-over-HTTPS resolver at `cloudflare-dns.com`. Cloudflare processes the query and connection data under its [Public DNS Resolver privacy notice](https://developers.cloudflare.com/1.1.1.1/privacy/public-dns-resolver/), including the resolver logging and limited APNIC access described there. A recursive resolver may contact authoritative DNS servers to answer. Site Sourcery’s preflight does not call a registrar availability, pricing, reservation, or purchase API; it does not prove availability, create a quote, reserve a name, authorize a purchase, or place an order.

**Rationale:** States the exact endpoint/function and removes the technically overbroad “does not contact a registrar” claim.

- [ ] **APPROVE E-04**
- [ ] **REJECT E-04**

### E-05 — Public analytics, trackers, logs, and browser signals

**Proposed summary replacement**

> The current public pages use no advertising tracker or page analytics. Ordinary site/security logs still apply, and the Domains button makes the Cloudflare DNS request described here.

**Proposed full-clause replacement**

> The current public Site Sourcery pages do not use advertising trackers or page-level analytics and do not collect browsing activity over time across unrelated websites. Site Sourcery therefore does not change this handling in response to a browser Do Not Track signal. Other parties are not permitted to use these pages for cross-site advertising tracking. Website and security providers may still process ordinary request records, and pressing the Domains button sends the stated DNS request to Cloudflare. The Start chooser uses the selected buttons only to show a recommendation on the current page and does not send that selection.

**Rationale:** Separates analytics/cross-site tracking from ordinary infrastructure logs and supplies a CalOPPA-oriented browser-signal disclosure.

**Approval condition:** compiled-artifact inventory, browser network capture, reverse-proxy/CDN review, provider inventory, and owner no-cross-site-tracking statement all pass for the exact release.

- [ ] **APPROVE E-05 after condition passes**
- [ ] **REJECT E-05**

### E-06 — Account and authentication records

**Proposed summary replacement**

> Account setup keeps identity, organization, sign-in, delivery, acceptance, and security records needed to create and protect the account.

**Proposed full-clause replacement**

> Account records can include your name, organization, email address, account and membership identifiers and roles, a protected password verifier, activation and recovery-token digests and expiry/use facts, session and reauthentication records, accepted document versions, registration or recovery delivery provider/receipt details, account state, rate-limit and fraud-prevention records, and security timestamps. Site Sourcery receives a password long enough to create or check the verifier but stores the verifier, not the readable password. The optional business email placed in page content is separate from the account email.

**Rationale:** Reconciles the notice with identity, registration, recovery, membership, delivery, and rate-limit migrations.

- [ ] **APPROVE E-06**
- [ ] **REJECT E-06**

### E-07 — Saved project, acceptance, artifact, and export records

**Proposed summary replacement**

> A signed-in save keeps the project facts, HTML, versions, acceptance, delivery, and security records needed to retain and deliver that project.

**Proposed full-clause replacement**

> A retained editor project can include organization, user, and project identifiers; its name; customer-supplied raw and structured facts; selected look; compiler and schema revision; generated HTML; artifact copies and storage references; content digests and byte counts; made, reviewed, and accepted version states; screening findings and attestations; Download and export status; request and audit records; and lifecycle timestamps. Records of accepted documents can include the document/version, account and project, request identifier, acceptance time, IP address, and a user-agent digest. These records are used to save, protect, verify, export, and deliver the project.

**Rationale:** Covers the material project fields and acceptance evidence present in migrations without listing every internal column.

- [ ] **APPROVE E-07**
- [ ] **REJECT E-07**

### E-08 — Payment and Download commerce records

**Proposed summary replacement**

> Stripe handles card entry. Site Sourcery keeps the checkout, receipt, tax, entitlement, and reversal evidence needed for the $5 project Download.

**Proposed full-clause replacement**

> Secure card entry belongs to Stripe at checkout. Site Sourcery can receive and store account, project, and accepted-version identifiers; quote snapshots and disclosure digests; command and request identifiers; Stripe customer, checkout-session, event, and PaymentIntent identifiers; amount, tax, total, currency, and tax mode; payment and entitlement state; receipt evidence; refund, dispute, or other reversal facts; and related timestamps. Site Sourcery stores event digests and provider readback evidence needed to verify payment; it does not ask for or store the full card number or card security code.

**Rationale:** Aligns the billing disclosure with migrations 019 and 022 and names Stripe where the implementation does.

- [ ] **APPROVE E-08**
- [ ] **REJECT E-08**

### E-09 — Retention and deletion residue

**Proposed summary replacement**

> Saved content is kept while needed for the account and project, then removed through the deletion process. Some payment, acceptance, security, domain, and deletion-proof records can remain for stated business or legal reasons.

**Proposed full-clause replacement**

> Site Sourcery keeps account and project content while the account or project is active and while it is reasonably needed to provide the requested service. A verified deletion can remove project facts, generated HTML, drafts, versions, support content, and related working records from the active service. Existing encrypted backups can retain an earlier copy until that backup ages out under the approved backup-retention schedule; backup access is restricted, and restored data remains subject to the deletion record. After project deletion, Site Sourcery can retain project, organization, and deletion identifiers; accepted-document identifiers; billing policy and payment/lifecycle facts; security or fraud-prevention events; address disposition; customer domain names needed to show they were detached rather than deleted; removal counts; actor identifiers; and timestamps. Those retained records are used only for tax/accounting, payment disputes, fraud and security, enforcing deletion, legal compliance, and legal claims, and are kept under the approved category-by-category retention schedule.

**Rationale:** Removes the false “text-free/minimal” wording and names the actual tombstone categories and purposes.

**Approval condition:** the owner approves a written retention schedule with a period or operational criterion for every category, plus backup/replica/support/provider deletion handling. Optional counsel input may inform that decision but is not an engineering seal prerequisite. Do not seal this replacement until that schedule exists.

- [ ] **APPROVE E-09 after condition passes**
- [ ] **REJECT E-09**

### E-10 — Held Alakazam state

**Proposed summary replacement**

> Alakazam subscriptions are not currently offered. Checkout, billing, renewal, downgrade, cancellation, fulfillment, and publication controls remain disabled for customers.

**Proposed full-clause replacement**

> Alakazam subscription code and lifecycle records exist as held product machinery, but Alakazam is not currently offered for sale or customer activation. Its checkout, billing, renewal, upgrade, downgrade, cancellation, fulfillment, and publication capabilities remain held. Site Sourcery will review and update this notice, the retention/deletion map, customer terms, tax handling, and provider disclosures before any Alakazam capability is approved for customers.

**Rationale:** Describes the dormant implementation honestly and ties any activation to a privacy review.

**Approval condition:** the exact deployed release manifest proves `alakazamMode=held` and all customer-facing Alakazam commerce/publication capabilities are false.

- [ ] **APPROVE E-10 after condition passes**
- [ ] **REJECT E-10**

### E-11 — Provider categories and purposes

**Proposed summary replacement**

> Service providers process only the information needed for hosting, accounts, email, payments, file delivery, DNS checks, backups, security, or support.

**Proposed full-clause replacement**

> Site Sourcery uses service providers for website and network delivery, account/database operation, backups, transactional email, payment checkout and verification, file delivery, public DNS lookup, and direct email. Depending on the feature used, those providers can receive account/contact details, project or transaction identifiers, payment evidence, message content, requested domain names, IP address, request path, user-agent or similar device data, request status, security events, and timestamps needed for their assigned role. The Domains section identifies Cloudflare; checkout identifies Stripe; transactional account email uses the configured email provider; and direct email to `sitesourcery@proton.me` uses Proton Mail. Provider terms, contracts, privacy notices, and configured retention/security controls also apply.

**Rationale:** Maps provider roles to meaningful data categories while keeping feature-specific details in their own clauses.

**Approval condition:** current provider register, contracts/DPAs, subprocessors, tracking settings, deletion routes, and regions are owner-reviewed.

- [ ] **APPROVE E-11 after condition passes**
- [ ] **REJECT E-11**

### E-12 — Privacy choices, jurisdiction-dependent rights, and appeal

**Proposed summary replacement**

> You can preview without an account, keep your downloaded file, and ask about your account data. Additional access, correction, deletion, copy, opt-out, or appeal rights depend on applicable law.

**Proposed full-clause replacement**

> You may browse and make a guest preview without creating an account. If Site Sourcery keeps personal data about you, you may ask what it processes and request access, correction, deletion, or a portable copy. Depending on the law that applies, you may also have rights involving sale, targeted advertising, certain profiling, an authorized agent, or an appeal after a request is denied. Site Sourcery verifies requests as reasonably necessary, does not require a new account solely to make a request, responds within the period required by applicable law, explains a denial and appeal route when required, and does not discriminate for exercising a legal privacy right. Use the privacy email or phone route below to start.

**Rationale:** Removes a non-universal “restrict” promise and explains the operationally relevant rights in plain language.

**Approval condition:** request/appeal runbook, deadline tracking, identity verification, export, deletion, and denial templates pass rehearsal; the owner confirms which timing and authorized-agent statements will be published, optionally after counsel review.

- [ ] **APPROVE E-12 after condition passes**
- [ ] **REJECT E-12**

### E-13 — Security claim with production evidence

**Proposed summary replacement**

> Account passwords are stored as protected verifiers, and the service uses account, project, session, request, and security controls. No system is perfectly safe.

**Proposed full-clause replacement**

> Site Sourcery stores a protected password verifier rather than the readable password and uses session controls, account and project boundaries, request controls, audit/security records, and restricted database roles. Production traffic uses encrypted transport, and protected backups are tested for restoration. No browser, storage, payment, backup, or network method is perfectly secure. Please do not put passwords, full payment-card data, health information, regulated records, or sensitive customer data into page content or an initial inquiry.

**Rationale:** Uses precise source-supported controls and retains TLS/backup statements only as production-verification claims.

**Approval condition:** attach live TLS/header evidence and a current successful protected-backup/restore record for the exact production system.

- [ ] **APPROVE E-13 after condition passes**
- [ ] **REJECT E-13**

### E-14 — Children and actual knowledge

**Proposed summary replacement**

> Site Sourcery is a business service, not a service for children under 13. Contact Site Sourcery if you believe a child provided personal information.

**Proposed full-clause replacement**

> Site Sourcery is directed to businesses and is not intended for children under 13. Site Sourcery does not knowingly ask a child under 13 for personal information. If Site Sourcery learns that it collected personal information from a child under 13, it will review and delete or otherwise handle that information as required by law. A parent or guardian can use the privacy contact below.

**Rationale:** Adds the actual-knowledge and parent-contact path missing from a mere audience statement.

**Approval condition:** an owner-approved actual-knowledge, verification, deletion, and preservation runbook exists. Optional counsel review is recommended but nonblocking for this engineering gate.

- [ ] **APPROVE E-14 after condition passes**
- [ ] **REJECT E-14**

### E-15 — Material changes and notice process

**Proposed summary replacement**

> Material changes appear here with a new effective date. Site Sourcery also gives direct notice or asks for fresh acceptance when required.

**Proposed full-clause replacement**

> Site Sourcery posts an updated notice at this privacy page with a new effective date and a description of material changes. When law or the nature of the change requires more, Site Sourcery sends notice to the account email or shows an account notice before the changed handling begins. If fresh consent or acceptance is required, the changed handling does not apply until that step is completed.

**Rationale:** Identifies the posting, direct-notice, and fresh-acceptance channels rather than promising an undefined process.

**Approval condition:** release workflow implements and tests the stated email/account notice and acceptance records.

- [ ] **APPROVE E-15 after condition passes**
- [ ] **REJECT E-15**

### E-16 — Operator identity

**Proposed summary replacement**

> Desiderata Labs LLC is the legal seller and operates Site Sourcery under its registered business name.

**Proposed full-clause replacement**

> Desiderata Labs LLC is the legal seller and operates this website under the business name shown in its official New Jersey filing. Site Sourcery is the public brand for that business.

**Rationale:** Keeps the intended plain voice, records the owner-confirmed exact naming, and leaves independent official-record evidence available if required.

**Approval condition:** the owner supplied and the corrected source already uses the exact spelling `SITESOURCERY`. The owner must still approve the exact rendered review artifact; attach the official filing record if the owner or release policy requires independent verification. Optional counsel review is separate and nonblocking. No further naming edit is authorized by this status update.

- [ ] **APPROVE E-16 after condition passes**
- [ ] **REJECT E-16**

## Pre-seal evidence checklist

- [ ] Owner reviewed this engineering issue list and the final replacements.
- [x] Owner supplied the exact New Jersey filed alternate name `SITESOURCERY` and confirmed `(856) 244-1220` and `sitesourcery@proton.me` as the current privacy contact routes.
- [ ] Owner explicitly approves exact review artifact SHA-256 `1fdc50606115e31e61aad1063e724949f0e2efb3444aaba775a7db9c14523a14`, 25,994 bytes.
- [ ] Official record proves the operator legal name and exact alternate/business name, if the owner or release policy requires independent evidence.

Optional counsel review may be obtained for legal advice, but it is not a content-seal or release-finalization prerequisite in this engineering checklist.
- [ ] Annual applicability worksheet records consumer counts, states served, revenue, and whether personal data is sold, shared, used for targeted advertising, or used for covered profiling.
- [ ] Owner checked the current NJDPA statute, final status of proposed N.J.A.C. 13:45L rules, CalOPPA, CCPA/CPRA thresholds if relevant, COPPA, breach laws, and any other state laws for the actual customer footprint, optionally with counsel.
- [ ] Exact compiled public artifact and browser-network capture prove no analytics, advertising tracker, cross-site tracker, unexpected external assets, or guest-fact API request on Make Preview.
- [ ] Reverse proxy/CDN/hosting configuration is included in the tracker, log, TLS, and security review.
- [ ] Deployed capability manifest proves Alakazam, publication, registrar commerce, and held custom-service capabilities match the notice.
- [ ] Direct paid HTML Download and ZIP export are separately tested and separately described.
- [ ] Provider register maps Cloudflare, Stripe, transactional email, Proton Mail, hosting, database, backup, object/file delivery, monitoring, and support tools to data categories, purpose, retention, deletion, region, contract, and incident contact.
- [ ] Resend or replacement transactional-email configuration proves open/click tracking settings for the exact live domain.
- [ ] Category-by-category retention schedule exists; deletion tests cover primary rows, artifacts, replicas, exports, logs, support systems, provider systems, and backup aging.
- [ ] Tombstone review expressly approves retained domain names, identifiers, acceptance/payment facts, actor IDs, and timestamps; the notice does not call them text-free.
- [ ] Newer held Alakazam/domain/custom-service tables have terminal-purge and notice mapping before any capability activates.
- [ ] Privacy request rehearsal passes access, correction, portable copy, deletion, authorized agent where applicable, denial, appeal, deadline, and completion-proof paths.
- [ ] Sensitive-data and under-13 actual-knowledge runbooks exist and collection points carry appropriate guidance.
- [ ] Production evidence proves TLS, secure cookies/session controls, dependency posture, backup completion, protected backup destination, restore success, monitoring, and incident contacts.
- [ ] New Jersey-aware breach-response runbook includes State Police notification sequencing for covered incidents.
- [ ] Material-change workflow proves page posting, direct notice when required, lead time, and fresh acceptance where required.
- [ ] A separately versioned Website Terms correction resolves the older refresh, Download, and entitlement wording before Privacy V3 becomes an integrated operative release.
- [ ] Only after exact review-byte approval may the nondeployable content seal be issued; only after the remaining release evidence and Website Terms blocker are complete may a later task assign version/effective/full-page-digest/byte/authority values and finalize release artifacts.

## Official primary sources consulted

- [New Jersey Data Privacy Act, P.L. 2023, c.266](https://pub.njleg.state.nj.us/Bills/2022/PL23/266_.HTM) — applicability thresholds, notice content, requests and appeals, rights, minimization, security, sensitive data, and assessments.
- [New Jersey Division of Consumer Affairs: proposed NJDPA rules announcement](https://www.njconsumeraffairs.gov/News/Pages/06022025.aspx) — confirms that N.J.A.C. 13:45L was proposed and an adoption notice was expected in 2026; final status must be independently verified.
- [New Jersey Division of Consumer Affairs proposals](https://www.njconsumeraffairs.gov/Proposals) and [adoptions](https://www.njconsumeraffairs.gov/Pages/adoptions.aspx) — official pages to check immediately before release.
- [New Jersey Consumer Fraud Act](https://www.njconsumeraffairs.gov/statutes/consumer-fraud-act.pdf) — state consumer-deception framework.
- [New Jersey State Police Cyber Crimes Unit](https://www.nj.gov/oag/njsp/division/investigations/cyber-crimes.shtml) and [Identity Theft Prevention Act](https://www.njconsumeraffairs.gov/Statutes/Identity-Theft-Prevention-Act.pdf) — covered breach-reporting sequence and statute.
- [FTC privacy and security enforcement](https://www.ftc.gov/news-events/topics/protecting-consumer-privacy-security/privacy-security-enforcement) and [Protecting Personal Information: A Guide for Business](https://www.ftc.gov/business-guidance/resources/protecting-personal-information-guide-business) — truthful privacy/security promises and data-security program guidance.
- [FTC COPPA FAQ](https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions) — child-directed services and actual knowledge for general-audience services.
- [California Business and Professions Code § 22575](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=BPC&sectionNum=22575) — CalOPPA categories, third parties, material changes, effective date, Do Not Track, and other-party cross-site collection disclosures.
- [California Civil Code § 1798.140](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1798.140) — CCPA/CPRA definitions and business thresholds.
- [California Civil Code § 1798.100](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1798.100.) and [California Privacy Protection Agency regulations](https://cppa.ca.gov/regulations/) — category-level retention period/criteria duties where the CCPA/CPRA applies and current rule materials.
- [Cloudflare Public DNS Resolver privacy notice](https://developers.cloudflare.com/1.1.1.1/privacy/public-dns-resolver/) and [1.1.1.1 documentation](https://developers.cloudflare.com/1.1.1.1/) — DoH resolver operation, resolver logs, source-IP handling, APNIC access, authoritative subrequests, and aggregates.

## Repository evidence map

- Guest tab storage/restore: `abracadabra/app/abracadabra-app.js`
- Guest-to-signed-in save boundary: `abracadabra/app/abracadabra-customer-control-dom.js`
- Public-domain DoH request: `domains/domain-search.js`
- Direct Download artifact verification: `server/commerce-v2/payment.mjs`
- Direct Download HTTP response: `server/hosted/http.mjs`
- ZIP export authorization: `server/hosted/postgres-service.mjs` and `202607280007_hosted_api_edges.sql`
- Alakazam release mode: `server/hosted/alakazam-release-config.mjs`
- Transactional email tracking readiness: `server/hosted/resend-mail-transport.mjs`
- Identity and organization: `202607280000_first_party_identity.sql`
- Projects, acceptances, raw facts, HTML, and replicas: `202607280002_projects_content.sql`
- Commerce records and deletion tombstones: `202607280003_commerce_serving_operations.sql`
- Retained deletion events and purge: `202607280004_workflow_boundaries.sql`
- Runtime identity/rate limits: `202607280008_first_party_runtime_machinery.sql`
- Registration and recovery delivery: migrations `202607280017` through `202607280020`
- Download preparation and settlement: migrations `202607280019` and `202608020022`
- Held Alakazam machinery: migrations `202608020023` through `202608040033`
- Held custom-service machinery: migrations `202608050034` through `202608060047`

---

**Owner review result:**

- [ ] Return approved replacement IDs for a later source-edit task.
- [ ] Return rejected IDs with replacement direction.
- [ ] Explicitly approve the exact review-artifact digest and byte count before any content-seal step.

Optional counsel review is recommended but remains separate and nonblocking; this owner-review section does not treat it as exact-byte authority.
