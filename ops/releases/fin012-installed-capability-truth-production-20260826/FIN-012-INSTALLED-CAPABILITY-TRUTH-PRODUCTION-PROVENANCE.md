# FIN-012 installed-capability-truth production provenance

Recorded: 2026-08-26T10:46:10-0400 EDT
State: exact correction live; matrix v2 installed; every external effect held;
evidence review pending

## Exact release identity

- Candidate: `420bd8a424da3331514723d40b5be9fb5131dfe3`
- Candidate tree: `b118539b060254c663cb55325a8ec4a12d8ed24c`
- Candidate PR: #43
- Review control: `be876c2389ab51c001489f7bcc88ba79ef05cfe0`
- Protected control/main: `36485462e2db4e9c81a47b0e085aa42ba2755193`
- Protected control tree: `2ebd1a93532ee67b0615d43e7215442d79914e97`
- Control PR: #44
- Production epoch: `fin012-installed-truth-420bd8a-20260825`
- Release binding:
  `fd573d9b422897875a750ef2379b55a64e0797d198c8be03fee7ed616189cf8c`
- Machine receipt SHA-256:
  `04e549df337cfc4a89f10939d5582c6a0265dcc10db3f96a3c7cf9305be7454d`

Candidate PR Site Quality run `32900086321`, exact-candidate-main Site Quality
`32900750333`, and Controlled Pages `32900750298` passed. Control PR Site
Quality run `32901620664`, exact-control-main Site Quality `32902005918`, and
Controlled Pages `32902005927` also passed. Environment-held run
`32902397997`, attempt 1, passed the exact release in 5m05s and issued final
`verified_held` digest
`f5adb6ba6b059f42b1ca40e0b5bc6c0d96ac5c02bbcd1fcbda2d23001ba74e3a`.
Its canonical receipt has SHA-256
`86a252f819bf15f560cec01c33635931d59eb04c0f16362ad74adf3500fc46f7`.
Every capability, customer, provider, DNS, and deployment authority in that
held receipt is false. The separate guarded production authority recorded here
selected code only.

## Truth drift and exact correction

The live API and database were healthy on protected predecessor `64a4f5b...`,
but `/api/v1/ready` still embedded the historical FIN-006 candidate matrix.
That v1 projection falsely labeled all 20 production capabilities and all six
processes `not_installed` even though the installed epoch, units, database,
routes, backup, and monitoring proved otherwise.

The four-path candidate changes only the readiness truth projection and its
tests. Matrix schema `sitesourcery.capability-process-matrix/v2` distinguishes
release and installation state from effect state. It reports all 20 proved
capabilities and six proved process definitions installed and engineering-
ready; the answering hosted API active; PostgreSQL ready; the worker held and
not locally asserted; and external process liveness explicitly unasserted.
Every provider/customer effect remains held/static/internal and
`externalEffects=false`.

Before protection, the correction passed 10/10 focused cases, all 892
product/client cases, 1,085 hosted/service passes plus 15 intentional
PostgreSQL skips, the sandbox-denied Unix-socket cases independently 6/6, and
all 252 operations cases on pinned Node 24.18.0.

## Fresh backup and immutable staging

Two supervised backup invocations failed closed before snapshot creation
because a retained predecessor public-sweep receipt was `root:root` mode
`0440`. The exact repair changed only its group to `root:simtech`, retained
mode `0440`, and left content SHA-256 `cf1b7d43...` unchanged. Both failed
attempts remain visible in operational evidence.

The successful pre-cutover backup is attempt
`2026-08-25T221119291Z-33eca5ba-611d-46ca-a8dd-6a2a1fead360`, snapshot
`a1785437-28cc-4617-ba99-955f9f2b6785`, manifest SHA-256
`72275d9ba619cf1eea6ce46d2af92d28a2b84079f639ece1b2070969a7538add`.
Dell and Zen agree on app-state ciphertext `ec3ef53a...` and database
ciphertext `de2f3d0d...`. It retained exactly two ciphertexts, zero database
writers, before/after consistency, held provider egress, and empty plaintext
staging.

Release bundle SHA-256
`4d7102d0aa8e48aa95f981ac311b72ca1007a60f8556334c1b59d20aac05ace9`
installed the clean exact candidate into its own immutable release root. Its
118 hosted files are byte-identical to the predecessor artifact. Production
dependencies resolve under pinned Node 24.18.0.

Evidence generation first ran under root and Git rejected the repository's
owner as dubious. That failed-closed invocation wrote only its exact origin
input; the file is retained read-only as
`failed-root-seal-origin-release-input.json`. Evidence generation then ran as
the repository owner and froze six exact evidence files under root ownership.
No runtime or external effect occurred during the failed seal.

Immutable installed hashes include:

| Artifact | SHA-256 |
|---|---|
| Origin input | `5ef1eb9e9549749006d8d424874679f2b63a8c8c53dee7e1ce8d1aac7ee4429e` |
| Origin seal | `85966c2ee14edb6aae3da6d3036c3776537b30fcc42373d96c6aca6779a9ebc3` |
| Installed origin readback | `0363abf0411a7f89ccf7dc1b13d3150f9a85af8aad75b59b41580c04cb385066` |
| Final release epoch | `02d390a9e2ebb0d0db6dd21a58114ecd71eb216937d88d58e12b8835ecab7fd5` |
| Runtime stage receipt | `d334e365c866065b7fa4742f3a05627563c6170311b7d71d06f2c20088729b37` |
| Candidate environment | `e1fa5e6742b7da8a09ca9b6f9b7b797d76c119232bd85af79446d1547848950e` |
| Candidate wrapper | `656ed04dcc6f0da6d830530889b6de56dba47073eef38f4adf9608e56cec8902` |
| API unit | `104cbe65ec854281674b3781b81b11c8c24e457f35578937faf03b2b58b7d39d` |
| Static unit | `0b39d001962b54047ab78947279c2881d58d3229f75e0a0b0ac5400de21ff042` |

The staged environment retains 123 exact assignments and the existing
Download-only authority. It staged no migration and granted no public,
provider, payment, entitlement, DNS, publication, or customer authority.

## Code-only guarded cutover

The cutover preflight passed while the predecessor remained selected. The
guard then selected the candidate and issued receipt SHA-256
`10b6fb13946dfef88366c0ab6740a5db78ccba11eefdb5721abac2c7bab2b7c3`.
Local API, local origin, and public edge all bind exact candidate/tree, matrix
v2 SHA-256 `3419477a...`, 20 installed rows, six installed processes, 98
migrations, and `externalEffects=false`.

No migration or database mutation ran. Pre- and post-cutover database snapshot
receipts are `832267ca...` and `e4d247c8...`. Both prove PostgreSQL 16, 294
tables, schema `2b1034e6...`, row-count digest `851c302b...`, ownership
`d4d55db3...`, all 98 migrations with migration 145 latest, and no row loss.
Provider, payment, entitlement, DNS, publication, customer, and static-byte
effects are false.

Exact predecessor `64a4f5b...`, tree `7019779...`, its environment, evidence,
units, static artifact, and the paired encrypted restore remain retained.
This code-only rollback does not require a database restore. Retirement is not
authorized.

## Public, backup, and operational readback

Public-sweep receipt SHA-256
`b5c2b29acd9dd664c0776b9be2183a1a13e667face4b0b40824bb8d9a35496af`
proves exact bytes for 24 canonical routes, eight immutable legal versions,
five critical assets, all 14 legacy redirects, the branded 404, and the `www`
redirect. Static bytes did not change, so the prior green visual/customer
browser acceptance remains byte-applicable; this release changed only API
readiness truth.

Post-cutover backup attempt
`2026-08-26T001435566Z-f41f848f-b17c-4cdf-a509-e98f76d65c0e`, snapshot
`153c7978-2e6b-42e8-8259-88a9ed5c7e5c`, produced manifest SHA-256
`1314773bbe6c41d590063232343793dd0db7a96f1bbb326eabbd8af6c19c95c3`.
Dell and Zen agree on database ciphertext `e4acfddd...` and app-state
ciphertext `a4cf6622...`; the backup has exactly two ciphertexts, zero database
writers, before/after verification, held provider egress, and empty plaintext
staging.

All five production services and both backup/monitor timers are active. The
explicit monitor readback at `2026-08-26T14:43:35.000Z` passed backlog,
backup, certificate, database, disk, and runtime, had no alerts, required no
delivery, and kept provider egress held. Public readiness remained exact on
candidate `420bd8a...`, matrix v2 installed, and
`externalEffects=false`.

## Effect posture and irreducible remaining gates

This release caused only the reviewed runtime identity selection. Database
migration/mutation, provider read/mutation, Checkout creation or retry, card
entry, charge, payment, entitlement, DNS, publication, customer mutation, and
operational mail are all false. The one prior expired/unpaid Download Session
remains reconciled once and must never be retried or duplicated.

Publication and worker engineering are installed and held, not unfinished.
The remaining gaps require external evidence, owner-scoped authority, or real
elapsed time:

- Twilio has no configured CLI profile or credential evidence.
- The D&B request submitted August 21 remains under review; no D-U-N-S issuance
  evidence exists.
- Spaceship consent is complete, but live credentials, exact provider price
  and final charge, disclosure, scoped approval, and reconciliation evidence
  are absent.
- Native clients are built unsigned; organization enrollment, signing, and
  store distribution are absent.
- Every Stripe purpose other than the already-approved Download boundary
  remains held.
- The 24-hour, seven-day, and retained 30-day stabilization checkpoints can be
  earned only by elapsed monitor/backup evidence; no agent can accelerate
  them.

This closes the installed-capability-truth correction through live production
readback. Protected review of this evidence-only closeout is the next
repository gate. Rollback, backups, monitoring, and every unreleased external
effect remain retained and held.
