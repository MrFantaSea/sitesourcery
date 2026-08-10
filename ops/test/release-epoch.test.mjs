import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  RELEASE_EPOCH_PROVIDER_PURPOSE_FIELDS,
  ReleaseEpochFailure,
  SHAPE_EPOCH_BINDING,
  createHeldReleaseEpoch,
  releaseEpochBindingSha256,
  validateReleaseEpoch
} from "../release-epoch.mjs";
import {
  verifyReleaseEpochRepository
} from "../verify-release-epoch.mjs";

const BINDING_SHA256 =
  "50e1bb83a8e2258d35c27e8d33d69757efd2eb9331c312283ae08d99c56c1bc6";
const OBSERVED_AT = "2026-08-10T12:00:00.000Z";

function clone(value) {
  return structuredClone(value);
}

function rejects(candidate, code) {
  assert.throws(
    () => validateReleaseEpoch(candidate),
    (error) =>
      error instanceof ReleaseEpochFailure &&
      error.code === code
  );
}

test("constructs one exact fail-closed held release epoch", () => {
  const epoch = createHeldReleaseEpoch();
  assert.equal(
    releaseEpochBindingSha256(),
    BINDING_SHA256
  );
  assert.deepEqual(
    {
      source: epoch.binding.source,
      artifact: epoch.binding.artifact,
      legal: epoch.binding.legal,
      database: epoch.binding.database
    },
    SHAPE_EPOCH_BINDING
  );
  assert.equal(epoch.binding.sha256, BINDING_SHA256);
  assert.equal(epoch.installedIdentity.state, "not_proven");
  assert.equal(epoch.publicMode.state, "held");
  assert.deepEqual(
    epoch.assurance.dependencyReadiness,
    {
      state: "blocked",
      bindingSha256: BINDING_SHA256,
      blockers: [
        "installed_identity",
        "backup_proof",
        "monitor_proof",
        "rollback_proof"
      ]
    }
  );
  assert.deepEqual(
    epoch.assurance.customerCapability,
    {
      state: "held",
      bindingSha256: BINDING_SHA256,
      allowsCustomerEffects: false,
      enabledCapabilities: []
    }
  );
  assert.equal(Object.isFrozen(epoch), true);
  assert.equal(Object.isFrozen(epoch.binding.source), true);
});

test("rejects drift in every member of the source artifact legal database tuple", () => {
  const mutations = [
    (epoch) => {
      epoch.binding.source.coreReleaseCommitSha = "0".repeat(40);
    },
    (epoch) => {
      epoch.binding.artifact.privacySha256 = "1".repeat(64);
    },
    (epoch) => {
      epoch.binding.legal.authorityDigest = "2".repeat(64);
    },
    (epoch) => {
      epoch.binding.database.migrationCount = 59;
    },
    (epoch) => {
      epoch.binding.sha256 = "3".repeat(64);
    }
  ];
  for (const mutate of mutations) {
    const candidate = clone(createHeldReleaseEpoch());
    mutate(candidate);
    rejects(candidate, "RELEASE_EPOCH_BINDING_MISMATCH");
  }
  const extra = clone(createHeldReleaseEpoch());
  extra.binding.source.branch = "main";
  rejects(extra, "RELEASE_EPOCH_INVALID");
});

test("requires exact coverage and held state for every provider purpose", () => {
  const epoch = createHeldReleaseEpoch();
  let purposeCount = 0;
  for (const [provider, fields] of Object.entries(
    RELEASE_EPOCH_PROVIDER_PURPOSE_FIELDS
  )) {
    assert.deepEqual(
      Object.keys(epoch.providerPurposes[provider]),
      [...fields]
    );
    for (const field of fields) {
      purposeCount += 1;
      assert.equal(
        epoch.providerPurposes[provider][field],
        "held"
      );
      const enabled = clone(epoch);
      enabled.providerPurposes[provider][field] = "approved";
      rejects(
        enabled,
        "RELEASE_EPOCH_PROVIDER_PURPOSE_INVALID"
      );
    }
  }
  assert.equal(purposeCount, 19);
  const missing = clone(epoch);
  delete missing.providerPurposes.stripe.webhookConfiguration;
  rejects(missing, "RELEASE_EPOCH_INVALID");
  const rogue = clone(epoch);
  rogue.providerPurposes.stripe.roguePurpose = "held";
  rejects(rogue, "RELEASE_EPOCH_INVALID");
});

test("proofs and installed identity cannot claim mismatched evidence", () => {
  const receipt = "4".repeat(64);
  const mismatchedIdentity = clone(createHeldReleaseEpoch());
  mismatchedIdentity.installedIdentity = {
    ...mismatchedIdentity.installedIdentity,
    state: "verified",
    observedReleaseCommitSha: "5".repeat(40),
    observedMigrationCount: 58,
    receiptSha256: receipt,
    observedAt: OBSERVED_AT
  };
  rejects(
    mismatchedIdentity,
    "RELEASE_EPOCH_IDENTITY_INVALID"
  );
  const falseBackup = clone(createHeldReleaseEpoch());
  falseBackup.proofs.backup.receiptSha256 = receipt;
  rejects(falseBackup, "RELEASE_EPOCH_PROOF_INVALID");
  const wrongBinding = clone(createHeldReleaseEpoch());
  wrongBinding.proofs.monitor.bindingSha256 = "6".repeat(64);
  rejects(wrongBinding, "RELEASE_EPOCH_PROOF_INVALID");
  const wrongRollback = clone(createHeldReleaseEpoch());
  wrongRollback.proofs.rollback.targetPublicCommitSha =
    "7".repeat(40);
  rejects(wrongRollback, "RELEASE_EPOCH_PROOF_INVALID");
});

test("liveness readiness and customer capability remain separate contracts", () => {
  const livenessOnly = createHeldReleaseEpoch({
    livenessProof: {
      proofSha256: "8".repeat(64),
      observedAt: OBSERVED_AT
    }
  });
  assert.equal(
    livenessOnly.assurance.liveness.state,
    "observed"
  );
  assert.equal(
    livenessOnly.assurance.dependencyReadiness.state,
    "blocked"
  );
  assert.equal(
    livenessOnly.assurance.customerCapability.state,
    "held"
  );

  const verified = createHeldReleaseEpoch({
    installedIdentityEvidence: {
      releaseCommitSha:
        SHAPE_EPOCH_BINDING.source.coreReleaseCommitSha,
      migrationCount:
        SHAPE_EPOCH_BINDING.database.migrationCount,
      receiptSha256: "9".repeat(64),
      observedAt: OBSERVED_AT
    },
    backupProof: {
      receiptSha256: "a".repeat(64),
      observedAt: OBSERVED_AT
    },
    monitorProof: {
      receiptSha256: "b".repeat(64),
      observedAt: OBSERVED_AT
    },
    rollbackProof: {
      receiptSha256: "c".repeat(64),
      observedAt: OBSERVED_AT
    },
    livenessProof: {
      proofSha256: "d".repeat(64),
      observedAt: OBSERVED_AT
    }
  });
  assert.deepEqual(
    verified.assurance.dependencyReadiness,
    {
      state: "ready",
      bindingSha256: BINDING_SHA256,
      blockers: []
    }
  );
  assert.equal(
    verified.assurance.customerCapability.state,
    "held"
  );
  assert.equal(
    verified.assurance.customerCapability
      .allowsCustomerEffects,
    false
  );
  for (const purposes of Object.values(
    verified.providerPurposes
  )) {
    assert.equal(
      Object.values(purposes).every(
        (state) => state === "held"
      ),
      true
    );
  }

  const capabilityLeak = clone(verified);
  capabilityLeak.assurance.customerCapability.state = "enabled";
  capabilityLeak.assurance.customerCapability
    .allowsCustomerEffects = true;
  capabilityLeak.assurance.customerCapability
    .enabledCapabilities = ["checkout"];
  rejects(
    capabilityLeak,
    "RELEASE_EPOCH_CAPABILITY_INVALID"
  );
});

test("schema and repository verifier bind the current held epoch", async () => {
  const schema = JSON.parse(
    await readFile(
      new URL("../release-epoch.schema.json", import.meta.url),
      "utf8"
    )
  );
  const epoch = createHeldReleaseEpoch();
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.properties.binding.const, epoch.binding);
  assert.deepEqual(
    schema.properties.providerPurposes.const,
    epoch.providerPurposes
  );
  assert.equal(
    schema.$defs.boundProof.additionalProperties,
    false
  );
  assert.equal(
    schema.$defs.rollbackProof.additionalProperties,
    false
  );
  assert.equal(
    schema.$defs.installedIdentity.additionalProperties,
    false
  );
  assert.equal(schema.$defs.liveness.oneOf.length, 2);
  assert.equal(
    schema.$defs.dependencyReadiness.oneOf.length,
    2
  );
  const result = await verifyReleaseEpochRepository();
  assert.deepEqual(result, {
    valid: true,
    epochId: "shape-epoch-20260810",
    bindingSha256: BINDING_SHA256,
    migrationCount: 58,
    providerPurposeCount: 19,
    installedIdentity: "not_proven",
    liveness: "not_observed",
    dependencyReadiness: "blocked",
    dependencyBlockerCount: 4,
    customerCapability: "held",
    publicMode: "held",
    providerEffectsAllowed: false
  });
});
