# IDENTITY-ROTATION-01 wiring notes

## Production composition

`server/hosted/bin/server.mjs` now creates one
`identityPepperConfigurationFromEnvironment(process.env)` and uses its
`compose()` boundary to call `createPostgresIdentityBridge`. The adapter alone
supplies `pepper`, `pepperVersion`, and `previousPeppers`; no other production
composition path should construct those fields.

The current secret remains in `SITESOURCERY_IDENTITY_PEPPER` and is the only
writer. `SITESOURCERY_IDENTITY_PEPPER_CONFIG` is required and contains only the
v1 schema, current version metadata, and up to three explicit prior-version
environment names. Prior secret slots are limited to
`SITESOURCERY_IDENTITY_PEPPER_PRIOR_1` through `_3`.

Startup evidence is `identityPepperConfiguration.readiness`. It contains only
version metadata, bounds, and `secretMaterial: "redacted"`. Never log, inspect,
serialize, return, or persist the composed bridge options.

## Operator-owned wiring still held

1. Keep the metadata JSON and all referenced secret variables in the existing
   root-owned `0600` hosted environment boundary.
2. Populate or change secret variables only through the approved interactive
   credential procedure. Never pass material in argv, terminal history, unit
   arguments, evidence, tickets, or reports.
3. Follow `ops/SITESOURCERY-IDENTITY-PEPPER-ROTATION-HELD.md` for blue/green
   promotion, metadata-only retirement proof, and rollback.
4. Treat the included JSON and environment examples as held placeholders only.

No migration, provider wiring, database write, deployment action, or live
configuration belongs to this packet.
