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

## Outbound status and remaining proof

Outbound operations alerts remain exactly held. Dell's private monitor
environment reports `SITESOURCERY_ALERT_MODE=held`, no alert state file exists,
and no alert message was attempted or sent during installation.

The approved identity plan is:

- `help@sitesourcery.com` for future customer-facing support;
- `alerts@sitesourcery.com` as the fixed operations sender;
- `sitesourcery@proton.me` as the private owner operations inbox;
- the owner's personal mailbox only as a recovery fallback.

The private Proton inbox has not yet been confirmed, so no recipient is present
in Git or the installed monitor environment. After it exists, the remaining
bounded proof is to install one expiring mode-`0600` alert approval, verify the
existing Resend sending domain without exposing its key, send one clearly
labeled incident and one recovery to that inbox, confirm the phone notification,
and then switch the existing timer from held to reviewed Resend delivery.

`help@sitesourcery.com` is only a reserved customer-support identity here.
Inbound receiving or forwarding for it is not configured or claimed.

The current encrypted backup was produced at `2026-08-02T01:49:13Z`. No
automatic production backup schedule is claimed by this monitor installation;
the freshness check will correctly turn red after its reviewed 26-hour maximum
unless a new quiesced backup is made. Scheduling that quiesced backup is the
next separate continuity task after the alert path is proven.
