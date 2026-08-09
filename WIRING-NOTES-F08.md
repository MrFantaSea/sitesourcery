# F-08 generic publication-control authority wiring

Base: `3e70024aa669b3fca8dff30a6848bbed8f505dd1`

This lane is additive. Migration 101 and its historical held command evidence
remain unchanged. Migration 104 adds the generic, exact-proof command ledger.
No provider port, runtime publisher, DNS adapter, Stripe adapter, public offer,
or live effect is introduced.

## Holds that must remain

- Alakazam public offers remain `held`.
- Existing commercial and provider holds remain in force.
- Generic publication commands persist
  `privacy_v4_and_commercial_cutover_not_authorized` and remain `held`.
- Do not supply any publication/runtime/provider port to the customer route.
- Do not infer an entitlement from a project, release, address, payment, or
  legacy Stripe subscription. The repository must load an exact current
  `ss.alakazam_subscriptions` row and the canonical tier capability grant.

## Production composition

In `server/hosted/bin/server.mjs`:

1. Replace the import of
   `createAlakazamPublicationComposition` from
   `../alakazam-publication-composition.mjs` with
   `createPublicationControlComposition` from
   `../publication-control-composition.mjs`.
2. Replace only the constructor name at the existing `alakazamPublication`
   composition site. Keep the same `authority`, `resolveSession`, and `clock`
   arguments.
3. Keep the resulting boundary in the existing readiness call and the existing
   `createHostedApi` argument. Do not pass a publication provider port.

The replacement keeps the existing `readiness`, `getSnapshot`, and
`requestCommand` hosted interface. Existing route and browser contracts remain
compatible while writes move to the exact-proof generic ledger.

## L4-owned composition roots

### `server/hosted/http.mjs`

No edit. Retain the authenticated, CSRF-protected, idempotency-bound routes:

- `GET /api/v1/projects/:projectId/alakazam/publication`
- `POST /api/v1/projects/:projectId/alakazam/publication-commands`

The new repository requires the current exact subscription revision, the
canonical `publish_accepted_project_version` grant for its exact tier, and a
fully evidenced fulfilled target before either route can expose or record an
action.

### `server/hosted/postgres-service.mjs`

No edit. Use the existing canonical service-role transaction authority. The
new repository performs no direct connection, provider, or live effect.

### `scripts/hosted-truth/manifest.mjs`

The feature worktree deliberately leaves every hosted asset byte-identical to
the pinned base. At integration, L4 owns the following two-line export addition
inside the final `Object.freeze` export map in
`abracadabra/app/abracadabra-customer-control-dom.js`:

```js
    createAlakazamPublicationPanel:
      createAlakazamPublicationPanel,
```

That export makes the existing panel an explicit generic composition seam; it
does not change boot behavior or authorize an effect. After applying it, L4
must recompute the exact asset digest, update only that existing asset's entry
in `scripts/hosted-truth/manifest.mjs`, rebuild the held hosted artifact, and
run the focused browser proof against the sealed bytes. No new asset or public
offer slot is registered.

## Database and verification union

Append
`server/data-plane/supabase/migrations/202608080104_publication_control_authority.sql`
after migration 103. The exact migration count becomes 56.

The new table persists, and its deferred database trigger re-verifies:

- the exact accepted-version event, source artifact, and digest;
- the exact successful pre-publication screening and screened digest;
- the canonical publication capability and exact current subscription tier,
  status, paid window, and revision;
- the current configured licensed platform address and hostname;
- the current entitlement authority operation and serving revision; and
- the action target's fulfilled operation, release, decision, policy, and
  serving revision.

`publish` can only re-publish an already fulfilled release while dark/failed;
`rollback` targets a different historical fulfilled release; `unpublish`
targets the exact current fulfilled release. A merely newer accepted version is
not inferred to be publishable.

## Required focused proof

- Pinned syntax for every new/changed JavaScript module.
- Domain unit proof for all three actions and fail-closed drift.
- Migration-structure and empty PostgreSQL 16 replay through all 56 migrations.
- The Alakazam PostgreSQL journey using
  `createPostgresPublicationControlRepository`, proving three immutable generic
  commands, exact evidence, replay safety, zero legacy dual-write, unchanged
  releases/serving state, and concurrent idempotency.
- The existing held publication UI at exactly 320x720, 390x844, and 1440x1000,
  proving publish/rollback/unpublish keyboard controls, 44px targets, no
  horizontal overflow, unique idempotency keys, held copy, and no provider
  effect. The lane-local browser harness exposes the existing private panel
  factory in memory only; L4 applies the documented two-line export before the
  final sealed-candidate rerun.
