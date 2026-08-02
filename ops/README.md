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

An exact held Dell/HQ rehearsal now exists under user services without public
ingress. It proves the immutable runtime, separate empty production database,
restart behavior, and pinned Caddy validation, but activates no edge or provider
effect. See `ops/production-rehearsal/README.md`.

The rehearsal's encrypted off-machine backup and clean-room restore completed
on 2026-08-02. Exact attempt IDs, hashes, invariants, failure diagnosis,
RPO/RTO measurements, and plaintext cleanup are in
`ops/PRODUCTION-BACKUP-RESTORE-2026-08-02.md`.

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
  operations-state-approved.json
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
for Stripe, registration/recovery delivery, Spaceship, and DNS remain
independent switches.

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

The loopback-only Dell production rehearsal uses the separate
`ops:backup:production-rehearsal` entry point. It pins
`sitesourcery-production.service`, invokes `systemctl --user`, requires the
calling user's exact
`/run/user/<uid>/sitesourcery-production/BACKUP_QUIESCE` fence, and records that
unit in immutable consistency evidence. This boundary is selected by code, not
an environment switch, so it cannot relax or substitute for the root production
entry point, `/run/sitesourcery/BACKUP_QUIESCE`, or
`sitesourcery-hosted.service`.

The configuration, private exports, tenant runtime, and exact release are all
inside the encrypted app-state archive. The unencrypted attempt manifest
contains only paths by artifact kind, sizes, hashes, timestamps, source-state
approval evidence, the operations-process egress hold, and opaque
failure-domain identifiers.

Retention is a separate command. `ops:backup-retention` verifies every success
manifest and ciphertext again, always keeps the configured successful floor,
and only deletes when `SITESOURCERY_BACKUP_RETENTION_APPLY=true`. An incomplete
or tampered attempt stops the whole retention decision.

No timer can make an unfenced backup: the held backup service requires the
quiesce marker and the backup program independently proves the writer is
inactive. Every service and timer remains a `.held` template and has not been
installed or enabled.

### Live-state operations contract

Backup and monitoring share one exact source-state contract covering Stripe,
registration mail, recovery mail, publication, domain runtime, and DNS. With no
approval file, all six fields must equal `held`. Any non-held field requires a
bounded `sitesourcery.operations-state-approval/v1` document. The document
binds an approval ID, source failure domain, sorted `backup`/`monitor` consumer
scopes, exact expected state, activation and expiry timestamps, and a canonical
SHA-256 digest. Unknown fields, source or scope drift, an inactive date, a
changed digest, or actual-state drift fail closed.

This approval is observation authority, not provider authority. Backup and
monitoring separately require
`SITESOURCERY_OPERATIONS_PROVIDER_EGRESS=held`; the monitor still composes only
the held alert adapter, and backup composes no payment, mail, publication,
registrar, or DNS adapter. Their units and timers retain independent activation
markers but no longer depend on `PUBLICATION_HOLD`, so removing the publication
hold cannot silently stop post-publication backup or monitoring.

Every v2 backup ledger records the full validated source-state evidence and its
approval digest. Historical verification rechecks that digest without requiring
the approval to remain unexpired forever. Restore does not require its execution
state to equal the captured source state; it preserves the source evidence while
independently requiring every clean-room provider egress to equal `held` and
network exposure to equal `none` before decrypting anything.

## Clean-room restore

`verify-restore.mjs` accepts one exact successful attempt. It verifies the
manifest and encrypted hashes before invoking `age`, verifies the decrypted
hashes before mutation, refuses an existing PostgreSQL target, restores into a
new database, and refuses a non-empty app-state root. App-state extraction
preserves the archived permission inventory while refusing archived ownership;
this is required because modes are part of the canonical tree hash. The report
succeeds only when:

- `ss.hosted_runtime_contract_v13()`,
  `ss.hosted_runtime_contract_v14()`, and
  `ss.hosted_runtime_contract_v15()` all exist;
- the unsupported `ss_hosted` shadow schema is absent;
- the clean-room cluster has the canonical roles, `service_role` retains
  `BYPASSRLS`, and its restored `ss` schema privileges are present;
- the domain procurement control is held;
- the exact recorded table count and key row counts match;
- the restored app-state inventory has the exact recorded tree hash; and
- the source operations state and approval digest still match the immutable
  backup ledger; and
- Stripe, registration mail, recovery mail, publication, registrar, DNS, and
  outbound-alert egress all remain held in the restore process, with network
  exposure set to `none`.

The clean-room unit permits only Unix sockets and is explicitly not a
production unit. A restore failure leaves its isolated target available for
forensics; it never drops or substitutes an existing database.

## Monitoring and alerts

`monitor-held.mjs` uses the held alert adapter while checking six independent
signals under the separately approved source-state contract:

- loopback API and tenant readiness with all six observed modes exactly equal
  to the reviewed expectation; Caddy blocks the internal state path publicly,
  and its projection contains no credentials;
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
4. Run `probe-runtime.mjs` with all six expected operations fields. With no
   approval they must all be `held`; a reviewed non-held state must use the
   same active approval document as backup and monitoring. A held tenant
   readiness response is healthy; API persistence, catalog, compiler, and
   export readiness must still be true.
5. Validate the exact Caddy build with its native `validate` command. Use a
   disposable staging control hostname and a disposable customer hostname.
   Prove static routes, same-origin API, unknown-host denial, the TLS `ask`
   boundary, and ACME staging before any production DNS change.
6. **Completed for the loopback production rehearsal on 2026-08-02.** The
   encrypted off-machine backup and clean-room restore digest, host, PostgreSQL
   row/table invariants, app-state manifest, RPO, and RTO are recorded in
   `ops/PRODUCTION-BACKUP-RESTORE-2026-08-02.md`.
7. Enable the minute probe and prove its failure reaches the owner through the
   reviewed alert path.
8. Re-run the exact browser and database release matrices against the staged
   commit. Record the full commit and artifact hashes.
9. Only an explicit owner release can replace the current symlink, create
   `PUBLICATION_APPROVED`, remove the system hold, and change DNS. Provider live
   approvals remain separate.

## Rollback

Do not rebuild during rollback. Point `current` to the previous already-audited
commit, restart the loopback runtime, run the exact-state probe, validate Caddy, and
then reload the dedicated Caddy instance. Database rollback is not an automatic
down-migration: restore the verified backup into an isolated database, prove it,
and make a separate authority decision.

If payment, registrar, DNS, email, backup, or monitoring evidence is ambiguous,
keep the service held and reconcile the durable provider/object state. Never
blindly repeat an external effect.
