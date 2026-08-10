# Site Sourcery OPS-ORIGIN-01A + OPS-ORIGIN-WORKER-02 Dell/HQ origin seal — 2026-08-10

## Status

This is held planning and verification tooling only. It does not authorize or
perform SSH, installation, service changes, database changes, network access,
provider access, DNS changes, deployment, publication, customer effects, or
commercial effects. It does not read the Dell/HQ host. Runtime secrets and
credential values are outside the seal and must never be supplied to these
tools.

The packet source base is
`5458d9641fd42c9a1b436c6af6bb6600b60bce74`. That union contains more
migrations than the retained `shape-epoch-20260810` snapshot. Therefore the
retained snapshot is not a valid OPS-ORIGIN input. This packet deliberately
does not copy, update, or hard-code either migration count. A later release
authority must supply one digest-valid successor input whose count, latest
migration, and migration-manifest digest all match the exact clean candidate.

## Authority chain

```text
reviewed shape epoch
  shape-epoch-20260810 + binding digest
                    |
                    v
verified successor release input
  source commit/tree
  built artifact manifest
  units + environment-schema manifests
  held worker runtime manifest + contract
  migration count/latest/manifest
  legal tuple/manifest
  loopback ingress manifest
  exact rollback predecessor
  every capability/effect held
                    |
                    v
deterministic Dell/HQ origin seal
                    |
        +-----------+------------+
        |                        |
        v                        v
held install plan       held rollback plan
        |
        v
separately collected installed readback
        |
        v
fixed-field verified/mismatch receipt
```

The successor input schema is
`sitesourcery.origin-release-input/v1`, defined by
`ops/origin-release-input.schema.json` and enforced again in code. Its nested
epoch is `sitesourcery.release-epoch-successor-input/v1`. The epoch must name a
new ID and supersede exactly `shape-epoch-20260810` at binding SHA-256
`50e1bb83a8e2258d35c27e8d33d69757efd2eb9331c312283ae08d99c56c1bc6`.
It must also bind union base
`5458d9641fd42c9a1b436c6af6bb6600b60bce74`, which the repository verifier
requires to be an ancestor of the candidate. Both the nested epoch and the
whole input have canonical SHA-256 integrity digests.

The resulting seal is `sitesourcery.dell-hq-origin-seal/v1`. It is
deterministic: it contains no observation time and changes whenever any bound
identity changes.

## Seal invariants

1. The checkout is clean for tracked files, `HEAD` equals the successor source
   commit, Git reports the exact source tree, and the packet's union base is an
   ancestor.
2. The reviewed legal candidate is an ancestor of the source commit. The exact
   rollback predecessor is a different ancestor and its Git tree matches the
   successor input.
3. The complete selected artifact tree is a bounded, regular-file-only manifest
   with per-file bytes and SHA-256 values. Symlinks and unsupported filesystem
   entries fail closed.
4. The hosted runtime, external worker, loopback origin, and tunnel unit bytes
   are bound by one unit manifest. The hosted, worker, and Caddy environment
   examples are bound as the environment schema; runtime values and secrets are
   not read or sealed.
5. Migration authority comes only from the successor input. The repository
   recomputes the sorted SQL manifest, count, and latest filename. Absence or
   any disagreement rejects the seal.
6. The legal constants file and every declared retained artifact are hashed and
   byte-counted. The declared document digests must equal the actual artifact
   bytes, and legal publication remains held.
7. Caddy listens only on `127.0.0.1:8081`, proxies the API only to
   `127.0.0.1:8788`, serves the selected `_hosted` tree, rejects unexpected
   hosts, bounds request bodies, and has no direct port 80/443 or TLS authority.
8. The hosted API is `127.0.0.1:8788`, the tenant runtime is
   `127.0.0.1:8080`, tunnel metrics are `127.0.0.1:20241`, both tunnel hostnames
   route only to `127.0.0.1:8081`, and the tunnel configuration ends in
   `http_status:404`.
9. The worker contract separately binds the API and worker entrypoints, worker
   unit, worker environment template, exact held purposes, and the explicit
   API/worker PostgreSQL split. The API source must declare
   `external_process_required` and contain no worker supervisor/factory start;
   the held worker starts no loop, owns no listener, and permits no provider
   effect.
10. Release and commercial controls, Stripe mode, registration mail, and
   recovery mail remain held. The seal grants no capability and permits no
   customer, provider, DNS, or deployment effect.
11. A readback can be `verified` only when every identity field, held worker
    contract, listener expectation, seal digest, and held authority matches
    exactly. Mismatch output contains fixed field codes rather than observed
    values.

## Exact bound files

Unit manifest:

- `ops/sitesourcery-hosted.service.held`
- `ops/sitesourcery-workers.service.held`
- `ops/production-rehearsal/sitesourcery-origin-cloudflare.user.service`
- `ops/production-rehearsal/sitesourcery-cloudflared.user.service`

Environment-schema manifest:

- `ops/hosted.env.example`
- `ops/workers.env.example`
- `ops/caddy.env.example`

Worker-runtime manifest:

- `server/hosted/bin/server.mjs`
- `server/hosted/bin/worker.mjs`
- `ops/sitesourcery-workers.service.held`
- `ops/workers.env.example`

The successor input supplies both the worker manifest digest and its derived
contract digest. The repository recomputes them from the exact clean candidate;
no current release hash, migration count, purpose list, or pool allocation is
manufactured by the origin tooling.

The environment evidence separately projects only each assignment's source
path, variable name, and `secret` or `non-secret-configuration` classification.
The classification projection never includes a value or a value-derived
digest. In particular,
`SITESOURCERY_ENGAGEMENT_TOKEN_SECRET` is classified as `secret` when the
ENGAGEMENT composition commit is present. After merging that commit, release
integration must recompute the environment manifest/classification and the
successor input digests; this packet does not cherry-pick its source or inspect
secret material.

Ingress manifest:

- `ops/Caddyfile.cloudflare-tunnel.candidate.held`
- `ops/cloudflared-sitesourcery-production-dell.yml`
- both loopback origin/tunnel user units above

The artifact root, migration root, and legal constants path are named by the
successor input and remain below its clean repository root. The output seal
records every selected file path, byte count, and digest.

## Offline release preparation

Use pinned Node 24.18.0 from the exact clean candidate. These commands are for
a later release-authority session; they were not run against Dell/HQ by this
packet.

1. Complete the ordinary release build and proofs, leaving the exact built
   artifact tree in the release checkout.
2. Have the release authority produce an origin successor input using the
   exported `createOriginReleaseInput` function. The values must come from the
   sealed release evidence—not from this runbook and not from the stale epoch.
   Set the exact rollback predecessor commit, tree, and previously sealed
   artifact-manifest digest. Keep the authority object exactly held.
3. Store that non-secret input as an immutable local evidence file. Verify it
   against `ops/origin-release-input.schema.json` and review its canonical
   digest.
4. From the clean candidate, create the seal without redirection to a live
   system:

```sh
/opt/sitesourcery/node-24.18.0/bin/node ops/origin-seal.mjs --input /absolute/path/origin-release-input.json
```

The command only reads the local checkout, Git object database, built artifact,
and input. It prints one canonical seal. Any dirty tracked file, missing Git
object, ancestry failure, stale migration count, artifact drift, legal drift,
ingress drift, or lifted hold exits nonzero with fixed failure output.

## Held install planning

After saving and independently hashing the reviewed seal, print its exact held
plan:

```sh
/opt/sitesourcery/node-24.18.0/bin/node ops/origin-install-plan.mjs --seal /absolute/path/origin-seal.json
```

The plan is evidence, not an installer. It requires these gates:

- explicit owner install approval;
- verified successor epoch/input;
- private runtime environment installed out of band without disclosure;
- exact installed readback.

The plan verifies the release directory and every runtime/publication/worker/
tunnel hold, checks only that the private hosted and worker environments exist,
copies the four bound unit candidates in hosted → worker → origin → tunnel
order, selects the exact release symlink, and reloads the two service managers.
`WORKERS_APPROVED` must be absent and `WORKERS_HOLD` present. It contains no
service start, restart, enable, migration, DNS, provider, or deploy command.
Do not execute any plan command during ordinary review.

Secret values are never inferred from `ops/hosted.env.example`. If final runtime
values or credentials are needed, stop this workflow and enter a separately
authorized private host configuration session.

## Installed readback

Installed facts must be collected on Dell/HQ only during a separately
authorized read-only host session. Do not use SSH, inspect the host, or read
private environments under this packet. The observation file has schema
`sitesourcery.dell-hq-origin-installed-readback/v1` and contains only:

- the seal digest, host role, and exact UTC observation time;
- source commit/tree;
- artifact, unit, environment-schema/classification, migration, legal, and
  ingress digests;
- worker-runtime manifest and held-contract digests;
- migration count and latest filename from read-only database/schema evidence;
- the legal authority digest;
- the exact installed held worker contract: API/worker/unit/environment digests,
  selected purposes, API/worker pool allocation, API worker-loop count zero,
  external-process mode, no public listener, and no provider effect;
- the four exact loopback listeners, empty public listener list, outbound-only
  tunnel expectation, and `http_status:404` catch-all;
- the exact held authority object;
- its canonical digest.

Do not include environment values, connection strings, credentials, provider
IDs, customer data, host process arguments, or free-form notes. Compare it:

```sh
/opt/sitesourcery/node-24.18.0/bin/node ops/origin-installed-readback.mjs --seal /absolute/path/origin-seal.json --readback /absolute/path/origin-installed-readback.json
```

Exit zero and state `verified` require all fields to match. State `mismatch` or
any validation failure is a deployment blocker and does not authorize a fix,
service change, migration, or capability lift.

## Exact held rollback planning

Print the rollback plan from the same seal:

```sh
/opt/sitesourcery/node-24.18.0/bin/node ops/origin-rollback-plan.mjs --seal /absolute/path/origin-seal.json
```

The plan names the exact predecessor commit, tree, artifact-manifest digest,
and `/opt/sitesourcery/releases/<predecessor-commit>` directory. Its ordered
commands remove only the tunnel and worker approval markers; stop tunnel →
loopback origin → external worker → hosted runtime; verify and select only the
predecessor directory; reload both service managers; and confirm runtime,
worker, and publication authority remain held.
It deliberately contains no start command. DNS, Pages fallback, database,
provider, payment, mail, customer, and commercial state are untouched.

Before any owner-authorized rollback, independently read back the predecessor
commit, tree, and artifact manifest and compare them with the seal. If the
predecessor directory or any identity is absent or mismatched, stop. Never
substitute a nearby release, reconstruct an artifact, or guess a migration
count.

## Current boundary and residual proof

This packet can prove the tooling and current repository contracts offline. It
cannot truthfully prove a final origin seal until a successor release input and
its final built artifact exist. It cannot prove installed Dell/HQ identity,
Linux unit loading, the installed worker purpose/pool projection, real
listeners, database migrations, tunnel connectivity, or rollback duration
without separately authorized host work. Those are explicit future gates, not
implied successes.
