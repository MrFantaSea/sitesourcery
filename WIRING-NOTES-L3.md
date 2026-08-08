# WIRING-NOTES-L3 — Alakazam billing surfaces (A-03, E-08, E-09)

Lane L3 owns `server/hosted/alakazam-billing*.mjs` and the account-UI billing
views. Per the hot-file rule in
`/private/tmp/sitesourcery-build-architecture-20260808.md`, L3 did **not** edit
`server/hosted/http.mjs`, `server/hosted/postgres-service.mjs`,
`scripts/hosted-truth/manifest.mjs`, `server/hosted/bin/server.mjs`, or any file
under `abracadabra/**` that another lane owns. Everything below is for L4 to
apply during integration.

Nothing here changes the hold. Every surface is a read, no provider call is
made, and the default runtime keeps all three surfaces held.

## Files this lane added (already committed, no wiring needed)

| File | Row | What it is |
|---|---|---|
| `server/hosted/alakazam-billing-invoice.mjs` | A-03 | Customer-safe invoice document projection |
| `server/hosted/alakazam-billing-cancellation.mjs` | E-08 | Cancellation preview + Billing Portal entry state |
| `server/hosted/alakazam-billing-states.mjs` | E-09 | Retry / replay / reconciliation projection + anti-stale rule |
| `server/hosted/alakazam-billing-postgres.mjs` | A-03, E-09 | Account-bound PostgreSQL reads |
| `server/hosted/alakazam-billing.mjs` | all | Held + composed boundary, route matcher, route reader |
| `abracadabra/app/abracadabra-billing-views.js` | all | Account-UI verifiers and presentations |

Tests: `server/hosted/test/alakazam-billing-{invoice,cancellation,states}.test.mjs`,
`server/hosted/test/alakazam-billing-postgres.integration.test.mjs`,
`scripts/test/abracadabra-billing-views.test.mjs`,
`scripts/test/abracadabra-billing-views-browser.test.mjs`.

## 1. `server/hosted/http.mjs`

### 1a. Import — add after the `hosted-alakazam-billing.mjs` import (line 11)

```js
import {
  createHeldHostedAlakazamBillingSurfaces,
  matchAlakazamBillingSurfaceRoute,
  readAlakazamBillingSurface
} from "./alakazam-billing.mjs";
```

### 1b. Option — add to the `createHostedApi` destructuring, after `alakazamBilling = null,` (line 383)

```js
    alakazamBillingSurfaces = null,
```

### 1c. Boundary — add after the `alakazamBillingBoundary` invariant (ends line 568)

```js
  const alakazamBillingSurfacesBoundary =
    alakazamBillingSurfaces ??
    createHeldHostedAlakazamBillingSurfaces();
  invariant(
    typeof alakazamBillingSurfacesBoundary.getInvoice ===
      "function" &&
      typeof alakazamBillingSurfacesBoundary
        .getCancellationPreview === "function" &&
      typeof alakazamBillingSurfacesBoundary
        .getBillingStates === "function",
    "RUNTIME_CONFIGURATION_ERROR",
    "Hosted Alakazam billing surfaces boundary is invalid.",
    { status: 500 }
  );
```

### 1d. Route variable — add beside `let route;` (line 826)

```js
        let alakazamBillingSurface;
```

### 1e. Route branch — add immediately after the existing `GET /api/v1/projects/:projectId/alakazam` branch (ends line 1853)

```js
        } else if (
          (alakazamBillingSurface =
            matchAlakazamBillingSurfaceRoute(
              method,
              pathname
            ))
        ) {
          result = await readAlakazamBillingSurface(
            alakazamBillingSurfacesBoundary,
            actor,
            alakazamBillingSurface,
            url
          );
```

Placement is free: all three paths carry segments after `/alakazam/`, so they
cannot shadow or be shadowed by the existing `/alakazam` route. The matcher
returns `null` for every non-GET method and for any other path.

Routes registered by that one branch:

| Method | Path | Surface |
|---|---|---|
| GET | `/api/v1/projects/:projectId/alakazam/invoices/:receiptId` | A-03 invoice |
| GET | `/api/v1/projects/:projectId/alakazam/cancellation-preview` | E-08 preview |
| GET | `/api/v1/projects/:projectId/alakazam/billing-states` | E-09 states |

`readAlakazamBillingSurface` performs the query-string rejection itself
(`INVALID_ALAKAZAM_BILLING_QUERY`, 400), so no `exactRouteQuery` call is needed.
Authentication is enforced inside the boundary, exactly like
`alakazamAccountBoundary.getSnapshot`.

Held codes the default runtime returns (503): `ALAKAZAM_INVOICE_HELD`,
`ALAKAZAM_CANCELLATION_PREVIEW_HELD`, `ALAKAZAM_BILLING_STATES_HELD`.

## 2. `server/hosted/bin/server.mjs`

### 2a. Imports

```js
import {
  createPostgresAlakazamBillingRepository
} from "../alakazam-billing-postgres.mjs";
import {
  createHostedAlakazamBillingSurfaces
} from "../alakazam-billing.mjs";
```

### 2b. Composition — add after the existing `alakazamAccount` block (ends line 348)

```js
  const alakazamBillingSurfaces =
    createHostedAlakazamBillingSurfaces({
      repository:
        createPostgresAlakazamBillingRepository({
          authority
        }),
      account: createAlakazamAccountService({
        repository: alakazamRepository
      }),
      resolveSession: commerceV2.resolveSession
    });
```

If you prefer one account service instance, hoist the existing
`createAlakazamAccountService({ repository: alakazamRepository })` out of the
`createHostedAlakazamAccount` call into a `const alakazamAccountService` and pass
it to both. Either shape satisfies
`server/hosted/test/http-alakazam-account.test.mjs`'s source assertions.

### 2c. `createHostedApi` call — add to the options object beside `alakazamAccount,` (line 631)

```js
        alakazamBillingSurfaces,
```

## 3. `abracadabra/app/abracadabra-api.js`

Add three client methods next to `getAlakazamAccount` (line 3395), and export
them in the returned object next to `getAlakazamAccount:` (line 6220).

```js
    function getAlakazamInvoice(projectId, receiptId, requestOptions) {
      return request(
        "GET",
        "/projects/" + segment(projectId, "Project ID")
          + "/alakazam/invoices/"
          + segment(receiptId, "Alakazam receipt ID"),
        { signal: requestOptions && requestOptions.signal }
      );
    }

    function getAlakazamCancellationPreview(projectId, requestOptions) {
      return request(
        "GET",
        "/projects/" + segment(projectId, "Project ID")
          + "/alakazam/cancellation-preview",
        { signal: requestOptions && requestOptions.signal }
      );
    }

    function getAlakazamBillingStates(projectId, requestOptions) {
      return request(
        "GET",
        "/projects/" + segment(projectId, "Project ID")
          + "/alakazam/billing-states",
        { signal: requestOptions && requestOptions.signal }
      );
    }
```

Exports:

```js
      getAlakazamInvoice: getAlakazamInvoice,
      getAlakazamCancellationPreview: getAlakazamCancellationPreview,
      getAlakazamBillingStates: getAlakazamBillingStates,
```

## 4. `abracadabra/app/index.html` and `scripts/hosted-truth/manifest.mjs`

`abracadabra/app/abracadabra-billing-views.js` must be loaded before
`abracadabra-customer-control-dom.js`. Add the script tag to the existing script
list in `abracadabra/app/index.html`:

```html
    <script src="./abracadabra-billing-views.js" defer></script>
```

That edits a manifest-tracked file, so re-run the hosted-truth capture and
update the `abracadabra-app-scripts` slot's `sourceSha256` / `hostedSha256` in
`scripts/hosted-truth/manifest.mjs` (plus the matching fragment under
`scripts/hosted-truth/fragments/`). L3 did not touch either file.

## 5. `package.json` test scripts

`server/hosted/test/*.test.mjs` is a glob, so the three hosted suites and the
PostgreSQL integration suite are already picked up by `test:hosted-service`
(the integration suite skips itself without a database URL). The two UI suites
are not: `test:node` lists its files one by one. Append to that list:

```
scripts/test/abracadabra-billing-views.test.mjs
scripts/test/abracadabra-billing-views-browser.test.mjs
```

The browser suite needs `--experimental-websocket` (the same flag
`audit:browser` already uses) and the reviewed Chrome 149.0.7827.55. If you
would rather keep `test:node` flag-free, run it from `audit:browser` instead.

A PostgreSQL journey for this lane:

```
SITESOURCERY_PG_ALAKAZAM_BILLING_TEST_URL=postgresql://.../<disposable-db> \
  node --test server/hosted/test/alakazam-billing-postgres.integration.test.mjs
```

It also accepts `SITESOURCERY_PG_ALAKAZAM_TEST_URL`, so it runs alongside the
existing Alakazam contract journey without new configuration.

## 6. Account view wiring (whoever owns `abracadabra-customer-control-dom.js`)

The module exposes exactly what the account panel needs. It has no DOM
dependency and no globals beyond its own export.

```js
var billingViews = require("./abracadabra-billing-views.js");
// or window.SiteSourceryAlakazamBillingViews in the browser

billingViews.alakazamInvoicePresentation(response, projectId, receiptId)
billingViews.alakazamCancellationPreviewPresentation(response, projectId)
billingViews.alakazamBillingStatesPresentation(response, projectId)
billingViews.mergeAlakazamBillingStates(currentStates, nextStates)
```

Each `*Presentation` returns `null` for anything that is not the exact,
self-consistent document, in the same way `alakazamAccountPresentation` does.

**E-09 anti-stale requirement.** The account view must store the last billing
states it displayed and pass every new response through
`mergeAlakazamBillingStates(current, next)` before rendering. A replayed webhook
or a late response then cannot move the view backwards: `next` replaces
`current` only when its `revision` is higher, or its `revision` matches and its
`observedAt` is later. Refresh billing states alongside the account snapshot;
the two are independent reads and the states read is the one that carries the
freshness marker.

`abracadabra/app/abracadabra-billing-views.js` is safe to load unconditionally:
it registers one frozen object and runs nothing on load.
