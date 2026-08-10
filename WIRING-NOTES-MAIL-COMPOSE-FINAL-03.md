# MAIL-COMPOSE-FINAL-03 wiring record

Migration `202608100111_hosted_identity_delivery_acceptance.sql` is the
additive identity-delivery acceptance fence. Production composition is complete
in `server/hosted/bin/server.mjs`; no deferred wiring remains.

The composition constructs one PostgreSQL-backed durable mail lifecycle and
wraps only production registration and recovery provider ports. Each wrapper
reserves a digest-only mail row before calling the provider and records
`provider_accepted` only after an exact provider receipt. Held ports stay held.
Development sinks bypass the production wrapper and retain their test-only
`delivered` semantics.

Registration persists the mail-ledger identity and provider acceptance without
creating an account or session. Exact token presentation proves possession and
atomically activates the matching request, creates the first-party account, and
issues its deterministic replay-fenced session.

Recovery persists the matching recovery token, mail-ledger identity, and
provider acceptance. Exact token presentation proves possession and atomically
marks the request delivered, consumes only that token, rotates the credential,
and revokes existing sessions. Provider acceptance alone performs none of those
actions.

All production provider and commercial switches retain their existing held and
readiness gates. This packet changes no provider configuration and performs no
provider effect.
