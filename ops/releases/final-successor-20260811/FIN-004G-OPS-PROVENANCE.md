# FIN-004G held operations provenance

State: proved
Donor: `a81d1438fd57e62e44b917c803988301945ef2ef`
Parent integration commit: `6b1cfbb`

## Imported donor allowlist

Backup and restore:

- `ops/SITESOURCERY-BACKUP-RESTORE-CURRENT-03-HELD.md`
- `ops/backup-restore-current.mjs`
- `ops/test/backup-restore-current.test.mjs`

Hosted epoch install:

- `ops/SITESOURCERY-HOSTED-EPOCH-INSTALL-HELD.md`
- `ops/hosted-epoch-install-dry-run-receipt.schema.json`
- `ops/hosted-epoch-install-runtime.mjs`
- `ops/hosted-epoch-install.mjs`
- `ops/test/hosted-epoch-install.test.mjs`

Hosted load SLO:

- `ops/SITESOURCERY-HOSTED-LOAD-SLO-HELD.md`
- `ops/hosted-load-slo-runtime.mjs`
- `ops/hosted-load-slo.mjs`
- `ops/test/hosted-load-slo.test.mjs`

Independent dead-man:

- `ops/SITESOURCERY-MONITOR-DEADMAN-02-HELD.md`
- `ops/independent-dead-man-alert.mjs`
- `ops/test/independent-dead-man-alert.test.mjs`

Public-edge current-release binding:

- `ops/SITESOURCERY-PUBLIC-EDGE-PREFLIGHT-05-HELD.md`
- `ops/public-edge-current-release-binding.mjs`
- `ops/test/public-edge-current-release-binding.test.mjs`

Rollback rehearsal:

- `ops/SITESOURCERY-ROLLBACK-REHEARSAL-04-HELD.md`
- `ops/rollback-rehearsal.mjs`
- `ops/test/rollback-rehearsal.test.mjs`

Reusable revenue proof and retired-Hive convergence:

- `ops/CORE-REVENUE-E2E-01-LOCAL-PROOF.md`
- `scripts/core-revenue-e2e.mjs`
- `scripts/test/core-revenue-e2e.test.mjs`
- `scripts/test/hive-planner.test.mjs`
- `package.json`

`package.json` adds the bounded `test:core-revenue-e2e` command and restores the
Responder planner proof to `test:node`. The planner implementation remains a
dormant, local-only module; `/hive/` stays a canonical redirect and the public
`/responder/` page stays inquiry-only and held.

## Deliberate donor exclusions

- `server/data-plane/tests/verify-empty-postgres-migrations.mjs`: the successor
  verifier contains cumulative proof repairs absent from the donor blob;
- `server/hosted/test/postgres-service.integration.test.mjs`: the successor
  journey contains FIN-004F convergence repairs absent from the donor blob;
- `server/hosted/test/readiness-snapshot.test.mjs`: the current successor keeps
  deterministic injected time for fixed not-ready/failure snapshots; the donor
  change reintroduced wall-clock dependence.

## Authority and effects

Every imported operations system is held, local, injected, receipt-bound, and
non-authorizing. No production install, rollback, DNS, tunnel, process,
database mutation, backup deletion, alert delivery, provider, customer,
payment, mail, publication, or deployment effect is available through this
cohort.

## Proof

- backup/restore, load SLO, dead-man, edge binding, rollback, core-revenue
  wrapper, Responder/Hive convergence, and clean-tree hosted epoch install:
  62/62 passed;
- the four hosted-epoch-install tests correctly refused to attest the dirty
  worktree with `Origin Git identity is dirty or drifted` before checkpoint,
  then passed against clean candidate commit `d6a9760`;
- complete `npm test`: passed, including 205/205 ops tests, deterministic
  90-file public and hosted artifacts, and the 15-route by 3-viewport browser
  audit;
- module syntax and `git diff --check`: passed.
