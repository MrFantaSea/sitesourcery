# SUPPORT-CASE-01 wiring notes

Status: held. This packet creates an auditable support/privacy case authority;
it does not open a customer or operator route, send mail, execute an export,
erase an account/project, or change a provider.

## Canonical components

- Migration: `202608100110_support_privacy_case_lifecycle.sql`
- Feature marker: `canonical-support-case-v1-auditable-held-lifecycle`
- Domain: `server/hosted/support-cases.mjs`
- PostgreSQL repository: `server/hosted/support-cases-postgres.mjs`
- Held HTTP contract: `server/hosted/support-cases-http.mjs`
- Production-safe defaults: `createHeldSupportCaseService()` and
  `createHeldSupportCaseHttpBoundary()`

Supported request kinds are `support`, `access`, `correction`, `export`,
`deletion`, and `appeal`. `export` and `deletion` are classifications only.
Nothing in this packet writes `export_requests`, invokes an export worker,
changes identity/account state, starts retention/deletion jobs, or purges data.

Phone, email, and manual intake must be converted by an authorized operator
adapter into an opaque requester HMAC/reference digest and bounded evidence
digests. The adapter must not send contact values, message text, attachments,
identity documents, tokens, or raw correspondence into this ledger. The
authenticated path similarly accepts classifications and digests only.

## Required future composition

1. Keep both held factories in production until the separate route/composition
   packet is approved.
2. Add the documented customer/operator routes from
   `SUPPORT_CASE_HTTP_ROUTES` to the HTTP composition only after CSRF,
   authentication, selected-organization/project resolution, rate limiting,
   and operator capability checks are proven at that boundary.
3. Use the customer repository methods only with the signed-in user and
   selected organization. General phone/email/manual cases remain operator-only
   unless a separately reviewed requester-access mechanism is implemented.
4. Operator commands require a current `service_case_manage` grant. Deadline
   dates and their basis digests must come from an owner-reviewed policy or a
   specific reviewed legal determination; this packet invents no universal
   response or appeal period.
5. `reserveNotification` may use only a MAIL-01 port whose
   `providerEffects` value is `false`. It first creates a
   `support_notification` reservation and then links it to the case only while
   the mail projection remains `pending`. The case read model reports
   `reserved`, never sent, accepted, or delivered.
6. A later mail-provider packet may advance the independent MAIL-01 projection.
   It must not rewrite the case reservation receipt or treat provider
   acceptance as delivery.

## Existing support tickets

`ss.support_tickets` and `ss.support_messages` remain the old project
conversation model and contain subject/message bodies. They are included in
legacy project exports. SUPPORT-CASE-01 neither mutates nor imports them. Do not
use those tables as the privacy-rights authority, and do not copy their message
bodies into the new digest-only evidence or event tables.

## Logging and evidence boundary

Logs may contain a generated correlation ID, operation name, safe error code,
and outcome. They must not contain contact values or digests, requester
references, case evidence digests, correspondence, identity material, response
or denial content, MAIL identifiers, tokens, or provider details. Evidence
bytes remain in a separately authorized private system; this ledger stores only
their opaque digest and bounded kind/source/time.

No production secret, Resend configuration, deletion/export executor, hot
composition root, or customer DOM change is needed or authorized by this
packet.
