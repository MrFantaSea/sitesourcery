# ENGAGEMENT-01 protected-root and UI wiring notes — 2026-08-10

This packet adds the PostgreSQL, repository, domain, and exact HTTP request
contracts for customer engagement invitations. It deliberately does not edit
`server/hosted/repository-postgres.mjs`, `server/hosted/bin/server.mjs`, or the
large Abracadabra customer DOM. The two HTTP routes are implemented in
`server/hosted/http.mjs` and default to the inert held boundary.

It does not send email, create a quote, apply an assessment credit, contact
Stripe, publish a site, or create an Abracadabra preview. The issue response
returns the one-time claim token to the authenticated operator. Any later mail
delivery must be a separately durable, provider-reconciled packet.

## 1. Canonical PostgreSQL readiness

In `server/hosted/repository-postgres.mjs`, extend the canonical readiness
query and required-boolean projection with one `engagement_bootstrap_ready`
field. It must require all of the following, not merely the migration marker:

- `ss.hosted_runtime_contract_v106()` returns exactly
  `canonical-ss-v106-customer-engagement-bootstrap`;
- `ss.customer_engagement_invitations` and `ss.customer_engagements` exist;
- both tables have forced RLS;
- `anon` and `authenticated` have no invitation-table privilege;
- `service_role` has exactly the invitation `SELECT, INSERT, UPDATE` and
  engagement `SELECT, INSERT` contract needed by the repository;
- `service_role` has no engagement `UPDATE` or `DELETE` privilege; and
- the `customer_engagement_invitations_guard` and
  `customer_engagements_guard` triggers exist and are enabled.

Do not relax any v53/V4 or earlier readiness predicate. A runtime with V4 but
without migration `202608100106` must remain unable to compose this boundary.

## 2. Hosted composition

In `server/hosted/bin/server.mjs`, import:

- `createHostedEngagementBootstrap` from
  `../engagement-bootstrap.mjs`; and
- `createPostgresEngagementBootstrapRepository` from
  `../engagement-bootstrap-postgres.mjs`.

After `projectLegalAuthorityConfig` is resolved, compose the boundary only
when its authority is non-null:

```js
const engagementRepository =
  createPostgresEngagementBootstrapRepository({
    authority,
    legalAuthority: projectLegalAuthorityConfig.authority,
    pepper: identityPepper,
    pepperVersion:
      process.env.SITESOURCERY_IDENTITY_PEPPER_VERSION ?? "v1"
  });
const engagementBootstrap = createHostedEngagementBootstrap({
  repository: engagementRepository,
  legalAuthority: projectLegalAuthorityConfig.authority,
  tokenSecret: secret("SITESOURCERY_ENGAGEMENT_TOKEN_SECRET")
});
```

`SITESOURCERY_ENGAGEMENT_TOKEN_SECRET` is a new independent random secret of
at least 32 bytes. Do not reuse the Stripe, contact-vault, CSRF, cookie, or
identity pepper bytes for token derivation. The identity pepper is passed only
to the repository so it can create or verify the canonical password PHC.

If joint Legal V4 or v54 readiness is absent, pass the held engagement
boundary instead. Do not fall back to V3, a fixture authority, or a synthetic
effective date.

Pass `engagementBootstrap` to `createHostedApi` beside the other named
boundaries. No commercial/provider enablement flag changes are part of this
packet.

## 3. Exact HTTP integration

`server/hosted/http.mjs` already applies this exact integration; preserve it
when composing the release branch:

1. Import `createHeldHostedEngagementBootstrap` and accept an optional
   `engagementBootstrap` boundary. Default it to the held implementation and
   require `issueInvitation` and `claimInvitation` methods.
2. Add only `/api/v1/auth/engagement-claim` to
   `SESSIONLESS_IDENTITY_WRITES`. The operator issue route remains session
   authenticated. Both writes keep the existing CSRF, same-origin, body-size,
   and `Idempotency-Key` enforcement.
3. Add `POST /api/v1/operator/engagement-invitations`. Require a non-null
   actor, call `exactRouteBody(write,
   ENGAGEMENT_HTTP_ROUTES.issue.bodyKeys, ...)`, then call
   `engagementBootstrap.issueInvitation(actor, input)` and return `201`.
4. Add `POST /api/v1/auth/engagement-claim`. Validate `write` against
   `ENGAGEMENT_HTTP_ROUTES.claim.bodyKeys`. Call the boundary with that exact
   object plus `userAgentDigest: digestUserAgent(request.headers.get(
   "user-agent"))`; a client-supplied digest must be rejected as an extra body
   field.
5. Require the claim result's private `sessionToken` to be a string of at
   least 32 characters, remove it with `publicAuthenticationResult`, return
   `201`, and set it only through the existing `sessionCookie` helper.

The public claim error must remain the single
`ENGAGEMENT_CLAIM_FAILED`/`409` response for unknown, expired, consumed,
identity-collision, wrong-password, and concurrent-claim failures. Do not map
repository details into HTTP messages or logs.

## 4. UI follow-on

Do not add another project concept. The claim response already returns the
canonical organization, project, engagement, legal receipt, and session.

The operator surface should collect exactly the issue contract exported as
`ENGAGEMENT_HTTP_ROUTES.issue.bodyKeys`. For a new direct inquiry,
`organizationId` is null and `organizationName` is required. An existing
direct customer binds an explicit organization ID. A delivered-assessment
successor binds both that organization ID and the immutable delivered report
ID. Site selection is either `{ "kind": "new_site" }` or a canonical root
HTTPS external URL.

The customer claim surface should first fetch the existing public Legal V4
authority, submit its exact three-document acceptance with the password and
claim token, then navigate to the returned canonical project room. It must not
create a preview, synthesize a second organization/project, or expose the
claim token after success.

CUSTOM-DIRECT-01 owns later quote creation and optional-credit arithmetic.
This packet must not infer, display, reserve, or apply a credit.

## 5. Integration proof

Run with pinned Node `24.18.0`:

```sh
node --test \
  server/hosted/test/engagement-bootstrap.test.mjs \
  server/data-plane/tests/postgres-migration-structure.test.mjs
SITESOURCERY_PG_CORE_RELEASE_ADMIN_URL=postgresql://HOST/ADMIN_DB \
  node server/data-plane/tests/verify-empty-postgres-migrations.mjs
```

Require `customerEngagementBootstrapJourney true` and `databaseAbsent true`.
The journey proves deterministic issue/claim replay, indistinguishable unknown
and expired claims, credential/session creation, canonical project
projections, exact Legal V4 receipt plus three required terms, Custom project
profile creation, customer-visible engagement RLS, and invitation default
deny.
