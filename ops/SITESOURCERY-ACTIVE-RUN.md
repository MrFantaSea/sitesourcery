# Site Sourcery active run

This is the durable resume point for the work in progress. It records
execution state that must not live only in chat context. Product scope and the
finish line live in `SITESOURCERY-MULTI-AGENT-ROADMAP-2026-08-04.md`; settled
owner rulings live in `CONTINUITY.md`.

## Recovery rule

After a context compaction, terminal restart, or agent handoff:

1. Read this file, the canonical roadmap, and the latest relevant continuity
   entry before changing code.
2. Inspect the branch, `HEAD`, worktree, running processes, open agents, and
   named disposable resources. Do not infer that an interrupted command
   passed or failed.
3. Resume only the single `Next action` below. Reconcile this file before
   opening another lane or repeating completed work.
4. Record every release-relevant test result here immediately after it
   finishes. Output lost before it is recorded is unverified and must be
   reproduced safely.
5. Before a local commit, replace this in-flight snapshot with the sealed
   checkpoint evidence and the next clean batch.

## Safety holds

- Branch: `build/sitesourcery-v2-20260730`.
- Parent checkpoint: `82bf959` (`Compose held Alakazam webhooks`).
- The commit containing this file is the sealed local Batch 1 checkpoint; use
  `git log -1 --oneline` for its resulting identity after commit.
- Public production remains the July 22 predecessor.
- No push, deploy, DNS change, provider write, credential capture, or release
  approval is authorized by this run.
- Batch 1 is verified, local, and held. It changes no public or provider state.

## Current objective

Batch 1 is complete: a project-scoped customer-safe Alakazam account projection
and read-only UI, a complete held Stripe configuration contract, and an
accepted public-truth audit are sealed together. Batch 2 must start only after
the checkpoint commit and a clean-worktree verification.

## Completed and reviewed

- Customer account projection, PostgreSQL repository read, hosted boundary,
  same-origin GET route, and production composition are implemented.
- The read model excludes provider identifiers and denies cross-tenant,
  cross-project, and foreign billing-owner reads with one generic boundary.
- The read-only account panel covers held, empty, pending, active, attention,
  ended, loading, error, and retry states. Customer billing commands remain
  disabled until Lane E composes them.
- Receipt formatting was corrected to use the receipt total (`$10.00 USD` in
  the focused regression), not a nonexistent money field.
- The browser projection now rejects an impossible subscription-plus-unused-
  first-payment-credit combination instead of rendering contradictory facts.
- Exact held-by-default Stripe Product/Price/Coupon/Portal configuration is
  implemented without real IDs, keys, network effects, or release changes.
- Public promises were classified KEEP / CHANGE / REMOVE / HOLD in
  `SITESOURCERY-PUBLIC-TRUTH-AUDIT-2026-08-04.md`.
- Two integration-review findings were repaired: false empty state for a
  non-owner project member and incorrect receipt rendering.

## Verification ledger

Verified before the two final review repairs:

- Core Node suite: 417/417 pass.
- Hosted service: 135 pass, 2 intentional environment skips, 0 fail.
- Operations: 52/52 pass.
- Migration structure: 23/23 pass.
- Self-host checks: 19/19 pass.
- Site check: 18 live pages and 20 redirects pass.
- Hosted/artifact checks: exact 78-file artifact pass after regeneration.
- Stripe adapter/configuration aggregate: 69/69 pass.

Verified after the relevant repairs:

- Account/repository/HTTP focused tests: 11/11 pass.
- Receipt UI plus hosted-artifact focused tests: 8/8 pass.
- Real PostgreSQL lifecycle journey: 5/5 pass on
  `ss_alakazam_account_batch1_20260804_3` after all 31 migrations, including
  the foreign billing-owner case. The authoritative rerun completed with exit
  0 on 2026-08-04.
- The first isolated Chrome run passed all mechanics but used an impossible
  active-subscription-plus-credit mock. Lead review tightened the validator;
  that visual evidence is superseded.
- The corrected isolated Chrome rerun at 1440×1000 and 320×720 passes every
  state, signed-out/no-project hiding, error/retry, stale-project rejection,
  accessibility-tree semantics, and horizontal bounds. All 94 API requests
  were GETs, no ready-state mutation control or unexpected browser error was
  present, active subscription states show no available Download credit, and
  `$10.00 USD` renders for the receipt. The lead inspected the corrected
  desktop active, mobile active, and mobile available screenshots. Results
  JSON SHA-256:
  `de5990da8eecc14c7a78b0c32c5b5a813f87d20d256a269bc7c0a0fecaf4b78c`.
- Post-review broad rerun: core Node 417/417 pass; hosted service 135 pass,
  2 intentional environment skips, 0 fail; operations 52/52 pass.
- Hosted build plus HTML validation: pass. Public pages artifact: 78
  allowlisted files with exact source bytes, pass.
- Reviewed browser-source SHA-256 values exactly match the hosted-truth
  manifest; final `git diff --check` is clean.
- After the subscription/credit fail-closed tightening: focused UI 4/4 and
  core Node 417/417 pass; the held hosted build validates; the rebuilt public
  artifact contains the exact 78 allowlisted files; both reviewed browser
  source hashes match the manifest; `git diff --check` remains clean.
- Syntax and `git diff --check`: pass after each repair.

Sealed checkpoint gates:

- [x] Verify the named PostgreSQL test database is idle, drop it, and verify
  it is absent: 0 active sessions before drop, 0 matching databases after.
- [x] Obtain an actual isolated browser/mobile/accessibility pass for the
  current account panel using contract-valid fixtures.
- [x] Rerun the core/artifact checks invalidated by the final UI tightening.
- [x] Verify the recomputed hosted-truth hash after the final UI tightening.
- [x] Reconcile roadmap and continuity wording with final evidence.
- [x] Review the exact 25-file staged diff for scope, secrets, provider IDs,
  release holds, and whitespace. Secret-like additions are short explicit test
  fixtures; provider-like additions are descriptive test IDs. No real key,
  provider object ID, or release-opening change is present.

## Live resources and workers

- Runtime visual verifier Ramanujan,
  `019fcea8-d4a0-74c3-91e0-71f8eb088f56`, completed the corrected-fixture
  proof and was closed. Current evidence is under
  `/private/tmp/sitesourcery-alakazam-credit-verify.6NdTyI/`; the earlier
  evidence under `/private/tmp/sitesourcery-alakazam-verify.hSUfUh/` is
  superseded.
- Disposable PostgreSQL database
  `ss_alakazam_account_batch1_20260804_3` was idle, dropped, and verified
  absent after its passing test.
- No Batch 1 test process was running at the last process inspection.
- A pre-existing unrelated Python server remains on port 4173 for an older
  canonical-email artifact; do not mistake it for this browser harness.

## Next action

Create the one local Batch 1 commit, then verify its identity and a clean
worktree. The next clean batch is Lane E customer billing commands in parallel
with Lane F fulfillment and Lane G lifecycle projection; freeze their shared
contract before assigning disjoint writes.

## Batch 1 write scope

The sealed 25-file scope contains only the account projection/UI, held Stripe
configuration, integration tests, hosted-truth manifest, roadmap, truth audit,
billing contract, backend map, and continuity updates. The lead owns the local
integration commit. Generated artifacts, browser harnesses, screenshots,
credentials, and provider objects are not part of it.
