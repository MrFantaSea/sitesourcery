# FIN-006 unified composition provenance

Date: 2026-08-19  
State: proved  
Candidate branch: `integration/final-successor-20260811`

Input checkpoint:
`8e71a254e14cdc81fdf25990a7273b67f6179e4b`

Implementation commit:
`99e6f742829d4b9150ec87fd51b4ff5a2bf8d0fc`

Implementation tree:
`bfda7b9475bd327ed1be8f559d909c6a5d39efac`

Final proved candidate:
`bd88d45630212dc6f0a954be246389ea92788834`

Final proved candidate tree:
`c286be2eb9f6e56da29075a7baaed4100833a434`

## Frozen denominator

FIN-006F closed exactly the seven gaps mapped at its clean input:

1. one canonical 20-row capability/process truth projection;
2. physically separate API, tenant, and worker processes with one publication
   writer;
3. removal of API-process export execution;
4. active-cycle graceful shutdown proof for every remaining worker class;
5. the five uncovered transactional-mail purpose families;
6. strict production startup/readiness/capability integration; and
7. one exact account-to-project-to-commercial-to-fulfillment trace with every
   external effect held.

No archive, adjacent repository, protected database, provider configuration,
public route, DNS record, deployment, or cutover surface entered the writer
scope. The implementation commit changes 77 reviewed paths. The proved
candidate adds seven test-only compatibility assertions for the stronger
batched readiness and mail-purpose composition; production bytes remain those
of the implementation commit.

## Capability and process closure

- `sitesourcery.capability-process-matrix/v1` freezes exactly 20 ordered rows
  and six ordered processes. `/ready` and `/capabilities` expose the same
  derived snapshot; the production entrypoint calls `assertStartup()` before
  either TCP listener starts.
- Sixteen internal/startup-required rows are engineering-ready and held. The
  four later-phase rows—public successor, hosted browser, backup/restore, and
  monitoring/deadman installation—remain truthful candidates rather than
  false-green installed claims.
- Every process is candidate/not-installed/not-asserted. Public static is
  `static`, PostgreSQL is `internal`, and all effect-bearing processes are
  `held`.
- The API listens only on reviewed loopback `127.0.0.1:8788`, owns the sole
  writable `SelfHostRuntime`, and no longer runs export work inline. The tenant
  process serves read-only state at `127.0.0.1:8080`. The worker is a separate,
  listener-free process and reaches publication only through the exact
  authenticated Unix-domain-socket command boundary.
- Rollback models the sealed predecessor's combined API/tenant process and
  held/stopped worker separately from the successor split. It proves exact
  tenant health 200 and ready-held 503 semantics without starting a fictitious
  predecessor unit.
- All eleven worker purposes plus independent W10 retain explicit activation,
  lease/fence, bounded execution, retry/manual-review, and graceful-stop proof.
  Installed heartbeat/PID readback remains a FIN-009 staging gate, not a hidden
  FIN-006 implementation omission.

## Transactional-mail closure

Migration 140 adds an exact service-only source projection, tenant outbox, v2
dispatch contract, forced RLS, exact ACL/startup gates, and held-purpose
reservation path for the five previously uncovered purpose families. Together
with the retained account, commerce, and support lanes, Site Sourcery now has
all nine declared transactional-mail purposes in held engineering state.

The new lane freezes 14 exact source arms and 40 reviewed renderer templates.
The owner-frozen identities are preserved exactly:

- publication notices bind `ss.publication_control_commands.action` and use
  `project_id` as the reference;
- domain notices bind `ss.domain_provider_lifecycle_states` by monotonic
  revision, `state_digest`, and `lifecycle_status`, using `domain_name` as the
  reference.

The dedicated PostgreSQL proof passed 14/14 exact gates over all 14 source
arms, same-command replay, semantic replay under a distinct command,
concurrent source fencing, source revision/digest/state mismatch rejection,
cross-tenant/role and ACL/guard drift rejection, dispatch candidate/claim, and
zero orphan mail/outbox/provider effects. The generic operator boundary
requires exact source evidence; provenance does not overstate every producer
as an automatic notification trigger.

## Exact composed all-held trace

The 15-gate trace uses one activated customer identity through one organization,
owner membership, Engagement, project, direct-Custom opportunity, exact quote,
acceptance, invoice, Hub project crosswalk, and Dell scope/quote crosswalk. It
proves customer/operator role denial, foreign-tenant denial, exact durable
identity joins, payment-held checkout before provider access, zero payment
attempt/receipt/job/work/publication rows, zero provider calls, and false
automatic-command/remote-write/provider-effect flags.

The adjacent PostgreSQL verifier now consumes that exact identity tuple instead
of selecting an unrelated first row. The six adjacent-system contracts remain
digest-bound/manual-read-only with no remote/provider/send/phone effect.

## Adversarial corrections

Bounded review found and cleared material issues before sealing, including:

- pre-dispatch operation identity, concurrent publication-command admission,
  stale read-only control refresh, unavailable-held readiness, and single-writer
  filesystem authority;
- false process topology in rollback, epoch-specific tenant/worker behavior,
  tenant unit permissions, exact probe dependencies, and port truth;
- mail source/command identity, source-scoped concurrency, exact ACL/RLS and
  trigger/function readiness, Care route coexistence, and the frozen
  publication/domain source identities; and
- cumulative test assertions that encoded obsolete sequential readiness or the
  retired Care lifecycle-only mail adapter.

Final bounded review found no remaining material FIN-006 blocker.

## Proof ladder

- Focused compatibility proof: 39/39.
- Canonical Node/product proof: 882/882.
- Hosted/service proof: 1,076 passed, zero failed, 14 intentional no-database
  skips.
- Operations proof: 206/206.
- Exact fresh PostgreSQL 16 verifier: all 93 migrations; Care 16/16, Care
  commerce 12/12, Responder commerce 14/14, forwarding 17/17, E1 1/1, E3 3/3,
  native/Voice 23/23, adjacent 10/10, and mail-purpose 14/14; verifier database
  removed.
- Exact held composed/core-revenue proof: CORE and the 15-gate FIN-006 trace
  passed on fresh disposable databases; production wrapper 4/4 with 11
  intentional skips and `providerEffects:false`.
- Mail-delivery proof: unit 8/8; fresh database, fake-provider delivery,
  backup, independent restore, signed delivered/bounced/complained/suppressed
  readback, and removal of both databases and temporary backup. Backup SHA-256
  `d6f0087383476725b3e7b9125d7fe443675a23a11c596fb98f40c1c68badefc1`.
- Artifacts: Pages rebuilt and verified at 90 reviewed files; hosted HTML
  rebuilt and validated; browser audit passed 15 current routes at 320x720,
  390x844, and 1440x1000.

An exploratory over-broad PostgreSQL name filter also entered an unrelated
shipped-page fixture and logged its expected missing local route. It is not
counted as evidence. The database was reset, and the intended bounded mode and
canonical wrapper both passed cleanly.

## Effect and residue posture

Every new provider, public, DNS, deployment, HQ, Dell, adjacent-system,
protected-database, signing/distribution, and cutover effect remained held or
untouched. The public Pages placeholder was not replaced. Only explicitly
named local disposable PostgreSQL proof databases are eligible for final
cleanup; no preserved database or release is retired.

FIN-006 is complete at 81/100 evidence-weighted points. FIN-007 remains
unopened and begins only from the separate next checkpoint.
