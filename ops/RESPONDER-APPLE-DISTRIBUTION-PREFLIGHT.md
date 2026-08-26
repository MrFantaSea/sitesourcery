# Responder for iPhone — Apple distribution preflight

This is the authoritative operator sequence for taking the already-built,
held Responder iPhone client from unsigned source to Apple distribution. It is
not permission to enroll, pay, create signing or push assets, upload a build,
invite testers, submit for review, or release the app.

Verified 2026-08-26 against Apple's current official membership, D-U-N-S,
certificate, TestFlight, and privacy guidance. Apple screens, terms, prices,
roles, and review requirements can change; read them again from the live Apple
account at each action gate.

## Current owner-action boundary

The Apple Developer Program fee is **not due**. Desiderata Labs LLC's free
D-U-N-S request remains under D&B review, and the latest available Apple
account request was denied with no later approval. Wait for D-U-N-S issuance,
Apple's documented propagation interval, successful organization-enrollment
access, organization verification, and license review.

Apple currently lists organization membership at USD 99 per membership year.
That public price is planning information, not payment authority. When Apple
presents the exact live purchase screen, stop and show the owner the amount,
currency, taxes, renewal method/terms, legal entity, Apple Account, and purpose.
Purchase only after the owner approves that exact charge. Never switch to
individual enrollment to work around organization verification: the App Store
seller must be Desiderata Labs LLC, not the owner's personal name.

The separate current owner action is still only creation of the free Site
Sourcery primary Twilio account with strong MFA. Twilio creation does not
authorize any Apple action, and Apple membership does not authorize any Twilio
provider object or spend.

## Frozen client identity and held posture

- Xcode target: `clients/responder-ios/Responder.xcodeproj` / `Responder`.
- Bundle identifier: `com.sitesourcery.responder`.
- Display name: `Responder`.
- Minimum iOS: 17.0; iPhone family only.
- Version/build: `1.0.0` / `1` until a reviewed release cohort changes them.
- Debug APNs environment: `development`; Release: `production`.
- Declared background modes: ordinary remote notification and VoIP.
- Required permission: microphone, only for a business call the user answers.
- Privacy manifest declares linked name, email address, and phone number for app
  functionality, with tracking false.
- Signing style is automatic, but no Development Team or provisioning profile
  is committed.
- Production API authority is `https://sitesourcery.com/api/v1`.

The source and hosted contract are proved; real APNs/PushKit delivery, Twilio
Voice routing, provider calls/messages, signed-device artifacts, TestFlight,
App Store submission, and public distribution remain held.

## Gate 0 — unsigned engineering proof

- [x] Platform-neutral Swift/client proof passes.
- [x] Xcode project, property lists, privacy manifest, and entitlement structure
      are linted.
- [x] Xcode 26.6 resolved the pinned Twilio Voice SDK and produced clean unsigned
      generic iPhone Simulator and generic iPhone builds.
- [x] Exact simulator artifact launched and rendered, then was terminated,
      removed, and the simulator shut down.
- [x] Native-installation, APNs/PushKit lifecycle, CallKit/Voice, tenancy,
      replay, PostgreSQL, and held-effect proofs passed.
- [x] No Apple account, team, certificate, profile, device, provider effect,
      App Store record, or payment was used by that proof.

The detailed immutable evidence is in
`ops/releases/final-successor-20260811/FIN-006E2-RESPONDER-IOS-VOICE-PROVENANCE.md`.
Current source truth is also checked by
`clients/responder-ios/Scripts/prove-client.mjs`.

## Gate 1 — legal identity and organization access, no spend

- [ ] D&B issues the free D-U-N-S Number for **Desiderata Labs LLC**.
- [ ] Owner verifies the D&B record's exact legal name, headquarters address,
      legal-entity status, and work contact information privately.
- [ ] Wait at least Apple's then-current propagation interval after issuance or
      a D&B correction before attempting enrollment.
- [ ] Use an owner-controlled Apple Account with strong two-factor
      authentication and private recovery controls.
- [ ] Enter organization enrollment using the LLC's exact legal identity and
      the owner's genuine authority to bind the company.
- [ ] Stop if Apple still denies account access, cannot find the organization,
      shows the wrong entity/status, or asks for inconsistent evidence.
- [ ] Do not accept a paid expedite, individual enrollment, alternate entity,
      or duplicate enrollment as a workaround.

Do not record the D-U-N-S Number, private Apple Account address, recovery data,
personal phone, private business documents, or enrollment identifiers in Git,
chat, logs, screenshots, receipts, or provenance. Evidence may state only the
redacted result and a digest of an owner-retained private receipt.

## Gate 2 — Apple verification and exact annual-fee approval

- [ ] Apple verifies the organization and the enrolling person's authority.
- [ ] Owner reviews the live Apple Developer Program License Agreement.
- [ ] Operator reads back the exact seller/legal entity and membership type.
- [ ] Operator presents the exact live amount, currency, taxes, renewal method
      and terms, payment purpose, and cancellation controls to the owner.
- [ ] Owner explicitly approves that exact annual membership charge.
- [ ] Only then complete the one approved purchase and reconcile one receipt.

An old USD 99 listing, a prior verbal intention, or permission to continue the
build is not approval to pay. Do not create a duplicate purchase after an
uncertain result; reconcile the Apple membership and owner receipt first.

## Gate 3 — active membership and minimum team authority

- [ ] Read back active organization membership with seller name Desiderata Labs
      LLC and the intended Account Holder.
- [ ] Record only non-secret/digest-bound team and membership evidence.
- [ ] Review current agreements in the live account; accept only those required
      for the approved distribution purpose and within owner authority.
- [ ] Add no extra users or roles unless their exact operational need and least
      privilege are reviewed.
- [ ] Keep certificate private keys, account credentials, recovery material,
      and App Store Connect API keys out of source, chat, logs, and provenance.

Tax and banking agreements are not automatically required for a free app and
must not be completed speculatively. If the chosen product later charges
through Apple, open a separate legal, tax, banking, and commerce gate.

## Gate 4 — identifiers, signing, APNs, and provider separation

- [ ] Reserve exactly one explicit App ID for
      `com.sitesourcery.responder`; stop on ownership or identity conflict.
- [ ] Enable only the capabilities required by the reviewed client, including
      Push Notifications; reconcile portal capabilities to the source
      entitlements before signing.
- [ ] Create the minimum Apple Development and Apple Distribution signing
      assets needed for the approved proof path.
- [ ] Create development and production provisioning profiles only for the
      exact App ID, capabilities, team, and distribution purpose.
- [ ] Create the minimum APNs/VoIP provider credential required by the current
      Twilio Voice iOS integration, keeping sandbox and production purposes
      distinct.
- [ ] Install provider material only in the owner-controlled secret store and
      the customer-isolated Twilio topology. Never put raw Apple or Twilio
      material in PostgreSQL, Git, chat, command output, logs, or provenance.
- [ ] Read back and digest-bind every identifier, capability, environment,
      expiry, and provider attachment before runtime use.

Apple signing identity, Apple push authority, Twilio customer subaccount, and
Twilio Push Credential are four different authorities. Passing this gate does
not release pushes, calls, messages, or customer traffic.

## Gate 5 — signed device and archive proof

- [ ] On a dedicated branch from current protected main, pin the intended Xcode
      and SDK versions and reconcile package dependencies.
- [ ] Build a signed Debug artifact for one owner-controlled registered device.
- [ ] Prove login, workspace selection, installation lifecycle, ordinary APNs,
      PushKit/CallKit ordering, logout/suspension, and token retirement without
      using a customer or live provider effect.
- [ ] Run one separately approved sandbox push/Voice proof only after its Twilio
      customer topology and exact effect authority are green.
- [ ] Produce and validate one Release archive with the intended distribution
      certificate/profile, entitlements, privacy manifest, bundle, version, and
      build number.
- [ ] Preserve digest-only artifact and signing readback; retain private signing
      material outside the repository.

Do not treat a simulator build, generic unsigned device build, valid archive,
or successful upload as proof that push delivery, Voice routing, TestFlight, or
App Review has passed.

## Gate 6 — App Store Connect and TestFlight

- [ ] Create one App Store Connect app with the exact bundle ID and reviewed
      seller/name/SKU/language fields; reconcile before retrying an uncertain
      create.
- [ ] Upload one exact signed build and verify Apple's processed-build identity,
      entitlements, privacy manifest, export-compliance response, and warnings.
- [ ] Complete TestFlight description, feedback address, review contact,
      sign-in/test instructions, and feature scope without disclosing secrets.
- [ ] Use internal testers first. External testers require the then-current
      TestFlight review path and a separate approval for any external audience.
- [ ] Reconcile every crash, termination, push/Voice result, account deletion
      path, and provider effect before advancing.

An uploaded build can remain held indefinitely. Do not invite testers merely
because processing succeeded.

## Gate 7 — privacy, review, and purpose-specific release

- [ ] Reconcile the source privacy manifest with actual first-party and Twilio
      SDK data behavior and the current App Store privacy questionnaire.
- [ ] Provide the required public privacy-policy URL and reviewed support,
      marketing, category, age-rating, description, keywords, screenshots, and
      review notes.
- [ ] Verify App Review access can exercise the app without receiving private
      customer or operator authority.
- [ ] Obtain a separate owner decision for the exact build, countries/audience,
      availability date, price, and phased/manual release posture.
- [ ] Only then submit for App Review. After approval, stop again before public
      release unless the submission approval explicitly covered release.
- [ ] Reconcile public listing, download, installation, sign-in, provider hold,
      monitoring, support, rollback, and retention evidence after release.

Membership payment, App Store submission, and public release are three
different owner decisions. None authorizes a Twilio customer activation.

## Stop conditions

Stop the dependent action without improvising if any of these occur:

- legal entity, seller name, D-U-N-S, address, or authority mismatch;
- a fee or renewal term differs from the reviewed live proposal;
- an Apple create/upload/purchase has an uncertain result;
- duplicate App ID, app, certificate, profile, or provider attachment;
- certificate/private-key loss, unexpected role, or account-security warning;
- entitlements, provisioning profile, processed build, or privacy declaration
  differ from source truth;
- provider activity, push, call, message, customer, or public effect appears
  outside its separately approved purpose.

Reconcile first. Never retry a create, purchase, upload, submission, or release
to manufacture a green result.

## Official Apple references

- Membership comparison and current public fee:
  <https://developer.apple.com/support/compare-memberships/>
- D-U-N-S and organization identity:
  <https://developer.apple.com/help/account/membership/D-U-N-S/>
- Enrollment, verification, agreement, and purchase order:
  <https://developer.apple.com/help/account/membership/program-enrollment/>
- Certificate and APNs credential purposes:
  <https://developer.apple.com/help/account/certificates/certificates-overview>
- Explicit App ID registration and capability allowlist:
  <https://developer.apple.com/help/account/identifiers/register-an-app-id/>
- Push capability/profile consequences:
  <https://developer.apple.com/help/account/identifiers/enable-app-capabilities/>
- Free versus paid app agreements:
  <https://developer.apple.com/help/app-store-connect/manage-agreements/sign-and-update-agreements/>
- TestFlight workflow and review boundary:
  <https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/>
- App privacy questionnaire and policy URL:
  <https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy>
