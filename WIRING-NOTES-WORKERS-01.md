# WORKERS-01 wiring notes

`server/hosted/bin/server.mjs` now starts no worker loop and caps its physical
pool at `apiConnections`. `server/hosted/bin/worker.mjs` is the only production
worker entrypoint and caps its independent pool at
`workerReservedConnections`, with canonical authority workload `worker`.
Together they preserve the PG-OPS total rather than adding connections.

The supervisor recognizes only the four existing purposes and performs every
dependency readback before starting any. The Alakazam fulfillment factory owns
the existing publication stage and the retained lifecycle factory owns the
existing grace/retention loop. Both reuse their unchanged repositories and
state machines. Their loop errors now use bounded exponential backoff.

Export and cancellation production factories are deliberately absent until
their exact processing ports can be extracted from the monolithic hosted
service after MAIL-COMPOSE-FINAL-03. This entrypoint imports no identity or mail
module, and an activated config requesting either purpose fails closed before
starting the composed Alakazam purposes.

The held unit, environment template, activation/readback steps, and rollback are
in `ops/SITESOURCERY-WORKERS-01-HELD-RUNBOOK.md`. This packet performs none of
those actions and grants no deploy, database, provider, publication, DNS,
commercial, or customer authority.
