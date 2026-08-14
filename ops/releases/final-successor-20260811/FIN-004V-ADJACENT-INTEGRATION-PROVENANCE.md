# FIN-004V adjacent integration provenance

Date: 2026-08-14
State: proved
Candidate branch: `integration/final-successor-20260811`

Implementation commit: `a31bb93c50b99066d84300f8c5af820150b4894b`

Proved implementation tree: `ec1d48ea82cb44f23b15d7e665b0eb074bd9bacf`

## Result and authority boundary

FIN-004V mounts all six adjacent systems in the successor as one coherent,
operator-reviewed, manual/read-only integration plane:

1. private messenger;
2. command deck;
3. phone bridge;
4. Client Profile Hub;
5. marketing desk; and
6. Dell commercial engine.

No system was excluded or treated as a stray backend. The public placeholder,
DNS, provider configuration, HQ and Dell source, listeners, services,
databases, deployments, and cutover state were unchanged. Automatic commands,
remote writes, provider effects, message sends, phone effects, marketing sends,
commercial acceptance, and publication remain absent and held.

## Durable contract and evidence model

Migration 134 adds immutable six-system contracts, an immutable exact identity
pair catalog, immutable observation contracts, organization-scoped global
source snapshots, tenant crosswalks, tenant observations, and append-only
crosswalk resolutions.

PostgreSQL computes the reference, source-revision, provenance, observation,
link, semantic, and request digests. Tenant evidence binds an exact
organization-scoped source snapshot through composite foreign keys. Exact
command replay returns the original immutable receipt; changed facts conflict.
Crosswalk creation receipts remain stable after later resolution.

Only Hub `SSC-*` and `SS-*` identifiers may appear as safe references. All
messenger, command-deck, phone-bridge, marketing, and Dell identities remain
digest-only. No message, passphrase, phone number, email address, raw provider
identity, private session value, or content is persisted or projected.

The exact tenant identity matrix permits:

- private messenger organization to encrypted-session digest;
- Hub organization to client and project to project;
- marketing qualified promotion to both the existing direct engagement and
  its direct opportunity; and
- Dell project to scope, quote, and work receipt.

Command deck and phone bridge use global source observations only. The phone
bridge remains classified as the fixed-identity command-deck proxy, never as
Twilio or telephony authority. Cold marketing prospects remain outside fake
hosted tenant identities until qualified promotion.

## Mounted service and operator surface

The production root now composes the exact service registry, PostgreSQL
repository, readiness and capability checks, source-authoritative operator
queue, and authenticated operator HTTP routes for contracts, trace, local
snapshots, local crosswalk evidence, local observations, and append-only
resolution.

The operator desk displays all six contracts and a bounded digest-only trace,
records only approved local crosswalk evidence, and resolves manual-review or
conflict rows with CSRF, idempotency, tenant, capability, revision, and digest
guards. Project traces include applicable organization-level links. An exact
crosswalk lookup retrieves its bound source snapshot even after the general
100-row snapshot window has advanced.

Readiness and capabilities report `manual-read-only` with
`remoteWrites=false`, `providerEffects=false`, and
`automaticCommands=false`. Startup fails closed unless the exact six-contract
digest and migration signature are present.

## Adversarial review corrections

Read-only review blocked the first implementation until these material defects
were corrected:

1. Active uniqueness initially prevented one Dell project from linking scope,
   quote, and work receipt, and one marketing promotion from linking both its
   engagement and direct opportunity. The indexes now bind the exact local and
   remote kind pair; real PostgreSQL proves all five links can be active.
2. Crosswalk creation replay initially projected mutable current state after a
   resolution. Creation receipts now use immutable initial state and revision
   one; replay after linking is byte-shape stable.
3. The crosswalk semantic digest initially omitted initial state and
   supersession lineage. Both are now digest-bound, with a separate immutable
   link-evidence digest preventing duplicate facts.
4. Global source semantic identity initially crossed organization audit scopes.
   Operator organization now participates in the semantic digest, uniqueness,
   and composite tenant-evidence foreign keys. Identical facts in another
   organization produce a distinct receipt.
5. Exact trace could omit its source snapshot after more than 100 newer rows.
   The projection now supports an exact snapshot ID; real PostgreSQL proves the
   original remains returned after 101 newer snapshots.
6. The new link digest was initially left in a before-update trigger's generated
   column comparison, rejecting valid resolutions before PostgreSQL recomputed
   it. The guard now excludes that generated value while continuing to compare
   every immutable stored field.

The final independent blocker recheck returned `CLEAR`.

## Proof

Focused proof at the implementation tree:

- exact migration/service/HTTP/root/queue/operator UI matrix: 93/93 passed;
- real operator browser proof: 3/3 passed at 320x720, 390x844, and 1440x1000;
- all 87 ordered migrations applied from zero on disposable PostgreSQL 16;
- adjacent PostgreSQL proof: 10/10 gates, six contracts, 108 snapshots, eight
  crosswalks, four observations, and six resolutions;
- the proof includes exact replay, changed-command conflict, cross-tenant
  denial, unsafe-reference rejection, same-facts/different-organization
  isolation, the complete compatible Marketing and Dell link set, stable
  creation replay after resolution, queue enter/resolve/clear, and the
  101-newer-snapshot trace case;
- exact contract digest:
  `3253dafa276acd700900c9f6b72c8b7e2bde9f7f2ce1e40318591859b4d7a6ec`;
  and
- the verifier reported `databaseAbsent true`; no disposable proof database
  remains.

The complete clean-tree `npm test` ladder ran at implementation commit
`a31bb93` / tree `ec1d48e` and exited `0`:

- runtime, HTML, authority, catalog, legal-copy, site, Node, public-truth,
  self-host, hosted-service, operations, and static checks passed;
- canonical Node matrix: 877/877 passed;
- hosted/service matrix: 1,004 total, 990 passed, zero failed, 14 intentional
  environment-gated PostgreSQL skips;
- operations matrix: 205/205 passed;
- Pages artifact: 90 allowlisted files rebuilt and verified;
- hosted artifact: rebuilt and HTML-validated; and
- browser audit: 15 current hosted routes at 320x720, 390x844, and 1440x1000.

## Changed-path allowlist

The implementation changed exactly 22 reviewed files covering migration 134,
migration inventory and PostgreSQL proof, the adjacent service/repository/HTTP
boundary, production root/readiness/capability/work-queue composition, the
operator desk, and focused/static/browser tests. The exact file list is:

`git show --format= --name-only a31bb93c50b99066d84300f8c5af820150b4894b`

No archive, predecessor, standalone adjacent repository, commercial source,
deployment file, provider configuration, DNS record, protected database, or
public artifact source was imported or changed.

## Remaining ordered work

FIN-005 through FIN-010 remain: preserved-source disposition, unified
composition closure, catalog/routes/legal closure, database upgrade and
restore convergence, immutable private staging and acceptance, then separately
owner-gated activation, cutover, and stabilization.
