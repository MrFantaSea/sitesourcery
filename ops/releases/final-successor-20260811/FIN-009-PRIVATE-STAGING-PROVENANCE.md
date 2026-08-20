# FIN-009 immutable private staging provenance

Date: 2026-08-20
State: private staging accepted and held; owner push acceptance pending
Branch: `integration/final-successor-20260811`

Candidate commit:
`26b07202d91000b9a7ae0de36471c7979f9482a1`

Candidate tree:
`00f648e39931a3e62445bc6c1d441087c69a8136`

Control commit:
`804b9a57922f14eed673fe5a1b66a8f42afad4ce`

Control tree:
`7be00a5a9ab783a30d834470380dcd0ef84ac8ee`

Machine-readable receipt: `fin009-private-staging-receipt.json`, SHA-256
`6a06463eb8b29c57c26c5902044600ae2d705b20805213ba87b9827a2be90e07`

## Blocker found and corrected

Exact live readback caught one release blocker before push: the sealed Legal
V5 finalization existed, but the default Pages and hosted builders still
selected V2 as current. The immutable Privacy V5 URL therefore returned 404 in
private staging. Candidate `26b0720` integrates the sealed V5 plan into both
default builders, retains immutable V2/V3/V4 versions, emits exact V5 current
and versioned artifacts, corrects lexical artifact ordering, and adds focused
regression coverage. The focused suite passed 19/19.

Privacy V5 is 31,316 bytes at SHA-256
`5660b786497c3d7a7399f8fdba239e23765a1d5a755e5e39c84e1a94e9c813c5`.
Website Terms V5 is 31,764 bytes at SHA-256
`8e80d65585e6adb10a838a08348e36876c616b01c9f1f632a12bc48ce674d38a`.
Both immutable URLs and both current URLs returned 200 from the exact private
TLS origin, and each current artifact matched its immutable version byte for
byte.

## Exact held release proof

The frozen successor input file SHA-256 is
`d37b42762426cb1f67bb4bc9bbb84f90ba96f25af19cdb55b33ccd0cbfdebcd3`;
its semantic binding is
`39def1060e5690b059df8448f67e9072d91a510db7e3ca4ff2f1db50196897f8`.
The full exact CI receipt is `verified_held`, digest
`367530bd60eb921f2ba9f69d8774437e707713c5b453b3d2064c83162db5c5b1`,
file SHA-256
`be9c443725ddc08da5f57c76c35f4a187cbc28ae880dc2bf50f8685d00b03302`.

The complete proof passed:

- 885/885 product tests;
- 1,080 hosted/service tests, zero failures, 14 intentional skips;
- 210/210 operations tests;
- deterministic 99-file Pages and 118-file hosted artifacts;
- 24 routes across six widths, 144 pinned-Chrome views; and
- all 95 migrations on fresh PostgreSQL 16, followed by exact database
  absence.

The 118-file installed hosted artifact is 7,564,499 bytes with manifest
SHA-256
`ffb5c97d8e2231a58f0199f9250ef2ce77dae38b4df0ff2532a50ee9bc92aead`.
Fresh installed-byte collection matched the seal. The final epoch, origin
seal, and installed readback file SHA-256 values are respectively
`935cb082bcc279bbb5361ff9997a2222bb1cc8313eeb2a1f43a3465cbb3c928c`,
`ee5be28b62ab0ba951e689a9dfbaed7a4a55bf7b7136b5b55be501aa827b3b47`,
and `f07adff3f67aafcbee0a83da785fb4c124d9c7b6fe3744cdc31830a3f2e7c77d`.

## Installed private staging

The exact release is installed at
`/home/simtech/sitesourcery-fin009/releases/26b07202d91000b9a7ae0de36471c7979f9482a1`
inside the existing `sitesourcery-fin009` namespace. Its private TLS endpoint
is `10.203.9.2:8443`; API, tenant, and static listeners remain loopback-only
inside that namespace. PostgreSQL remains Unix-socket-only. Namespace,
PostgreSQL, API, static, and TLS origin units are active; the external-effects
worker remains inactive, disabled, and held.

The API and readiness responses exact-match epoch
`fin009-26b0720-20260820`, the candidate/tree, 95-migration inventory, and the
successor binding. The seven-route journey passed root, customer app, operator,
Responder, Care, current Privacy, and immutable Privacy V5. Health, live,
ready, capability truth, Legal V5 authority, CSRF rejection, cross-origin
rejection, held recovery, and unauthenticated operator rejection all passed.
The held recovery emitted no mail and created zero provider receipts.

Database readback remained the exact FIN-008 successor snapshot: 287 tables,
canonical schema SHA-256
`de7a4d476899db85d0d4bf2e93c9f54210f39bc77c416586a8b960cf0e5a397a`,
row-count SHA-256
`9202ca42ecf31e03cf3669e92078a9bbe782e6250986c3b9bcb1d5fd61a1f015`,
and ownership SHA-256
`d78890529e36bfbc5e364c8dd710e3e2bebd89d28995ffa78c21c1cbeab8fca2`.
Every ownership, RLS, identity, lifecycle, and provider-hold invariant passed.

## Load, monitor, restart, backup, and rollback

The conservative private live sample completed 400/400 requests at concurrency
20: p95 51.491 ms, max 209.825 ms, 724.662 requests/second. This is staging
evidence, not an owner-approved production SLO. The separate standalone held
load/SLO contract also passed with receipt SHA-256
`3e3cb54c8d1c1e221276475e072726bd051f639a06471f003ce47f587965da3a`.

The actual private endpoint passed all four independent-monitor ports: apex,
exact immutable Privacy V5 content, trusted TLS, and exact release-identity
tunnel. Monitor telemetry SHA-256 is
`dced5091705d75e3978a4908befc909e149b898ac0ec68c47b7d0922d756c766`.
A current heartbeat passed; the same heartbeat beyond five minutes failed with
`DEAD_MAN_HEARTBEAT_STALE`. Provider alert delivery remained off. The private
certificate expires 2026-08-27 and carries no public authority.

A controlled API restart changed only the staging wrapper PID from 1279416 to
1280392 and returned exact ready identity. The production PID remained 1244689
before and after. The exact production predecessor artifact still contains 88
files and 6,521,301 bytes at manifest SHA-256
`b28ff784a9205096094a53a0fdbcedc5a20878b2b640e545cacd43ff61fd4359`.

The retained source-independent database backup is FIN-009 attempt
`fin009-33c0f6b-20260820T172854Z` on Zen. Candidate `26b0720` changes only
source/artifact builders, while live database readback retains the same exact
row-count digest proved by that backup and clean-room restore. The retained age
ciphertext is 3,771,018 bytes at SHA-256
`f1005eb0e7427f3d8058b07ef5e3fdf0d3bd97cc4eea9f59d88294744e4b45ce`;
no plaintext file remains.

## Held outcome

The live public placeholder remained byte-identical at SHA-256
`672d8ea082208c32c545d1bc7f01a077327a045eac236027531083e382584f9d`.
The protected HQ database, public production runtime, DNS, Cloudflare, Pages,
Stripe, Resend, Spaceship, Twilio, customers, and providers were not mutated.

FIN-009 is technically ready for the owner's push decision, but that decision
has not been inferred. The receipt deliberately records
`ownerAccepted=false`, `pushAuthorized=false`, and
`publicDeploymentAuthorized=false`. Stop here and request the green light.
