import {
  validateHeldCurrentBackupRestoreReceipt
} from "./backup-restore-current.mjs";
import {
  validateInstalledFinalReleaseEpochV2Chain,
  validateFinalReleaseEpochV2
} from "./final-release-epoch-v2.mjs";
import {
  canonicalJson,
  safeIdentifier,
  sha256Bytes
} from "./immutable-evidence.mjs";
import {
  ORIGIN_LOOPBACK_EXPECTATIONS,
  createOriginRollbackPlan,
  originWorkerContractSha256,
  validateOriginInstalledReadback,
  validateOriginSeal,
  validateOriginWorkerContract
} from "./origin-seal-runtime.mjs";

export const ROLLBACK_REHEARSAL_SCHEMA =
  "sitesourcery.rollback-rehearsal-held/v1";
export const ROLLBACK_RUNTIME_TOPOLOGY_SCHEMA =
  "sitesourcery.rollback-runtime-topology/v1";
export const ROLLBACK_DATABASE_COMPATIBILITY_SCHEMA =
  "sitesourcery.rollback-database-compatibility/v1";
export const ROLLBACK_PAGES_FALLBACK_SCHEMA =
  "sitesourcery.rollback-pages-fallback/v1";
export const ROLLBACK_PROCESS_STATE_SCHEMA =
  "sitesourcery.rollback-process-state/v1";
export const ROLLBACK_PROBE_RECEIPT_SCHEMA =
  "sitesourcery.rollback-probe-receipt/v1";

export const ROLLBACK_REHEARSAL_HOLDS = freeze({
  state: "held",
  allowsServiceEffects: false,
  allowsNetworkEffects: false,
  allowsPagesEffects: false,
  allowsDatabaseEffects: false,
  allowsCustomerEffects: false,
  allowsProviderEffects: false,
  allowsDnsMutation: false,
  allowsDeployment: false,
  allowsAuthority: false
});

export const ROLLBACK_REHEARSAL_SUCCESS_OPERATIONS =
  Object.freeze([
    "observe.successor.initial",
    "observe.pages.initial",
    "stop.successor.worker",
    "stop.successor.api",
    "observe.pages.rollback",
    "select.predecessor",
    "start.predecessor.api",
    "start.predecessor.worker",
    "check.predecessor.live",
    "check.predecessor.ready",
    "check.predecessor.topology",
    "stop.predecessor.worker",
    "stop.predecessor.api",
    "select.successor",
    "start.successor.api",
    "start.successor.worker",
    "check.successor.live",
    "check.successor.ready",
    "check.successor.topology",
    "observe.successor.final"
  ]);

const RECOVERY_OPERATIONS = Object.freeze([
  "recovery.stop.worker",
  "recovery.stop.api",
  "recovery.select.successor",
  "recovery.start.successor.api",
  "recovery.start.successor.worker",
  "recovery.check.successor.live",
  "recovery.check.successor.ready",
  "recovery.check.successor.topology",
  "recovery.observe.successor.final"
]);
const SHA256 = /^[a-f0-9]{64}$/u;
const COMMIT_SHA = /^[a-f0-9]{40}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const PROBE_PATHS = new Set([
  "/api/v1/live",
  "/api/v1/ready"
]);
const PROCESS_COMPONENTS = Object.freeze([
  "api",
  "worker"
]);

export class RollbackRehearsalFailure extends Error {
  constructor(code, message, receipt = null) {
    super(message);
    this.name = "RollbackRehearsalFailure";
    this.code = code;
    this.receipt = receipt;
  }
}

function fail(code, message, receipt = null) {
  throw new RollbackRehearsalFailure(
    code,
    message,
    receipt
  );
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const entry of Object.values(value)) freeze(entry);
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
    fail(
      "ROLLBACK_REHEARSAL_INVALID",
      `${label} must contain only its exact reviewed fields.`
    );
  }
  return value;
}

function exactExpected(value, expected, code, message) {
  if (canonicalJson(value) !== canonicalJson(expected)) {
    fail(code, message);
  }
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    fail(
      "ROLLBACK_REHEARSAL_INVALID",
      `${label} must be an exact lowercase SHA-256 digest.`
    );
  }
  return value;
}

function commit(value, label) {
  if (typeof value !== "string" || !COMMIT_SHA.test(value)) {
    fail(
      "ROLLBACK_REHEARSAL_INVALID",
      `${label} must be an exact lowercase commit SHA.`
    );
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
    fail(
      "ROLLBACK_REHEARSAL_INVALID",
      `${label} must be an exact ISO timestamp.`
    );
  }
  return selected;
}

function selectedClock(now, label) {
  const selected = now();
  if (!(selected instanceof Date) || Number.isNaN(selected.valueOf())) {
    fail(
      "ROLLBACK_REHEARSAL_INVALID",
      `${label} is invalid.`
    );
  }
  return selected;
}

function immutableDigest(value) {
  return sha256Bytes(
    Buffer.from(`${canonicalJson(value)}\n`, "utf8")
  );
}

function topologyPayload(value) {
  return {
    schema: value.schema,
    epochDigest: value.epochDigest,
    listeners: value.listeners,
    api: value.api,
    worker: value.worker
  };
}

export function rollbackRuntimeTopologyDigest(value) {
  return immutableDigest(topologyPayload(value));
}

export function createRollbackRuntimeTopology({
  epoch,
  listeners,
  workerContract
}) {
  const selectedEpoch = validateFinalReleaseEpochV2(epoch);
  const value = {
    schema: ROLLBACK_RUNTIME_TOPOLOGY_SCHEMA,
    epochDigest: selectedEpoch.digest,
    listeners,
    api: {
      component: "api",
      unit: "sitesourcery-hosted.service",
      listener: listeners?.hostedApi,
      tenantListener: listeners?.tenantRuntime,
      livePath: "/api/v1/live",
      readyPath: "/api/v1/ready",
      workerLoopCount: 0
    },
    worker: {
      component: "worker",
      unit: "sitesourcery-workers.service",
      publicListener: null,
      contract: workerContract
    }
  };
  return validateRollbackRuntimeTopology({
    ...value,
    digest: rollbackRuntimeTopologyDigest(value)
  }, selectedEpoch);
}

export function validateRollbackRuntimeTopology(
  value,
  epochValue = null
) {
  exactObject(
    value,
    [
      "schema",
      "epochDigest",
      "listeners",
      "api",
      "worker",
      "digest"
    ],
    "Rollback runtime topology"
  );
  if (value.schema !== ROLLBACK_RUNTIME_TOPOLOGY_SCHEMA) {
    fail(
      "ROLLBACK_REHEARSAL_TOPOLOGY_INVALID",
      "Rollback runtime topology schema is invalid."
    );
  }
  digest(value.epochDigest, "Rollback topology epoch");
  exactExpected(
    value.listeners,
    ORIGIN_LOOPBACK_EXPECTATIONS,
    "ROLLBACK_REHEARSAL_TOPOLOGY_INVALID",
    "Rollback listener topology must remain exactly loopback-only."
  );
  exactObject(
    value.api,
    [
      "component",
      "unit",
      "listener",
      "tenantListener",
      "livePath",
      "readyPath",
      "workerLoopCount"
    ],
    "Rollback API topology"
  );
  exactExpected(
    value.api,
    {
      component: "api",
      unit: "sitesourcery-hosted.service",
      listener: ORIGIN_LOOPBACK_EXPECTATIONS.hostedApi,
      tenantListener: ORIGIN_LOOPBACK_EXPECTATIONS.tenantRuntime,
      livePath: "/api/v1/live",
      readyPath: "/api/v1/ready",
      workerLoopCount: 0
    },
    "ROLLBACK_REHEARSAL_TOPOLOGY_INVALID",
    "Rollback API topology drifted from the exact held listener contract."
  );
  exactObject(
    value.worker,
    ["component", "unit", "publicListener", "contract"],
    "Rollback worker topology"
  );
  if (
    value.worker.component !== "worker" ||
    value.worker.unit !== "sitesourcery-workers.service" ||
    value.worker.publicListener !== null
  ) {
    fail(
      "ROLLBACK_REHEARSAL_TOPOLOGY_INVALID",
      "Rollback worker topology must remain external and listener-free."
    );
  }
  const workerContract = validateOriginWorkerContract(
    value.worker.contract
  );
  const epoch = epochValue === null
    ? null
    : validateFinalReleaseEpochV2(epochValue);
  if (
    epoch &&
    (
      value.epochDigest !== epoch.digest ||
      originWorkerContractSha256(workerContract) !==
        epoch.identity.workerContractSha256
    )
  ) {
    fail(
      "ROLLBACK_REHEARSAL_TOPOLOGY_MISMATCH",
      "Rollback topology does not match its exact release epoch."
    );
  }
  digest(value.digest, "Rollback runtime topology");
  if (value.digest !== rollbackRuntimeTopologyDigest(value)) {
    fail(
      "ROLLBACK_REHEARSAL_TOPOLOGY_INVALID",
      "Rollback runtime topology digest is invalid."
    );
  }
  return freeze({
    ...structuredClone(value),
    worker: {
      ...structuredClone(value.worker),
      contract: structuredClone(workerContract)
    }
  });
}

function databasePayload(value) {
  return {
    schema: value.schema,
    state: value.state,
    predecessorEpochDigest: value.predecessorEpochDigest,
    successorEpochDigest: value.successorEpochDigest,
    predecessorMigrationManifestSha256:
      value.predecessorMigrationManifestSha256,
    successorMigrationManifestSha256:
      value.successorMigrationManifestSha256,
    backupRestoreReceiptDigest:
      value.backupRestoreReceiptDigest,
    predecessorCanReadSuccessorState:
      value.predecessorCanReadSuccessorState,
    predecessorCanOperateHeld:
      value.predecessorCanOperateHeld,
    destructiveDowngradeRequired:
      value.destructiveDowngradeRequired,
    databaseMutationPerformed:
      value.databaseMutationPerformed,
    proofSha256: value.proofSha256
  };
}

export function rollbackDatabaseCompatibilityDigest(value) {
  return immutableDigest(databasePayload(value));
}

export function createRollbackDatabaseCompatibility({
  predecessorEpoch,
  successorEpoch,
  backupRestoreReceipt,
  predecessorCanReadSuccessorState,
  predecessorCanOperateHeld,
  destructiveDowngradeRequired,
  databaseMutationPerformed,
  proofSha256
}) {
  const predecessor = validateFinalReleaseEpochV2(predecessorEpoch);
  const successor = validateFinalReleaseEpochV2(successorEpoch);
  const backup = validateHeldCurrentBackupRestoreReceipt(
    backupRestoreReceipt
  );
  const value = {
    schema: ROLLBACK_DATABASE_COMPATIBILITY_SCHEMA,
    state: "verified_held",
    predecessorEpochDigest: predecessor.digest,
    successorEpochDigest: successor.digest,
    predecessorMigrationManifestSha256:
      predecessor.identity.migrationManifestSha256,
    successorMigrationManifestSha256:
      successor.identity.migrationManifestSha256,
    backupRestoreReceiptDigest: backup.digest,
    predecessorCanReadSuccessorState,
    predecessorCanOperateHeld,
    destructiveDowngradeRequired,
    databaseMutationPerformed,
    proofSha256
  };
  return validateRollbackDatabaseCompatibility({
    ...value,
    digest: rollbackDatabaseCompatibilityDigest(value)
  });
}

export function validateRollbackDatabaseCompatibility(value) {
  exactObject(
    value,
    [
      "schema",
      "state",
      "predecessorEpochDigest",
      "successorEpochDigest",
      "predecessorMigrationManifestSha256",
      "successorMigrationManifestSha256",
      "backupRestoreReceiptDigest",
      "predecessorCanReadSuccessorState",
      "predecessorCanOperateHeld",
      "destructiveDowngradeRequired",
      "databaseMutationPerformed",
      "proofSha256",
      "digest"
    ],
    "Rollback database compatibility"
  );
  if (
    value.schema !== ROLLBACK_DATABASE_COMPATIBILITY_SCHEMA ||
    value.state !== "verified_held" ||
    value.predecessorCanReadSuccessorState !== true ||
    value.predecessorCanOperateHeld !== true ||
    value.destructiveDowngradeRequired !== false ||
    value.databaseMutationPerformed !== false
  ) {
    fail(
      "ROLLBACK_REHEARSAL_DATABASE_INCOMPATIBLE",
      "Rollback database compatibility must be verified-held and require no destructive or mutating action."
    );
  }
  for (const [field, selected] of Object.entries(value)) {
    if (
      field.endsWith("Digest") ||
      field.endsWith("Sha256") ||
      field === "digest"
    ) {
      digest(selected, `Rollback database ${field}`);
    }
  }
  if (value.digest !== rollbackDatabaseCompatibilityDigest(value)) {
    fail(
      "ROLLBACK_REHEARSAL_DATABASE_INCOMPATIBLE",
      "Rollback database compatibility digest is invalid."
    );
  }
  return freeze(structuredClone(value));
}

function pagesPayload(value) {
  return {
    schema: value.schema,
    state: value.state,
    deploymentId: value.deploymentId,
    commitSha: value.commitSha,
    artifactManifestSha256: value.artifactManifestSha256,
    routeManifestSha256: value.routeManifestSha256,
    evidenceSha256: value.evidenceSha256,
    allowsPagesMutation: value.allowsPagesMutation,
    externalEffects: value.externalEffects
  };
}

export function rollbackPagesFallbackDigest(value) {
  return immutableDigest(pagesPayload(value));
}

export function createRollbackPagesFallback({
  deploymentId,
  commitSha,
  artifactManifestSha256,
  routeManifestSha256,
  evidenceSha256
}) {
  const value = {
    schema: ROLLBACK_PAGES_FALLBACK_SCHEMA,
    state: "verified_held",
    deploymentId,
    commitSha,
    artifactManifestSha256,
    routeManifestSha256,
    evidenceSha256,
    allowsPagesMutation: false,
    externalEffects: false
  };
  return validateRollbackPagesFallback({
    ...value,
    digest: rollbackPagesFallbackDigest(value)
  });
}

export function validateRollbackPagesFallback(value) {
  exactObject(
    value,
    [
      "schema",
      "state",
      "deploymentId",
      "commitSha",
      "artifactManifestSha256",
      "routeManifestSha256",
      "evidenceSha256",
      "allowsPagesMutation",
      "externalEffects",
      "digest"
    ],
    "Rollback Pages fallback"
  );
  if (
    value.schema !== ROLLBACK_PAGES_FALLBACK_SCHEMA ||
    value.state !== "verified_held" ||
    typeof value.deploymentId !== "string" ||
    !DECIMAL.test(value.deploymentId) ||
    value.allowsPagesMutation !== false ||
    value.externalEffects !== false
  ) {
    fail(
      "ROLLBACK_REHEARSAL_PAGES_INVALID",
      "Pages fallback must be exact, verified-held, and effect-free."
    );
  }
  commit(value.commitSha, "Pages fallback commit");
  for (const field of [
    "artifactManifestSha256",
    "routeManifestSha256",
    "evidenceSha256",
    "digest"
  ]) digest(value[field], `Pages fallback ${field}`);
  if (value.digest !== rollbackPagesFallbackDigest(value)) {
    fail(
      "ROLLBACK_REHEARSAL_PAGES_INVALID",
      "Pages fallback digest is invalid."
    );
  }
  return freeze(structuredClone(value));
}

function processStatePayload(value) {
  return {
    schema: value.schema,
    selectedEpochDigest: value.selectedEpochDigest,
    api: value.api,
    worker: value.worker,
    externalEffects: value.externalEffects
  };
}

export function rollbackProcessStateDigest(value) {
  return immutableDigest(processStatePayload(value));
}

export function createRollbackProcessState({
  selectedEpochDigest,
  apiState,
  workerState
}) {
  const value = {
    schema: ROLLBACK_PROCESS_STATE_SCHEMA,
    selectedEpochDigest,
    api: {
      state: apiState,
      epochDigest: apiState === "running"
        ? selectedEpochDigest
        : null
    },
    worker: {
      state: workerState,
      epochDigest: workerState === "running"
        ? selectedEpochDigest
        : null
    },
    externalEffects: false
  };
  return validateRollbackProcessState({
    ...value,
    digest: rollbackProcessStateDigest(value)
  });
}

export function validateRollbackProcessState(value) {
  exactObject(
    value,
    [
      "schema",
      "selectedEpochDigest",
      "api",
      "worker",
      "externalEffects",
      "digest"
    ],
    "Rollback process state"
  );
  if (
    value.schema !== ROLLBACK_PROCESS_STATE_SCHEMA ||
    value.externalEffects !== false
  ) {
    fail(
      "ROLLBACK_REHEARSAL_PROCESS_STATE_INVALID",
      "Rollback process state must remain local and effect-free."
    );
  }
  digest(value.selectedEpochDigest, "Selected rollback epoch");
  for (const component of PROCESS_COMPONENTS) {
    exactObject(
      value[component],
      ["state", "epochDigest"],
      `Rollback ${component} process state`
    );
    if (
      !["running", "stopped"].includes(value[component].state) ||
      (
        value[component].state === "running" &&
        value[component].epochDigest !== value.selectedEpochDigest
      ) ||
      (
        value[component].state === "stopped" &&
        value[component].epochDigest !== null
      )
    ) {
      fail(
        "ROLLBACK_REHEARSAL_PROCESS_STATE_INVALID",
        `Rollback ${component} state is partial or ambiguous.`
      );
    }
  }
  digest(value.digest, "Rollback process state");
  if (value.digest !== rollbackProcessStateDigest(value)) {
    fail(
      "ROLLBACK_REHEARSAL_PROCESS_STATE_INVALID",
      "Rollback process-state digest is invalid."
    );
  }
  return freeze(structuredClone(value));
}

function probePayload(value) {
  return {
    schema: value.schema,
    epochDigest: value.epochDigest,
    path: value.path,
    listener: value.listener,
    statusCode: value.statusCode,
    held: value.held,
    bodySha256: value.bodySha256,
    externalEffects: value.externalEffects
  };
}

export function rollbackProbeReceiptDigest(value) {
  return immutableDigest(probePayload(value));
}

export function createRollbackProbeReceipt({
  epochDigest,
  path: probePath,
  listener,
  statusCode,
  held,
  bodySha256
}) {
  const value = {
    schema: ROLLBACK_PROBE_RECEIPT_SCHEMA,
    epochDigest,
    path: probePath,
    listener,
    statusCode,
    held,
    bodySha256,
    externalEffects: false
  };
  return validateRollbackProbeReceipt({
    ...value,
    digest: rollbackProbeReceiptDigest(value)
  });
}

export function validateRollbackProbeReceipt(value) {
  exactObject(
    value,
    [
      "schema",
      "epochDigest",
      "path",
      "listener",
      "statusCode",
      "held",
      "bodySha256",
      "externalEffects",
      "digest"
    ],
    "Rollback probe receipt"
  );
  if (
    value.schema !== ROLLBACK_PROBE_RECEIPT_SCHEMA ||
    !PROBE_PATHS.has(value.path) ||
    value.listener !== ORIGIN_LOOPBACK_EXPECTATIONS.hostedApi ||
    value.statusCode !== 200 ||
    value.held !== true ||
    value.externalEffects !== false
  ) {
    fail(
      "ROLLBACK_REHEARSAL_PROBE_FAILED",
      "Rollback live/readiness probe is not exact, held, and successful."
    );
  }
  digest(value.epochDigest, "Rollback probe epoch");
  digest(value.bodySha256, "Rollback probe body");
  digest(value.digest, "Rollback probe receipt");
  if (value.digest !== rollbackProbeReceiptDigest(value)) {
    fail(
      "ROLLBACK_REHEARSAL_PROBE_FAILED",
      "Rollback probe receipt digest is invalid."
    );
  }
  return freeze(structuredClone(value));
}

function receiptPayload(value) {
  return {
    schema: value.schema,
    state: value.state,
    outcome: value.outcome,
    identity: value.identity,
    databaseCompatibilityDigest:
      value.databaseCompatibilityDigest,
    backupRestoreReceiptDigest:
      value.backupRestoreReceiptDigest,
    pagesFallback: value.pagesFallback,
    operations: value.operations,
    failure: value.failure,
    finalState: value.finalState,
    holds: value.holds,
    startedAt: value.startedAt,
    completedAt: value.completedAt
  };
}

export function rollbackRehearsalReceiptDigest(value) {
  return immutableDigest(receiptPayload(value));
}

function validateEpochReceiptIdentity(value, label, successor) {
  const fields = [
    "epochId",
    "epochDigest",
    "sourceCommitSha",
    "sourceTreeSha",
    "artifactManifestSha256",
    "migrationManifestSha256",
    "topologyDigest"
  ];
  if (successor) {
    fields.push(
      "installedReadbackDigest",
      "installedReadbackReceiptSha256",
      "originRollbackPlanSha256",
      "rollbackPredecessorCommitSha",
      "rollbackPredecessorTreeSha",
      "rollbackPredecessorArtifactManifestSha256"
    );
  }
  exactObject(value, fields, label);
  safeIdentifier(value.epochId, `${label} epoch ID`);
  commit(value.sourceCommitSha, `${label} source commit`);
  commit(value.sourceTreeSha, `${label} source tree`);
  if (successor) {
    commit(
      value.rollbackPredecessorCommitSha,
      `${label} rollback predecessor commit`
    );
    commit(
      value.rollbackPredecessorTreeSha,
      `${label} rollback predecessor tree`
    );
  }
  for (const [field, selected] of Object.entries(value)) {
    if (field.endsWith("Digest") || field.endsWith("Sha256")) {
      digest(selected, `${label} ${field}`);
    }
  }
  return value;
}

function validateOperations(value) {
  if (!Array.isArray(value)) {
    fail(
      "ROLLBACK_REHEARSAL_RECEIPT_INVALID",
      "Rollback operations must be an exact array."
    );
  }
  const seen = new Set();
  return value.map((entry, index) => {
    exactObject(
      entry,
      ["sequence", "id", "evidenceSha256"],
      `Rollback operation ${index}`
    );
    if (
      entry.sequence !== index + 1 ||
      typeof entry.id !== "string" ||
      !/^[a-z][a-z0-9._-]{2,127}$/u.test(entry.id) ||
      seen.has(entry.id)
    ) {
      fail(
        "ROLLBACK_REHEARSAL_RECEIPT_INVALID",
        "Rollback operation sequence is partial, duplicated, or ambiguous."
      );
    }
    seen.add(entry.id);
    digest(entry.evidenceSha256, `Rollback operation ${entry.id}`);
    return structuredClone(entry);
  });
}

export function validateRollbackRehearsalReceipt(value) {
  exactObject(
    value,
    [
      "schema",
      "state",
      "outcome",
      "identity",
      "databaseCompatibilityDigest",
      "backupRestoreReceiptDigest",
      "pagesFallback",
      "operations",
      "failure",
      "finalState",
      "holds",
      "startedAt",
      "completedAt",
      "digest"
    ],
    "Rollback rehearsal receipt"
  );
  if (
    value.schema !== ROLLBACK_REHEARSAL_SCHEMA ||
    !["verified_held", "failed_held"].includes(value.state) ||
    ![
      "success",
      "aborted_recovered",
      "ambiguous_held"
    ].includes(value.outcome)
  ) {
    fail(
      "ROLLBACK_REHEARSAL_RECEIPT_INVALID",
      "Rollback rehearsal receipt state is invalid."
    );
  }
  exactObject(
    value.identity,
    ["predecessor", "successor"],
    "Rollback rehearsal identity"
  );
  const predecessor = validateEpochReceiptIdentity(
    value.identity.predecessor,
    "Rollback predecessor",
    false
  );
  const successor = validateEpochReceiptIdentity(
    value.identity.successor,
    "Rollback successor",
    true
  );
  if (
    predecessor.sourceCommitSha === successor.sourceCommitSha ||
    predecessor.sourceCommitSha !==
      successor.rollbackPredecessorCommitSha ||
    predecessor.sourceTreeSha !==
      successor.rollbackPredecessorTreeSha ||
    predecessor.artifactManifestSha256 !==
      successor.rollbackPredecessorArtifactManifestSha256
  ) {
    fail(
      "ROLLBACK_REHEARSAL_RECEIPT_INVALID",
      "Rollback receipt predecessor and successor identity is invalid."
    );
  }
  digest(
    value.databaseCompatibilityDigest,
    "Rollback database compatibility"
  );
  digest(
    value.backupRestoreReceiptDigest,
    "Rollback backup and restore receipt"
  );
  exactObject(
    value.pagesFallback,
    [
      "digest",
      "deploymentId",
      "commitSha",
      "artifactManifestSha256",
      "routeManifestSha256"
    ],
    "Rollback receipt Pages fallback"
  );
  if (!DECIMAL.test(value.pagesFallback.deploymentId)) {
    fail(
      "ROLLBACK_REHEARSAL_RECEIPT_INVALID",
      "Rollback receipt Pages deployment is invalid."
    );
  }
  commit(value.pagesFallback.commitSha, "Rollback receipt Pages commit");
  for (const field of [
    "digest",
    "artifactManifestSha256",
    "routeManifestSha256"
  ]) digest(value.pagesFallback[field], `Rollback Pages ${field}`);
  const operations = validateOperations(value.operations);
  exactObject(
    value.failure,
    [
      "causeCode",
      "operationId",
      "recoveryAttempted",
      "recoverySucceeded"
    ],
    "Rollback rehearsal failure"
  );
  exactObject(
    value.finalState,
    ["state", "processStateSha256"],
    "Rollback rehearsal final state"
  );
  if (value.outcome === "success") {
    if (
      value.state !== "verified_held" ||
      canonicalJson(operations.map(({ id }) => id)) !==
        canonicalJson(ROLLBACK_REHEARSAL_SUCCESS_OPERATIONS) ||
      canonicalJson(value.failure) !== canonicalJson({
        causeCode: null,
        operationId: null,
        recoveryAttempted: false,
        recoverySucceeded: null
      }) ||
      value.finalState.state !== "successor_active"
    ) {
      fail(
        "ROLLBACK_REHEARSAL_RECEIPT_INVALID",
        "Successful rollback receipt is incomplete or out of order."
      );
    }
  } else {
    const failedOperationIndex =
      ROLLBACK_REHEARSAL_SUCCESS_OPERATIONS.indexOf(
        value.failure.operationId
      );
    const operationIds = operations.map(({ id }) => id);
    const recoveryCount = operationIds.length - failedOperationIndex;
    const expectedOperations = [
      ...ROLLBACK_REHEARSAL_SUCCESS_OPERATIONS.slice(
        0,
        failedOperationIndex
      ),
      ...RECOVERY_OPERATIONS.slice(0, recoveryCount)
    ];
    if (
      value.state !== "failed_held" ||
      typeof value.failure.causeCode !== "string" ||
      !/^[A-Z][A-Z0-9_]{2,127}$/u.test(
        value.failure.causeCode
      ) ||
      failedOperationIndex < 0 ||
      value.failure.recoveryAttempted !== true ||
      recoveryCount < 0 ||
      recoveryCount > RECOVERY_OPERATIONS.length ||
      canonicalJson(operationIds) !==
        canonicalJson(expectedOperations) ||
      (
        value.outcome === "aborted_recovered" &&
        (
          value.failure.recoverySucceeded !== true ||
          value.finalState.state !== "successor_active" ||
          recoveryCount !== RECOVERY_OPERATIONS.length
        )
      ) ||
      (
        value.outcome === "ambiguous_held" &&
        (
          value.failure.recoverySucceeded !== false ||
          value.finalState.state !== "ambiguous"
        )
      )
    ) {
      fail(
        "ROLLBACK_REHEARSAL_RECEIPT_INVALID",
        "Failed rollback receipt does not fail closed in exact operation order."
      );
    }
  }
  if (value.finalState.state === "successor_active") {
    digest(
      value.finalState.processStateSha256,
      "Rollback final process state"
    );
  } else if (value.finalState.processStateSha256 !== null) {
    fail(
      "ROLLBACK_REHEARSAL_RECEIPT_INVALID",
      "Ambiguous rollback state must not claim a process-state digest."
    );
  }
  exactExpected(
    value.holds,
    ROLLBACK_REHEARSAL_HOLDS,
    "ROLLBACK_REHEARSAL_EFFECTS_NOT_HELD",
    "Rollback rehearsal effects must remain wholly held."
  );
  const startedAt = exactInstant(
    value.startedAt,
    "Rollback rehearsal start"
  );
  const completedAt = exactInstant(
    value.completedAt,
    "Rollback rehearsal completion"
  );
  if (completedAt < startedAt) {
    fail(
      "ROLLBACK_REHEARSAL_RECEIPT_INVALID",
      "Rollback rehearsal timestamps are not monotonic."
    );
  }
  digest(value.digest, "Rollback rehearsal receipt");
  if (value.digest !== rollbackRehearsalReceiptDigest(value)) {
    fail(
      "ROLLBACK_REHEARSAL_RECEIPT_INVALID",
      "Rollback rehearsal receipt digest is invalid."
    );
  }
  return freeze(structuredClone(value));
}

function validatePorts({ processPort, networkPort, pagesPort }) {
  exactObject(
    processPort,
    [
      "kind",
      "externalEffects",
      "observe",
      "stop",
      "select",
      "start"
    ],
    "Rollback process port"
  );
  exactObject(
    networkPort,
    ["kind", "externalEffects", "probe", "observeTopology"],
    "Rollback network port"
  );
  exactObject(
    pagesPort,
    ["kind", "externalEffects", "observeFallback"],
    "Rollback Pages port"
  );
  for (const [port, methods, label] of [
    [
      processPort,
      ["observe", "stop", "select", "start"],
      "process"
    ],
    [networkPort, ["probe", "observeTopology"], "network"],
    [pagesPort, ["observeFallback"], "Pages"]
  ]) {
    safeIdentifier(port.kind, `Rollback ${label} port kind`);
    if (
      port.externalEffects !== false ||
      methods.some((method) => typeof port[method] !== "function")
    ) {
      fail(
        "ROLLBACK_REHEARSAL_EXTERNAL_EFFECT_FORBIDDEN",
        `Rollback ${label} port must be an injected local fake with zero external effects.`
      );
    }
  }
  return { processPort, networkPort, pagesPort };
}

function validateContext({
  predecessorEpoch,
  successorEpoch,
  originSeal,
  installedReadback,
  predecessorTopology,
  successorTopology,
  databaseCompatibility,
  backupRestoreReceipt,
  pagesFallback
}) {
  const seal = validateOriginSeal(originSeal);
  const readback = validateOriginInstalledReadback(installedReadback);
  const successor = validateInstalledFinalReleaseEpochV2Chain({
    epoch: successorEpoch,
    originSeal: seal,
    installedReadback: readback
  });
  const predecessor = validateFinalReleaseEpochV2(predecessorEpoch);
  if (
    predecessor.identity.sourceCommitSha !==
      successor.rollback.predecessorCommitSha ||
    predecessor.identity.sourceTreeSha !==
      successor.rollback.predecessorTreeSha ||
    predecessor.identity.artifactManifestSha256 !==
      successor.rollback.predecessorArtifactManifestSha256
  ) {
    fail(
      "ROLLBACK_REHEARSAL_EPOCH_MISMATCH",
      "The predecessor epoch does not match the successor rollback authority."
    );
  }
  if (
    predecessor.identity.migrationCount >
      successor.identity.migrationCount
  ) {
    fail(
      "ROLLBACK_REHEARSAL_DATABASE_INCOMPATIBLE",
      "The rollback predecessor migration union cannot be ahead of the successor."
    );
  }
  const predecessorRuntime = validateRollbackRuntimeTopology(
    predecessorTopology,
    predecessor
  );
  const successorRuntime = validateRollbackRuntimeTopology(
    successorTopology,
    successor
  );
  exactExpected(
    successorRuntime.listeners,
    readback.listeners,
    "ROLLBACK_REHEARSAL_TOPOLOGY_MISMATCH",
    "Successor listener topology drifted from installed readback."
  );
  exactExpected(
    successorRuntime.worker.contract,
    readback.worker,
    "ROLLBACK_REHEARSAL_TOPOLOGY_MISMATCH",
    "Successor worker topology drifted from installed readback."
  );
  const backup = validateHeldCurrentBackupRestoreReceipt(
    backupRestoreReceipt
  );
  const expectedBackupRelease = {
    epochId: successor.epochId,
    bindingSha256: successor.bindingSha256,
    epochDigest: successor.digest,
    sourceCommitSha: successor.identity.sourceCommitSha,
    sourceTreeSha: successor.identity.sourceTreeSha,
    artifactManifestSha256:
      successor.identity.artifactManifestSha256,
    migrationCount: successor.identity.migrationCount,
    latestMigration: successor.identity.latestMigration,
    migrationManifestSha256:
      successor.identity.migrationManifestSha256,
    installedReadbackDigest: readback.digest,
    installedReadbackReceiptSha256:
      successor.evidence.originInstalledReadbackReceiptSha256
  };
  exactExpected(
    backup.release,
    expectedBackupRelease,
    "ROLLBACK_REHEARSAL_BACKUP_MISMATCH",
    "Backup and restore evidence does not match the exact installed successor."
  );
  exactExpected(
    {
      predecessorCommitSha:
        backup.rollback.predecessorCommitSha,
      predecessorTreeSha:
        backup.rollback.predecessorTreeSha,
      predecessorArtifactManifestSha256:
        backup.rollback.predecessorArtifactManifestSha256
    },
    successor.rollback,
    "ROLLBACK_REHEARSAL_BACKUP_MISMATCH",
    "Backup and restore evidence does not bind the exact rollback predecessor."
  );
  const database = validateRollbackDatabaseCompatibility(
    databaseCompatibility
  );
  if (
    database.predecessorEpochDigest !== predecessor.digest ||
    database.successorEpochDigest !== successor.digest ||
    database.predecessorMigrationManifestSha256 !==
      predecessor.identity.migrationManifestSha256 ||
    database.successorMigrationManifestSha256 !==
      successor.identity.migrationManifestSha256 ||
    database.backupRestoreReceiptDigest !== backup.digest
  ) {
    fail(
      "ROLLBACK_REHEARSAL_DATABASE_INCOMPATIBLE",
      "Database compatibility evidence drifted from the exact epochs or backup receipt."
    );
  }
  const pages = validateRollbackPagesFallback(pagesFallback);
  const rollbackPlan = createOriginRollbackPlan(seal);
  exactExpected(
    rollbackPlan.predecessor,
    successor.rollback,
    "ROLLBACK_REHEARSAL_EPOCH_MISMATCH",
    "Origin rollback plan drifted from the exact successor predecessor."
  );
  return freeze({
    predecessor,
    successor,
    seal,
    readback,
    predecessorTopology: predecessorRuntime,
    successorTopology: successorRuntime,
    database,
    backup,
    pages,
    rollbackPlan
  });
}

function epochIdentity(epoch, topology) {
  return {
    epochId: epoch.epochId,
    epochDigest: epoch.digest,
    sourceCommitSha: epoch.identity.sourceCommitSha,
    sourceTreeSha: epoch.identity.sourceTreeSha,
    artifactManifestSha256:
      epoch.identity.artifactManifestSha256,
    migrationManifestSha256:
      epoch.identity.migrationManifestSha256,
    topologyDigest: topology.digest
  };
}

function receiptBase(context, startedAt) {
  return {
    schema: ROLLBACK_REHEARSAL_SCHEMA,
    identity: {
      predecessor: epochIdentity(
        context.predecessor,
        context.predecessorTopology
      ),
      successor: {
        ...epochIdentity(
          context.successor,
          context.successorTopology
        ),
        installedReadbackDigest: context.readback.digest,
        installedReadbackReceiptSha256:
          context.successor.evidence
            .originInstalledReadbackReceiptSha256,
        originRollbackPlanSha256:
          context.rollbackPlan.planSha256,
        rollbackPredecessorCommitSha:
          context.successor.rollback.predecessorCommitSha,
        rollbackPredecessorTreeSha:
          context.successor.rollback.predecessorTreeSha,
        rollbackPredecessorArtifactManifestSha256:
          context.successor.rollback
            .predecessorArtifactManifestSha256
      }
    },
    databaseCompatibilityDigest: context.database.digest,
    backupRestoreReceiptDigest: context.backup.digest,
    pagesFallback: {
      digest: context.pages.digest,
      deploymentId: context.pages.deploymentId,
      commitSha: context.pages.commitSha,
      artifactManifestSha256:
        context.pages.artifactManifestSha256,
      routeManifestSha256:
        context.pages.routeManifestSha256
    },
    holds: structuredClone(ROLLBACK_REHEARSAL_HOLDS),
    startedAt
  };
}

function completedReceipt({
  base,
  state,
  outcome,
  operations,
  failure,
  finalState,
  completedAt
}) {
  const value = {
    ...base,
    state,
    outcome,
    operations,
    failure,
    finalState,
    completedAt
  };
  return validateRollbackRehearsalReceipt({
    ...value,
    digest: rollbackRehearsalReceiptDigest(value)
  });
}

function operationRecorder(operations) {
  return (id, evidenceSha256) => {
    digest(evidenceSha256, `Rollback operation ${id}`);
    operations.push({
      sequence: operations.length + 1,
      id,
      evidenceSha256
    });
  };
}

function expectedState(epochDigest, apiState, workerState) {
  return createRollbackProcessState({
    selectedEpochDigest: epochDigest,
    apiState,
    workerState
  });
}

function expectProcessState(actual, expected, label) {
  const selected = validateRollbackProcessState(actual);
  return exactExpected(
    selected,
    expected,
    "ROLLBACK_REHEARSAL_PROCESS_STATE_INVALID",
    `${label} process state is partial or ambiguous.`
  );
}

function expectPages(actual, expected) {
  const selected = validateRollbackPagesFallback(actual);
  return exactExpected(
    selected,
    expected,
    "ROLLBACK_REHEARSAL_PAGES_INVALID",
    "Pages fallback observation drifted during rollback rehearsal."
  );
}

function expectTopology(actual, expected) {
  const selected = validateRollbackRuntimeTopology(actual);
  return exactExpected(
    selected,
    expected,
    "ROLLBACK_REHEARSAL_TOPOLOGY_MISMATCH",
    "Observed runtime topology drifted during rollback rehearsal."
  );
}

function expectProbe(actual, epoch, topology, probePath) {
  const selected = validateRollbackProbeReceipt(actual);
  if (
    selected.epochDigest !== epoch.digest ||
    selected.path !== probePath ||
    selected.listener !== topology.api.listener
  ) {
    fail(
      "ROLLBACK_REHEARSAL_PROBE_FAILED",
      "Live/readiness probe drifted from the selected epoch topology."
    );
  }
  return selected;
}

function safeCauseCode(error) {
  if (
    error instanceof RollbackRehearsalFailure &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return "ROLLBACK_REHEARSAL_PORT_FAILURE";
}

export async function runHeldRollbackRehearsal({
  predecessorEpoch,
  successorEpoch,
  originSeal,
  installedReadback,
  predecessorTopology,
  successorTopology,
  databaseCompatibility,
  backupRestoreReceipt,
  pagesFallback,
  processPort,
  networkPort,
  pagesPort,
  now = () => new Date()
}) {
  const context = validateContext({
    predecessorEpoch,
    successorEpoch,
    originSeal,
    installedReadback,
    predecessorTopology,
    successorTopology,
    databaseCompatibility,
    backupRestoreReceipt,
    pagesFallback
  });
  const ports = validatePorts({
    processPort,
    networkPort,
    pagesPort
  });
  const startedAt = selectedClock(
    now,
    "Rollback rehearsal start"
  ).toISOString();
  const base = receiptBase(context, startedAt);
  const operations = [];
  const record = operationRecorder(operations);
  let currentOperation = "preflight";

  const observeState = async (id, expected) => {
    currentOperation = id;
    const state = expectProcessState(
      await ports.processPort.observe(),
      expected,
      id
    );
    record(id, state.digest);
    return state;
  };
  const processAction = async ({
    id,
    action,
    expected
  }) => {
    currentOperation = id;
    await action();
    const state = expectProcessState(
      await ports.processPort.observe(),
      expected,
      id
    );
    record(id, state.digest);
    return state;
  };
  const pagesCheck = async (id) => {
    currentOperation = id;
    const pages = expectPages(
      await ports.pagesPort.observeFallback(),
      context.pages
    );
    record(id, pages.digest);
  };
  const probe = async (id, epoch, topology, probePath) => {
    currentOperation = id;
    const receipt = expectProbe(
      await ports.networkPort.probe({
        epochDigest: epoch.digest,
        path: probePath,
        listener: topology.api.listener
      }),
      epoch,
      topology,
      probePath
    );
    record(id, receipt.digest);
  };
  const topologyCheck = async (id, epoch, topology) => {
    currentOperation = id;
    const observed = expectTopology(
      await ports.networkPort.observeTopology({
        epochDigest: epoch.digest
      }),
      topology
    );
    record(id, observed.digest);
  };

  const recover = async () => {
    currentOperation = RECOVERY_OPERATIONS[0];
    await ports.processPort.stop({ component: "worker" });
    let selected = validateRollbackProcessState(
      await ports.processPort.observe()
    );
    if (selected.worker.state !== "stopped") {
      fail(
        "ROLLBACK_REHEARSAL_AMBIGUOUS",
        "Recovery could not stop the selected worker."
      );
    }
    record(RECOVERY_OPERATIONS[0], selected.digest);

    currentOperation = RECOVERY_OPERATIONS[1];
    await ports.processPort.stop({ component: "api" });
    selected = validateRollbackProcessState(
      await ports.processPort.observe()
    );
    if (
      selected.api.state !== "stopped" ||
      selected.worker.state !== "stopped"
    ) {
      fail(
        "ROLLBACK_REHEARSAL_AMBIGUOUS",
        "Recovery could not reach a fully stopped process state."
      );
    }
    record(RECOVERY_OPERATIONS[1], selected.digest);

    await processAction({
      id: RECOVERY_OPERATIONS[2],
      action: () => ports.processPort.select({
        epochDigest: context.successor.digest
      }),
      expected: expectedState(
        context.successor.digest,
        "stopped",
        "stopped"
      )
    });
    await processAction({
      id: RECOVERY_OPERATIONS[3],
      action: () => ports.processPort.start({ component: "api" }),
      expected: expectedState(
        context.successor.digest,
        "running",
        "stopped"
      )
    });
    const finalState = await processAction({
      id: RECOVERY_OPERATIONS[4],
      action: () => ports.processPort.start({ component: "worker" }),
      expected: expectedState(
        context.successor.digest,
        "running",
        "running"
      )
    });
    await probe(
      RECOVERY_OPERATIONS[5],
      context.successor,
      context.successorTopology,
      "/api/v1/live"
    );
    await probe(
      RECOVERY_OPERATIONS[6],
      context.successor,
      context.successorTopology,
      "/api/v1/ready"
    );
    await topologyCheck(
      RECOVERY_OPERATIONS[7],
      context.successor,
      context.successorTopology
    );
    await observeState(
      RECOVERY_OPERATIONS[8],
      expectedState(
        context.successor.digest,
        "running",
        "running"
      )
    );
    return finalState;
  };

  try {
    await observeState(
      ROLLBACK_REHEARSAL_SUCCESS_OPERATIONS[0],
      expectedState(
        context.successor.digest,
        "running",
        "running"
      )
    );
    await pagesCheck(ROLLBACK_REHEARSAL_SUCCESS_OPERATIONS[1]);
    await processAction({
      id: ROLLBACK_REHEARSAL_SUCCESS_OPERATIONS[2],
      action: () => ports.processPort.stop({ component: "worker" }),
      expected: expectedState(
        context.successor.digest,
        "running",
        "stopped"
      )
    });
    await processAction({
      id: ROLLBACK_REHEARSAL_SUCCESS_OPERATIONS[3],
      action: () => ports.processPort.stop({ component: "api" }),
      expected: expectedState(
        context.successor.digest,
        "stopped",
        "stopped"
      )
    });
    await pagesCheck(ROLLBACK_REHEARSAL_SUCCESS_OPERATIONS[4]);
    await processAction({
      id: ROLLBACK_REHEARSAL_SUCCESS_OPERATIONS[5],
      action: () => ports.processPort.select({
        epochDigest: context.predecessor.digest
      }),
      expected: expectedState(
        context.predecessor.digest,
        "stopped",
        "stopped"
      )
    });
    await processAction({
      id: ROLLBACK_REHEARSAL_SUCCESS_OPERATIONS[6],
      action: () => ports.processPort.start({ component: "api" }),
      expected: expectedState(
        context.predecessor.digest,
        "running",
        "stopped"
      )
    });
    await processAction({
      id: ROLLBACK_REHEARSAL_SUCCESS_OPERATIONS[7],
      action: () => ports.processPort.start({ component: "worker" }),
      expected: expectedState(
        context.predecessor.digest,
        "running",
        "running"
      )
    });
    await probe(
      ROLLBACK_REHEARSAL_SUCCESS_OPERATIONS[8],
      context.predecessor,
      context.predecessorTopology,
      "/api/v1/live"
    );
    await probe(
      ROLLBACK_REHEARSAL_SUCCESS_OPERATIONS[9],
      context.predecessor,
      context.predecessorTopology,
      "/api/v1/ready"
    );
    await topologyCheck(
      ROLLBACK_REHEARSAL_SUCCESS_OPERATIONS[10],
      context.predecessor,
      context.predecessorTopology
    );
    await processAction({
      id: ROLLBACK_REHEARSAL_SUCCESS_OPERATIONS[11],
      action: () => ports.processPort.stop({ component: "worker" }),
      expected: expectedState(
        context.predecessor.digest,
        "running",
        "stopped"
      )
    });
    await processAction({
      id: ROLLBACK_REHEARSAL_SUCCESS_OPERATIONS[12],
      action: () => ports.processPort.stop({ component: "api" }),
      expected: expectedState(
        context.predecessor.digest,
        "stopped",
        "stopped"
      )
    });
    await processAction({
      id: ROLLBACK_REHEARSAL_SUCCESS_OPERATIONS[13],
      action: () => ports.processPort.select({
        epochDigest: context.successor.digest
      }),
      expected: expectedState(
        context.successor.digest,
        "stopped",
        "stopped"
      )
    });
    await processAction({
      id: ROLLBACK_REHEARSAL_SUCCESS_OPERATIONS[14],
      action: () => ports.processPort.start({ component: "api" }),
      expected: expectedState(
        context.successor.digest,
        "running",
        "stopped"
      )
    });
    const finalState = await processAction({
      id: ROLLBACK_REHEARSAL_SUCCESS_OPERATIONS[15],
      action: () => ports.processPort.start({ component: "worker" }),
      expected: expectedState(
        context.successor.digest,
        "running",
        "running"
      )
    });
    await probe(
      ROLLBACK_REHEARSAL_SUCCESS_OPERATIONS[16],
      context.successor,
      context.successorTopology,
      "/api/v1/live"
    );
    await probe(
      ROLLBACK_REHEARSAL_SUCCESS_OPERATIONS[17],
      context.successor,
      context.successorTopology,
      "/api/v1/ready"
    );
    await topologyCheck(
      ROLLBACK_REHEARSAL_SUCCESS_OPERATIONS[18],
      context.successor,
      context.successorTopology
    );
    await observeState(
      ROLLBACK_REHEARSAL_SUCCESS_OPERATIONS[19],
      expectedState(
        context.successor.digest,
        "running",
        "running"
      )
    );
    return completedReceipt({
      base,
      state: "verified_held",
      outcome: "success",
      operations,
      failure: {
        causeCode: null,
        operationId: null,
        recoveryAttempted: false,
        recoverySucceeded: null
      },
      finalState: {
        state: "successor_active",
        processStateSha256: finalState.digest
      },
      completedAt: selectedClock(
        now,
        "Rollback rehearsal completion"
      ).toISOString()
    });
  } catch (error) {
    const causeCode = safeCauseCode(error);
    const failedOperation = currentOperation;
    try {
      const finalState = await recover();
      const receipt = completedReceipt({
        base,
        state: "failed_held",
        outcome: "aborted_recovered",
        operations,
        failure: {
          causeCode,
          operationId: failedOperation,
          recoveryAttempted: true,
          recoverySucceeded: true
        },
        finalState: {
          state: "successor_active",
          processStateSha256: finalState.digest
        },
        completedAt: selectedClock(
          now,
          "Rollback recovery completion"
        ).toISOString()
      });
      fail(
        "ROLLBACK_REHEARSAL_ABORTED_RECOVERED",
        "Rollback rehearsal failed closed and recovered the successor.",
        receipt
      );
    } catch (recoveryError) {
      if (
        recoveryError instanceof RollbackRehearsalFailure &&
        recoveryError.code ===
          "ROLLBACK_REHEARSAL_ABORTED_RECOVERED"
      ) {
        throw recoveryError;
      }
      const receipt = completedReceipt({
        base,
        state: "failed_held",
        outcome: "ambiguous_held",
        operations,
        failure: {
          causeCode,
          operationId: failedOperation,
          recoveryAttempted: true,
          recoverySucceeded: false
        },
        finalState: {
          state: "ambiguous",
          processStateSha256: null
        },
        completedAt: selectedClock(
          now,
          "Rollback ambiguous completion"
        ).toISOString()
      });
      fail(
        "ROLLBACK_REHEARSAL_AMBIGUOUS",
        "Rollback rehearsal and recovery ended in an ambiguous held state.",
        receipt
      );
    }
  }
}
