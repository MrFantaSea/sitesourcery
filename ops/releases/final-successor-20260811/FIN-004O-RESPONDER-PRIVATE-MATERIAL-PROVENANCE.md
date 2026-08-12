# FIN-004O Responder private delivery-material provenance

Date: 2026-08-12
State: proved
Candidate branch: `integration/final-successor-20260811`

Proved implementation commit:
`c95f9798a34405a926297dfcfd5a97965d79e2ed`

Proved tree: `ad8e0d5c78736c6ee8fed50d1e98250d918665a4`

## Authority and source

- Integration base: `b03cccbdc5252db3bd5f90084dbfa27beca33f52`.
- Preserved union donor: `a81d1438fd57e62e44b917c803988301945ef2ef`.
- Responder core, surfaces, worker, queue, process, and Twilio transport
  authorities: FIN-004C, FIN-004I, and FIN-004K through FIN-004N.
- No preserved branch or mapped local source contained an encrypted,
  operation-bound Responder delivery-material vault suitable for import.
- The separate dirty Dell commercial-engine repository contains a mock/raw
  delivery-event mechanism and explicitly lacks a live SMS adapter. It was
  inspected read-only and was not imported because its raw personal-data and
  retry contracts do not satisfy this release boundary.
- No adjacent HQ system was excluded or changed. The retained HQ phone bridge
  remains a separately mapped integration target, not a Twilio transport.
- The public placeholder, DNS, provider state, credentials, live database,
  and deployed services remained unchanged.

## Changed paths

- `server/data-plane/supabase/migrations/202608120126_responder_private_delivery_material.sql`
- `server/data-plane/supabase/MIGRATION-INVENTORY.md`
- `server/hosted/responder-private-material-vault.mjs`
- `server/hosted/responder-private-material-postgres.mjs`
- `server/hosted/responder-fulfillment-postgres.mjs`
- `server/hosted/worker-responder-composition.mjs`
- `ops/credential-topology-v1.mjs`
- `ops/credential-topology-v1.schema.json`
- `ops/workers.env.example`
- `ops/SITESOURCERY-WORKERS-01-HELD-RUNBOOK.md`
- focused migration, vault, resolver, queue, composition, topology, and
  integration tests
- this provenance record and `BUILD-LEDGER.md`

## Private-material contract

Migration 126 adds `ss.responder_private_delivery_materials`, with one
immutable active ciphertext snapshot for each operation. Every snapshot binds
the organization, project, interaction, contact, message, route digest,
content digest, key version, AES-GCM nonce, authentication tag, ciphertext,
and canonical envelope digest. Forced row-level security permits only the
exact system organization boundary. An active snapshot can transition only
to destroyed; destruction zeros every ciphertext-bearing column and records
the bounded reason and timestamp.

The hosted vault seals exactly `{to, body}` with AES-256-GCM and canonical,
operation-bound additional authenticated data. It accepts only a US E.164
route and bounded ASCII SMS body containing the required STOP notice. Runtime
configuration requires an exact 32-byte base64url current key and key version;
at most one paired prior key/version may exist for controlled rotation.
Readiness reports no secret, key version, phone number, or message content.

The PostgreSQL resolver stores material only for an exact held or queued,
pre-claim operation whose consent is active and interaction remains open. A
stable replay returns the existing exact envelope without producing another
ciphertext. Resolution is allowed only after an exact claim, provider
authorization, approved live evidence, disengaged global kill, active contact,
open interaction, and a verified active envelope. It returns only the narrow
transport schema.

The delivery queue now refuses to claim an operation without its exact active
material envelope. Held composition constructs neither the vault nor provider
and reads no related secrets. Enabled production composition constructs the
vault, PostgreSQL resolver, and Twilio transport together.

Credential topology expands from 21 to 26 bounded records, adding Responder
material rotation, current/prior material keys, a restricted Twilio production
API identity, and an independent Twilio webhook-signature secret. Current and
prior key evidence cannot be silently reused or collapsed.

## Focused, database, and cumulative proof

- Focused private-material migration, vault, resolver, queue, composition,
  and integration ladder: 34/34 passed.
- Credential-topology-inclusive focused ladder: 36/36 passed.
- Cumulative hosted-service ladder: 845 tests; 835 passed, zero failed, and 10
  intentional PostgreSQL skips.
- Cumulative operations pre-commit ladder: 201/205 passed; the four failures
  were the expected exact-clean-Git install checks while implementation was
  uncommitted. They passed after the clean implementation commit.
- Syntax checks and `git diff --check` passed.

PostgreSQL 16.14 was exercised only through disposable local databases. A
fresh database accepted all 79 ordered migrations through migration 126 and
passed the complete
13-case service journey, including the shipped browser/account/core-revenue
path. A second fresh run passed the corrected one-case Responder journey:
consent, encrypted snapshot, queue claim, fake-Twilio acceptance, STOP, and
global kill. The first database correctly returned idle when material was
absent, proving the new claim gate; a fresh database was then used instead of
deleting durable idempotency evidence. Both disposable databases were
dropped. No live database was touched.

The complete clean-tree `npm test` ladder ran at the exact implementation
commit and tree above and exited `0`:

- cumulative Node ladder: 863/863 passed;
- hosted-service ladder: 835 passed, zero failed, 10 intentional skips;
- operations ladder: 205/205 passed;
- Pages artifact: 90 explicitly reviewed files rebuilt and verified;
- hosted artifact: rebuilt and HTML-validated; and
- browser audit: 15 hosted routes at 320x720, 390x844, and 1440x1000.

No provider request, live SMS, public route, credential disclosure, live
database mutation, HQ mutation, network write, DNS change, or public-placeholder
change occurred.

## Remaining blockers

- Authenticated Twilio inbound/status callback ingress, durable provider-event
  reconciliation, and delivery/suppression projections.
- Production material creation through the verified inbound-event path; the
  exact storage API exists but is not yet reachable from an untrusted callback.
- Retention-driven ciphertext destruction and provider reconciliation workers.
- Owner-evidence-bound test and live provider activation.
- Separate full integration contracts for the retained HQ phone bridge and
  other adjacent systems.
- The other mandatory worker purposes and hosted Care/Responder UI closure.
- FIN-005 through FIN-010 outside-lane, integration, catalog, database,
  staging, acceptance, and owner-approved cutover work.
