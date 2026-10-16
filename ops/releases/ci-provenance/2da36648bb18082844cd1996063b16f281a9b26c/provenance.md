# Care PostgreSQL loopback acceptance correction

Implementation `2da36648bb18082844cd1996063b16f281a9b26c`, tree `508b3475e0008897e381bd6783e5648f9c6a6478`, direct protected base `c43c2b43ab3358fae9bb98a5fb38d11e755a53ac`.

Original held run38893161198/1 failed before Care fixture setup because PostgreSQL `inet_server_addr()::text` returns `127.0.0.1/32` over TCP. Its safety assertion allowed only bare loopback addresses or the Unix-socket null. The earlier local proof used a Unix socket and therefore did not expose the representation mismatch. The sole source change projects `host(inet_server_addr())`; the exact loopback allowlist and disposable database-name guard remain intact. Application code, migrations, dependency locks and business behavior are unchanged.

## Actual validation

The existing complete Care PostgreSQL acceptance passed against PostgreSQL16 over TCP127.0.0.1 with all107 migrations in the exact disposable `ss_care_catalog_20261016`. Test stdout SHA256 `4265410035d9752b508ba099664fb4e634659448fd37d134313bb7da5693ec97`; result receipt SHA256 `599220f9940e82f5bfab69aa26c25a1db189bab7898557d059161c6808c00cf7`. The database was dropped and absence confirmed. Fake provider only; no external provider or production data effects.

One complete `npm test` ran on this exact implementation under the existing pinned Node24.18/Chromium and caffeinate, ending `2026-10-16T12:01:08.398372+00:00` with exit0. Original stdout SHA256 `da9896d218b69f193a14e00d662c4263c1af8bc4c6f9f1884e8b06d66dc9610b` and stderr SHA256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`. This includes both builds and the existing browser audit. Owned scratch and processes are absent; original logs, build outputs and failed GitHub evidence remain retained.

Root reviewed the exact failure and authorized only this SQL projection correction; the successful TCP proof exercises the previously failing transport. The original failed CI log SHA256 is `cba30bde8ca3930001ea34594ada467e4a71b2a569247b65a1991e9d7d96e995`. No acceptance threshold, address restriction or fixture isolation was weakened.

## Release boundary

This is source qualification only. A new protected candidate/control and original held CI result are required. Production schema107 installation, native Care activation and real paid-period/customer delivery remain separately reviewed effects. No deployment, checkout, charge or whole-system completion is claimed.
