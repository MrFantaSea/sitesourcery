# FIN-006E3 Responder Android and held Voice provenance

Date: 2026-08-18
State: proved Android-source subcohort; FIN-006 remains active
Candidate branch: `integration/final-successor-20260811`

Proved implementation commit:
`95b32f346cc9bb57c99b20862c45acd736274cc2`

Implementation tree: `e85e245291293a2f80e9c3c25bfa69b974d091b5`

Input checkpoint:
`70733ebe5418c410a5ba8b83ae14e6dbf2328c5e`

## Authority and scope

- FIN-006E3 adds the Android Responder source against the already proved
  hosted identity, organization/project, forwarding, STOP, Responder,
  installation/token, and Voice authorities. It does not create a second
  backend, identity system, forwarding engine, or delivery worker.
- The supported launch architecture remains carrier-preserving conditional
  no-answer forwarding. The app never dials MMI/star codes, silently sends
  carrier SMS, changes carrier settings, or treats an ordinary incoming call as
  missed-call evidence.
- Twilio Voice is the first replaceable managed Android VoIP transport. The app
  uses ordinary FCM and the supported Android call surface only behind exact
  server-issued, short-lived authority. Provider configuration defaults false.
- Provider use, real push/call/message delivery, signing/distribution, Play
  Store release, public deployment, DNS, and cutover remain held. Capability
  truth separates the proved local backend/client source from a released
  Android artifact.

## Hosted and PostgreSQL implementation

- Migration 139 models one physical Android FCM token serving the distinct
  `notification` and `voip` purposes without weakening purpose-bound encrypted
  evidence. A purpose-neutral keyed ownership digest serializes physical-token
  authority; the existing purpose-bound lookup digest remains in the sealed
  envelope.
- A client-computable, tenant- and installation-scoped token receipt digest
  binds every new physical-token registration response to the exact submitted
  token. Same-command, semantic, and later readback replays return the original
  receipt rather than the current rotated token.
- Legacy migration-137/138 rows remain conservatively purpose-bound and
  decryptable with their exact v1 AAD. Re-observation creates receipt-bound v2
  evidence and retires the legacy row. Collision checks include both Android
  purpose-bound legacy candidates, preventing cross-customer reuse through the
  other FCM purpose.
- Android Voice sessions are bound to platform and transport. E3 uses explicit
  v2 request/envelope digests and v2 AAD. Migration 139 takes an exclusive
  Voice-session table lock and fails atomically while any E2 session remains
  unexpired, preventing a silent authority reinterpretation during upgrade.
- Repository readiness verifies the exact v2 token and Voice function ACLs,
  receipt constraint, platform/transport constraint, enabled guards, forced
  RLS, table privileges, key coverage, and held effect posture. Transactional
  drift tests prove these gates fail closed and recover only after repair.
- Every provider, provider-authorization, push-delivery, Voice-call,
  carrier-command, and message-send effect remains false in the proved
  PostgreSQL journey.

## Android implementation

- `clients/responder-android/` contains the Compose application, exact HTTPS
  cookie/CSRF API client, encrypted Android Keystore-backed authority and
  idempotency state, tenant/workspace selection, forwarding instructions,
  Responder UI, FCM registration, Twilio Voice coordination, and Core Telecom
  call presentation.
- Native installation mutations run through one serialized lane. Concurrent
  token callbacks, invalidation racing an in-flight registration, cold-start
  retirement, suspension/resume, and workspace replacement reconcile from the
  latest server revision without re-registering a retired token.
- Registration receipts are accepted only when their command and scoped token
  receipt digest match the exact request. Short-lived Voice command identity
  may be renewed only after an exact validated expiry response; ordinary
  mutation idempotency remains stable.
- Voice cleanup persists the old provider-binding authority across process
  death and workspace/token rotation. The incoming gate closes before token,
  permission, logout, or workspace mutation and reopens only after exact
  current provider registration and permission checks.
- Incoming invitations and notification/Telecom actions carry an exact permit
  and call-generation UUID. Answer, decline, end, SDK callbacks, foreground
  service actions, and quiesce are phase- and generation-fenced; a stale or
  duplicate surface cannot control or tear down a newer call.
- Wrong-account or conflicting recovery scope takes the authentication-only
  sign-out path, revoking the current session while preserving the prior
  installation/Voice recovery authority. Full cleanup is attempted only for
  one congruent owning actor.
- The merged Debug and Release manifests are executable proof inputs. Both
  freeze the exact permission tuples, Bluetooth max-SDK bounds, exported
  components, signature permission, disabled backup/cleartext, and disabled
  Firebase auto-init/analytics posture. Installable Debug has no tooling-only
  exported activity.
- Toolchain and provider pins include AGP `9.3.1`, Kotlin `2.3.21`, Gradle
  `9.5.0` with checksum
  `553c78f50dafcd54d65b9a444649057857469edf836431389695608536d6b746`,
  Android compile/target SDK 36, Twilio Voice Android `6.10.4`, Core Telecom
  `1.0.1`, Firebase BoM `34.17.0`, and Compose BoM `2026.06.00`.

## Changed path allowlist and one coupled expansion

- New client subtree: `clients/responder-android/**`.
- New migration:
  `server/data-plane/supabase/migrations/202608170139_responder_android_voice_authority.sql`.
- Hosted native/Voice authority, root composition, non-secret environment
  example, migration inventory, PostgreSQL proof, and bounded HTTP/capability
  tests are the same declared FIN-006E3 seams.
- `server/hosted/test/http-commerce-v2.test.mjs` is the sole path added beyond
  the checkpoint allowlist. Its one-line expected capability fixture now
  includes truthful `voipTransports: []`; no commerce behavior changed.
- Existing iPhone source, forwarding, Twilio inbound/outbound fulfillment,
  STOP, Care, Domains, adjacent systems, public source, deployment, HQ, and Dell
  paths were reused or left untouched.

## Adversarial corrections

Bounded review found and cleared material issues before sealing, including:

- cross-purpose FCM ownership, client-verifiable receipt binding, legacy
  ciphertext/AAD compatibility, and migration-time active-Voice draining;
- exact readiness coverage for v2 functions, constraints, triggers, RLS, ACLs,
  and receipt posture;
- concurrent token/invalidation ordering, process-death recovery scope,
  provider binding versus short-lived credential identity, and sign-out cookie
  retention on failure;
- permission-generation races, stale Voice authorization responses, provider
  teardown before native suspension, and wrong-actor recovery lockout; and
- duplicate/cross-surface call actions, quiesce-versus-accept races, stale
  service intents, and debug/release manifest authority drift.

The final bounded Android, backend, and pre-seal reviews all returned `CLEAR`.

## Focused, PostgreSQL, build, and runtime proof

- Focused migration/token/Voice/HTTP/root/capability proof passed 106/106.
- A fresh PostgreSQL 16 verifier applied all 92 migrations. The retained E1
  history proof passed 1/1, the E3 migration/legacy/AAD/drain proof passed 3/3,
  and the frozen native/Voice journey passed 23/23. It proved dual-purpose FCM,
  receipt-bound replay, legacy re-observation, cross-tenant and cross-purpose
  denial, platform/transport authority, current membership, key coverage,
  revision fencing, ACL/RLS drift, digest-only projections, and zero external
  effects. It reported `databaseAbsent true`; a final catalog query found zero
  `ss_%` databases.
- The clean Android ladder passed 23/23 unit tests, lint with warnings treated
  as errors, exact Debug and Release manifest gates, and Debug plus unsigned
  Release assembly. The requested in-flight-registration versus invalidation
  race was re-run after final formatting and passed.
- Final Debug APK SHA-256:
  `b1cfd71118f42b6b68950d699c8beb28c92c27758ba91324f94bb863cd5ee824`.
  Final unsigned Release APK SHA-256:
  `30345de9183faf0889a5d8f96befc8bd3a5c9efedf57e55b4b5158ae87dac4f5`.
  Debug/Release merged-manifest SHA-256 values are respectively
  `ad6294f74fadb963d08327c980bce0df26ce73c0ef3220439680d3c01bc6fb5b`
  and
  `2a08527ddf1be2a3a38e42de0903aaaa2522f5123cc7007a57c0275f7fccb987`.
- The exact final Debug APK was installed on a fresh ARM64 API 36 / Android 16
  Pixel 9 emulator. Package `com.sitesourcery.responder.debug`, version
  `1.0.0-held`, target SDK 36 cold-started successfully; PID 6791 remained
  alive beyond 20 seconds with `MainActivity` top-resumed and no fatal/crash
  signature. RECORD_AUDIO, POST_NOTIFICATIONS, and BLUETOOTH_CONNECT were all
  denied/ignored.
- The visually inspected screen rendered the Site Sourcery Responder sign-in,
  create, and recovery surface plus the exact truthful safe-setup statement:
  the existing carrier stays in place and no call, text, or carrier command is
  automatic. The clean screenshot SHA-256 is
  `e676dbcfeece3c74bbc4cc28e7f3a7e1b053e4adb0d94bd595cb0ac358246e6b`.
  The initial API-unavailable alert was expected because the intentional public
  placeholder does not expose the successor API. The app was force-stopped,
  uninstalled, its three emulator screenshots removed, the emulator deleted,
  and ADB stopped.

## Clean cumulative proof

The clean implementation SHA completed the canonical Node 24.18.0/npm 11.19.0
matrix:

- Node/product matrix: 882/882 passed;
- hosted/service matrix: 1,049 passed, zero failed, 14 intentional
  no-database skips;
- operations matrix: 205/205 passed;
- Pages artifact: 90 explicitly reviewed files rebuilt and verified;
- hosted artifact: rebuilt and HTML-validated; and
- browser audit: 15 current hosted routes at 320x720, 390x844, and 1440x1000,
  including exact-width layout, keyboard activation, and 44px controls.

The first cumulative attempt was sandbox-blocked from binding six localhost
browser fixtures and is not counted. The permitted retry reached the operations
matrix and correctly failed four Git-identity seals while implementation bytes
were still dirty. After the atomic implementation commit, the same clean SHA
completed the entire ladder with zero failures.

## Effects and remaining work

- The public placeholder remains byte-identical at SHA-256
  `672d8ea082208c32c545d1bc7f01a077327a045eac236027531083e382584f9d`.
- Twilio, FCM, phone, carrier, message, mail, Stripe, DNS, Cloudflare, Pages,
  HQ, Dell, protected databases, deployment, signing, Play Store, and cutover
  were not mutated. No real call, push, message, carrier command, provider
  request, public write, or deployment occurred.
- FIN-006E3 proves Android source, unsigned builds, exact manifest authority,
  and API 36 emulator runtime. It does not claim a signed/released Play artifact,
  a real Android device, or a real FCM/Twilio call journey.
- FIN-006 remains at 74 sealed denominator points because its seven points are
  atomic. The next bounded work is the remaining unified capability/process
  matrix and composed all-held trace; FIN-007 does not begin until FIN-006 is
  sealed.
