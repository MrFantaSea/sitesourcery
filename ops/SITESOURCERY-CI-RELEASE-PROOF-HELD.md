# Held exact-release proof operator runbook

## Purpose and authority

This workflow answers one question: did one explicit candidate pass the exact
release proof bound by one verified successor release epoch? A pass produces a
`verified_held` receipt. It does not release anything.

The workflow is manual-only, uses the protected `ci-release-proof-held`
environment, has read-only repository permission, persists no credentials, and
contains no upload, deploy, DNS, publication, commerce, or provider action.

## Required inputs

- `candidate_sha`: one full lowercase 40-character commit SHA.
- `successor_input_sha256`: the lowercase SHA-256 of
  `ops/releases/ci-successor-inputs/<candidate_sha>.json` in the exact workflow
  control commit.

The successor input must bind all of the following to the same candidate:

- exact source commit and tree;
- origin artifact, unit, environment-schema, legal, ingress, and rollback
  identities;
- the final ordered migration names, byte counts, individual digests, derived
  count, latest filename, and manifest digest;
- the exact positive Legal V4 Pages file count and manifest supplied by the
  successor input;
- Node `24.18.0` and wholly held authority.

Missing, stale, reordered, extra, or changed evidence fails closed. There is no
default migration count and no branch-tip fallback.

## Proof sequence

1. GitHub pauses at the protected environment for the required reviewer.
2. The job checks out the exact workflow commit and exact candidate without
   persisted credentials.
3. It checks the successor-input file digest, semantic binding, candidate HEAD,
   clean tracked state, pinned Node version, exact migration bytes, and
   byte-identical proof implementation.
4. It installs only lockfile dependencies and the repository's exact reviewed
   browser, then runs `npm test` and records the full-suite receipt.
5. It independently runs `npm run check:ops` and records the ops receipt.
6. It builds and checks the Legal V4 Pages projection, verifies the rebuilt
   artifact against both the successor's exact positive file count and supplied
   manifest, and records the legal receipt. The current reviewed projection is
   94 files; that number belongs only in its explicit successor evidence and is
   not a workflow or runtime constant.
7. It audits the exact projection at 320, 390, and 1440 CSS pixels with Google
   Chrome for Testing `149.0.7827.55`, then records route and view counts.
8. It starts a runner-local PostgreSQL 16 cluster on loopback and creates only
   `ss_ci_release_<run-id>_<run-attempt>`, after exact regex validation. The
   comprehensive migration/journey verifier receives the successor's ordered
   filenames and must apply exactly that derived count.
9. Its trap terminates sessions for only that validated database, drops only
   that database, runs a parameterized read-only admin absence query, records
   `databaseAbsent: true`, and stops only its own cluster.
10. The final verifier rechecks the clean candidate and origin seal, requires
    all six context-matched receipts exactly once, and emits `final.json` plus
    its canonical JSON in the retained workflow log.

## Failure response

Any failed command stops the proof. Do not retry by editing evidence, relaxing a
gate, changing the inventory, reusing a database, or selecting a branch tip.
Correct the candidate or produce a new verified successor input, then start a
new manually reviewed run. A failed or missing cleanup receipt means the run is
not valid even when preceding tests passed.

If the fallback cleanup itself fails, inspect only the named runner-local
database and the workflow's own PostgreSQL process. Do not point this workflow
at a shared, hosted, staging, or production database.

## Preserved holds

The held authority object must remain exact: no capabilities, customer effects,
provider effects, DNS mutation, or deployment. Stripe, Resend, Cloudflare,
publication, commercial activation, and production credentials are outside
this workflow and must never be added as secrets or steps.

## Residual risk

- The GitHub environment protection is external configuration and must be
  independently verified before first use.
- Locked dependency and reviewed-browser installation require ordinary CI
  package-download egress; application/provider credentials remain absent.
- GitHub workflow logs retain the final receipt, but this packet intentionally
  adds no artifact-upload authority. If immutable off-run retention is later
  required, it needs a separate bounded policy decision and packet.
- This packet plans the disposable PostgreSQL proof but did not execute it.
  Local packet tests use injected fixtures only.
