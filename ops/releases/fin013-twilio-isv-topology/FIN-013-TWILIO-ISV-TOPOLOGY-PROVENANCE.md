# FIN-013 Twilio ISV customer-isolation provenance

Recorded: 2026-08-26T14:57:06-0400 EDT

## Finding and bounded correction

Protected-main input is
`76ff456e9c2f002358dbed42e5ee115e855cdba2`, tree
`b60368129028a7d8d1468dbcc1fe71f93e9dcf94`. The installed Responder Twilio
adapters were held, but their verified-mode design selected one global Account,
Messaging Service, Brand, Campaign, API key, Auth Token, and Voice authority
for every tenant. Tenant-scoped number-binding digests did not make that global
provider authority customer-isolated.

Implementation `73e6c3b6914bd2cad054c55a9e6396ca2aadfeaf`, tree
`012390a34585f4583b5fc291141a25f48699fc88`, replaces that boundary with one
primary Site Sourcery account and one Twilio subaccount per customer
organization. Its exact 45-path change adds migration 146, a root-owned
external customer registry, digest-only PostgreSQL topology evidence, an
authenticated operator attestation/lifecycle surface, and organization-bound
selection for outbound SMS, inbound and delivery callbacks, provider
readback/reconciliation, number ownership, and native Voice authorization.

The external registry is opened no-follow through one file descriptor and
must be a root-owned, single-link regular file no larger than 256 KiB with mode
0400, 0440, 0600, or 0640. Raw provider identifiers and secrets stay outside
Git and PostgreSQL. Safe registry serialization and database receipts contain
only digests and bounded topology metadata.

## Isolation and lifecycle proof

The implementation fails before provider or private-material access for an
unknown organization. Callback `AccountSid` selects exactly one customer Auth
Token; a second customer's valid token cannot authenticate or mutate the first
customer's delivery or inbound evidence. Reconciliation carries the durable
organization identity into read-only lookup. Voice token issuance selects the
requesting organization before the token factory runs.

Migration 146 permits one active topology per organization and makes active
subaccounts, profiles, Brands, Campaigns, Messaging Services, API keys,
secrets, Auth Tokens, and platform/environment Push Credentials customer-
unique. Ordered transaction advisory locks make cross-column resource-family
uniqueness race-safe for every service-role writer. A number binding requires
the matching active customer topology, and a topology cannot retire until its
dependent active number bindings retire first. Rows are forced-RLS,
service-role-only, digest-only, durable, and mutable only through the exact
active-to-retired transition.

## Exact local proof

- Final registry, operator-HTTP, and migration proof: 13/13.
- Product/client proof under Node 24.18.0: 892/892.
- Complete hosted-service proof with local-only socket authority: 1,110 passed,
  zero failed, 16 intentional no-database skips, 1,126 total.
- Clean-Git operations proof: 252/252. The preceding dirty-tree run passed 248
  and failed only the four intentional immutable-Git-identity tests.
- Self-host proof: 24/24. Site, legal, authority, catalog, and deterministic
  hosted-artifact checks passed.
- A fresh PostgreSQL 16.14 verifier applied all 99 migrations, passed every
  historical database journey, and removed its database. A retained fresh
  verifier then passed the exact topology lifecycle, cross-purpose collision,
  and active-binding retirement-fence integration 1/1 before exact removal;
  final readback found zero matching databases.
- Migration 146 SHA-256 is
  `044afa6a2964941ac6169c4802ce3a1493ffffd2f399b199c362b4c2975033a6`.

Machine receipt
`ops/releases/fin013-twilio-isv-topology/implementation-receipt.json` has
SHA-256
`0b5e45170a60d851e0075f10b4d0f1cae0d8367ab547232cc85303890549dee4`.

## Effect and owner-action boundary

No real Twilio read or mutation occurred. No account, subaccount, profile,
Brand, Campaign, Messaging Service, API key, Auth Token, Push Credential,
number, message, call, registration, customer, production database, deployment,
public, DNS, or spend effect occurred. Production remains on the prior installed
held runtime and 98-migration database.

This local receipt is not provider activation authority. Protected review and
held proof are next. Only after those gates pass should the owner be asked to
create the free primary Twilio account. Any upgrade, balance/recharge, number,
registration, recurring fee, or usage charge requires a later action-time
provider readback and separate exact owner approval.

The Apple Developer Program payment is unrelated and remains not due. D-U-N-S
issuance and valid organization-enrollment access must exist before the owner
is shown the exact live Apple fee screen.
