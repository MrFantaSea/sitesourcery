# Mandatory capability manifest

Every row is required. `held` may describe effect authority only after implementation is complete; it may not conceal missing composition.

| Capability | Required runtime boundary | Required proof | Target |
|---|---|---|---|
| Public successor | `_site` explicit allowlist | Route, content, accessibility, browser, deterministic hash | Public after cutover |
| Hosted browser | `_hosted` reviewed transform | Customer/operator journeys and deterministic hash | Live |
| Accounts/recovery | Hosted API + PostgreSQL + Resend | Verification, recovery, replay, expiry, negative auth | Live |
| Organizations/tenancy | Hosted API + PostgreSQL | Tenant isolation and role enforcement | Live |
| Projects/downloads | API + tenant runtime + PostgreSQL | Version, acceptance, payment, download, export | Live |
| Publication | API + tenant runtime + worker | Release, rollback, unpublish, address, operator approval | Live with operator gate |
| Assessment/custom | API + PostgreSQL + Stripe + mail | Quote, credit, installments, changes, final payment, handoff | Live after purpose gates |
| Alakazam | API + PostgreSQL + worker + Stripe | Tier, billing, lifecycle, fulfillment, publication | Live after purpose gate |
| Domains | API + PostgreSQL + worker + Spaceship/DNS | Search through transfer, exact price/charge, custody, reconciliation | Live after provider blockers |
| Care | API + PostgreSQL + worker + Stripe/mail | Plan, tickets, usage, billing, cancellation, reconciliation | Live after purpose gate |
| The Responder | API + PostgreSQL + worker + communications provider | Setup, consent, messaging, opt-out, billing, monitoring | Live after purpose gate |
| Operator/support | Hosted operator routes + PostgreSQL | Least privilege, queues, support lifecycle, audit | Live |
| Transactional mail | Mail event plane + worker + Resend | All nine declared mail purposes, suppression, retry, readback | Live per purpose |
| Provider reconciliation | PostgreSQL + worker/operator queue | Idempotency, ambiguity, replay, manual resolution | Live |
| Backup/restore | Dell/HQ/Zen operations | Daily encrypted backup, independent restore, invariants | Live |
| Monitoring/deadman | Independent operations units | Failure and recovery alert delivery | Live |
| Client Profile Hub | Contract adapter/crosswalk | Identity, provenance, one-way event, conflict proof | Full integration |
| Dell commercial engine | Digest-bound adapter/crosswalk | Catalog/scope/quote/readback contract | Full integration |
| Marketing desk | Contract adapter | Prospect authority, DNC, operator-approved send | Full integration |
| Messenger/command/phone | Contract adapters | Shared identity references and controlled commands | Full integration |

