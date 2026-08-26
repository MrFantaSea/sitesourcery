# FIN-014 origin-monitor production provenance

Recorded: 2026-08-26T19:05:17-0400 EDT

State: exact reviewed observer unit installed; real Zen/backup outage visible;
one incident delivered; unattended duplicate suppression proved.

## Protected authority

FIN-014 implementation `6bee262b8c90503b92513b6b46f97c6fd53e5260`,
tree `4e8b233c55270615cb938b84ee8ac27460831dc5`, and evidence head
`77301e8005dd4ccca4615af9995f754c96f97d9b`, tree
`2a02737d977b596e25b16bf1bd3f7aa773184550`, passed PR #50 native Site
Quality run `33020608061`, job `98349795513`, in 3m45s. Because GitHub delayed
creating the native PR run, the same exact head independently passed
supplemental read-only run `33020464142`, job `98349332875`, in 4m10s.

PR #50 squash-merged as protected main
`fa4a155fd1c1309bce7b4a532dccc80c90a3e6ab`, tree
`2a02737d977b596e25b16bf1bd3f7aa773184550`, with sole parent
`39035f71d24ba36894783de90384a08dc302f006`. Exact-main Site Quality run
`33020848625`, job `98350573402`, passed in 4m12s. Controlled Pages run
`33020848630` passed validation and authority checks; Configure, package,
upload, and the deployment job were all skipped. Local main, GitHub main, and
the Dell Git mirror were exact before installation.

The owner approved the disclosed bounded production action: install only the
reviewed monitor unit, reload the user manager, run one manual one-shot, and
permit at most one incident email plus one later recovery email. That approval
was not treated as authority for unknown spend, account creation, or provider
objects.

## Byte-exact installation and rollback

The candidate reached Dell staging with SHA-256
`c2f75c12658c897b526c061694a54708b102c8f59d30ad6523bb1e5c1f9fd5ea`.
Before replacement, the prior base unit and unchanged active `abe26e0` drop-in
were copied to
`/home/simtech/sitesourcery-production/rollback/fin014-monitor-preinstall-20260826T185545-0400`.
Their SHA-256 values are respectively
`5e59485c46f2be0650d128f8c3582ba53c460c17aac0c8a3d7db2c224cb2e30f`
and
`7f872f919b75743e3b6a0c578dcd16944a080d729a04e6a7866a26356e542821`.
Rollback retirement is not authorized.

The installed base unit now exactly matches the protected candidate at
`c2f75c12...`. The active drop-in remains byte-exact at `7f872f91...`, still
selects strict-host-key `remote_ssh` backup verification with a 30-second
bound, and exposes no credential value. `systemctl --user daemon-reload`
completed cleanly. Effective unit readback contains only the approval-file and
backup-quiesce conditions, has no lifecycle requirement on runtime or backup
mount, keeps network ordering and the two-minute unit bound, and preserved all
hardening.

## Real incident and unattended proof

Zen remained tailnet-offline and the stale SSHFS process still reported active.
Before installation, 25 timer offers after the last green 16:40 run had been
condition-skipped. Alert state was healthy with no pending transition or alert
code.

The exact one authorized manual run observed at
`2026-08-26T22:58:53.868Z` executed rather than skipping. Backlog,
certificate, database, disk, and runtime passed. Backup returned the sole fixed
critical code `BACKUP_PROBE_UNAVAILABLE` and bounded summary “The latest
immutable backup could not be verified.” The reviewed alert port attempted and
confirmed one Resend incident delivery. Its provider receipt is deliberately
not copied into repository evidence. Durable alert state became `alerting`,
contains one backup code, has no pending transition, and hashes to
`cf72333c71109b3f63f5774ba256632e8f983b6e5020dc76493522626239a1e5`.

The monitor exits status 1 whenever a critical check is non-green, so systemd
correctly exposes the one-shot as failed. This is visible alarm state, not an
ambiguous install or mail result. It does not restart or stop the application.

Without resetting that failed state, the existing timer started the observer
again at 19:04:05 EDT. It produced the same exact six-check result, attempted no
delivery, and returned fixed `DUPLICATE_ALERT_SUPPRESSED`. Zero post-install
timer offers condition-skipped. The timer remains active/waiting for its next
cycle.

## Runtime and effect boundary

Runtime, static, origin, and Cloudflare services remain active with zero
application restarts. The database tunnel remains active at its unchanged
restart count; the worker remains intentionally held inactive. Public live and
ready remain exact installed candidate `420bd8a...`, tree `b118539...`, epoch
`fin012-installed-truth-420bd8a-20260825`, with 98 migrations, matrix v2, 20
capabilities, six processes, and `externalEffects=false`.

The exact reviewed effects are one base-unit replacement, one user-manager
reload, one manual monitor execution, one unattended execution, and one
operations incident email. There was no duplicate or recovery email, backup
write, mount repair, other provider read/mutation, customer or production-
database mutation, application restart, deployment, public or DNS mutation,
payment, or spend.

Machine receipt
`ops/releases/fin014-monitor-mount-independence/production-receipt.json` has
SHA-256
`055f00273b141ea34b3fbf7e2d025b56d410f253f7be81020c77885eedee7e7d`.

Zen recovery remains external to this unit correction. A later healthy timer
run may send the one already disclosed recovery email. Twilio free-account
creation, Apple organization enrollment/fee, and real elapsed seven-/30-day
gates remain separate and unchanged.
