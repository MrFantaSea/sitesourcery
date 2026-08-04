# Site Sourcery Alakazam Fulfillment Inventory

Date: 2026-08-04

Evidence checkpoint: `671e094` on `build/sitesourcery-v2-20260730`

Status: Batch 2 implementation map; held/local; not public release authority

Scope: the owner-approved Alakazam `$25 / $35 / $50` ladder and its connection from payment-backed authority to generated and published customer behavior

## Authority and boundaries

This inventory is subordinate to, and must be read with:

- `ops/SITESOURCERY-MULTI-AGENT-ROADMAP-2026-08-04.md`
- `ops/SITESOURCERY-ACTIVE-RUN.md`
- the newest owner rulings in `ops/CONTINUITY.md`
- `ops/ALAKAZAM-BILLING-CONTRACT-2026-08-02.md`
- `ops/OFFER-BACKEND-MAP-2026-08-02.md`
- `server/commerce-v2/alakazam.mjs`

The committed checkpoint above is the evidence baseline. Concurrent uncommitted lead work is not counted here as fulfilled behavior.

Non-negotiable product truth:

- `$25`: hosted `label.sitesourcery.me`, Crystal/Hearth/Midnight, and publication of an accepted project version.
- `$35`: everything in `$25`, plus a photo header, expanded fonts, section toggles, no more than three customer-facing versions, and the owner-defined modest-care class.
- `$50`: everything in `$35`, plus Cash App, Venmo, a menu, extended font and border controls, and the owner-defined more-care class.
- Premium configuration survives a downgrade but is inaccessible and ineffective while the lower tier is active.
- A scheduled downgrade takes effect at the paid renewal boundary. The higher tier remains effective until then.
- No `$15` or `$30` Alakazam tier exists.
- Do not invent care quantities, response times, edit counts, cancellation/refund promises, custom-domain policy, or the final fine-grained font/border menu.
- The `$5` Download purchase is separate. It may be credited into Alakazam under the billing contract, but it is not hosted-tier authority.
- No browser flag, query string, local storage value, DOM state, price, or Stripe-facing identifier may grant a feature.
- No push, deployment, DNS mutation, provider mutation, or public claim is authorized by this document.

## Executive finding

The repository has three strong islands and one missing bridge:

1. The Alakazam catalog and subscription lifecycle are real, server-owned, revisioned, and tested.
2. The Maker/compiler/version store can generate deterministic site artifacts and preserve raw project facts.
3. The hosted platform can reserve `sitesourcery.me` addresses and safely publish, roll back, and unpublish immutable artifacts.
4. No production path connects island 1 to islands 2 and 3.

At checkpoint `671e094`, payment-backed tier authority stops at billing/account projection. The compiler accepts premium-looking browser facts without an Alakazam capability policy, while publication proves a different legacy subscription model. Therefore no Alakazam tier is vertically fulfilled yet, even though much of the machinery needed for fulfillment already exists.

The shortest route to a real product is not another isolated subsystem. It is one server-owned fulfillment seam followed immediately by a `$25` activation-to-live-site journey.

```text
Stripe evidence
      |
      v
ss.alakazam_subscriptions + revision
      |
      v
server-derived capabilities and limits
      |
      +----> effective Maker/compiler facts ----> accepted immutable artifact
      |                                                |
      +----> platform-address authority                v
      +----> publication authorization ----------> live label.sitesourcery.me
```

Every customer UI is a projection of this chain. Every write command must rederive the chain from the database; it must not trust the projection sent to the browser.

## Tier fulfillment matrix

Status vocabulary:

- **Real primitive**: implemented and meaningfully tested, but not necessarily connected to Alakazam.
- **Prototype/candidate**: useful code or UI exists, but it is not shipped authority and must not be counted as fulfillment.
- **Missing bridge**: real primitives exist on both sides, but no authoritative connection exists.
- **Missing**: the feature itself still needs implementation.
- **Owner-held**: implementation or release needs an owner redline that this inventory must not invent.

| Tier / behavior | What exists at the checkpoint | Actual status | Smallest missing fulfillment boundary |
| --- | --- | --- | --- |
| `$25` platform address | Licensed-address persistence and `label.sitesourcery.me` construction exist in the hosted service. | Real primitive, not activated by Alakazam | Bind an owner-selected available label to a project fulfillment intent, then allocate/confirm it idempotently from an active `$25+` subscription. Do not add custom-domain behavior. |
| `$25` Crystal/Hearth/Midnight | The compiler has three deterministic looks: internal `clear`, `warm`, `arcane`; UI names are Crystal, Hearth, Midnight. Existing tests prove different artifacts from the same content. | Real primitive | Make the server-derived policy admit only these base looks at `$25+`; reject unknown look claims and recompile server-side. |
| `$25` publish accepted version | Accepted-version, screening, release staging, exact-byte install, compensation, and serving bindings exist. | Missing bridge | Replace legacy generic-subscription proof with exact Alakazam subscription/revision/capability proof, then fulfill activation through the real publication port. |
| `$35` photo header | No photo field, upload boundary, media persistence, safe media policy, or multi-file Alakazam artifact exists. Current compiler tests intentionally produce inert one-file HTML without images. | Missing | Add project-owned immutable media, server validation, photo-header facts, deterministic compile provenance, and publication of the HTML plus referenced immutable asset. |
| `$35` expanded fonts | Maker/compiler expose only `standard` and one `alt` pair, currently without tier authority. | Prototype/candidate | Owner freezes the curated expanded set; compiler policy admits that set at `$35+`, while `$25` masks preserved values to base. |
| `$35` section toggles | Sections disappear only when their content is empty. There is no explicit entitlement-aware toggle configuration. | Missing | Add preserved section visibility facts and server-enforced `$35+` rendering. Content emptiness is not a substitute for the feature. |
| `$35` three-version history | Immutable versions and artifacts are stored without a customer-facing three-version limit; Maker-local history is also not the paid hosted contract. | Missing bridge | At `$35+`, expose/action at most the current accepted version plus two prior accepted versions. Keep older immutable audit rows internally unless a separate deletion policy is approved. `$25` does not receive paid history controls. |
| `$35` modest care | Generic support-ticket tables and a generic create-ticket route exist. No Alakazam care authorization, accounting, or approved modest-care boundary exists. | Owner-held | Do not expose the generic route as paid care. Wait for the owner to define the boundary, then authorize and account for that exact boundary at `$35+`. |
| `$50` Cash App and Venmo | Handle validation and rendered buttons exist in the compiler and source Maker. Old prototype UI incorrectly associates them with generic Alakazam/`$25` unlock state. | Prototype/candidate and presently unsafe if treated as authority | Preserve the configured handles, mask them from `$25/$35` effective facts, and render them only from server-authorized `$50` compiles. Remove the old tier claim from shipped UI. |
| `$50` menu | The compiler automatically emits navigation when sections/actions exist. There is no `$50` customer menu configuration or entitlement. | Prototype behavior, not the promised feature | Owner freezes what customer-configurable “menu” means; then add preserved menu facts and `$50`-only server rendering. Automatic navigation for all sites cannot be counted as `$50` fulfillment. |
| `$50` extended fonts and borders | One alternate font pair and three border styles exist and are not separated into `$35` versus `$50` authority. | Prototype/candidate | Owner freezes the final expanded/extended sets. Enforce base, expanded, and extended classes in the compiler policy; extended border choices are `$50` only. |
| `$50` more care | Same generic support machinery as `$35`; no approved more-care boundary. | Owner-held | Wait for the owner redline; do not infer “more” as minutes, edits, priority, or response time. |
| Preserve premium configuration while inactive | Draft/version `raw_facts` JSON and immutable artifacts can preserve facts. | Real storage primitive; effective masking is missing | Separate configured facts from effective facts. Downgrade must never overwrite premium values; preview/version/publication must ignore them until authority returns. |
| Publish / rollback / unpublish | HTTP/API methods, database staging, publication adapter, rollback, unpublish, idempotency, compensation, and real PostgreSQL tests exist. The currently shipped customer artifact deliberately omits controls. | Real generic primitive; Alakazam authorization and customer journey are missing | Re-authorize all three commands against the current Alakazam revision and capability, project membership, accepted version, and platform address. Add narrowly scoped shipped controls only after the server seam is proven. |

### Canonical catalog IDs at the checkpoint

These are the exact private-catalog values in `server/commerce-v2/alakazam.mjs`. Presence in the held catalog is a contract, not proof that the behavior is fulfilled.

| Tier ID | Recurring amount | Canonical capabilities | Canonical limits |
| --- | ---: | --- | --- |
| `alakazam_25` | `$25.00 USD` monthly (`2500` minor units) | `download_accepted_project_version`, `host_at_sitesourcery_me`, `look_crystal`, `look_hearth`, `look_midnight`, `publish_accepted_project_version` | `careClass: none`; `versionHistory: 0`; `fontControls: base`; `borderControls: base` |
| `alakazam_35` | `$35.00 USD` monthly (`3500` minor units) | Every `$25` capability plus `care_request`, `expanded_fonts`, `photo_header`, `section_toggles`, `version_history` | `careClass: modest`; `versionHistory: 3`; `fontControls: expanded`; `borderControls: base` |
| `alakazam_50` | `$50.00 USD` monthly (`5000` minor units) | Every `$35` capability plus `border_controls`, `cash_app_link`, `extended_font_controls`, `site_menu`, `venmo_link` | `careClass: more`; `versionHistory: 3`; `fontControls: extended`; `borderControls: extended` |

The catalog is `state: held` with `providerEffectsAuthorized: false`. `care_request` remains release-blocked despite appearing in `$35/$50` capability lists because the owner has not defined its accounting boundary.

## Exact existing inventory

### Real and reusable

- `server/commerce-v2/alakazam.mjs`
  - Canonical `$25/$35/$50` tier IDs, amounts, capabilities, care classes, history limits, font classes, and border classes.
  - `authorizeAlakazamCapability(...)` already models active/grace authority, scheduled downgrade timing, and period-end cancellation timing.
  - At this checkpoint, that helper is exercised by tests but has no production compiler, version, media, support, or publication consumer.
- `server/commerce-v2/alakazam-payment.mjs`, `alakazam-activation.mjs`, `alakazam-upgrade.mjs`, `alakazam-downgrade.mjs`, and `alakazam-downgrade-activation.mjs`
  - Durable billing lifecycle pieces exist with provider-effect fencing and exact subscription revisions.
  - They currently change billing truth, not customer artifacts or serving truth.
- `abracadabra/app/abracadabra-compiler.js`
  - One deterministic compiler is shared by browser and server.
  - It implements the three base looks and currently understands accent, a two-choice font pair, three border styles, Cash App, Venmo, and automatic navigation.
  - It has no entitlement/policy argument and therefore cannot by itself enforce a paid tier.
- `server/hosted/spark-compiler-port.mjs`
  - Recompiles server-side and verifies exact digest parity; this is the correct enforcement side of the browser preview boundary.
- `server/hosted/postgres-service.mjs`
  - Persists project drafts, fact sets, immutable site versions, exact artifacts, screenings, platform addresses, publication requests, serving state, and support records.
  - It provides release, rollback, unpublish, and support methods, but these are generic hosted-platform methods at the checkpoint.
- `server/hosted/selfhost-publication-port.mjs`
  - Installs immutable release bytes, reserves hostnames, activates a release, compensates failures by making the host dark, supports rollback/unpublish, and fences replay.
  - Its Alakazam use is blocked by the proof mismatch described below.
- `abracadabra/app/abracadabra-api.js`
  - Client methods already exist for `POST /projects/{projectId}/release-requests`, rollback, unpublish, and support tickets.
  - Method existence is not customer entitlement.
- `server/hosted/test/postgres-service.integration.test.mjs` and `server/hosted/test/selfhost-publication-port.test.mjs`
  - Existing journeys prove exact bytes, rollback, unpublish, compensation, idempotency, and platform hostname behavior for the generic hosted system.

### Prototype-only or misleading if counted as fulfillment

- `abracadabra/app/abracadabra-account.js` and `abracadabra/app/abracadabra-paid-download.js` are browser-local honor-gate prototypes. Query parameters such as `?paid=1` or `?alakazam=1`, local/session storage, and DOM classes are never subscription authority.
- Source Maker `data-tier` blocks currently expose style extras and Cash App/Venmo under old unlock assumptions. The `$50`-only owner ruling supersedes those assumptions.
- `abracadabra/app/abracadabra-hosted-control-dom.js` contains broad generic publication controls, but the current hosted customer artifact does not ship that control surface. It is candidate UI, not a completed customer journey.
- `data/abracadabra-hosted-catalog.held.json` describes an older Spark rent/own/managed model. It is not the Alakazam tier catalog.
- `data/public-catalog.json` contains separate Custom-service care packages with exact quantities. Those quantities must not leak into Alakazam modest/more care.
- Maker-local version history is not hosted paid version history.
- Automatic generated navigation is not proof that the `$50` configurable-menu promise is fulfilled.

### Missing or disconnected

1. No server-owned fulfillment projection binds `ss.alakazam_subscriptions` to a project, selected platform address, configured facts, effective facts, accepted artifact, and serving receipt.
2. Existing publication proof in `server/hosted/postgres-service.mjs` joins legacy `ss.stripe_subscriptions`; it does not prove the exact active `ss.alakazam_subscriptions` row/revision used by the current billing spine.
3. No production caller uses `authorizeAlakazamCapability(...)` before compile, version creation, support, release, rollback, or unpublish.
4. The shipped customer artifact provides account/project/`$5` Download flow and read-only Alakazam account truth, but no Alakazam fulfillment controls.
5. Premium values are not separated into stored configuration versus tier-effective configuration.
6. No downgrade reconciliation prevents an already-published premium static artifact from remaining live after lower-tier authority becomes effective.
7. There is no Alakazam activation fulfillment worker/outbox that makes an accepted `$25+` site live.
8. There is no image/media vertical for the photo header.
9. There is no paid history projection/action fence.
10. There is no approved Alakazam care boundary or accounting model.

## Required fulfillment contract

Before feature UI expands, freeze one internal server contract with these semantics. Names and storage layout may change under lead review; the invariants may not.

### 1. Server-derived authority

For every fulfillment command, derive an immutable decision from:

- organization, customer, project, and membership;
- Alakazam subscription ID and exact revision;
- effective tier at the command time, including scheduled-boundary semantics;
- canonical capability set and limits from `server/commerce-v2/alakazam.mjs`;
- the accepted version and its screening state;
- selected licensed platform address and current serving state.

The browser may receive a safe projection to render controls, but the command handler must independently rederive authority. Stale subscription revisions fail closed and may be safely retried after refresh.

### 2. Configured facts versus effective facts

Maintain two meanings explicitly:

- **Configured facts** are the customer's full saved choices, including inactive premium values. They survive downgrade and cancellation retention according to the separate lifecycle contract.
- **Effective facts** are a deterministic mask of configured facts under the current server-derived capabilities and limits. Only effective facts may be preview-authoritative, versioned into a publishable artifact, or served.

The effective-policy identity or digest must be part of compile/version provenance. The same configured facts under `$50` and `$25` cannot silently share a supposedly equivalent artifact when premium output differs.

Browser hiding alone is insufficient. A `$25` customer who injects Cash App, Venmo, menu, photo, font, border, or toggle fields into a request must still receive a `$25` artifact with those unauthorized outputs absent.

### 3. Safe downgrade of static artifacts

A lower tier cannot become authoritative while a higher-tier static artifact remains publicly served indefinitely.

The minimum fail-closed sequence at the renewal boundary is:

1. In the same durable boundary operation that activates the lower tier, mark the affected serving projection `billing_dark` and enqueue one revision-bound fulfillment reconciliation.
2. Recompile the preserved configured facts with the lower-tier effective policy.
3. Publish the exact lower-tier artifact through the existing idempotent publication port.
4. Clear the dark state only after the publication receipt and serving binding agree.

If reconciliation is uncertain or fails, the hostname stays dark and the worker retries from durable evidence. It must never keep premium bytes live merely to avoid downtime. An upgrade does not invent premium settings; existing lower-tier output can remain live until the customer accepts/publishes an upgraded version.

### 4. Version-history interpretation

The safest minimum meaning of “three-version history” is three customer-visible/actionable accepted versions: current plus up to two prior accepted versions. Older immutable rows remain internal audit evidence and are not selectable through the customer API. This avoids inventing a deletion/retention policy while honoring the owner-approved visible limit.

If the owner intends physical deletion instead, that requires a separate explicit ruling before implementation.

### 5. Publication proof

Release, rollback, and automatic activation publication must bind the following in one proof or revision-fenced chain:

- project and organization;
- active/grace Alakazam subscription and exact revision;
- `publish_accepted_project_version` capability at the decision time;
- accepted version ID, immutable artifact digest, and successful screening;
- licensed `sitesourcery.me` address owned by the same project;
- idempotency key / fulfillment operation ID;
- current release/serving revision.

Do not create a shadow legacy `ss.stripe_subscriptions` row to make the old proof pass. The new billing spine is intentionally separate and must be the authority.

## Dependency-ordered vertical slices

Each slice ends in customer-observable runtime proof. A module with unit tests is not a completed slice.

### F0 — Fail-closed fulfillment seam

Depends on: committed billing/account checkpoint only.

Build:

- A server-only Alakazam fulfillment decision/projection using the canonical catalog helper and exact subscription revision.
- Configured-to-effective fact masking with base/expanded/extended capability classes.
- Compile provenance that records the effective policy identity.
- Command rejection for stale revision, wrong project, inactive status, unknown capability, and browser-claimed tier/price/provider authority.
- Shipped Maker controls projected from account truth, with all currently unfulfilled premium controls disabled/hidden and still server-masked.

Exit proof:

- `$25` facts containing injected `$35/$50` values compile without premium output.
- `$35` cannot render `$50` output.
- `$50` can render only implemented and approved `$50` output.
- Masking does not overwrite configured premium values.
- Browser and server artifact digests agree for the same effective policy.

### F1 — First real `$25` activation-to-live-site journey

Depends on: F0.

Build:

- Bind a project, accepted version, and owner-selected available `label.sitesourcery.me` address to a durable fulfillment intent before/at checkout without treating it as paid authority.
- On exact Alakazam activation, enqueue one idempotent fulfillment operation outside the billing transaction.
- Re-derive `$25+` authority, compile the accepted version with the base policy, allocate/confirm the licensed platform address, screen, publish, and persist the receipt.
- Resume safely after every uncertainty point; never double-allocate or double-publish.
- Project/account projection shows pending, live, dark, or failed-with-retry-safe-state without exposing provider secrets.

Exit proof on a fresh PostgreSQL database and real selfhost runtime:

- Pay/settle/activate `$25` -> one fulfillment operation -> exact accepted bytes live at the chosen `sitesourcery.me` hostname.
- Crystal, Hearth, and Midnight each produce their expected distinct exact artifact.
- A replayed webhook/activation/worker lease produces no duplicate release or address.
- A finalization failure compensates to dark and a retry converges to one live release.
- A `$5` Download customer and an inactive Alakazam customer cannot publish.

### F2 — Customer publish, rollback, and unpublish

Depends on: F1.

Build:

- Re-authorize the existing release, rollback, and unpublish methods against Alakazam proof rather than legacy generic subscription state.
- Expose narrow controls in the shipped customer artifact: publish the selected accepted version, roll back to an allowed prior version, and unpublish.
- Keep emergency unpublish available under the existing safety rule; distinguish unpublish from cancellation or deletion.
- Project/account projection must name the exact live version/release rather than assuming the newest accepted version is live.

Exit proof:

- Publish accepted v2 while v1 is live -> exact v2 bytes served.
- Roll back to v1 -> exact original v1 bytes served and one durable receipt.
- Unpublish -> hostname returns dark/404 and replay remains dark.
- Cross-project, stale-revision, unscreened, unaccepted, and history-ineligible version requests fail without mutation.

### F3 — Premium preservation and tier-transition serving safety

Depends on: F0-F2. Must land before any premium tier is sellable.

Build:

- Preserve complete configured facts separately from effective output.
- Upgrade projection unlocks the new capability class without manufacturing values.
- Scheduled downgrade leaves the higher policy active until the exact boundary.
- Boundary activation darkens the premium release, enqueues revision-bound reconciliation, publishes the lower-tier masked artifact, and restores live state only on exact receipt.
- Re-upgrade restores access to preserved configuration; publication remains an explicit accepted-version action unless the owner separately orders automatic publication.

Exit proof:

- `$50` configured facts -> schedule `$25` -> premium remains active before boundary -> boundary host goes dark -> lower-tier bytes become live -> premium markers are absent -> stored premium facts remain unchanged.
- Re-upgrade makes the preserved values editable again without reconstructing them from the old public artifact.
- Crash/replay at every boundary converges without premium leakage or duplicate release.

### F4 — `$35` non-media fulfillment

Depends on: F3 and owner freeze of the exact expanded-font set. Care remains held.

Build:

- Expanded-font configured/effective facts.
- Explicit section visibility facts and `$35+` controls.
- Customer-facing/actionable history projection capped at three accepted versions.
- `$25` keeps those saved values inactive and receives no paid history actions.

Exit proof:

- `$25`, `$35`, and `$50` matrices prove exact controls and exact rendered output.
- A forged `$25` request cannot apply expanded fonts/toggles or select prior history.
- A `$35` project with more than three internal versions sees and can act on only the allowed three; internal audit rows remain intact.
- Downgrade/re-upgrade preserves font and toggle configuration.

### F5 — `$35` photo-header media vertical

Depends on: F4 and a lead-reviewed technical media safety contract. It does not require inventing a product quantity.

Build:

- Authenticated project-owned upload/selection boundary.
- Server validation of actual file signature, supported format, safe dimensions/size, immutable digest, and project ownership. Exact technical safety bounds are a security decision, not a care/product allowance.
- Preserved photo-header configuration and `$35+` effective masking.
- Deterministic artifact manifest containing `index.html` plus the exact immutable asset, or another reviewed deterministic packaging design.
- Publication adapter support for the reviewed manifest; current Alakazam publication proof assumes exactly one `index.html` and must be deliberately revised.

Exit proof:

- Valid owned photo -> server compile -> exact manifest -> live header at the platform hostname.
- Wrong-project asset, changed bytes, spoofed MIME, unsupported/unsafe file, missing asset, stale policy, and `$25` use all fail closed.
- Downgrade removes the public photo while retaining the private configuration and asset reference under the approved retention contract.
- Rollback restores the exact historical HTML and exact historical asset bytes.

### F6 — `$50` fulfillment

Depends on: F3-F5 and owner freeze of menu behavior plus expanded/extended font-border sets. Care remains held.

Build:

- Cash App and Venmo configured facts, validation, `$50` effective rendering, and lower-tier masking.
- The owner-approved configurable menu behavior; do not relabel current automatic navigation as this feature.
- Extended fonts and border controls with a tested distinction from `$35` expanded fonts/base borders.
- Exact customer-control projection for `$50`; server remains authoritative.

Exit proof:

- `$50` accepted version publishes exact approved Cash App/Venmo/menu/font/border output.
- `$25/$35` DOM injection and direct API requests cannot include those outputs.
- `$50 -> $35/$25` boundary reconciliation removes premium output from the public hostname while preserving configuration.
- `$35/$25 -> $50` restores edit access to the preserved values.

### F7 — Care boundary and release completion

Depends on: explicit owner redline for modest care and more care.

Build only after that redline:

- A care entitlement and accounting boundary that represents exactly the approved distinction.
- Customer request UI and operator projection that cannot imply unapproved quantities, response times, edits, priority, refunds, or unlimited service.
- Authorization from the same current Alakazam subscription revision.

Exit proof:

- `$25` cannot request tier care.
- `$35` and `$50` receive exactly their approved, distinguishable boundary.
- Downgrade, cancellation, retries, duplicate requests, and concurrent operator actions obey the approved accounting rule.

Until F7 is frozen and proven, `$35` and `$50` may be technically exercised behind the release hold but must not be advertised as fully fulfilled plans.

## File-level write packets and ownership

The packets below are designed for parallel work without simultaneous ownership of the same file. A packet owner may not edit files outside its list. Any newly discovered shared file returns to the lead for reassignment before editing.

### Parallel packet set P1 — fulfillment foundation

#### P1-A — Alakazam authority and durable fulfillment state (lead-owned shared contract)

Exclusive files:

- `server/commerce-v2/alakazam-fulfillment.mjs` (new)
- `server/commerce-v2/test/alakazam-fulfillment.test.mjs` (new)
- `server/commerce-v2/index.mjs`
- `server/hosted/alakazam-postgres.mjs`
- `server/hosted/test/alakazam-postgres.test.mjs`
- `server/data-plane/supabase/migrations/<next-reviewed-number>_alakazam_fulfillment.sql` (new; number assigned by lead at execution)
- `server/data-plane/tests/alakazam-postgres-contract.integration.test.mjs`

Required proof: capability/revision decision tests, migration replay from empty PostgreSQL, RLS/cross-project denial, idempotent fulfillment operation leasing, stale-revision rejection, premium configuration preservation, and downgrade `billing_dark` transaction semantics.

#### P1-B — compiler policy and deterministic effective facts

Exclusive files:

- `abracadabra/app/abracadabra-compiler.js`
- `scripts/test/abracadabra-v1.test.mjs`
- `server/hosted/alakazam-compiler-policy.mjs` (new, if the reviewed design keeps policy outside the compiler)
- `server/hosted/test/alakazam-compiler-policy.test.mjs` (new)
- `server/hosted/spark-compiler-port.mjs`
- `server/hosted/test/spark-compiler-port.test.mjs`

Required proof: tier matrix, browser/server parity, injected-field masking, deterministic policy identity, no configured-fact mutation, and distinct Crystal/Hearth/Midnight artifacts.

#### P1-C — Maker control projection and fail-closed presentation

Exclusive files:

- `abracadabra/app/index.html`
- `abracadabra/app/abracadabra-app.js`
- `abracadabra/app/abracadabra-app.css`
- `abracadabra/app/abracadabra-customer-control-dom.js`
- `scripts/test/abracadabra-tier-controls.test.mjs` (new)

Required proof: signed-in account tier projection controls visibility/disabled state; `$25` never presents Cash App/Venmo as included; local/query/DOM flags cannot unlock authority; saved inactive values are not erased. This packet proves presentation only and must state that server tests are the security proof.

#### P1-D — Alakazam-aware publication adapter

Exclusive files:

- `server/hosted/selfhost-publication-port.mjs`
- `server/hosted/test/selfhost-publication-port.test.mjs`
- `server/hosted/PUBLICATION-PORT.md`

Required proof: exact Alakazam proof consumption, stale proof denial, exact-byte install, idempotent replay, compensation to dark, rollback, unpublish, and no reliance on browser/provider claims. The database proof query itself remains P1-A/lead-owned.

P1 merge gate: all focused suites green, empty migration replay green, no shared-file edits, then lead integrates once. No P1 worker edits HTTP composition, the hosted artifact manifest, or release configuration.

### Serial packet set P2 — first vertical integration

P2 begins only after P1 locks are released. It is intentionally lead-owned because these are shared composition seams.

#### P2-A — service, HTTP, and runtime composition

Exclusive files for this ownership epoch:

- `server/hosted/postgres-service.mjs`
- `server/hosted/http.mjs`
- `server/hosted/bin/server.mjs`
- `server/hosted/alakazam-release-config.mjs`
- `server/hosted/test/alakazam-release-config.test.mjs`
- `server/hosted/test/http-alakazam-fulfillment.test.mjs` (new)
- `server/hosted/test/postgres-service.integration.test.mjs`

Required proof: full `$25` activation-to-live journey on fresh PostgreSQL plus real selfhost runtime; exact address/version/release projection; retry after each injected uncertainty; publish/rollback/unpublish authorization; cross-project and `$5`-only denial.

#### P2-B — shipped customer artifact

May run parallel to P2-A after its route/response contract is frozen. Exclusive files:

- `abracadabra/app/abracadabra-api.js`
- `scripts/test/abracadabra-api.test.mjs`
- `scripts/hosted-truth/fragments/abracadabra-app-customer-control.html`
- `scripts/hosted-truth/fragments/abracadabra-app-scripts.html`
- `scripts/configure-abracadabra-hosted-staging.mjs`
- `scripts/test/hosted-artifact.test.mjs`

Required proof: built artifact contains only the reviewed controls/scripts, contains no honor-gate scripts or direct Payment Links, calls the frozen authenticated routes, and exposes no browser tier/provider authority.

P2 runtime gate: a customer starts from a real account and accepted project, completes the held `$25` payment journey, receives one chosen platform hostname, and can load the exact published artifact. Source inspection is not this proof.

### Feature packet epochs P3-P5

These are sequential where they touch compiler/Maker/publication files. Do not run two workers against those shared files at once.

#### P3 — `$35` fonts, toggles, and history

After P2, transfer exclusive locks for the P1-B and P1-C file sets to one `$35` feature owner. The lead alone owns any migration and `postgres-service.mjs` change. Add focused `$35` unit tests plus the P2-A integration journey matrix. Do not start until the expanded-font set is frozen.

#### P4 — photo media

New-file worker scope may begin with:

- `server/hosted/alakazam-media.mjs` (new)
- `server/hosted/test/alakazam-media.test.mjs` (new)

It may not touch migrations, compiler, publication, HTTP, or Maker files. After its media contract passes review, the lead schedules a serial integration epoch that temporarily owns the necessary P1-B, P1-D, P2-A, and P2-B seams. This prevents a media worker from independently changing the shared artifact contract.

#### P5 — `$50` controls

After P3/P4, transfer the compiler/Maker locks to one `$50` feature owner. The owner-approved menu and font/border sets are prerequisites. The lead integrates service/artifact seams afterward. Cash App/Venmo tests must prove absence from `$25/$35` public bytes, not merely hidden inputs.

#### P6 — care

No write packet may be assigned until the owner redlines modest versus more care. Generic support-ticket code remains untouched for Alakazam meanwhile. After the ruling, create a separate file packet so care accounting does not share implementation ownership with visual fulfillment.

## Required proof matrix before release

### Unit and contract proof

- Every catalog capability maps to an implemented enforcement point or is explicitly held.
- Every tier-to-effective-facts combination is tested, including malicious extra fields.
- Scheduled downgrade and period-end cancellation use exact boundary timestamps and revisions.
- Premium configured values survive every lower-tier write and retry.
- Unknown tiers/capabilities and stale revisions fail closed.
- Care remains unavailable until its exact owner contract exists.

### Fresh PostgreSQL proof

- Replay every migration from empty PostgreSQL.
- Create account/project/accepted version, settle/activate Alakazam, and lease exactly one fulfillment operation.
- Prove RLS, organization/project ownership, idempotency, outbox/lease recovery, and no legacy-subscription shadow authority.
- Prove three-version customer projection without deleting internal audit rows.
- Prove downgrade marks serving dark before premium bytes can remain available.

### Real serving proof

- `$25`: all three base looks can become exact live bytes on an assigned `sitesourcery.me` hostname.
- `$35`: approved expanded output, toggles, history, and photo asset are live; `$50` output is absent.
- `$50`: approved payment links/menu/extended style output is live.
- Publish, rollback, and unpublish converge after replay and injected finalization failure.
- Historical rollback restores exact HTML and, after photo support, exact asset bytes.
- A lower-tier transition replaces/darkens premium output at the effective boundary.

### Browser customer-journey proof

- Use the built hosted artifact against the real hosted service and a fresh disposable database.
- Verify actual rendered controls and visible page output at supported desktop/mobile widths; source/headless text checks alone are insufficient visual proof.
- Walk account -> project -> accepted version -> Alakazam activation -> live hostname -> publish newer version -> rollback -> unpublish.
- Walk `$50 -> scheduled $25 -> boundary -> masked live artifact -> re-upgrade -> preserved configuration visible`.
- Confirm refresh, second tab, expired session, stale command, duplicate click, and retry behavior.

### Regression and operations proof

- Existing commerce-v2, hosted-service, selfhost, hosted-artifact, ops, and broad regression suites remain green.
- Disposable database is verified idle, dropped, and verified absent after each real journey.
- Release remains held until provider credentials/configuration, monitor/backup evidence, public truth, care redlines, and owner customer-walk gates in the canonical roadmap are complete.

## Decisions still required; do not guess

1. Exact curated font choices in base, expanded, and extended classes.
2. Exact extended border choices at `$50`.
3. Exact customer-configurable meaning of the `$50` menu.
4. Exact modest-care and more-care boundaries.
5. Whether “three-version history” means the safe projection-only interpretation above or physical deletion. Projection-only is recommended because it preserves audit evidence.
6. Technical media safety bounds and storage adapter for the photo header. These are implementation/security decisions; they must not become invented product allowances.

Custom-domain treatment is deliberately outside this inventory. The only domain behavior mapped here is the approved hosted `label.sitesourcery.me` address.

## Recommended immediate execution order

1. Land F0: one server-owned authority/effective-facts seam and fail-closed Maker projection.
2. Immediately land F1: `$25` activation -> selected platform label -> exact accepted artifact live.
3. Land F2 and F3: customer publication controls plus downgrade-safe premium preservation.
4. Freeze the unresolved visual choices, then implement `$35` non-media, photo media, and `$50` in that order.
5. Redline care separately, implement it separately, and only then call the `$35/$50` plans fully fulfilled.

This order joins existing machinery into a usable customer outcome before expanding the feature surface, while keeping every later feature behind the same payment-backed authority and publication proof.
