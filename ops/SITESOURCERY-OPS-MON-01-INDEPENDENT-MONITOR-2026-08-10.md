# Site Sourcery OPS-MON-01 independent monitor runbook — 2026-08-10

## Status and authority

This packet is a held candidate. It does not authorize installation, activation,
external probes, alerts, provider access, DNS changes, deployment, publication,
or customer or commercial effects. The committed environment files remain
`held`, and every systemd candidate has an activation-hold banner and marker
gate.

The production monitor and dead-man entrypoints accept only the exact root-owned
`sitesourcery.final-release-epoch/v2` file plus its externally anchored origin
seal and installed readback. Retained V1 release-epoch bytes remain valid
historical evidence, but these production entrypoints reject them. The selected
epoch supplies both the independent report identity and the complete expected
`sitesourcery.hosted-release-identity/v2`; no value in this runbook is a release
receipt.

The validated V2 release-epoch chain is the only release authority. The probe
configuration, including the complete expected hosted release identity, is
additionally bound into a separate, expiring read-only approval digest.
Changing an endpoint or any release identity field invalidates that approval.

## Architecture and failure boundaries

```text
public edge                         independent observer
  apex HTTPS  --------------------> apex status/canonical probe
  sealed privacy bytes -----------> exact bytes + digest probe
  TLS endpoint -------------------> chain/protocol/expiry probe
  tunnel liveness ---------------> exact hosted-release-identity/v2 probe
                                            |
                                            v
                               private atomic heartbeat file
                                            |
                                            v
                         separate observer / dead-man scheduler
```

The primary observer uses only public HTTPS/TLS and its private heartbeat
directory. It has no dependency on the Site Sourcery application process,
PostgreSQL, runtime environment, Caddy files, customer data, or backup mount.
The dead-man has no network address family and reads only the release epoch and
heartbeat. The legacy deep monitor remains a separate origin-side diagnostic
for database, filesystem, backup, backlog, and local certificate state; it is
not replaced or weakened by this packet.

The tunnel probe calls only `/api/v1/live`. It requires the exact liveness
schema and exact hosted release identity derived from the anchored V2 epoch. A
generic health response, a predecessor identity, an added or missing identity
field, or any binding/source/tree/migration drift fails closed. Dependency
readiness remains the separate `/api/v1/ready` observation required by the
origin cutover runbook; this independent liveness probe never represents or
amplifies database or provider readiness.

For host-loss detection, run the dead-man on a second failure domain and make
the primary heartbeat available there through a separately reviewed,
read-only evidence transport. This packet deliberately does not create that
transport or send an alert. On the same observer, the dead-man proves scheduler
or monitor-process lapse but cannot prove loss of the observer host itself.

## Exact telemetry contract

The monitor emits one `sitesourcery.independent-monitor-report/v1`, one
`sitesourcery.independent-monitor-heartbeat/v1`, and a heartbeat receipt digest.
The four checks are ordered exactly `apex`, `content`, `tls`, `tunnel`. Failure
output contains only a fixed code and severity. Success evidence is represented
only by a SHA-256 digest. The heartbeat carries release identity, observation
time, monotonic sequence, monitor result, and monitor telemetry digest.

The dead-man emits `sitesourcery.independent-dead-man-report/v1` with only the
release identity, observation time, fixed status code, heartbeat time and
sequence, and digests. It distinguishes invalid/missing heartbeat, stale
heartbeat, and release-identity drift. Neither contract contains request or
response bodies, URLs, hostnames, IP addresses, email addresses, customer
identifiers, provider identifiers, stack traces, or free-form errors.

## Offline candidate verification

Run these from the reviewed candidate checkout with the pinned Node runtime.
They use repository files and injected/local fixtures only:

```sh
git diff --check
/private/tmp/sitesourcery-node-24.18.0/node-v24.18.0-darwin-arm64/bin/node --test ops/test/independent-monitor.test.mjs
/private/tmp/sitesourcery-node-24.18.0/node-v24.18.0-darwin-arm64/bin/node --test ops/test/final-release-epoch-v2.test.mjs
```

Before an owner-authorized installation, separately verify the held unit files
on the target Linux system with its own `systemd-analyze verify`. Do not use the
Mac test host as evidence for Linux systemd loading.

## Owner-gated installation preparation

These are future operator steps, not authority to execute them now.

1. Put the sealed release beneath `/opt/sitesourcery-monitor/current` on an
   observer that is outside the origin and backup-mount failure domains. Install
   pinned Node 24.18.0 at `/opt/sitesourcery-monitor/node-24.18.0`.
2. Create dedicated `sitesourcery-monitor` ownership and private directories
   `/etc/sitesourcery-independent-monitor` and
   `/var/lib/sitesourcery-independent-monitor`, both mode `0700`. The state
   directory must be a real directory, not a symlink.
3. Copy `ops/independent-monitor.env.example` to
   `/etc/sitesourcery-independent-monitor/monitor.env`, mode `0600`. Keep
   `SITESOURCERY_INDEPENDENT_MONITOR_MODE=held` during review. Confirm the four
   endpoints and exact V2 epoch, origin seal, and installed-readback files. The
   tunnel endpoint must be the exact same-origin `/api/v1/live`; do not replace
   it with `/api/v1/health` or `/api/v1/ready`. Do not add provider credentials
   or an alert destination.
4. Compute `configurationSha256` by importing
   `independentMonitorConfiguration` locally with the reviewed environment and
   exact epoch. Create `monitor-approved.json` with only schema, a safe approval
   ID, state `approved_read_only`, the exact release and configuration digests,
   exact UTC approval/expiry instants no more than 31 days apart, and the digest
   returned by `independentMonitorApprovalDigest`. Review the canonical bytes
   and set mode `0600`.
5. Only after explicit owner approval, change monitor mode to
   `approved_read_only`, copy the `.held` service/timer to the corresponding
   systemd unit names, create the exact empty marker
   `/etc/sitesourcery-independent-monitor/MONITOR_APPROVED`, reload systemd,
   and enable the timer. A manual service run must emit four checks bound to the
   selected epoch before unattended scheduling is accepted. Confirm the
   liveness check fails when its injected response carries a predecessor or
   otherwise mismatched hosted release identity.
6. On the separately selected dead-man observer, install the sealed code and
   pinned Node under `/opt/sitesourcery-dead-man`, copy the held dead-man unit
   and environment, and arrange the separately approved read-only heartbeat
   evidence path. Only after explicit owner approval, change dead-man mode to
   `approved_read_only`, create
   `/etc/sitesourcery-dead-man/DEAD_MAN_APPROVED`, reload systemd, and enable its
   timer. The service must retain `RestrictAddressFamilies=AF_UNIX`.

No step grants alert delivery. A future alert adapter needs its own reviewed
fixed-code contract, destination authority, idempotency, delivery proof, and
owner gate.

## Observation and response

- Monitor exit `0`: all four exact probes passed and the atomic heartbeat was
  written.
- Monitor exit `1`: one or more fixed-code failures, configuration/approval
  failure, or heartbeat-write failure. Inspect the fixed codes and local service
  status; do not print bodies or environment files.
- Dead-man exit `0`: the heartbeat is current and release-bound.
- Dead-man exit `1`: missing/invalid/stale heartbeat or release drift. Check the
  independent monitor scheduler, then observer reachability, then compare the
  epoch binding. Do not diagnose it through the origin runtime or backup mount.

An unhealthy monitor must never trigger DNS, deployment, provider, payment, or
customer-state mutation. Escalation remains a human operation until a separate
alert packet is approved.

## Rollback (owner-gated; under five minutes)

On each observer, stop and disable only the two candidate timers and their
one-shot services, remove only their exact approval marker, restore the
environment mode to `held`, and reload systemd. Do not remove the heartbeat,
approval, logs, release tree, application runtime, database, Caddy, tunnel, or
backup mount. Confirm both timers are inactive and the application remains
untouched. Because the observers have no write port into the product or its
providers, rollback requires no application, database, DNS, tunnel, or backup
change.

Retain the last heartbeat and reports as private operational evidence. Rotate
to a new release by installing a new immutable tree and issuing a new approval
bound to its exact epoch and configuration; never edit the old evidence in
place.
