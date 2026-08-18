# FIN-006E2 Responder iPhone and held Voice provenance

Date: 2026-08-17
State: proved iPhone-source subcohort; Android and FIN-006 remain active
Candidate branch: `integration/final-successor-20260811`

Proved implementation commit:
`c72f866e628d76849c444b6564e44922c00cead4`

Implementation tree: `022a17789c9791a1dd4fcb3f001677656da3ba0f`

Input checkpoint:
`4354864daf66582b9e125a977d53af16dff0dd23`

## Authority and scope

- FIN-006E2 adds the first Site Sourcery native application source. The prior
  read-only inventory proved that there was no iOS or Android client to import.
  The app consumes the existing hosted identity, organization/project,
  forwarding, Responder, STOP, and FIN-006E1 native-installation authorities;
  it does not create a parallel backend or identity system.
- The supported customer architecture remains carrier-preserving conditional
  no-answer forwarding. The iPhone app never dials MMI/star codes, silently
  sends carrier SMS, changes the customer's carrier, or treats PushKit as a
  generic background-notification channel.
- Twilio Voice is the first replaceable managed VoIP transport. The server may
  issue a short-lived, incoming-only provider authorization only when its exact
  locally staged authority is verified. Issuing that signed authorization is
  reported separately as `providerAuthorizationEffects`; it does not place a
  call, deliver a push, send a message, or contact Twilio.
- External provider use, app signing/distribution, real-device testing, public
  deployment, DNS, and cutover remain held. Capability truth continues to
  report unsigned source/backend proof separately from released iOS/Android
  client artifacts.

## Hosted and PostgreSQL implementation

- Migration 138 makes existing E1 token history upgrade-safe, records
  append-only token retirements, permits one physical Apple token to serve the
  same customer across distinct project-scoped installations without allowing
  cross-customer reassignment, and adds immutable, replay-safe, expiring Voice
  session authority.
- Token collision checks examine every registration rather than an arbitrary
  first row. PostgreSQL serialization, exact customer/application/environment/
  purpose matching, project-scoped installation secrets, and retirement
  evidence preserve tenant separation and rotation history.
- Voice session issuance requires an active iOS installation, active VoIP
  token, current organization membership, exact revision, configured current
  key coverage, and an incoming-only Twilio grant. Stored sessions are sealed,
  immutable, digest-bound, expiration-bounded, and excluded from raw readback.
  Expired rows do not permanently pin obsolete encryption keys.
- The existing authenticated route
  `POST /api/v1/responder/projects/:projectId/native-installations/:installationId/voip-session`
  now uses the mounted Voice authority. Root startup and `/capabilities` fail
  closed on repository, token-authority, or Voice-authority readiness drift.
- Every provider, push-delivery, call, carrier-command, and message-send effect
  column remains false. Production defaults to held without staged Voice
  credentials.

## iPhone implementation

- `clients/responder-ios/` contains the SwiftUI application, exact HTTPS
  cookie/CSRF client, Keychain-backed installation identity and idempotency
  ledger, tenant/workspace selection, forwarding instructions, Responder
  inbox/actions, device state, ordinary APNs, PushKit, CallKit, and Voice
  lifecycle coordination.
- Registration, token rotation, invalidation/retirement, resume, suspension,
  revocation, and workspace replacement share one FIFO actor mutation lane.
  Concurrent APNs and PushKit callbacks therefore advance the server revision
  one operation at a time. A newer token is never erased by an older in-flight
  receipt, and cold-launch invalidation retains a durable retirement intent
  until the latest installation is loaded and reconciled.
- Voice authorization responses are fenced by workspace, installation,
  revision, token, and generation. Any APNs-purpose receipt that changes the
  installation revision re-runs Voice preparation when a current VoIP token
  exists. Workspace changes retire old Voice authority before installing the
  new one, even when Apple reuses the same token.
- Logout does not discard unresolved provider cleanup authority. Registration
  and unregistration use bounded retries while their short-lived credential is
  valid; stale callbacks are matched by both authority ID and token.
- Incoming Twilio notifications use the official SDK handler, retain the exact
  invite through synchronous CallKit reporting, bind PushKit completions to the
  originating notification, and activate the SDK audio device only through
  CallKit audio-session callbacks.
- The official package is pinned to Twilio Voice iOS `6.13.6`, Git revision
  `62912513388001394d093b85a6269bf3206cac13`, dynamic product `TwilioVoice`,
  and checksum
  `4e04fa2698e33a47d15293f4437b1416fccad29c6e168695295c090c661d8acb`.

## Changed path allowlist and excluded overlaps

- New client subtree: `clients/responder-ios/**`.
- New migration:
  `server/data-plane/supabase/migrations/202608160138_responder_native_voice_sessions.sql`.
- Hosted authority:
  `server/hosted/twilio-responder-voice-access.mjs`,
  `server/hosted/responder-native-client-postgres.mjs`,
  `server/hosted/responder-native-client-http.mjs`,
  `server/hosted/responder-native-token-authority.mjs`,
  `server/hosted/http.mjs`, and `server/hosted/bin/server.mjs`.
- Verification: migration inventory/structure/empty-PostgreSQL/native proof,
  Voice access, native HTTP/token, root composition, capability, and commerce
  fixture tests.
- Non-secret configuration documentation: `ops/hosted.env.example`.
- This provenance record and `BUILD-LEDGER.md` are the documentation-only seal.
- Existing forwarding, Twilio inbound/outbound transport, STOP, Responder core,
  fulfillment worker, commerce, number binding, carrier instruction, HQ phone
  bridge, Dell runtime, and public artifact implementations were reused or left
  untouched. Nothing was imported wholesale from another repository.

## Adversarial corrections

Bounded review found and cleared material issues before sealing, including:

- HTTP retry identity, same-token cross-project tenancy, E1 upgrade history,
  replay membership, and Voice-key retirement;
- cold-launch PushKit ordering, CallKit/SDK API exactness, durable unregister
  authority, capability teardown, receipt-to-command binding, workspace
  replacement, stale token/session responses, and APNs revision changes;
- simultaneous APNs/PushKit revision races and token invalidation racing an
  in-flight registration; and
- Xcode 26's split Debug dylib omitting a usable Twilio framework runpath.

The final correction uses one installation-mutation lane, preserves cold-launch
retirement evidence, sets `ENABLE_DEBUG_DYLIB=NO`, retains
`@executable_path/Frameworks`, and received a final `CLEAR` review.

## Focused, PostgreSQL, and native proof

- Focused migration/HTTP/token/Voice/root/capability proof passed 110/110.
- The frozen iPhone source/toolchain proof passed 12/12 with provider, carrier,
  and message effects false.
- Xcode 26.6 completed clean unsigned Debug builds for generic iOS Simulator
  and generic iPhone against the iOS 26.5 SDK. No signing identity, provisioning
  profile, Apple account, or device was used.
- Offline loader inspection of the exact implementation SHA found no
  `Responder.debug.dylib`; both simulator executable architectures link
  `@rpath/TwilioVoice.framework/TwilioVoice` and contain
  `@executable_path/Frameworks`. The embedded framework is a two-architecture
  simulator Mach-O. The exact app executable SHA-256 was
  `89ac331f8cad813459b55b73d9fce926d45c2b16c20c0995ebf6a7bb52ed79de`;
  the embedded Twilio framework SHA-256 was
  `d2920bf790d705148b899370760cb17bf61b31c2848a1f88c6ba7d1cbaba2e06`.
- One exact-artifact simulator launch returned PID 66631. It remained alive for
  22 seconds and rendered the Responder sign-in/create/recovery screen. The
  visible API-unavailable alert is truthful because the public site remains the
  intentional static placeholder and exposes no successor API. The inspected
  screenshot SHA-256 was
  `a3228fa799aa5b6b02f432f45da72aee332944ecb791065e3c983bf1b119c86e`.
  The app was then terminated, uninstalled, and the simulator shut down.
- A fresh PostgreSQL 16 verifier applied all 91 migrations. The E1 upgrade
  fixture passed 1/1 with two historical registrations, one retirement, and
  one active registration. The frozen native journey passed 17/17 with two
  installations, four tokens, three transitions, two token retirements, two
  Voice sessions, and ten commands.
- PostgreSQL proved same-command and semantic replay, concurrent fencing,
  same-customer cross-project token reuse, cross-customer denial, current
  membership on replay, revision fencing, active/expired key coverage, forced
  RLS/ACLs, ciphertext/AAD binding, digest-only projections, and zero external
  provider/push/call/carrier/message effects. It reported `databaseAbsent true`;
  a separate catalog query confirmed zero `ss_%` databases afterward.

## Clean cumulative proof

The clean implementation SHA completed the canonical Node 24.18.0/npm 11.19.0
matrix:

- Node/product matrix: 881/881 passed;
- hosted/service matrix: 1,044 passed, zero failed, 14 intentional
  no-database skips;
- operations matrix: 205/205 passed;
- Pages artifact: 90 explicitly reviewed files rebuilt and verified;
- hosted artifact: rebuilt and HTML-validated; and
- browser audit: 15 current hosted routes at 320x720, 390x844, and 1440x1000,
  including exact-width layout, keyboard activation, and 44px controls.

The first cumulative attempt was sandbox-blocked from binding six localhost
browser fixtures and is not counted. The exact same clean SHA then completed
the entire matrix with localhost-only test permission and zero failures.

## Effects and remaining work

- The public placeholder readback remains byte-identical at SHA-256
  `672d8ea082208c32c545d1bc7f01a077327a045eac236027531083e382584f9d`.
- Twilio, APNs, phone, carrier, message, mail, Stripe, DNS, Cloudflare, Pages,
  HQ, Dell, protected databases, deployment, signing, App Store, Play Store,
  and cutover were untouched. No real call, push, message, carrier command, or
  provider request occurred.
- FIN-006E2 proves the iPhone source, unsigned builds, and simulator runtime. It
  does not claim a signed/released App Store artifact, a real-device/APNs/Twilio
  journey, or Android.
- FIN-006 remains at 74 sealed denominator points because its seven points are
  atomic. The next bounded subcohort is Android against the same authority,
  followed by the final unified capability/process matrix.
