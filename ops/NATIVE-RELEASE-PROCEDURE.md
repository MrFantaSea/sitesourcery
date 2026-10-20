# Native release authority

Use one maintained command for the held installation-authority packet:

```sh
node ops/native-release-authority.mjs /absolute/INPUT.json INPUT_SHA256
```

The command replaces the separate October 20 presentation and Care migration
authority constructors. Candidate IDs, schema counts/hashes, worker purposes,
hold names, receipt paths and workflow identity are data in one JSON input.
Do not copy a constructor and edit its constants for the next release.

This command reads local Git and digest-pinned receipts and writes an exclusive
local output directory. It performs no network requests, service commands,
database writes, provider actions, deployment or activation. A constructed
packet is evidence for the existing finite native installer, not evidence that
installation or service acceptance happened.

## One procedure, two explicit modes

1. Qualify the exact source once. Preserve the original protected CI run,
   original log receipt, immutable artifact and genuine inert Linux stage.
   Reuse unchanged accepted artifacts. Resolve the actual installed predecessor
   from its origin seal, installed readback and final epoch.
2. Select the mode and obtain the corresponding native observations.

   | Mode | Required boundary |
   | --- | --- |
   | `presentation-only` | Identical complete migration inventory and unchanged units, environment schema, worker, legal and ingress manifests. Stop Site Sourcery writers with all ten owned durable holds. Keep PostgreSQL, gateway and private HQ intact. Read the actual unchanged database schema. Link historical migration proof through the actual prior installation; never rerun a migration or restore for presentation changes. |
   | `schema-changing` | Append-only migration inventory. Obtain coherent DB/files/config/key backup, restore and assembled-runtime proof, held DB fingerprint, rollback reservation and configuration boundary. Apply all fifteen holds, including private HQ writers/timers. The one authorized migration must have a genuine committed receipt preserving existing rows/fields and financial totals. Read the held runtime after that commit. Never retry an ambiguous commit or use code-only rollback across changed schema. |

3. Bind one input using `sitesourcery.native-release-authority-input/v1`.
   `validateNativeReleaseInput` in the command is the executable field contract:
   unknown/missing fields fail. Common fields include exact candidate/prior
   commit and tree, original workflow identity, database identity,
   `expectedSchema`, current baseline, durable holds and named evidence refs.
   Every ref has exactly an absolute `path` and a `sha256`.
   Approval is finite (at most 30 minutes), `emissionApproved: true`,
   `activationAllowed: false`. Both modes require fresh held observations.
   Private key/token values never belong in this input.
4. Run the command once. It verifies original CI log provenance, candidate
   identity, staged bytes, canonical predecessor chain, migration lineage,
   exact held services/configuration and native schema/commit facts before
   emitting any file. Its JSON result supplies current candidate, schema,
   mode, evidence and output hashes automatically.
5. Review and transfer the exact emitted bytes to native custody, then use the
   existing reviewed finite installer and its journal. Installer bindings and
   permission checks remain necessary. This consolidation does not make an old
   candidate-specific native adapter reusable without reviewing its actual
   current inputs.
6. Accept the installed API, tenant and all currently approved worker purposes,
   existing owner/organization, unchanged independent services, public bytes
   and relevant changed views. Restore original schedules/admission only after
   acceptance, remove only the exact owned holds and collect the next natural
   monitor. Reconcile the one current checkpoint/state from those real receipts.

## Outputs and failure handling

The packet contains `origin-seal.json`, `origin-installed-readback.json`,
`final-release-epoch-v2.json`, `native-observation-binding.json` and
`authority-receipt.json`. Canonical validators remain authoritative.
Compatibility fields retain the accepted finite installer's receipt names;
they point to the same pinned bytes as the generic `productionReceipt`.

A wrong candidate/tree, stale authority/observation, missing recovery receipt,
changed source or held-file digest refuses before output. Preserve every
failure and original receipt. No automatic retry, re-signing, expiry extension,
receipt regeneration, weakened guard or reconstructed “passed” CI is supplied.
An I/O failure during output leaves a partial attempt for inspection; use a
new reviewed output directory after diagnosing it.

## Verification and limits

Run `node --test ops/test/native-release-authority.test.mjs`.
For a release-specific offline rehearsal, copy accepted receipts into an owned
temporary directory and call the side-effect-free constructor with the recorded
observation time. The CLI has no clock override. Such a historical rehearsal
does not renew old authority and must never be installed as a fresh live proof.
Compare the three canonical outputs with the original accepted packet, and
exercise wrong-field, stale-receipt and wrong-candidate refusals in both modes.

This consolidates the duplicated authority binders and their operator procedure.
Native staging, migration, installation and service-control adapters remain
separate reviewed boundaries. Their full parameterization is subsequent work;
do not describe this local constructor as an automated production cutover.
