# Site Sourcery WORKERS-01 held activation runbook

This is an installation candidate, not authorization to install, enable, start,
restart, deploy, connect to production, or lift a provider/commercial hold.
Every command below remains owner-gated.

## Sealed shape

- The API process owns listeners and admits at most the configured API pool
  budget. It starts no background loop.
- `bin/worker.mjs` owns the separate worker event loop and a pool capped to the
  PG-OPS `workerReservedConnections`. API plus worker process budgets equal the
  unchanged configured total.
- The exact purpose registry is `export`, `cancellation`,
  `alakazam-fulfillment`, and `alakazam-retained-lifecycle`. Unknown, duplicate,
  reordered, missing, or uncomposed purposes fail before any worker starts.
- All selected dependency readbacks complete before the first loop starts.
  SIGTERM/SIGINT stops loops in reverse order, awaits active leased work within
  the configured deadline, and closes the worker pool last.
- Existing claim leases, fence tokens, idempotency keys, effect certainty,
  publication holds, lifecycle evidence, and provider modes remain authoritative.

## Current activation blocker

Only `alakazam-fulfillment` and `alakazam-retained-lifecycle` have narrow
production composition in this packet. Export and cancellation processing are
methods on `createCanonicalPostgresService`, whose constructor also requires
identity and recovery-mail composition. Extracting those two narrow ports now
would overlap MAIL-COMPOSE-FINAL-03 and the explicitly excluded identity/mail
call sites. Therefore any owner-approved config containing `export` or
`cancellation` fails with `WORKER_PURPOSE_UNAVAILABLE` before any loop starts.
Do not activate this unit until that residual is resolved and separately
reviewed. There is no standalone publication loop: publication remains the
lease-fenced stage of Alakazam fulfillment, and synchronous customer release
commands retain their existing authority.

## Held installation plan

After a separately sealed union commit and owner approval:

1. Verify the installed release SHA, migration inventory, Legal tuple, ingress
   seal, and PG-OPS config through the release-epoch procedure.
2. Install `ops/sitesourcery-workers.service.held` as the reviewed unit and
   `ops/workers.env.example` as a root-owned `0600` starting template. Do not
   reuse `hosted.env`; worker composition intentionally has no identity or mail
   variables.
3. Keep `activation` equal to `held`, keep `WORKERS_HOLD` present, and keep
   `WORKERS_APPROVED` absent while validating unit paths and permissions.
4. Resolve and seal the export/cancellation narrow-port residual. Select only
   purposes whose exact provider and commercial approvals already exist.
5. Rehearse with injected/disposable dependencies. Prove all dependency
   readbacks occur before all starts, no duplicate API loop exists, API and
   worker connection maxima sum to the unchanged total, lease recovery works,
   ambiguous effects remain held, and SIGTERM drains within 20 seconds.
6. The owner may then change the exact config to `owner-approved`, remove only
   `/etc/sitesourcery/WORKERS_HOLD`, create only
   `/etc/sitesourcery/WORKERS_APPROVED`, and explicitly enable/start the unit.
   These are owner actions and are intentionally not executed by this packet.

## Readback

Accept only one `sitesourcery.worker.started` record whose purpose list equals
the owner-approved list, whose PostgreSQL readiness says `workload: worker`,
`workerScope: dedicated-process`, and whose process connection budget equals
the configured worker reserve. Logs may contain purpose, state, safe error code,
aggregate cycle results, and aggregate pool timing only—never SQL, parameters,
connection strings, provider identifiers, actors, tenants, customer content, or
credentials.

## Rollback

1. Stop the worker unit through the owner-approved service procedure and wait
   for its bounded graceful stop.
2. Recreate `/etc/sitesourcery/WORKERS_HOLD` and remove
   `/etc/sitesourcery/WORKERS_APPROVED`.
3. Restore the predecessor release and its exact held workers configuration.
4. Confirm no worker process remains and the API reports
   `backgroundWorkers: external_process_required`; do not re-enable the old API
   loops.
5. Retain every durable queued/leased/reconciliation row. Never delete or edit
   queue state as rollback. Expired leases and exact idempotency/fence rules own
   recovery.
