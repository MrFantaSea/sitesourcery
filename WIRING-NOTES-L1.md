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
