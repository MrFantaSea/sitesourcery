# PRO-LIFECYCLE-COMPOSE-02 wiring notes

This packet composes existing additive boundaries into one held production
readiness aggregate. It adds no migration, environment variable, secret,
provider call, customer route, operator route, worker, UI, legal/control file,
DNS action, or deployment effect.

## Exact composition

`server/hosted/professional-lifecycle-production-composition.mjs` binds:

1. the already-composed Legal-V4 customer Engagement boundary;
2. the v108 professional-reversal repository and monotonic domain service,
   with held v117 direct-reversal normalization required at readiness;
3. the v114 committed-source notification reservation boundary;
4. the existing v54/v111 MAIL reservation lifecycle;
5. the v112 source-authoritative operator queue with only its existing
   `professional_reversal_reconcile` repair; and
6. the v115 projection-only accounting journal.

The aggregate reports `mode: held`, `notificationDelivery: reserved_only`,
`providerEffects: false`, `automaticRestoration: false`,
`genericRepair: false`, and `authoritativeAccounting: false`. Readiness uses
fixed PII-free codes and performs read-only contract/RLS/grant checks. It does
not synchronize accounting, refresh the queue, reserve a notification, ingest
provider evidence, or deliver mail.

## Approval gate

Assessment, Custom initial, Custom accepted-change, and Custom final release
assertions now require the exact
`sitesourcery.professional-lifecycle-production-readiness/v1` object in
addition to their existing Stripe/tax/payment/storage readiness. Held releases
still skip approval assertions and remain effect-free. An approved purpose
fails startup if any aggregate contract is missing, expanded, or claims mail
delivery, provider effects, automatic restoration, a generic repair, or
authoritative accounting.

## Preserved holds

- No Stripe webhook is routed to professional reversal from this packet.
- No transition hook calls notification `reserve`; the boundary only proves
  the atomic source-plus-pending-MAIL contract is installed.
- No pending MAIL reservation is called accepted or delivered.
- Operator queue and accounting methods have no HTTP or worker call site.
- Reversal consequences remain monotonic; dispute wins or failed refunds do
  not automatically restore access, credits, quotes, or work.
- No mark-paid, complete, delete, refund, publish, or generic repair path is
  introduced.

Integrate this commit after DIRECT-REVERSAL-02 commit `5d69ded` (migration 117)
even though this isolated packet remains based on
`e9e68635cd84e4750eadf9a58a604a184ea3126a`. No migration inventory, release
tuple, provider configuration, or environment template update is required.
