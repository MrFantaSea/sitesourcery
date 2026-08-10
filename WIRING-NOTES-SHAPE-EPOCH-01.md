# SHAPE-EPOCH-01 L4 wiring notes

This packet is additive and does not wire the release epoch into production
composition. Its committed epoch is valid but intentionally reports unproven
installed identity, backup, monitor, and rollback evidence. Public deployment,
DNS mutation, origin traffic, provider effects, and every customer capability
remain held.

## Files owned by this packet

- `ops/release-epoch.schema.json`
- `ops/release-epoch.mjs`
- `ops/verify-release-epoch.mjs`
- `ops/releases/shape-epoch-2026-08-10/release-epoch.json`
- `ops/test/release-epoch.test.mjs`
- `WIRING-NOTES-SHAPE-EPOCH-01.md`

`npm run check:ops` already discovers the new module and focused test through
the existing `ops/*.mjs` and `ops/test/*.test.mjs` globs. No package-script
change is required.

## L4 production composition

Do not use dependency readiness as process liveness, and do not use either as
customer authority. L4 should pass one validated epoch projection into the
hosted composition and expose the three contracts independently.

1. In `server/hosted/bin/server.mjs`, after the existing `node:fs` import, add
   `readFile` from `node:fs/promises`. Beside the hosted imports, add
   `validateReleaseEpoch` from `../../../ops/release-epoch.mjs`.
2. In `server/hosted/bin/server.mjs`, read the absolute path supplied by
   `SITESOURCERY_RELEASE_EPOCH_FILE`, parse it as JSON, and call
   `validateReleaseEpoch` before creating the HTTP server. Do not require
   dependency state `ready` merely to keep the process alive. Pass the frozen
   result to `createHostedApi` as `releaseEpoch` in the options object beginning
   at the current `createHostedApi(service, {` call.
3. In `server/hosted/http.mjs`, add `releaseEpoch = null` to the options of
   `createHostedApi`. Validate that its schema is
   `sitesourcery.release-epoch/v1` before serving requests.
4. In `server/hosted/http.mjs`, keep `GET /api/v1/health` tied only to
   `releaseEpoch.assurance.liveness`; do not make database, backup, monitor, or
   provider readiness a liveness precondition.
5. In `server/hosted/http.mjs`, combine existing service readiness with
   `releaseEpoch.assurance.dependencyReadiness.state === "ready"` for
   `GET /api/v1/ready`. Return the epoch blocker identifiers without filesystem
   paths, provider IDs, secrets, or operator identity.
6. In `server/hosted/http.mjs`, AND every customer-facing capability with
   `releaseEpoch.assurance.customerCapability.allowsCustomerEffects === true`
   and its exact enabled-capability membership. The v1 epoch deliberately has
   no enabled capability, so this integration remains fail closed.

## L4 deployment preflight

The release lane may add an `ExecStartPre` to the production service immediately
before its existing `ExecStart`:

```ini
ExecStartPre=/opt/sitesourcery/node-v24.18.0/bin/node /opt/sitesourcery/current/ops/verify-release-epoch.mjs --epoch /etc/sitesourcery/release-epoch.json
```

The exact Node and release paths must be replaced by the release lane's sealed
installed identity. The epoch file must be copied from the same immutable
release, remain non-secret, and be checked against that release before service
restart. A valid held epoch exits successfully; it does not authorize traffic,
DNS, provider effects, or customer capability.

## Promotion boundary

Do not edit the v1 held epoch in place. Backup, monitor, rollback, and installed
identity receipts must each bind the exact epoch digest. A future reviewed
promotion packet must create a new immutable epoch receipt and separately grant
customer capability. Dependency readiness alone never grants customer effects.
