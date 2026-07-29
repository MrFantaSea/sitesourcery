# Held production candidate

These files describe the smallest production shape that can run Site Sourcery
without Vercel, Supabase hosting, or Cloudflare:

- one reviewed Node 24.18.0 release starts the loopback hosted API on `8788` and
  the customer-site runtime on `8080`;
- one dedicated Caddy instance serves the exact `_hosted` artifact for the
  control host, sends only `/api` to `8788`, and sends verified customer domains
  to `8080`;
- PostgreSQL is the durable authority;
- private exports and tenant release bytes live below
  `/var/lib/sitesourcery`;
- systemd owns process restart and a one-minute loopback probe.

GitHub remains the source and CI authority. GitHub Pages can continue serving
the inquiry-only held site, but it cannot proxy the hosted same-origin API.
Moving the customer application to this Caddy candidate is therefore a separate
DNS and release operation. Nothing here requires Cloudflare or gives a CDN
custody of customer data.

Every file remains a `.held` candidate. Copying a template, creating an approval
file, changing DNS, loading Caddy, enabling a unit, or removing a hold is an
owner-authorized operations step, not a build step.

## Recommended zero-new-subscription topology

| Machine | Held production responsibility |
| --- | --- |
| Dell | Caddy plus the hosted API and tenant runtime; it retains the local app-state authority and loopback runtime probes. |
| HQ | PostgreSQL system of record; only the reviewed application and least-privilege operations identities may connect. |
| Zen | Encrypted off-machine backup destination, clean-room restore host, and independent recovery/monitoring authority. |

This mapping reuses the three existing machines and adds no hosting
subscription. It is only deployable if Dell has reviewed public ingress and
either a stable public IP or an owner-approved dynamic-address update path.
Public DNS, ports, firewall policy, and TLS activation remain separate owner
decisions. Nothing in this repository enables a service, opens a port, changes
DNS, or starts Caddy.

Zen must be a distinct failure domain from both Dell and HQ. The current
runtime/certificate/data probes remain Dell-local because they use loopback and
local files; Zen can independently verify the encrypted backup ledger,
clean-room restores, and HQ database state. A direct Zen-to-Dell availability
probe requires a separately reviewed private authenticated path and must not be
implemented by exposing Dell's loopback ports.

## Routing contract

`Caddyfile.candidate.held` has two non-overlapping routes:

1. `SITESOURCERY_CONTROL_HOST` serves the reviewed hosted artifact. `/api` and
   `/api/*` are proxied to the hosted API. No customer hostname can select this
   route.
2. The HTTPS catch-all proxies only to the tenant runtime. On-demand certificate
   issuance calls the loopback `ask` endpoint, which approves only an exact
   active custom-host binding.

The control-host block must appear first and must never proxy to `8080`.
The tenant block must never serve `_hosted` or expose either
`/_sitesourcery` or `/_sitesourcery/*`.
Platform-subdomain TLS is still a separate certificate decision; the catch-all
does not claim to solve it.

The held validator is pinned to the official
`caddy_2.11.4_linux_amd64.tar.gz` archive with SHA-512
`8220d1f013b6f27510247b2360c9e0ca9f018feebd82515f07635318b34ff9777ccc8fd0b6e6f2486ce3a33fe389fbb7db12d05baa474f4587509fb4f5ebf1c9`.
Its exact `caddy version` identity is
`v2.11.4 h1:XKxkMTgNSizEvKG6QHue6cAsFOteU2qA61w2tKkCWi0=`. A release
candidate's bytes must remain unchanged after `caddy fmt --overwrite`, and it
must pass `caddy validate --adapter caddyfile` with that exact binary. This
records a validation identity only; it does not authorize Caddy activation.
`sitesourcery-caddy.service.held` is a complete dedicated unit, not a drop-in
for a distribution Caddy service. Its preflight, start, and reload commands all
name the pinned binary and exact commit-addressed
`ops/Caddyfile.candidate.held`; none can fall back to `/etc/caddy/Caddyfile`.
The unit requires a dedicated `sitesourcery-caddy` system identity and keeps
Caddy state and its admin socket in separately owned systemd directories.

## Filesystem and service layout

```text
/opt/sitesourcery/
  node-24.18.0/
  caddy-2.11.4/
  releases/<full-git-commit>/
  current -> releases/<approved-commit>
/etc/sitesourcery/
  RUNTIME_APPROVED
  PUBLICATION_HOLD
  hosted.env
  caddy.env
  probe.env
  catalog.json
/var/lib/sitesourcery/
  private-exports/
  tenant-runtime/
/var/lib/sitesourcery-caddy/
  config/
  data/
```

The `sitesourcery` account owns only `/var/lib/sitesourcery`. Release and
configuration trees are root-owned and read-only to the process. Real
environment files are mode `0600`; examples contain no usable credential.

`RUNTIME_APPROVED` permits a loopback-only rehearsal while every publication
hold stays present. The Caddy gate requires `PUBLICATION_APPROVED` and refuses
startup while `/etc/sitesourcery/PUBLICATION_HOLD` exists. Provider approvals
for Stripe, Spaceship, DNS, and recovery delivery remain independent switches.

## Backup contract

`run-backup.mjs` is a real, provider-neutral backup path, but it deliberately
cannot stop the production writer or invent a cross-store snapshot:

1. An operator creates the short-lived, root-owned
   `/run/sitesourcery/BACKUP_QUIESCE` fence from the held example and stops the
   hosted service. The hosted service candidate has a negative condition on
   that fence, so systemd cannot restart it while capture is in progress.
2. The backup checks that the exact hosted unit is `inactive` and that
   PostgreSQL has zero `sitesourcery-hosted` sessions. It checks both again
   after capture and requires the fence bytes to remain identical.
3. `pg_dump` creates one transactionally consistent custom-format database
   dump. The app-state roots are copied while the writer is fenced. A complete
   file inventory is hashed before and after; any change fails the attempt.
4. Both plaintext artifacts are encrypted with `age` from the root-owned
   recipient file. The database URL and password remain in process
   environment/files, never command arguments, manifests, or logs. Local
   plaintext staging is removed on success and failure.
5. The destination must already exist, carry the exact
   `.sitesourcery-off-machine.json` marker, name a different failure domain,
   and opt into immutable attempt directories. A successful attempt contains
   only `.age` artifacts plus create-once manifests and SHA-256 evidence.

The configuration, private exports, tenant runtime, and exact release are all
inside the encrypted app-state archive. The unencrypted attempt manifest
contains only paths by artifact kind, sizes, hashes, timestamps, held-state
evidence, and opaque failure-domain identifiers.

Retention is a separate command. `ops:backup-retention` verifies every success
manifest and ciphertext again, always keeps the configured successful floor,
and only deletes when `SITESOURCERY_BACKUP_RETENTION_APPLY=true`. An incomplete
or tampered attempt stops the whole retention decision.

No timer can make an unfenced backup: the held backup service requires the
quiesce marker and the backup program independently proves the writer is
inactive. Every service and timer remains a `.held` template and has not been
installed or enabled.

### Release blocker: live-state operations

The backup, monitor, and restore candidates in this commit are deliberately
held-only. They require the recorded Stripe, recovery-mail, publication,
domain-runtime, and DNS states to all equal `held`; the backup and monitor unit
candidates also require `PUBLICATION_HOLD`. Removing that hold would therefore
stop scheduled backup and monitoring, and a backup recorded from a future live
state could not pass the current clean-room state-equality check.

Do not deploy these three candidates as post-publication operations. A follow-up
release gate must add a default-held, exact expected-state approval document for
backup and monitoring, keep their provider egress independently held, remove
the publication-hold scheduling dependency, and allow a live-source backup to
restore into a clean room whose provider egress remains held. That change needs
its own negative tests and clean-room proof; renaming a file or loosening the
existing equality check is not sufficient.

## Clean-room restore

`verify-restore.mjs` accepts one exact successful attempt. It verifies the
manifest and encrypted hashes before invoking `age`, verifies the decrypted
hashes before mutation, refuses an existing PostgreSQL target, restores into a
new database, and refuses a non-empty app-state root. The report succeeds only
when:

- `ss.hosted_runtime_contract_v13()`,
  `ss.hosted_runtime_contract_v14()`, and
  `ss.hosted_runtime_contract_v15()` all exist;
- the unsupported `ss_hosted` shadow schema is absent;
- the clean-room cluster has the canonical roles, `service_role` retains
  `BYPASSRLS`, and its restored `ss` schema privileges are present;
- the domain procurement control is held;
- the exact recorded table count and key row counts match;
- the restored app-state inventory has the exact recorded tree hash; and
- Stripe, recovery mail, publication, domain runtime, and DNS expectations all
  remain held.

The clean-room unit permits only Unix sockets and is explicitly not a
production unit. A restore failure leaves its isolated target available for
forensics; it never drops or substitutes an existing database.

## Monitoring and alerts

`monitor-held.mjs` checks six independent signals:

- loopback API and tenant readiness with publication still held;
- PostgreSQL availability, v13/v14/v15 migrations, shadow-schema absence, and the
  domain purchase hold;
- age and integrity of the newest off-machine backup;
- free bytes and free-space ratio on app storage;
- hostname and expiry of a local public certificate file; and
- ready/ambiguous cancellation work plus queued, expired-lease, and
  ambiguous-failure export work.

Ambiguous cancellation effects and export failures with ambiguous object facts
are operator-only reconciliation alerts; the monitor never retries them.
Expired export leases are separately reported when the v15 worker has not
reclaimed them within the reviewed window. Certificate inspection reads the
local public certificate and alerting uses the held adapter, so this candidate
has no email, webhook, SaaS, or other outbound call.

`alert-adapter.mjs` defines the future outbound boundary. An injected delivery
port can run only with an exact, digest-bound, time-limited approval for the
reviewed report schema. There is intentionally no network implementation and
no alert destination or credential in these files.

## Staged acceptance

1. Install the exact Node runtime and locked dependencies into a commit-addressed
   release directory. Build `_hosted` there and compare its reviewed manifest.
2. Apply the complete ordered PostgreSQL migration set to a new staging
   database. Run the repository, RLS, authenticated-role, payment, domain, and
   restore tests.
3. Create `RUNTIME_APPROVED`, keep every publication/provider hold, and start
   only `sitesourcery-hosted.service`. Both listeners must bind to loopback.
4. Run `probe-runtime.mjs` with `SITESOURCERY_EXPECT_PUBLICATION=held`. A held
   tenant readiness response is healthy; API persistence, catalog, compiler,
   and export readiness must still be true.
5. Validate the exact Caddy build with its native `validate` command. Use a
   disposable staging control hostname and a disposable customer hostname.
   Prove static routes, same-origin API, unknown-host denial, the TLS `ask`
   boundary, and ACME staging before any production DNS change.
6. Complete an encrypted off-machine backup and clean-machine restore drill.
   Record the backup digest, restore host, PostgreSQL row/table invariants,
   private-object manifest, tenant-release manifest, RPO, and RTO.
7. Enable the minute probe and prove its failure reaches the owner through the
   reviewed alert path.
8. Re-run the exact browser and database release matrices against the staged
   commit. Record the full commit and artifact hashes.
9. Only an explicit owner release can replace the current symlink, create
   `PUBLICATION_APPROVED`, remove the system hold, and change DNS. Provider live
   approvals remain separate.

## Rollback

Do not rebuild during rollback. Point `current` to the previous already-audited
commit, restart the loopback runtime, run the held probe, validate Caddy, and
then reload the dedicated Caddy instance. Database rollback is not an automatic
down-migration: restore the verified backup into an isolated database, prove it,
and make a separate authority decision.

If payment, registrar, DNS, email, backup, or monitoring evidence is ambiguous,
keep the service held and reconcile the durable provider/object state. Never
blindly repeat an external effect.
