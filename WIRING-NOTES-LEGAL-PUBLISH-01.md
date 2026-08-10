# LEGAL-PUBLISH-01 wiring notes

This packet is additive. It adds held legal-publication semantics that separate
the immutable approved/effective **basis** (the sealed legal-authority tuple:
approved version alias + effective UTC instant + content digest + byte count)
from the operational **`publishedAt`** (when a Pages artifact was actually
published). It wires nothing into a composition root, dispatches nothing,
mutates no DNS/provider/production state, and grants no capability. Every path
is HELD by default and fails closed.

Composition is EXCLUDED from this packet. The steps below are the exact lines a
future composition packet must add, and where. Do not apply them here.

## Files owned by this packet

- `server/hosted/legal-publication.mjs` — modes, basis sealing, held record.
- `server/hosted/legal-publication-verify.mjs` — the fail-closed verifier.
- `server/hosted/legal-publication-control.mjs` — one-shot owner receipt, the
  single-use ledger, and held -> published application.
- `server/hosted/test/legal-publication.test.mjs` — focused tests.
- `WIRING-NOTES-LEGAL-PUBLISH-01.md`

`npm run check:hosted-service` already discovers the three modules through the
existing `node --check server/hosted/*.mjs` glob, and `npm run test:hosted-service`
already runs the focused test through the existing `server/hosted/test/*.test.mjs`
glob. No `package.json` change is required.

## What the modules provide

- `sealPublicationBasis(tuple)` / `ensureSealedBasis(basis)` — validate and
  freeze the referenced sealed tuple. The unsealed sentinel
  (`SS-HOSTED-PRIVACY-V4-UNSEALED`, etc.) and any absent/invalid field fail
  closed, exactly as `project-legal-authority.mjs` rejects them. The tuple is
  never re-derived or mutated; an already-sealed basis passes through by
  identity after a digest-integrity check.
- `createHeldPublication({ basis, mode, publishedAt })` — a publication STATE
  that carries the sealed basis alongside an OPTIONAL `publishedAt`, and is HELD
  by default (`state: "held"`, `published: false`, `effect: null`). It never
  produces a publish effect and never generates `publishedAt`.
- `PUBLICATION_MODE` / `describePublicationMode(mode)` — the two explicit modes.
  `pages-fallback` (apex served by GitHub Pages, backend absent and held) is a
  first-class named mode, distinct in every field from `hosted-backend`.
- `createOwnerPublicationReceipt({ basis, mode, owner, effectiveAt, publishedAt })`
  — a single-use, owner-authorized receipt. It ACCEPTS the timestamps and owner
  facts and NEVER generates, guesses, or defaults them. Identity is a
  deterministic content-address, so a second construction over the same basis
  and owner facts yields the byte-identical receipt and no second effect.
- `createPublicationControlLedger()` / `applyOwnerPublicationReceipt(held, receipt)`
  — record at most one effect per basis; a re-applied identical receipt is a
  replay; a different effect for an already-controlled basis fails closed.
- `verifyPublicationRecord(record)` / `verifyOwnerPublicationReceipt(receipt)` —
  reject on unsealed / missing / mismatched basis, on `publishedAt` asserted
  without a sealed effective basis, on absent owner facts, and on any tamper of
  the deterministic receipt identity or mode descriptor.

## Composition (a future packet only — do NOT apply in this packet)

### 1. Build a sealed basis from the existing legal authority

The authority object already produced at `server/hosted/bin/server.mjs`
(currently near line 743, `createProjectLegalAuthorityFromEnvironment()`) exposes
`.documents[i]` (`kind`, `version`, `contentDigest`, `contentUri`, `effectiveAt`)
and `.artifactBindings[i]` (`kind`, `artifactUri`, `artifactSha256`, `byteCount`).
A composer builds the basis without touching legal content:

```js
import { sealPublicationBasis } from "../legal-publication.mjs";

const privacyDoc = projectLegalAuthorityConfig.authority.documents[0];
const privacyBinding = projectLegalAuthorityConfig.authority.artifactBindings[0];
const privacyBasis = sealPublicationBasis({
  kind: privacyDoc.kind,
  version: privacyDoc.version,          // e.g. SS-HOSTED-PRIVACY-2026-08-09-V4
  effectiveAt: privacyDoc.effectiveAt,  // the SEALED effective instant
  contentDigest: privacyDoc.contentDigest,
  byteCount: privacyBinding.byteCount,
  authorityDigest: projectLegalAuthorityConfig.authority.authorityDigest,
  artifactUri: privacyBinding.artifactUri
});
```

When the authority is held (diagnostic present, `authority === null`), there is
no sealed basis; keep the publication held and surface the diagnostic. Do not
substitute the unsealed sentinel — `sealPublicationBasis` will reject it.

### 2. Register a HELD publication boundary in the API options

`createHostedApi(service, { ... })` (`server/hosted/http.mjs`, currently near
line 417) takes an options bag of boundaries that each default to a held
implementation (see `alakazamPublication`). Add a `legalPublication` boundary the
same way, built from `createHeldPublication({ basis, mode: PUBLICATION_MODE.PAGES_FALLBACK })`.
Default the mode to `pages-fallback`: while the apex is served by GitHub Pages and
the hosted backend is held, that is the true serving mode. Pass it in the options
object at the `createHostedApi(service, {` call in `server/hosted/bin/server.mjs`
(currently near line 825). Do not AND it into any customer capability; it carries
no publish effect.

### 3. Owner receipt (only when the owner supplies the facts)

A publish EFFECT exists only once an owner supplies real facts. These are
owner-fact dependencies this packet must not invent:

- `owner` = `{ ownerId, authorization }` — the owner's real id and a real
  authorization reference;
- `effectiveAt` — must equal the sealed basis effective instant;
- `publishedAt` — the real UTC instant the Pages artifact was actually served.

A composition packet reads these from an owner-supplied receipt input (for
example a finalization proof under `ops/releases/joint-legal-v4-2026-08-09T214211Z/proof/`,
alongside `joint-legal-v4-release-constants.json`), never from a clock or a
default, then:

```js
import {
  createOwnerPublicationReceipt,
  createPublicationControlLedger
} from "../legal-publication-control.mjs";

const receipt = createOwnerPublicationReceipt({
  basis: privacyBasis,
  mode: PUBLICATION_MODE.PAGES_FALLBACK,
  owner,          // owner-supplied
  effectiveAt,    // owner-supplied, == basis.effectiveAt
  publishedAt     // owner-supplied
});
const ledger = createPublicationControlLedger();
ledger.apply(receipt); // idempotent; single-use per basis
```

If any of `owner`, `effectiveAt`, or `publishedAt` is absent, the constructor
throws `PUBLICATION_OWNER_FACT_REQUIRED` and the packet must report it as an
owner-fact dependency — it must not proceed with a guessed value.

### 4. Pages build (`scripts/build-pages.mjs`)

The Pages build already accepts `--joint-legal-v4-finalization DIR`. If a future
packet wants the built artifact to record a `publishedAt`, it must read that
instant from the owner-supplied finalization receipt in that DIR and pass it to
`createHeldPublication` / `createOwnerPublicationReceipt`. The build must never
synthesize `publishedAt`, and must leave `effectiveAt` bound to the sealed basis.

## Promotion boundary

`createHeldPublication` never publishes. The only transition to a published
record is `applyOwnerPublicationReceipt(held, verifiedReceipt)`, gated by a
single-use ledger. Dependency on a sealed basis is not a publish effect, and a
recorded Pages `publishedAt` in `pages-fallback` mode does not release the held
hosted backend. A future reviewed packet must supply the owner facts and wire the
boundary; it may not be half-wired by defaulting any owner fact.
