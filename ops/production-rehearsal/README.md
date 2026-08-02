# Held production rehearsal — 2026-08-01, updated 2026-08-02

This records the exact non-secret production rehearsal installed after the
isolated HTTPS staging journey passed. It is deliberately loopback-only. It
does not authorize or claim public routing, customer mail, payment, domain
purchase, tenant publication, DNS change, or production launch.

## Current checkpoint — 2026-08-02

The active Dell runtime and static rehearsal now use exact release
`15cab8f4d220f9a5116b89c732daa6dc9fb19a17`. Registration and recovery mail
are production-ready while Stripe, publication, domain runtime, and DNS remain
held. The loopback operations projection validates all six fields exactly; its
public capability projection keeps payment, domain purchase, and publishing
disabled.

The rehearsal produced a quiesced encrypted backup on Zen and Zen completed a
fresh, provider-held, Unix-socket-only restore using exact restore tooling
`4f889a6410f60eedc5b02f480022107748a8b0e5`. The canonical backup manifest is
`c06f17b94dadc94e85d32e6640064372368d156592c78f987a2494b2334e344d`;
the immutable successful restore report is
`e5cf7001f7b697333f1e72ab9a4ddbff39ec4243a2f28a8ede2b076ada1785eb`.
See `ops/PRODUCTION-BACKUP-RESTORE-2026-08-02.md` for exact artifacts,
invariants, the preserved failed-restore evidence, RPO/RTO measurements, and
plaintext cleanup.

## Initial exact release and runtime

- Commit: `be7cc3781c3e9354ecb017c7df7f090afe556f32`.
- Branch: `build/sitesourcery-v2-20260730`.
- Dell release:
  `/home/simtech/sitesourcery-production/releases/be7cc3781c3e9354ecb017c7df7f090afe556f32`.
- Node: exact `24.18.0`, downloaded from the official Linux x64 archive and
  verified against its official SHA-256 manifest before extraction.
- Locked install reported zero vulnerabilities. The hosted artifact built and
  verified from the exact release.

The full release gate passed before installation: 264 current Node tests, 19
self-host tests, 106 hosted-service passes plus two expected PostgreSQL-env
skips, 22 operations tests, exact public and hosted artifacts, and 15 hosted
routes at 320, 390, and 1440 pixel widths.

## Separate clean production authority

HQ runs enabled user unit `sitesourcery-production-postgresql.service` from the
persistent PostgreSQL 16.14 toolchain. Its separate data directory is
`/home/mrfantasea/.local/share/sitesourcery-production-postgresql-16.14/data`;
its mode-`0700` runtime socket is
`/run/user/1000/sitesourcery-production-postgresql/.s.PGSQL.55433`.
It listens on no TCP address and has data-page checksums enabled.

Database `sitesourcery_production` was created empty. All 21 ordered migration
files from the exact commit applied successfully. Runtime contract v21,
`pgcrypto`, the three reviewed legal versions/digests, and the exact
`anon`/`authenticated`/`service_role` attributes verified. The database then
reported zero users, organizations, projects, versions, term acceptances, and
Download quotes. No staging customer row was copied into production.

## Enabled held services on Dell

- `sitesourcery-production-db-tunnel.service` pins the existing HQ host key and
  maps only `127.0.0.1:55439` to the private HQ production socket.
- `sitesourcery-production.service` runs the exact Node release on loopback API
  port `8788` and tenant port `8080`, and requires the database tunnel.
- `sitesourcery-production-static.service` serves only the verified `_hosted`
  artifact on `127.0.0.1:8899` for local rehearsal.

All three Dell units and the HQ PostgreSQL unit are enabled and active, and both
users have lingering enabled. Dell's private environment and pinned known-hosts
files are mode `0600`. The environment contains independent production pepper
and contact-vault material. The already approved Resend key and exact domain ID
were transferred directly from Zen into Dell's private environment; the two
temporary transfer files were then removed. It contains no Stripe, registrar,
DNS, or catalog credential. No secret value was printed or committed.

Registration and recovery now use the reviewed production adapter and exact
`https://sitesourcery.com/abracadabra/app/` action page. Startup independently
reverified the Resend domain, SPF/DKIM, sending capability, and disabled click
and open tracking. No registration, recovery, or other delivery request was
made during this readiness proof.

Local health and readiness return `200`. The public capability projection is
exactly:

```json
{"accountRegistration":true,"accountRecoveryEmail":true,"downloadQuote":true,"downloadPayment":false,"domainPurchase":false,"publishing":false}
```

Tenant health reports `publicationHeld: true`; tenant readiness therefore
returns its intentional held `503`. The immutable root and
`/abracadabra/app/` both return `200` from the loopback artifact service.

A controlled HQ PostgreSQL restart changed its process ID, followed by a
separate Dell tunnel restart and runtime restart. The clean row counts, API
readiness, capability projection, and artifact responses remained exact.

## Pinned edge validation, not activation

Dell now has the official Caddy 2.11.4 Linux x64 binary under the private
production toolchain. The archive SHA-512 is exactly
`8220d1f013b6f27510247b2360c9e0ca9f018feebd82515f07635318b34ff9777ccc8fd0b6e6f2486ce3a33fe389fbb7db12d05baa474f4587509fb4f5ebf1c9`
and its version identity is exactly
`v2.11.4 h1:XKxkMTgNSizEvKG6QHue6cAsFOteU2qA61w2tKkCWi0=`. The exact held Caddyfile
was byte-identical after `caddy fmt --overwrite` and passed native
`caddy validate --adapter caddyfile` with the exact control host and artifact
root. No Caddy service was installed or started.

## Exact public cutover gap

- `sitesourcery.com` still has the four GitHub Pages A records and no AAAA
  record.
- `sitesourcery.me` still points elsewhere; a random
  `label.sitesourcery.me` lookup has no A or AAAA answer, so no platform
  wildcard is active.
- Dell's unprivileged-port floor is `1024`, UFW is active, and the ordinary
  service user cannot bind `443`.
- An empty temporary listener on an unprivileged Dell port was unreachable
  externally over both native IPv6 and public IPv4. The listener and temporary
  directory were removed afterward.

Before DNS can change, one reviewed root/network pass must install the dedicated
Caddy system service with only `CAP_NET_BIND_SERVICE`, allow inbound TCP 80/443
in UFW, and establish/prove the corresponding public IPv4 forwarding plus IPv6
firewall path. Then ACME staging and exact same-origin route tests must pass.
Only after that proof can the control A/AAAA records and the separately reviewed
`*.sitesourcery.me` strategy be changed. Production mail adapter readiness and
off-machine encrypted backup/restore are now evidenced above. A successful
delivered action-link proof, monitoring and its alert path, payment, domain
purchase, and publication remain separate work; none is implied by opening the
edge.
