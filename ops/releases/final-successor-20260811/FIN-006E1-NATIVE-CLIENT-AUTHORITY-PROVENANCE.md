# FIN-006E1 native-client authority provenance

Date: 2026-08-15
State: proved backend subcohort; native clients and FIN-006 remain active
Candidate branch: `integration/final-successor-20260811`

Proved implementation commit:
`288c89bae1c8595fa343ab35f8a4432daabafb1c`

Implementation tree: `d69a7c030c881dd1631e4f6d023902e52976c86d`

## Authority and scope

- The read-only native-source inventory found no prior Site Sourcery iOS or
  Android implementation to recover. FIN-006E1 therefore adds only the shared
  hosted device/token authority required by both future clients; it does not
  claim either application exists.
- The backend reuses the proved hosted identity/session/CSRF, organization,
  project, Responder, STOP, forwarding, reconciliation, and PostgreSQL
  authorities. It creates no second identity or Responder backend.
- The accepted registration platforms are iOS and Android. iOS is the first
  client to build. PushKit and CallKit remain restricted to an actual
  server-authorized VoIP lifecycle; carrier commands, silent carrier SMS,
  provider sends, and app distribution remain absent and held.
- Capabilities distinguish `backendReady` from `clientsReady`. The backend is
  locally proved while both client artifact flags remain false and aggregate
  complete-Responder readiness remains false.

## Implementation

- Migration 137 adds organization-scoped native commands, installations,
  sealed push-token registrations, and append-only state-transition evidence.
  All four relations use forced RLS, exact service-role select/insert-only
  grants, customer/tenant trigger authority, revision fencing, semantic replay,
  and five independently false effect columns.
- Push tokens are purpose-separated, keyed, versioned HMAC references plus
  AES-256-GCM ciphertext. AAD binds tenant, customer, project, installation,
  platform, application, environment, purpose, key version, and token digest.
  Raw APNs/FCM tokens never enter projections, logs, command facts, or evidence.
- Customer routes list/create installations, seal and rotate push tokens,
  suspend at logout, resume the same installation after login, revoke
  terminally for customer request/device loss/token compromise, and expose a
  universally held VoIP-session boundary.
- Logout is reversible suspension rather than destructive revocation. The same
  APNs/PushKit token can safely resume for the same customer and installation;
  cross-tenant token reassignment remains denied. Device-loss and compromise
  revocations remain terminal.
- Storage readiness verifies the exact migration contract, four-table forced
  RLS, current/prior key coverage, service-role select/insert-only access, and
  denial for public/anonymous/authenticated roles. Any effective ACL expansion
  fails readiness and `/capabilities` closed.
- Root startup requires both PostgreSQL repository readiness and token-key
  authority readiness. `/capabilities` reports a mounted, sealed,
  backend-ready/apps-unbuilt boundary without claiming iOS or Android artifacts.

## Changed paths

- `server/data-plane/supabase/migrations/202608140137_responder_native_client_authority.sql`
- `server/data-plane/tests/migration-verification-inventory.mjs`
- `server/data-plane/tests/postgres-migration-structure.test.mjs`
- `server/data-plane/tests/responder-native-client-postgres-proof.mjs`
- `server/data-plane/tests/verify-empty-postgres-migrations.mjs`
- `server/hosted/bin/server.mjs`
- `server/hosted/http.mjs`
- `server/hosted/responder-native-client-contract.mjs`
- `server/hosted/responder-native-client-http.mjs`
- `server/hosted/responder-native-client-postgres.mjs`
- `server/hosted/responder-native-token-authority.mjs`
- `server/hosted/test/http-capabilities-snapshot.test.mjs`
- `server/hosted/test/http-commerce-v2.test.mjs`
- `server/hosted/test/http-responder-composition.test.mjs`
- `server/hosted/test/responder-native-client-http.test.mjs`
- `server/hosted/test/responder-native-token-authority.test.mjs`
- `server/hosted/test/responder-production-composition.test.mjs`
- this provenance record and `BUILD-LEDGER.md`

## Adversarial and PostgreSQL proof

- The focused migration, token, HTTP, root, production-composition, and
  capability matrix passed 104/104.
- Bounded review found three material issues before sealing: terminal logout,
  optimistic client capability claims, and ACL-blind readiness. All three were
  corrected before the implementation commit. The final seal review then
  found that ACL readiness still omitted direct `TRUNCATE`, `REFERENCES`, and
  `TRIGGER` grants to anonymous/authenticated roles. The exact privilege set,
  a real authenticated-`TRUNCATE` drift/recovery proof, and a capability
  fail-closed regression were added; the bounded re-review returned clear.
- A fresh PostgreSQL 16 verifier applied all 90 migrations. The native journey
  passed its frozen 11/11 gates with one installation, two sealed tokens, three
  state transitions, six commands, and zero provider, push-delivery, Voice,
  carrier-command, or message-send effects.
- The real journey proves same-command and semantic replay, independent
  tenant-scoped command IDs, global cross-tenant token-reassignment denial,
  iOS notification and VoIP token sealing, stale-revision rejection, deferred
  evidence FKs, append-only guards, logout suspension, same-token resume,
  terminal device-loss revocation, exact ACL drift failure, and digest-only
  readback.
- The verifier reported `databaseAbsent true`; no disposable Site Sourcery
  database or proof browser remained.

## Clean cumulative proof

The clean implementation commit completed the cumulative ladder under Node
24.18.0 and npm 11.19.0:

- Node/product matrix: 880/880 passed;
- hosted/service matrix: 1,039 passed, zero failed, 14 intentional
  no-database skips;
- operations matrix: 205/205 passed;
- Pages artifact: 90 explicitly reviewed files rebuilt and verified;
- hosted artifact: rebuilt and HTML-validated; and
- browser audit: 15 current hosted routes at 320x720, 390x844, and 1440x1000,
  including the paid-change/handoff journeys, keyboard activation, overflow,
  focus, and 44px controls.

The first sandboxed run could not bind six loopback browser fixtures. The
unsandboxed clean run reached the final browser audit, where one bounded
navigation timed out once; rerunning only that unchanged audit on the same clean
SHA passed all 45 route/viewport cases. Neither environmental failure is
counted as proof.

## Effects and remaining work

- Public Pages, DNS, Cloudflare, carrier settings, Twilio/APNs/FCM APIs, phone
  numbers, calls, messages, Stripe, mail, HQ, Dell, protected databases,
  deployment, App Store, Play Store, and cutover were untouched.
- FIN-006E1 is complete as a held local backend prerequisite. It does not make
  the iPhone or Android application complete and does not receive separate
  denominator points while FIN-006 remains open.
- The next bounded slice is the actual iPhone source in
  `clients/responder-ios/`, consuming this exact authority. Full iOS build,
  signing, simulator/device, APNs, and Twilio SDK proof require an installed
  iPhoneOS toolchain and later evidence-gated account inputs. Android follows
  against the same backend after the iPhone slice.
