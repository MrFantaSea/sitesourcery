# L1 integration ledger: held Alakazam $35 + $50 union

This file resolves the add/add collision between the sealed F-03 wiring notes
in merge parent `b2401e91d4fd3dc6f2cb8c1641b8267951c90307` and the sealed F-04 wiring
notes in merge parent `cee4490022665ae55f907d1ad187e8da406605b9`. The verbatim lane notes remain
available in those immutable parents. This ledger records the composed union.

## Release invariants

- Alakazam remains commercially **HELD**.
- The public-offer state stays `held`.
- The worker enable predicate stays gated by the separately approved release
  configuration and the publication hold.
- No Stripe, publication, tenant-runtime, or other provider port is passed to
  either customer-control boundary.
- F-03 remains the base multi-file/photo fulfillment layer. F-04 wraps F-03
  only for an exact `alakazam_50` authority.

## Production composition

`server/hosted/bin/server.mjs` composes in this order:

1. `createPostgresAlakazam35Repository` and `createAlakazam35Composition`.
2. `createAlakazam35FulfillmentRepository`, wrapping the base repository.
3. `createPostgresAlakazam50Repository` and `createAlakazam50Composition`.
4. `createAlakazam50FulfillmentRepository`, wrapping the F-03 repository.
5. `createAlakazam35Compiler` and `createAlakazam35TierCompiler`.
6. `createAlakazam50Compiler` and `createAlakazam50TierCompiler`, wrapping the
   F-03 tier compiler.
7. The unchanged `createAlakazam35PublicationPort`, so the immutable F-03
   photo asset remains part of the compiled artifact set.
8. The fulfillment worker receives only the final F-04 repository/compiler
   wrappers and the unchanged held publication port.

Both `alakazam35.readiness()` and `alakazam50.readiness()` run before the
existing approved-release assertion. Both boundaries are supplied to
`createHostedApi`.

## Hosted HTTP composition

`server/hosted/http.mjs` retains the complete F-03 boundary and adds an
independent held F-04 boundary with exactly these methods:

- `getSnapshot`
- `readiness`
- `requestCare`
- `saveConfiguration`

The capability is true only when `authorization === true` and
`providerEffects === false`. The authenticated F-04 routes are:

- `GET /api/v1/projects/:projectId/alakazam/50`
- `POST /api/v1/projects/:projectId/alakazam/50/configurations`
- `POST /api/v1/projects/:projectId/alakazam/50/care-requests`

Every route rejects query drift. Writes retain the shared CSRF and
`Idempotency-Key` boundary and use `write.commandId` as their only command
identity. Configuration accepts only `borderChoiceId`, `cashAppHandle`,
`expectedCurrentRevision`, `fontChoiceId`, `menu`, and `venmoHandle`. Care
accepts only `message`.

## Customer artifact registration

`scripts/configure-abracadabra-hosted-staging.mjs` registers and loads the
F-03 assets before the F-04 assets, and both before the customer-control DOM:

- `abracadabra/app/abracadabra-alakazam-35.css`
- `abracadabra/app/abracadabra-alakazam-35.js`
- `abracadabra/app/abracadabra-alakazam-50.css`
- `abracadabra/app/abracadabra-alakazam-50.js`

`abracadabra/app/abracadabra-customer-control-dom.js` retains the F-03 panel
for authorized $35/$50 accounts and mounts the F-04 panel only for an exact
active or grace `alakazam_50` account. Both panels are destroyed on project,
account, subscription-status, tier, or revision drift. The existing held
public-offer gate remains outside both mounts.

`scripts/hosted-truth/manifest.mjs` seals the exact assets with:

```text
abracadabra/app/abracadabra-alakazam-35.css f626e50f198761409fd10db139c70f442880d0c6ecc22b31cf707bd9312e8585
abracadabra/app/abracadabra-alakazam-35.js  14604957e98d8f94f4143bbbfac0b0e722b068aa29b56560ff4028d41d01c431
abracadabra/app/abracadabra-alakazam-50.css 5615189885bf84667cb28c8657f730b77cc40eb619c29460d5b33dce876ea167
abracadabra/app/abracadabra-alakazam-50.js  48d0e3ad2624c0b1d7b7a80f3f97606157a0078d987f1a48c144d0f3a326a43f
```

No released offer slot or public sales promise is added.

## Migration-verifier union

The ordered post-Privacy list ends with:

1. `202608080101_alakazam_customer_publication_controls.sql`
2. `202608080102_alakazam_35_fulfillment.sql`
3. `202608080103_alakazam_50_authority.sql`

The exact migration count is 55. The verifier retains the F-03 publication,
photo, configuration, care, trigger, privilege, and non-cascading-FK proofs,
then independently proves the F-04 configuration/care tables, deferred
authority triggers, append-only privileges, exact runtime marker, menu
validator privilege, and non-cascading foreign keys.

## Required proof

- Pinned syntax checks for every changed/new JavaScript module.
- Focused F-03 + F-04 domain, hosted, HTTP, compiler, fulfillment, asset,
  migration-structure, and verifier tests.
- One fresh validated PostgreSQL 16 database with all 55 migrations, the
  synthetic sealed Privacy V3 fixture, both tier journeys, exact cleanup, and
  a read-only `databaseAbsent true` proof.
- The unchanged F-04 browser audit at 320x720, 390x844, and 1440x1000 using
  only its self-spawned loopback listener, browser process, and temporary
  profile.

## F-06 retained-premium integration delta

F-06 adds the accepted policy artifact
`SS-ALAKAZAM-CARE-LIFECYCLE-2026-08-09-V1`, held retained-premium domain and
hosted boundaries, migration `202608090104_alakazam_retained_premium_state.sql`,
and dedicated Abracadabra assets. The policy digest is pinned to
`d44a49dde586042c6a3b8f84d12df8079d30c87d9824a6c2ddbeb9ffad5f31c4`.
Payment-grace expiry creates the 30-day private retained-exit; it is never a
purge reason. Only terminal customer deletion and retained-exit expiry purge
premium configuration.

### `server/hosted/bin/server.mjs`

Add this import beside the other Alakazam compositions:

```js
import {
  createAlakazamRetainedPremiumComposition
} from "../alakazam-retained-premium-composition.mjs";
import {
  createPostgresAlakazamRetainedPremiumRepository
} from "../alakazam-retained-premium-postgres.mjs";
```

Immediately after `alakazam50`, compose the boundary without a provider port:

```js
  const alakazamRetainedPremiumRepository =
    createPostgresAlakazamRetainedPremiumRepository({
      authority
    });
  const alakazamRetainedPremium =
    createAlakazamRetainedPremiumComposition({
      authority,
      resolveSession: commerceV2.resolveSession,
      clock: commerceV2.clock,
      repository: alakazamRetainedPremiumRepository
    });
```

Add `alakazamRetainedPremium` beside `alakazam50` in the options passed to
`createHostedApi`. Add its `readiness()` result to the private readiness proof;
the accepted state is `ready:true`, `authorization:true`,
`providerEffects:false`, `state:"held"`. Do not pass Stripe, publication, care,
or any provider adapter to this composition.

The L2 grace deadline worker must call the repository method
`applyRetainedExitPolicy({ tenantId, projectId, subscriptionId, windowId,
observedAt })` only after its canonical `grace_expired` transaction has stored
the exact `suspended` event and provider-readback digest. Its retention worker
may call `purgeExpired({ tenantId, projectId, subscriptionId, receiptId,
observedAt })`; no worker may call the private inner purge function. The
cancellation-confirmation path calls the same retained-exit method only after
the confirmed effective cancellation and export-grant evidence exist.

L4 completed those seams in
`server/hosted/alakazam-retained-premium-lifecycle.mjs`. Its grace worker
re-reads the exact suspended event, subscription revision, seven-day boundary,
processed Stripe-event row, and provider-readback digest before applying the
retained exit. Its expiry worker calls only the public `purgeExpired` method
after the durable retained window ends. Its exported cancellation hook re-reads
an `effective` / provider-`confirmed` cancellation, the matching terminal tier
event, and the exact available export grant before applying the same retained
exit. IDs are deterministic per durable boundary so concurrent or replayed
workers cannot change command identity. Production composition keeps the loop
held unless both Alakazam and its lifecycle policy are separately approved.

### `server/hosted/http.mjs`

Add `alakazamRetainedPremium = null` to `createHostedApi` options, import
`createHeldHostedAlakazamRetainedPremium`, and select the fail-closed default:

```js
  const alakazamRetainedPremiumBoundary =
    alakazamRetainedPremium ??
    createHeldHostedAlakazamRetainedPremium();
```

Require exactly `getSnapshot`, `getExport`, `readiness`, and
`restoreConfiguration`. Register these authenticated, query-free routes beside
the existing `/alakazam/50` routes:

```text
GET  /api/v1/projects/:projectId/alakazam/premium
GET  /api/v1/projects/:projectId/alakazam/premium/export
POST /api/v1/projects/:projectId/alakazam/premium/restorations
```

The POST route uses the shared CSRF boundary, takes `commandId` only from the
validated `Idempotency-Key`, and accepts exactly
`expectedSourceConfigurationDigest` and `expectedSubscriptionRevision` in the
body. Return `202`. No edit, publication, care, Stripe, or provider route is
part of F-06.

### Abracadabra registration

In `scripts/configure-abracadabra-hosted-staging.mjs`, load these after the
F-04 assets and before `abracadabra-customer-control-dom.js`:

```text
abracadabra/app/abracadabra-alakazam-retained-premium.css
abracadabra/app/abracadabra-alakazam-retained-premium.js
```

The customer-control composition must mount this panel for authenticated
projects whenever a retained-premium snapshot is available. During
`payment_grace` or `retained_exit`, destroy or do not mount the F-03/F-04 edit
and care panels and show only this read/export panel. On an active lower tier,
show only the masked marker plus bounded customer export. On an exact active
re-upgrade with canonical evidence, show the held restoration control. Never
derive authority from DOM, local storage, query parameters, or account copy.

In `scripts/hosted-truth/manifest.mjs`, seal the exact two new asset digests
after L4 finishes composition; do not add a released offer slot. All Alakazam
commercial, provider, publication-apply, and Privacy-V4 gates remain held.
