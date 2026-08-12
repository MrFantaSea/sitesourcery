# FIN-004B domains provenance

State: proved repository/lifecycle composition; central hosted surface remains open  
Donor: `a81d1438fd57e62e44b917c803988301945ef2ef`  
Parent integration commit: `9740ea4`

## Imported donor paths

- `ops/DOMAINS-COMPOSE-01-LOCAL-PROOF.md`
- `ops/DOMAINS-LIFECYCLE-PERSISTENCE-04-LOCAL-PROOF.md`
- `ops/DOMAINS-PRICE-CHARGE-02-LOCAL-PROOF.md`
- `ops/DOMAINS-RENEWAL-03-LOCAL-PROOF.md`
- `server/domain/PROVIDER-CONTINGENCY.md`
- `server/domain/README.md`
- `server/domain/SPACESHIP-PROVIDER.md`
- `server/domain/adapters/memory-lifecycle-repository.mjs`
- `server/domain/index.mjs`
- `server/domain/provider-contingency.mjs`
- `server/domain/provider-lifecycle.mjs`
- `server/domain/test/provider-lifecycle.test.mjs`
- `server/hosted/domain-lifecycle-postgres.mjs`
- `server/hosted/domain-price-charge-boundary.mjs`
- `server/hosted/domain-provider-route-postgres.mjs`
- `server/hosted/test/domain-price-charge-boundary.test.mjs`

`package.json` received only the donor's bounded domain-composition test command.

## Repaired database verifier contract

The donor's route and lifecycle PostgreSQL proof functions were stranded below
a literal leading patch marker, omitted all domain imports, and were never
called. Their valid bodies were imported without the marker; the exact route,
price/charge, lifecycle repository, lifecycle schema constants, and held
provider imports were added; and both proofs were called in dependency order.
The verifier now emits explicit route and lifecycle proof lines.

## Capability state

- provider preflight and symmetric fallback are implemented before contact;
- provider contact locks route selection and ambiguous mutation never switches
  provider or retries;
- exact standard/premium price readback and final-charge evidence are bounded;
- registrar pin, renewal, transfer, reversal, expiration monotonicity, and
  authoritative readback are durable and tenant scoped;
- customer/operator projections expose digests and held state, not provider
  references or effect authority;
- existing Spaceship search, registration, contacts, DNS, nameserver, transfer,
  and readback adapter tests remain green;
- provider, payment, refund, and DNS effects remain held by default.

## Proof

- domain composition tests: 86/86 passed;
- existing domain orchestration: 16/16 passed;
- Spaceship adapter: 37/37 passed;
- isolated PostgreSQL 16 verifier applied all 77 migration files and passed the
  route/pin/final-charge/crash-fence and lifecycle/renewal/transfer/reversal
  journeys;
- verifier proved its random database absent;
- isolated PostgreSQL was stopped, port 55445 closed, and its explicit temp
  directory removed;
- complete `npm test`: passed, including deterministic artifacts and the
  15-route by 3-viewport browser audit;
- `git diff --check`: passed.

## Deferred — still required

The new lifecycle projections still need central hosted API/customer/operator
mounting and cross-system reconciliation in later FIN-004/FIN-006 work. Live
Spaceship effects remain blocked on the owner-ledger requirements: written
commercial-use consent, exact price/final-charge bridges, vaulted credentials,
and reconciliation readiness. No registrar, DNS, payment, or public effect
occurred in this cohort.
