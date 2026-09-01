# FIN-015 production install/cutover authority control

State: pure held authority construction; no effect adapter

This control composes the protected FIN-015 database upgrade and no-install
runtime bundle without performing either operation. It is specific to installed
release `420bd8a...`/98 migrations, verified-held candidate `8e59f2e...`/102
migrations, upgrade control `33964f9...`, and runtime-bundle control
`84c4c5a...`.

An action-time control is valid for at most 30 minutes. It requires exact live
and ready predecessor identity, the 294-table predecessor schema, active
runtime/static/origin/tunnel/database-tunnel services, active monitor and backup
timers, disabled worker, a runtime bundle prepared within one hour, and a
successful paired Dell-to-Zen encrypted backup completed within one hour. The
backup must have matching Dell/Zen ciphertext hashes, verified clean recovery,
no retained plaintext, held provider egress, and the exact retained predecessor
artifact pair.

The bundle must retain the existing Download-only approved-live Stripe and
production registration/recovery mail authority. Assessment, Custom payments,
Twilio, Domains, Alakazam provider execution, publication, workers, and all new
provider effects remain held. The secret-bearing environment is installed only
by exact byte comparison; its value, byte count, and digest are never recorded.

The deterministic plan orders preflight, immutable staging, full quiesce, exact
migrations 146-149, candidate selection, public proof, supervision restart, and
rollback retention. A failure after the first migration may not restart the
98-migration predecessor until the paired database and app restore is verified.

This module has no filesystem, SSH, PostgreSQL, systemd, network, DNS, browser,
or provider adapter. A protected commit does not authorize production. Before
execution, `/root` must collect a fresh backup and current readback, present the
exact public/database/provider-readiness change, and obtain the owner's exact
action-time install/cutover instruction. Checkout, payment, customer mutation,
provider mutation, DNS mutation, legal acceptance, publication effects, worker
activation, and retirement remain separately unauthorized.
