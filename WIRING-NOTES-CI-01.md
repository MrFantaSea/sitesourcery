# CI-01 wiring notes

These are held planning notes. This packet does not configure GitHub, create a
release input, run PostgreSQL, push, deploy, or grant release authority.

## Production-owned wiring required later

1. After the final candidate is sealed, create a verified OPS-ORIGIN successor
   release epoch whose `source.commitSha` and `source.treeSha` identify that
   exact candidate and whose migration authority is derived from its final
   ordered migration bytes. Never copy a retained migration count forward.
2. Build the candidate's Legal V4 Pages projection and collect the exact
   `ci-legal-v4-pages` manifest. Supply its exact positive file count and
   manifest digest to the successor input. The current reviewed projection is
   94 files, but later successors must derive their own exact count rather than
   copying that checkpoint.
3. After building exact `_site` and `_hosted` artifacts, run the candidate's
   `node ops/ci-release-proof.mjs generate --root . --epoch-id <new-id> --rollback-commit <sha> --rollback-tree <sha> --rollback-artifact-root <path>`. The command requires a clean held
   candidate with zero prior CI successor inputs, derives current migration and
   artifact facts, verifies exact ancestry, derives the predecessor artifact
   manifest from bounded retained bytes, and uses an anchored fail-clean write
   at `ops/releases/ci-successor-inputs/<candidate-sha>.json`. The rollback
   artifact root is a later operator-supplied retained evidence directory; this
   packet freezes no real path or digest. Supply the reported raw SHA-256 to the
   manual workflow; do not substitute the semantic `digest` field.
4. Keep these nine proof implementation files byte-identical between the
   protected workflow commit and candidate:
   - `ops/ci-release-proof-runtime.mjs`
   - `ops/ci-release-proof-repository.mjs`
   - `ops/ci-release-proof.mjs`
   - `scripts/audit-artifact-from-sitemap.mjs`
   - `scripts/browser-audit-vnext.mjs`
   - `scripts/check-routes.mjs`
   - `scripts/install-reviewed-chromium.sh`
   - `server/data-plane/tests/migration-verification-inventory.mjs`
   - `server/data-plane/tests/verify-empty-postgres-migrations.mjs`
5. Configure the GitHub environment named `ci-release-proof-held` with required
   owner review and deployment-branch/tag restrictions. Add no secrets and no
   deployment protection rule that can perform an external action.
6. Invoke `.github/workflows/ci-release-proof-held.yml` manually with only the
   exact candidate SHA and exact successor-input file SHA-256.

The held workflow executes receipt and final-proof code only from the protected
control checkout. It rejects ambient Git/Node overrides, replace refs, grafts,
assume-unchanged and skip-worktree flags, any tracked checkout drift, and any
post-candidate mismatch across all nine protected implementation paths.

The final `verified_held` receipt is evidence only. It cannot authorize a
deployment, publication, provider call, DNS change, commercial transition, or
customer effect. A separate owner-controlled release decision remains required.
