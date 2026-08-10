# Site Sourcery holistic shape audit and execution ledger

Status: active coordination authority  
Prepared: 2026-08-10  
Integration base: `69ad11c682dda9d6f792492d322b662dcbc98b4b`  
Core ancestor: `84aca6b757a806b428ae0cce8115c12dcc6486cd`

This ledger consolidates the system-map, customer-journey, adversarial,
operability, authority/data, product/customer, product/legal/data,
commercial/provider, and operational-topology audits. It is an execution
index, not a new source of commercial, legal, provider, or deployment
authority.

## Current verdict

- Inquiry-only static publication is candidate-ready but not deployed.
- Hosted customer accounts and API are held pending the P0 packets below.
- Every payment purpose remains held pending its purpose-specific proof.
- Legal V4 is sealed and immutable; Stripe Tax has one scheduled New Jersey
  registration effective 2026-10-21T04:00:00Z.
- Cloudflare delegation must not occur before the retained DS-safety deadline
  and fresh fail-closed preflight.

## Target shape

```text
Visitor
├─ Make a one-page preview ── account/save ── $5 Download
├─ Assess an existing site ── invitation/claim ── report ── optional Custom
└─ Commission Custom directly ── invitation/claim ── quote/job/handoff

One account and engagement spine
├─ exact legal/offer acceptance
├─ purpose-bound tax and payment authority
├─ purpose-specific fulfillment engine
├─ customer status and evidence
└─ one operator work queue

One release epoch
├─ source and artifact digests
├─ legal tuple and migration count
├─ installed Dell/HQ identity
├─ public mode: Pages fallback | Cloudflare DNS-only | tunnel-hosted
├─ provider capability/purpose state
└─ backup, monitoring, rollback, and live-byte proof
```

Pages is an explicit status/contact/legal fallback, not a second customer
product. Stripe and Resend are evidence/effect providers, never catalog,
legal, entitlement, or service authority.

## Invariants

1. Browser state and provider callbacks never create money, legal, tax,
   entitlement, completion, ownership, or publication authority.
2. One accepted offer snapshot binds one purpose, provider attempt, immutable
   receipt, and resulting service transition.
3. Provider effects use stable idempotency and exact readback; uncertainty
   creates operator work rather than an unsafe retry.
4. Holding new sales never stops settlement, reversal, cancellation, or
   reconciliation for existing effects.
5. Historical legal artifacts and receipts remain immutable.
6. Guest work remains local until an intentional authenticated save.
7. Assessment credit remains same-organization, same-project, one-use,
   non-cash, and time-bounded.
8. Custom completion never authorizes an automatic final charge; handoff
   requires verified financial clearance.
9. Pages authority cannot grant runtime, commerce, DNS, tunnel, or provider
   authority.
10. Backups, monitoring, and rollback must work when the main runtime fails.

## Active work packets

### Release, authority, and infrastructure

- [ ] **SHAPE-EPOCH-01 — canonical release epoch and verifier**
  - Base: `69ad11c`.
  - Add one non-secret, purpose-scoped release ledger joining source, artifact,
    legal tuple, 58 migrations, installed release, public mode, provider modes,
    backup, monitor, and rollback proof.
  - Split liveness, dependency readiness, and customer capability truth.
  - Keep every release/provider switch held by default.
  - Dependencies: none. Blocks hosted deployment and commerce.

- [ ] **LEGAL-PUBLISH-01 — one hostname, one legal/product truth**
  - Preserve immutable V2/V3/V4 bytes and exact V4 tuple.
  - Resolve owner publication/effective-date receipt semantics without editing
    sealed V4 bytes.
  - Make Pages an explicit status/contact/legal fallback.
  - Prove current aliases and versioned URLs byte-for-byte.
  - Dependencies: SHAPE-EPOCH-01 for final seal.

- [ ] **INGRESS-01 — bounded public ingress and abuse controls**
  - Enforce streaming body limits before buffering at Caddy and Node.
  - Add request deadlines, bounded concurrency, per-IP/global auth limits,
    unique-email amplification protection, and compile/write quotas.
  - Check ownership before compilation or expensive work.
  - Remove enumeration differences without weakening recovery.
  - Dependencies: none.

- [ ] **OPS-ORIGIN-01 — exact Dell/HQ origin seal**
  - Install the final proven release, record tree/unit/env-schema hashes,
    prove 58 migrations, held capabilities, loopback ingress, and rollback.
  - Dependencies: SHAPE-EPOCH-01, INGRESS-01, full release proof.

- [ ] **OPS-DNS-01 — safe Cloudflare cutover**
  - Run the retained post-deadline DS/fallback preflight.
  - Change nameservers only; prove Active, Universal SSL, tunnel and origin.
  - Preserve Pages rollback and mail records.
  - Add only the new Cloudflare DS after convergence.
  - Dependencies: LEGAL-PUBLISH-01, OPS-ORIGIN-01.

- [ ] **OPS-MON-01 — independent observability and dead-man**
  - Decouple monitoring from runtime and backup mounts.
  - Add external apex/content/TLS/tunnel probes and a dead-man alert.
  - Add PII-free request IDs, route/status/latency, DB wait, provider duration,
    worker lag, deployment identity, and unexpected-exception logging.
  - Dependencies: SHAPE-EPOCH-01 for release identity.

- [ ] **OPS-BACKUP-01 — current recovery proof**
  - Prove a non-empty 58-migration backup/restore including Legal V4, Custom,
    payment readiness, and immutable evidence.
  - Record approved RPO/RTO/retention and a replacement-host procedure.
  - Prove an independent off-Zen age-key copy and second ciphertext destination.
  - Plan WAL/PITR before availability promises.
  - Dependencies: final schema from integration.

- [ ] **OPS-SECRETS-01 — provider credential topology**
  - Inventory scope without exposing values.
  - Separate staging/production Resend authority; rotate any shared historical
    full-access credential; prove revocation and delivery.
  - Document Stripe webhook-secret overlap rotation.
  - Dependencies: MAIL-01 and final provider composition.

### Customer and product spine

- [ ] **IA-01 — one plain-language customer spine**
  - Use three starting paths: make a preview, assess an existing site, or
    commission Custom directly.
  - Align navigation, three-path chooser, size ladder, jobs, Domains, Care,
    Responder, and held labels without erasing the brand voice.
  - Describe unavailable products as held/coming later; no present-tense buy
    claim while its purpose is held.
  - Dependencies: none.

- [ ] **ENGAGEMENT-01 — invitation, claim, and canonical project bootstrap**
  - Operator creates an expiring invitation for a customer-owned engagement.
  - Customer sets credentials and claims a new-site or external-site project
    without creating an Abracadabra preview.
  - Support direct Custom provenance and delivered-assessment provenance.
  - Preserve exact organization/project/legal authority and audit evidence.
  - Dependencies: none; blocks assessment/Custom customer completeness.

- [ ] **CUSTOM-DIRECT-01 — direct Custom opportunity**
  - Allow a direct Custom quote without a mandatory assessment report/credit.
  - Keep assessment credit optional, exact, one-use, and project-bound.
  - Prove both direct and assessment-successor arithmetic and lifecycle.
  - Dependencies: ENGAGEMENT-01, TAX-PURPOSE-01.

- [ ] **SURFACES-01 — separate maker, account, and operator bundles**
  - Establish `/make/`, `/account/`, and `/operator/` surfaces.
  - Route-load Download/services/operator capabilities; do not ship operator or
    held-product code to ordinary customers.
  - Preserve all server-side capability checks.
  - Dependencies: ENGAGEMENT-01; staged after current P0 launch work.

- [ ] **CUSTOMER-UX-01 — accessibility, failure, and rights controls**
  - Fix account-tab Arrow/Home/End behavior and screen-reader proof.
  - Add bounded fetch timeout, abort, reconnect, offline, browser-reopen,
    session-expiry, and second-device proofs.
  - Add contextual checkout decline/cancel/abandon/no-charge feedback.
  - Surface support, account export, deletion, and privacy request routes.
  - Dependencies: can start independently; coordinate with SURFACES-01.

- [ ] **SUPPORT-CASE-01 — auditable support/privacy cases**
  - Preserve phone/email intake.
  - Record identity verification, scope, export/deletion work, response, denial,
    appeal, and closure.
  - Prove owner notification and fallback; never claim delivery from a DB insert.
  - Dependencies: MAIL-01.

### Commercial kernel and service lifecycles

- [ ] **TAX-PURPOSE-01 — purpose-bound tax authority**
  - Replace the contradictory global tax assumption with a registry per payment
    purpose.
  - Make Download/assessment/Custom truthfully operable under the approved
    pre-effective policy while preserving exclusive behavior and tax codes.
  - Keep Domains null/held until classified.
  - Dependencies: none; P0 for assessment/Custom.

- [ ] **STRIPE-SLICES-01 — capability/purpose-aware readiness**
  - Download readiness must not depend on Portal/subscription capabilities.
  - Keep least privilege, exact endpoint/coupon/catalog readback, and current
    runtime key until a deliberate split is justified.
  - Dependencies: TAX-PURPOSE-01.

- [ ] **PRO-REVERSALS-01 — assessment/Custom closure semantics**
  - Define agreement-bound cancellation, termination, earned/unearned amounts,
    refund/dispute/reversal, abandoned access, handoff consequence, and operator
    review.
  - Do not invent one universal refund rule.
  - Dependencies: TAX-PURPOSE-01; blocks professional-service commerce.

- [ ] **MAIL-01 — transactional delivery lifecycle**
  - Model pending → provider accepted → delivered | bounced | complained |
    suppressed | expired.
  - Add webhook/event ingestion, exception queue, and fallback recovery path.
  - Prove signup, activation, recovery, new login, expiry, public URLs, and
    customer/operator notifications on the exact deployment.
  - Dependencies: none.

- [ ] **OPS-QUEUE-01 — one operator work queue**
  - Project existing reconciliation-required, service-job, publication, domain,
    Care, notification, and provider failures into one read model.
  - Invoke only existing bounded repair commands; no generic mark-paid action.
  - Add `invoice.finalization_failed` evidence/alert ownership.
  - Dependencies: MAIL-01 and service-specific read models.

- [ ] **COMMERCE-NOTIFY-01 — transition-driven notifications**
  - Transactional outbox for quote, invoice, paid, failure, report, completion,
    cancellation, reversal, domain, and Care transitions.
  - Notifications originate from committed local transitions, not raw provider
    events.
  - Dependencies: MAIL-01.

- [ ] **ACCOUNTING-01 — cross-product purpose journal**
  - Append-only projection over product-specific receipts, fees, payouts, aging,
    tax export, and evidence bundles.
  - Do not replace purpose-specific payment/service state machines.
  - Dependencies: stable purpose registry and reversal semantics.

- [ ] **ALAKAZAM-POLICY-01 — one lifecycle authority**
  - Resolve configurable lifecycle versus hard-coded Care lifecycle conflict.
  - Bind grace, suspension, cancellation, reversal, retention, export, purge,
    customer controls, and later legal acceptance to one policy.
  - Dependencies: later Alakazam release; remains held meanwhile.

- [ ] **CARE-ENGINE-01 — one Care accounting engine**
  - Delineate included Alakazam Care from any standalone Custom Care.
  - Implement one provider-period request/usage ledger, classification,
    assignment, acknowledgement, completion, and customer history.
  - Prevent $50 customers from receiving parallel $35 and $50 allowances.
  - Dependencies: ALAKAZAM-POLICY-01.

- [ ] **PUBLICATION-01 — consolidate publication authority**
  - Prove parity, retain entitlement/version/address/screening gates, then remove
    the unused legacy composition wrapper.
  - Dependencies: later publication release.

- [ ] **DOMAIN-01 — separate domain launch**
  - Resolve classification, dynamic registrar pricing, billing/renewal,
    production adapter, capture/refund/DNS journey, and customer controls.
  - Remove fixed Stripe Product/Price/Payment Link authority after proof.
  - Dependencies: separate owner release; remains held.

- [ ] **RESPONDER-01 — decide or archive**
  - Either implement pricing, telephony/A2P, provider/account/support,
    cancellation/reconciliation/legal/payment, or remove it from the active
    product spine until funded.
  - Dependencies: independent future decision.

### Performance, maintainability, and continuity

- [ ] **WORKERS-01 — supervised worker processes**
  - Move sync ZIP/export and later lifecycle/publication work off the web event
    loop while retaining database leases and bounded budgets.

- [ ] **PG-OPS-01 — database budgets**
  - Add statement/lock/idle-transaction timeouts, consolidate session setup,
    reserve worker connections, and measure before resizing pool 10.

- [ ] **READINESS-01 — cheap liveness and bounded readiness**
  - Separate liveness from dependencies/customer capabilities; short-lived
    cache/singleflight broad provider checks.

- [ ] **PERF-01 — static delivery and measured CWV**
  - Immutable hashed caching, responsive Domains hero, smaller OG image, broader
    social metadata, JSON-LD, minification, and live CWV measurements.

- [ ] **CI-01 — protected exact release proof**
  - Add current PostgreSQL replay/journeys/artifact/browser/ops proof to protected
    release CI without allowing CI to grant deployment authority.

- [ ] **IDENTITY-ROTATION-01 — pepper overlap**
  - Compose prior peppers during rotation and prove existing accounts remain
    verifiable before removing old material.

- [ ] **ONCALL-01 — continuity beyond one operator**
  - Secondary recovery contact, escalation/paging, incident runbook, authority
    renewal, and periodic failed-job audit.

- [ ] **TRUTH-CLEANUP-01 — archive stale generations**
  - Fence/retire generic v1 commerce, stale runbooks, dormant Care authority,
    unused provider objects, redirects, obsolete completion matrices, and stale
    release templates after reference/readback proof.
  - Prune only confirmed missing worktrees and define one canonical checkout.

- [ ] **MODULARIZE-01 — reduce unsafe module size**
  - Split the customer DOM, Stripe adapter, PostgreSQL services, and HTTP router
    by bounded domain after behavior is locked by tests.
  - Generate architecture, migration, and deployed-commit inventories.

## Coverage of the prior consolidated audit

| Prior register | Covered by |
| --- | --- |
| PS-01..03 | LEGAL-PUBLISH-01, OPS-DNS-01 |
| PH-01..03 | SHAPE-EPOCH-01, OPS-ORIGIN-01, OPS-DNS-01 |
| PH-04 | INGRESS-01 |
| PH-05..06 | OPS-BACKUP-01 |
| PH-07..08 | MAIL-01 |
| PH-09 | OPS-MON-01 |
| PH-10 | SUPPORT-CASE-01, OPS-BACKUP-01 |
| PH-11..12 | CUSTOMER-UX-01, SUPPORT-CASE-01 |
| PC-01..02 | TAX-PURPOSE-01, STRIPE-SLICES-01, exact live proof |
| PC-03 | ENGAGEMENT-01, CUSTOM-DIRECT-01 |
| PC-04..05 | CUSTOMER-UX-01, PRO-REVERSALS-01 |
| PC-06 | OPS-QUEUE-01 |
| PC-07 | TAX-PURPOSE-01, final provider readback |
| PL-01..02 | PG-OPS-01, WORKERS-01, load proof |
| PL-03 | PERF-01 |
| PL-04 | WORKERS-01 |
| PL-05 | OPS-BACKUP-01, ONCALL-01 |
| PL-06 | READINESS-01 |
| PL-07 | CUSTOMER-UX-01 |
| PL-08 | CI-01 |
| PL-09 | TRUTH-CLEANUP-01, MODULARIZE-01 |
| PL-10 | load/SLO proof in PG-OPS-01 and WORKERS-01 |
| PL-11 | IDENTITY-ROTATION-01 |
| PL-12..14 | ONCALL-01, MAIL-01, OPS-MON-01 |
| PL-15 | PERF-01 |
| PL-16 | ALAKAZAM-POLICY-01, CARE-ENGINE-01, DOMAIN-01, PUBLICATION-01 |
| PL-17 | OPS-SECRETS-01 |
| PL-18 | SUPPORT-CASE-01 |
| PL-19 | PERF-01 |

## Integration order

1. Parallel foundation: IA-01, ENGAGEMENT-01, TAX-PURPOSE-01,
   SHAPE-EPOCH-01, INGRESS-01, MAIL-01.
2. Integrate foundation and run exact 58-migration/full browser/ops proof.
3. Complete Legal publication, origin seal, current restore, monitoring, and
   Cloudflare cutover.
4. Launch Download alone after exact Stripe test/live readiness proof.
5. Add direct/assessment Custom only after engagement, tax, and reversal
   packets are green.
6. Add operator queue, notification, accounting, surface separation, and
   performance/continuity improvements.
7. Treat Alakazam/Care, Domains, publication, and Responder as separate later
   releases with their own authority and proofs.

