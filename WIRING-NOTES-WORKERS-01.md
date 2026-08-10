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
state machines. Their loop errors use bounded exponential backoff.

WORKERS-02 closes the earlier export/cancellation composition residual. The
PostgreSQL service now projects exact worker-only ports over the unchanged
cancellation lease and export fence implementations. The external entrypoint
composes those ports without identity, registration, recovery-mail, or Resend
composition. Stripe and export switches remain independently held and every
selected purpose still fails closed unless its dependency readback is ready.

The held unit, environment template, activation/readback steps, and rollback are
in `ops/SITESOURCERY-WORKERS-01-HELD-RUNBOOK.md`. This packet performs none of
those actions and grants no deploy, database, provider, publication, DNS,
commercial, or customer authority.
