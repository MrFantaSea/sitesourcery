# The Responder — customer setup runbook

Use this only after FIN-013 is protected/held and the owner has separately
authorized the exact provider and spend actions. It configures one customer;
it is not primary-account setup and it is not a shared Studio-flow recipe.

For the offline field interview and forwarding checks, run:

```sh
node ops/responder-walkthrough.mjs
```

The walkthrough does not create provider objects or authorize spend. Provider
provisioning and database attestation stay in the authenticated operator path.

## 1. Freeze the customer authority

Record the existing Site Sourcery organization and project IDs through the
authenticated operator UI. Confirm:

- the customer and operator actors belong to the exact organization;
- the selected Responder setup/monthly contract is accepted and still held;
- the customer's real business identity and provider registration class are
  reviewed;
- the exact `CUSTOMER_CARE` consent, privacy, terms, opt-out, and sample-message
  evidence is current;
- the carrier/forwarding plan is reversible and owner-authorized;
- no active Twilio topology or number binding already exists for another
  customer.

Do not copy raw customer evidence or provider identifiers into the project
notes, source tree, test fixtures, continuity files, or chat.

## 2. Read the live provider price before every charged action

Stop on the final confirmation screen for each upgrade, balance/recharge,
number, profile, Brand, Campaign, registration/vetting, or recurring fee. Show
the owner the exact amount, purpose, cadence, taxes/fees, and relevant refund or
cancellation behavior. Continue only after that specific spend is approved.

Old prices in Git history are not authority.

## 3. Provision one isolated customer subaccount

From the Site Sourcery primary Twilio account:

1. Create or select exactly one subaccount for the customer organization.
2. Keep its status active only while the Site Sourcery topology is active.
3. Under that subaccount, create its Secondary Customer Profile.
4. Under that profile, create the customer's Brand using its evidenced class.
5. Create the exact `CUSTOMER_CARE` Campaign.
6. Create one customer-specific Messaging Service and attach only that
   Campaign and that customer's number(s).
7. Create one restricted Messaging API key for this customer's message
   send/readback operations.
8. Retain this subaccount's Auth Token only for this customer's webhook
   signatures.
9. If native Voice is being released, create a different Voice API key and four
   distinct Push Credentials: iOS sandbox, iOS production, Android sandbox,
   and Android production.

Never reuse a subaccount, profile, Brand, Campaign, Messaging Service, API key,
Auth Token, or Push Credential across organizations. Messaging and Voice keys
and secrets must be purpose-separated.

## 4. Configure callbacks

Use only the reviewed production origins:

- delivery status: `https://sitesourcery.com/api/v1/provider-events/twilio`
- inbound message: `https://sitesourcery.com/api/v1/provider-events/twilio/inbound-messages`
- inbound Voice: `https://sitesourcery.com/api/v1/provider-events/twilio/voice`
- dial result: `https://sitesourcery.com/api/v1/provider-events/twilio/voice/dial-result`

Confirm the exact paths against the installed release before applying them.
Callbacks must identify the customer subaccount in `AccountSid`. The hosted API
selects that customer first, verifies the signature with only that subaccount's
Auth Token, and then requires the same active digest-only topology.

Do not configure Twilio Studio or a Twilio Function as the Responder runtime.
The Site Sourcery hosted API, durable database, worker, and native clients are
the reviewed implementation. Adding a parallel provider flow would bypass
tenant, consent, STOP, idempotency, retention, and reconciliation controls.

## 5. Install the external registry entry

The registry is outside Git and PostgreSQL at the path named by:

```text
SITESOURCERY_TWILIO_ISV_PROVIDER_REGISTRY_PATH
```

It is JSON with schema `sitesourcery.twilio-isv-provider-registry/v1` and an
`entries` array sorted by `organizationId`. Each entry has exactly:

```text
organizationId
accountSid
messagingApiKeySid
messagingApiKeySecret
webhookAuthToken
messagingServiceSid
customerProfileSid
brandRegistrationSid
campaignSid
registrationClass
campaignUseCase
voiceApiKeySid
voiceApiKeySecret
voiceSandboxPushCredentialSid
voiceProductionPushCredentialSid
voiceAndroidSandboxPushCredentialSid
voiceAndroidProductionPushCredentialSid
```

Installation rules:

- absolute path outside the source tree;
- regular file, never a symlink;
- no more than 256 KiB;
- root/service-group readable only: 0400, 0440, 0600, or 0640;
- no group-write or world bits;
- one sorted entry per organization;
- every provider identifier/secret unique across customers;
- all four Push Credentials distinct;
- Messaging and Voice keys/secrets distinct;
- file content never printed or copied into evidence.

Build a replacement file privately, validate its structure, atomically install
it with owner/mode preserved, and retain the exact prior file as rollback. The
safe registry snapshot exposes only digests and topology metadata.

## 6. Attest the digest-only database topology

Through the authenticated operator boundary, POST to:

```text
/api/v1/operator/responder/organizations/{organizationId}/twilio-topologies
```

The write requires the normal operator authentication, CSRF/origin guard, and
an idempotency key. The request contains the read-back provider identifiers,
the exact registration class/use case, digests of the three secrets, a current
readback timestamp, and an evidence digest. The HTTP boundary hashes all raw
provider identifiers before repository storage.

PostgreSQL stores only lifecycle and SHA-256 evidence. It never stores raw
provider identifiers or secrets. One active topology per organization is
allowed, and all active provider digests are globally unique.

List the topology through the matching operator GET route and verify:

- organization exact;
- active state exact;
- registration class maps to provider Brand type correctly;
- all stored digests match the external registry's safe topology;
- provider-effects evidence remains false.

If anything differs, stop. Do not edit rows manually and do not create another
provider topology to make the first disappear.

## 7. Bind the number

Use the existing Responder operator number-binding boundary. The binding must:

- belong to the same organization/project;
- match the active customer account and Messaging Service digests;
- use the existing keyed phone and identity digest contract;
- preserve operator evidence and idempotency;
- fail if the active topology is absent, retired, duplicated, or mismatched.

Only after the binding reads back exact may the customer's carrier forwarding
be changed.

## 8. Start held, then release one purpose

The independent modes are:

```text
SITESOURCERY_TWILIO_RESPONDER_EVENT_MODE
SITESOURCERY_TWILIO_INBOUND_EVENT_MODE
SITESOURCERY_TWILIO_VOICE_DIAL_MODE
SITESOURCERY_TWILIO_VOICE_ACCESS_MODE
SITESOURCERY_RESPONDER_FULFILLMENT_WORKER_MODE
SITESOURCERY_TWILIO_READBACK_MODE
```

Install and restart with every relevant mode held first. Prove local/public
readiness, registry/topology exactness, and zero provider effect. Release only
the named purpose with fresh owner authorization and retain every other mode
held.

Legacy global Twilio credential variables are forbidden in verified mode. A
startup that sees them must fail closed.

## 9. Field install and tests

Use carrier instructions verified at action time. For the carrier-preserving
Tier 1 launch, conditional no-answer forwarding must be reversible and must not
turn into unconditional forwarding. Write the exact cancel instruction on the
customer handoff.

Run every applicable test with a separately controlled caller device:

- missed call creates one transactional reply;
- answered Tier 1 call creates no missed-call reply;
- caller reply reaches the intended customer path;
- STOP prevents further sends and remains tenant-scoped;
- wrong/customer-crossed callbacks fail with zero durable customer effect;
- delivery callback reconciles the exact prior message only;
- Voice token is incoming-only, short-lived, customer-specific, and uses the
  correct platform/environment Push Credential;
- customer cancellation/held mode restores the ordinary carrier path;
- provider and database evidence reconcile exactly without blind retry.

Never hand over a partially approved, partially routed, or ambiguous customer.

## 10. Failure and rollback

If a customer's phone stops ringing, restore the carrier path first. Then:

1. hold the affected Site Sourcery purpose;
2. preserve the registry, topology, number-binding, callback, provider, and
   database evidence;
3. reconcile before retrying any provider operation;
4. retire every active number binding that depends on the topology through its
   existing operator boundary;
5. retire the topology only through the operator route with an allowed reason
   and evidence digest;
6. restore the prior external registry atomically when rollback requires it;
7. verify other customer organizations remain exact and unaffected.

Topology retirement does not delete provider objects or historical evidence.
Provider cleanup, refunds, number release, and credential revocation are
separate scoped actions and may require fresh owner approval.
