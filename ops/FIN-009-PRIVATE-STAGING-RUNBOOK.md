# FIN-009 immutable private staging runbook

## Scope and authority

This runbook installs and verifies one exact held candidate only inside the
existing `sitesourcery-fin009` network namespace and staging root on the Dell.
It grants no public deployment, Git push, DNS, Cloudflare, Pages, provider,
customer, payment, mail, telephony, protected-HQ, production-database, or
cutover authority.

The owner gate is explicit: a successful private acceptance leaves
`ownerAccepted=false` and `pushAuthorized=false`. Stop and ask the owner for the
green light before pushing the branch or making any public/provider change.

## Frozen release

- candidate commit: `26b07202d91000b9a7ae0de36471c7979f9482a1`
- candidate tree: `00f648e39931a3e62445bc6c1d441087c69a8136`
- control commit: `804b9a57922f14eed673fe5a1b66a8f42afad4ce`
- control tree: `7be00a5a9ab783a30d834470380dcd0ef84ac8ee`
- successor input: `ops/releases/ci-successor-inputs/26b07202d91000b9a7ae0de36471c7979f9482a1.json`
- successor input file SHA-256:
  `d37b42762426cb1f67bb4bc9bbb84f90ba96f25af19cdb55b33ccd0cbfdebcd3`
- successor input digest:
  `39def1060e5690b059df8448f67e9072d91a510db7e3ca4ff2f1db50196897f8`
- epoch: `fin009-26b0720-20260820`

The candidate corrects a defect found by exact live readback: the default
Pages and hosted builders retained sealed Legal V5 data but did not emit V5 as
the current and immutable default artifact, so the immutable V5 privacy URL
returned 404. The fix integrates the sealed V5 plan into both default builders,
retains V2/V3/V4 immutable versions, emits V5 current/versioned bytes, and adds
regression coverage. No runtime, migration, provider, or customer behavior was
expanded.

## Isolated installation boundary

- staging root: `/home/simtech/sitesourcery-fin009`
- release root:
  `/home/simtech/sitesourcery-fin009/releases/26b07202d91000b9a7ae0de36471c7979f9482a1`
- namespace: `sitesourcery-fin009`
- private HTTPS: `10.203.9.2:8443`
- hosted API: `127.0.0.1:8788` inside the namespace
- tenant runtime: `127.0.0.1:8080` inside the namespace
- private static artifact: `127.0.0.1:8899` inside the namespace
- PostgreSQL: Unix socket only at
  `/home/simtech/sitesourcery-fin009/run/postgresql`, port 55449, database
  `ss_fin009_staging_78fb538`

The network namespace, PostgreSQL, API, static, and private TLS origin units
must be active. The external-effects worker must remain inactive and disabled.
The public production process at predecessor commit
`84aca6b757a806b428ae0cce8115c12dcc6486cd` must remain untouched.

Before replacing staging configuration, copy the exact prior environment,
epoch, seal, readback, wrapper, and three staging units to
`state/predecessor-3925-before-26b`. Do not copy or disclose secret values into
committed evidence. The installed service must revalidate the exact epoch,
origin seal, and installed readback before it starts.

## Mandatory proof order

1. Verify the exact clean candidate/control worktrees and successor-input
   digests.
2. Run the full held CI release proof with pinned Node 24.18.0 and PostgreSQL
   16. The disposable verifier database must be absent afterward.
3. Rebuild and byte-verify the 99-file Pages artifact and 118-file hosted
   artifact. Verify the immutable and current Legal V5 pages at the private TLS
   endpoint.
4. Install the exact archive into the isolated release root, run `npm ci`, and
   collect a fresh manifest from installed bytes. Never infer installation from
   a local source tree.
5. Switch only the exact staging wrapper, three staging units, and the three
   anchored evidence files. Keep the worker held and leave public production
   untouched.
6. Prove exact `/api/v1/live` and `/api/v1/ready` release identity, held
   capability matrix, seven-route UI/legal journey, CSRF/cross-origin denial,
   held recovery, and unauthenticated operator denial.
7. Run a conservative private sample of 400 requests at concurrency 20 and the
   standalone local load/SLO contract. Neither is production SLO authority.
8. Run four real private monitor probes: apex, byte-exact immutable privacy
   content, trusted TLS, and exact `/api/v1/live` identity. Prove a current
   heartbeat passes and a heartbeat beyond the configured maximum age fails
   with `DEAD_MAN_HEARTBEAT_STALE`. Do not enable provider alert delivery.
9. Re-read database schema, ownership, row counts, RLS, lifecycle holds, and
   recovery provider receipts. Restart the API and prove exact readiness on a
   new staging PID.
10. Verify the retained encrypted Zen database backup and prior clean-room
    restore remain applicable to the unchanged database snapshot; verify no
    plaintext is retained.
11. Byte-read the immutable rollback artifact, re-read the public placeholder,
    and prove the production predecessor PID/release did not change.
12. Commit only this runbook, the receipt, provenance, and ledger. Re-run clean
    operations/evidence checks, update the external continuity checkpoint, and
    stop at the owner green-light gate.

## Acceptance and rollback

Private acceptance requires every receipt fact to be true while all external
effects remain false. If any staging check fails, restore only the exact files
from `state/predecessor-3925-before-26b`, daemon-reload, and restart only the
`sitesourcery-fin009` API/static units. Do not mutate the protected production
runtime, its database, public traffic, or provider configuration.

The retained production rollback artifact is commit
`84aca6b757a806b428ae0cce8115c12dcc6486cd`, tree
`bd7859348a54b633173d386e0eadc8acc4c8ad54`, artifact manifest
`b28ff784a9205096094a53a0fdbcedc5a20878b2b640e545cacd43ff61fd4359`.
Rollback always pairs compatible runtime and data. Old writable commerce code
must never be paired with successor commercial data.
