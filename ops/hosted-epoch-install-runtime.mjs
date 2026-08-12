import {
  canonicalJson,
  safeIdentifier,
  sha256Bytes
} from "./immutable-evidence.mjs";
import {
  ORIGIN_HELD_AUTHORITY,
  ORIGIN_LOOPBACK_EXPECTATIONS,
  compareOriginInstalledReadback,
  createOriginInstallPlan,
  createOriginInstalledReadback,
  createOriginRollbackPlan,
  createOriginSeal,
  expectedOriginInstalledIdentity,
  expectedOriginInstalledWorker,
  validateOriginInstalledReadback,
  validateOriginReleaseInput,
  validateOriginSeal
} from "./origin-seal-runtime.mjs";

export const HOSTED_EPOCH_INSTALL_RECEIPT_SCHEMA =
  "sitesourcery.hosted-epoch-install-dry-run-receipt/v1";
export const HOSTED_EPOCH_INSTALL_JSON_SCHEMA_ID =
  "https://sitesourcery.com/schemas/hosted-epoch-install-dry-run-receipt-v1.json";

export const HOSTED_EPOCH_INSTALL_EFFECT_HOLDS = deepFreeze({
  customer: "held",
  payment: "held",
  mail: "held",
  provider: "held",
  publication: "held",
  dns: "held",
  deployment: "held"
});

const RECEIPT_STATE = "accepted_held";
const RECEIPT_CLASSIFICATION = "local_dry_run_only";
const SHA256 = /^[a-f0-9]{64}$/u;
const COMMIT_SHA = /^[a-f0-9]{40}$/u;
const MIGRATION = /^[0-9]{12}_[a-z0-9_]+\.sql$/u;
const IDENTITY_FIELDS = Object.freeze([
  "sourceCommitSha",
  "sourceTreeSha",
  "artifactManifestSha256",
  "unitManifestSha256",
  "environmentSchemaManifestSha256",
  "environmentClassificationSha256",
  "workerManifestSha256",
  "workerContractSha256",
  "migrationCount",
  "latestMigration",
  "migrationManifestSha256",
  "legalAuthorityDigest",
  "legalManifestSha256",
  "ingressManifestSha256"
]);

function fail(message) {
  throw new Error(message);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const entry of Object.values(value)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}

function exactObject(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    canonicalJson(Object.keys(value).sort()) !==
      canonicalJson([...keys].sort())
  ) {
    fail(`${label} must contain only its exact fields.`);
  }
  return value;
}

function exactInstant(value, label) {
  const selected = new Date(value);
  if (
    typeof value !== "string" ||
    Number.isNaN(selected.valueOf()) ||
    selected.toISOString() !== value
  ) {
    fail(`${label} is invalid.`);
  }
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    fail(`${label} must be an exact lowercase SHA-256 digest.`);
  }
  return value;
}

function commit(value, label) {
  if (typeof value !== "string" || !COMMIT_SHA.test(value)) {
    fail(`${label} must be an exact lowercase commit SHA.`);
  }
  return value;
}

function exactHeldAuthority(value) {
  if (canonicalJson(value) !== canonicalJson(ORIGIN_HELD_AUTHORITY)) {
    fail("Hosted epoch install authority must remain exactly held.");
  }
}

function exactEffectHolds(value) {
  if (
    canonicalJson(value) !==
      canonicalJson(HOSTED_EPOCH_INSTALL_EFFECT_HOLDS)
  ) {
    fail("Hosted epoch install effects must remain exactly held.");
  }
}

function validateIdentity(value) {
  exactObject(value, IDENTITY_FIELDS, "Hosted epoch install identity");
  for (const field of IDENTITY_FIELDS) {
    const selected = value[field];
    if (field === "migrationCount") {
      if (!Number.isSafeInteger(selected) || selected < 1) {
        fail("Hosted epoch install migration count is invalid.");
      }
    } else if (field === "latestMigration") {
      if (typeof selected !== "string" || !MIGRATION.test(selected)) {
        fail("Hosted epoch install latest migration is invalid.");
      }
    } else if (field.endsWith("CommitSha") || field.endsWith("TreeSha")) {
      commit(selected, `Hosted epoch install ${field}`);
    } else {
      digest(selected, `Hosted epoch install ${field}`);
    }
  }
  return value;
}

function validateRollback(value) {
  exactObject(
    value,
    [
      "predecessorCommitSha",
      "predecessorTreeSha",
      "predecessorArtifactManifestSha256"
    ],
    "Hosted epoch install rollback"
  );
  commit(value.predecessorCommitSha, "Hosted epoch install predecessor");
  commit(value.predecessorTreeSha, "Hosted epoch install predecessor tree");
  digest(
    value.predecessorArtifactManifestSha256,
    "Hosted epoch install predecessor artifact"
  );
  return value;
}

function receiptPayload(value) {
  return {
    schema: value.schema,
    runId: value.runId,
    observedAt: value.observedAt,
    state: value.state,
    classification: value.classification,
    identity: value.identity,
    rollback: value.rollback,
    evidence: value.evidence,
    verification: value.verification,
    authority: value.authority,
    effects: value.effects,
    result: value.result
  };
}

export function hostedEpochInstallReceiptDigest(value) {
  return sha256Bytes(
    Buffer.from(`${canonicalJson(receiptPayload(value))}\n`, "utf8")
  );
}

function originObservationFromSeal(seal) {
  const { expectations: _expectations, ...ingress } = seal.ingress;
  return {
    source: structuredClone(seal.source),
    artifact: structuredClone(seal.artifact),
    units: structuredClone(seal.units),
    environmentSchema: structuredClone(seal.environmentSchema),
    worker: structuredClone(seal.worker),
    migration: structuredClone(seal.migration),
    legal: structuredClone(seal.legal),
    ingress
  };
}

function exactExistingOutput(actual, expected, label) {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    fail(`${label} drifted from the existing origin verifier output.`);
  }
}

export function createHostedEpochInstallDryRunReceipt({
  runId,
  observedAt,
  releaseInput,
  originSeal,
  installPlan,
  projectedInstalledReadback,
  readbackReceipt,
  rollbackPlan
}) {
  safeIdentifier(runId, "Hosted epoch install run ID");
  exactInstant(observedAt, "Hosted epoch install observation");
  const input = validateOriginReleaseInput(releaseInput);
  const seal = validateOriginSeal(originSeal);
  const readback = validateOriginInstalledReadback(
    projectedInstalledReadback
  );
  const reconstructedSeal = createOriginSeal({
    releaseInput: input,
    observed: originObservationFromSeal(seal)
  });
  exactExistingOutput(seal, reconstructedSeal, "Origin seal");

  const expectedInstallPlan = createOriginInstallPlan(seal);
  const expectedRollbackPlan = createOriginRollbackPlan(seal);
  exactExistingOutput(
    installPlan,
    expectedInstallPlan,
    "Origin install plan"
  );
  exactExistingOutput(
    rollbackPlan,
    expectedRollbackPlan,
    "Origin rollback plan"
  );

  const expectedReadback = createOriginInstalledReadback({
    seal,
    observedAt,
    identity: expectedOriginInstalledIdentity(seal),
    worker: expectedOriginInstalledWorker(seal),
    listeners: structuredClone(ORIGIN_LOOPBACK_EXPECTATIONS),
    authority: structuredClone(ORIGIN_HELD_AUTHORITY)
  });
  exactExistingOutput(
    readback,
    expectedReadback,
    "Projected origin installed readback"
  );
  const expectedReadbackReceipt = compareOriginInstalledReadback({
    seal,
    readback
  });
  if (expectedReadbackReceipt.state !== "verified") {
    fail("Projected origin installed readback did not verify.");
  }
  exactExistingOutput(
    readbackReceipt,
    expectedReadbackReceipt,
    "Origin readback receipt"
  );

  const value = {
    schema: HOSTED_EPOCH_INSTALL_RECEIPT_SCHEMA,
    runId,
    observedAt,
    state: RECEIPT_STATE,
    classification: RECEIPT_CLASSIFICATION,
    identity: structuredClone(expectedOriginInstalledIdentity(seal)),
    rollback: structuredClone(seal.rollback),
    evidence: {
      releaseInputDigest: input.digest,
      successorEpochBindingSha256: input.epoch.bindingSha256,
      originSealSha256: seal.sealSha256,
      installPlanSha256: expectedInstallPlan.planSha256,
      projectedInstalledReadbackDigest: readback.digest,
      projectedReadbackReceiptSha256:
        expectedReadbackReceipt.receiptSha256,
      rollbackPlanSha256: expectedRollbackPlan.planSha256
    },
    verification: {
      repository: "verified",
      installPlan: "constructed_not_executed",
      installedReadback:
        "expected_projection_verified_not_observed",
      rollbackPlan: "constructed_not_executed"
    },
    authority: structuredClone(ORIGIN_HELD_AUTHORITY),
    effects: structuredClone(HOSTED_EPOCH_INSTALL_EFFECT_HOLDS),
    result: {
      dryRunAccepted: true,
      commandsExecuted: false,
      installed: false,
      installationAuthorized: false,
      productionReady: false
    }
  };
  return validateHostedEpochInstallDryRunReceipt({
    ...value,
    digest: hostedEpochInstallReceiptDigest(value)
  });
}

export function validateHostedEpochInstallDryRunReceipt(value) {
  exactObject(
    value,
    [
      "schema",
      "runId",
      "observedAt",
      "state",
      "classification",
      "identity",
      "rollback",
      "evidence",
      "verification",
      "authority",
      "effects",
      "result",
      "digest"
    ],
    "Hosted epoch install receipt"
  );
  if (
    value.schema !== HOSTED_EPOCH_INSTALL_RECEIPT_SCHEMA ||
    value.state !== RECEIPT_STATE ||
    value.classification !== RECEIPT_CLASSIFICATION
  ) {
    fail("Hosted epoch install receipt identity is invalid.");
  }
  safeIdentifier(value.runId, "Hosted epoch install run ID");
  exactInstant(value.observedAt, "Hosted epoch install observation");
  validateIdentity(value.identity);
  validateRollback(value.rollback);
  if (
    value.identity.sourceCommitSha === value.rollback.predecessorCommitSha
  ) {
    fail("Hosted epoch install source and rollback predecessor must differ.");
  }
  exactObject(
    value.evidence,
    [
      "releaseInputDigest",
      "successorEpochBindingSha256",
      "originSealSha256",
      "installPlanSha256",
      "projectedInstalledReadbackDigest",
      "projectedReadbackReceiptSha256",
      "rollbackPlanSha256"
    ],
    "Hosted epoch install evidence"
  );
  for (const [field, selected] of Object.entries(value.evidence)) {
    digest(selected, `Hosted epoch install evidence ${field}`);
  }
  exactObject(
    value.verification,
    ["repository", "installPlan", "installedReadback", "rollbackPlan"],
    "Hosted epoch install verification"
  );
  if (
    value.verification.repository !== "verified" ||
    value.verification.installPlan !== "constructed_not_executed" ||
    value.verification.installedReadback !==
      "expected_projection_verified_not_observed" ||
    value.verification.rollbackPlan !== "constructed_not_executed"
  ) {
    fail("Hosted epoch install verification is not exactly local and held.");
  }
  exactHeldAuthority(value.authority);
  exactEffectHolds(value.effects);
  exactObject(
    value.result,
    [
      "dryRunAccepted",
      "commandsExecuted",
      "installed",
      "installationAuthorized",
      "productionReady"
    ],
    "Hosted epoch install result"
  );
  if (
    value.result.dryRunAccepted !== true ||
    value.result.commandsExecuted !== false ||
    value.result.installed !== false ||
    value.result.installationAuthorized !== false ||
    value.result.productionReady !== false
  ) {
    fail("Hosted epoch install result must remain a held dry run.");
  }
  digest(value.digest, "Hosted epoch install receipt");
  if (value.digest !== hostedEpochInstallReceiptDigest(value)) {
    fail("Hosted epoch install receipt digest is invalid.");
  }
  return deepFreeze(structuredClone(value));
}
