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

The current loopback-only production rehearsal and its independently verified
encrypted backup/restore are documented in
`ops/production-rehearsal/README.md` and
`ops/PRODUCTION-BACKUP-RESTORE-2026-08-02.md`.

## Local verification

Use exactly Node 24.18.0:

```sh
nvm use
npm ci
npm test
```

`npm test` checks the current site, browser and service contracts; builds both
reviewed artifacts; and opens every hosted route at 320, 390, and 1440 pixels
in the pinned browser. The browser gate also opens the hosted account room and
drives Look → Business → Review → Preview without making a write or payment.

`npm run check:legacy`, `npm run audit:browser:legacy`,
`npm run audit:hosted-domain-browser:legacy`, and
`npm run test:public-truth:legacy` preserve retired exact-copy, route, and
six-step contracts for historical inspection. They are not release gates for
the current product. Publication, checkout, registrar, and DNS effects remain
separate owner-authorized operations.
