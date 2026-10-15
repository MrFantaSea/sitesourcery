# Responder native incoming Voice routing

This extends the existing hosted API and iPhone/Android clients. It introduces
no new listener, queue, service, carrier command, or outbound calling grant.
Production activation and real-device acceptance are separate from source
qualification. The default remains held.

## Client contract

`GET /api/v1/capabilities` adds three fields to `responderNativeClient`:

| Field | Held or unavailable | Native routing configured and ready |
| --- | --- | --- |
| `voiceRoutingMode` | `held` | `verified-native-client` |
| `routingReady` | `false` | `true` |
| `operationalCalls` | `false` | `true` |

An explicitly configured native mode can remain `verified-native-client` while
either readiness flag is false. The mode alone never authorizes a call.

New SDK registration and incoming-call admission require the native mode and
both booleans, plus the existing mounted/backend-ready, verified Voice-session,
and provider-authorization checks. Missing fields from an older server fail
closed. Readiness authorizes the configured route; it does not assert that a
particular device is online or that a real call has been delivered.

`ready`, `clientsReady`, and `clientArtifacts` retain their separate distribution
meaning. They must not be set to true just because server routing exists.
Token issuance and installation receipts retain false direct provider, push,
and call-effect flags: minting a token is not delivering a call. The clients
continue to reject inconsistent or broader-effect session receipts.

Cleanup may use the existing authorized session path after routing becomes
unavailable. A token for a new Voice identity cannot prove that an old identity
was unregistered. Old-identity cleanup must remain pending when its credential
is unusable; the backend must independently exclude that old route.

## Routing and lifetime

Only the existing authenticated Twilio inbound path can reach the native dial
plan. Destinations must come from current canonical organization, project,
number-binding, installation, token, and customer ISV authority. Never accept
an arbitrary client identity from the inbound request or public browser.

Use installation-specific identities and enforce current authorization when
resolving each call. Suspending or revoking one installation must make its old
identity unreachable without affecting another installation. Replaced tokens,
stale installation revisions, removed membership, and changed provider
authority must not inherit an earlier route.

An incoming registration can survive the short JWT used to establish it.
The five-minute issuance token's expiry is not a background-call timeout.
Twilio documents background/cold-start delivery and registration refresh
separately from Access Token expiry in its
[iOS SDK FAQ](https://www.twilio.com/docs/voice/sdks/ios/faq).
Routing is therefore based on durable current authority, not an unexpired
five-minute token. Actual remote registration is still a device/provider
acceptance condition.

The native plan renders at most ten `<Client>` destinations. Mobile identities
use only letters, digits, and underscores, as required by the
[Twilio Client reference](https://www.twilio.com/docs/voice/twiml/client).
The existing telephone `<Number>` forwarding path remains available as its
separate configuration; native routing does not silently add another call leg.

## Release and activation

Qualify the combined server/iPhone/Android source together. The existing free
held-release PostgreSQL job includes `responder-native-voice-routing` in its
own disposable clone via `SITESOURCERY_PG_NATIVE_VOICE_ROUTING_TEST_URL`.
The clone must be removed on success and failure.

Keep `SITESOURCERY_RESPONDER_NATIVE_VOICE_ROUTING_MODE=held` until the exact
customer pilot, provider authority, call costs, and device artifacts are
approved. The explicit `verified` mode requires verified inbound ingress and
Voice access. Enabling native and telephone dialing simultaneously is invalid.
Do not turn on routing merely to clear a capability warning.

Before any production call, confirm the customer's subaccount, number binding,
current project authority, platform push credentials, and signed client. Then
verify real incoming/background/cold-start calls, answer/reject, logout,
suspension/revocation, token replacement, and provider/network failure with a
consenting pilot. A local synthetic success does not satisfy these checks.

The current no-spend instruction leaves paid provider activation and store
distribution held. No credentials, phone numbers, customer content, or signing
material belong in this document or the public repository.
