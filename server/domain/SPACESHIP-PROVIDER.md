# Spaceship provider boundary

Reviewed **2026-08-31**. This document records the provider facts used by
`adapters/spaceship.mjs`; it is not authorization to call Spaceship.

## Official sources

- [Spaceship public API 1.0.0](https://docs.spaceship.dev/) — fixed API origin,
  key/secret headers, permissions, endpoints, rate limits, schemas, HTTP 202
  semantics, and the exact `spaceship-async-operationid` response header.
- [Spaceship MCP tools reference](https://www.spaceship.com/knowledgebase/spaceship-mcp/)
  — updated 2026-08-18; documents the no-charge `domain_register` preview,
  standard and premium USD pricing, the `confirm` boundary, and the remote MCP
  URL.
- [Universal Terms](https://www.spaceship.com/legal/universal-terms-of-service-agreement/)
  — last updated 2026-06-12.
- [Domain Registration Agreement](https://www.spaceship.com/legal/domain-registration-agreement/)
  — last updated 2025-02-10.
- [WHOIS Privacy Service Agreement](https://www.spaceship.com/legal/whois-privacy-service-agreement/)
  — last updated 2024-12-13.
- [Supplemental Registry Agreement](https://www.spaceship.com/legal/supplemental-registry-agreement-for-certain-tlds/)
  — last updated 2025-02-11.

The sources must be reviewed again before any staged provider call and whenever
Spaceship changes an API, tool, agreement, or permission.

## Architecture and pricing boundary

The ordinary API is used only for capabilities it publicly documents:

| Capability | Method and path | Permission |
| --- | --- | --- |
| Availability | `GET /api/v1/domains/{domain}/available` | `domains:read` |
| Contact save/readback | `PUT /api/v1/contacts`; `GET /api/v1/contacts/{id}` | `contacts:write`, `contacts:read` |
| Registration | `POST /api/v1/domains/{domain}` | `domains:billing` |
| Operation status | `GET /api/v1/async-operations/{id}` | `asyncoperations:read` |
| Domain/registrant readback | `GET /api/v1/domains/{domain}` | `domains:read` |
| Transfer lock/auth code | `PUT .../transfer/lock`; `GET .../transfer/auth-code` | `domains:transfer` |
| Nameservers | `PUT .../nameservers` plus domain readback | `domains:write`, `domains:read` |
| DNS records | `GET`, `PUT`, `DELETE /api/v1/dns/records/{domain}` | `dnsrecords:read`, `dnsrecords:write` |

The ordinary REST availability response documents a registration price only
for premium names. It does not document a complete no-charge standard-domain
price response, so the REST adapter does not invent one. The newer official MCP
reference does document USD availability pricing for both standard and premium
names.

Instead, `previewRegistration` requires one narrow injected source. Its output
must carry the exact provenance
`spaceship-mcp.domain_register.preview/2026-08-18`, say
`confirmation_required` and `noCharge: true`, bind the A-label domain and
registration years, contain a current observation time, and supply a safe
integer USD amount in minor units. Every mismatch fails closed.

The official MCP reference documents a no-charge first call that returns the
domain, registration term, exact USD charge, privacy and auto-renew choices,
payment and contact details, and a confirmation token. Registration and spend
occur only on the second call using that token. Its public setup guidance still
describes the remote URL, interactive sign-in, and user-approved access rather
than a general server-to-server credential contract. Production automation
therefore still needs a reviewed authentication and secret-storage design.

The billed REST registration response is HTTP 202 plus the exact async
operation header. Its documented response does not contain the final provider
charge. The adapter returns `price: null`; it does not echo the customer's
expected price as provider-observed money. The existing orchestrator therefore
holds capture for reconciliation instead of pretending a final registrar
charge is known.

## Contact vault contract

Registrant PII and API credentials never enter configuration, logs, errors,
orders, audit records, or source control. The injected encrypted vault must:

1. return API key and secret only at request time;
2. return a profile whose digest exactly matches the customer's accepted
   profile evidence;
3. durably claim each provider-contact fingerprint before dispatch;
4. return `pending` or `unknown` after a crash so the adapter cannot repeat an
   uncertain contact save;
5. complete the claim only after provider contact readback exactly matches the
   encrypted profile; and
6. store only opaque provider IDs in the binding.

The API has no documented contact-list operation or idempotency key. A timeout,
reset, server error, malformed success, lost contact ID, or failed readback
after contact dispatch is therefore ambiguous and remains a manual stop.

## Failure certainty

Every provider mutation is attempted at most once by the adapter.

- A documented HTTP 4xx response is an authoritative pre-submission rejection
  and maps to `not_submitted`.
- Timeout, reset, redirect failure, HTTP 5xx, oversized/malformed success,
  malformed HTTP 202, or missing/invalid async operation ID after an
  irreversible dispatch maps to `ambiguous`.
- An ambiguous registration confirmation must never be retried automatically.
- HTTP 202 does not prove registration success. Poll the returned operation,
  then read the exact domain and registrant contact back.
- A write readback mismatch for contacts, transfer lock, nameservers, or DNS is
  ambiguous. Repeating the mutation is forbidden until reconciled.

Requests always target `https://spaceship.dev/api/v1`, reject redirects, use a
bounded timeout and response body, require documented JSON types, and never
emit request bodies, response bodies, API headers, contact data, or auth codes
to the event sink.

## Third-party agency and registrant duties

The Domain Registration Agreement expressly contemplates registration for a
third party, but requires the account holder to:

- be authorized to act as that person's agent;
- give notice of the disclosure and use of every third party's information;
- obtain express consent to that disclosure and use;
- disclose to the customer that the domain is registered through Spaceship and
  that Spaceship or its provider is the ICANN-accredited registrar;
- never represent Site Sourcery as an ICANN-accredited registrar or as having
  superior registry access;
- keep registrant, administrative, technical, and billing contact data current
  and accurate; and
- obtain the required privacy/public-WHOIS consent for every listed contact.

Customers must receive and accept versioned copies of the then-current
Universal Terms, Domain Registration Agreement, WHOIS Privacy terms when
applicable, and every relevant registry/TLD supplement. Site Sourcery must
retain the version, digest, timestamp, authenticated actor/session, registrant
profile digest, and disclosure evidence.

The commercial-permission blocker is resolved. The owner reports prior express
written permission from Spaceship by email for Site Sourcery's commercial
middleman model. The raw email and private identifiers are not stored here.
Before launch, retain a private reference to that permission in release
evidence; do not reopen the old “permission missing” loop.

## Technical completion versus launch authority

Implemented and mock-tested:

- fixed-origin authenticated transport with bounded parsing;
- IDNA A-label normalization and validation;
- durable contact claim, save, and exact readback;
- fail-closed no-charge preview interface;
- one-shot registration confirmation and async polling;
- portfolio/domain/registrant readback;
- transfer evidence, lock read-before-write, and auth-code retrieval;
- nameserver and hosted A/AAAA/CNAME/ALIAS/TXT DNS controls with readback; and
- a local readiness assessment that makes zero provider calls.

Still required before live construction is permitted:

- a private release-evidence reference to the owner-confirmed written
  resale/commercial-use permission;
- owner approval naming the environment and exact allowed capabilities;
- publication-release approval;
- API credentials in an encrypted secret vault, never environment plaintext;
- an encrypted contact vault implementing the durable claim contract;
- a real-provider implementation for the reviewed authenticated exact-price
  boundary's standard/premium preview contract;
- approved, versioned registrant/agency/privacy disclosures;
- the exact API scopes listed by `spaceship-readiness.mjs`;
- staging reconciliation procedures for unknown contact and registration
  effects; and
- a real-provider final-charge readback implementation and staging proof for
  the reviewed pre-capture evidence boundary.

Run the non-mutating assessment with exact Node 24.18.0:

```sh
npm run readiness:spaceship
```

By default it reports a not-ready state and exits non-zero. It does not
read credential values, contact data, the network, DNS, or Spaceship, and it
cannot register or bill anything.
