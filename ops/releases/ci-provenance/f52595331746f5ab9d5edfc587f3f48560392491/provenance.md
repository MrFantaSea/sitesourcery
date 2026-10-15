# Native incoming Voice and operational corrections

Implementation `f52595331746f5ab9d5edfc587f3f48560392491`, tree `76df73dee12d59f2549b810d39febd377d2e3f01`, direct protected base `c3664b0ee4d7099a0c8377bf888ba4943daaa986`.

The backend now resolves incoming native Voice calls to current installation/revision-bound identities. Routing requires current organization/project/membership, active number binding and ISV topology, approved runtime controls, current installation/token and sealed issuance provenance. A separate final database transaction observes revocation committed during provider validation; testing reproduced and corrected the earlier serializable-snapshot race. JWT expiry does not itself end a durable incoming registration.

iPhone and Android check the current scoped installation, routing availability and exact recipient before incoming-call admission or answer. iOS reports CallKit promptly before asynchronous authorization; both clients retain honest pending cleanup when an old identity cannot be unregistered. Token issuance remains distinct from delivery, and distribution readiness stays false. Explicit native routing defaults held and cannot coexist with verified telephone dialing.

The same candidate retains previously accepted read-only Spaceship domain reconciliation, symlink-safe operational CLI entrypoints, and disposable PostgreSQL CI regression wiring. No source migration, dependency upgrade, public copy change, provider activation or new service is introduced.

## Validation

- Full `npm test` on this exact implementation passed: 2,532 passed, 28 skipped, both artifact builds and 24 hosted routes at six browser widths. Log SHA-256 `b6f6f14c18da2928c056ffb8b766e0b591fab1637ec60f6edfc67d987db30bed`.
- Native backend: 16 focused units and 8 real PostgreSQL checks, including intervening revocation, token rotation, independent devices and topology retirement. Receipt `4869c584d9cc69f5362f81d7d3ad42b00576d02ce5b802fdc9176779d7e37a9d`.
- Root combined route/dial/ingress/public-capability contract: 7 passed. Log `ebd69c7bd69aa8b816fc7cb6389067f0b61d1e7c52212a9850e846e48f4d7bf4`. Existing capability snapshots corrected for three additive held fields; their 25 focused checks passed. The initial full-run failure is retained as `30821dcf316188bf98b77e7b1ecb65fa26c4aab1a93d175254df2d7f2fffef03`; no runtime behavior was weakened to satisfy it.
- The second full run passed application/operations/builds, then exposed a browser fixture teardown race (`Fetch.fulfillRequest: Invalid InterceptionId`). The test now waits for the exact intercepted Checkout document to finish loading before teardown; interception errors remain fatal. Failed log SHA-256 `03a22ff864968bd87b7cd8a123760fec03865117b02eb39cc3643bcb9bcab555`.
- Android: 32 focused JVM checks plus final Kotlin compile; receipt `6f68f5a1b36498f3fa9df345f163906ef6816066ed403fbc81c6f3cd6ce9d360`. iOS: 12 client proof checks including 12 compiled Swift core cases and a successful unsigned build using pinned Twilio 6.13.6; receipt `12121d92f0e8ade985345b61c326a6f4d65a3b7bbf569fb2c30fd59571397f0c`. These are not real-device delivery proofs.
- Previously accepted domain reconciliation: 68 focused checks including 12 PostgreSQL cases; receipt `e2877d6695240c6de353612ccfe5ee82819d79e135fbd2e442fad44ef3a5c638`. CLI: four direct/symlink/import regressions. Exact accepted source bytes were reused. The new CI clone passed injected-failure cleanup and shell syntax checks; actual held GitHub qualification remains separate.
- Combined PostgreSQL receipt SHA-256 `f3b79fa109e37de2a27cad4aae75815643bddfbcd9459592d9fad80d3c4057c0`. Only named test databases were dropped. Qualification temporary fixtures were removed; toolchains, source and original logs are retained.

Root reviewed the exact integration boundaries, current-authority checks, held defaults, cleanup semantics and CI clone cleanup. The candidate contains the byte-identical accepted worker implementations plus root composition, two expected-object fixture corrections and the observed browser fixture completion fix.

## Limits and next step

Production remains the previously accepted C80112/schema106 on existing HQ. This candidate has no live effects. Normal protected GitHub checks and candidate-bound held release qualification precede any deployment. Paid Responder commerce, consenting carrier/device calls, push delivery, signing/store distribution, real registrar authentication, remaining commercial workflows and whole-system acceptance remain open. No spending, customer/provider mutation, crypto changes or deployment occurred in this source milestone.
