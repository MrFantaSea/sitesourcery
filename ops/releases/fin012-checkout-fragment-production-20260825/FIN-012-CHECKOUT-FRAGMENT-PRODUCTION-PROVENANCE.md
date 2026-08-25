# FIN-012 Checkout-fragment production provenance

Recorded: 2026-08-25T14:03:34-0400 EDT
State: production live; one expired/unpaid attempt reconciled without retry;
evidence review pending

## Exact release identity

- Candidate: `64a4f5b57c4e61a8449e7e79ed6f38f9fd8d7394`
- Candidate tree: `7019779cd8c524c4a70444b0ae01a9cf9b1d7e25`
- Candidate PR: #40
- Review control: `0e3934c0c9377e5f79230cee9ac7a3cd841edd92`
- Protected control/main: `900fdbe43013635ea1f0bf861b6ad56022522681`
- Protected control tree: `19993ba687bd19f41fff494612e049371a890b17`
- Control PR: #41
- Production epoch: `fin012-checkout-fragment-64a4f5b-20260824`
- Release binding:
  `f1adaa47f81f6259b4dad15d47fdb624c0bdf6ed8aa77d7d11b6ce50fe607663`
- Machine receipt SHA-256:
  `77fe7952e92808e0e9fae04245f871fe8e313701b7b107d5ebefce6cc334d693`

Held exact-release run `32793741361`, attempt 1, passed the complete candidate,
operations, browser, clean PostgreSQL 16, cleanup, and mutation-rejection proof.
It issued final digest
`1a26d200fd6c9757725404b1b2288af31f7cf3fbe2d3f5993261481785b9d665`.
The exact downloaded receipt has SHA-256
`1cb179f2106e39ddc611e168acb2a7f80953f42016322ac728937f6a01796e07`.
Every capability, customer, provider, DNS, and deployment authority in that
held receipt is false. Installation required the separate guarded live
authority recorded outside the held receipt.

## Root cause and repair

The one owner-approved live `$20` Download Checkout attempt failed closed
before card entry because Stripe's standard Checkout URL contains a
provider-owned fragment. Payment persistence and Download/Alakazam dispatch
constraints rejected fragments even though the provider adapter preserved the
provider URL.

The candidate retains exact HTTPS `checkout.stripe.com`, credential, port,
length, purpose, transition, and no-retry fences while allowing the
provider-owned fragment. Migration
`202608240145_stripe_checkout_fragment_authority.sql` also permits one exact
expired/unpaid tombstone with retained Session identity and null URL after
Stripe redacts the expired Session URL.

The protected candidate had already passed 108 focused cases, all 892
product/client cases, 1,084 hosted-service cases plus 15 intentional
PostgreSQL skips, the separately rerun six Unix-socket cases, 252 operations
cases, deterministic hosted proof, and a clean PostgreSQL 16 replay of all 98
migrations. An exact expired/unpaid redacted-URL tombstone inserted, read back,
and rolled back in that proof database.

## Backup, restore rehearsal, and guarded cutover

Pre-cutover supervised backup attempt
`2026-08-25T004625526Z-2697410e-7953-4183-8fc3-2ab6a2955a5e`, snapshot
`c973099b-32b8-459f-ae67-08b453175b86`, produced manifest SHA-256
`9fc22ea8677a2c0ad2574bd7063c913ed54bf2d75b69ec5da892c3ced5f1c7ce`.
It retained exactly two age ciphertexts, zero database writers, before/after
consistency, and no plaintext staging. A Zen age decrypt streamed directly
into a disposable Dell PostgreSQL 16 database. Migration 145 applied and
proved exact post-schema `2b1034e6...` without row-count change; receipt
SHA-256 is `d4664a41...`. The disposable database was dropped.

Two cutover attempts exercised the automatic rollback path before the final
success:

1. the first finalizer expected release identity at the wrong JSON level; and
2. the second used a Node fetch path that did not preserve the local origin's
   required `Host: sitesourcery.com` header.

In both cases the guard stopped the candidate, streamed the verified encrypted
database backup from Zen, restored exact predecessor schema `de401833...`, row
digest `851c302b...`, evidence, and user units, and returned predecessor
`984fa358...`/97 green at local, origin, and public probes. The two database
restore receipts are `053ec0eb...` and `18ad34be...`. No provider, payment,
entitlement, DNS, publication, or customer effect occurred during either
failed selection.

The Host-header transport was tested against the predecessor origin before the
third attempt. Attempt three then passed. Migration receipt SHA-256 is
`7d409ec6f9e091d43d2591868d403106b7608c5bf193b43d5e5cf8d1f0873d19`;
cutover receipt SHA-256 is
`4ce5816c362e5b7ca16602fcbcc316c16ebef32811a5a55489f7eb948a23a4a8`.
Local API, local origin, and public edge all bind the exact candidate, 98
migrations, migration 145, and `externalEffects=false`.

Installed immutable hashes include:

| Artifact | SHA-256 |
|---|---|
| Final release epoch | `2de832417d551bc498442db8f75707392b9351adef40a81f340474a21e613c52` |
| Origin seal | `3960d1676f316aae95965c54ec25f1e379fe12593b2620a07891b14c50f9ea22` |
| Installed origin readback | `74b204a6d0f4060473443dc48b0bba4e0b1f2e01f2527104f945534115af4ab7` |
| Candidate environment | `23ef7ee6675ab891b36a8d6e21c08d2bcb251bcba389ebd3bdb0229f2a549b57` |
| Candidate runtime wrapper | `0558db9d57d2622bcaae23eb7c86abbffe8d2891239b2b1662e640835d3cc487` |
| API unit | `79997f56e9bbf566806ab84e1db625083ec0a3fa593025a038f806eb7a4f8e73` |
| Static unit | `d6bd87d9c30c792ca37bc5ac165b00f0ced1696215c87bff367944409aa45a22` |

## One expired/unpaid Session closed without retry

Read-only provider inspection after migration 145 proved exactly one matching
live-mode Download Session. It was `expired`, `unpaid`, had no PaymentIntent,
and its URL was provider-redacted. The durable dispatch remained
`effect_unknown`; inspection receipt SHA-256 is `3dadcdde...`.

The migration-authorized reconciliation then updated only that exact dispatch
to the expired/redacted tombstone, retaining the original Session identity and
purpose. Apply receipt SHA-256 is `175f6bec...`. Independent final verification
receipt SHA-256 `0a50daf5...` proved:

- exactly one matching provider Session;
- provider state `expired` and payment state `unpaid`;
- no PaymentIntent and no Checkout URL;
- one durable `expired` dispatch with the exact tombstone schema;
- zero Stripe payment events;
- zero payment receipts; and
- zero project entitlements.

There was no retry, second Session, card entry, charge, payment, provider
mutation, or entitlement effect.

## Database and rollback readback

Final PostgreSQL readback is:

- PostgreSQL 16;
- 98 migrations, latest migration 145;
- 294 tables: one `auth`, 293 `ss`;
- schema SHA-256 `2b1034e6e9ef99e27d6941b07b1fb29f8dd4ecead3637ef498850ad877ce2189`;
- row-count SHA-256 `851c302b7dac8e0adb7420eb9fa16ee24b62e0352aa6b9c294f2f5fe45c29d23`;
- ownership SHA-256 `d4d55db3e00debc22be17abba30c3a85a1ab9941d6a98f8baadeeaec90c74d28`;
- every relation and routine owned by the database owner; and
- no row loss.

Exact predecessor `984fa3580b47dbdc645208d58898e68adaf46903`, tree
`34a19cda9958787f3d67d4ed78dd61d6d55586ec`, plus its evidence,
environment, wrapper, units, and paired encrypted database restore remain
retained. Database restoration is required to select that predecessor.
Rollback retirement is not authorized.

## Post-cutover backup and operations

Post-cutover supervised backup attempt
`2026-08-25T174022091Z-c0441466-48a1-426e-9a85-973ebe8c3097`, snapshot
`3c1bb4e2-fc56-4787-97e0-8794188fc751`, produced manifest SHA-256
`e8964a76db80e50fb17b0b93329bdba7ea16d5db936fbdce9baa06da12f973d1`.
Dell and Zen agree on database ciphertext `99465772...` and app-state
ciphertext `7eb7177d...`. The backup had exactly two ciphertexts, zero database
writers, consistency verified before and after, and empty plaintext staging.

The five production services and the backup and monitor timers are active. A
monitor run one second after the supervised backup finished observed runtime
unavailable and delivered one incident transition. The explicit follow-up at
`2026-08-25T17:47:20.736Z` passed backlog, backup, certificate, database,
disk, and runtime, delivered the matching recovery transition, and left no
active alert. The backup/monitor cadence overlap remains recorded operational
noise rather than being hidden.

## Public and browser verification

Final public-sweep receipt SHA-256
`cf1b7d43a84e43b3f4aa66de0f096f825b74868f36248ebf76aff09297e40bf6`
proves exact bytes for 24 canonical routes, eight immutable legal versions,
five critical assets, all 14 legacy redirects, the branded 404, and the `www`
redirect. Local API, local origin, and public edge readiness are exact.

Read-only browser inspection proved:

- Home renders the exact free-preview, `$20` Download, `$350` assessment, and
  held Responder/Domain language;
- the Abracadabra landing page renders the exact `$20` account/Download and
  held Alakazam boundary;
- the guest workroom reaches `Abracadabra ready`, enables all three looks and
  guest builder progression, and keeps account/payment actions unavailable to
  the guest; and
- the browser console contains zero warnings and zero errors.

No Checkout control was pressed during final browser verification.

## Effect posture and remaining gates

The only intentional database effects were migration 145 and the one exact
expired/unpaid tombstone. Provider readback was performed. Provider mutation,
retry, second Session creation, card entry, charge, payment, entitlement, DNS,
and publication are false. Operational mail consists of the one
backup-coincident incident and its matching recovery.

The `$20` Download activation and failed-attempt repair lane is closed by this
evidence. This evidence does not release every other payment purpose, live
Domains, Twilio/Responder transport, native distribution, publication, or any
rollback retirement. Those remain behind their separately recorded provider,
credential, spend, owner-decision, and external enrollment gates. Protected
review of this evidence-only closeout is the next repository gate.
