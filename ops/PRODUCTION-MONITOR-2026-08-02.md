# Production-rehearsal monitoring — 2026-08-02

This records the exact held-alert monitor installed on Dell after the encrypted
backup and clean-room restore proof. It does not authorize or claim public
routing, payment, domain purchase, publication, DNS change, inbound support
mail, or outbound operations mail.

## Exact releases and gate

- Alert implementation: `1994d7a66bfa6b3e91f32dd637733f2d6911b4be`.
- Latest-backup selection and attempt-time binding:
  `d5311424830436ba5b9bd5f499f907ad908690d9`.
- Installed-unit source and final evidence checkpoint:
  `2c6340187a73477bb299e949799b6a2d4e6cdd61`.
- Runtime: exact Node `24.18.0`.

The final full release gate passed at the evidence checkpoint: 264 current Node
tests, 19 self-host tests, 108 hosted-service passes plus two expected
PostgreSQL-environment skips, 38 operations tests, exact public and hosted
artifacts, and all 15 hosted routes at 320, 390, and 1440 pixel widths.

The alert tests prove one delivery for a new incident, one delivery when its
alert set changes, duplicate suppression, a six-hour reminder, one recovery,
and reuse of the same provider idempotency identity after an ambiguous failed
response. Transport tests allow only bounded operational codes, summaries,
severity, and observation time into the message body. They reject domain,
tracking, adapter, destination, and envelope drift.

## Reboot-safe off-machine mount

The prior SSHFS mount was healthy but had been started manually. Dell now runs
enabled user unit `sitesourcery-production-backup-mount.service`. It pins the
existing owner-controlled key and known-hosts file, requires strict host-key
checking, runs SSHFS 3.7.3 in the foreground, and verifies both a real mount
point and the exact off-machine destination marker before becoming active.

The final mount is read/write because the separately reviewed backup service
must create new immutable attempts. It is private to the Dell service user and
uses `default_permissions`, `noexec`, `nodev`, and `nosuid`. The service UMask
is `0077`; an SSHFS umask presentation override is deliberately absent so the
real remote evidence modes remain visible as `0440` and ciphertext as `0400`.

The enabled, active mount reports source
`zen:/home/zentech/.local/state/sitesourcery-backups` and type `fuse.sshfs`.
The exact installed and committed unit SHA-256 is
`f0532f43ea622fef4d83255612da3dd9dc89def3efeca227354d0b12c4c359f1`.

## Installed held-alert monitor

Dell now has enabled timer `sitesourcery-production-monitor.timer`. It offers
static one-shot unit `sitesourcery-production-monitor.service` every five
minutes and persists across reboot. The service runs exact monitor release
`d5311424830436ba5b9bd5f499f907ad908690d9` with a two-minute bound.

The exact installed and committed hashes are:

- Monitor service:
  `93c149213fcc8bb05afa4d581b1d619f82acb1ee793fed8b4b36b6b4eece0293`.
- Monitor timer:
  `183b5b7e6617c820c461743ca373d70962772e7061ddee85dede600df10d5fe2`.

The first final manual run observed at `2026-08-02T10:20:47.054Z` passed all
six checks: loopback runtime and approved operations state, PostgreSQL runtime
contracts and domain hold, newest encrypted backup integrity and age, disk
reserve, exact certificate hold, and cancellation/export backlogs. It completed
in 34 seconds.

The timer then invoked the service without operator intervention. Its report
observed at `2026-08-02T10:22:01.793Z` again passed all six checks and completed
from `06:22:01` through `06:22:34` EDT with exit status zero. The next
five-minute invocation was scheduled normally.

## Failed candidates retained as engineering evidence

The first mount candidate failed closed instead of pretending the backup was
mounted. Controlled comparison established that SSHFS address-family filtering
blocked its setup before the ordinary SSH data connection. Filesystem namespace
directives were also left out because this service's purpose is to publish a
mount to the user manager rather than keep it private. The immediate marker
check was replaced with a bounded one-second settle, a real mount-point check,
and then the destination-marker check. The final unit retains an exact
unprivileged command, host, key, destination, marker, and restrictive mount
options.

The first monitor run at `2026-08-02T10:12:13.102Z` also failed closed with
`BACKUP_PROBE_UNAVAILABLE`. The backup on Zen was intact: direct Zen metadata
showed evidence mode `0440` and ciphertext mode `0400`. The SSHFS
`umask=077` option had rewritten those modes only in Dell's mounted view to
`0700`, correctly tripping the immutable-file check. Removing that presentation
override restored exact remote modes.

The initial direct probe took 68 seconds because it fully rehashed every
historical successful attempt. Backup attempt IDs are now checked against their
immutable start time, allowing the monitor to choose the lexically newest
success and then fully verify that one attempt. A dedicated test proves a
corrupt older attempt is not confused with the current recovery point and a
corrupt newest attempt still fails closed. The final real monitor completed in
33–34 seconds.

## Reviewed outbound alert activation and proof

The initial monitor installation above correctly kept outbound alerts held.
After the owner confirmed the private Site Sourcery Proton inbox, reviewed
delivery was activated without changing publication, DNS, payments, registrar,
domain-runtime, registration-mail, or recovery-mail authority.

The exact alert release is
`62e0b9ba70301ce7e79bf8e55e2a78e626fa13c9`. Its complete pinned-Node release
gate passed: 264 current Node tests, 19 self-host tests, 108 hosted-service
passes plus two expected PostgreSQL-environment skips, 52 operations tests,
exact public and hosted artifacts, and all 15 hosted routes at 320, 390, and
1440 pixel widths. Dell then passed the six focused Linux alert tests from the
same exact release. The installed monitor unit SHA-256 is
`0579360758461030d1684988ed237306696d35f5e4eed8360ce55199aae31cf5`.

The private monitor environment and approval file are mode `0600`. The
approval binds adapter `resend-sitesourcery-operations-v1` only to destination
reference `owner-sitesourcery-proton-v1`; it began at
`2026-08-02T11:15:40.000Z` and expires at
`2027-08-02T11:15:40.000Z`. Renewal is required before that expiry. The Resend
readiness check from Dell proved the exact `sitesourcery.com` domain, enabled
sending, verified SPF and DKIM, and disabled click and open tracking without
printing the provider key or recipient.

The proof command has a separate explicit approval switch and private state
file, and rejects the real monitor state path. It does not alter a runtime
probe or manufacture a production outage. It sent exactly these transitions:

- Test incident observed at `2026-08-02T11:20:50.568Z`, subject
  `[TEST WARNING] Site Sourcery alert delivery`; Resend reported `delivered`.
- Test recovery observed at `2026-08-02T11:21:09.291Z`, subject
  `[TEST RECOVERED] Site Sourcery alert delivery`; Resend reported `delivered`.

Both message bodies state `TEST ONLY` and that production remained healthy.
The isolated proof state finished healthy, with no alert codes or pending
transition, and mode `0600`. Provider delivery is proven; the separate visual
confirmation that Proton displayed the phone notifications remains an
owner-device observation.

The real monitor then observed at `2026-08-02T11:21:38.988Z` and passed all six
checks. It attempted no delivery because the system was healthy. Its real
persistent incident-state file remains absent, so the test transitions cannot
be mistaken for a production incident. The five-minute timer is enabled and
active on the reviewed Resend path.

The first unattended invocation on that final configuration observed at
`2026-08-02T11:26:45.548Z`, again passed all six checks, attempted no message,
and exited successfully at `07:27:19` EDT. The timer then scheduled its next
ordinary run for `07:31:59` EDT. Real incident state remained absent.

This activation did not publish the replacement site. GitHub `main` remains
`9cdb1e73b2c9d3a7c0b07befd7ea5a24754795cf`; the latest Pages build remains
the July 22 predecessor at `eff8195640db58390d03eefbe863248220994e37`; and
the apex still resolves only to GitHub Pages. The alert release was pushed only
to `build/sitesourcery-v2-20260730`, whose workflow cannot deploy Pages.

The approved identity boundaries are unchanged:

- `help@sitesourcery.com` is reserved for future customer-facing support;
- `alerts@sitesourcery.com` is the fixed operations sender;
- the confirmed Site Sourcery Proton inbox is the private owner destination;
- the owner's personal mailbox is only a recovery fallback.

Inbound receiving or forwarding for `help@sitesourcery.com` is not configured
or claimed. The separately tested supervised backup cycle and enabled daily
timer remain recorded in `ops/PRODUCTION-BACKUP-CADENCE-2026-08-02.md`.
