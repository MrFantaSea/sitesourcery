# Monitor Dead-Man 02 Held Composition

## Bounded Delta

The existing independent monitor already binds the exact final release identity, emits fixed-code digest-based telemetry, writes a private heartbeat, and evaluates missing, stale, invalid, and wrong-release heartbeat states. The existing operations alert stack already owns persistent alert transitions, delivery approvals, provider delivery, and test-only delivery proof. This packet does not recreate those contracts.

The missing local boundary was the second-failure-domain seam between them. `independent-dead-man-alert.mjs` adds a digest-bound heartbeat evidence envelope naming distinct source and observer failure domains, a monotonic state reducer, duplicate/out-of-order/sequence-conflict handling, deterministic incident/change/recovery transition IDs, digest-bound alert receipts, a default global hold and kill switch, and provider-neutral state and alert ports.

No migration is required. The observer state is small, private operational state and the packet defines a compare-and-swap port rather than adding application database authority. A future installation may use a separately reviewed local durable file or external evidence store on the independent observer.

## Local Acceptance

Run only repository-local fixture proof with pinned Node 24.18.0:

```sh
/private/tmp/sitesourcery-node-24.18.0/node-v24.18.0-darwin-arm64/bin/node --check ops/independent-dead-man-alert.mjs
/private/tmp/sitesourcery-node-24.18.0/node-v24.18.0-darwin-arm64/bin/node --test --test-concurrency=1 ops/test/independent-dead-man-alert.test.mjs ops/test/independent-monitor.test.mjs ops/test/alert-delivery-proof.test.mjs ops/test/backup-restore-monitor.test.mjs ops/test/resend-alert-transport.test.mjs
git diff --check
```

The focused tests use deterministic clocks, an in-memory compare-and-swap state port, and a provider-neutral fake alert port with `externalEffects:false`. They do not open a socket, resolve DNS, read credentials, or contact a provider. Every retained object contains only release identity, safe failure-domain IDs, fixed codes, sequence/time fields, and SHA-256 digests; exact-key validation rejects PII-bearing additions.

## Held Invariants

- The default adapter is `held`, its kill switch is `engaged`, and it never calls an alert port.
- The only callable delivery mode in this packet is `local_fixture`; it rejects any port declaring external effects.
- An alert-required transition is not committed while delivery remains held, so later reviewed delivery cannot be silently suppressed.
- Retry uses one deterministic transition ID. Duplicate heartbeats do not advance state; lower sequences, reused sequences with different bytes, and non-monotonic observation times fail closed without replacing the accepted heartbeat.
- Network and alert effects remain held. The composition cannot mutate customer, payment, mail, provider, publication, DNS, deployment, backup, or application state.

## External Gates Left Open

1. Select and attest an actual second failure domain outside the origin, backup destination, and primary monitor scheduler.
2. Approve and install a read-only heartbeat evidence transport between the two observer domains.
3. Select a durable compare-and-swap state implementation and retain its private-state backup/restore policy.
4. Select the alert provider and destination, approve credentials and delivery authority, and bind a real provider adapter outside this held packet.
5. Decide primary and secondary on-call ownership, escalation timing, quiet-hours policy, acknowledgement handling, and replacement coverage.
6. Authorize installation and service activation, then retain real incident, missed-heartbeat, recovery, alert-delivery, and dead-man-host-loss receipts.

No SSH, installation, service action, provider call, alert, DNS change, deployment, authority issuance, credential access, or production mutation is authorized by this packet.
