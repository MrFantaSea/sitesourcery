# L1 wiring notes: F-03 Alakazam $35 fulfillment

This lane deliberately does not edit `server/hosted/http.mjs`,
`server/hosted/postgres-service.mjs`, or
`scripts/hosted-truth/manifest.mjs`. Alakazam remains commercially **HELD**.
The release lane must apply only the following composition changes after this
commit is integrated.

## `server/hosted/bin/server.mjs`

Add this import beside the other hosted Alakazam composition imports:

```js
import {
  createAlakazam35Composition
} from "../alakazam-35-composition.mjs";
import {
  createAlakazam35Compiler
} from "../alakazam-35-compiler.mjs";
import {
  createAlakazam35FulfillmentRepository,
  createAlakazam35TierCompiler
} from "../alakazam-35-fulfillment.mjs";
import {
  createPostgresAlakazam35Repository
} from "../alakazam-35-postgres.mjs";
import {
  createAlakazam35PublicationPort
} from "../alakazam-35-publication-port.mjs";
```

Immediately after `alakazamRepository` is composed, add:

```js
  const alakazam35Repository =
    createPostgresAlakazam35Repository({ authority });
  const alakazam35 = createAlakazam35Composition({
    repository: alakazam35Repository,
    resolveSession: commerceV2.resolveSession,
    clock: commerceV2.clock
  });
  const alakazamFulfillmentRepository =
    createAlakazam35FulfillmentRepository({
      baseRepository: alakazamRepository,
      tierRepository: alakazam35Repository
    });
```

Immediately after the existing `compiler` is composed, add:

```js
  const alakazam35Compiler = createAlakazam35Compiler({
    baseCompiler: compiler
  });
  const alakazamTierCompiler = createAlakazam35TierCompiler({
    baseCompiler: compiler,
    alakazam35Compiler
  });
```

Replace only the existing `publicationPort` construction after
`tenantRuntime` opens with:

```js
  const publicationPort = createAlakazam35PublicationPort({
    runtime: tenantRuntime,
    assetRepository: alakazam35Repository,
    clock: commerceV2.clock
  });
```

In the existing `createAlakazamFulfillmentWorker` call, replace only these two
properties:

```js
      repository: alakazamFulfillmentRepository,
      compiler: alakazamTierCompiler,
```

Immediately after the existing Alakazam readiness calls, add:

```js
  await alakazam35.readiness();
```

Add this property to the options passed to `createHostedApi(service, { ... })`
immediately after `alakazamAccount`:

```js
        alakazam35,
```

The readiness result must remain `state: "held"`, `authorization: true`, and
`providerEffects: false`. Do not connect a Stripe port or change the existing
worker enable predicate. Without a separately approved Alakazam commercial
release and removed publication hold, the worker remains `held_not_started`
and no provider effect can run.

## `server/hosted/http.mjs`

Add this import beside the other held Alakazam imports:

```js
import {
  createHeldHostedAlakazam35
} from "../commerce-v2/hosted-alakazam-35.mjs";
```

Add this option immediately after `alakazamAccount = null` in the
`createHostedApi` options:

```js
    alakazam35 = null,
```

Immediately after `alakazamAccountBoundary` is validated, add:

```js
  const alakazam35Boundary =
    alakazam35 ?? createHeldHostedAlakazam35();
  invariant(
    [
      "getSnapshot",
      "readiness",
      "requestCare",
      "saveConfiguration",
      "uploadPhoto"
    ].every(
      (method) =>
        typeof alakazam35Boundary[method] === "function"
    ),
    "RUNTIME_CONFIGURATION_ERROR",
    "Hosted Alakazam $35 boundary is invalid.",
    { status: 500 }
  );
```

In `GET /api/v1/capabilities`, read its readiness beside the other Alakazam
boundaries:

```js
          const alakazam35Readiness =
            await alakazam35Boundary.readiness();
```

Add this capability immediately after the other Alakazam capabilities:

```js
              alakazam35:
                alakazam35Readiness.authorization === true &&
                alakazam35Readiness.providerEffects === false,
```

Add this authenticated GET branch beside the Alakazam account routes:

```js
        } else if (
          method === "GET" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/alakazam\/35$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before managing Alakazam $35 controls.",
            { status: 401 }
          );
          exactRouteQuery(
            url,
            [],
            "ALAKAZAM_35_ROUTE_BINDING_REJECTED",
            "Alakazam $35 controls accept no query parameters."
          );
          result = await alakazam35Boundary.getSnapshot(
            actor,
            route[0]
          );
```

Add these three authenticated POST branches before the quote route. Every
branch uses the existing write boundary, so CSRF and `Idempotency-Key` remain
mandatory and `write.commandId` is the only command identity.

```js
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/alakazam\/35\/photos$/u
          ))
        ) {
          invariant(actor !== null, "AUTHENTICATION_REQUIRED",
            "Sign in before managing Alakazam $35 controls.", { status: 401 });
          exactRouteQuery(url, [], "ALAKAZAM_35_ROUTE_BINDING_REJECTED",
            "Alakazam $35 photo uploads accept no query parameters.");
          const selected = exactRouteBody(body,
            ["mediaBase64", "mediaType"],
            "ALAKAZAM_35_ROUTE_BINDING_REJECTED",
            "The Alakazam $35 photo upload is invalid.");
          result = await alakazam35Boundary.uploadPhoto(actor, route[0], {
            ...selected,
            commandId: write.commandId
          });
          status = 202;
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/alakazam\/35\/configurations$/u
          ))
        ) {
          invariant(actor !== null, "AUTHENTICATION_REQUIRED",
            "Sign in before managing Alakazam $35 controls.", { status: 401 });
          exactRouteQuery(url, [], "ALAKAZAM_35_ROUTE_BINDING_REJECTED",
            "Alakazam $35 configurations accept no query parameters.");
          const selected = exactRouteBody(body, [
            "expectedCurrentRevision",
            "fontChoiceId",
            "photoAssetId",
            "sections"
          ], "ALAKAZAM_35_ROUTE_BINDING_REJECTED",
            "The Alakazam $35 configuration is invalid.");
          result = await alakazam35Boundary.saveConfiguration(actor, route[0], {
            ...selected,
            commandId: write.commandId
          });
          status = 202;
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/alakazam\/35\/care-requests$/u
          ))
        ) {
          invariant(actor !== null, "AUTHENTICATION_REQUIRED",
            "Sign in before managing Alakazam $35 controls.", { status: 401 });
          exactRouteQuery(url, [], "ALAKAZAM_35_ROUTE_BINDING_REJECTED",
            "Alakazam $35 care requests accept no query parameters.");
          const selected = exactRouteBody(body, ["message"],
            "ALAKAZAM_35_ROUTE_BINDING_REJECTED",
            "The Alakazam $35 care request is invalid.");
          result = await alakazam35Boundary.requestCare(actor, route[0], {
            ...selected,
            commandId: write.commandId
          });
          status = 202;
```

No route applies a media, care, Stripe, publication, or provider effect. The
POST routes append immutable held evidence and return the refreshed snapshot.

## Customer artifact

Add these two files to `hostedStagingAssets` in
`scripts/configure-abracadabra-hosted-staging.mjs`, keeping the array sorted:

```js
  "abracadabra/app/abracadabra-alakazam-35.css",
  "abracadabra/app/abracadabra-alakazam-35.js",
```

Add the stylesheet to the hosted app head immediately after
`abracadabra-app.css`, and add the script immediately before
`abracadabra-customer-control-dom.js`:

```html
  <link rel="stylesheet" href="/abracadabra/app/abracadabra-alakazam-35.css">
  <script src="/abracadabra/app/abracadabra-alakazam-35.js" defer></script>
```

In `abracadabra-customer-control-dom.js`, mount the standalone panel only after
the existing Alakazam account projection verifies an active `alakazam_35` or
`alakazam_50` subscription. Destroy it when the selected project, account, or
subscription authority changes. Use exactly:

```js
    alakazam35Panel = windowRef.SiteSourceryAlakazam35.mount({
      documentRef,
      container: alakazamPanel.element,
      projectId: selectedProjectId
    });
```

Keep the existing `ALAKAZAM_PUBLIC_OFFER_STATE === "released"` gate around the
customer Alakazam room. The module is built and proven while the shipped
commercial surface remains held.

## `scripts/hosted-truth/manifest.mjs`

Add these exact entries to `hostedStagingAssetSha256` after integrating this
lane:

```js
  "abracadabra/app/abracadabra-alakazam-35.css":
    "f626e50f198761409fd10db139c70f442880d0c6ecc22b31cf707bd9312e8585",
  "abracadabra/app/abracadabra-alakazam-35.js":
    "14604957e98d8f94f4143bbbfac0b0e722b068aa29b56560ff4028d41d01c431",
```

Do not add a released offer slot or change held public copy.

## Compiler and publication boundary

`server/hosted/alakazam-35-compiler.mjs` is the complete deterministic
multi-file compiler. It reads the immutable configuration/photo binding,
masks disabled sections, applies the expanded font class, rejects `$50`
fields, and emits HTML plus the exact referenced immutable asset.

`server/hosted/alakazam-35-fulfillment.mjs` binds the exact current durable
configuration and immutable media bytes to a claimed `$35` or `$50` operation
under a non-enumerable internal symbol. Customer JSON cannot supply that
binding. `$25` claims continue through the unchanged Spark compiler.

`server/hosted/alakazam-35-publication-port.mjs` wraps the existing self-host
publication port. It resolves the sole referenced header asset from PostgreSQL,
verifies path, media type, digest, and bytes, and installs the HTML and asset in
one release. A missing, substituted, or duplicate asset reference rejects the
release. Publications without an Alakazam header remain unchanged.

Do not pass the multi-file compiler directly to the worker without both the
claim decorator and publication adapter above. Silently dropping the immutable
asset is forbidden.

## Integration checks

After applying the wiring, extend hosted HTTP tests to prove authentication,
CSRF, idempotency, no-query/exact-body rejection, `$25` and stale-revision
rejection, held readiness, three-version projection, and zero provider calls.
Run `scripts/browser-audit-alakazam-35.mjs` unchanged at all three viewports.
