# FIN-014 origin-monitor mount-independence provenance

Recorded: 2026-08-26T18:33:38-0400 EDT

## Finding and bounded correction

Protected-main input is
`39035f71d24ba36894783de90384a08dc302f006`, tree
`a78922f214f87fc52a1db55993ea7f174b4128ab`. At 16:42 EDT the Zen storage
host became unreachable and Dell's SSHFS backup mount became stale: the mount
unit continued reporting active while reads returned I/O errors. The monitor's
last actual 16:40 run passed all six checks. From 16:45 through the 18:30
readback, the active five-minute timer offered 21 later runs, but the installed
base unit condition-skipped every one because the off-machine marker was no
longer readable.

That is a fail-silent observer defect. Protected correction `abe26e0...` had
already moved immutable-backup verification to a strict-host-key, bounded
direct SSH read and mapped an unavailable storage host to fixed critical code
`BACKUP_PROBE_UNAVAILABLE`. The remaining systemd mount conditions prevented
that code and the reviewed idempotent alert state machine from executing when
they were needed.

Implementation `6bee262b8c90503b92513b6b46f97c6fd53e5260`, tree
`4e8b233c55270615cb938b84ee8ac27460831dc5`, changes four paths. The monitor
keeps ordering after the production runtime but has no `Requires=` lifecycle
coupling to it, no dependency on the backup mount, and no mount-point or marker
condition. It preserves network ordering, the operations approval, backup-
quiesce exclusion, shared nonblocking lock, two-minute unit bound, exact
environment files, state path, and hardening directives. The separately
supervised backup writer keeps its mount and marker requirements unchanged.

Candidate unit SHA-256 is
`c2f75c12658c897b526c061694a54708b102c8f59d30ad6523bb1e5c1f9fd5ea`.

## Exact local proof

- Focused release-ops and monitor proof passed 38/38.
- Clean-Git operations proof passed 253/253. The preceding dirty-tree run
  passed 249 and failed only the four deliberate immutable-Git identity gates.
- The complete pinned Node 24.18.0 `npm test` ladder passed, including 892/892
  product/client tests, site checks, deterministic Pages and hosted artifacts,
  and the 24-route by six-width browser audit. A sandboxed attempt first denied
  six local test-server listeners; the authoritative local-loopback-enabled run
  completed with exit zero.
- Dell Linux `systemd-analyze verify` passed the exact candidate with its
  dependency units, exit zero and no diagnostic output.
- An injected unavailable backup produces a non-green report with exact code
  `BACKUP_PROBE_UNAVAILABLE` while the test alert port stays held: no attempt,
  no delivery, and fixed hold code `OUTBOUND_ALERTS_HELD`.

Machine receipt
`ops/releases/fin014-monitor-mount-independence/implementation-receipt.json`
has SHA-256
`02a4da9600844e88f7f682f3068ac1946d83ef4a94715af88dfca5146ec0688a`.

## Production readback and effect boundary

Production remains on exact installed candidate
`420bd8a424da3331514723d40b5be9fb5131dfe3`, tree
`b118539b060254c663cb55325a8ec4a12d8ed24c`, epoch
`fin012-installed-truth-420bd8a-20260825`, with 98 migrations. Direct Dell and
public canonical liveness/readiness readback are green with capability matrix
v2, 20 capability rows, six process rows, and `externalEffects=false`. Runtime,
static, origin, and tunnel application services remain active with zero
application restarts; the worker remains intentionally held inactive.

The installed base monitor unit SHA-256 is
`5e59485c46f2be0650d128f8c3582ba53c460c17aac0c8a3d7db2c224cb2e30f`;
its active release drop-in SHA-256 is
`7f872f919b75743e3b6a0c578dcd16944a080d729a04e6a7866a26356e542821`.
Those bytes have not changed. No unit was installed or reloaded, no monitor was
manually started, and no alert, email, backup, provider read/mutation, customer,
database, application restart, deployment, public, DNS, or spend effect
occurred.

This local evidence is not production-install authority. Protected review and
exact-main held gates come first. A later exact owner approval must cover only
installation of the reviewed monitor unit, user-manager reload, and one manual
one-shot. If Zen remains unavailable, that run may send at most one real
operations incident email through the already reviewed idempotent state; a
later healthy timer run may send one recovery email. Neither transition grants
any other provider or product authority.

Twilio free-account creation and Apple organization enrollment remain separate
owner gates. FIN-014 changes neither boundary and authorizes neither spend nor
account mutation.
