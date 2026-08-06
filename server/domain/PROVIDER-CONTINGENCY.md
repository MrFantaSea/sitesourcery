# Domain provider contingency boundary

Reviewed **2026-08-06**. `provider-contingency.mjs` is a local routing and
safety boundary. It contains no provider credentials, makes no calls by
itself, and does not authorize live provider use.

## Contract

- The two slots are generic provider descriptors. The first may be Spaceship;
  the second may remain `configured: false` until an approved adapter exists.
- `preflightRegistration` is no-charge/read-only. It may try the other healthy
  provider after a technical failure. A valid `unavailable` answer is terminal.
- `lockedProviderCode` restricts preflight to one provider after any
  provider-specific preparation has started. Do not pass one provider's
  contact IDs into an unlocked cross-provider preflight.
- `submitRegistration` requires a route-bound exact price and caller-created
  attempt ID. It calls one provider at most once and never catches an error by
  trying the other provider.
- Unknown registration results remain held until `reconcileRegistration`
  reads the original provider's operation and customer registrant mapping.
- Successful readback creates an immutable provider pin. `readPinned` and
  `mutatePinned` use only that registrar of record.
- Renewal and transfer mutations require exact price confirmation. An
  uncertain mutation is held and cannot be repeated by changing providers.
- A submitted transfer retains the old pin. A separate explicit transfer
  workflow must prove completion before durable storage replaces it.

Caller persistence remains the source of truth for idempotency. Selections,
routes, attempt state, operation IDs, and provider pins must be committed before
the next state transition. This boundary preserves attempt IDs unchanged and
performs no internal retry, but it is deliberately not an in-memory workflow
store.

## Integration status

The provider-neutral domain orchestrator now implements the core two-slot
contract:

1. New orders begin unselected, then persist the selected provider route before
   provider-specific contact preparation.
2. Contact preparation and revalidation stay locked to that provider. A switch
   requires a fresh quote and fresh customer acceptance.
3. Registration dispatch persists one provider and one attempt before the
   irreversible call. Uncertain outcomes reconcile only against that provider.
4. Authoritative ownership readback creates a durable registrar-of-record pin.
   Transfer reads and mutations follow that pin and never use the fallback.
5. Public order, custody, and audit projections carry safe route and pin
   evidence without provider secrets.

The remaining production work is deliberately explicit:

1. Compose primary and secondary adapters in the hosted PostgreSQL runtime and
   persist route, attempt, operation, and pin evidence in its canonical tables.
2. Install and contract-test one approved reseller-capable secondary adapter;
   until then the secondary slot remains held and cannot receive a mutation.
3. Replace the legacy `spaceship_disclosure` agreement with versioned,
   provider-aware disclosure and exact customer acceptance before payment.
4. Route hosted DNS, renewal, support, and transfer operations through the
   persisted provider pin. Current Spaceship renewal remains unsupported and
   held.
5. Prove crash recovery, replay, and provider-readback behavior against fresh
   PostgreSQL before any live provider release.

Construction should inject the already-reviewed Spaceship adapter as one slot
and a held/configuration-required adapter as the other. Provider readiness is a
local boolean supplied by composition; this module does not probe networks or
read secrets.

## Focused proof

Run with the repository's Node 24 runtime:

```sh
node --test server/domain/test/provider-contingency.test.mjs
node --test server/domain/test/service-provider-contingency.test.mjs
```

The tests use deterministic in-memory adapters only. They cover symmetric
preflight fallback, locked preflight, zero-provider failure, exact price and
attempt preservation, uncertain and not-submitted registration behavior,
authoritative pin creation, long-lived pin continuity, pinned renewal
uncertainty, and explicit transfer.
