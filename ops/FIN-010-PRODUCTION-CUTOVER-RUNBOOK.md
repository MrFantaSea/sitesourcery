# FIN-010 exact production activation, cutover, and stabilization

State: executable control for the accepted successor; public/provider effects
remain independently gated until their exact steps below pass.

## Frozen identities

- Accepted source: `26b07202d91000b9a7ae0de36471c7979f9482a1`, tree
  `00f648e39931a3e62445bc6c1d441087c69a8136`.
- Accepted control: `804b9a57922f14eed673fe5a1b66a8f42afad4ce`.
- Verified GitHub main before FIN-010:
  `8b83af7360375c0f8b8cd82113abb1a60f00fcb2`, tree
  `1cb09f874a2a1bf4a36ecb287065236eaa9fa8bc`.
- Retained predecessor:
  `84aca6b757a806b428ae0cce8115c12dcc6486cd`, artifact manifest
  `b28ff784a9205096094a53a0fdbcedc5a20878b2b640e545cacd43ff61fd4359`.
- Production database: `sitesourcery_production`, PostgreSQL 16, exact
  predecessor schema `e5d1efe881766fc201335e125f26fdb3c9c7cf27de61873b6f0b62201c0231a2`.
- Exact successor: 95 migrations, 287 tables, schema
  `de7a4d476899db85d0d4bf2e93c9f54210f39bc77c416586a8b960cf0e5a397a`.
- Public placeholder SHA-256:
  `672d8ea082208c32c545d1bc7f01a077327a045eac236027531083e382584f9d`.
- Assigned Cloudflare nameservers: `jasmine.ns.cloudflare.com` and
  `nash.ns.cloudflare.com`. Current delegation remains
  `launch1.spaceship.net` and `launch2.spaceship.net` with no DS.
- Tunnel: `211ffa61-e170-444d-a945-04fead19c972`; exact hostnames are
  `sitesourcery.com` and `www.sitesourcery.com`; all other tunnel ingress is
  HTTP 404.

The production release path is
`/home/simtech/sitesourcery-production/releases/26b07202d91000b9a7ae0de36471c7979f9482a1`.
The existing predecessor release, environment, unit bytes, GitHub Pages
placeholder, databases, archives, and evidence are retained for at least 30
days after cutover. Nothing is auto-retired at day 30.

## Current release matrix

| Purpose | FIN-010 state | Release condition |
|---|---|---|
| Public product/content | ready for cutover | Exact held production probes and signed-in Cloudflare/Spaceship changes |
| Registration mail | production, previously approved | Preserve exact Resend key/domain and prove one controlled registration |
| Recovery mail | production, previously approved | Preserve exact Resend key/domain and prove one controlled recovery |
| Monitor alerts | production, previously approved | Preserve reviewed alert path; normal green runs send nothing |
| Other transactional mail | installed, worker held | Separate reviewed worker/recipient/provider-purpose release |
| Stripe P1-P9 | installed, held; no key copied into successor | Stripe reauthentication, exact account/catalog/tax/webhook/key/portal readback, then purpose-by-purpose controlled transaction |
| Domains G1-G7 | installed, held | Spaceship commercial-use consent, credentials, exact final-charge bridge, vault and reconciliation proof |
| Responder/Twilio | installed, held | Twilio account/number/A2P/Voice/push credentials and exact callback proof |
| Care/Responder commerce | installed, held | Their independent payment/mail/fulfillment provider gates |
| iOS distribution | built, held | Apple team, signing identity, profiles, real device, App Store Connect |
| Android distribution | built, held | Release keystore, distribution account, signed real-device/store proof |
| Publication and tenant domains | installed, held | Operator publication approval and later reviewed tenant-domain routing |

The intentionally held rows are valid FIN-010 exit states only because their
engineering, composition, persistence, UI, and proofs are already complete and
each remaining blocker is named above.

## Phase A — pre-mutation proof and immutable preparation

1. Confirm the branch/diff allowlist, run focused operations proof, the full
   operations suite, and the complete pinned-Node ladder. Commit implementation
   separately from final provenance.
2. Re-read GitHub main checks and the live placeholder. Run the 44-query DNS
   preflight. Verify both Cloudflare authorities still carry the four fallback
   GitHub Pages A records and exact Resend MX/SPF/DKIM while the parent and
   recursive resolvers show no DS.
3. On Dell, verify the predecessor runtime/static/origin/tunnel, DB tunnel,
   backup mount, monitor and backup timers. Confirm worker absence/inactivity,
   loopback listeners only, and the exact predecessor artifact manifest.
4. Verify the root-owned accepted evidence files before using them:

   - `/etc/sitesourcery/final-release-epoch-v2.json`:
     `935cb082bcc279bbb5361ff9997a2222bb1cc8313eeb2a1f43a3465cbb3c928c`
   - `/etc/sitesourcery/origin-seal.json`:
     `ee5be28b62ab0ba951e689a9dfbaed7a4a55bf7b7136b5b55be501aa827b3b47`
   - `/etc/sitesourcery/origin-installed-readback.json`:
     `f07adff3f67aafcbee0a83da785fb4c124d9c7b6fe3744cdc31830a3f2e7c77d`

5. Copy the accepted release from retained FIN-009 staging into the absent
   production release path with archive/checksum semantics. Verify every file,
   byte count, mode, 118-file hosted artifact manifest, source commit/tree,
   migration inventory, and locked dependency tree before using it.
6. Install the separately committed FIN-010 operations-control tree under
   `/home/simtech/sitesourcery-production/control/COMMIT_SHA` and verify that
   commit/tree before running its tools. Never copy FIN-010 control files into
   or modify the immutable accepted `26b0720...` runtime release.
7. Preserve immutable rollback copies of the predecessor user units, current
   private environment, Caddyfile, tunnel configuration, and service-state
   inventory. Never log or hash the environment values.
8. Run `ops/fin010-production-runtime.mjs prepare` from that exact control tree
   on Dell. It reads the old
   protected EnvironmentFile directly, carries only the database, legacy
   identity pepper/version, contact-vault key/version, compiler authority,
   licensed domain, and already approved Resend mail values; creates fresh
   production-only publication and engagement secrets; writes exact candidate
   hosted/worker EnvironmentFiles mode 0600; and outputs names/states only.
   It refuses to carry Stripe, Twilio, Resend-webhook, responder-material, or
   catalog secrets while those purposes are held. Never reuse any FIN-009
   staging secret.
9. Render the candidate wrapper and exact user runtime/static/held-worker units
   from `ops/fin010-production-runtime.mjs`. Render its Caddyfile and validate
   it with pinned Caddy 2.11.4 before installation. The new Caddyfile proxies
   API to `127.0.0.1:8788` and immutable static bytes to `127.0.0.1:8899`; it
   removes the stale `/opt/sitesourcery/current` static dependency. The tunnel
   credential and ingress YAML remain unchanged.

## Phase B — fresh paired backup and protected data epoch

1. Start one manual `sitesourcery-production-backup.service` cycle and wait for
   its immutable Zen `attempt.succeeded.json`. Require encrypted PostgreSQL and
   application-state artifacts, source/destination failure-domain separation,
   zero retained plaintext, provider egress held, and runtime restoration.
2. Run the existing production monitor after backup. All runtime, database,
   disk, certificate, backlog, backup and alert-policy checks must be green.
3. Pause the monitor and backup timers. Stop Cloudflared, origin, static and
   production runtime in that order. Worker must be inactive. Keep the DB
   tunnel active. Confirm the public placeholder still serves the exact hash.
4. Run the FIN-010 preflight through the newly generated hosted EnvironmentFile.
   It must report database `sitesourcery_production`, PostgreSQL 16, exactly
   201 tables (`auth=1`, `ss=200`), the exact predecessor schema, and the exact
   95/37 migration inventory without mutation.
5. Create a root/user-owned mode-0400 protected-upgrade control valid for no
   more than 30 minutes. Bind the fresh backup receipt and ciphertext-set
   digests, preflight row-count digest, predecessor artifact/unit/environment,
   unchanged public placeholder, all stopped/paused states, held providers,
   owner completion authority, separate public cutover, and no retirement.
6. Run `ops/fin010-protected-production-upgrade.mjs upgrade`. It obtains a
   PostgreSQL advisory lock, refuses any second connection, rechecks the exact
   predecessor schema and row digest, applies only migrations 59-95, verifies
   every predecessor relation has no row loss, proves held lifecycle/RLS/
   identity invariants, requires the exact 287-table successor schema, and
   writes the immutable mode-0400 upgrade receipt.
7. If any migration or evidence write fails after mutation begins, do not start
   either runtime. Restore the paired database and application-state backup,
   reinstall the saved predecessor unit/config bytes, prove predecessor
   readiness, and investigate. The predecessor must never run against the
   successor schema.

## Phase C — production-held successor readback

1. Install the candidate runtime/static units, disabled held-worker unit,
   wrapper, and validated Caddyfile. Keep `WORKERS_HOLD` present and
   `WORKERS_APPROVED` absent. Create only the exact runtime approval marker.
2. Reload the user manager. Start runtime and static. Require:

   - loopback listeners `8788`, `8080`, and `8899` only;
   - `/api/v1/live`, `/api/v1/ready`, `/api/v1/capabilities`, tenant health,
     exact release identity, 95 migrations, Legal V5 and held providers;
   - exact current/versioned Privacy and Website Terms V5 bytes;
   - root, account, operator, Care, Responder and legal static journeys;
   - CSRF, cross-origin, unauthenticated-operator and held-effect negatives;
   - zero worker/provider/payment/domain/publication effects.

3. Start origin, validate Host-based routing through `127.0.0.1:8081`, then
   start Cloudflared. Require four connected links, outbound-only transport,
   apex/www ingress only, catch-all 404, and loopback-only origin/metrics.
4. Re-enable backup and monitor timers. Run a post-upgrade encrypted backup and
   a monitor cycle. Perform a controlled runtime/static/origin/tunnel restart
   and prove exact return. Run the conservative installed load/SLO sample.
5. Run controlled registration and recovery journeys only after confirming
   the owner-controlled test inbox. Reconcile each durable mail reservation and
   Resend receipt. Do not test any other held provider purpose.
6. Record installed release, environment-name classification, units, PIDs,
   listeners, database schema/row digest, backup, monitor, load, journey and
   rollback-pair receipts. At this point production is exact and held, but the
   public site is still GitHub Pages.

## Phase D — public Cloudflare/Spaceship cutover

This phase requires a signed-in Cloudflare/Spaceship session or scoped API
authority. Do not guess credentials or expose tokens.

1. In Cloudflare, preserve the current four-A fallback definition as rollback
   evidence. Create/verify proxied apex and `www` routes for tunnel
   `211ffa61-e170-444d-a945-04fead19c972`; preserve exact MX/SPF/DKIM and keep
   DNSSEC off because the parent has no DS. Confirm no wildcard or tenant-domain
   route is added.
2. Query `jasmine.ns.cloudflare.com` and `nash.ns.cloudflare.com` directly.
   Both must agree on web and mail state. Validate Cloudflare edge TLS before
   delegation where the provider permits an origin/tunnel preview.
3. In Spaceship, change only the authoritative nameserver pair from
   `launch1/launch2.spaceship.net` to `jasmine/nash.ns.cloudflare.com`.
   Do not change registrant, transfer, renewal, DNSSEC, or mail settings.
4. Poll parent and multiple recursive resolvers until the pair converges.
   Verify apex/www TLS, 24 routes, 14 redirects, all six width modes, immutable
   Legal V5, API liveness/readiness/capabilities, account static UI, wrong-host
   421, internal-path 404, and unchanged mail records.
5. Run one controlled public registration and recovery journey and reconcile
   its Resend evidence. Payment, Domain, Twilio, worker, publication, Care and
   Responder effects remain held and must reject attempts without side effects.

Fast rollback after Cloudflare becomes authoritative is to restore the four
GitHub Pages A records in Cloudflare while keeping mail unchanged; this avoids
waiting for nameserver rollback. If Cloudflare authority itself is defective,
restore the Spaceship nameservers as the slower second rollback. If the
successor data/runtime is defective, pair runtime rollback with the exact
pre-upgrade database restore before routing traffic to it.

## Phase E — stabilization and final provenance

- Capture checkpoints immediately after cutover, after 15 minutes, one hour,
  24 hours, and seven days. Each records DNS/TLS, exact public content/API,
  runtime/static/origin/tunnel PIDs, database/backlog/worker holds, backup age,
  monitor health, controlled mail reconciliation, and customer-effect counts.
- Keep the Pages placeholder, predecessor runtime/database restore pair,
  fallback Cloudflare records, old units/environment/Caddyfile, staging release,
  Git refs, archives, bundles, receipts and backups for at least 30 days.
- Do not automatically delete anything at or after day 30. Retirement requires
  an individually named owner decision.
- Seal `FIN-010-PRODUCTION-CUTOVER-PROVENANCE.md` and its machine receipt only
  after every released purpose is live/reconciled, every unreleased purpose is
  installed and held behind the named blocker, rollback is proved, and all
  required planes are accounted for.

FIN-010 exit is honest 100/100 when the exact accepted product is public,
registration/recovery and monitoring are reconciled, all unavailable provider
purposes remain fully built/installed/held behind the matrix above, rollback is
proved, stabilization has begun, and the immutable operating topology and
completion receipt are committed.
