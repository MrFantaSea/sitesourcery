# CI-01 wiring notes

These are held planning notes. This packet does not configure GitHub, create a
release input, run PostgreSQL, push, deploy, or grant release authority.

## Production-owned wiring required later

1. After the final candidate is sealed, create a verified OPS-ORIGIN successor
   release epoch whose `source.commitSha` and `source.treeSha` identify that
   exact candidate and whose migration authority is derived from its final
   ordered migration bytes. Never copy a retained migration count forward.
2. Build the candidate's Legal V4 Pages projection and collect the exact
   `ci-legal-v4-pages` manifest. It must contain exactly 80 regular files.
3. Construct the CI successor input with
   `createCiReleaseSuccessorInput`; write its canonical bytes at
   `ops/releases/ci-successor-inputs/<candidate-sha>.json` in a successor
   control commit. Supply the SHA-256 of those exact file bytes to the manual
   workflow.
4. Keep these five proof implementation files byte-identical between the
   protected workflow commit and candidate:
   - `ops/ci-release-proof-runtime.mjs`
   - `ops/ci-release-proof-repository.mjs`
   - `ops/ci-release-proof.mjs`
   - `server/data-plane/tests/migration-verification-inventory.mjs`
   - `server/data-plane/tests/verify-empty-postgres-migrations.mjs`
5. Configure the GitHub environment named `ci-release-proof-held` with required
   owner review and deployment-branch/tag restrictions. Add no secrets and no
   deployment protection rule that can perform an external action.
6. Invoke `.github/workflows/ci-release-proof-held.yml` manually with only the
   exact candidate SHA and exact successor-input file SHA-256.

The final `verified_held` receipt is evidence only. It cannot authorize a
deployment, publication, provider call, DNS change, commercial transition, or
customer effect. A separate owner-controlled release decision remains required.
