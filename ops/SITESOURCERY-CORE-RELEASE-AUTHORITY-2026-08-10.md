# Core release migration authority

`npm run release:core` remains the local, effect-bounded release rehearsal. It
creates one validated disposable PostgreSQL database, replays the reviewed
migration inventory, runs the retained PostgreSQL journeys, proves exact
database absence, and then runs the candidate suite.

The command no longer contains a migration-count constant. Before it connects
to PostgreSQL, `scripts/core-release.mjs` collects the exact ordered SQL files
under `server/data-plane/supabase/migrations` through
`collectOriginMigrationInventory` in `ops/origin-seal-repository.mjs`. It then
passes the filenames through the same
`resolveMigrationVerificationInventory` gate used by the empty-database
verifier. A missing, extra, reordered, renamed, symlinked, or malformed
inventory fails closed before database creation. Changed SQL bytes produce a
different per-file and manifest digest; the release authority must bind that
new digest to the clean frozen candidate instead of reusing older evidence.

Successful JSON reports the derived `migrationsApplied` count and the complete
non-secret `migrationAuthority`: schema, root, ordered filename/byte-count/file
digest entries, latest filename, and canonical `origin-migrations` manifest
digest. These values describe only the exact checked-out repository bytes; they
do not grant release, deployment, provider, DNS, publication, or commercial
authority.

Historical runbooks and receipts retain the counts observed by their named
candidates. They are evidence of those earlier runs, not current defaults. A
new release must use the newly emitted authority from its own clean candidate
and must not copy a historical migration count or digest.
