# CUSTOMER-UX-01B wiring notes

## Existing browser composition

No excluded composition edit is required. `scripts/configure-abracadabra-hosted-staging.mjs` already injects these files, in authority order, immediately before `abracadabra-app.js` and the customer DOM boot:

```html
<script src="/abracadabra/app/abracadabra-api.js" defer></script>
<script src="/abracadabra/app/abracadabra-hosted-control.js" defer></script>
<script src="/abracadabra/app/abracadabra-customer-control-dom.js" defer></script>
```

The packet changes those existing assets only. `scripts/hosted-truth/manifest.mjs` contains their reviewed SHA-256 values, so the existing `scripts/build-hosted.mjs` staging verification remains fail-closed without another registration line.

## Existing server routes used

No server-authority file should be edited for this packet. The customer DOM reaches only methods already composed through the hosted control and API client:

- Project support: `POST /api/v1/projects/{projectId}/support-tickets`.
- Prepare export: `POST /api/v1/projects/{projectId}/exports`.
- Read export: `GET /api/v1/projects/{projectId}/exports/{exportId}`.
- Retry export: `POST /api/v1/projects/{projectId}/exports/{exportId}/retry`.
- Download export: `GET /api/v1/projects/{projectId}/exports/{exportId}/download?token={token}`.

The existing registrations are in `server/hosted/http.mjs`; this packet intentionally does not edit that composition root or `server/hosted/postgres-service.mjs`.

## Deliberately manual routes

There is no account-deletion API and no privacy-request API in the current exact client/server contract. Do not add a browser mutation or map either request to project deletion. Both controls route to `/legal/privacy/#contact`, the existing reviewed phone/email verification path. Project support also retains `/contact/#direct-contact` as its manual fallback.

## Release boundary

Integrate this commit without changing provider switches, Checkout URLs, legal/catalog authority, DNS, deployment, or held commercial controls. The local Checkout context contains only schema, purpose kind, project UUID, and creation time; it never grants payment, fulfillment, publication, or provider authority.
