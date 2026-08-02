# Production-rehearsal backup cadence — 2026-08-02

## Result

Dell now runs one supervised encrypted off-machine Site Sourcery backup each
day at `04:17` local time. The timer is enabled and persistent, the backup
destination remains the supervised Zen SSHFS mount, and a separate enabled
recovery service handles both user-manager interruption and plaintext staging
left by a host power loss.

One controlled live cycle completed successfully before the timer was enabled.
It stopped only the loopback production-rehearsal writer, produced and verified
a new immutable encrypted attempt on Zen, removed the writer fence and recovery
state, left local plaintext staging empty, and restarted the runtime. The
independent monitor then passed all six checks against the new recovery point.

This checkpoint does not authorize or claim public routing, Caddy activation,
DNS change, payment, registrar effects, publication, outbound alert mail, or
inbound customer-support mail.

## Exact releases and gate

- Backup-cycle implementation:
  `70d270fd8ffb242fe80db265d61a74dd4bbdfad2`.
- Reviewed unit package:
  `9768011189b2296d6f6c5efa5161a8e076f4cda8`.
- Hosted runtime and backed-up release remain:
  `15cab8f4d220f9a5116b89c732daa6dc9fb19a17`.
- Exact Node runtime: `24.18.0`.

The full release gate passed before deployment: 264 current Node tests, 19
self-host tests, 108 hosted-service passes plus two expected
PostgreSQL-environment skips, 48 operations tests, exact public and hosted
artifacts, and all 15 hosted routes at 320, 390, and 1440 pixel widths.

The backup-cycle tests cover successful recovery, backup failure, forced
termination, power-loss plaintext cleanup, a failed runtime restart followed by
a safe retry, setup failure, fence tampering, exact user-manager commands,
environment-boundary drift, orphan fences, and overlong fence lifetimes. Dell's
native systemd 255 accepted the exact candidate service and timer files without
warnings before installation.

The deployed cycle files match the tested release exactly:

- `ops/backup-cycle.mjs` SHA-256:
  `7e9bbc14fac2ad11c97a04e43d1d77d6a93ff0a602df2cae19c1765a12561205`.
- `ops/run-production-rehearsal-backup-cycle.mjs` SHA-256:
  `637edc5ffc12479a6b8ad028e45dc0a6542176cea8ba621f2d2f0be9e4cdb1bb`.
- Unchanged package lock SHA-256:
  `634c12c47642a67aa6a1031ce26115f004b94004df71d7b509a53cdef1050010`.

## Supervised cycle contract

`sitesourcery-production-backup.service` now owns the whole cycle. It acquires
an exclusive operations lock, requires the real off-machine mount and marker,
and then runs the exact implementation release. The implementation:

1. requires the production-rehearsal runtime to be active;
2. creates mode-`0600` recovery state before a mode-`0600`, 25-minute writer
   fence;
3. stops `sitesourcery-production.service` through the exact user manager;
4. independently proves the runtime is inactive, PostgreSQL has zero hosted
   writers, the fence is unchanged, and the app-state tree is stable;
5. writes only age-encrypted artifacts and immutable evidence to Zen;
6. removes any dedicated plaintext staging, removes the fence, restarts the
   runtime, proves it active, and only then removes recovery state.

The service has a 30-minute start bound. Its independent `ExecStopPost`
recovery action reacquires the same lock after timeout or forced termination.
The monitor checks the negative fence condition and uses the same lock; a race
therefore either lets an already-running monitor finish before quiesce or skips
one monitor invocation cleanly while the cycle owns the maintenance window.

Enabled `sitesourcery-production-backup-recovery.service` runs after the
runtime during user-manager startup. Valid stranded state can safely remove its
matching fence and restart the runtime. If volatile `/run` state was erased by
a host reboot, the recovery action still removes only owner-controlled
`sitesourcery-backup-*` directories from the exact dedicated staging root. It
does not remove unrelated names.

The exact installed unit SHA-256 values are:

- Backup service:
  `8d8b318a55cd4f8322c2b3b4599c6b5bffee25a30042062ca4c02099c9a08d3f`.
- Backup timer:
  `591de0aa9ccbffb4118a7fc69e45bde36000be0007d27d88d30a46559c6dea4e`.
- Boot recovery service:
  `4d490779bacbcecd43a67ce0a1b017ce759e32fe4a4efcbf1a280a2056bfeef4`.
- Lock-aware monitor service:
  `e53eb16a947b094ab68c3127c9c885440217682b776bc1ae2a13adc4f3c9cf02`.

## Controlled live cycle

Before the cycle, the runtime was active as PID `515282`, the fence directory
and staging root were empty, the newest successful attempt was the original
`2026-08-02T014913439Z-0444653b-6b41-4465-b003-d819b9366c23`, and the backup
timer was disabled.

The supervised service ran from `06:53:35` through `06:54:36` EDT with result
`success` and exit status zero. It produced:

- Snapshot ID: `41c868be-7297-4c8e-9d34-829c7ac8f824`.
- Attempt ID:
  `2026-08-02T105335651Z-a6e13d6e-1e75-4018-93be-b77de2e34533`.
- Completed: `2026-08-02T10:54:35.332Z`.
- Successful manifest SHA-256:
  `4c8a37b2b890a01595df94eecdcfd8cda5f6ea7c22404ee14488d4da88dac3d5`.
- Artifact count: two.

The successful manifest is mode `0440`; `postgresql.age` and `app_state.age`
are each mode `0400` through Dell's mounted view. After recovery, the runtime
was active as new PID `531810`, the backup unit was inactive with result
`success`, both lifecycle files were absent, and the staging root was empty.
The loopback API health and readiness routes both returned `200`; the static
artifact root also returned `200`.

The independent post-cycle monitor observed at
`2026-08-02T10:55:01.140Z`. Runtime, PostgreSQL, newest-backup integrity and
age, disk reserve, certificate hold, and cancellation/export backlogs all
passed. It emitted no alerts and attempted no delivery because outbound alerts
remain held.

## Enabled schedule

The persistent timer was initialized to the completed manual proof at
`2026-08-02 06:54:36 EDT` before first activation. This prevented systemd from
mistaking the already-covered `04:17` event for a missed event and immediately
performing a redundant second backup. The timer is now enabled and active; its
next elapse is `Monday 2026-08-03 04:17:00 EDT`.

All six relevant long-running units/timers are active: database tunnel,
loopback runtime, static artifact service, off-machine mount, monitor timer, and
backup timer. The mount, monitor timer, backup timer, and boot recovery service
are enabled. Dell's user has lingering enabled, so these units do not depend on
this Mac remaining open.

The first calendar-triggered invocation is still future evidence and is not
claimed here. Its result will be visible in the backup-service journal, the
next immutable attempt, and the following monitor report. Retention remains a
separate reviewed task; enabling deletion was not part of this cadence change.
