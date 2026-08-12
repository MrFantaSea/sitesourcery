# Site Sourcery Public Edge Preflight 05 — Held Binding

Status: local exact-current-release binding only. `publicEdgeReady` is always `false`; this packet grants no DNS, TLS, tunnel, Pages, service, provider, deployment, customer, or authority effect.

## Reused Evidence

No DNS preflight byte was changed or recreated:

- `089c807` and integrated `b2ee901` contain the same blobs for `ops/dns-cutover-preflight.mjs`, its CLI, and its focused test.
- `6ea556a` added the retained receipt at `ops/releases/dns-cutover-preflight-2026-08-10T234906Z.json`.
- The current four tracked blobs are byte-identical to those checkpoints. The retained receipt SHA-256 is `548f136c60ac7b89e4277c566530ffa4741a319a8d71e662f9cb662b8da73f9f`.
- DNS parsing, the 44-query matrix, cutoff, DS/delegation/fallback/mail checks, canonical receipt writing, and fake-runner tests remain solely owned by those files.
- TLS and tunnel probe validation remains solely in `ops/independent-monitor-ports.mjs` and `ops/independent-monitor-runtime.mjs`.
- Tunnel/Caddy shape remains solely in the existing held configuration and `ops/test/cloudflare-tunnel-held.test.mjs`.
- Pages fallback and rollback evidence remain solely in `ops/rollback-rehearsal.mjs`.
- Exact installed epoch, origin seal, and installed readback authority remain solely in `ops/final-release-epoch-v2.mjs` and `ops/origin-seal-runtime.mjs`.

## Added Seam

`ops/public-edge-current-release-binding.mjs` only composes those existing contracts. It requires:

- an exact valid installed final-release-epoch v2 chain and matching loopback API/worker topology;
- the exact retained post-cutoff DNS receipt bytes;
- a fresh, wholly green independent monitor report for that exact epoch and source commit; and
- the exact retained production Pages predecessor through the existing Pages fallback validator.

The immutable result binds the current epoch/source/tree/artifact/ingress/seal/readback/topology, hosted rollback predecessor, Pages predecessor, retained DNS receipt, and independent monitor telemetry. It remains `bound_held`, lists every external blocker, and cannot claim public-edge readiness.

## Local Proof

```sh
/private/tmp/sitesourcery-node-24.18.0/node-v24.18.0-darwin-arm64/bin/node --check ops/public-edge-current-release-binding.mjs
/private/tmp/sitesourcery-node-24.18.0/node-v24.18.0-darwin-arm64/bin/node --check ops/test/public-edge-current-release-binding.test.mjs
/private/tmp/sitesourcery-node-24.18.0/node-v24.18.0-darwin-arm64/bin/node --test ops/test/public-edge-current-release-binding.test.mjs ops/test/dns-cutover-preflight.test.mjs ops/test/independent-monitor.test.mjs ops/test/cloudflare-tunnel-held.test.mjs ops/test/rollback-rehearsal.test.mjs ops/test/final-release-epoch-v2.test.mjs ops/test/origin-seal.test.mjs
git diff --check
```

The new tests use existing local fixture constructors and monitor fake probes. They perform no DNS query, HTTP/TLS connection, browser action, provider call, service action, database action, or external write.

## External Convergence Still Required

Under separate owner authority and only after exact current installation:

1. Run a fresh existing DNS preflight and retain its exact receipt.
2. Prove the exact current loopback origin and connector before delegation.
3. Confirm Cloudflare zone activation and converge only the reviewed nameserver delegation with no mixed resolver answers.
4. Read back apex and `www`, absent reviewed CAA, exact mail records, and the new provider-issued DNSSEC state without reusing an old DS.
5. Read back the active edge certificate for apex and `www`, current tunnel identity, and exact current origin content/API release.
6. Run the independent monitor, public journeys, backup/monitor/rollback checks, and retain immutable external evidence.
7. Stop or roll back to the retained Pages predecessor on pending zone/delegation, mixed DNS, connector/origin mismatch, TLS/CAA drift, stale evidence, or any held-state lift.

Until those facts are externally converged and retained, this binding must remain held and cannot authorize cutover.
