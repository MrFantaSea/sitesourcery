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
- The exact process-purpose registry is `export`, `cancellation`,
  `notification-mail`, `alakazam-fulfillment`,
  `alakazam-retained-lifecycle`, `responder-fulfillment`,
  `provider-reconciliation`, `responder-retention`, `project-lifecycle`,
  `domain-lifecycle`, and `care-lifecycle`. Unknown, duplicate, reordered,
  missing, or uncomposed purposes fail before any worker starts.
- All selected dependency readbacks complete before the first loop starts.
  SIGTERM/SIGINT stops loops in reverse order, awaits active leased work within
  the configured deadline, and closes the worker pool last.
- Existing claim leases, fence tokens, idempotency keys, effect certainty,
  publication holds, lifecycle evidence, and provider modes remain authoritative.

## Current held activation gates

WORKERS-02 resolves the former export/cancellation constructor residual after
MAIL-COMPOSE-FINAL-03. The external process now receives only exact readiness
and processing ports for those purposes and imports no identity or mail
composition. MAIL-HOSTED-WIRING-03 adds only the bounded notification mail
purpose to that process; the API still owns no worker loop. MAIL-PRIVATE-
RENDERER-04 supplies the standalone reviewed renderer source, 29-version
support/commerce/Care template registry, and private PostgreSQL recipient
resolver. The mail purpose remains held unless its exact module and registry
digests, private operator recipient, canonical recipient authority, and verified
Resend configuration all read back ready. Care delivery remains reservation-
only until its separately reviewed claim source exists. This is not activation
authority.
Export remains held unless its exact export mode is enabled,
cancellation remains held unless the complete reviewed Stripe adapter reads
back `approved_live`, and every selected purpose must pass PostgreSQL and
purpose-specific readiness before any loop starts.
Responder fulfillment additionally remains held until its durable queue and a
separately reviewed Twilio adapter plus private material resolver both read
back ready. Twilio Programmable Messaging does not provide a create-message
idempotency fence: a missing exact acceptance receipt therefore goes to manual
reconciliation and is never blindly retried. The HQ phone bridge remains the
separate read-only Pixel/operator surface. The held composition has no latent
provider port.
The hosted API owns the separate held-by-default Twilio status-callback
boundary. It verifies the exact production URL and every received form field
with Twilio's maintained validator, stores only digests, and reconciles
out-of-order status evidence against the worker's digest-only provider mapping.
The worker never receives the webhook Account Auth Token, and the API never
receives the worker's restricted message-send API secret through this config.
The hosted API also owns the held-by-default Twilio inbound SMS and Voice
ingress. Inbound tenant resolution uses keyed, versioned lookup digests over
operator-provisioned number bindings; raw callers and bodies exist only as
AES-256-GCM inbound material sealed in the API process, and unknown, retired,
or mismatched numbers land as digest-only unbound evidence with no tenant. A
durable inbound STOP opts the contact out, cancels queued, waiting, and even
claimed deliveries for that contact, and the worker's material resolver
re-validates the claim, its own unexpired lease, and active consent
immediately before any provider call; Twilio's Advanced Opt-Out blocklist
(error 21610) is the provider-side backstop behind that local fence. The
Voice dialing is separately held. Verified mode resolves an encrypted target
bound to the exact active provider-number record and emits the fixed private
`<Dial action>` only after signed, durable arrival evidence. The signed result
is the sole authority for answered versus missed. A missed result creates one
lease-fenced follow-up job: active consent produces encrypted delivery material
inside the existing Responder fulfillment purpose, while missing or revoked
consent stops at manual review without opening caller material.
Ordinary publication remains the lease-fenced stage of Alakazam fulfillment,
and synchronous customer release commands retain their existing authority.
Terminal project deletion now uses the separate `project-lifecycle` purpose:
retention expiry stops for explicit deletion approval, then a sealed purge
orders unpublication, private-object deletion, and database finalization.
`domain-lifecycle` is readback/reconciliation-only behind a digest-reviewed
adapter. `care-lifecycle` closes and opens exact monthly periods, carrying only
unused included units from the immediately prior period. All three purposes
remain independently held here.

Independent monitoring and dead-man timers intentionally remain outside this
worker process so a worker-process failure cannot disable its own detector.
Their held units, timers, readiness, alert delivery, and recovery proof are the
W10 implementation; they must never be collapsed into this failure domain.

## Held installation plan

After a separately sealed union commit and owner approval:

1. Verify the installed release SHA, migration inventory, Legal tuple, ingress
   seal, and PG-OPS config through the release-epoch procedure.
2. Install `ops/sitesourcery-workers.service.held` as the reviewed unit and
   `ops/workers.env.example` as a root-owned `0600` starting template. Do not
   reuse `hosted.env`; worker composition receives only the dedicated held mail
   and private-renderer modes until the reviewed renderer is installed as one
   root-owned regular file and its exact module/registry digests are configured.
3. Keep `activation` equal to `held`, keep `WORKERS_HOLD` present, and keep
   `WORKERS_APPROVED` absent while validating unit paths and permissions.
4. Select only purposes whose exact provider, commercial, storage, and policy
   approvals already exist. Keep export and Stripe modes held otherwise.
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
