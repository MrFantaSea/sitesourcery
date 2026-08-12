# Hosted Epoch Install Held Dry Run

This packet composes existing release evidence into one retained local dry-run receipt. It is a local dry run only: it does not install software, apply migrations, read production, contact Dell or HQ, or grant release authority.

## Existing Authorities Reused

- `verifyOriginReleaseRepository` verifies the exact clean Git source commit and tree, reviewed ancestry, artifact bytes, held units, environment-variable names and classifications, worker contract, ordered migration inventory, legal authority, ingress files, and all existing control holds.
- `createOriginInstallPlan` constructs the existing held install plan. The dry run does not execute any plan command.
- `createOriginInstalledReadback` and `compareOriginInstalledReadback` construct and compare an expected identity projection. The receipt labels that projection `expected_projection_verified_not_observed`; it is not an actual installed readback.
- `createOriginRollbackPlan` binds the exact reviewed predecessor commit, tree, and artifact-manifest digest while preserving the existing held rollback postcondition.
- Final Release Epoch V2 remains downstream. It still requires the exact CI final receipt and an actual installed readback; this dry-run receipt cannot substitute for either.

## Local Command

Use pinned Node 24.18.0, a reviewed candidate-specific origin release input, a new absolute output path in a real local directory, a safe run ID, and an explicit observation instant:

```sh
/private/tmp/sitesourcery-node-24.18.0/node-v24.18.0-darwin-arm64/bin/node \
  ops/hosted-epoch-install.mjs \
  --input /absolute/path/to/reviewed-origin-release-input.json \
  --output /absolute/path/to/new-hosted-epoch-install-receipt.json \
  --run-id hosted-epoch-install-review \
  --observed-at 2026-08-11T18:00:00.000Z
```

The verifier rejects a dirty or different tracked source, stale source or tree, changed artifact or migration inventory, wrong rollback predecessor, any lifted authority, a symlink output directory, or an existing output file. It writes only the one immutable local receipt.

## Acceptance Meaning

An `accepted_held` receipt proves that the current local repository matched one exact reviewed input and that the existing held install, expected-readback, and rollback contracts compose without drift. It records `commandsExecuted: false`, `installed: false`, `installationAuthorized: false`, and `productionReady: false`. All customer, payment, mail, provider, publication, DNS, and deployment effects remain held.

## Remaining Gates

1. Generate and independently review a successor input for the final candidate source, tree, artifact, unit, environment, worker, migration, legal, ingress, and rollback identities; never reuse the checked-in historical candidate input for a different source.
2. Obtain owner install approval and install private environment values out of band without recording secret values in release evidence.
3. Perform the install, migration, and service actions only in the separately authorized release lane.
4. Collect and verify the actual installed readback from the target host.
5. Prove rollback availability, complete downstream Final Release Epoch V2 composition, and retain all customer/provider/commercial/DNS holds until separately authorized.
