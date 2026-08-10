# CUSTOM-DIRECT-01 integration notes

This packet lets an accepted direct customer Engagement become the authority
for a Custom quote without fabricating or requiring a paid assessment. It does
not contact Stripe, change a payment release mode, publish a site, or create a
provider effect.

## Migration order

- Apply `202608100113_custom_direct_opportunity.sql` additively after every
  migration already present in the integration branch. The current union has
  `202608100112_operator_work_queue.sql` immediately before this packet; the
  number 111 remains absent and this packet must not invent or rename it.
- The integration ancestry must include commit `6b5a0ba` so Engagement exposes
  `ss.hosted_runtime_contract_v106()` while durable Mail keeps v54. Do not
  replay the earlier duplicate v54 marker pair.
- The exact-f8342c0 feature branch proves 64 migration files through 113. The
  current 64-file integration union becomes 65 files after this migration is
  merged; update the integration verifier additively and preserve 112 then 113
  as its final ordered names.
- Migration 113 fails closed if a retained direct Engagement already exists.
  Such rows require an explicit, reviewed backfill rather than inferred quote
  authority.

## Hosted boundary

`server/hosted/bin/server.mjs` needs no new constructor or environment value.
Its existing `createPostgresCustomServicesCustomBuild` instance gains
`issueDirectQuote`, and `createHostedApi` receives that same boundary.
The Abracadabra API client and private owner quote desk already consume the
new projection: direct opportunities use the project route, while assessment
opportunities require an explicit apply/decline credit selection.

Preserve both quote endpoints:

- Assessment successor: `POST
  /api/v1/operator/custom-services/assessments/:jobId/custom-build-quote`.
  The body must explicitly select `apply_assessment_credit` or `no_credit`.
- Direct Engagement: `POST
  /api/v1/operator/custom-services/custom-build-opportunities/:projectId/quote`.
  The body must explicitly contain `creditSelection: "no_credit"`.

Do not infer credit selection from credit availability. A selected assessment
credit is one-use and same-project; declining it leaves the grant available.
A direct quote has no credit grant or application and produces one full-price
first-payment invoice line.

## Tax and release boundary

The first Custom invoice still uses the existing purpose-bound Custom tax
authority. Both credited assessment-successor and direct invoices keep
`tax_state = calculation_required`, explicit Stripe tax behavior/code at the
adapter boundary, and the owner-approved held/disabled policy. Migration 113
does not activate future automatic tax.

Keep Custom start, change, final, Domain, and every other commercial switch in
its existing held state. Provider calls and live configuration are outside
this packet.

## Required proofs

Run with pinned Node 24.18 and PostgreSQL 16:

```sh
node --test \
  server/hosted/test/http-custom-services-owner.test.mjs \
  server/hosted/test/custom-services-custom-build-payment-projection.test.mjs \
  server/data-plane/tests/postgres-migration-structure.test.mjs

SITESOURCERY_PG_CUSTOM_SERVICES_TEST_URL=postgresql://HOST/DB \
  node --test --test-concurrency=1 \
  server/data-plane/tests/custom-service-quotes-postgres.integration.test.mjs

SITESOURCERY_PG_CORE_RELEASE_ADMIN_URL=postgresql://HOST/ADMIN_DB \
  node server/data-plane/tests/verify-empty-postgres-migrations.mjs
```

Require the empty-database proof to report the direct Engagement journey,
exact no-credit invoice arithmetic, database absence after cleanup, and the
corrected Engagement v106 contract.
