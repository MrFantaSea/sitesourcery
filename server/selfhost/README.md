# Site Sourcery self-host foundation

This is an isolated, dependency-free Node 24.18.0 foundation for serving Site
Sourcery customer static sites from Dell/HQ-owned Linux machines without
Cloudflare, Vercel, Supabase, Docker, or GitHub Pages.

It is deliberately under **`PUBLICATION_HOLD`**:

- no process was started;
- no listener was opened;
- no Caddy or systemd file was installed;
- no package was downloaded;
- no DNS, router, firewall, TLS, or certificate state was changed;
- no customer site was published.

The repository is an implementation and rehearsal artifact, not production
approval.

## What it implements

- immutable, checksummed, multi-file static releases on local disk;
- exact hostname-to-project-to-release mappings in durable checksummed JSON;
- copy-on-write state revisions, atomic `rename`, file and directory `fsync`;
- optimistic binding revisions and serialized in-process mutation;
- atomic release activation and rollback by switching one mapping;
- fail-closed restart recovery from the committed `current.json`;
- release byte-length and SHA-256 verification on every read;
- hostname normalization and URL/Host agreement;
- traversal, encoded traversal, control-character, and symlink rejection;
- opaque dark/unknown-host behavior;
- `GET`, `HEAD`, ETag, and must-revalidate caching;
- loopback-only liveness/readiness and Caddy On-Demand TLS `ask` contracts;
- a checksummed backup/export manifest that enumerates every required file;
- held Caddy and systemd candidate templates.

It does not implement customer editing, payments, accounts, DNS automation,
email, analytics, or a public control API. The existing hosted-service contracts
remain the source for those concerns.

## Storage model

```text
DATA_ROOT/
├── control/
│   ├── current.json
│   └── revisions/
│       └── 00000000000000000005-<sha256>.json
└── releases/
    └── <project-id>/
        └── <release-id>/
            ├── release-manifest.json
            ├── index.html
            └── assets/...
```

Release directories are created off-path, files and a checksummed manifest are
fully flushed, the tree is made read-only, and the directory is atomically
renamed into its immutable identity. A release ID cannot be reused for different
bytes.

Control mutations write a full immutable history snapshot first, then atomically
replace `current.json`. An orphan future history file after a crash is not a
commit and is ignored on restart. A corrupt `current.json` makes readiness fail
and prevents serving; the runtime does not guess which historical snapshot the
operator intended.

Activation changes only:

```text
hostname.currentReleaseId
hostname.previousReleaseId
hostname.revision
```

It never modifies an active release directory. Rollback swaps the mapping back
to a previously registered immutable release.

## Request behavior

Tenant requests:

- accept only `GET` and `HEAD`;
- require the URL authority and `Host` header to normalize to the same DNS name;
- resolve one exact active hostname mapping;
- read only a manifest-listed relative file below the exact immutable release;
- re-read the hostname mapping after artifact verification;
- return `404` for unknown/dark/mismatched hosts and paths;
- return generic `503` for control or artifact corruption;
- return `503` while `PUBLICATION_HOLD` exists.

Loopback control requests:

| Path | Held result | Released result |
| --- | --- | --- |
| `/_sitesourcery/health` | `200`, `publicationHeld: true` | `200` |
| `/_sitesourcery/ready` | `503` | `200` only after control/release verification |
| `/_sitesourcery/tls/allow?domain=...` | `403` | `200` only for one exact active, TLS-approved custom hostname |

The internal paths return `404` when requested through a tenant Host, and the
held Caddy candidate blocks them before proxying.

## Caddy TLS design

[Caddy's official On-Demand TLS documentation](https://caddyserver.com/docs/caddyfile/options#on-demand-tls)
states that the `ask` endpoint receives `?domain=` and that only a `2xx`
response authorizes certificate issuance. It recommends a fast indexed lookup
with no DNS or external network call. The runtime uses an exact object-map
lookup, rejects duplicate/extra query parameters, and verifies the active
release manifest before returning `200`.

The held candidate:

- sends all public HTTP(S) through Caddy;
- keeps Node on `127.0.0.1:8080`;
- enables On-Demand TLS only behind the `ask` gate;
- blocks all `/_sitesourcery/*` paths publicly;
- keeps Caddy's admin API on a Unix socket.

The candidate is not proof that a certificate can be issued. Caddy still needs
working inbound port 80/443 reachability, public DNS, a non-blocked ISP path,
outbound ACME access, a synchronized clock, durable certificate storage, and a
real validation run. Caddy's docs also note that Automatic HTTPS may create an
HTTP listener for redirects and ACME challenges at runtime.

Official references:

- https://caddyserver.com/docs/caddyfile/options#on-demand-tls
- https://caddyserver.com/docs/caddyfile/directives/tls
- https://caddyserver.com/docs/automatic-https

The current `ask` contract intentionally authorizes only `source: custom`.
Platform-subdomain TLS needs its own reviewed strategy—either exact-host
On-Demand authorization or a separately managed wildcard certificate—before
platform hostnames can be part of the public product.

## Publication hold

Four fail-closed guards are represented:

1. repository `PUBLICATION_HOLD` makes the Node runtime unready and tenant
   responses unavailable;
2. Node also requires `/etc/sitesourcery/PUBLICATION_APPROVED`;
3. the systemd candidate requires that approval file and refuses startup when
   `/etc/sitesourcery/PUBLICATION_HOLD` exists;
4. all operational files end in `.held` or `.candidate.held`.

No code path automatically removes a hold. The owner must explicitly approve a
release checklist after real infrastructure proof.

## Backup and restore

`bin/export-backup-manifest.mjs` is read-only. It emits:

- the checksummed complete control state;
- the committed control revision;
- every immutable release manifest digest;
- every file path, size, and SHA-256 required for recovery.

The manifest is evidence for a backup; it is not itself the backup. A real
backup system must copy the listed paths, encrypt the copy, place it on a
different failure domain, retain versions, and complete a clean-machine restore
drill. See [BACKUP-RESTORE.md](./docs/BACKUP-RESTORE.md).

## Run tests

No install is required. Tests and the server entry point fail closed unless the
runtime is exactly Node 24.18.0:

```sh
nvm use
npm test
npm run check
```

The test suite creates temporary private filesystem trees only. It never invokes
`bin/server.mjs`.

Node 20 is EOL and is not an accepted production runtime. Dell already has
Node 24.18.0 under NVM; an approved production installation must place a
verified copy at `/opt/sitesourcery/node-24.18.0/bin/node`, matching the held
systemd candidate.

Node 24.18.0 includes the built-in `node:sqlite` module at stability 1.2
(release candidate). A future control-store adapter may evaluate it, but this
foundation neither imports nor depends on it. Immutable release serving remains
filesystem-backed; adopting SQLite would require its own durability,
backup/restore, migration, and upgrade evidence.

## Operational limits

- The control store is for one systemd-managed writer process on a local
  filesystem. It is not a multi-node consensus database and must not live on
  NFS/shared storage.
- The Caddy and Node units are candidates, not installed units.
- Dell/HQ failover, replication, IP routing, and split-brain fencing are not
  implemented here.
- A local disk is not a backup.
- Read-only release permissions reduce mistakes but do not defend against root
  or the same Unix account deliberately changing permissions. Digest checks
  detect resulting content drift and stop serving.
- Static serving can work without a cloud platform, but reliable public service
  still depends on power, cooling, storage health, ISP reachability, router
  configuration, monitoring, and an incident operator.

See [ACCEPTANCE.md](./docs/ACCEPTANCE.md) for the exact remaining gates.
