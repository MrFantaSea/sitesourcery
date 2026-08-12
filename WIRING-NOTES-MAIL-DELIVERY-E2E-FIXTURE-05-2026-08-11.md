# MAIL-DELIVERY-E2E-FIXTURE-05 local proof — 2026-08-11

This packet adds only a disposable PostgreSQL proof and a local in-memory fake
provider. It cannot send mail, bind a public port, read a Resend credential, or
change Care, provider, DNS, installation, or production state.

## Journey and recovery proof

`scripts/mail-delivery-e2e.mjs` creates two exact local PostgreSQL 16 databases,
applies the complete migration graph to the primary database, runs the journey,
restores its snapshot into the second database, compares the exact mail evidence
identity, and then removes both databases and the temporary backup. It refuses
non-local PostgreSQL URLs, unexpected names or server versions, pre-existing
targets, and cleanup while an exact target still has a session.

The journey reuses an existing project-scoped support case and reserves two new
support notifications. It exercises ordinary migration-118 claims, the reviewed
private renderer, and two fake Resend acceptance receipts. The complete migration
verifier already proves migration-118 lease expiry/reclaim, stale fencing, a
crash after durable acceptance, and no-resend reconciliation; this harness
asserts and reuses that persisted proof instead of repeating it. All provider
calls assert `providerEffects: false` and use only `@example.test`. Care remains
outside the claim source.

The older registration/recovery bridge and identity-delivery fencing remain
unchanged: they prove account-mail acceptance lineage but cannot enter the
reviewed support/commerce private renderer. This fixture imports the current
lifecycle, migration-118 source, renderer, and raw webhook modules directly; it
adds no second delivery, recovery, ingress, renderer, or worker implementation.

Signed raw webhook requests use an in-memory, non-secret fixture key. They prove
applied delivered, complained, suppressed, and bounced transitions; one known
`svix-id` replay; and an older bounced event durably classified as a conflict.
The operator queue is then checked for its exact safe key set and for absence of
recipient, body, subject, raw request, and provider-message data.

The custom-format backup contains the complete disposable database. The restore
selects its pre-data and data sections because the full migration verifier also
contains intentionally broad cross-lane fixture rows whose post-data constraint
replay is outside this mail proof. Source constraints and guards were already
active for every mail transition. The restored database must recompute the same
digest over the two deliveries, reservations, claims, inbox entries, lifecycle
events, exceptions, suppressions, and both runtime contract identities. This is
a mail evidence round-trip fixture, not a replacement for the production backup
and full-schema restore rehearsal.

Run the deterministic boundary tests with:

```sh
npm run test:mail-delivery-e2e
```

Run the actual local PostgreSQL proof with a PostgreSQL 16 admin database:

```sh
SITESOURCERY_PG_MAIL_DELIVERY_ADMIN_URL=postgresql:///postgres \
  npm run prove:mail-delivery-e2e
```

## Remaining external gates

- Install reviewed hosted and worker bytes, apply migration 118 to the held
  target, and bind the exact private renderer digest and registry digest.
- Configure an owner-controlled Resend API key and webhook signing secret, a
  verified sender domain/from identity, disabled tracking, and the reviewed
  public webhook registration.
- Publish the required SPF/DKIM/provider DNS, enable the held worker and route
  under release authority, and prove real accepted/delivered/failed/bounced/
  complained/suppressed canaries plus alerting and rollback.
- Run the separate production backup/full-schema restore rehearsal on the exact
  installed release before relying on disaster recovery.
