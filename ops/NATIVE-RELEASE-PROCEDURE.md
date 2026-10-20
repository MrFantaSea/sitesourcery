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
   maintained native adapters below and their journal. Installer bindings,
   complete adapter hashes and permission checks remain necessary. Historical
   candidate-specific scripts remain immutable evidence.
6. Accept the installed API, tenant and all currently approved worker purposes,
   existing owner/organization, unchanged independent services, public bytes
   and relevant changed views. Restore original schedules/admission only after
   acceptance, remove only the exact owned holds and collect the next natural
   monitor. Reconcile the one current checkpoint/state from those real receipts.

## Outputs and failure handling

The packet contains `origin-seal.json`, `origin-installed-readback.json`,
`final-release-epoch-v2.json`, `native-observation-binding.json` and
`authority-receipt.json`. Canonical validators remain authoritative.
Compatibility fields retain the historical installer's receipt names. Maintained
adapters read the generic production reference from the typed evidence registry,
and reject conflicting legacy aliases.

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

## Maintained native adapters

The native boundaries use one entry point and one strict release profile:

```sh
python3 -I -B ops/native-release/run.py /absolute/PROFILE.json PROFILE_SHA256 describe
python3 -I -B ops/native-release/run.py /absolute/PROFILE.json PROFILE_SHA256 ACTION INPUT INPUT_SHA256
```

`describe` performs no native action. It lists the mode's available actions,
derived hold/journal paths and exact hashes of the adapter bundle. It does not
approve the release. The profile schema is
`sitesourcery.native-release-profile/v1`; `profile.py:validate_profile` is the
executable contract. Unknown fields, malformed identities, changed profile
bytes, symlinked profile paths, unknown workers and inconsistent schema modes
refuse before native effects.

Populate the profile from actual source and runtime evidence: candidate and
predecessor IDs/trees; before/after schema and table counts; schema and migration
hashes; exact current worker purposes and Care modes; existing owner IDs; Node
and Sharp identities; canonical database identity; schema collector hashes;
eight existing capability baselines; and the three current configuration hashes.
Use a new descriptive cohort name. Hold names and exclusive journals derive
from that name. Profiles contain identifiers and hashes, never credentials.
The synthetic profile in `test-contracts.py` is only a test fixture.

Every native operation input must bind the exact profile reference as
`{"path":"/absolute/PROFILE.json","sha256":"…"}`. Effectful input also pins
all Python and JavaScript bundle hashes reported by `describe`, uses current
finite authorization and preserves the phase-specific receipt requirements.
Native helpers stay in root-owned, non-writable custody; UID1000 executes only
the stage/migration boundaries. Unknown actions cannot select an arbitrary
script. The launcher executes one action, with no retry or automatic advance.

| Action | Inputs after action | Boundary |
| --- | --- | --- |
| `prepare-stage` | reviewed binding, digest, absent output directory | Local preparation only; verifies exact package/lock equality, source Git and already qualified hosted bytes. Emits data and archive, never generated executable code. The resulting stage input is unapproved. |
| `stage` | approved stage input, digest, exact archive | Inert new Linux release; independent Git objects and dependency copies, retained predecessor inventory, exact artifact/native dependency checks. Existing or failed destination refuses. No installation, npm install or hosted rebuild. |
| `observe` | operation input, digest | Read-only installer baseline. |
| `observe-handoff` | none | Read-only service and configuration baseline. |
| `hold-initial` | approval, digest | Presentation: ten Site-only holds. Schema: initial Site/private-HQ holds and readiness recovery snapshot, leaving API available for the existing coherent backup boundary. |
| `hold-final` | approval, digest | Schema only; requires the fresh successful coherent backup and all writers stopped, then establishes all fifteen durable holds. |
| `migrate-once` | exact `effect-authorization.APPROVED.json` path | Schema only, in the reviewed isolated transient unit. Requires source/CI/backup/restore/smoke/hold/configuration evidence and exact database identity before serializable SQL. |
| `observe-schema` | approval, digest | Presentation only; fresh read-only schema check. |
| `install` | approval, digest | Held source/anchor replacement; exact native file journal, original-byte custody and installed verification. Does not start services or migrate. |
| `resume-api`, `resume-runtime` | approval, digest | Separately controlled starts; existing private HQ stays intact for presentation mode and is explicitly resumed for schema mode. |
| `accept-runtime` | finite expiry timestamp | Read-only API, exact capabilities, current worker invocation/cycles and existing owner/organization acceptance. Notification mail uses its real counter contract. |
| `resume-admission` | approval, digest | Requires exact runtime/owner acceptance; restores original admission/schedules and removes only owned holds. |

For presentation-only recovery, `rehold`, `rollback`, `restore-api`,
`restore-runtime`, `accept-restored-runtime` and `restore-admission` retain the
explicit original-byte rollback protocol. Schema mode does not expose these
code-only rollback actions. A confirmed or ambiguous schema commit requires its
coherent recovery procedure; it must never be replayed or downgraded by this tool.

The migration adapter intentionally supports appended migrations that preserve
every existing row/field and financial total, with only declared empty relations
added. It verifies each exact outer SQL wrapper and every appended file, applies
all declared bodies in one transaction, records commit intent/acknowledgment and
performs a separate durable read-only verification. Backfills or destructive
schema changes require a separately reviewed migration contract; a profile
cannot weaken the retained-data checks.

The existing coherent backup, encrypted recovery custody, restore and assembled
runtime proof remain mandatory schema-release prerequisites. These adapters
consume their genuine receipts; they do not create substitute evidence, perform
an automatic recovery or change the fixed HQ service/database topology. Mode
implementations retain their separate reviewed trust boundaries. Do not execute
a production release just to demonstrate this refactor.

Run `node --test ops/test/native-release-adapters.test.mjs`. Qualification includes
isolated Python refusal cases at a different schema count with eight workers,
multi-migration SQL and retained-data checks, plus offline historical receipt
interoperability. Passing those checks is source qualification; native acceptance
still belongs to the next actual authorized release.
