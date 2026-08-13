# FIN-004S Responder private-material retention provenance

Date: 2026-08-13
State: proved
Candidate branch: `integration/final-successor-20260811`

Implementation commit: `76e9343cb3ba8f50c70d8bc8523b6888dabe6a3a`

Proved implementation tree: `050f653145f805e6473f6314d03c2e67c89acd7a`

## Authority and boundaries

- Integration base: `b03cccbdc5252db3bd5f90084dbfa27beca33f52`.
- Preserved union donor: `a81d1438fd57e62e44b917c803988301945ef2ef`.
- Responder lifecycle, encrypted outbound/inbound material, callback, queue,
  and reconciliation authorities: FIN-004C and FIN-004K through FIN-004R.
- Owner retention decisions: active content remains while needed; cancelled
  project content has a 90-day project horizon; encrypted off-machine backups
  have a 30-day deletion horizon; destructive deletion retains explicit
  approval stops.
- The public placeholder, DNS, live providers, provider credentials, protected
  databases, HQ processes, deployed services, and cutover state were
  unchanged. No Twilio request, message, call, deployment, public mutation, or
  live-provider effect occurred.

## Implemented contract

Migration 130 adds one exact
`canonical-responder-private-material-retention-v1-held-leased-zeroing`
contract. Its three new ledgers are forced-RLS and service-role-only:

- operator-bound legal or bounded-retention holds containing only scoped IDs
  and evidence digests;
- bounded cleanup jobs with pending, claimed, succeeded, or explicit
  manual-review state; and
- immutable, digest-only destruction receipts that attest primary ciphertext
  zeroing and record the honest 30-day encrypted-backup horizon.

The database derives eligibility from already-durable lifecycle facts. It does
not select, return, hash, or decrypt nonce, authentication-tag, or ciphertext
columns. Eligibility covers completed retention, opt-out/revocation,
cancellation retention, account deletion, and resolved manual reconciliation.
It is re-evaluated under project and material advisory locks immediately before
destruction.

Discovery is globally bounded and inserts no duplicate material job. Claims
use `FOR UPDATE SKIP LOCKED`, exact worker ownership, 30-second through
10-minute leases, attempt/failure ceilings, expired-lease recovery, and durable
manual-review escalation at the ceiling. A failure releases only that worker's
claim with a bounded retry time.

Destruction runs in one organization-scoped serializable transaction. It
rechecks the database clock, lease, tenant, project, active legal or unexpired
retention holds, lifecycle reason, material state, and source envelope digest.
The transaction then invokes only the existing guarded one-way transitions:

- outbound material retains its key version and envelope digest but nulls
  nonce, authentication tag, and ciphertext; and
- inbound material nulls key version, nonce, authentication tag, ciphertext,
  and envelope digest.

The same transaction writes an immutable digest receipt and marks the cleanup
job succeeded. Exact repeats return the retained receipt and perform no second
mutation. The cleanup repository has no vault, material-open, decryption, or
provider port.

The `responder-retention` worker is a separately supervised canonical purpose.
It is held by default, single-flight, bounded, fail-closed, aggregate-log-only,
and independently requires `approved_live` plus the existing worker-process
owner approval before it can start. This cohort proves the worker and storage;
it does not grant that later activation authority.

## Backup and restore implication

Primary database ciphertext is cryptographically destroyed immediately when a
claim succeeds. An encrypted backup created before that transaction can still
contain the older bytes until its owner-approved 30-day deletion horizon. Each
receipt therefore binds `backupRetentionUntil = destroyedAt + 30 days` and
states that a restored backup must replay and prove the retained destruction
receipts before restored data can be served.

The clean-room restore and candidate-upgrade rehearsals remain ordered FIN-008
work. FIN-004S does not falsely claim that production backups were opened,
altered, or deleted.

## Changed paths

The implementation commit added:

- migration 130 and its migration-inventory entry;
- the PostgreSQL hold/discovery/claim/destruction repository;
- the held retention worker and worker-process composition;
- the canonical worker purpose, origin-seal entry, and held environment
  example; and
- structural, repository, worker, composition, and real-PostgreSQL tests.

## Adversarial review and corrections

The implementation was reviewed for ciphertext reads, decryption authority,
provider effects, tenant drift, hold races, stale leases, duplicate jobs,
unbounded retries, partial zeroing, replay drift, and misleading backup claims.

Real PostgreSQL proof exposed and corrected three defects before the checkpoint:

1. global service authority could not call `extensions.gen_random_uuid`, so
   the bounded repository now supplies prevalidated UUIDs;
2. the operator authority context used the wrong user field, so hold commands
   now bind the canonical `userId`; and
3. manual-review `CASE` expressions needed explicit `timestamptz` typing.

The attempt/failure ceiling was also hardened into a durable `manual_review`
terminal state. Final verdict: **PASS — no open FIN-004S implementation
defect**.

## Proof

Focused and expanded regression proof at the implementation tree:

- Responder, reconciliation, worker-process, worker-composition,
  migration-structure, and origin-seal matrix: 257 total, 253 passed, zero
  failed, four intentional environment-gated skips;
- syntax/diff checks: passed; and
- the implementation checkpoint was clean before the full test ladder.

PostgreSQL 16 proof used only the isolated Unix-socket cluster at
`/private/tmp/sitesourcery-fin004s.qCSKLK`:

- the caller-owned proof database was recreated empty;
- all 83 ordered canonical migrations through migration 130 applied;
- the complete migration/RLS/service/subsystem verifier passed;
- the FIN-004S journey passed 1/1;
- the journey proved operator legal-hold placement and replay, hold blocking,
  cross-tenant rejection, release replay, discovery/claim, wrong-worker lease
  rejection, outbound and inbound zeroing, receipt replay, a post-claim hold,
  bounded failure recovery, second-attempt completion, two exact receipts, no
  other-tenant mutation, and the 30-day backup horizon; and
- no protected or live database was contacted.

The complete clean-tree `npm test` ladder ran at implementation commit
`76e9343` / tree `050f653` and exited `0`:

- Node/hosted service matrix: 961 total, 948 passed, zero failed, 13
  intentional PostgreSQL skips;
- operations: 205/205 passed;
- Pages artifact: 90 allowlisted files rebuilt and verified;
- hosted artifact: rebuilt and HTML-validated; and
- browser audit: 15 routes at 320x720, 390x844, and 1440x1000.

## Remaining ordered work

- FIN-004T: mandatory worker closure and inbound follow-up.
- FIN-004U: authenticated operator reconciliation/resolution and customer
  surfaces, including typed visibility for retained manual-review work.
- FIN-004V: adjacent integration contracts, with no silent exclusion of HQ or
  Dell systems.
- FIN-005 through FIN-010: outside-union disposition, root composition,
  catalog/legal closure, migration/restore rehearsals, immutable staging,
  acceptance, held install, and explicit owner-gated cutover.
