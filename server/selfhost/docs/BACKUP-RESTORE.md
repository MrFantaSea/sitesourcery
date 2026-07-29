# Backup and restore contract

## Export

On a stopped writer or a filesystem snapshot:

```sh
SITESOURCERY_DATA_ROOT=/var/lib/sitesourcery/tenant \
  node bin/export-backup-manifest.mjs > backup-manifest.json
```

The command reads and verifies every registered release. Any manifest mismatch
aborts the export.

Copy:

- `control/current.json`;
- all `control/revisions/*.json` required by retention policy;
- every `requiredRelativePaths` entry in the emitted manifest;
- the emitted backup manifest itself;
- Caddy's certificate storage as a separately protected secret backup, if
  policy permits.

Do not copy only `current.json`: it contains routing metadata, not site bytes.
Do not treat Caddy certificates as ordinary public artifacts; their private keys
require stricter access.

## Restore proof

1. Provision a clean offline machine or disposable VM.
2. Install the recorded Node version, without Caddy and without public DNS.
3. Restore files preserving directory structure and restrictive permissions.
4. Keep `PUBLICATION_HOLD` present.
5. Open `SelfHostRuntime` against the restored data root.
6. Confirm readiness reports held, not corrupt.
7. Generate a new backup manifest and compare control revision, release
   manifest digests, file paths, sizes, and file SHA-256 values.
8. Exercise tenant reads through the in-process Fetch contract with an explicit
   test-only hold override.
9. Rehearse activation and rollback on copied data.
10. Destroy the disposable restore or secure it as a standby.

Only a completed restore proves the backup. A successful copy command does not.

## Recovery policy

- If `current.json` is corrupt, do not automatically choose the newest history
  file. A higher history revision may be an uncommitted pre-crash candidate.
- Compare the last known audit/control receipt with checksummed history, select
  a recovery revision explicitly, restore it atomically, and record operator
  evidence.
- Never edit an immutable release to “repair” it. Restore the exact bytes from a
  verified backup or activate a different verified release.
