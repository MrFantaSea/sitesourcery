# FIN-012 production control

Status: prepared and held. This directory grants no live authority and records no provider, payment, DNS, publication, or customer effect.

## Exact release pair

- Candidate: `14ca61bd0991c0d326699311e380c29c621931df`, tree `b953a3fbfd5853b29f3e72f0f05c7f75e04eba4d`.
- Held-proof control: `0cd27a13b2e6ad74829c8700c6bc0dec577f3a73`, tree `1f9a0945c86111100b8eac9b4e6bb422909f443d`.
- Rollback predecessor: `e8862278eb66e87d3536b4e084dc9647c996d993`, tree `ac53f6a59feb9ab7b6e05cb8e03d9c8bcc810eb2`.
- Exact held CI run: `32592799297`, attempt `1`, final receipt digest `1c73c2bc46c4f69c6da606307abf1489fe12b80058d9a9488c40b7e4dd5ff89b`.

## Verified live baseline

Read-only capture on 2026-08-22 found PostgreSQL 16, database `sitesourcery_production`, 287 application tables (`ss=286`, `auth=1`), schema SHA-256 `de7a4d476899db85d0d4bf2e93c9f54210f39bc77c416586a8b960cf0e5a397a`, exact ownership, and all retained held-data invariants. The public API and static services, origin gateway, Cloudflare connector, backup timer, and monitor timer remain active on the e886 predecessor.

The exact candidate rehearsal converges to 294 tables (`ss=293`, `auth=1`) and schema SHA-256 `c6531a8817870b1dbbe4b488948e8513a3a07fd64b6076597a102316ca68d3e3` by applying only `202608220143_download_protection_v1.sql`, SHA-256 `c1fec8ada5d393b1e7cecef03e7b6de674f75d64251e91ef8c2ff325e75b3d5c`.

## Production architecture preserved

FIN-012 uses the accepted Dell user-unit architecture under `/home/simtech/sitesourcery-production`. It does not apply the unused generic `/opt/sitesourcery` install plan. It replaces only the API/tenant and static unit bytes at cutover. The origin gateway, Cloudflare connector, backup machinery, monitor machinery, Node 24.18.0 toolchain, database tunnel, state roots, and existing approved registration/recovery mail lane remain in place.

The predecessor environment is copied without printing, rotating, or digesting its secrets. Only the three root-owned release-evidence paths and hashes and the two candidate mail-module paths are rebound. Stripe, Twilio, Resend webhook handling, Domains, publication, and workers remain held. No Stripe secret or Twilio secret is admitted into the candidate hosted environment.

## Ordered live gate

1. Verify protected main, the exact candidate and held receipt, current live readback, service health, free disk, and the retained e886 runtime/environment/evidence/unit pair.
2. Install the candidate and generated candidate-specific bundle in parallel without selecting it. Read back root ownership, modes, exact Git identity, artifact/evidence hashes, held provider modes, and unchanged active unit bytes.
3. Obtain one exact owner authorization for the production database migration and public runtime/static cutover. This authorization does not enable Stripe, Twilio, Domains, DNS changes, publication, workers, or predecessor retirement.
4. Pause the monitor and backup timers; stop the Cloudflare connector, origin, static runtime, and API/tenant runtime; prove zero other production-database connections.
5. Run a fresh encrypted backup to `zen-sitesourcery-backup-01`; require the immutable manifest and ciphertext hashes, no retained plaintext, a clean recovery proof, and a ready rollback pair no older than one hour.
6. Create a 30-minute FIN-012 upgrade control from the stopped-system row-count fingerprint and the fresh backup receipt. Apply exactly migration 143 under the advisory lock. Require the 294-table fingerprint, preservation of all 287 predecessor relations, all held invariants, the exact Download-protection contract, one gate row, seven forced-RLS tables, and seven protection triggers.
7. Install the candidate active evidence, candidate environment and wrapper, and candidate API/static unit bytes. Reload the user manager. Start API/tenant and static, then origin and Cloudflare. Require local liveness/readiness, exact final-release evidence, public-edge identity, legal and route truth, browser acceptance, and no payment/provider effect.
8. Resume backup and monitor timers. Retain e886, its environment, its evidence, its units, and the paired backup through stabilization. Retirement remains a later explicit gate.

Any failure before the database migration leaves e886 selected. Any failure after the database migration stops the candidate and requires the paired database restore before e886 restart; code-only rollback against the successor schema is forbidden.

## Cost boundary

Preparing and installing this code path requires no new purchase. Payment activation remains separate and held. Before any paid provider action, the owner must receive the exact amount, vendor, purpose, recurrence, and refund/cancellation consequence and approve that specific spend.
