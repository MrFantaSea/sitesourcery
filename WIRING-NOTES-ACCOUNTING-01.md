# ACCOUNTING-01 L4 Wiring Notes

PRO-LIFECYCLE-COMPOSE-02 registers ACCOUNTING-01 only inside the held
professional-lifecycle production aggregate. Its exact readiness is required
before a professional payment purpose can be approved. It remains
projection-only and non-authoritative, and no HTTP route, synchronization
trigger, operator export, provider input, or customer capability is registered.

When the owner authorizes operator accounting access, a later packet may:

1. Preserve the current held aggregate construction with the canonical
   PostgreSQL authority; do not add a provider client, Stripe readback,
   customer route, or product-state mutation port.
2. Expose `list` and `export` only through an existing authenticated operator
   surface that supplies `actorId` and `operatorOrganizationId`; PostgreSQL
   rechecks `service_management_manage`.
3. Invoke `synchronize` only after an authoritative receipt transaction
   commits or as an operator backfill command. It is deterministic and
   append-only, but it does not authorize or reconcile product state.

No line is authorized yet in `server/hosted/http.mjs`, `server/hosted/postgres-service.mjs`, any customer DOM, provider adapter, control, DNS, deployment, or release file.
