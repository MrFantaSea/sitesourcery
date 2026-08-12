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

- Mail delivery.
- Project lifecycle.
- Cancellation.
- Export.
- Alakazam fulfillment.
- Domain lifecycle.
- Care lifecycle.
- The Responder fulfillment.
- Provider reconciliation.
- Monitoring/deadman.

Every loop requires bounded concurrency, lease/claim semantics, stable idempotency, retry classification, dead-letter/operator review, graceful shutdown, and an independent enable/disable control.

## Provider purposes

| Provider | Purposes | Intended final state | Current release rule |
|---|---|---|---|
| Stripe | Assessment/custom start/progress/final, Alakazam, Care, Responder, domains, refunds, billing portal | Live | Independent exact-purpose proof; tax initially `disabled_by_owner` |
| Resend | Verification/recovery, quotes, invoices, progress, publication/domains, Care, Responder, support, marketing | Live | Transactional purposes independently released; marketing requires operator approval |
| Spaceship | Search, quote, registration, DNS, renewal, transfer | Live | Mutations held until consent, vault, exact-price/final-charge, credentials, and reconciliation blockers clear |
| Cloudflare | Successor public edge and approved DNS | Live | No edge mutation before exact cutover approval |
| GitHub Pages | Current placeholder/rollback | Retained during stabilization | Do not replace early |

