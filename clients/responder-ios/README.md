# Site Sourcery Responder for iPhone

This is the native iPhone client for the existing Site Sourcery hosted
Responder authority. It is not a second backend and it does not change a
customer's carrier.

## Implemented client boundary

- hosted registration, verification, sign-in, recovery, organization, and
  project selection through the secure hosted cookie and CSRF contract;
- digest-only Responder activity/status readback;
- customer forwarding setup and cancellation using operator-provisioned
  managed destination bindings and human-executed carrier instructions;
- Keychain-backed installation secret and durable idempotency identities;
- tenant-scoped native installation creation, logout suspension, login resume,
  and purpose-separated APNs/PushKit registration;
- ordinary notifications through UserNotifications/APNs;
- the official Twilio Voice iOS SDK 6.13.6, pinned to commit
  `62912513388001394d093b85a6269bf3206cac13`, for PushKit payload
  validation, device registration, incoming CallInvite acceptance, and
  CallKit audio/call lifecycle; and
- fail-closed held VoIP authorization while the server/provider release gate
  remains closed. Token issuance and SDK wiring do not claim working Twilio
  `<Client>` routing.

The app never persists or displays a raw server push token, Voice access token,
caller identity, message body, carrier code, provider credential, session
cookie, or CSRF token.
It does not dial MMI/star codes, send carrier SMS, or silently change phone
settings.

## Local proof on this Mac

The installed Apple Command Line Tools have Swift but do not include the
iPhoneOS SDK, simulator, XCTest, Swift Testing, signing, or device support. The
versioned local proof therefore compiles and exercises the platform-neutral
core, parses every Swift file, lints the Xcode project/plists, and verifies the
held/security structure:

```sh
/private/tmp/node-v24.18.0-darwin-arm64/bin/node Scripts/prove-client.mjs
```

`Responder.xcodeproj` is the real iOS application target. Full build and device
proof require full Xcode with the iOS 17+ SDK, an owner-controlled Apple
Developer team, the `com.sitesourcery.responder` App ID with APNs/VoIP
capabilities, and evidence-gated signing inputs. Those inputs do not authorize
App Store submission or a live push/Voice effect by themselves.

## Current external-effect posture

Production provider authorization, push delivery, Voice calls, carrier
commands, message sends, App Store submission, public changes, and deployment
remain held. The verified/test-only server mode can issue a five-minute
incoming-only Twilio authorization, and the app can use it to register the
PushKit token, but capability truth continues to report the missing call-routing
and signed/device artifact gates.
