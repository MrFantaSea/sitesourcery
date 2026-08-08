# L1 wiring notes: F-08 Alakazam publication controls

This lane deliberately does not edit `server/hosted/http.mjs`,
`server/hosted/postgres-service.mjs`, or
`scripts/hosted-truth/manifest.mjs`. The release lane must apply the following
composition changes after this commit is integrated.

## `server/hosted/bin/server.mjs`

Add this import beside the other hosted composition imports:

```js
import {
  createAlakazamPublicationComposition
} from "../alakazam-publication-composition.mjs";
```

Immediately after `alakazamAccount` is composed, add:

```js
  const alakazamPublication =
    createAlakazamPublicationComposition({
      authority,
      resolveSession: commerceV2.resolveSession,
      clock: commerceV2.clock
    });
```

Immediately after `await customBuildHandoff.readiness();`, add:

```js
  await alakazamPublication.readiness();
```

Add this property to the options passed to `createHostedApi(service, { ... })`,
immediately after `alakazamAccount`:

```js
        alakazamPublication,
```

The readiness result must remain `state: "held"`,
`authorization: true`, and `providerEffects: false`. Do not connect a tenant
runtime, publication provider, Stripe port, or live-effect worker.

## `server/hosted/http.mjs`

Add this import beside the other hosted Alakazam imports:

```js
import {
  createHeldHostedAlakazamPublication
} from "../commerce-v2/hosted-alakazam-publication.mjs";
```

Add this option immediately after `alakazamAccount = null` in the
`createHostedApi` options:

```js
    alakazamPublication = null,
```

Immediately after `alakazamAccountBoundary` is validated, add:

```js
  const alakazamPublicationBoundary =
    alakazamPublication ??
    createHeldHostedAlakazamPublication();
  invariant(
    typeof alakazamPublicationBoundary.readiness ===
      "function" &&
      typeof alakazamPublicationBoundary.getSnapshot ===
        "function" &&
      typeof alakazamPublicationBoundary.requestCommand ===
        "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Hosted Alakazam publication boundary is invalid.",
    { status: 500 }
  );
```

In `GET /api/v1/capabilities`, immediately after `const alakazam = ...`, add:

```js
          const alakazamPublicationReadiness =
            await alakazamPublicationBoundary.readiness();
```

Add this capability immediately after `alakazamDowngrade`:

```js
              alakazamPublication:
                alakazamPublicationReadiness.authorization ===
                  true &&
                alakazamPublicationReadiness.providerEffects ===
                  false,
```

Add this authenticated GET branch immediately after the existing
`GET /api/v1/projects/:projectId/alakazam` branch:

```js
        } else if (
          method === "GET" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/alakazam\/publication$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before viewing Alakazam publication.",
            { status: 401 }
          );
          exactRouteQuery(
            url,
            [],
            "ALAKAZAM_PUBLICATION_ROUTE_BINDING_REJECTED",
            "Alakazam publication accepts no query parameters."
          );
          result =
            await alakazamPublicationBoundary.getSnapshot(
              actor,
              route[0]
            );
```

Add this authenticated POST branch immediately before the existing
`POST /api/v1/projects/:projectId/alakazam-quotes` branch:

```js
        } else if (
          method === "POST" &&
          (route = match(
            pathname,
            /^\/api\/v1\/projects\/([^/]+)\/alakazam\/publication-commands$/u
          ))
        ) {
          invariant(
            actor !== null,
            "AUTHENTICATION_REQUIRED",
            "Sign in before managing Alakazam publication.",
            { status: 401 }
          );
          exactRouteQuery(
            url,
            [],
            "ALAKAZAM_PUBLICATION_ROUTE_BINDING_REJECTED",
            "Alakazam publication commands accept no query parameters."
          );
          const publicationBody = exactRouteBody(
            body,
            [
              "action",
              "snapshotDigest",
              "targetReleaseId"
            ],
            "ALAKAZAM_PUBLICATION_ROUTE_BINDING_REJECTED",
            "The Alakazam publication command is invalid."
          );
          result =
            await alakazamPublicationBoundary.requestCommand(
              actor,
              route[0],
              {
                ...publicationBody,
                commandId: write.commandId
              }
            );
          status = 202;
```

Do not expose a route that applies a publication effect. These routes read
authority and append immutable held customer commands only.

## `server/hosted/postgres-service.mjs`

No change is required. The dedicated repository uses the existing canonical
Postgres authority service and sets customer/organization transaction context
itself.

## `scripts/hosted-truth/manifest.mjs`

After integrating this lane, replace only these two values in
`hostedStagingAssetSha256`:

```js
  "abracadabra/app/abracadabra-api.js":
    "614d3f415baffc27997ffc53a5e3f1fcde1f7656a0ab880ac7cd03ffecf6fbfd",
  "abracadabra/app/abracadabra-customer-control-dom.js":
    "5be56ba89c9a2e4b124a51c74a7b3a14db1d3e59ab29af9e389ffd761064f3e0",
```

Do not add a release slot or alter held-copy truth. The browser artifact remains
HELD through the existing `ALAKAZAM_PUBLIC_OFFER_STATE` gate.

## Integration checks

After applying the wiring, extend the hosted HTTP tests to prove:

- the default boundary returns `503 ALAKAZAM_PUBLICATION_HELD`;
- capabilities expose `alakazamPublication: false` for the default boundary;
- the composed held boundary exposes `alakazamPublication: true` while its
  readiness still reports `providerEffects: false`;
- GET rejects authentication failures and non-empty queries;
- POST rejects authentication, CSRF, missing/invalid idempotency keys, extra or
  missing body keys, stale snapshot digests, and rogue rollback targets;
- successful GET returns the exact project-bound snapshot and successful POST
  returns `202` with an immutable held command;
- no publication provider, tenant runtime, billing provider, or Stripe method is
  invoked by either route.
