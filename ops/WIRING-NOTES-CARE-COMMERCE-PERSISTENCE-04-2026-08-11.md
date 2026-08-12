# CARE-COMMERCE-PERSISTENCE-04 integration notes — 2026-08-11

This packet closes only the canonical held persistence gap identified by
CARE-COMMERCE-03. It adds migration 124 and an exact PostgreSQL repository; it
does not wire HTTP, UI, composition roots, Stripe, mail delivery, settlement,
accounting, workers, or release controls.

## Non-duplication reconciliation

| Existing authority | Exact overlap decision |
| --- | --- |
| `ss.service_quotes` / `ss.service_quote_revisions` | Not reusable: `purpose = 'assessment'`, one quote per assessment case, an assessment offering/intake is mandatory, and the revision/line constraints fix the amount to $200 and the component to `website_assessment_standard`. Care binds a migration-121 contract/period/catalog identity and supports separately sealed Rescue/Outside Management price lines. |
| `ss.service_invoices` / `ss.service_payment_reservations` | Not reusable: both require an accepted assessment quote/installment; invoice purpose is `assessment`, reservation purpose is `assessment_invoice`, subtotal is exactly $200, and the reservation remains tax-calculation-specific. CARE-COMMERCE-04 persists only a pre-invoice professional-invoice reservation, never an invoice or payment effect. |
| `ss.service_professional_payment_bindings` | Not reusable: the view is sourced only from authoritative assessment and Custom payment receipts. Care has no receipt or settlement and therefore must not appear in the binding. |
| `ss.accounting_purpose_journal` | Not reusable: allowed source relations and purposes require an authoritative payment/provider receipt. A held Care reservation has no charge, tax result, fee, payout, or accounting entry. |
| `ss.commerce_transition_notification_sources` / outbox | Not reusable: the source registry enumerates committed assessment/Custom/payment/reversal states and every outbox row requires a held durable mail reservation. This packet neither creates a mail reservation nor sends. |
| `ss.care_customer_contracts` / `ss.care_periods` | Reused directly by foreign keys and trigger checks; no duplicate tenant/customer/project/contract/period state is added. |
| `ss.care_commands` | Reused as the only Care command/idempotency authority. Migration 124 widens only its action/resource checks and atomically binds each successful command to one new quote or reservation result. No `care_commerce_commands` or command-event table exists. |

The three new relations are irreducible: one immutable Care quote snapshot,
one one-per-quote current reservation projection, and one append-only
reservation-revision evidence stream. They store no service invoice, payment
receipt, professional payment binding, accounting entry, or mail outbox row.

## Canonical state and invariants

- Migration 121's `ss.care_commands` remains the only Care command journal.
  Migration 124 adds only the four commerce actions and two resource kinds.
  A command is inserted atomically with its quote/reservation result; failed
  preparation leaves no claim, and a concurrent winner forces exact readback.
- `ss.care_commerce_quotes` stores one immutable, non-payable held quote. The
  row and canonical JSON bind tenant, customer, project, Care contract and
  period, Care catalog identity/version, server price version, commercial
  contract digest, amount, tax hold, disclosure, expiry, actor, and all false
  effect flags.
- `ss.care_commerce_reservations` stores the one-per-quote current held
  professional-invoice reservation projection. Its only transitions are
  revision 1 held to revision 2 cancelled-before-submission or
  ambiguity-review-required. No provider request, settlement, reversal, or
  released tax state can be persisted.
- `ss.care_commerce_reservation_events` preserves every reservation revision
  append-only. Outside the existing sealed terminal project purge boundary,
  quote, command, and reservation-event evidence cannot be updated or deleted.
- All three new relations are forced-RLS, service-role only, and authorize writes
  only for the transaction-local organization/operator with both
  `service_management_manage` and `service_invoice_manage`. Service grants are
  select/insert plus update on the current reservation projection only; there
  is no delete grant.

## Later composition

1. Production composition may replace `createMemoryCareCommerceRepository`
   with `createPostgresCareCommerceRepository` only after migration 124 is in
   the exact successor release inventory and repository readiness is green.
2. Keep `commercialReady`, payable, dispatch, payment, provider, mail-delivery,
   and customer effects false. Do not add a Stripe mutation port merely because
   durable local reservation now exists.
3. Keep the existing authenticated Care HTTP/UI boundary separate until a
   later lane explicitly wires the durable repository. This packet intentionally
   edits no HTTP, root, asset, or UI path.
4. Settlement requires its own exact Care purpose, authoritative Stripe
   readback, accounting projection, cancellation confirmation, and reversal
   contract. None is inferred from a held reservation.

## Remaining gates

- Owner-redlined catalog/legal release for Custom Care, Alakazam Care, and
  complex or unknown Outside Management scopes.
- Exact supportability-review/accepted-site dependency proof before Outside
  Management onboarding or monthly reservations.
- Care-specific tax-purpose release, professional-invoice dispatch,
  settlement/readback, accounting, refund/reversal, and provider ambiguity
  reconciliation.
- Production composition and readiness wiring, customer/operator journey and
  accessibility proof, supervised fulfillment and mail workers, monitoring,
  owner approval, and live commercial/provider release.
