# FIN-003 schema provenance

State: proved  
Donor: `a81d1438fd57e62e44b917c803988301945ef2ef`  
Parent integration commit: `eaf98dc`

## Imported donor paths

- migrations `202608110118` through `202608110124` under
  `server/data-plane/supabase/migrations/`;
- `server/data-plane/tests/migration-verification-inventory.mjs`;
- `server/data-plane/tests/postgres-migration-structure.test.mjs`;
- `server/hosted/test/notification-mail-dispatch-migration.test.mjs`;
- `server/hosted/test/responder-core-migration.test.mjs`.

The retained empty-database verifier received one compatibility correction:
`fence_token` is an allowed lease-fencing field and is not treated as customer
token material.

## Donor defect contained

The donor version of
`server/data-plane/tests/verify-empty-postgres-migrations.mjs` was not imported.
It contains a literal `+async function` token, references missing domain
repository symbols, and defines domain proof functions that are never called.
That file cannot serve as release evidence. The valid base verifier remained
active, applied the complete migration chain dynamically, and was supplemented
by direct database contract inspection. Repository journeys for migrations
118–124 remain required in FIN-004 and must repair this donor gap rather than
copy it.

## Database proof

An isolated PostgreSQL 16.14 cluster listened only on
`127.0.0.1:55443` and its private Unix socket. Two independent runs applied all
77 migration files through numbered migration 124:

- verifier-owned random database: the complete retained journey passed and the
  verifier proved `databaseAbsent true` after cleanup;
- caller-owned `ss_fin003_contract_20260811`: the complete retained journey
  passed and was retained briefly for direct inspection.

Direct inspection proved:

- exactly 24 expected new tables exist;
- every new table has RLS enabled and forced;
- anonymous writes and authenticated writes are denied;
- `service_role` delete is denied on every new table;
- all seven migration contract functions return their exact held contract;
- every new effect-bearing boolean discovered by the contract query defaults
  to `false`.

The caller-owned database was dropped, the verifier left no random database,
PostgreSQL was stopped, port 55443 had no listener, and
`/private/tmp/sitesourcery-fin003-pg-20260811` was removed.

## Scope inventory

- Migrations: 118 mail dispatch claims; 119 domain provider route/pin; 120
  Responder core; 121 Care core; 122 Alakazam invoice finalization; 123 domain
  lifecycle; 124 Care commerce.
- Product routes: none added, removed, or promoted.
- Product capabilities: schemas are installed-ready but no application
  capability or provider effect was activated.
- Workers and provider purposes: none changed.
- Public placeholder, DNS, provider state, Dell/HQ listeners, running services,
  and production databases: untouched.

## Proof

- migration/static contract tests: 62/62 passed;
- isolated PostgreSQL 16 empty-database verifier: passed twice;
- direct 24-table/RLS/privilege/contract/default inspection: passed;
- complete `npm test`: passed after FIN-003, including deterministic public and
  hosted builds plus the 15-route by 3-viewport hosted browser audit;
- the pre-existing readiness snapshot timing test was made deterministic in
  separate commit `6ff160e` and passed 20/20 repeated runs;
- `git diff --check`: passed.

## Remaining blockers

FIN-004 must import and repair the repository, service, HTTP, worker, and
PostgreSQL journey layers for these schemas. This schema proof grants no
provider, payment, mail, domain, customer, publication, or deployment effect
authority.
