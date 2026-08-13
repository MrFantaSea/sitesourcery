# FIN-004U operator and customer resolution-surface provenance

Date: 2026-08-13
State: proved
Candidate branch: `integration/final-successor-20260811`

Implementation commit: `8a1e8490bafbe74579ad50edf59ace0599662351`

Proved implementation tree: `918db718411df2f5432e525feeabb520247b60e1`

## Authority and boundaries

- Integration base: `b03cccbdc5252db3bd5f90084dbfa27beca33f52`.
- Preserved union donor: `a81d1438fd57e62e44b917c803988301945ef2ef`.
- This cohort is a native continuation of the proved FIN-004 Care, Responder,
  provider-reconciliation, operator, customer, and hosted-root contracts. It
  imports no new archive donor.
- No adjacent HQ listener or Dell commercial-engine source was excluded,
  reclassified, stopped, or modified. Their explicit integration contracts
  remain ordered FIN-004V work.
- The public placeholder, DNS, live providers, credentials, protected
  databases, HQ processes, deployed services, and cutover state were
  unchanged. No email, payment, domain, Twilio, publication, deployment, or
  public effect occurred.

## Durable operator reconciliation

Migration 133, `202608130133_operator_resolution_surfaces.sql`, adds one
append-only, evidence-bound resolution for an exact provider-reconciliation
case revision. A resolution command is actor-, organization-, case-, revision-,
kind-, evidence-, and command-bound. Exact replay returns the retained result;
command reuse or revision conflict fails closed. The command has no generic
repair path and no provider-effect port.

The authenticated operator boundary exposes only:

- `GET /api/v1/operator/provider-reconciliation/cases/:caseId`; and
- `POST /api/v1/operator/provider-reconciliation/cases/:caseId/resolution`.

The read projection is digest-only. The resolution records operator evidence
and closes the manual-review item; it does not infer provider state, retry an
uncertain effect, or mutate a provider.

The source-authoritative work queue now projects open reconciliation cases and
retains typed visibility for all six pre-existing manual-review sources:

1. Responder delivery;
2. Responder missed-call follow-up;
3. Responder ciphertext cleanup;
4. Project lifecycle;
5. Domain lifecycle; and
6. Care lifecycle.

Those six retained sources remain actionless in this cohort. The operator desk
does not manufacture a generic repair command for them.

## Complete held operator service desk

The authenticated operator page now composes the canonical Care and Responder
read models beside work-queue and support-case truth. Care exposes the complete
already-implemented held command set: open and close service periods, open and
transition tickets, allocate capacity, and reserve held mail evidence.

Responder exposes operator-recorded consent, STOP, human handoff, held-message
acknowledgment, and the global kill. The kill remains engaged and every command
continues through the existing exact HTTP and repository boundaries.

The desk also exposes the previously unsurfaced Responder number-binding
workflow: list, operator-attested provision, and retirement. A raw phone number
and provider SID values exist only in the active form and request body. SID
controls use password inputs, the form is cleared after submission, and the
server retains and returns only versioned digests and non-secret evidence. No
provider provisioning occurs.

## Customer Care and Responder surfaces

The hosted Abracadabra control room now loads the session- and project-bound
customer Care and Responder projections from `GET /api/v1/care` and
`GET /api/v1/responder`.

Customer Care exposes held service truth and the bounded held customer action
already supported by the canonical service boundary. Customer Responder
exposes consent, STOP, handoff, and held-message acknowledgment through exact
CSRF- and idempotency-bound requests. It exposes no operator action, raw route,
provider identity, billing authority, provider transport, or commercial
release.

The hosted manifest, script order, staging configuration, static artifact
checks, and current browser fixture all include these surfaces without changing
the public placeholder or opening provider effects.

## Changed-path allowlist

The implementation commit changed only the following reviewed categories:

- migration 133 and migration-verification inventory;
- provider-reconciliation operator repository and HTTP boundary;
- root server, HTTP, readiness, and operator work-queue composition;
- operator HTML, CSS, client validation, typed reconciliation, complete Care
  and Responder controls, and Responder number-binding controls;
- hosted customer service-surface composition, styling, manifest, and staging
  configuration;
- focused structure, unit, HTTP, composition, real-PostgreSQL, static, and
  real-browser tests; and
- the current browser audit's held Care and Responder fixture responses.

The exact file-level allowlist is the output of:
`git show --format= --name-only 8a1e8490bafbe74579ad50edf59ace0599662351`.
No predecessor, archive branch, unrelated dirty source, deployment manifest,
DNS record, or public artifact source was imported.

## Adversarial review and corrections

The cohort was reviewed for cross-tenant access, stale revision writes,
command reuse, manufactured repair authority, provider retry, raw provider
identity leakage, partial UI exposure, hidden action controls, responsive
overflow, and proof-fixture drift.

The following defects or evidence gaps were found and corrected before the
checkpoint:

1. The first reconciliation semantic digest included the observation clock,
   which would prevent exact replay. The retained digest now excludes clock
   drift while preserving the complete authority tuple.
2. The migration's resolution guard was initially separated from the command
   write. The final SQL validates and writes the exact command in one
   transaction.
3. Early work-queue fixtures and startup readiness covered reconciliation but
   not every retained manual-review source. All six sources are now explicit
   and typed.
4. The first operator composition exposed only a subset of Care and Responder
   actions. The final desk exposes every already-implemented held action.
5. Responder number-binding management had a backend boundary but no named
   operator UI. Exact list, attested provision, and retirement controls were
   added with transient raw inputs and digest-only results.
6. The full browser audit's exact API fixture returned 404 for newly mounted
   held Care and Responder reads. Exact held responses were added; product
   behavior was not weakened.
7. The initial operator real-browser fixture omitted CSS-referenced reviewed
   assets and counted controls hidden by ancestor panels. It now serves the
   exact assets and measures only rendered controls.
8. Contract and validator proof alone did not exercise the authenticated
   operator composition. A real-browser smoke test now verifies all three
   reviewed viewports, mounted service panels, the number-binding form, zero
   raw-provider display, zero writes, zero console/network errors, no overflow,
   and 44px visible controls.
9. Initial browser launches were denied loopback binding by the filesystem
   sandbox. The exact same tests were rerun with loopback-only permission; no
   external network or live service was used.

Final verdict: **PASS — no open FIN-004U implementation defect**.

## Proof

PostgreSQL 16 proof used only the disposable cluster at
`/private/tmp/sitesourcery-fin004u.TB7OIr/pgdata` on port 55444:

- a fresh database named `fin004u_final` applied all 86 ordered canonical
  migrations through migration 133;
- the complete migration/RLS/service/subsystem verifier passed;
- the real operator reconciliation journey passed 1/1, including cross-scope
  denial, digest-only read, queue and retained-manual visibility, exact
  resolution, replay, conflict, and queue clearance; and
- no protected or live database was contacted.

Focused proof at the implementation tree included:

- operator/customer/reconciliation structure, repository, HTTP, composition,
  hosted, and service-surface tests: 68/68 passed;
- real operator browser proof: 3/3 passed at 320x720, 390x844, and 1440x1000;
- Care browser proof: 3/3 passed at the same reviewed viewports;
- syntax and `git diff --check`: passed; and
- implementation checkpoint clean before the final cumulative ladder.

The complete clean-tree `npm test` ladder ran at implementation commit
`8a1e849` / tree `918db71` and exited `0`:

- runtime, HTML, authority, catalog, legal-copy, site, Node, public-truth,
  self-host, hosted-service, and static checks: passed;
- canonical Node matrix: 875/875 passed;
- hosted/service matrix: 994 total, 980 passed, zero failed, 14 intentional
  environment-gated PostgreSQL skips;
- operations: 205/205 passed;
- Pages artifact: 90 allowlisted files rebuilt and verified;
- hosted artifact: rebuilt and HTML-validated; and
- browser audit: 15 hosted routes at 320x720, 390x844, and 1440x1000,
  including the exact customer and owner payment journeys.

## Remaining ordered work

- FIN-004V: adjacent integration contracts, with no silent exclusion of HQ,
  Dell, the private messenger, command deck, phone bridge, Client Profile Hub,
  or marketing desk.
- FIN-005 through FIN-010: outside-union disposition, root composition,
  catalog/legal closure, migration/restore rehearsals, immutable staging,
  acceptance, held install, and explicit owner-gated cutover.
