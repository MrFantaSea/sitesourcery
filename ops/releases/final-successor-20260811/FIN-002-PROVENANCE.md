# FIN-002 release-control provenance

State: proved  
Donor: `a81d1438fd57e62e44b917c803988301945ef2ef`  
Integration base: `b03cccbdc5252db3bd5f90084dbfa27beca33f52`

## Imported donor paths

- `.github/workflows/ci-release-proof-held.yml`
- `.github/workflows/containment.yml`
- `.github/workflows/pages.yml`
- `.github/workflows/public-truth-reconciliation-v3.yml`
- `WIRING-NOTES-CI-01.md`
- `ops/ci-release-proof-repository.mjs`
- `ops/ci-release-proof.mjs`
- `ops/test/ci-release-proof.test.mjs`
- `scripts/browser-audit-current.mjs`
- `scripts/test/abracadabra-billing-views-browser.test.mjs`
- `scripts/test/browser-release-gate.test.mjs`
- `scripts/test/public-truth-release-v3.test.mjs`
- `scripts/verify-public-truth-release-v3.mjs`
- `server/hosted/test/reviewed-browser-support.mjs`
- `package-lock.json`
- `ops/releases/public-truth-v2-retired-2026-08-11/README.md`
- `ops/releases/public-truth-v2-retired-2026-08-11/manifest.json`
- `ops/releases/public-truth-v2-retired-2026-08-11/scripts/test/public-truth-release-v2.test.mjs`
- `ops/releases/public-truth-v2-retired-2026-08-11/scripts/verify-public-truth-release-v2.mjs`
- `ops/releases/public-truth-v2-retired-2026-08-11/workflow/public-truth-reconciliation-v2.yml`
- `scripts/test/public-truth-v2-retirement.test.mjs`

`package.json` imports only the donor's V2-retirement script transition and the
`html-validate` 11.6.2 security upgrade. Donor scripts for later product
cohorts are deliberately not activated early.

## Retired active paths

The V2 workflow, verifier, and test moved byte-for-byte into the retirement
capsule above. Their original active paths are absent and their exact Git blob,
SHA-256, and byte count identities remain machine-verified. The spent
successor input
`ops/releases/ci-successor-inputs/89bedb8e1e6adbd9bc870298ab22521948ce354f.json`
left the one-time active input directory; its bytes remain recoverable from the
integration base and repository history.

## Deferred donor overlaps — still required

These were not rejected or removed from complete-product scope:

- migrations 118–124 and their repository contracts: FIN-003;
- mail, operator, domain, Care, Responder, Alakazam, and operations paths:
  FIN-004;
- non-union preserved lanes and outside overlays: FIN-005;
- root composition and every adjacent integration, including private
  messenger, command deck, phone bridge, Client Profile Hub, marketing desk,
  and Dell commercial engine: FIN-006;
- catalog/public/legal convergence: FIN-007;
- migration rehearsal, staging, production-held install, cutover, and rollback:
  FIN-008 through FIN-010.

The current public placeholder, Dell/HQ adjacent listeners, provider state,
DNS, running services, databases, and deployment topology were untouched.

## Scope inventory

- Migrations: none.
- Product routes: none added, removed, or promoted.
- Product capabilities: none activated.
- Workers and provider purposes: none changed.
- Release controls: hardened protected-control execution, Git-state rejection,
  anchored one-time successor input generation, exact artifact identity, safe
  artifact extraction, reviewed browser cleanup, and V2 authority retirement.

## Proof

- `npm ci --ignore-scripts`: passed under exact Node 24.18.0.
- `npm audit --audit-level=high`: zero vulnerabilities.
- `node --test ops/test/ci-release-proof.test.mjs`: 21/21 passed.
- `npm run test:public-truth:v2-retirement`: 29/29 passed.
- `npm run test:public-truth:v3`: 18/18 passed.
- reviewed Alakazam browser lifecycle suite: 5/5 passed.
- complete `npm test`: passed, including 666 application/data-plane tests,
  156 operations tests, deterministic Pages/hosted artifacts, and the current
  15-route by 3-viewport hosted browser audit.
- `git diff --check`: passed.

## Remaining blockers

FIN-003 through FIN-010 remain open. External provider/legal release blockers
remain exactly those in the owner decision ledger; this cohort creates no new
owner questionnaire and grants no effect authority.
