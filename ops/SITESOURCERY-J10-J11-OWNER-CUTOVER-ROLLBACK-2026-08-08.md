# Site Sourcery J-10/J-11 owner cutover and rollback — 2026-08-08

Status: **prepared only; do not execute**

This runbook does not authorize a push, deployment, DNS change, live Stripe
effect, Caddy start, hold removal, or production cutover. It is intentionally
fail-closed where the final legal release hash, production address, or owner
approval does not yet exist.

## Current observed baseline

- Executable local checkpoint:
  `0dfd87e90d2142e78e9915951dcdffc866d6cacc`.
- Dell still runs held rehearsal release
  `15cab8f4d220f9a5116b89c732daa6dc9fb19a17` on loopback only.
- Dell user services for runtime, static artifact, database tunnel, monitor
  timer, and backup timer are active and enabled. Listeners are only
  `127.0.0.1:8788`, `:8899`, `:8080`, and `:55439`.
- Dell API health/readiness are 200. Capabilities are registration true,
  recovery true, Download quote true, payment false, domain purchase false,
  publishing false.
- No dedicated Caddy service is installed or running. Public TCP 80/443,
  forwarding, IPv6 firewall, and ACME staging proof remain open.
- `sitesourcery.com` uses SpaceShip nameservers
  `launch1.spaceship.net` and `launch2.spaceship.net`.
- Current rollback DNS, observed 2026-08-08, is four A records with TTL 1800:
  `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, and
  `185.199.111.153`. No apex AAAA and no `www` A/AAAA/CNAME answer were
  observed.
- `sitesourcery.me` currently resolves to `34.216.117.25` and
  `54.149.79.189`; it is not part of this control-host cutover.

Re-run DNS observations immediately before any owner-approved change. A dated
record is evidence, not permanent authority.

## The four distinct holds

These controls must never be treated as one switch.

1. **Legal/project-creation hold.** Privacy V3 release constants are null and
   migration 48 rejects them. Existing reads, sign-in, recovery, existing
   projects, repeat paid Download, export, deletion, and contact stay live;
   only new project creation is held. Lift only with exact owner-approved
   Privacy and Website Terms artifacts and a fresh 53-migration proof.
2. **Payment holds.** Stripe provider authority and each purpose release are
   independent. Private staging uses Stripe test keys with `livemode=false`.
   Public production stays held until a separate owner commercial approval.
3. **Control-host edge hold.** `/etc/sitesourcery/PUBLICATION_HOLD` prevents
   the dedicated Caddy unit from starting. Removing it exposes the control
   website/API only after network and TLS proof.
4. **Tenant/Alakazam publication hold.** Application publication, every
   Alakazam tier, customer-domain purchase, and Responder sales remain held.
   They are not lifted for first dollar and do not borrow authority from the
   control-host edge.

## Hard stop conditions

Stop before installation or cutover if any item is missing:

- clean final integration worktree and one full 53-migration release receipt
  with `databaseAbsent:true` on the exact final hash;
- retained Privacy content seal
  `b040ee6c95830b732e18859eec6fe5ddfec56325e7357269fc5f0f14e6861d92`,
  binding owner-approved review SHA-256
  `1fdc50606115e31e61aad1063e724949f0e2efb3444aaba775a7db9c14523a14`
  at exactly 25,994 bytes;
- owner rulings on all 12 Website Terms V3 proposed diffs, followed by approval
  of the exact rendered replacement bytes;
- final Privacy/Terms version identifiers, byte counts, content digests,
  authority digest, and an effective UTC that is the actual publication time;
- L1 and Privacy UI integrated with final manifest digests and both browser
  journeys;
- private staging authorization and successful new/returning customer runs;
- real Stripe TEST evidence for the $200 assessment, one variable Custom first
  payment, and one $5 Download;
- J-06 performance rerun, owner Mac/Pixel walk, and exact journey matrix;
- reviewed Dell public IPv4/IPv6 reachability, TCP 80/443 firewall/forwarding,
  pinned Caddy validation, ACME staging, and same-origin routing proof;
- verified current and rollback DNS records; and
- an owner-written `GO` that names the final release hash and whether the
  commercial Stripe live gate is approved or remains held.

## J-10 owner walkthrough

### A. Seal the exact release candidate

From the final integration worktree on the Mac:

```sh
git status --short
git rev-parse HEAD
git show -s --format='%H %s' HEAD
shasum -a 256 legal/privacy/versions/SS-HOSTED-PRIVACY-2026-07-30-V2/index.html
wc -c legal/privacy/versions/SS-HOSTED-PRIVACY-2026-07-30-V2/index.html
```

Required output: clean status, one recorded full commit, and Privacy V2 exactly
`b57979f99f7176b7d83d7d9efad9893fb87605c2f51511ced79982675f98a06b`
at 19,935 bytes.

Run the exact release command and retain its final JSON:

```sh
npm_execpath=/opt/homebrew/lib/node_modules/npm/bin/npm-cli.js SITESOURCERY_PG_CORE_RELEASE_ADMIN_URL=postgresql://fantaseamac@localhost:5432/postgres /private/tmp/sitesourcery-node-24.18.0/node-v24.18.0-darwin-arm64/bin/node scripts/core-release.mjs
```

Required result: PostgreSQL 16, 53 migrations, 4 Custom-services journeys, 5
Alakazam core journeys, 10 lifecycle journeys, 3 billing journeys, and
`databaseAbsent:true`, followed by 699 main Node tests, 19 self-host tests, 444
hosted-service passes plus 5 intentional skips, 52 ops tests, 76 Pages files,
45 browser route/width checks and zero failures.

### B. Privacy and Website Terms owner sign-off

Privacy content approval is already retained without guessing a release time:

```text
Owner-approved Privacy V3 review SHA-256 1fdc50606115e31e61aad1063e724949f0e2efb3444aaba775a7db9c14523a14 at exactly 25,994 bytes; content seal b040ee6c95830b732e18859eec6fe5ddfec56325e7357269fc5f0f14e6861d92.
```

Then rule on WT-01 through WT-12 in
`ops/SITESOURCERY-WEBSITE-TERMS-V3-ENGINEERING-REVIEW-2026-08-08.md`. After the
approved edits are rendered, record a second approval naming their exact SHA
and byte count. Preserve both V2 archives byte-for-byte.

The finalizer runs only when the real cutover window is known. Use the actual
UTC publication instant for `effectiveAt`; do not use review date or approval
date as a substitute. The version date must equal that UTC date. If publication
occurs on 2026-08-09 UTC, use `SS-HOSTED-PRIVACY-2026-08-09-V3`.

### C. Private Stripe TEST walk

This section is executed only on the privately staged exact final hash.
Production remains held.

Provider configuration must report deployment `staging`, `livemode=false`, a
test key, pinned API version, automatic tax, exact return origins, and exact
webhook secret. The runtime's provider mode is named `approved_live` in source
because it permits real provider calls; staging still requires
`SITESOURCERY_STRIPE_LIVEMODE=false` and an `sk_test_` key.

Lift only these staging-purpose controls:

- `SITESOURCERY_DOWNLOAD_PAYMENT_MODE=approved`
- `SITESOURCERY_CUSTOM_SERVICES_ASSESSMENT_PAYMENT_MODE=approved`
- `SITESOURCERY_CUSTOM_BUILD_PAYMENT_MODE=approved`

Keep change-order payment, final payment, domain purchase, Alakazam, and tenant
publication held unless their separately named test is being run. Never print
the key or webhook secret.

On the owner Mac, then Pixel, complete and record:

1. public `/custom/` → `/contact/` inquiry wording; no public Checkout;
2. registration, delivered activation, secure-cookie sign-in, new project with
   the exact three-document acceptance, sign-out/sign-in, and project reopen;
3. assessment request → owner quote → customer acceptance → exact $200 plus
   automatic-tax Stripe Checkout → webhook/readback → paid invoice/receipt;
4. delivered assessment and same-project $200 Custom credit;
5. owner Custom quote with a variable amount → customer acceptance → exact
   first installment and credit → Stripe Checkout → readback → open job;
6. a separate retained editor project → exact $5 quote → Stripe Checkout →
   entitlement → exact HTML bytes → repeat Download without a second charge;
7. a failed/expired Checkout retry and one duplicate webhook, proving no second
   charge or entitlement; and
8. owner queue, invoice, payment, job, and handoff views at Mac desktop and
   Pixel phone width, with no provider ID, secret, password, card number, CVV,
   or cross-customer record in the browser.

Record Stripe object IDs only in the private evidence vault. The repository
receipt contains redacted IDs/digests and exact amounts, not secrets or card
data.

After the TEST walk, return all three staging payment-purpose controls to
`held` unless the private staging session must remain open for a named retest.

### D. Owner GO/NO-GO record

The owner record must name:

- exact final Git hash and artifact receipt hashes;
- exact Privacy and Website Terms versions/digests/bytes/effective UTC;
- private-staging and Stripe TEST receipt IDs;
- backup/restore and monitor evidence IDs;
- Dell public A and optional AAAA targets;
- the exact previous release and four GitHub Pages rollback A records;
- `GO_CONTROL_HOST_EDGE=yes|no`; and
- `GO_STRIPE_LIVE_COMMERCE=yes|no`.

`GO_CONTROL_HOST_EDGE=yes` with `GO_STRIPE_LIVE_COMMERCE=no` may expose the
account/control site while every payment remains held, but it is not a
first-dollar release. A first-dollar release requires both decisions and the
production live-mode readiness proof. Stripe TEST mode must never be exposed as
if it were real commerce.

## J-11 cutover sequence — owner-gated, not executed

### 1. Install without changing the live pointer

Install the final hash into a new immutable release directory. Do not overwrite
the previous release. Build and verify `_hosted` inside that directory with
Node 24.18.0. Record owner/group/modes and file hashes. Install migrations
48–52 and 101 only after the final legal tuple is sealed and a backup succeeds.

Do not down-migrate. Migration rollback is restore-to-isolation plus a separate
owner decision.

### 2. Prove loopback before edge

On Dell, require these responses from the new release before changing Caddy or
DNS:

```sh
curl -fsS http://127.0.0.1:8788/api/v1/health
curl -fsS http://127.0.0.1:8788/api/v1/ready
curl -fsS http://127.0.0.1:8788/api/v1/capabilities
curl -fsS http://127.0.0.1:8899/
curl -fsS http://127.0.0.1:8899/abracadabra/app/
```

Health/readiness must be 200. Capabilities must match the owner's exact GO
record. Alakazam, domain purchase, and tenant publication remain false.

Run backup, clean-room restore verification, and monitor before edge activation.
If any is red or ambiguous, stop.

### 3. Prove Caddy and network while DNS still points to GitHub Pages

The dedicated Caddy binary must be exactly 2.11.4 with the pinned identity in
`ops/production-rehearsal/README.md`. Validate the exact final Caddyfile. Use a
disposable control hostname and ACME staging. Prove:

- public IPv4 and any published IPv6 reach TCP 80 and 443 on Dell;
- UFW and forwarding expose only 80/443 for Caddy;
- `/api/*` reaches 127.0.0.1:8788 and has `Cache-Control: no-store`;
- static routes serve only the exact `_hosted` root;
- `/_sitesourcery/*` returns 404 publicly;
- unknown customer hosts cannot obtain a certificate;
- the control host never reaches tenant port 8080; and
- tenant hosts never receive the control artifact.

If Dell lacks a stable reviewed public address or forwarding path, stop. Do not
point DNS at a private or unproved address.

### 4. Lift holds in exact order

1. Seal and install legal authority; apply migrations; prove project creation
   with the exact bundle. This lifts only the legal/project-creation hold.
2. Keep tenant publication, Alakazam, domain purchase, Responder, and every
   unrelated provider held.
3. If `GO_STRIPE_LIVE_COMMERCE=yes`, install the separately approved production
   `sk_live_`/live webhook configuration, require `livemode=true`, run readiness,
   and lift only Download, assessment, and first Custom-build payment modes.
   Otherwise leave all payment modes held.
4. Create `/etc/sitesourcery/PUBLICATION_APPROVED` with the owner approval
   record, then remove `/etc/sitesourcery/PUBLICATION_HOLD`. This lifts only the
   dedicated control-host edge gate.
5. Start the dedicated Caddy service and repeat same-origin TLS/API/static
   checks against the server address before DNS.
6. Replace the four apex A records only after step 5. Publish an AAAA record
   only if its independent IPv6 path passed. Do not change `sitesourcery.me`,
   wildcard records, MX, SPF, DKIM, DMARC, or nameservers.

### 5. Immediate post-cutover proof

From a network outside Dell/HQ and from the owner Pixel:

```sh
dig +noall +answer sitesourcery.com A sitesourcery.com AAAA
curl -fsSIL https://sitesourcery.com/
curl -fsS https://sitesourcery.com/api/v1/health
curl -fsS https://sitesourcery.com/api/v1/ready
curl -fsS https://sitesourcery.com/api/v1/capabilities
```

Verify the certificate hostname/chain/expiry, HSTS, Referrer-Policy,
X-Content-Type-Options, X-Frame-Options, Permissions-Policy, 15 routes, account
activation/recovery, one exact owner-approved payment if commerce is live, the
database receipt, monitor, backup schedule, and alert path. Never use a real
charge merely to prove a TEST-only release.

## Rollback decision and five-minute operator actions

Rollback immediately for TLS/route failure, widespread 5xx, wrong artifact,
legal version/digest drift, cross-tenant exposure, payment ambiguity, duplicate
effect, database readiness loss, failed backup/monitor, or owner command.

### Application or artifact rollback: target under five minutes

1. Set Download, assessment, and Custom payment-purpose modes to `held`; restart
   the runtime. Do not retry any ambiguous Stripe effect.
2. Point the release pointer to the previous already-audited immutable release;
   do not rebuild.
3. Restart the hosted runtime, validate the Caddy config, then reload Caddy.
4. Require loopback health/readiness, expected held capabilities, public root,
   and public `/_sitesourcery/*` denial.
5. Leave the migrated database intact. A later application may ignore additive
   tables; do not run reverse SQL. Reconcile any post-cutover legal/payment row
   before another attempt.

These are under-five-minute operator actions when both releases are already on
Dell. The owner must rehearse and time them before GO.

### Edge or host rollback

If Caddy/Dell itself is unhealthy, issue the DNS rollback immediately:

- restore apex A `185.199.108.153`;
- restore apex A `185.199.109.153`;
- restore apex A `185.199.110.153`;
- restore apex A `185.199.111.153`;
- remove only the newly added Dell apex A/AAAA records;
- do not change nameservers or mail records.

Then stop/hold the dedicated Caddy edge and leave loopback services available
for diagnosis. DNS edit submission can occur within five minutes, but the
observed TTL is 1800 seconds; cached global recovery cannot honestly be
guaranteed in under five minutes. The immediate under-five-minute safety path
is therefore the already-installed previous release behind the same Caddy
edge. DNS is the second fallback.

### Database or provider rollback

- Database: hold all writes affected by the fault, retain the current database,
  verify the newest encrypted backup, restore into a fresh isolated database,
  compare invariants, and obtain a separate owner decision before switching.
- Stripe: hold new Checkout creation, process verified webhooks/readback,
  reconcile exact existing Sessions/PaymentIntents, and never blindly submit a
  second effect.
- Mail: hold new registration/recovery delivery if receipt certainty is lost;
  do not expose action tokens.
- Legal: keep versioned artifacts and acceptance receipts immutable. If current
  legal authority is uncertain, hold new project creation while existing reads
  and recovery stay available.

## Stop point

This runbook stops at the owner gate. It is ready for review, but the current
candidate is not deployable or first-dollar ready until the hard-stop list is
closed and the owner supplies the exact GO record.
