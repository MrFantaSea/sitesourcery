# Process, worker, and provider manifest

Schema: `sitesourcery.capability-process-matrix/v1`

Frozen by: FIN-006 unified composition

Proved candidate: `bd88d45630212dc6f0a954be246389ea92788834`

## Exact six-process candidate

All six entries are source state `candidate`, installation state
`not_installed`, and runtime state `not_asserted`. This is an all-held release
candidate, not an installed-process receipt.

| Key | Exact role | Listener | Effect default |
|---|---|---|---|
| `public_static` | `public_static_artifact` | None | Static |
| `hosted_api` | `hosted_api_and_publication_writer` | `127.0.0.1:8788` | Held |
| `tenant_runtime` | `read_only_tenant_runtime` | `127.0.0.1:8080` | Held |
| `postgresql` | `durable_authority` | `private_database` | Internal |
| `worker` | `listener_free_worker` | None | Held |
| `monitoring_deadman` | `independent_monitor` | None | Held |

The successor has three physically separate application processes: API,
read-only tenant runtime, and listener-free worker. The API is the sole
filesystem publication writer. Worker publication commands cross an exact
authenticated loopback Unix-domain-socket boundary. The sealed predecessor is
modeled honestly as a combined API/tenant process with its held worker stopped;
rollback never starts fictitious predecessor tenant or worker processes.

## Mandatory worker purposes

| Requirement | Exact worker purpose or failure domain | Candidate activation |
|---|---|---|
| W1 Mail delivery | `notification-mail` | Held |
| W2 Project lifecycle | `project-lifecycle` | Held |
| W3 Cancellation | `cancellation` | Held |
| W4 Export | `export` | Held |
| W5 Alakazam fulfillment | `alakazam-fulfillment`, `alakazam-retained-lifecycle` | Held |
| W6 Domain lifecycle | `domain-lifecycle` | Held |
| W7 Care lifecycle | `care-lifecycle` | Held |
| W8 Responder fulfillment | `responder-fulfillment`, with separately fenced `responder-retention` | Held |
| W9 Provider reconciliation | `provider-reconciliation` | Held |
| W10 Monitoring/deadman | Independent monitor and dead-man units/timers | Held |

The exact listener-free worker purpose order is `export`, `cancellation`,
`notification-mail`, `alakazam-fulfillment`,
`alakazam-retained-lifecycle`, `responder-fulfillment`,
`provider-reconciliation`, `responder-retention`, `project-lifecycle`,
`domain-lifecycle`, and `care-lifecycle`. W10 remains outside the worker failure
domain. Every loop has bounded concurrency, lease/fence or exact singleton
authority, stable idempotency, retry/manual-review posture, independent
activation control, and graceful-stop proof. Installed heartbeat/PID readback
belongs to FIN-009.

Twilio inbound SMS/Voice, delivery-status callbacks, and Voice invitation
ingress are authenticated API boundaries, not worker loops. They remain held.

## Exact nine transactional-mail purposes

| Purpose | Reservation/source authority at FIN-006 | Delivery effect |
|---|---|---|
| Verification/recovery | Existing direct account bridge | Held |
| Assessments/quotes | Existing commerce reservations | Held |
| Invoices/receipts | Existing commerce reservations | Held |
| Project progress | Purpose notification source/outbox | Held |
| Publication/domain notices | Purpose notification source/outbox | Held |
| Care notices | Purpose notification source/outbox | Held |
| Responder notices | Purpose notification source/outbox | Held |
| Support updates | Existing support reservations | Held |
| Marketing/follow-up | Consent-safe existing-customer purpose source only | Held |

The new purpose lane freezes 14 exact source arms and a reviewed 40-template
registry. It stores no arbitrary copy or provider address. The generic operator
reservation boundary requires exact source evidence; this proof does not claim
that every producer already triggers a reservation automatically.

## Provider purposes

| Provider | Purposes | Candidate rule |
|---|---|---|
| Stripe | Assessment/Custom, Alakazam, Care, Responder, Domains, refunds, portal | Every exact purpose held pending its later release gate |
| Resend | The nine transactional-mail purposes | Reservation/render/dispatch engineering proved; sends held per purpose |
| Twilio | Responder SMS, callbacks, inbound SMS/Voice, managed Voice | Exact credential/readback and separate purpose approval required |
| Spaceship | Search, quote, registration, DNS, renewal, transfer | Mutations held pending consent, custody, price, credential, and reconciliation gates |
| Cloudflare | Successor edge and approved DNS | No edge or DNS mutation before exact cutover approval |
| GitHub Pages | Current placeholder and rollback | Retained through stabilization; not replaced by FIN-006 |

The old private Dell rehearsal is a separate predecessor state: its existing
registration/recovery mail is production-configured under prior approval,
while its other listed provider/public effects remain held. FIN-006 neither
activated nor deactivated that pre-existing configuration.
