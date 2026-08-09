# L1 wiring notes: F-04 Alakazam $50 authority

This lane deliberately does not edit `server/hosted/http.mjs`,
`server/hosted/postgres-service.mjs`, or
`scripts/hosted-truth/manifest.mjs`. Alakazam remains commercially **HELD**.
Apply these lines only after the sealed F-03 modules are integrated.

## `server/hosted/bin/server.mjs`

Add these imports beside the F-03 Alakazam imports:

```js
import {
  createAlakazam50Compiler
} from "../alakazam-50-compiler.mjs";
import {
  createAlakazam50Composition
} from "../alakazam-50-composition.mjs";
import {
  createAlakazam50FulfillmentRepository,
  createAlakazam50TierCompiler
} from "../alakazam-50-fulfillment.mjs";
import {
  createPostgresAlakazam50Repository
} from "../alakazam-50-postgres.mjs";
```

Immediately after the F-03 `alakazam35Repository`, `alakazam35`, and
`alakazamFulfillmentRepository` composition, add:

```js
  const alakazam50Repository =
    createPostgresAlakazam50Repository({ authority });
  const alakazam50 = createAlakazam50Composition({
    repository: alakazam50Repository,
    resolveSession: commerceV2.resolveSession,
    clock: commerceV2.clock
  });
  const alakazam50FulfillmentRepository =
    createAlakazam50FulfillmentRepository({
      baseRepository: alakazamFulfillmentRepository,
      tierRepository: alakazam50Repository
    });
```

Immediately after the F-03 `alakazamTierCompiler` composition, add:

```js
  const alakazam50Compiler = createAlakazam50Compiler({
    baseCompiler: alakazamTierCompiler
  });
  const alakazam50TierCompiler = createAlakazam50TierCompiler({
    baseCompiler: alakazamTierCompiler,
    alakazam50Compiler
  });
```

In `createAlakazamFulfillmentWorker`, replace only the F-03 wrapper values:

```js
      repository: alakazam50FulfillmentRepository,
      compiler: alakazam50TierCompiler,
```

Keep the F-03 multi-file `publicationPort` unchanged. The $50 compiler preserves
the exact immutable photo assets and HTML reference produced by the $35 layer.

Immediately after the F-03 readiness call, add:

```js
  await alakazam50.readiness();
```

Add this option beside `alakazam35` in `createHostedApi(service, { ... })`:

```js
        alakazam50,
```

Do not change the existing Alakazam worker enable predicate. Without a
separately approved commercial release, Privacy V4, real Stripe identifiers,
and a removed publication hold, the worker remains held and no provider effect
can run.

## `server/hosted/http.mjs`

Add this import beside the F-03 held boundary:

```js
import {
  createHeldHostedAlakazam50
} from "../commerce-v2/hosted-alakazam-50.mjs";
```

Add this option beside `alakazam35 = null`:

```js
    alakazam50 = null,
```

Validate the boundary beside F-03:

```js
  const alakazam50Boundary =
    alakazam50 ?? createHeldHostedAlakazam50();
  invariant(
    [
      "getSnapshot",
      "readiness",
      "requestCare",
      "saveConfiguration"
    ].every(
      (method) =>
        typeof alakazam50Boundary[method] === "function"
    ),
    "RUNTIME_CONFIGURATION_ERROR",
    "Hosted Alakazam $50 boundary is invalid.",
    { status: 500 }
  );
```

Read its held readiness in `GET /api/v1/capabilities` and add:

```js
              alakazam50:
                alakazam50Readiness.authorization === true &&
                alakazam50Readiness.providerEffects === false,
```

Add this authenticated GET branch beside the F-03 controls:

```js
        } else if (
          method === "GET" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/alakazam\/50$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before managing Alakazam $50 controls.",
            { status: 401 }
          );
          exactRouteQuery(
            url,
            [],
            "ALAKAZAM_50_ROUTE_BINDING_REJECTED",
            "Alakazam $50 controls accept no query parameters."
          );
          result = await alakazam50Boundary.getSnapshot(actor, route[0]);
```

Add these authenticated write branches before the quote route. Existing write
handling must continue to require CSRF and `Idempotency-Key`.

```js
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/alakazam\/50\/configurations$/u
          ))
        ) {
          invariant(actor !== null, "AUTHENTICATION_REQUIRED",
            "Sign in before managing Alakazam $50 controls.", { status: 401 });
          exactRouteQuery(url, [], "ALAKAZAM_50_ROUTE_BINDING_REJECTED",
            "Alakazam $50 configurations accept no query parameters.");
          const selected = exactRouteBody(body, [
            "borderChoiceId",
            "cashAppHandle",
            "expectedCurrentRevision",
            "fontChoiceId",
            "menu",
            "venmoHandle"
          ], "ALAKAZAM_50_ROUTE_BINDING_REJECTED",
            "The Alakazam $50 configuration is invalid.");
          result = await alakazam50Boundary.saveConfiguration(actor, route[0], {
            ...selected,
            commandId: write.commandId
          });
          status = 202;
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/alakazam\/50\/care-requests$/u
          ))
        ) {
          invariant(actor !== null, "AUTHENTICATION_REQUIRED",
            "Sign in before managing Alakazam $50 controls.", { status: 401 });
          exactRouteQuery(url, [], "ALAKAZAM_50_ROUTE_BINDING_REJECTED",
            "Alakazam $50 care requests accept no query parameters.");
          const selected = exactRouteBody(body, ["message"],
            "ALAKAZAM_50_ROUTE_BINDING_REJECTED",
            "The Alakazam $50 care request is invalid.");
          result = await alakazam50Boundary.requestCare(actor, route[0], {
            ...selected,
            commandId: write.commandId
          });
          status = 202;
```

These routes append held evidence only. They must not receive a Stripe,
publication, tenant-runtime, or provider port.

## Customer artifact

Add these sorted staging assets:

```js
  "abracadabra/app/abracadabra-alakazam-50.css",
  "abracadabra/app/abracadabra-alakazam-50.js",
```

Load the stylesheet after the F-03 stylesheet and the script after the F-03
script. Mount the standalone panel only for an exact active or grace
`alakazam_50` account, under the existing held public-offer gate:

```js
    alakazam50Panel = windowRef.SiteSourceryAlakazam50.mount({
      documentRef,
      container: alakazamPanel.element,
      projectId: selectedProjectId
    });
```

Destroy it when project, account, or subscription authority changes. The panel
contains no Stripe, publication, rollback, unpublish, or provider command.

## `scripts/hosted-truth/manifest.mjs`

Add these exact entries after integrating the lane:

```js
  "abracadabra/app/abracadabra-alakazam-50.css":
    "5615189885bf84667cb28c8657f730b77cc40eb619c29460d5b33dce876ea167",
  "abracadabra/app/abracadabra-alakazam-50.js":
    "48d0e3ad2624c0b1d7b7a80f3f97606157a0078d987f1a48c144d0f3a326a43f",
```

Do not add a released offer slot or change held public copy.

## Integration checks

Extend hosted HTTP tests for authentication, exact query/body binding, CSRF,
idempotency, lower-tier and stale-revision rejection, held readiness, and zero
provider calls. Compose F-03 before F-04 so the exact photo/section/history
authority remains the base fulfillment. Run
`scripts/browser-audit-alakazam-50.mjs` unchanged at all three viewports.
