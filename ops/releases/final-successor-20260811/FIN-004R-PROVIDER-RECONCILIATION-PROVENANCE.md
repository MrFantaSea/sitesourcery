# FIN-004R provider readback and reconciliation provenance

Date: 2026-08-13
State: proved
Candidate branch: `integration/final-successor-20260811`

Implementation commits:

- foundation: `9365a1d602d02d8e995b29e2b346dce89c17f7fa`;
- adversarial correction: `806d563de0dde78aec7646fe8ee9090cc9481374`.

Proved final tree: `a09a4f3f107b4bbfafc57efa31655bde8a0468d0`

## Authority and source

- Integration base: `b03cccbdc5252db3bd5f90084dbfa27beca33f52`.
- Preserved union donor: `a81d1438fd57e62e44b917c803988301945ef2ef`.
- Responder queue, private-material, transport, delivery-event, inbound, and
  operator-work-queue authorities: FIN-004F and FIN-004K through FIN-004Q.
- The cohort extends the general provider-reconciliation architecture. Its
  only automatic projection repair is the already-proved idempotent migration
  127 reconciler. Its operator surface is the existing FIN-004F work queue.
- The public placeholder, DNS, live provider state, provider credentials,
  protected databases, HQ processes, and deployed services were unchanged.
  No Twilio request, SMS/call, provider create retry, deployment, or public
  effect occurred.

## Implemented contract

Migration 129 adds the forced-RLS, global-system-only
`ss.provider_reconciliation_cases` ledger and the immutable
`ss.responder_inbound_resolutions` late-binding ledger. Reconciliation cases
are digest-idempotent, begin open, freeze their subject/evidence identity, and
accept one terminal readback record. Every non-self-healed closure requires a
named operator with `service_management_manage`; no anon/authenticated write
grant exists.

The case kinds are:

- `abandoned_claim`: exact operation attempt plus digest of the lease owner;
- `ambiguous_message_create`: terminal manual-review operation with an
  uncertain/malformed Twilio create result;
- `stale_delivery_status`: accepted operation plus provider-message digest;
- `unmatched_provider_event`: provider-message digest with no operation;
- `suppression_conflict`: accepted provider effect that landed after durable
  STOP, including the provider-message digest;
- `unbound_inbound_event`: quarantined inbound event awaiting operator action;
- `ambiguous_number_binding`: reserved typed case for a resolver-recorded
  cross-key ambiguity that cannot be inferred from durable keyed digests.

Abandoned cases are unique per operation attempt and lease-owner digest, not
merely per operation. Escalation re-locks the case, revalidates the same
attempt, lease owner, and still-expired lease, and then performs only the
migration-125 `claimed -> manual_review` transition. A renewed, reclaimed, or
changed claim fails closed. No claim is retried or accepted by reconciliation.

Suppression-conflict evidence is inserted in the same serializable transaction
that observes the provider acceptance. Replays must carry byte-identical
evidence; a different provider SID/receipt for the same operation conflicts
instead of being silently folded.

The operator queue gains one allowlisted source, one typed item kind, and one
refresh branch. Suppression conflicts are critical; abandoned claims and
ambiguous creates are high severity. No generic repair command or provider
authority is attached.

## Actual readback behavior

`twilio-responder-readback.mjs` is a read-only port. It issues only bounded
`GET /2010-04-01/Accounts/{account}/Messages.json` requests with API-key Basic
authentication. It validates the exact Twilio origin, account-bound path,
same-origin pagination paths, Account SID, Messaging Service SID, row shape,
page size, page count, target count, response-byte ceiling, and local
`date_created` window. A streaming response is stopped once the byte ceiling
is crossed; an incomplete pagination scan is never recorded as `not_found`.

Raw SIDs, recipients, and message bodies are used only inside the readback
module and are not returned, logged, or stored. Results contain digests,
status, counts, and evidence digests only:

- a stored SID digest produces `matched` only for that exact digest;
- an uncertain create is compared with its already-authorized route and
  content digests and produces `single_candidate`, never a fabricated exact
  match;
- two or more matching messages produce `multiple_matches` and stay for
  operator review;
- a fully exhausted scan can produce `not_found`;
- a page-capped or out-of-retention scan stays retryable/incomplete and does
  not consume the durable readback slot.

Readback evidence never changes an operation to accepted, never binds a
provider message automatically, never lifts a hold, and never retries a
Message create. It remains evidence for the later typed operator resolution
surface.

The `provider-reconciliation` worker is independently held by default. When
enabled it runs single-flight with bounded cycles, candidates, pages, response
bytes, backoff, and graceful shutdown. Each cycle detects cases, applies only
the proved delivery-event projection self-heal, revalidates/escalates expired
claims, obtains bounded readback candidates, calls the read-only port, and
records exact terminal evidence. Readback unavailability remains retryable.
Logs and monitoring contain allowlisted codes, counts, and timestamps only.

## Changed paths

The foundation commit added migration 129, the PostgreSQL reconciliation
repository, reconciliation worker and worker-process composition, Twilio
readback port, focused tests, and a real-PostgreSQL journey. It also added the
worker purpose to the canonical order/origin seal, reconciliation monitoring,
and the atomic suppression-conflict contract in Responder fulfillment.

The correction commit changed:

- `server/data-plane/supabase/migrations/202608120129_provider_reconciliation.sql`;
- `server/hosted/provider-reconciliation-postgres.mjs`;
- `server/hosted/provider-reconciliation-worker.mjs`;
- `server/hosted/twilio-responder-readback.mjs`;
- `server/hosted/worker-reconciliation-composition.mjs`;
- `server/hosted/responder-fulfillment-postgres.mjs`;
- `ops/workers.env.example`; and
- the corresponding structural, fake-port, repository, worker, composition,
  fulfillment-regression, and real-PostgreSQL tests.

## Adversarial takeover finding and correction

The inherited foundation passed its tests but did not satisfy FIN-004R: the
worker only called `readback.readiness()` and never called `findMessages()` or
`recordReadback()`. It also had no case for uncertain Message creates, could
permanently consume the readback slot with an `unavailable` state, treated a
bounded non-exhausted scan like a negative result, did not revalidate lease
expiry at escalation, and only checked response size after fully buffering it.

Those were treated as blocking implementation defects. Commit `806d563`
corrects them and adds positive/negative tests for worker-to-readback evidence,
uncertain creates, single/multiple candidates, incomplete scans, hostile
pagination, byte ceilings, attempt/lease identity, and conflicting suppression
evidence.

Adversarial verdict by area:

1. no blind provider retry or fabricated acceptance: **HELD after correction**;
2. atomic suppression-conflict evidence and conflicting replay rejection:
   **HELD**;
3. expired-claim escalation legality and renewed-lease rejection: **HELD after
   correction**;
4. migration 129 constraints, RLS, grants, queue branch, and digest identity:
   **HELD**;
5. raw-material confinement and bounded transport: **HELD after correction**;
6. worker/origin composition, independent holds, telemetry, and shutdown:
   **HELD after correction**;
7. preservation of prior Responder contracts: **HELD**.

Final review verdict: **PASS — no open FIN-004R implementation defect**.

## Proof

Focused and regression proof at the corrected source:

- reconciliation, readback, repository, worker, composition, fulfillment,
  worker-process, origin-seal, and monitoring suites: 107/107 passed;
- expanded focused reconciliation/fulfillment subset: 45/45 passed;
- syntax checks and `git diff --check`: passed.

PostgreSQL 16.14 proof used only a private Unix-socket disposable cluster:

- all 82 ordered migrations through migration 129 applied to a fresh database;
- canonical migration/RLS/service/subsystem verification passed;
- the corrected FIN-004R journey passed 1/1 on the fresh epoch;
- the journey proved uncertain-create detection, digest-shape readback,
  durable `single_candidate` evidence, abandoned-attempt escalation,
  suppression-conflict replay, unmatched/unbound detection, idempotent second
  detection, and operator-queue projection;
- no raw number or body appeared in a reconciliation row;
- the proof database was dropped, the exact disposable PostgreSQL process was
  stopped, and its exact `/private/tmp/.../scratchpad/pg-r` cluster directory
  was removed. No protected/live database was touched.

The complete clean-tree `npm test` ladder ran at commit `806d563` / tree
`a09a4f3` and exited `0`:

- Node: 863/863 passed;
- hosted service: 945 total, 933 passed, zero failed, 12 intentional
  PostgreSQL skips;
- operations: 205/205 passed;
- Pages artifact: 90 allowlisted files rebuilt and verified;
- hosted artifact: rebuilt and HTML-validated;
- browser audit: 15 routes at 320x720, 390x844, and 1440x1000.

## Remaining ordered work

- FIN-004S: private-material retention and cryptographic destruction.
- FIN-004T: mandatory worker closure and inbound follow-up.
- FIN-004U: authenticated operator reconciliation/resolution and customer
  surfaces. Migration authority exists, but typed operator resolution
  repository/service/HTTP/UI commands are not falsely claimed by FIN-004R.
- FIN-004V through FIN-010 as ordered, including held provider activation,
  staging, acceptance, and cutover gates.
