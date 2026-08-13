# FIN-004T mandatory worker closure and inbound follow-up provenance

Date: 2026-08-13
State: proved
Candidate branch: `integration/final-successor-20260811`

Implementation commit: `0e414706c68fb4d2ec59b60d2b277631c37d619c`

Proved implementation tree: `646ac32ec8b66135b39290889eb4ebbad0868aff`

## Authority and boundaries

- Integration base: `b03cccbdc5252db3bd5f90084dbfa27beca33f52`.
- Preserved union donor: `a81d1438fd57e62e44b917c803988301945ef2ef`.
- This cohort is a native continuation of the already-proved FIN-004 worker,
  Domain, Care, Responder, provider-reconciliation, retention, and operations
  contracts. It imports no new archive donor.
- No adjacent HQ listener or Dell commercial-engine source was excluded or
  reclassified. Their explicit integration contracts remain ordered FIN-004V
  work.
- The public placeholder, DNS, live providers, provider credentials,
  protected databases, HQ processes, deployed services, and cutover state were
  unchanged. No email, payment, domain, Twilio, publication, deployment, or
  public effect occurred.

## Exact worker topology

The dedicated worker process now accepts exactly these eleven canonical
purposes, in this order:

1. `export`
2. `cancellation`
3. `notification-mail`
4. `alakazam-fulfillment`
5. `alakazam-retained-lifecycle`
6. `responder-fulfillment`
7. `provider-reconciliation`
8. `responder-retention`
9. `project-lifecycle`
10. `domain-lifecycle`
11. `care-lifecycle`

The purpose list is exact in the parser, supervisor, held environment, unit
runbook, production worker entrypoint, and origin install/readback seal.
Activation remains globally held and each effect-bearing purpose remains
independently gated.

The owner-required W1 through W10 mapping is complete:

| Worker requirement | Exact implementation |
|---|---|
| W1 Mail delivery | `notification-mail` |
| W2 Project lifecycle | `project-lifecycle` |
| W3 Cancellation | `cancellation` |
| W4 Export | `export` |
| W5 Alakazam fulfillment | `alakazam-fulfillment` plus `alakazam-retained-lifecycle` |
| W6 Domain lifecycle | `domain-lifecycle` |
| W7 Care lifecycle | `care-lifecycle` |
| W8 Responder fulfillment | `responder-fulfillment` plus missed-call follow-up; ciphertext retention is isolated as `responder-retention` |
| W9 Provider reconciliation | `provider-reconciliation` |
| W10 Monitoring/deadman | Independent operations units and timers proved in FIN-004G, intentionally outside the worker failure domain |

All worker-process purposes retain canonical ordering, explicit owner
approval, bounded loops, readiness before start, graceful reverse-order stop,
and fail-closed startup. W10 is not falsely counted as a worker-process
purpose: a crashed worker cannot be allowed to disable its own detector.

## Project, Domain, and Care lifecycle closure

Migration 131,
`202608130131_worker_lifecycle_closure.sql`, adds the exact durable contracts
for the three previously open lifecycle purposes.

Project lifecycle uses bounded discovery, `SKIP LOCKED` claims, expiring
leases, fencing tokens, retry ceilings, and explicit manual review. A project
whose retention horizon expires stops for exact deletion approval. A sealed
purge then orders publication removal, private-object deletion, and database
finalization. Unpublication cannot complete until exact provider readback says
`published: false`; a retained replica without a reviewed delete port prevents
activation rather than manufacturing completeness.

Domain lifecycle is deliberately readback/reconciliation-only. It requires a
digest-pinned reviewed adapter and exact storage readiness, records bounded
leased observations, and has no registrar mutation, raw credential, browser
price, or charge authority.

Care lifecycle closes an eligible service month and opens the next exact
calendar month. Only unused included units from the immediately prior period
may carry once. It performs no payment, mail, or provider action.

## Voice target and missed-call follow-up closure

Migration 132,
`202608130132_responder_voice_followup_closure.sql`, adds an encrypted,
per-binding Voice target and one durable follow-up job per applied missed call.

Voice dialing remains independently held. Verified mode can render only one
fixed private Twilio `<Dial action>` after the signed inbound arrival is
durable, the active provider-number binding is exact, the encrypted target
opens under its own authority, and the configured action URL exactly matches
the reviewed production dial-result callback. The signed dial result is the
sole answered-versus-missed authority.

A missed result creates one stable, lease-fenced follow-up job. Missing or
revoked consent moves it to manual review without opening caller material.
Active consent permits only the fixed STOP-bearing follow-up body to be sealed
as an existing encrypted Responder delivery operation. The ordinary
`responder-fulfillment` worker still owns provider delivery, its lease,
last-moment consent check, receipt/reconciliation boundary, retries, and
dead-letter behavior.

The worker receives neither raw identity peppers nor inbound encryption keys.
The API-authenticated AES-GCM envelope binds its route digest in AAD; the
opened caller is independently compared to the exact active consent route
before follow-up material is created.

## Changed-path allowlist

The implementation commit changed only the following reviewed surfaces:

- migrations 131 and 132 plus migration-verification inventory;
- lifecycle repositories/executor/composition for Project, Domain, and Care;
- encrypted Voice-target vault/repository and exact Twilio dial plan;
- inbound missed-call follow-up repository/composition;
- API/HTTP inbound Voice wiring and PostgreSQL service composition;
- worker configuration, process entrypoint, environment templates, held
  runbook, and origin-seal purpose inventory;
- focused structure, unit, composition, HTTP, and real-PostgreSQL tests; and
- the current-state browser audit's test-only checkout fixture.

The exact file-level allowlist is the output of:
`git show --format= --name-only 0e414706c68fb4d2ec59b60d2b277631c37d619c`.
No predecessor, archive branch, unrelated dirty source, deployment manifest,
DNS record, or public artifact source was imported.

## Adversarial review and corrections

The cohort was reviewed for cross-tenant claims, nullable lock behavior,
worker access to identity secrets, callback substitution, raw-number leakage,
consent races, stale leases, duplicate follow-ups, blind provider retry,
unpublish false positives, purpose-list drift, and time-dependent proof drift.

The following defects were found and corrected before the checkpoint:

1. PostgreSQL cannot apply `FOR UPDATE` to the nullable side of the consent
   `LEFT JOIN`; consent is now locked separately.
2. Global service authority cannot call `extensions.gen_random_uuid`; bounded
   repositories now supply prevalidated Node-generated UUIDs.
3. Follow-up completion lacked exact organization context; it now derives the
   durable organization before mutation.
4. An early composition would have given the worker identity-pepper material;
   the final boundary uses authenticated envelope AAD plus an independently
   verified active-consent route and gives the worker no identity secret.
5. Voice accepted a merely safe callback; it now requires the exact configured
   production dial-result URL.
6. Project unpublication could accept incomplete readback; it now requires the
   exact `published: false` state before completing.
7. The origin install seal retained the older eight-purpose list; its canonical
   inventory is now the same exact eleven-purpose list as the worker runtime.
8. The browser audit retained an exact checkout that expired at
   `2026-08-13T16:30:00.000Z`. The test-only checkout now receives a bounded
   rolling 24-hour validity window while the product continues to reject every
   expired checkout.

Final verdict: **PASS — no open FIN-004T implementation defect**.

## Proof

PostgreSQL 16 proof used only the disposable cluster at
`/private/tmp/sitesourcery-fin004t.NI4pZ5/pgdata` on port 55443:

- a fresh database applied all 85 ordered canonical migrations through
  migration 132;
- the complete migration/RLS/service/subsystem verifier passed;
- the signed Voice-target and follow-up journey passed 1/1;
- the Project/Domain/Care lifecycle journey passed 1/1; and
- no protected or live database was contacted.

Focused proof at the implementation tree included:

- lifecycle/Voice/follow-up migration and focused tests: 62/62 passed;
- syntax and `git diff --check`: passed;
- exact Voice target, consent, STOP-bearing material, lease/fence, manual
  review, lifecycle sequencing, carryover, and readback-negative tests: passed;
  and
- implementation checkpoint clean before the final cumulative ladder.

The complete clean-tree `npm test` ladder ran at implementation commit
`0e41470` / tree `646ac32` and exited `0`:

- runtime, HTML, authority, catalog, legal-copy, site, Node, public-truth,
  self-host, hosted-service, and static checks: passed;
- hosted/service matrix: 982 total, 969 passed, zero failed, 13 intentional
  environment-gated PostgreSQL skips;
- operations: 205/205 passed;
- Pages artifact: 90 allowlisted files rebuilt and verified;
- hosted artifact: rebuilt and HTML-validated; and
- browser audit: 15 hosted routes at 320x720, 390x844, and 1440x1000,
  including the exact customer and owner payment journeys.

## Remaining ordered work

- FIN-004U: authenticated operator reconciliation/resolution and customer
  surfaces, including typed visibility for retained manual-review work.
- FIN-004V: adjacent integration contracts, with no silent exclusion of HQ or
  Dell systems.
- FIN-005 through FIN-010: outside-union disposition, root composition,
  catalog/legal closure, migration/restore rehearsals, immutable staging,
  acceptance, held install, and explicit owner-gated cutover.
