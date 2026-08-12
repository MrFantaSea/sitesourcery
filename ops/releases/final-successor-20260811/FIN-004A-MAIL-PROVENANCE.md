# FIN-004A mail and worker provenance

State: proved leaf composition; central HTTP/operator mounting remains open  
Donor: `a81d1438fd57e62e44b917c803988301945ef2ef`  
Parent integration commit: `7fe5590`

## Imported donor paths

- `WIRING-NOTES-MAIL-DELIVERY-E2E-FIXTURE-05-2026-08-11.md`
- `WIRING-NOTES-MAIL-EVENTS-01-2026-08-11.md`
- `WIRING-NOTES-MAIL-HOSTED-WIRING-03-2026-08-11.md`
- `WIRING-NOTES-MAIL-PRIVATE-RENDERER-04-2026-08-11.md`
- `WIRING-NOTES-MAIL-ROUTE-DISPATCH-02-2026-08-11.md`
- `ops/SITESOURCERY-WORKERS-01-HELD-RUNBOOK.md`
- `ops/notification-mail-private-renderer.mjs`
- `ops/origin-seal-runtime.mjs`
- `ops/workers.env.example`
- `scripts/mail-delivery-e2e-fixture.mjs`
- `scripts/mail-delivery-e2e.mjs`
- `scripts/test/mail-delivery-e2e.test.mjs`
- `server/hosted/bin/worker.mjs`
- `server/hosted/mail-route-dispatch-composition.mjs`
- `server/hosted/notification-mail-dispatch-postgres.mjs`
- `server/hosted/notification-mail-dispatcher.mjs`
- `server/hosted/notification-mail-private-resolver.mjs`
- `server/hosted/notification-mail-worker-composition.mjs`
- `server/hosted/notification-mail-worker.mjs`
- `server/hosted/resend-mail-events-config.mjs`
- `server/hosted/resend-mail-events-http.mjs`
- `server/hosted/resend-mail-events.mjs`
- `server/hosted/resend-mail-transport.mjs`
- `server/hosted/worker-config.mjs`
- the matching mail, Resend-event, private-renderer, worker-composition, and
  worker-process tests under `server/hosted/test/`.

`package.json` received only the mail E2E test/proof commands from the donor.

## Repaired database verifier contract

The valid `verifyNotificationMailDispatchClaims` body was extracted from the
otherwise broken donor verifier, its literal leading patch marker was removed,
and it was wired into the clean verifier with its exact proof output. This
restores the migration-118 expired-lease reclaim and closure evidence expected
by the mail E2E fixture without importing the donor's unrelated broken domain
code.

## Capability state

- Support and commerce mail reservations: composed through one digest-only,
  lease/fence-bound dispatch source.
- Private recipient/template resolution: reviewed standalone renderer with a
  pinned 29-version support, commerce, and Care template registry.
- Provider adapter: production Resend transport supports exact notification
  idempotency and payload evidence in addition to registration/recovery.
- Provider event ingress: signed raw-body verification, durable replay,
  suppression, bounce, complaint, and out-of-order handling are implemented.
- Worker: `notification-mail` is a recognized isolated worker purpose and is
  wired only into the worker process.
- Default/effect state: held. No credential, real recipient, live provider call,
  API mount, service activation, or external mail occurred.

## Proof

- focused mail/worker tests: 90/90 passed;
- complete operations suite: 156/156 passed;
- isolated PostgreSQL 16 mail E2E: passed with two fake-provider calls,
  migration-118 recovery reuse, four signed event kinds, duplicate acceptance,
  out-of-order conflict, safe operator projection, and `providerEffects:false`;
- local backup and clean restore matched exact mail identity;
- proof reported both databases absent and its temporary backup absent;
- isolated PostgreSQL was stopped, port 55444 closed, and its explicit temp
  directory removed;
- complete `npm test`: passed, including deterministic artifacts and the
  15-route by 3-viewport browser audit;
- `git diff --check`: passed.

## Deferred — still required

Central hosted HTTP mounting, production Resend-event environment composition,
operator/support UI and queues, and remaining mail purpose reservations are
part of later FIN-004 cohorts. Live delivery still requires evidence-bound
Resend credentials/domain readiness and the owner purpose gate from the owner
decision ledger.
