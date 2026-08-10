# OPS-QUEUE-01 held wiring notes

Status: held. This packet adds a source-authoritative operator queue and exact
contracts. PRO-LIFECYCLE-COMPOSE-02 now constructs the queue inside the held
hosted professional-lifecycle aggregate with only the existing professional
reversal reconciliation port. It remains absent from the hosted HTTP root,
customer DOM, Stripe router, alert transport, provider adapters, and workers.

## Authority and source rules

- Read and refresh require the existing expiring
  `service_management_manage` operator capability. This is queue authority,
  not payment, job, support, publication, domain, Care, or mail authority.
- `ss.operator_work_queue_items` is a rebuildable projection. The source table
  remains authoritative. Every item records exact source table, source key,
  source revision, source digest, and bounded source state.
- A repeated refresh over unchanged source facts performs no update and does
  not increment the queue revision. When a source stops requiring work, the
  projection resolves the item; it never changes the source.
- No queue command can mark a payment paid, complete a job, delete an account,
  publish a site, buy or change a domain, claim delivery, or lift a hold.
- The sole dispatchable repair is
  `professional_reversal_reconcile`. It binds the current queue item to the
  existing `reconcileEvidence` port and its exact lifecycle revision and
  evidence ID. Every other item has `repair: null`.

## Source coverage

The refresh projects only bounded facts from:

1. assessment, Custom-initial, Custom-change, and Custom-final Stripe event
   rows already in `reconciliation_required`;
2. undelivered assessment jobs and Custom jobs without a completion package;
3. professional reversal lifecycles requiring evidence reconciliation;
4. open SUPPORT-CASE-01 support/privacy cases;
5. the current generic publication-control hold (the older Alakazam customer
   command is intentionally not duplicated);
6. failed/manual-review domain provider operations;
7. held `$35` and `$50` Care requests;
8. open MAIL-01 exceptions; and
9. digest-only `invoice.finalization_failed` evidence.

`domain_manual_reviews` is not separately projected because it lacks a source
revision and digest. The bounded domain provider-operation failure/manual-
review source is used instead; do not manufacture identity for the older row.

## Remaining composition, in order

1. Preserve the current repository and service construction with the canonical
   PostgreSQL authority, professional-services reversal service, and server
   clock.
2. Wire the three held manifest routes only after the owner surface has exact
   authentication, CSRF, and idempotency gates. Do not add a generic repair
   endpoint.
3. In the already signature-verifying shared Stripe router, route only
   `invoice.finalization_failed` into
   `recordInvoiceFinalizationFailure`. Supply HMAC/SHA-256 digests of provider
   event ID and invoice ID, payload digest, signature-verification digest, one
   bounded reason code, and provider event time. Never pass or log raw payload,
   invoice contents, customer fields, provider error messages, or secrets.
4. Refresh after committed source transitions or on a bounded operator poll.
   Refresh performs no provider or alert effect.

## Holds

- Production composition constructs the held queue, but no HTTP/provider/alert
  call site is registered.
- No outbound alert is sent; invoice-finalization rows only establish durable
  owner-alert evidence for later reviewed alert composition.
- Publication, domain, Care, and all commercial/provider switches remain held.
- The current integration successor includes the additive union through
  migration 117 and totals 70 migrations. PRO-LIFECYCLE-COMPOSE-02 adds none.
