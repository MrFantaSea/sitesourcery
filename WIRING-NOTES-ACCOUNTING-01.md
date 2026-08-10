# ACCOUNTING-01 L4 Wiring Notes

ACCOUNTING-01 remains held and is not registered in production composition.

When the owner authorizes operator accounting access, L4 may:

1. Import `createHeldAccountingPurposeJournal` from `server/hosted/accounting-purpose-journal.mjs` in the hosted composition root and register only that held constructor initially.
2. Import `createPostgresAccountingPurposeJournalRepository` from `server/hosted/accounting-purpose-journal-postgres.mjs` only after an explicit release decision replaces the held constructor.
3. Construct the repository with the existing canonical PostgreSQL authority; do not add a provider client, Stripe readback, customer route, or product-state mutation port.
4. Expose `list` and `export` only through an existing authenticated operator surface that supplies `actorId` and `operatorOrganizationId`; PostgreSQL rechecks `service_management_manage`.
5. Invoke `synchronize` only after an authoritative receipt transaction commits or as an operator backfill command. It is deterministic and append-only, but it does not authorize or reconcile any product state.

No line is authorized yet in `server/hosted/http.mjs`, `server/hosted/postgres-service.mjs`, any customer DOM, provider adapter, control, DNS, deployment, or release file.
