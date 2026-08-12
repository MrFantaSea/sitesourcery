# FIN-004F central hosted/operator/Stripe provenance

State: proved central composition cohort; FIN-004 remains open
Donor: `a81d1438fd57e62e44b917c803988301945ef2ef`
Parent integration commit: `abd551d`

## Imported donor allowlist

Operator artifact:

- `operator/index.html`
- `operator/operator.css`
- `operator/operator.js`
- `scripts/build-hosted.mjs`
- `scripts/test/hosted-artifact.test.mjs`
- `scripts/test/operator-support-ui.test.mjs`

Stripe trust boundary:

- `server/commerce-v2/index.mjs`
- `server/commerce/adapters/stripe.mjs`
- `server/commerce/stripe-webhook-rotation.mjs`
- `server/commerce/test/stripe-provider.test.mjs`
- `server/commerce/test/stripe-webhook-rotation.test.mjs`
- `server/hosted/stripe-production-config.mjs`
- `server/hosted/stripe-webhook-router.mjs`
- `server/hosted/test/stripe-production-config.test.mjs`
- `server/hosted/test/stripe-webhook-router.test.mjs`

Hosted and operator composition:

- `server/hosted/RUNTIME.md`
- `server/hosted/bin/server.mjs`
- `server/hosted/http.mjs`
- `server/hosted/operator-work-queue-http.mjs`
- `server/hosted/operator-work-queue-postgres.mjs`
- `server/hosted/postgres-service.mjs`
- `server/hosted/support-cases-http.mjs`
- `server/hosted/support-cases-postgres.mjs`
- `server/hosted/test/http-capabilities-snapshot.test.mjs`
- `server/hosted/test/http-commerce-v2.test.mjs`
- `server/hosted/test/http-operator-support.test.mjs`
- `server/hosted/test/http-resend-mail-events.test.mjs`
- `server/hosted/test/operator-support-production-composition.test.mjs`
- `server/hosted/test/operator-work-queue-http.test.mjs`
- `server/hosted/test/operator-work-queue-postgres.integration.test.mjs`
- `server/hosted/test/operator-work-queue-postgres.test.mjs`
- `server/hosted/test/postgres-service.integration.test.mjs`
- `server/hosted/test/support-cases-http.test.mjs`
- `server/hosted/test/support-cases-postgres.test.mjs`

Credential topology:

- `ops/OPS-SECRETS-01A-HELD-CREDENTIAL-TOPOLOGY-RUNBOOK-2026-08-10.md`
- `ops/SITESOURCERY-S01-STRIPE-PRODUCTION-READINESS-2026-08-09.md`
- `ops/WIRING-NOTES-OPS-SECRETS-01A-2026-08-10.md`
- `ops/credential-topology.mjs`
- `ops/credential-topology.schema.json`
- `ops/hosted.env.example`
- `ops/test/credential-topology.test.mjs`
- `ops/test/stripe-restricted-key-topology.test.mjs`

## Local convergence repairs

The donor's central PostgreSQL journey and the cumulative migration verifier had
drifted behind the imported contracts. The integration branch keeps the strict
production constructors and repairs only proof composition:

- the migration verifier now creates the organization and active membership
  required by operator work-queue authorization;
- the canonical service fixture supplies the required Alakazam invoice-
  finalization webhook port;
- its Stripe readiness fixture uses the current purpose-indexed `taxModes`
  contract;
- the shipped-page journey waits for exact Legal V4 readiness before completing
  the explicit acceptance form;
- the browser proof distinguishes the current held Alakazam DOM from a future
  released surface and retains the released-surface proof branch;
- checkout-return navigation expects the application to remove sensitive query
  parameters before readiness completes; and
- intentional held/unauthenticated `401`, `403`, and `503` resource-status logs
  are separated from actual browser exceptions after the journey's effect,
  route, and missing-file assertions pass.

No migration was added by this cohort.

## Routes and capability composition

- exact raw-byte Stripe ingress: `POST /api/v1/webhooks/stripe`;
- exact raw-byte Resend ingress: `POST /api/v1/webhooks/resend`;
- customer support list, open, and read routes under
  `/api/v1/support-cases`;
- operator support list/read and bounded lifecycle commands under
  `/api/v1/operator/support-cases`;
- operator queue list, refresh, and the bounded professional-reversal repair
  command under `/api/v1/operator/work-queue`.

The hosted artifact contains the private operator UI. Production startup mounts
support cases, operator work queue, Resend event ingress, and the shared Stripe
router through one canonical service composition.

## Provider and effect state

The Stripe runtime credential topology derives least-privilege operations for
`alakazam`, `customBuildChange`, `customBuildFinal`, `customBuildStart`,
`download`, and `serviceAssessment`. Standard, full-access, shared, stale, and
mode-mismatched credentials fail closed. Domain payment operations remain a
separate held purpose. Webhook verification is bound to the exact raw request
bytes and one non-secret rotation receipt.

This cohort executed no live Stripe, mail, domain, customer, publication, or
other provider effect.

## Proof

- credential topology and Stripe trust boundary: 168 focused checks passed;
- hosted artifact, operator UI, capability, support, work-queue, commerce, and
  Resend HTTP composition: 47 focused checks passed;
- isolated PostgreSQL 16 applied all 77 migrations and passed every cumulative
  migration proof, including operator work queue, mail, domains, Alakazam, and
  both Care cohorts;
- canonical PostgreSQL service journey: 13/13 passed, including
  `CORE-REVENUE-E2E-01`, browser account/legal/project/Download flows, export
  fencing, and the Alakazam setup race;
- independent PostgreSQL operator queue journey: 1/1 passed;
- caller-owned databases dropped, both isolated servers stopped, port `55449`
  closed, and both explicit FIN-004F temporary cluster directories removed;
- complete `npm test`: passed, including 841 Node tests, 786 hosted-service
  tests, 166 ops tests, deterministic 90-file artifacts, and the 15-route by
  3-viewport browser audit;
- `git diff --check`: passed.

## Still open

FIN-004 still requires root Care HTTP composition, a Responder fulfillment/API
surface, worker and operational release composition, and the mapped adjacent
integration contracts. FIN-005 through FIN-010 remain open. The public
placeholder and all adjacent HQ listeners remain untouched.
