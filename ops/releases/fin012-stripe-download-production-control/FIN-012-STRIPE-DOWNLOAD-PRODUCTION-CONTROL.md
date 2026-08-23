# FIN-012 Stripe Download production control

Status: prepared and held. This successor control grants no installation, cutover, database, provider, payment, DNS, publication, retirement, or customer-effect authority.

## Exact release graph

- Candidate: `787bb678d73994a44b8e911080e0a9996160c184`, tree `e94a44d3750d341f84efa2d4e31bf7116fa8652d`.
- Held-proof control: `a79182c6e624c2585525c524d7416fd57d7ce52d`, tree `fd66a88b43f55bdbe14d6b34f38a12b757369b69`, sole parent candidate `787bb678d73994a44b8e911080e0a9996160c184`.
- Rollback predecessor and current live runtime: `14ca61bd0991c0d326699311e380c29c621931df`, tree `b953a3fbfd5853b29f3e72f0f05c7f75e04eba4d`.
- Exact held CI run: `32607286113`, attempt `1`, final receipt digest `29c0cf2ceff8a424c7b2dff56b1f46214f00c9632c3639a84feda58d554e630f`.
- Successor input file SHA-256: `5fe7070738908c1971643af6ef29e3c7c6437b53a9d6dd7c526373b4aa722da4`; internal digest `7bb0b82962fa2abe7aae50e0f1cae99a4ec7758735b262f7b9b05d0a83e09b49`.

The held workflow passed its full candidate suite, independent operations proof, exact Pages and hosted builds, 24-route/six-width browser evidence, fresh PostgreSQL 16 replay of all 96 migrations, cleanup proof, and immutable final receipt. Every capability and effect in that receipt is false.

## Code-only successor

The public predecessor already runs the exact 96-migration schema ending at `202608220143_download_protection_v1.sql`. Candidate `787bb678...` changes Stripe readiness logic, tests, browser-audit teardown, and provenance only. It introduces no migration and its migration manifest remains `2589e3a259b24739b5c4b1c05a0cfb74d15f051d7ab58a9fcc5d580d429b9a62`.

The cutover therefore forbids database mutation. Pre-install and post-install readback must both show PostgreSQL 16, 294 application tables, schema SHA-256 `c6531a8817870b1dbbe4b488948e8513a3a07fd64b6076597a102316ca68d3e3`, 96 migrations, and the same latest migration bytes. Any drift stops before service selection.

## Production architecture preserved

The successor uses the accepted Dell user-service architecture under `/home/simtech/sitesourcery-production`. It replaces only the selected API/tenant and static runtime release, candidate-specific environment/evidence paths, wrapper, and two managed unit files. The origin gateway, Cloudflare connector, Node 24.18.0 toolchain, database tunnel, state roots, backup machinery, monitor machinery, and existing registration/recovery mail lane remain in place.

The bundle generator inherits the exact held predecessor environment through the already proven FIN-012 validator, then replaces only the two mail-module release paths and the candidate-bound evidence hashes. It rejects Stripe or Twilio secret-bearing names, requires every provider mode held, and proves the predecessor release identifier is absent from the generated wrapper and managed units. The old `ops/releases/fin012-production-control` directory is not modified and remains the immutable rollback authority for the live predecessor.

## Ordered zero-dollar gate

1. Verify protected main, the exact candidate/control graph, CI receipt, current live readback, service health, free disk, and retained `14ca61bd...` runtime/environment/evidence/unit pair.
2. Transport and install candidate `787bb678...` plus the generated eight-file candidate bundle in parallel without selecting it. Read back Git identity, artifact/evidence hashes, ownership, modes, held provider state, and unchanged active unit bytes.
3. Take a fresh encrypted Zen backup and require immutable manifest/ciphertext hashes, zero retained plaintext, clean recovery, and a ready rollback pair. This backup does not authorize database mutation.
4. Obtain exact owner authorization for the zero-dollar code-only runtime/static cutover. Stripe activation remains excluded from this cutover.
5. Pause backup/monitor timers; stop tunnel, origin, static, and API/tenant services; prove the database identity remains unchanged and no migration command is present or executed.
6. Atomically install candidate active evidence, environment, wrapper, and the two managed unit bytes; reload the user manager; start API/tenant and static, then origin and tunnel.
7. Require local liveness/readiness, exact candidate epoch/readback, all 24 public routes, 14 legacy redirects, legal bytes, browser acceptance, load sample, and green monitor output while every payment/provider purpose remains held.
8. Resume timers. Retain `14ca61bd...`, its environment, evidence, units, and paired backup. A code-only rollback is schema-compatible because both releases bind the same 96-migration database. Retirement remains a later explicit gate.

## Download-only activation remains separate

After the held candidate is stable, create fresh provider-scope and live object evidence within the 15-minute activation window. Only then may the separately approved `SITESOURCERY_STRIPE_MODE=approved_live` configuration release the `$20 Download` purpose while every other payment purpose remains held. The live acceptance may create one unpaid Checkout Session; it may not complete a card charge or self-purchase.

## Cost boundary

This preparation, proof, parallel install, backup, and code-only cutover require `$0`. No purchase or charge is authorized. The already approved Stripe event-fee schedule applies only after the separate Download activation boundary is proven; a completed payment remains unauthorized.
