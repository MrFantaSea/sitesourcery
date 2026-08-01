# Isolated hosted staging services

These are the exact non-secret user-service definitions installed for the
2026-08-01 Site Sourcery staging proof. They document active isolated staging;
they are not production service candidates and authorize no DNS, payment,
domain, or publication change.

## Active placement

- HQ runs `sitesourcery-staging-postgresql.service` as `mrfantasea`.
- Zen runs `sitesourcery-staging-db-tunnel.service` and
  `sitesourcery-staging.service` as `zentech`.
- Zen's existing `sitesourcery-staging-static.service` serves only the verified
  immutable `_hosted` artifact.

Both user accounts have lingering enabled, and all four staging units are
enabled and active. PostgreSQL listens only on its mode-`0700` user-runtime
Unix-socket directory. Zen exposes that socket only as loopback port `55439`
through the reviewed SSH host identity. The API requires and starts after that
tunnel.

The source PostgreSQL 16.14 binary tree and staging database were moved out of
temporary process paths into persistent per-user paths. A logical custom-format
rollback dump remains private on HQ at:

`/home/mrfantasea/.local/state/sitesourcery/backups/ss_staging_20260801-before-durable-d7c33c7.dump`

Its SHA-256 is
`bdd80f22e57778aa9673c4f8ccc4338bcb55685e8349cd99a24ad1d6a86a1461`.
That local mode-`0600` staging dump is rollback evidence, not an encrypted
off-machine production backup.

The old `/tmp/open-pg16-*` files were deliberately retained for rollback but
their PostgreSQL process was cleanly stopped. The manual Zen tunnel was also
stopped. A controlled PostgreSQL restart followed by a tunnel restart preserved
the exact customer/project state and returned local and public health/readiness
to HTTP `200`. No whole-host reboot was performed.
