# Release-candidate acceptance

Unchecked release boxes require exact production evidence and owner authority.
Checked rehearsal evidence records completed proof but does not grant runtime,
provider, DNS, payment, or publication authority.

## Exact release

- [ ] Full lowercase Git commit recorded.
- [ ] Locked dependency and Node 24.18.0 checks pass.
- [ ] Held and hosted artifact manifests match the reviewed hashes.
- [ ] All section, browser, payment, domain, self-host, and public-truth gates
      pass on the exact commit.
- [ ] Fresh PostgreSQL migrations and authenticated-role invariants pass.

## Runtime

- [ ] Release and `/etc/sitesourcery` are root-owned and non-writable.
- [ ] Runtime writes only below `/var/lib/sitesourcery`.
- [ ] API and tenant listeners bind only to their distinct loopback ports.
- [ ] Graceful stop drains HTTP and every safe leased worker.
- [ ] Held provider configuration produces no provider request.
- [ ] Runtime probe passes in the expected held state.

## Routing and TLS

- [ ] Official `caddy_2.11.4_linux_amd64.tar.gz` SHA-512 is exactly
      `8220d1f013b6f27510247b2360c9e0ca9f018feebd82515f07635318b34ff9777ccc8fd0b6e6f2486ce3a33fe389fbb7db12d05baa474f4587509fb4f5ebf1c9`,
      and `caddy version` is exactly
      `v2.11.4 h1:XKxkMTgNSizEvKG6QHue6cAsFOteU2qA61w2tKkCWi0=`.
- [ ] Exact held Caddyfile is byte-identical before and after
      `caddy fmt --overwrite` and passes `caddy validate --adapter caddyfile`;
      validation does not activate it.
- [ ] Dedicated `sitesourcery-caddy.service` preflight, start, and reload all
      name `/opt/sitesourcery/current/ops/Caddyfile.candidate.held`, the pinned
      2.11.4 binary, and the Caddyfile adapter; `/etc/caddy/Caddyfile` is absent.
- [ ] Control host serves only the reviewed `_hosted` tree.
- [ ] Control `/api` reaches `8788` and no tenant hostname can reach it.
- [ ] Customer host reaches `8080` and cannot read the control artifact.
- [ ] Unknown, pending, dark, malformed, and duplicate hosts deny TLS.
- [ ] Exact `/_sitesourcery` and every `/_sitesourcery/*` internal control path
      return public `404` on both control and tenant hosts.
- [ ] ACME staging succeeds for disposable approved hostnames.
- [ ] Platform-subdomain certificate strategy is separately approved.

## Data safety

Completed loopback-only rehearsal evidence is recorded in
`ops/PRODUCTION-BACKUP-RESTORE-2026-08-02.md`:

- [x] The reviewed user-service quiesce fence remained byte-identical, the
      exact runtime stayed inactive, and hosted PostgreSQL writer count stayed
      zero before and after capture.
- [x] PostgreSQL and all four app-state roots reached Zen as age ciphertext in
      a distinct marked failure domain with immutable manifests and digests.
- [x] Database credentials and recovery secrets stayed out of argv, logs, and
      immutable evidence.
- [x] A fresh Unix-socket-only PostgreSQL target reproduced v13/v14/v15, 94
      tables, role grants, held domain state, and all recorded row counts.
- [x] A fresh app-state target reproduced all 607 entries and the exact tree
      hash after archived permissions were restored exactly.
- [x] Backup capture, recovery-point age, and restore wall time were measured;
      owner acceptance of the production RPO/RTO remains open.
- [x] Disposable decrypted database and app-state targets were removed after
      proof while encrypted backup and immutable restore evidence were kept.

- [ ] **Release blocker closed:** backup and monitoring run under an exact,
      separately approved expected operations state after publication, while
      clean-room restore keeps every provider egress held and can verify a
      backup captured from the live source state.
- [ ] PostgreSQL and private filesystem writers are quiesced or snapshotted
      consistently.
- [ ] The root-owned quiesce fence is unchanged, the hosted unit is inactive,
      and zero hosted PostgreSQL sessions exist before and after capture.
- [ ] Encrypted backup reaches a different failure domain.
- [ ] The destination marker identifies a different failure domain and every
      stored data artifact is age-encrypted.
- [ ] Backup manifest covers the database dump, private exports, tenant control,
      immutable release bytes, and required configuration metadata.
- [ ] No database URL, password, age identity, Stripe key, or recovery secret
      appears in argv, logs, or immutable evidence.
- [ ] A clean-machine restore reproduces all manifest digests and database
      invariants.
- [ ] The restore target database did not exist, v13, v14, and v15 are present,
      domain procurement remains held, and the app-state tree hash matches.
- [ ] Restore RPO and RTO are measured and accepted.
- [ ] Export worker crash/restart and lease-fencing proofs pass.

## Monitoring and response

Completed loopback production-rehearsal evidence is recorded in
`ops/PRODUCTION-MONITOR-2026-08-02.md`:

- [x] The exact release passed database, newest-backup, disk,
      certificate-hold, runtime/state, and cancellation/export-backlog probes.
- [x] Outbound delivery failed closed without an exact expiring approval,
      private destination identity, private state path, and verified Resend
      domain with tracking disabled.
- [x] One isolated, visibly labeled test incident and recovery reached the
      confirmed owner inbox and Resend reported both delivered; test state
      never entered real incident history.
- [x] The reviewed five-minute timer completed an unattended all-green run,
      attempted no healthy-state message, and scheduled its next invocation.

- [ ] Minute probe fails on API, database, catalog, export, or unexpected
      publication-state drift.
- [ ] Probe failure reaches the reviewed owner alert path.
- [ ] Disk, certificate, backup age, database availability, worker backlog, and
      provider reconciliation alerts are exercised.
- [ ] Outbound alert mode remains held unless one exact expiring approval and
      a separately reviewed delivery adapter are provided.
- [ ] Payment, domain, DNS, export, safety, deletion, and rollback runbooks name
      one operator action and one no-retry boundary.

## Separate owner switches

- [ ] Runtime rehearsal approved.
- [ ] Recovery delivery approved and verified.
- [ ] Stripe environment/capabilities/credentials/Price map approved.
- [ ] Registrar agency/reseller authority and exact price/debit proof approved.
- [ ] DNS provider permissions approved.
- [ ] Production routing/DNS approved.
- [ ] Publication approved.

No combined “launch” answer substitutes for these independent decisions.
