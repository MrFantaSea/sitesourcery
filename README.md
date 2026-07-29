# Site Sourcery

This repository contains the customer website, the Abracadabra website
product, the Hive planning product, and the held infrastructure needed to run
them. The working release branch remains fail-closed: code can be built and
tested without authorizing a public deployment, a payment, a registrar call,
or a DNS change.

## Product boundaries

- The ordinary website and held build describe only what a customer can use in
  that build.
- Abracadabra compiles the released Spark one-page website contract. Hosted
  account, billing, address, export, cancellation, and publication controls
  are enabled only in the separately built hosted artifact.
- Hive is a guided planning tool. It produces a local plan and does not claim
  to activate an integration.
- Domain and payment adapters default to held implementations.
- Customer sites are served only from reviewed immutable releases after every
  entitlement, address, version, and publication gate passes.

## Repository map

- `abracadabra/`, `hive/`, and the route directories contain customer-facing
  product code.
- `scripts/` contains deterministic build and release checks.
- `server/commerce/` and `server/domain/` contain the provider-neutral purchase
  boundaries.
- `server/selfhost/` contains the held immutable static-site runtime.
- `ops/` contains held service and Caddy candidates; they are not installed by
  repository tests.

## Local verification

Use exactly Node 24.18.0:

```sh
nvm use
npm ci
npm run check
npm run test:node
npm run check:selfhost
```

The broader `npm test` command also builds the reviewed artifact and runs the
browser release gate. Publication, checkout, registrar, and DNS controls remain
separate owner-authorized operations.
