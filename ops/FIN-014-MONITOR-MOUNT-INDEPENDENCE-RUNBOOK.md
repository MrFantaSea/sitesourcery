# FIN-014 — origin monitor mount independence

State: engineering candidate only. This runbook does not authorize installation,
unit reload/restart, a manual monitor run, alert delivery, mount repair, backup,
provider access, deployment, or any customer/public effect.

## Why this correction exists

At 2026-08-26 16:42 EDT, the Zen storage host became unreachable and the Dell
SSHFS backup mount became stale. The mount service remained `active`, but reads
returned I/O errors. The five-minute monitor timer continued offering its
one-shot service, yet systemd skipped the 16:45, 16:50, 16:55, and 17:00 starts
because the base unit required the mount point and its marker before executing
the monitor. The latest actual run at 16:40 passed all six checks.

That behavior is fail-silent. Protected correction `abe26e0...` already moved
encrypted-artifact hashing to a bounded, strict-host-key direct SSH command on
the storage host. The monitor code also maps an inaccessible backup probe to
the fixed critical code `BACKUP_PROBE_UNAVAILABLE`. The obsolete systemd mount
conditions prevent that code and the existing reviewed alert state machine from
running precisely when the storage host is unavailable.

## Exact design boundary

The monitor unit must:

- remain ordered after `sitesourcery-production.service` when it is present but
  never `Require=` or `Want=` either monitored runtime or backup-mount unit;
- preserve `network-online.target`, the operations-state approval file, the
  `BACKUP_QUIESCE` exclusion, the shared nonblocking operations lock, its two-
  minute process bound, exact environment files, state write path, and all
  sandboxing/hardening directives;
- retain the existing `remote_ssh` backup-hash mode, strict known-host/key
  inputs, 30-second remote hash bound, and fixed-code failure handling; and
- remain a static one-shot offered only by the existing five-minute timer.

The backup service is different: it writes a new encrypted recovery point and
must continue to require the supervised SSHFS mount and exact destination
marker. FIN-014 changes no backup unit, timer, destination, retention, key,
artifact, or restore contract.

## Engineering and protected proof

Before any installation:

1. Verify the branch and changed-path allowlist from exact protected main.
2. Prove the monitor unit contains no backup-mount requirement, mount-point
   condition, or off-machine marker condition.
3. Prove the backup unit still requires the supervised mount and marker.
4. Prove the monitor environment still selects `remote_ssh` with the bounded
   hash timeout and contains no credential value.
5. Run the focused release-ops test, complete operations suite, complete pinned-
   Node quality ladder, and Linux `systemd-analyze verify` against the exact
   candidate unit.
6. Commit implementation separately from immutable FIN-014 evidence, obtain
   protected review, and run the held exact-main gates with deployment skipped.

No test may contact Zen, the production runtime, Resend, Twilio, Apple, Stripe,
or a customer. Injected fixtures must prove an unavailable backup becomes a
fixed critical monitor result without delivering an alert.

## Separate production-install gate

Installation is not authorized by an engineering/protected pass. Before asking
for approval, read back:

- exact protected source commit/tree and candidate unit SHA-256;
- exact installed unit bytes/hash and its active drop-in;
- active runtime/static/origin/tunnel state and zero application restarts;
- inactive backup and monitor one-shots, active timer, stale-mount/Zen state,
  and absence of a live backup-quiesce fence; and
- existing alert state without exposing its recipient or provider credential.

Present one exact proposal to the owner: install only the reviewed monitor unit,
run `systemctl --user daemon-reload`, and start the one-shot once. If Zen is
still unavailable, the expected effect is at most one real operations incident
email under the already reviewed idempotent alert state. A later healthy run may
send one recovery email. Neither transition authorizes provider, customer,
payment, DNS, publication, or application mutation.

Proceed only after exact approval for that installed-unit and possible-alert
effect. Preserve a byte-exact rollback copy before replacement; never edit the
active unit in place.

## Installation acceptance

After approval and exact installation:

- installed bytes and SHA-256 equal the protected candidate;
- `systemd-analyze verify` and `systemctl --user daemon-reload` are clean;
- application services are not restarted and keep their prior restart counts;
- one manual monitor run completes within the unit bound and reports six named
  checks, with backup either green or exactly `BACKUP_PROBE_UNAVAILABLE`;
- alert state reconciles at most one incident transition; no duplicate is sent;
- the next unattended timer offer executes rather than condition-skipping; and
- public `/api/v1/live` and `/api/v1/ready` still return the exact installed
  release identity.

If the one-shot hangs, exceeds its bound, reports a different failure, mutates
an unrelated unit/state, or produces ambiguous alert delivery, stop. Restore
the byte-exact prior unit, reload the user manager, keep the timer state exact,
and preserve the incident evidence for review. Do not retry an ambiguous alert.
