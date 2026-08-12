# FIN-004C Responder provenance

State: proved core and repository; communications/provider mounting remains open  
Donor: `a81d1438fd57e62e44b917c803988301945ef2ef`  
Parent integration commit: `b2f988b`

## Imported donor paths

- `server/hosted/responder-core.mjs`
- `server/hosted/responder-core-postgres.mjs`
- `server/hosted/test/responder-core.test.mjs`
- `server/hosted/test/responder-core-postgres.integration.test.mjs`

All four paths are byte-exact donor blobs.

## Capability state

- provider-neutral consent authority and digest-only contacts;
- deterministic STOP/opt-out classification without accepting message content;
- global kill, human handoff, replay, contact authority, interactions, provider
  events, message commands, and control commands;
- tenant-scoped customer/operator projections;
- raw contact, message content, recordings, credential fields, live-provider
  expansion, delivery claims, and provider effects rejected by default;
- no communications provider, billing, HTTP, worker, phone bridge, or external
  effect mounted in this cohort.

## Proof

- provider-neutral Responder unit tests: 5/5 passed;
- isolated PostgreSQL 16 received all 77 migration files through migration 124;
- the normally skipped real integration ran and passed consent, replay, STOP,
  kill, handoff, and scoped projection persistence;
- the exact caller-owned database was dropped;
- isolated PostgreSQL was stopped, port 55446 closed, and its explicit temp
  directory removed;
- complete `npm test`: passed, including deterministic artifacts and the
  15-route by 3-viewport browser audit;
- `git diff --check`: passed.

## Deferred — still required

Responder HTTP/customer/operator surfaces, worker fulfillment, consent-channel
composition, communications provider, billing, monitoring, opt-out delivery,
and phone-bridge integration remain required. Live effects require the later
purpose-specific provider/legal/owner evidence gate. This cohort grants none.
