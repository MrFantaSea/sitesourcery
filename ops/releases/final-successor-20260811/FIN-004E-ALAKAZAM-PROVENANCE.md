# FIN-004E Alakazam provenance

State: proved invoice-finalization leaf; central Stripe/webhook composition remains open  
Donor: `a81d1438fd57e62e44b917c803988301945ef2ef`  
Parent integration commit: `167c575`

## Imported donor scope

- Alakazam account service and tests;
- invoice-finalization service and tests;
- PostgreSQL invoice-finalization repository;
- Alakazam PostgreSQL account/fulfillment repository integration;
- real PostgreSQL finalization integration test;
- bounded account/cancellation repository test updates.

The oversized `server/hosted/alakazam-postgres.mjs` exceeded the tool-output
ceiling during the first mechanical import. That corrupted temporary worktree
copy was replaced directly from the exact donor Git object; its blob hash was
verified before testing. All final imported paths are byte-exact donor blobs.

## Capability state

- verified subscription invoice-finalization signals only;
- authoritative provider readback before durable state;
- failure holds renewal, tier change, and fulfillment without exposing provider
  identity to the customer;
- replay returns exact durable results without another provider read;
- later authoritative paid state recovers only the matching hold;
- fulfillment claims skip open failed-finalization holds;
- provider/configuration remains held unless separately composed and approved.

## Proof

- focused account/finalization/repository/cancellation tests: 40 passed, with
  the real PostgreSQL test intentionally selected separately rather than skipped;
- isolated PostgreSQL 16 received all 77 migration files;
- real finalization integration passed failure hold, replay, recovery, tenant
  isolation, and cleanup;
- exact caller-owned database was dropped;
- PostgreSQL was stopped, port 55448 closed, and its explicit temp directory
  removed;
- complete `npm test`: passed, including deterministic artifacts and the
  15-route by 3-viewport browser audit;
- `git diff --check`: passed.

## Deferred — still required

Central hosted construction, Stripe production configuration, webhook routing,
worker fulfillment composition, invoice/final payment/refund/reconciliation
release gates, and final commercial catalog convergence remain required. No
live Stripe, billing, fulfillment, mail, publication, or customer effect
occurred.
