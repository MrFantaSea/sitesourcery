# The Responder — provider preflight

This is the authoritative preflight for Twilio-backed Responder activation.
It replaces the former shared-account/shared-campaign/Studio-flow plan.

Verified 2026-08-26 against Twilio's current ISV, subaccount, A2P 10DLC, and
webhook-security documentation. Prices, review times, provider screens, and
carrier rules can change; read them from the live provider at action time.

## Current owner-action boundary

Do not create the Twilio account yet. Creating the free primary account starts
the provider's current trial clock. The owner is asked to create it only after
FIN-013 is protected and the exact release passes held proof.

Creating the free account does not authorize an upgrade, balance load,
auto-recharge, phone number, Secondary Customer Profile, Brand, Campaign,
Messaging Service attachment, registration, message, call, push, or any other
provider effect. Before each paid step, show the owner the exact live amount,
purpose, recurrence, taxes/fees, and cancellation/refund terms and obtain
separate approval.

The Apple Developer Program is a different gate. Do not pay it from this
runbook; organization enrollment waits for D-U-N-S issuance, valid Apple
organization-enrollment access, and the exact live payment screen.

## The required provider shape

Site Sourcery is an ISV: it sends for client businesses. The provider boundary
is therefore:

```text
Desiderata Labs / Site Sourcery primary Twilio account
  ├─ customer organization A subaccount
  │    ├─ Secondary Customer Profile A
  │    ├─ Brand A and Campaign A
  │    ├─ Messaging Service A and number A
  │    ├─ restricted Messaging API key A
  │    ├─ webhook Auth Token A
  │    └─ purpose-separated Voice key/push credentials A
  └─ customer organization B subaccount
       └─ an entirely separate copy of the same authority set
```

Never put multiple customer organizations behind one subaccount, Messaging
Service, Brand, Campaign, Auth Token, API key, or Voice credential. Never use
the primary account Auth Token as a customer runtime credential. Never create a
second provider topology to work around an uncertain first attempt.

The code accepts these registration classes as customer evidence:

- `STANDARD`
- `LOW_VOLUME_STANDARD` (provider Brand type remains `STANDARD`)
- `SOLE_PROPRIETOR`

Do not infer the class from Site Sourcery's own entity type. Select it from the
customer's real provider eligibility and evidence. The current Responder use
case is exactly `CUSTOMER_CARE`.

## Gate 0 — engineering proof before account creation

- [ ] Migration 146 passes from empty PostgreSQL 16.
- [ ] Migration 146 passes against an exact predecessor copy.
- [ ] Outbound SMS resolves the request organization before any HTTP request.
- [ ] Inbound SMS/Voice and delivery callbacks select the untrusted
      `AccountSid`, verify with only that subaccount Auth Token, then require
      the matching active topology.
- [ ] Read-only provider reconciliation carries organization identity and uses
      only that customer's subaccount/API key/Messaging Service.
- [ ] Voice access tokens use only the requesting organization's Voice key and
      platform/environment Push Credential.
- [ ] Unknown organization, unknown account, cross-customer signature,
      duplicate authority, stale topology, and digest mismatch all fail closed.
- [ ] Registry and database serialization contain no raw provider identifier or
      secret.
- [ ] Complete product, hosted, operations, native, credential-topology, and
      held-effect gates pass on the exact clean candidate.
- [ ] Protected review and held release proof pass with every provider effect
      false.

Only after every box above is evidenced should the owner be asked to create the
free primary account.

## Gate 1 — primary account, no spend

- [ ] Owner creates the primary account under the intended business identity.
- [ ] Owner enables strong multifactor authentication and stores recovery
      material under owner control.
- [ ] Operator reads back the exact account/trial state without copying raw
      identifiers into source, chat, logs, or provenance.
- [ ] Operator records only digest-bound, non-secret evidence.
- [ ] Operator stops before any paid upgrade or auto-recharge control.

The primary account is administrative. Customer runtime traffic belongs in
customer subaccounts.

## Gate 2 — exact spend review

At the live console, enumerate every amount that the next action can create:

- account upgrade or minimum balance;
- automatic recharge amount and trigger;
- number monthly rental;
- per-message and per-segment charges plus carrier fees;
- Voice number/minute charges if Voice is released;
- Brand and Campaign registration/vetting fees;
- recurring Campaign fees;
- taxes and any optional/secondary vetting.

Do not use an old dollar figure from this repository as authority. Present the
exact current total/cap and obtain owner approval for that specific action.

## Gate 3 — customer evidence before provisioning

For each customer organization, collect and review only the minimum evidence
needed by the provider and the Site Sourcery contract:

- exact legal or sole-proprietor identity and provider eligibility;
- tax/business identifiers when applicable;
- service address and authorized representative;
- live customer-facing business/service description;
- public privacy and messaging terms required for the exact use case;
- the real consent/opt-out flow and exact sample messages;
- owner-authorized phone/forwarding installation plan;
- selected registration class and exact `CUSTOMER_CARE` use case;
- agreement that the channel is transactional and replies only to the inbound
  call context, with no marketing or re-engagement.

Do not place customer private evidence in Git, continuity, logs, test fixtures,
or provider-topology attestations. Provider/legal compliance is evidence-based;
when the live form or applicable law is unclear, stop that customer activation
for qualified review rather than guessing.

## Gate 4 — one customer topology

Under that customer's subaccount only:

- [ ] Create and approve its Secondary Customer Profile.
- [ ] Create and approve its Brand in the evidenced registration class.
- [ ] Create and approve its `CUSTOMER_CARE` Campaign.
- [ ] Create its Messaging Service and bind only its Campaign/number.
- [ ] Create a restricted Messaging API key for that customer.
- [ ] Retain the subaccount Auth Token only for that customer's callback
      signature validation.
- [ ] If Voice is released, create a separate Voice key and four distinct Push
      Credentials: iOS sandbox/production and Android sandbox/production.
- [ ] Configure the exact Site Sourcery callback URLs.
- [ ] Read back the complete topology from the provider before runtime use.

Registration state and carrier availability must be exact before customer
activation. Do not promise a date from an old review-time estimate.

## Gate 5 — held installation and reconciliation

- [ ] Install one organization-sorted registry entry outside the repository.
- [ ] Attest only digests and lifecycle evidence to PostgreSQL.
- [ ] Bind the customer number only after the matching active topology exists.
- [ ] Start in held mode and prove readiness with zero provider sends/calls.
- [ ] Obtain purpose-specific owner activation authority.
- [ ] Run one controlled customer test, reconcile callback/database evidence,
      and stop on ambiguity instead of retrying.
- [ ] Prove STOP, wrong-account, cross-tenant, no-answer, answered-call, reply,
      and rollback behavior before handoff.

## Operating rules

- Never log request bodies, raw phone numbers, provider identifiers, registry
  contents, Auth Tokens, API secrets, Voice tokens, or Push Credentials.
- Never retry a provider create whose result is uncertain. Reconcile first.
- Retiring a topology is an explicit operator command with durable evidence; it
  does not delete provider objects or historical proof.
- On customer cancellation, restore carrier behavior first, hold new effects,
  and preserve the evidence/retention contract.
- Keep the customer subaccount separate even when the customer is small or the
  provider UI makes a shared object look convenient.

## Official provider references

- Twilio subaccounts: <https://www.twilio.com/docs/iam/api/subaccounts>
- Twilio ISV onboarding: <https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/onboarding-isv>
- Twilio A2P 10DLC: <https://www.twilio.com/docs/messaging/compliance/a2p-10dlc>
- Twilio webhook security: <https://www.twilio.com/docs/usage/webhooks/webhooks-security>
