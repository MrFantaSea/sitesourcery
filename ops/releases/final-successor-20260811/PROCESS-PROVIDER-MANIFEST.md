# Process, worker, and provider manifest

## Processes

| Process | Responsibility | Effect default |
|---|---|---|
| Public/static service | Serve exact `_site` artifact | Static |
| Hosted/API service | Sessions, customer/operator HTTP, commands/readback | Provider effects held by purpose |
| Tenant runtime | Serve accepted project/publication bytes | Publication held until gate |
| PostgreSQL | Durable authority and outbox/audit state | Internal |
| Worker | Explicit lifecycle allowlist only | Each loop independently held/enabled |
| Independent monitor/deadman | Health, backup, disk, TLS, queues, alerting | Alert path independently gated |

## Mandatory worker loops

| Requirement | Process purpose or independent failure domain | Current activation |
|---|---|---|
| W1 Mail delivery | `notification-mail` | Held |
| W2 Project lifecycle | `project-lifecycle` | Held |
| W3 Cancellation | `cancellation` | Held |
| W4 Export | `export` | Held |
| W5 Alakazam fulfillment | `alakazam-fulfillment`, `alakazam-retained-lifecycle` | Held |
| W6 Domain lifecycle | `domain-lifecycle` (readback/reconciliation only) | Held |
| W7 Care lifecycle | `care-lifecycle` | Held |
| W8 Responder fulfillment | `responder-fulfillment`; inbound follow-up feeds its existing encrypted queue; `responder-retention` is separately fenced | Held |
| W9 Provider reconciliation | `provider-reconciliation` | Held |
| W10 Monitoring/deadman | Independent monitor and dead-man units/timers, outside the worker process | Held |

The exact worker-process purpose order is `export`, `cancellation`,
`notification-mail`, `alakazam-fulfillment`,
`alakazam-retained-lifecycle`, `responder-fulfillment`,
`provider-reconciliation`, `responder-retention`, `project-lifecycle`,
`domain-lifecycle`, and `care-lifecycle`. W10 is intentionally independent so
a failed worker process cannot disable its own detector.

Every loop requires bounded concurrency, lease/claim semantics, stable idempotency, retry classification, dead-letter/operator review, graceful shutdown, and an independent enable/disable control.

Twilio inbound SMS/Voice ingestion, delivery-status callbacks, and Voice
dialing are API-process boundaries rather than worker loops. All remain held by
default. Verified Voice can emit only the fixed private `<Dial action>` for an
encrypted operator-provisioned target after signed durable arrival; a signed
missed result creates one consent-gated encrypted follow-up for the existing
Responder fulfillment purpose.

## Provider purposes

| Provider | Purposes | Intended final state | Current release rule |
|---|---|---|---|
| Stripe | Assessment/custom start/progress/final, Alakazam, Care, Responder, domains, refunds, billing portal | Built for independent live purposes; held now | Independent exact-purpose proof; tax initially `disabled_by_owner` |
| Resend | Verification/recovery, quotes, invoices, progress, publication/domains, Care, Responder, support, marketing | Built for independent live purposes; held now | Transactional purposes independently released; marketing requires operator approval |
| Twilio | Responder outbound SMS, delivery callbacks, inbound SMS/Voice, private Voice dial, missed-call follow-up | Built for independently verified purposes; held now | Exact credential/readback/callback binding and separate purpose approval required |
| Spaceship | Search, quote, registration, DNS, renewal, transfer | Built toward live; mutations held now | Mutations held until consent, vault, exact-price/final-charge, credentials, and reconciliation blockers clear |
| Cloudflare | Successor public edge and approved DNS | Built toward live; held now | No edge mutation before exact cutover approval |
| GitHub Pages | Current placeholder/rollback | Retained during stabilization | Do not replace early |
