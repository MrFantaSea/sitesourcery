# ALAKAZAM-POLICY-01 wiring notes

Base: `633c27f30ca46856df1a128c006e41f7cd6c5e78`

Migration: `202608100116_alakazam_policy_authority.sql`

## Preserved authority

- `SS-ALAKAZAM-POLICY-2026-08-10-V1` is the only production policy
  authority.
- Payment grace is exactly 168 hours from the first confirmed failure.
- Retained exit and its customer export window end exactly 720 hours after
  the canonical start boundary.
- A period-end cancellation enters retained exit only after the provider has
  confirmed it effective, the paid-through boundary has arrived, and the
  exact export grant is available.
- Purge remains limited to retained-exit expiry or terminal customer
  deletion.
- Recovery from grace or suspension requires the immutable
  `payment_recovered` tier-change event for the new subscription revision.
  Refund/dispute evidence can require owner review or restrict service, but
  cannot restore service automatically.
- Alakazam Website Hosting keeps Stripe tax code `txcd_10701100`, exclusive
  price behavior, and a separate purpose-bound tax-activation gate. Tax
  collection remains held here.

The old generic billing-policy 14/90 intervals are not Alakazam authority.
The older configurable lifecycle object remains readable for immutable
event compatibility, but production `approved` construction accepts only:

```text
SITESOURCERY_ALAKAZAM_LIFECYCLE_VERSION=alakazam-lifecycle.2026-08-10.v1
SITESOURCERY_ALAKAZAM_LIFECYCLE_GRACE_HOURS=168
SITESOURCERY_ALAKAZAM_LIFECYCLE_SUSPEND_AFTER_GRACE_HOURS=0
SITESOURCERY_ALAKAZAM_LIFECYCLE_RETENTION_HOURS=720
SITESOURCERY_ALAKAZAM_LIFECYCLE_EXPORT_WINDOW_HOURS=720
SITESOURCERY_ALAKAZAM_LIFECYCLE_GRACE_CONSEQUENCE=restrict_publication
SITESOURCERY_ALAKAZAM_LIFECYCLE_SUSPENSION_CONSEQUENCE=suspend_service
SITESOURCERY_ALAKAZAM_LIFECYCLE_REFUND_CONSEQUENCE=owner_review
SITESOURCERY_ALAKAZAM_LIFECYCLE_DISPUTE_CONSEQUENCE=owner_review
```

These values do not themselves lift `SITESOURCERY_ALAKAZAM_MODE`, Stripe,
publication, fulfillment, or any commercial purpose switch.

## Runtime wiring

`server/hosted/bin/server.mjs` constructs
`createPostgresAlakazamPolicyAuthorityRepository({ authority })` and performs
only its read-only startup readiness check. Startup requires:

- the exact migration contract marker;
- the exact policy ID and digest;
- the singleton authority table with forced RLS;
- service-role SELECT only and no direct mutation grant;
- every effect flag false, including reversal-based automatic recovery.

The repository's `policy()` and `read()` methods are read-only. Repeated
subscription reads return the same canonical projection and never materialize
or mutate provider, commerce, publication, Download, assessment, or Custom
state.

## Integration

Apply migration 116 after the current exact migration 115. Do not edit or
squash migrations 23, 49-52, 104, or 109; migration 116 projects and narrows
their existing evidence additively.

Before release, run the pinned Node 24.18 suites and the empty PostgreSQL 16
verifier with an admin URL. The verifier creates a generated database, applies
all 68 migrations, proves exact policy digest/readiness/idempotent projection
and Download/Custom row-count isolation, then drops only that generated
database and prints `databaseAbsent true`.

No Stripe, browser, DNS, secret, customer, subscription, charge, or publication
operation is part of this packet.
