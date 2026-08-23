# FIN-012 Download Checkout production control

Status: prepared with the existing Download-only authority retained. This
successor control grants no new provider mutation, payment completion, database,
DNS, publication, worker, retirement, or customer-effect authority.

## Exact release graph

- Candidate: `469091e4e7432282758e74e484a5ab5087e977b8`, tree
  `a6a9239fc11be5c7f7de2a2f3401dbaa87a165cf`.
- Held-proof control: `df8cb22705fd4adde7b55280a3f9340b67f9734d`,
  tree `50e5f7df3669d42c8707fb0d04baa52913ef7e39`, sole parent candidate
  `469091e4e7432282758e74e484a5ab5087e977b8`.
- Rollback predecessor and current live runtime:
  `787bb678d73994a44b8e911080e0a9996160c184`, tree
  `e94a44d3750d341f84efa2d4e31bf7116fa8652d`.
- Exact held CI run: `32647761068`, attempt `1`, final receipt digest
  `d5c81b4d3f6224690ba1aec1217f596364c3cb620aaff18aea2c988e88dfec58`.
- Successor input file SHA-256:
  `fc799d840d1e795f9d9e88a4fd480bfbc9faf3aa8f0f87586d90773270f280d8`;
  internal digest
  `f087b9ce2fe7d498b7b881783743d2de6d03deb7a19fdafd3bdb59481b4fb269`.

The held workflow passed the full candidate suite, independent operations proof,
exact Pages and hosted builds, 24-route/six-width browser evidence, fresh
PostgreSQL 16 replay of all 96 migrations, cleanup proof, and immutable final
receipt. Every authority in that receipt is false. The existing live Download
authority comes from the separately approved and already installed production
environment; it is not invented by this held receipt.

## Exact browser-contract correction

The current live browser saved the customer project and accepted the exact
`$20` quote, then the server correctly rejected the Checkout request before
Stripe because the API wrapper omitted `purchaseTermsAccepted:true`. The repaired
candidate requires the browser caller to provide the exact true boolean and
carries it through the v2 request body. The regression proves missing or false
acceptance fails closed. No Checkout Session, PaymentIntent, charge, or completed
payment was created by the rejected attempt.

## Existing Download authority is preserved, not widened

The current production environment contains exactly 122 reviewed assignment
names. The successor generator requires that exact name inventory and these
exact effect modes before it will produce a bundle:

- Stripe: `approved_live`.
- Download: `approved`.
- Assessment, Custom start, Custom change, Custom final, Alakazam, and Alakazam
  lifecycle: `held`.
- Every Twilio purpose: `held`, with no Twilio credential name admitted.
- Publication and workers: retained held/inactive.

The generator reads the real predecessor environment only on Dell, preserves
its opaque values without printing or hashing them, changes only the active
release-evidence bindings and the two registration/recovery module paths, and
then revalidates the same 122-name/mode contract. The prior environment remains
retained for rollback. No secret value or secret-derived digest enters this
control.

## Code-only successor

Candidate `469091e...` changes the browser API asset, its regression, exact
hosted asset seals, and historical test-fixture construction. It adds no
migration. Candidate and predecessor both bind the 96-migration manifest
`2589e3a259b24739b5c4b1c05a0cfb74d15f051d7ab58a9fcc5d580d429b9a62`.

The install therefore forbids database mutation. Pre-install and post-install
readback must both show PostgreSQL 16, 294 application tables, schema SHA-256
`c6531a8817870b1dbbe4b488948e8513a3a07fd64b6076597a102316ca68d3e3`,
96 migrations, and the same latest migration bytes. Any drift stops before
service selection.

## Ordered zero-dollar gate

1. Verify protected main, the exact candidate/control graph, held receipt,
   current live readback, service health, free disk, the exact 122-name/mode
   environment contract, and retained `787bb678...` rollback material.
2. Transport and install candidate `469091e...` plus the generated eight-file
   bundle in parallel without selecting it. Read back Git identity, artifact and
   evidence hashes, ownership, modes, existing Download-only authority, and
   unchanged active unit bytes.
3. Prove the current encrypted rollback pair is retained and healthy. No
   migration or database write is permitted for this code-only successor.
4. Pause backup/monitor timers; stop tunnel, origin, static, and API/tenant;
   prove the database identity remains unchanged and no migration command is
   present or executed.
5. Atomically install candidate active evidence, environment, wrapper, and the
   two managed unit bytes; reload the user manager; start API/tenant and static,
   then origin and tunnel.
6. Require local live/ready, exact candidate epoch/readback, 24 public routes,
   14 redirects, branded 404, legal bytes, browser acceptance, load sample, and
   green monitoring. Resume timers and retain the complete `787bb678...`
   release/environment/evidence/unit rollback pair.
7. In the real signed-in customer browser, create exactly one unpaid `$20`
   Checkout Session and stop on Stripe's hosted page without entering card
   data. Reconcile the open/unpaid provider session and exact metadata without
   exposing its raw identifier.
8. Re-prove public readiness, object readback, monitoring, and database
   invariants after the 15-minute activation boundary. No other payment purpose
   may be widened.

## Cost boundary

The control, proof, code-only install, and unpaid Checkout acceptance cost `$0`.
No purchase, card entry, charge, refund, paid upgrade, or subscription is
authorized. Any later real transaction or paid provider enrollment requires the
owner to receive the exact amount and purpose first and approve that specific
spend.
