# Joint legal V3 protected-root wiring notes — 2026-08-09

These are exact integration instructions for the owner of the protected
composition roots. This branch deliberately does not edit
`server/hosted/http.mjs`, `server/hosted/postgres-service.mjs`,
`server/hosted/repository-postgres.mjs`, or
`scripts/hosted-truth/manifest.mjs`.

## 1. Hosted manifest and builder

`abracadabra/app/abracadabra-api.js` now has SHA-256
`3bccc48da292894144de658145b23a426b6cd9a77640fc4e90dbfeb4a891c797`.
Replace only its old value
`c7f9b274d8556d73710bd50af7610523f1a390beeb90758fd87b3ed3ef12f49f`
in `hostedStagingAssetSha256`.

The standard hosted builder must gain one explicit finalized-joint-V3 input
that consumes `joint-legal-v3-release-constants.json`, validates schema
`sitesourcery.hosted-joint-legal-v3-finalization/v1`, and copies/verifies all
five receipt artifacts. Do not infer a release from candidate filenames or the
content seal. In finalized mode:

- replace the old legal-center truth requirements with the exact Privacy V3 +
  Website Terms V3 versions from the receipt;
- permit exactly the two receipt-listed V3 archive paths;
- verify current/versioned byte identity for Privacy and Terms;
- retain the V2 Privacy and Terms archive allowlist entries and their current
  immutable hashes;
- require the active `$5`, `$200`, Custom, Stripe automatic-tax, Resend,
  Privacy V4 boundary, and held-service phrases present in the sealed pages;
- forbid `noindex`, `unsealed`, review/template tokens, a V2 identity on the
  current legal pages, or an Alakazam/Responder/domain-purchase offer.

Candidate-source hashes for an optional manifest ledger are:

| File | SHA-256 |
| --- | --- |
| `scripts/hosted-truth/candidates/legal-center-v3-head.html` | `a8c365cfea5b966461f2e5bf515908546c02e9fc257bdd7e553453fe533afceb` |
| `scripts/hosted-truth/candidates/legal-center-v3-main.html` | `5f8d29e6a4621f65693941e991351389afb79fbeec0adcaab01e218c0f6ce358` |
| `scripts/hosted-truth/candidates/legal-website-terms-v3-head.html` | `8c956e8e68eec4da20805db52fc28a1cc66a4253593d6c590bc13b941c982a53` |
| `scripts/hosted-truth/candidates/legal-website-terms-v3-main.html` | `6031863bf0cd6e87759738a90f5b541c7d1380613f768012c3ec638bceece3e3` |

## 2. PostgreSQL readiness root

In `server/hosted/repository-postgres.mjs`:

1. Change every v48 contract marker from
   `canonical-ss-v48-hosted-privacy-v3` to
   `canonical-ss-v48-hosted-joint-legal-v3` in the catalog, data, and exact
   constants queries.
2. Keep the three V2 rows required by the global pre-v48 parse-safe readiness
   query. For `v2_artifact_ready`, require both immutable artifacts: Privacy V2
   document `...0022`, `19,935` bytes, and Website Terms V2 website document
   `...0023`, `21,380` bytes.
3. For `v3_artifact_ready`, require exactly two artifacts whose digest matches
   their document: Privacy `...0048` and Website Terms website `...0104`.
   Require no artifact for the product-anchor document `...0103`.
4. For `authority_ready`, require exactly the V3 Privacy/product/website IDs
   `...0048`, `...0103`, and `...0104`, non-retired V3 versions, and SHA-256
   content digests.
5. Expand `PROJECT_LEGAL_CONSTANTS_QUERY.exact_artifacts_ready` from one binding
   to two. Parameters `$19`–`$23` remain the Privacy artifact; `$24`–`$28`
   bind the Website Terms website artifact; the authority digest moves from
   `$24` to `$29`.
6. In `projectLegalAuthorityMatches`, require
   `expected.artifactBindings[0]` and `[2]`, append the website ID plus its four
   artifact fields after the Privacy fields, then append the authority digest.

Those exact changes were exercised in an external integration simulation with
pinned Node `24.18.0` and fresh PostgreSQL `16`. All 54 migrations applied after
the deliberate unsealed migration-48 rejection; joint legal readiness was
true; the rogue fourth acceptance was rejected; V2 evidence was byte-identical;
and the random database was dropped (`databaseAbsent true`).

## 3. HTTP and service roots

No semantic change is required in `server/hosted/http.mjs`: it already exposes
the public authority returned by the configured service and does not synthesize
document constants.

No semantic change is required in `server/hosted/postgres-service.mjs`: the
project-creation transaction already iterates the exact three documents and
validates each corresponding `artifactBindings[index]`. With the authority in
this branch, index `0` is Privacy, index `1` is the product anchor with a null
artifact, and index `2` is the Website Terms archive artifact.

## 4. Cutover order and proof commands

1. Generate the real joint finalization receipt at the actual publication UTC
   instant. Never use the disposable 2099 proof.
2. Apply the exact receipt constants to migration 48 and the runtime environment.
3. Land the protected manifest/repository wiring above.
4. Run pinned focused tests and the disposable PostgreSQL verifier.
5. Run the browser audit against the exact finalized artifact:

   `/private/tmp/sitesourcery-node-24.18.0/node-v24.18.0-darwin-arm64/bin/node --experimental-websocket scripts/browser-audit-joint-legal-v3.mjs --finalized-artifact-root ABSOLUTE_FINALIZER_OUTPUT`
6. Require 3 legal routes × 3 viewports, loopback-only network, zero missing
   files, zero browser exceptions, and all nine screenshot receipts before
   promotion.

The release remains fail-closed until all of these steps share the one receipt
tuple.
