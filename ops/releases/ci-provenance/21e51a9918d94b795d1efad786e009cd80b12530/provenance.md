# Public TLS monitoring for the existing Cloudflare ingress

Implementation `21e51a9918d94b795d1efad786e009cd80b12530`, tree `05b9bcd24b2ae8457126c3a16f56677dcc2751e8`, direct protected base `372b2ed0d1a1e5824e2372b3421fffc2b8255eff`.

This three-file operations change adds an explicit `public_tls` certificate mode to the existing monitor. It reuses the unchanged independent-monitor TLS verifier for a bounded authenticated handshake with the configured hostname and SNI, then passes certificate validity and expiry through the existing disk/database/backup/runtime monitoring flow. Local certificate-file mode and publication-held behavior remain supported. No certificate-copy service, new monitor service, provider credential or alert transport is introduced.

## Actual qualification

The original focused command `--test ops/test/monitor-public-tls.test.mjs ops/test/monitor-storage.test.mjs ops/test/backup-restore-monitor.test.mjs ops/test/independent-monitor.test.mjs` passed59 checks, including7 new public-TLS cases; no failures or skips. Original stdout SHA256 `7389f5d66c05e3d50074150ecb0f7a825644e5531bca3ce5f7cd104847a85d1b`. Root reviewed the exact three-file delta and unchanged shared TLS primitive.

One read-only handshake to `proof.sitesourcery.me:443` completed `2026-10-16T13:42:52.496Z`, authenticated with TLSv1.3 and a certificate expiring `2027-01-14T00:29:22.000Z`. Original TLS receipt SHA256 `1b59e240f50af2e3c088b23a77cc9dd87f0c192569a921f9842fd28d64a9ae29`. It sent no HTTP request, opened no database connection and delivered no alert. This observation proves the configured TLS endpoint at that time; it does not claim monitor installation or later endpoint availability.

One complete `npm test` on this exact implementation finished `2026-10-16T13:54:11.778766+00:00` with exit0. Original stdout SHA256 `d61de33c26f7e672f0bb350eb9d6985c990b3e5e57ff78c229c902e73cced816`; stderr SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`; execution receipt SHA256 `3bbf6cafa45a7ced8a0bd6fb2397ce04425b58fbe7e287432b2e08d7d046d830`. The existing full command includes both builds and the browser audit. Owned qualification scratch and processes were removed; cleanup receipt SHA256 `6b5f93a16e53385c3696b530f9dc4765c363d951251b96ff64545b6ecd1a5fca`. Original logs and generated build outputs remain retained.

No PostgreSQL acceptance is added for this monitor-only delta: application, Care, migration, dependency and provider bytes are unchanged from the protected base. Existing Care proof and source history are preserved. The separately owned Care startup clone89910 remains deliberately retained; it is not a disposable created by this monitor qualification and this evidence does not assert its removal or fresh session state.

## Release boundary

This is source qualification only. Normal protected GitHub candidate/control qualification, exact native source installation, monitor configuration alignment and real installed monitor acceptance remain separate steps. No production service, database, environment, provider, alert or customer state changed during this qualification; no checkout, subscription, charge or spending occurred.
