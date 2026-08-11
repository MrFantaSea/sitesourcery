import {
  canonicalJson,
  sha256Bytes
} from "./immutable-evidence.mjs";
import {
  PRIMARY_BROWSER_AUDIT_VIEWPORTS,
  REVIEWED_CHROMIUM
} from "../scripts/browser-audit-vnext.mjs";
import {
  ORIGIN_HELD_AUTHORITY,
  originFileManifestSha256,
  validateOriginReleaseInput
} from "./origin-seal-runtime.mjs";

export const CI_RELEASE_SUCCESSOR_INPUT_SCHEMA =
  "sitesourcery.ci-release-successor-input/v1";
export const CI_RELEASE_STEP_RECEIPT_SCHEMA =
  "sitesourcery.ci-release-step-receipt/v1";
export const CI_RELEASE_FINAL_RECEIPT_SCHEMA =
  "sitesourcery.ci-release-final-receipt/v1";
export const CI_RELEASE_PROTECTED_ENVIRONMENT =
  "ci-release-proof-held";
export const CI_RELEASE_PINNED_NODE = "24.18.0";
export const CI_RELEASE_BROWSER_WIDTHS = Object.freeze(
  PRIMARY_BROWSER_AUDIT_VIEWPORTS.map((viewport) => viewport.width)
);
export const CI_RELEASE_BROWSER_VERSION =
  REVIEWED_CHROMIUM.version;

const SHA256 = /^[a-f0-9]{64}$/u;
const COMMIT_SHA = /^[a-f0-9]{40}$/u;
const MIGRATION = /^[0-9]{12}_[a-z0-9_]+\.sql$/u;
const STEPS = Object.freeze([
  "browser",
  "cleanup",
  "full-npm",
  "legal-v4",
  "ops",
  "postgres"
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

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail(`${label} must be a positive safe integer.`);
  }
  return value;
}

function nonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(`${label} must be a nonnegative safe integer.`);
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
    fail(`${label} must be an exact UTC instant.`);
  }
  return value;
}

function exactHeldAuthority(value) {
  if (canonicalJson(value) !== canonicalJson(ORIGIN_HELD_AUTHORITY)) {
    fail("CI release proof authority must remain exactly held.");
  }
  return value;
}

function successorPayload(value) {
  return {
    schema: value.schema,
    originReleaseInput: value.originReleaseInput,
    migrationInventory: value.migrationInventory,
    nodeVersion: value.nodeVersion,
    legalV4Pages: value.legalV4Pages,
    authority: value.authority
  };
}

export function ciReleaseSuccessorInputDigest(value) {
  return sha256Bytes(
    Buffer.from(`${canonicalJson(successorPayload(value))}\n`, "utf8")
  );
}

function validateMigrationInventory(value, originInput) {
  exactObject(
    value,
    ["count", "latest", "files", "manifestSha256"],
    "CI final migration inventory"
  );
  positiveInteger(value.count, "CI final migration count");
  if (!Array.isArray(value.files) || value.files.length !== value.count) {
    fail("CI final migration files do not match their supplied count.");
  }
  let previous = null;
  const manifestFiles = [];
  for (const [index, entry] of value.files.entries()) {
    exactObject(
      entry,
      ["name", "byteCount", "sha256"],
      `CI final migration ${index}`
    );
    if (typeof entry.name !== "string" || !MIGRATION.test(entry.name)) {
      fail("CI final migration filename is invalid.");
    }
    if (previous !== null && entry.name.localeCompare(previous) <= 0) {
      fail("CI final migration inventory must be uniquely ordered.");
    }
    previous = entry.name;
    nonnegativeInteger(entry.byteCount, "CI final migration byte count");
    digest(entry.sha256, "CI final migration digest");
    manifestFiles.push({
      path: `${originInput.epoch.layout.migrationRoot}/${entry.name}`,
      byteCount: entry.byteCount,
      sha256: entry.sha256
    });
  }
  if (
    value.latest !== value.files.at(-1)?.name ||
    value.latest !== originInput.epoch.migration.latest ||
    value.count !== originInput.epoch.migration.count
  ) {
    fail("CI final migration count or latest file drifted from the successor epoch.");
  }
  const manifestSha256 = originFileManifestSha256({
    domain: "origin-migrations",
    files: manifestFiles
  });
  if (
    value.manifestSha256 !== manifestSha256 ||
    value.manifestSha256 !== originInput.epoch.migration.manifestSha256
  ) {
    fail("CI final migration manifest drifted from the successor epoch.");
  }
  return value;
}

export function createCiReleaseSuccessorInput({
  originReleaseInput,
  migrationInventory,
  legalV4Pages
}) {
  const value = {
    schema: CI_RELEASE_SUCCESSOR_INPUT_SCHEMA,
    originReleaseInput,
    migrationInventory,
    nodeVersion: CI_RELEASE_PINNED_NODE,
    legalV4Pages,
    authority: structuredClone(ORIGIN_HELD_AUTHORITY)
  };
  return validateCiReleaseSuccessorInput({
    ...value,
    digest: ciReleaseSuccessorInputDigest(value)
  });
}

export function validateCiReleaseSuccessorInput(value) {
  exactObject(
    value,
    [
      "schema",
      "originReleaseInput",
      "migrationInventory",
      "nodeVersion",
      "legalV4Pages",
      "authority",
      "digest"
    ],
    "CI release successor input"
  );
  if (
    value.schema !== CI_RELEASE_SUCCESSOR_INPUT_SCHEMA ||
    value.nodeVersion !== CI_RELEASE_PINNED_NODE
  ) {
    fail("CI release successor input identity is invalid.");
  }
  const originInput = validateOriginReleaseInput(value.originReleaseInput);
  validateMigrationInventory(value.migrationInventory, originInput);
  exactObject(
    value.legalV4Pages,
    ["fileCount", "manifestSha256"],
    "CI Legal V4 Pages artifact"
  );
  positiveInteger(
    value.legalV4Pages.fileCount,
    "CI Legal V4 Pages file count"
  );
  digest(
    value.legalV4Pages.manifestSha256,
    "CI Legal V4 Pages manifest"
  );
  exactHeldAuthority(value.authority);
  if (value.digest !== ciReleaseSuccessorInputDigest(value)) {
    fail("CI release successor input digest is invalid.");
  }
  return deepFreeze(structuredClone(value));
}

function stepPayload(value) {
  return {
    schema: value.schema,
    step: value.step,
    candidateSha: value.candidateSha,
    workflowSha: value.workflowSha,
    successorInputDigest: value.successorInputDigest,
    runId: value.runId,
    runAttempt: value.runAttempt,
    observedAt: value.observedAt,
    result: value.result,
    details: value.details,
    authority: value.authority
  };
}

export function ciReleaseStepReceiptDigest(value) {
  return sha256Bytes(
    Buffer.from(`${canonicalJson(stepPayload(value))}\n`, "utf8")
  );
}

function validateContext(value) {
  commit(value.candidateSha, "CI proof candidate");
  commit(value.workflowSha, "CI proof workflow");
  digest(value.successorInputDigest, "CI proof successor input");
  if (
    typeof value.runId !== "string" ||
    !/^[1-9][0-9]*$/u.test(value.runId) ||
    typeof value.runAttempt !== "string" ||
    !/^[1-9][0-9]*$/u.test(value.runAttempt)
  ) {
    fail("CI proof run identity is invalid.");
  }
}

function validateDetails(step, details) {
  if (step === "full-npm" || step === "ops") {
    exactObject(details, ["command"], `CI ${step} details`);
    const expected = step === "full-npm" ? "npm test" : "npm run check:ops";
    if (details.command !== expected) fail(`CI ${step} command is invalid.`);
    return;
  }
  if (step === "legal-v4") {
    exactObject(
      details,
      ["fileCount", "manifestSha256"],
      "CI Legal V4 proof details"
    );
    positiveInteger(details.fileCount, "CI Legal V4 proof file count");
    digest(details.manifestSha256, "CI Legal V4 proof manifest");
    return;
  }
  if (step === "browser") {
    exactObject(
      details,
      [
        "routeCount",
        "viewCount",
        "widths",
        "browserVersion",
        "artifactManifestSha256"
      ],
      "CI browser proof details"
    );
    positiveInteger(details.routeCount, "CI browser route count");
    positiveInteger(details.viewCount, "CI browser view count");
    if (
      canonicalJson(details.widths) !==
        canonicalJson(CI_RELEASE_BROWSER_WIDTHS) ||
      details.browserVersion !== CI_RELEASE_BROWSER_VERSION ||
      details.viewCount !== details.routeCount * CI_RELEASE_BROWSER_WIDTHS.length
    ) {
      fail("CI browser proof dimensions or browser identity are invalid.");
    }
    digest(
      details.artifactManifestSha256,
      "CI browser artifact manifest"
    );
    return;
  }
  if (step === "postgres") {
    exactObject(
      details,
      [
        "databaseNameSha256",
        "postgresMajor",
        "migrationCount",
        "migrationManifestSha256"
      ],
      "CI PostgreSQL proof details"
    );
    digest(details.databaseNameSha256, "CI PostgreSQL database name");
    if (details.postgresMajor !== 16) {
      fail("CI PostgreSQL proof must use major version 16.");
    }
    positiveInteger(details.migrationCount, "CI PostgreSQL migration count");
    digest(details.migrationManifestSha256, "CI PostgreSQL migration manifest");
    return;
  }
  if (step === "cleanup") {
    exactObject(
      details,
      ["databaseNameSha256", "databaseAbsent"],
      "CI cleanup proof details"
    );
    digest(details.databaseNameSha256, "CI cleanup database name");
    if (details.databaseAbsent !== true) {
      fail("CI cleanup must prove exact database absence.");
    }
    return;
  }
  fail("CI release proof step is invalid.");
}

export function createCiReleaseStepReceipt({
  step,
  context,
  observedAt,
  details
}) {
  const value = {
    schema: CI_RELEASE_STEP_RECEIPT_SCHEMA,
    step,
    ...context,
    observedAt,
    result: "passed",
    details,
    authority: structuredClone(ORIGIN_HELD_AUTHORITY)
  };
  return validateCiReleaseStepReceipt({
    ...value,
    digest: ciReleaseStepReceiptDigest(value)
  });
}

export function validateCiReleaseStepReceipt(value) {
  exactObject(
    value,
    [
      "schema",
      "step",
      "candidateSha",
      "workflowSha",
      "successorInputDigest",
      "runId",
      "runAttempt",
      "observedAt",
      "result",
      "details",
      "authority",
      "digest"
    ],
    "CI release step receipt"
  );
  if (
    value.schema !== CI_RELEASE_STEP_RECEIPT_SCHEMA ||
    !STEPS.includes(value.step) ||
    value.result !== "passed"
  ) {
    fail("CI release step receipt identity is invalid.");
  }
  validateContext(value);
  exactInstant(value.observedAt, "CI release step observation");
  validateDetails(value.step, value.details);
  exactHeldAuthority(value.authority);
  if (value.digest !== ciReleaseStepReceiptDigest(value)) {
    fail("CI release step receipt digest is invalid.");
  }
  return deepFreeze(structuredClone(value));
}

function finalPayload(value) {
  return {
    schema: value.schema,
    state: value.state,
    candidateSha: value.candidateSha,
    workflowSha: value.workflowSha,
    successorInputDigest: value.successorInputDigest,
    runId: value.runId,
    runAttempt: value.runAttempt,
    proofs: value.proofs,
    authority: value.authority
  };
}

export function createCiReleaseFinalReceipt({
  successorInput,
  context,
  receipts
}) {
  const input = validateCiReleaseSuccessorInput(successorInput);
  validateContext(context);
  if (
    context.candidateSha !==
      input.originReleaseInput.epoch.source.commitSha ||
    context.successorInputDigest !== input.digest
  ) {
    fail("CI final proof context drifted from the successor input.");
  }
  if (!Array.isArray(receipts) || receipts.length !== STEPS.length) {
    fail("CI final proof requires every exact proof receipt.");
  }
  const selected = new Map();
  for (const receipt of receipts) {
    const proof = validateCiReleaseStepReceipt(receipt);
    if (selected.has(proof.step)) {
      fail("CI final proof contains a duplicate receipt.");
    }
    for (const field of [
      "candidateSha",
      "workflowSha",
      "successorInputDigest",
      "runId",
      "runAttempt"
    ]) {
      if (proof[field] !== context[field]) {
        fail("CI proof receipt context drifted.");
      }
    }
    selected.set(proof.step, proof);
  }
  if (canonicalJson([...selected.keys()].sort()) !== canonicalJson(STEPS)) {
    fail("CI final proof receipt coverage is incomplete.");
  }
  const legal = selected.get("legal-v4").details;
  const browser = selected.get("browser").details;
  const postgres = selected.get("postgres").details;
  const cleanup = selected.get("cleanup").details;
  if (
    legal.fileCount !== input.legalV4Pages.fileCount ||
    legal.manifestSha256 !== input.legalV4Pages.manifestSha256 ||
    browser.artifactManifestSha256 !==
      input.legalV4Pages.manifestSha256 ||
    postgres.migrationCount !== input.migrationInventory.count ||
    postgres.migrationManifestSha256 !==
      input.migrationInventory.manifestSha256 ||
    cleanup.databaseNameSha256 !== postgres.databaseNameSha256
  ) {
    fail("CI final proof evidence drifted from its successor authority.");
  }
  const proofs = Object.fromEntries(
    STEPS.map((step) => [step, selected.get(step).digest])
  );
  const payload = {
    schema: CI_RELEASE_FINAL_RECEIPT_SCHEMA,
    state: "verified_held",
    ...context,
    proofs,
    authority: structuredClone(ORIGIN_HELD_AUTHORITY)
  };
  return validateCiReleaseFinalReceipt({
    ...payload,
    digest: sha256Bytes(
      Buffer.from(`${canonicalJson(finalPayload(payload))}\n`, "utf8")
    )
  });
}

export function validateCiReleaseFinalReceipt(value) {
  exactObject(
    value,
    [
      "schema",
      "state",
      "candidateSha",
      "workflowSha",
      "successorInputDigest",
      "runId",
      "runAttempt",
      "proofs",
      "authority",
      "digest"
    ],
    "CI release final receipt"
  );
  if (
    value.schema !== CI_RELEASE_FINAL_RECEIPT_SCHEMA ||
    value.state !== "verified_held"
  ) {
    fail("CI release final receipt identity is invalid.");
  }
  validateContext(value);
  exactObject(value.proofs, STEPS, "CI release final proof digests");
  for (const step of STEPS) {
    digest(value.proofs[step], `CI ${step} proof receipt`);
  }
  exactHeldAuthority(value.authority);
  const expected = sha256Bytes(
    Buffer.from(`${canonicalJson(finalPayload(value))}\n`, "utf8")
  );
  if (value.digest !== expected) {
    fail("CI release final receipt digest is invalid.");
  }
  return deepFreeze(structuredClone(value));
}

export function ciReleaseDatabaseName({ runId, runAttempt }) {
  if (
    typeof runId !== "string" ||
    !/^[1-9][0-9]*$/u.test(runId) ||
    typeof runAttempt !== "string" ||
    !/^[1-9][0-9]*$/u.test(runAttempt)
  ) {
    fail("CI release database run identity is invalid.");
  }
  return `ss_ci_release_${runId}_${runAttempt}`;
}

export function validateCiReleaseDatabaseName(value) {
  if (
    typeof value !== "string" ||
    !/^ss_ci_release_[1-9][0-9]*_[1-9][0-9]*$/u.test(value)
  ) {
    fail("CI release database name is outside its exact disposable namespace.");
  }
  return value;
}

export function ciReleaseDatabaseNameSha256(value) {
  return sha256Bytes(
    Buffer.from(`${validateCiReleaseDatabaseName(value)}\n`, "utf8")
  );
}

export function ciReleaseContextFromEnvironment(environment) {
  const context = {
    candidateSha: environment.CI_RELEASE_CANDIDATE_SHA,
    workflowSha: environment.CI_RELEASE_WORKFLOW_SHA,
    successorInputDigest:
      environment.CI_RELEASE_SUCCESSOR_INPUT_DIGEST,
    runId: environment.GITHUB_RUN_ID,
    runAttempt: environment.GITHUB_RUN_ATTEMPT
  };
  validateContext(context);
  return deepFreeze(context);
}

export function ciReleaseProofSteps() {
  return [...STEPS];
}
