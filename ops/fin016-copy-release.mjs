#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import { constants as filesystemConstants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rm
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  validateCiReleaseFinalReceipt,
  validateCiReleaseSuccessorInput
} from "./ci-release-proof-runtime.mjs";
import { verifyCiReleaseCandidate } from "./ci-release-proof-repository.mjs";
import { createHeldFinalReleaseEpochV2 } from "./final-release-epoch-v2.mjs";
import {
  canonicalJson,
  parseJsonObject,
  sha256Bytes
} from "./immutable-evidence.mjs";
import {
  parseFin010EnvironmentFile,
  readFin010EnvironmentValue
} from "./fin010-production-runtime.mjs";
import {
  FIN015_EXPECTED_ENVIRONMENT_NAMES
} from "./fin015-production-runtime.mjs";
import {
  FIN015_SUCCESSOR_MIGRATION_MANIFEST_SHA256,
  FIN015_SUCCESSOR_SCHEMA_SHA256,
  FIN015_SUCCESSOR_TABLE_COUNT
} from "./fin015-protected-production-upgrade.mjs";
import {
  ORIGIN_HELD_AUTHORITY,
  ORIGIN_LOOPBACK_EXPECTATIONS,
  createOriginInstalledReadback,
  expectedOriginInstalledIdentity,
  expectedOriginInstalledWorker
} from "./origin-seal-runtime.mjs";
import { verifyOriginReleaseRepository } from "./origin-seal-repository.mjs";

const executeFile = promisify(execFileCallback);

export const FIN016_RUNTIME_SCHEMA = "sitesourcery.fin016-copy-release/v1";
export const FIN016_BUNDLE_SCHEMA = "sitesourcery.fin016-copy-release-bundle/v1";
export const FIN016_CONTROL_SCHEMA = "sitesourcery.fin016-copy-release-control/v1";
export const FIN016_PLAN_SCHEMA = "sitesourcery.fin016-copy-release-plan/v1";

export const FIN016_INSTALLED_COMMIT =
  "e74546a830649ac82a22463e4c08ea29e7edbc9c";
export const FIN016_INSTALLED_TREE =
  "c5a8c673a5a92d855153e4c52eab8414dda1ffd9";
export const FIN016_INSTALLED_EPOCH =
  "fin015-publication-readiness-e74546a-20260901";
export const FIN016_INSTALLED_ARTIFACT_MANIFEST_SHA256 =
  "678dfb372df326358831869e63ba2a9bf5140ba573f501acda8c113a38355993";
export const FIN016_CANDIDATE_COMMIT =
  "1126f5bf4993887e4a41571e9671e2fa20e1f136";
export const FIN016_CANDIDATE_TREE =
  "4afbf2ac2bf6f33a028ea4f90de9d2414548dcbf";
export const FIN016_CANDIDATE_ARTIFACT_MANIFEST_SHA256 =
  "342922fda0f1726cffd72efe6f69b696a56f23535f68325d9114ff56710f91bf";
export const FIN016_HELD_CONTROL_COMMIT =
  "bc5f56b7466e7e8cbaa0bab37a5da6fa90d4cf50";
export const FIN016_HELD_CONTROL_TREE =
  "0af58b412880d518abe597ad75158328961a9352";
export const FIN016_SUCCESSOR_INPUT_SHA256 =
  "a469618c6ea6df553f9e02b5e6044f00c95ebe1bdb7fd679a80ea00660903861";
export const FIN016_SUCCESSOR_INPUT_DIGEST =
  "615d5fa25cc12d6d83665706635854d59316910f8f179e898e679c2832e7ecde";
export const FIN016_CI_RECEIPT_FILE_SHA256 =
  "0040e6b376239c9117e3d52f604ca0b693d7ac8f286ebf4655ac019930d54607";
export const FIN016_CI_RECEIPT_DIGEST =
  "8870e564b300ad095f171ff672eecf908aec1b8477a578a5123b5a5c4d8d6a7a";
export const FIN016_ORIGIN_SEAL_SHA256 =
  "c1d820dd4f7780e991b196d168bf9e454c318f29a86cc9339878697e618fc2be";
export const FIN016_MIGRATION_COUNT = 102;
export const FIN016_LATEST_MIGRATION =
  "202608310149_hosted_joint_legal_v7_authority.sql";

export const FIN016_PRODUCTION_ROOT = "/home/simtech/sitesourcery-production";
export const FIN016_RELEASE_ROOT =
  `${FIN016_PRODUCTION_ROOT}/releases/${FIN016_CANDIDATE_COMMIT}`;
export const FIN016_NODE =
  `${FIN016_PRODUCTION_ROOT}/toolchain/node-v24.18.0-linux-x64/bin/node`;
export const FIN016_RUNTIME_DIRECTORY = "/run/sitesourcery";
export const FIN016_BACKUP_QUIESCE_PATH =
  `${FIN016_RUNTIME_DIRECTORY}/BACKUP_QUIESCE`;
export const FIN016_PREDECESSOR_ENVIRONMENT_PATH =
  `/etc/sitesourcery/hosted.env.${FIN016_INSTALLED_COMMIT}`;
export const FIN016_ENVIRONMENT_PATH =
  `/etc/sitesourcery/hosted.env.${FIN016_CANDIDATE_COMMIT}`;
export const FIN016_WRAPPER_PATH =
  `/etc/sitesourcery/api-and-tenant.${FIN016_CANDIDATE_COMMIT}.sh`;
export const FIN016_STAGING_PATH =
  `${FIN016_PRODUCTION_ROOT}/staging/fin016-${FIN016_CANDIDATE_COMMIT}-held`;
export const FIN016_ACTIVE_EVIDENCE = Object.freeze({
  epoch: "/etc/sitesourcery/final-release-epoch-v2.json",
  originSeal: "/etc/sitesourcery/origin-seal.json",
  installedReadback: "/etc/sitesourcery/origin-installed-readback.json"
});
export const FIN016_RETAINED_EVIDENCE = Object.freeze({
  epoch:
    `/etc/sitesourcery/fin016-${FIN016_CANDIDATE_COMMIT}-final-release-epoch-v2.json`,
  originSeal:
    `/etc/sitesourcery/fin016-${FIN016_CANDIDATE_COMMIT}-origin-seal.json`,
  installedReadback:
    `/etc/sitesourcery/fin016-${FIN016_CANDIDATE_COMMIT}-origin-installed-readback.json`
});
export const FIN016_SUCCESSOR_INPUT_RELATIVE_PATH =
  `ops/releases/ci-successor-inputs/${FIN016_CANDIDATE_COMMIT}.json`;
export const FIN016_CI_RECEIPT_RELATIVE_PATH =
  "ops/releases/fin016-copy-release-control/ci-held-final-receipt.json";

const DEFAULT_CONTROL_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const SHA256 = /^[a-f0-9]{64}$/u;
const GIT_SHA = /^[a-f0-9]{40}$/u;
const CONTROL_WINDOW_MS = 30 * 60 * 1000;
const BACKUP_MAXIMUM_AGE_MS = 60 * 60 * 1000;
const BUNDLE_MAXIMUM_AGE_MS = 60 * 60 * 1000;

const EXACT_INHERITED_MODES = Object.freeze({
  SITESOURCERY_ALAKAZAM_LIFECYCLE_MODE: "held",
  SITESOURCERY_ALAKAZAM_MODE: "held",
  SITESOURCERY_CUSTOM_BUILD_CHANGE_PAYMENT_MODE: "held",
  SITESOURCERY_CUSTOM_BUILD_FINAL_PAYMENT_MODE: "held",
  SITESOURCERY_CUSTOM_BUILD_PAYMENT_MODE: "held",
  SITESOURCERY_CUSTOM_SERVICES_ASSESSMENT_PAYMENT_MODE: "held",
  SITESOURCERY_DEPLOYMENT_ENVIRONMENT: "production",
  SITESOURCERY_DOWNLOAD_PAYMENT_MODE: "approved",
  SITESOURCERY_RESEND_WEBHOOK_MODE: "held",
  SITESOURCERY_STRIPE_LIVEMODE: "true",
  SITESOURCERY_STRIPE_MODE: "approved_live",
  SITESOURCERY_TWILIO_INBOUND_EVENT_MODE: "held",
  SITESOURCERY_TWILIO_RESPONDER_EVENT_MODE: "held",
  SITESOURCERY_TWILIO_VOICE_ACCESS_MODE: "held",
  SITESOURCERY_TWILIO_VOICE_DIAL_MODE: "held"
});

const LEGAL_V7_ENVIRONMENT = Object.freeze({
  SITESOURCERY_HOSTED_PRIVACY_V7_VERSION:
    "SS-HOSTED-PRIVACY-2026-08-31-V7",
  SITESOURCERY_HOSTED_PRIVACY_V7_SHA256:
    "084788116b8d59f2e75faedd7cfad5ea14f007782c2a84679287f0d064753b99",
  SITESOURCERY_HOSTED_PRIVACY_V7_URI:
    "https://sitesourcery.com/legal/privacy/versions/SS-HOSTED-PRIVACY-2026-08-31-V7/",
  SITESOURCERY_HOSTED_PRIVACY_V7_EFFECTIVE_AT: "2026-09-01T04:00:00.000Z",
  SITESOURCERY_HOSTED_PRIVACY_V7_BYTE_COUNT: "24139",
  SITESOURCERY_HOSTED_PRIVACY_V7_ARTIFACT_URI:
    "https://sitesourcery.com/legal/privacy/versions/SS-HOSTED-PRIVACY-2026-08-31-V7/",
  SITESOURCERY_HOSTED_WEBSITE_TERMS_V7_VERSION:
    "SS-HOSTED-WEBSITE-TERMS-2026-08-31-V7",
  SITESOURCERY_HOSTED_WEBSITE_TERMS_V7_SHA256:
    "f09386d70465ccd1f491c69efefe20f8c89ca9c46d03a7ac9f58990317adfd19",
  SITESOURCERY_HOSTED_WEBSITE_TERMS_V7_URI:
    "https://sitesourcery.com/legal/website-terms/versions/SS-HOSTED-WEBSITE-TERMS-2026-08-31-V7/",
  SITESOURCERY_HOSTED_WEBSITE_TERMS_V7_EFFECTIVE_AT:
    "2026-09-01T04:00:00.000Z",
  SITESOURCERY_HOSTED_WEBSITE_TERMS_V7_BYTE_COUNT: "27358",
  SITESOURCERY_HOSTED_WEBSITE_TERMS_V7_ARTIFACT_URI:
    "https://sitesourcery.com/legal/website-terms/versions/SS-HOSTED-WEBSITE-TERMS-2026-08-31-V7/",
  SITESOURCERY_HOSTED_LEGAL_V7_AUTHORITY_SHA256:
    "b03340aa7c62ea111a8aaefcb70222645500fcdea574f6cb7e3c942b38750b9b"
});

export const FIN016_STAGED_FILE_POLICY = Object.freeze([
  Object.freeze({
    name: "final-release-epoch-v2.json",
    mode: "0400",
    digestPolicy: "public_evidence_sha256"
  }),
  Object.freeze({
    name: "origin-seal.json",
    mode: "0400",
    digestPolicy: "public_evidence_sha256"
  }),
  Object.freeze({
    name: "origin-installed-readback.json",
    mode: "0400",
    digestPolicy: "public_evidence_sha256"
  }),
  Object.freeze({
    name: "hosted.env",
    mode: "0600",
    digestPolicy: "byte_compare_only_secret_no_digest"
  }),
  Object.freeze({
    name: "api-and-tenant.sh",
    mode: "0500",
    digestPolicy: "nonsecret_sha256"
  }),
  Object.freeze({
    name: "sitesourcery-production.service",
    mode: "0400",
    digestPolicy: "nonsecret_sha256"
  }),
  Object.freeze({
    name: "sitesourcery-production-static.service",
    mode: "0400",
    digestPolicy: "nonsecret_sha256"
  }),
  Object.freeze({
    name: "bundle-receipt.json",
    mode: "0400",
    digestPolicy: "public_evidence_sha256"
  })
]);

export const FIN016_CUTOVER_PHASES = Object.freeze([
  Object.freeze({
    name: "preflight",
    steps: Object.freeze([
      "verify_protected_git_ci_bundle_live_ready_and_rollback_authority",
      "verify_same_102_migrations_and_no_database_change",
      "verify_fresh_paired_encrypted_backup_and_all_new_effects_held"
    ])
  }),
  Object.freeze({
    name: "stage",
    steps: Object.freeze([
      "install_candidate_into_new_immutable_release_root_while_live",
      "install_candidate_specific_environment_wrapper_units_and_retained_evidence",
      "byte_compare_secret_environment_without_recording_a_digest",
      "verify_every_nonsecret_staged_byte_before_active_selection_changes"
    ])
  }),
  Object.freeze({
    name: "select_candidate",
    steps: Object.freeze([
      "acquire_single_production_operation_lock_and_pause_monitor_timer",
      "stop_origin_static_and_runtime_in_reviewed_order",
      "atomically_select_candidate_evidence_environment_wrapper_and_units",
      "reload_user_service_manager_and_start_runtime_static_origin_and_tunnel",
      "keep_worker_provider_payment_dns_legal_customer_and_publication_effects_held"
    ])
  }),
  Object.freeze({
    name: "prove_and_resume",
    steps: Object.freeze([
      "prove_direct_and_public_live_ready_and_exact_candidate_identity",
      "prove_same_102_migrations_legal_v7_matrix_v2_and_external_effects_false",
      "prove_plain_language_routes_redirects_assets_and_browser_authority",
      "resume_monitor_timer_and_run_one_monitor_cycle",
      "retain_exact_predecessor_release_environment_units_evidence_and_restore_pair"
    ])
  })
]);

export class Fin016CopyReleaseFailure extends Error {
  constructor(code, message) {
    super(message);
    this.name = "Fin016CopyReleaseFailure";
    this.code = code;
  }
}

function fail(code, message) {
  throw new Fin016CopyReleaseFailure(code, message);
}

function freeze(value) {
  if (ArrayBuffer.isView(value)) return value;
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const entry of Object.values(value)) freeze(entry);
    Object.freeze(value);
  }
  return value;
}

function exact(value, expected, label) {
  if (value !== expected) {
    fail("FIN016_AUTHORITY_INVALID", `${label} drifted from exact FIN-016 authority.`);
  }
}

function exactObject(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())
  ) {
    fail("FIN016_AUTHORITY_INVALID", `${label} must contain only its exact fields.`);
  }
  return value;
}

function exactMap(actual, expected, label) {
  exact(canonicalJson(actual), canonicalJson(expected), label);
}

function digest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    fail("FIN016_AUTHORITY_INVALID", `${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function commit(value, label) {
  if (typeof value !== "string" || !GIT_SHA.test(value)) {
    fail("FIN016_AUTHORITY_INVALID", `${label} must be a lowercase Git SHA.`);
  }
  return value;
}

function instant(value, label) {
  const selected = new Date(value);
  if (
    typeof value !== "string" ||
    Number.isNaN(selected.valueOf()) ||
    selected.toISOString() !== value
  ) {
    fail("FIN016_OBSERVATION_INVALID", `${label} must be an exact ISO instant.`);
  }
  return selected.valueOf();
}

function jsonBytes(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

function fileEvidence(value) {
  const text = `${canonicalJson(value)}\n`;
  return freeze({
    text,
    byteCount: Buffer.byteLength(text),
    sha256: sha256Bytes(text)
  });
}

async function readExactJson(filePath, expectedSha256, label) {
  let handle;
  try {
    handle = await open(
      filePath,
      filesystemConstants.O_RDONLY | filesystemConstants.O_NOFOLLOW
    );
    const before = await handle.stat({ bigint: true });
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (
      !before.isFile() ||
      before.nlink !== 1n ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs ||
      BigInt(bytes.byteLength) !== before.size
    ) {
      fail("FIN016_AUTHORITY_FILE_INVALID", `${label} changed during its no-follow read.`);
    }
    exact(sha256Bytes(bytes), expectedSha256, `${label} file digest`);
    return parseJsonObject(bytes.toString("utf8"), label);
  } catch (error) {
    if (error instanceof Fin016CopyReleaseFailure) throw error;
    fail("FIN016_AUTHORITY_FILE_INVALID", `${label} is unavailable or unsafe.`);
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

async function defaultGitRunner(arguments_, projectRoot) {
  const result = await executeFile(
    "git",
    ["--no-replace-objects", "-c", "core.fsmonitor=false", ...arguments_],
    {
      cwd: projectRoot,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout: 60_000
    }
  );
  return result.stdout.trim();
}

async function requireGit(gitRunner, projectRoot, arguments_, label) {
  try {
    return await gitRunner(arguments_, projectRoot);
  } catch {
    fail("FIN016_GIT_AUTHORITY_INVALID", `${label} is unavailable or invalid.`);
  }
}

export async function verifyFin016ProductionControlRepository({
  controlRoot,
  productionControlCommitSha,
  productionControlTreeSha,
  gitRunner = defaultGitRunner
}) {
  commit(productionControlCommitSha, "Production-control commit");
  commit(productionControlTreeSha, "Production-control tree");
  const [head, tree, status] = await Promise.all([
    requireGit(gitRunner, controlRoot, ["rev-parse", "HEAD"], "Control HEAD"),
    requireGit(
      gitRunner,
      controlRoot,
      ["rev-parse", "HEAD^{tree}"],
      "Control tree"
    ),
    requireGit(
      gitRunner,
      controlRoot,
      ["status", "--porcelain=v1", "--untracked-files=no"],
      "Control status"
    )
  ]);
  exact(head, productionControlCommitSha, "Production-control HEAD");
  exact(tree, productionControlTreeSha, "Production-control tree");
  exact(status, "", "Production-control tracked status");
  await requireGit(
    gitRunner,
    controlRoot,
    ["merge-base", "--is-ancestor", FIN016_CANDIDATE_COMMIT, head],
    "Candidate ancestry"
  );
  return freeze({ commitSha: head, treeSha: tree });
}

function environmentText(values) {
  return [
    "# FIN-016 exact copy-only production-held environment",
    "# Root-owned mode 0600. Values are never printed or committed.",
    ...[...values.keys()].sort().map((name) => `${name}=${values.get(name)}`),
    ""
  ].join("\n");
}

function assertExactFin016Environment(values) {
  exact(
    canonicalJson([...values.keys()].sort()),
    canonicalJson(FIN015_EXPECTED_ENVIRONMENT_NAMES),
    "Production environment name inventory"
  );
  for (const [name, expected] of Object.entries(EXACT_INHERITED_MODES)) {
    exact(
      readFin010EnvironmentValue(values, name, "FIN-016 predecessor environment"),
      expected,
      name
    );
  }
  for (const [name, expected] of Object.entries(LEGAL_V7_ENVIRONMENT)) {
    exact(
      readFin010EnvironmentValue(values, name, "FIN-016 predecessor environment"),
      expected,
      name
    );
  }
  for (const name of values.keys()) {
    if (
      name.startsWith("SITESOURCERY_TWILIO_") &&
      !Object.hasOwn(EXACT_INHERITED_MODES, name)
    ) {
      fail(
        "FIN016_HELD_PROVIDER_SECRET_PRESENT",
        `${name} cannot enter a copy-only release while Twilio remains held.`
      );
    }
  }
  for (const name of [
    "SITESOURCERY_DATABASE_URL",
    "SITESOURCERY_DATABASE_SSL",
    "SITESOURCERY_IDENTITY_PEPPER",
    "SITESOURCERY_IDENTITY_PEPPER_CONFIG",
    "SITESOURCERY_ENGAGEMENT_TOKEN_SECRET",
    "SITESOURCERY_CONTACT_VAULT_KEY",
    "SITESOURCERY_CREDENTIAL_TOPOLOGY_JSON",
    "SITESOURCERY_POSTGRES_BUDGET_CONFIG",
    "SITESOURCERY_PUBLICATION_COMMAND_TOKEN",
    "SITESOURCERY_RESEND_API_KEY",
    "SITESOURCERY_STRIPE_APPROVAL_JSON",
    "SITESOURCERY_STRIPE_CREDENTIAL_ACTIVATION_RECEIPT_JSON",
    "SITESOURCERY_STRIPE_SECRET_KEY",
    "SITESOURCERY_STRIPE_WEBHOOK_SECRET",
    "SITESOURCERY_RELEASE_EPOCH_FILE",
    "SITESOURCERY_RELEASE_EPOCH_SHA256",
    "SITESOURCERY_ORIGIN_SEAL_FILE",
    "SITESOURCERY_ORIGIN_SEAL_FILE_SHA256",
    "SITESOURCERY_ORIGIN_INSTALLED_READBACK_FILE",
    "SITESOURCERY_ORIGIN_INSTALLED_READBACK_FILE_SHA256"
  ]) {
    readFin010EnvironmentValue(values, name, "FIN-016 predecessor environment");
  }
}

export function createFin016HostedEnvironment({
  predecessorEnvironmentText,
  evidence
}) {
  const values = parseFin010EnvironmentFile(
    predecessorEnvironmentText,
    "FIN-016 predecessor production environment"
  );
  assertExactFin016Environment(values);
  for (const [name, entry] of Object.entries({
    SITESOURCERY_RELEASE_EPOCH_FILE: FIN016_ACTIVE_EVIDENCE.epoch,
    SITESOURCERY_RELEASE_EPOCH_SHA256: evidence.epoch.sha256,
    SITESOURCERY_ORIGIN_SEAL_FILE: FIN016_ACTIVE_EVIDENCE.originSeal,
    SITESOURCERY_ORIGIN_SEAL_FILE_SHA256: evidence.originSeal.sha256,
    SITESOURCERY_ORIGIN_INSTALLED_READBACK_FILE:
      FIN016_ACTIVE_EVIDENCE.installedReadback,
    SITESOURCERY_ORIGIN_INSTALLED_READBACK_FILE_SHA256:
      evidence.installedReadback.sha256,
    SITESOURCERY_REGISTRATION_TRANSPORT_MODULE:
      `${FIN016_RELEASE_ROOT}/server/hosted/resend-mail-transport.mjs`,
    SITESOURCERY_RECOVERY_TRANSPORT_MODULE:
      `${FIN016_RELEASE_ROOT}/server/hosted/resend-mail-transport.mjs`
  })) {
    if (name.endsWith("_SHA256") && !SHA256.test(entry)) {
      fail("FIN016_EVIDENCE_INVALID", `${name} must bind exact evidence.`);
    }
    values.set(name, entry);
  }
  assertExactFin016Environment(values);
  return freeze({
    text: environmentText(values),
    nameCount: values.size,
    legal: {
      privacyVersion: LEGAL_V7_ENVIRONMENT.SITESOURCERY_HOSTED_PRIVACY_V7_VERSION,
      websiteTermsVersion:
        LEGAL_V7_ENVIRONMENT.SITESOURCERY_HOSTED_WEBSITE_TERMS_V7_VERSION,
      authorityDigest:
        LEGAL_V7_ENVIRONMENT.SITESOURCERY_HOSTED_LEGAL_V7_AUTHORITY_SHA256
    },
    providers: {
      registrationMail: "production_existing_approved",
      recoveryMail: "production_existing_approved",
      resendWebhook: "held",
      stripe: "approved_live_download_only_existing_authority",
      twilio: "held_no_registry_or_secret_loaded",
      domains: "held",
      alakazam: "held",
      publication: "held",
      workers: "retained_disabled_held"
    },
    secretValuesDisclosed: false,
    secretDerivedDigestsRecorded: false
  });
}

export async function verifyFin016RuntimeAuthorities({
  controlRoot,
  candidateRoot,
  productionControlCommitSha,
  productionControlTreeSha,
  candidateGitRunner,
  controlGitRunner
}) {
  const successorInput = validateCiReleaseSuccessorInput(
    await readExactJson(
      path.join(controlRoot, FIN016_SUCCESSOR_INPUT_RELATIVE_PATH),
      FIN016_SUCCESSOR_INPUT_SHA256,
      "FIN-016 successor input"
    )
  );
  const ciFinalReceipt = validateCiReleaseFinalReceipt(
    await readExactJson(
      path.join(controlRoot, FIN016_CI_RECEIPT_RELATIVE_PATH),
      FIN016_CI_RECEIPT_FILE_SHA256,
      "FIN-016 held CI final receipt"
    )
  );
  exact(successorInput.digest, FIN016_SUCCESSOR_INPUT_DIGEST, "Successor input");
  exact(ciFinalReceipt.digest, FIN016_CI_RECEIPT_DIGEST, "Held CI receipt");
  exact(ciFinalReceipt.candidateSha, FIN016_CANDIDATE_COMMIT, "Held candidate");
  exact(ciFinalReceipt.workflowSha, FIN016_HELD_CONTROL_COMMIT, "Held workflow");
  exact(
    successorInput.originReleaseInput.epoch.source.treeSha,
    FIN016_CANDIDATE_TREE,
    "Candidate tree"
  );
  exact(
    successorInput.originReleaseInput.epoch.artifact.manifestSha256,
    FIN016_CANDIDATE_ARTIFACT_MANIFEST_SHA256,
    "Candidate artifact"
  );
  exact(
    successorInput.originReleaseInput.epoch.rollback.predecessorCommitSha,
    FIN016_INSTALLED_COMMIT,
    "Installed predecessor"
  );
  exact(
    successorInput.originReleaseInput.epoch.rollback.predecessorTreeSha,
    FIN016_INSTALLED_TREE,
    "Installed predecessor tree"
  );
  exact(
    successorInput.originReleaseInput.epoch.rollback
      .predecessorArtifactManifestSha256,
    FIN016_INSTALLED_ARTIFACT_MANIFEST_SHA256,
    "Installed predecessor artifact"
  );
  exact(
    successorInput.migrationInventory.count,
    FIN016_MIGRATION_COUNT,
    "Migration count"
  );
  exact(
    successorInput.migrationInventory.manifestSha256,
    FIN015_SUCCESSOR_MIGRATION_MANIFEST_SHA256,
    "Migration manifest"
  );
  const productionControl = await verifyFin016ProductionControlRepository({
    controlRoot,
    productionControlCommitSha,
    productionControlTreeSha,
    ...(controlGitRunner ? { gitRunner: controlGitRunner } : {})
  });
  await verifyCiReleaseCandidate({
    projectRoot: candidateRoot,
    successorInput,
    ...(candidateGitRunner ? { gitRunner: candidateGitRunner } : {})
  });
  const originSeal = await verifyOriginReleaseRepository({
    projectRoot: candidateRoot,
    releaseInput: successorInput.originReleaseInput,
    ...(candidateGitRunner ? { gitRunner: candidateGitRunner } : {})
  });
  exact(originSeal.sealSha256, FIN016_ORIGIN_SEAL_SHA256, "Origin seal");
  return freeze({
    successorInput,
    ciFinalReceipt,
    originSeal,
    productionControl
  });
}

export function createFin016Wrapper() {
  return `#!/bin/bash
set -euo pipefail

root=${FIN016_PRODUCTION_ROOT}
release=${FIN016_RELEASE_ROOT}
node=${FIN016_NODE}
api_pid=
tenant_pid=

stop_children() {
  if test -n "\${api_pid:-}"; then kill -TERM "$api_pid" 2>/dev/null || true; fi
  if test -n "\${tenant_pid:-}"; then kill -TERM "$tenant_pid" 2>/dev/null || true; fi
  if test -n "\${api_pid:-}"; then wait "$api_pid" 2>/dev/null || true; fi
  if test -n "\${tenant_pid:-}"; then wait "$tenant_pid" 2>/dev/null || true; fi
}
trap stop_children EXIT INT TERM

test -d "${FIN016_RUNTIME_DIRECTORY}"
test ! -L "${FIN016_RUNTIME_DIRECTORY}"
test "$(stat -c '%U:%G:%a' "${FIN016_RUNTIME_DIRECTORY}")" = "root:simtech:770"
"$node" "$release/server/hosted/bin/server.mjs" &
api_pid=$!
for _attempt in $(seq 1 300); do
  if test -d "$root/state/tenant-runtime/releases"; then break; fi
  if ! kill -0 "$api_pid" 2>/dev/null; then wait "$api_pid"; exit $?; fi
  sleep 0.1
done
test -d "$root/state/tenant-runtime/releases"
env \
  SITESOURCERY_DATA_ROOT="$root/state/tenant-runtime" \
  SITESOURCERY_TENANT_HOST=127.0.0.1 \
  SITESOURCERY_TENANT_PORT=8080 \
  SITESOURCERY_CONTROL_HOST=127.0.0.1 \
  "$node" "$release/server/selfhost/bin/server.mjs" &
tenant_pid=$!

wait -n "$api_pid" "$tenant_pid"
status=$?
exit "$status"
`;
}

export function createFin016UserUnitSet({ evidence }) {
  for (const name of ["epoch", "originSeal", "installedReadback"]) {
    if (!SHA256.test(evidence?.[name]?.sha256 ?? "")) {
      fail("FIN016_EVIDENCE_INVALID", `FIN-016 ${name} evidence is invalid.`);
    }
  }
  const verify =
    `${FIN016_NODE} ${FIN016_RELEASE_ROOT}/ops/verify-final-release-epoch-v2.mjs` +
    ` --epoch ${FIN016_ACTIVE_EVIDENCE.epoch}` +
    ` --epoch-sha256 ${evidence.epoch.sha256}` +
    ` --origin-seal ${FIN016_ACTIVE_EVIDENCE.originSeal}` +
    ` --origin-seal-sha256 ${evidence.originSeal.sha256}` +
    ` --installed-readback ${FIN016_ACTIVE_EVIDENCE.installedReadback}` +
    ` --installed-readback-sha256 ${evidence.installedReadback.sha256}`;
  const runtime = `[Unit]
Description=Site Sourcery FIN-016 exact copy-only production-held API and tenant runtime
After=network-online.target sitesourcery-production-db-tunnel.service
Wants=network-online.target
Requires=sitesourcery-production-db-tunnel.service
ConditionPathExists=${FIN016_PRODUCTION_ROOT}/run/RUNTIME_APPROVED
ConditionPathExists=!${FIN016_BACKUP_QUIESCE_PATH}
ConditionPathExists=!%t/sitesourcery-production/BACKUP_QUIESCE

[Service]
Type=simple
WorkingDirectory=${FIN016_RELEASE_ROOT}
Environment=NODE_ENV=production
EnvironmentFile=${FIN016_ENVIRONMENT_PATH}
ExecStartPre=${FIN016_NODE} ${FIN016_RELEASE_ROOT}/server/hosted/assert-runtime.mjs
ExecStartPre=+${verify}
ExecStart=+${FIN016_WRAPPER_PATH}
Restart=on-failure
RestartSec=3
SuccessExitStatus=143
TimeoutStartSec=45
TimeoutStopSec=30
KillSignal=SIGTERM
KillMode=control-group
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=read-only
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
RestrictNamespaces=true
LockPersonality=true
CapabilityBoundingSet=
AmbientCapabilities=
ReadOnlyPaths=${FIN016_RELEASE_ROOT} ${FIN016_NODE.replace(/\/bin\/node$/u, "")} /etc/sitesourcery
ReadWritePaths=${FIN016_PRODUCTION_ROOT}/state ${FIN016_PRODUCTION_ROOT}/run ${FIN016_RUNTIME_DIRECTORY}
LimitNOFILE=8192
TasksMax=256

[Install]
WantedBy=default.target
`;
  const staticUnit = `[Unit]
Description=Site Sourcery FIN-016 exact immutable plain-language production artifact
After=network-online.target sitesourcery-production.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${FIN016_RELEASE_ROOT}/_hosted
ExecStart=/usr/bin/python3 -m http.server 8899 --bind 127.0.0.1 --directory ${FIN016_RELEASE_ROOT}/_hosted
Restart=on-failure
RestartSec=2
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=read-only
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
RestrictNamespaces=true
CapabilityBoundingSet=
AmbientCapabilities=
ReadOnlyPaths=${FIN016_RELEASE_ROOT}/_hosted

[Install]
WantedBy=default.target
`;
  return freeze({
    "sitesourcery-production.service": runtime,
    "sitesourcery-production-static.service": staticUnit
  });
}

function bundleReceiptPayload(receipt) {
  return {
    schema: receipt.schema,
    state: receipt.state,
    observedAt: receipt.observedAt,
    source: receipt.source,
    proof: receipt.proof,
    evidence: receipt.evidence,
    runtime: receipt.runtime,
    authority: receipt.authority
  };
}

export function fin016BundleReceiptDigest(receipt) {
  return sha256Bytes(`${canonicalJson(bundleReceiptPayload(receipt))}\n`);
}

export function fin016BundleReceiptFileSha256(receipt) {
  return sha256Bytes(`${canonicalJson(receipt)}\n`);
}

export async function createFin016ProductionBundle({
  controlRoot,
  candidateRoot,
  predecessorEnvironmentText,
  observedAt,
  productionControlCommitSha,
  productionControlTreeSha,
  candidateGitRunner,
  controlGitRunner
}) {
  instant(observedAt, "Bundle observedAt");
  const authorities = await verifyFin016RuntimeAuthorities({
    controlRoot,
    candidateRoot,
    productionControlCommitSha,
    productionControlTreeSha,
    ...(candidateGitRunner ? { candidateGitRunner } : {}),
    ...(controlGitRunner ? { controlGitRunner } : {})
  });
  const installedReadback = createOriginInstalledReadback({
    seal: authorities.originSeal,
    observedAt,
    identity: expectedOriginInstalledIdentity(authorities.originSeal),
    worker: expectedOriginInstalledWorker(authorities.originSeal),
    listeners: structuredClone(ORIGIN_LOOPBACK_EXPECTATIONS),
    authority: structuredClone(ORIGIN_HELD_AUTHORITY)
  });
  const epoch = createHeldFinalReleaseEpochV2({
    successorInput: authorities.successorInput,
    ciFinalReceipt: authorities.ciFinalReceipt,
    originSeal: authorities.originSeal,
    installedReadback
  });
  const evidence = freeze({
    epoch: fileEvidence(epoch),
    originSeal: fileEvidence(authorities.originSeal),
    installedReadback: fileEvidence(installedReadback)
  });
  const environment = createFin016HostedEnvironment({
    predecessorEnvironmentText,
    evidence
  });
  const wrapper = createFin016Wrapper();
  const units = createFin016UserUnitSet({ evidence });
  const payload = {
    schema: FIN016_BUNDLE_SCHEMA,
    state: "prepared_held_copy_only_no_install",
    observedAt,
    source: {
      installedCommitSha: FIN016_INSTALLED_COMMIT,
      installedTreeSha: FIN016_INSTALLED_TREE,
      candidateCommitSha: FIN016_CANDIDATE_COMMIT,
      candidateTreeSha: FIN016_CANDIDATE_TREE,
      heldControlCommitSha: FIN016_HELD_CONTROL_COMMIT,
      heldControlTreeSha: FIN016_HELD_CONTROL_TREE,
      productionControlCommitSha: authorities.productionControl.commitSha,
      productionControlTreeSha: authorities.productionControl.treeSha
    },
    proof: {
      successorInputFileSha256: FIN016_SUCCESSOR_INPUT_SHA256,
      successorInputDigest: FIN016_SUCCESSOR_INPUT_DIGEST,
      ciFinalReceiptFileSha256: FIN016_CI_RECEIPT_FILE_SHA256,
      ciFinalReceiptDigest: FIN016_CI_RECEIPT_DIGEST,
      ciRunId: authorities.ciFinalReceipt.runId,
      ciRunAttempt: authorities.ciFinalReceipt.runAttempt,
      originSealSha256: authorities.originSeal.sealSha256,
      migrationCount: FIN016_MIGRATION_COUNT,
      migrationManifestSha256: FIN015_SUCCESSOR_MIGRATION_MANIFEST_SHA256,
      migrationDelta: []
    },
    evidence: Object.fromEntries(
      Object.entries(evidence).map(([name, entry]) => [
        name,
        {
          byteCount: entry.byteCount,
          sha256: entry.sha256,
          retainedPath: FIN016_RETAINED_EVIDENCE[name],
          activePath: FIN016_ACTIVE_EVIDENCE[name]
        }
      ])
    ),
    runtime: {
      releaseRoot: FIN016_RELEASE_ROOT,
      node: FIN016_NODE,
      environmentPath: FIN016_ENVIRONMENT_PATH,
      wrapperPath: FIN016_WRAPPER_PATH,
      environmentNameCount: environment.nameCount,
      legal: environment.legal,
      providers: environment.providers
    },
    authority: {
      bundlePreparationAuthorized: true,
      releaseInstallationAuthorized: false,
      databaseMutationAuthorized: false,
      serviceSwitchAuthorized: false,
      publicRuntimeCutoverAuthorized: false,
      providerEffectsAuthorized: false,
      paymentEffectsAuthorized: false,
      dnsEffectsAuthorized: false,
      legalAcceptanceAuthorized: false,
      customerEffectsAuthorized: false,
      publicationEffectsAuthorized: false,
      workerActivationAuthorized: false,
      retirementAuthorized: false
    }
  };
  const receipt = freeze({
    ...payload,
    digest: fin016BundleReceiptDigest(payload)
  });
  return freeze({
    receipt,
    successorInput: authorities.successorInput,
    ciFinalReceipt: authorities.ciFinalReceipt,
    originSeal: authorities.originSeal,
    installedReadback,
    epoch,
    evidence,
    environment,
    wrapper,
    units
  });
}

export function validateFin016BundleReceipt(receipt) {
  exactObject(
    receipt,
    [
      "schema",
      "state",
      "observedAt",
      "source",
      "proof",
      "evidence",
      "runtime",
      "authority",
      "digest"
    ],
    "FIN-016 bundle receipt"
  );
  exact(receipt.schema, FIN016_BUNDLE_SCHEMA, "Bundle schema");
  exact(receipt.state, "prepared_held_copy_only_no_install", "Bundle state");
  instant(receipt.observedAt, "Bundle observedAt");
  exactObject(
    receipt.source,
    [
      "installedCommitSha",
      "installedTreeSha",
      "candidateCommitSha",
      "candidateTreeSha",
      "heldControlCommitSha",
      "heldControlTreeSha",
      "productionControlCommitSha",
      "productionControlTreeSha"
    ],
    "Bundle source"
  );
  for (const [field, expected] of Object.entries({
    installedCommitSha: FIN016_INSTALLED_COMMIT,
    installedTreeSha: FIN016_INSTALLED_TREE,
    candidateCommitSha: FIN016_CANDIDATE_COMMIT,
    candidateTreeSha: FIN016_CANDIDATE_TREE,
    heldControlCommitSha: FIN016_HELD_CONTROL_COMMIT,
    heldControlTreeSha: FIN016_HELD_CONTROL_TREE
  })) {
    exact(receipt.source[field], expected, `Bundle source ${field}`);
  }
  commit(receipt.source.productionControlCommitSha, "Bundle production control");
  commit(receipt.source.productionControlTreeSha, "Bundle production tree");
  exactObject(
    receipt.proof,
    [
      "successorInputFileSha256",
      "successorInputDigest",
      "ciFinalReceiptFileSha256",
      "ciFinalReceiptDigest",
      "ciRunId",
      "ciRunAttempt",
      "originSealSha256",
      "migrationCount",
      "migrationManifestSha256",
      "migrationDelta"
    ],
    "Bundle proof"
  );
  for (const [field, expected] of Object.entries({
    successorInputFileSha256: FIN016_SUCCESSOR_INPUT_SHA256,
    successorInputDigest: FIN016_SUCCESSOR_INPUT_DIGEST,
    ciFinalReceiptFileSha256: FIN016_CI_RECEIPT_FILE_SHA256,
    ciFinalReceiptDigest: FIN016_CI_RECEIPT_DIGEST,
    ciRunId: "33576768242",
    ciRunAttempt: "1",
    originSealSha256: FIN016_ORIGIN_SEAL_SHA256,
    migrationCount: FIN016_MIGRATION_COUNT,
    migrationManifestSha256: FIN015_SUCCESSOR_MIGRATION_MANIFEST_SHA256
  })) {
    exact(receipt.proof[field], expected, `Bundle proof ${field}`);
  }
  exactMap(receipt.proof.migrationDelta, [], "Bundle migration delta");
  exactObject(
    receipt.evidence,
    ["epoch", "originSeal", "installedReadback"],
    "Bundle evidence"
  );
  for (const name of ["epoch", "originSeal", "installedReadback"]) {
    const entry = exactObject(
      receipt.evidence[name],
      ["byteCount", "sha256", "retainedPath", "activePath"],
      `Bundle evidence ${name}`
    );
    if (!Number.isSafeInteger(entry.byteCount) || entry.byteCount < 2) {
      fail("FIN016_AUTHORITY_INVALID", `Bundle evidence ${name} byte count is invalid.`);
    }
    digest(entry.sha256, `Bundle evidence ${name}`);
    exact(entry.retainedPath, FIN016_RETAINED_EVIDENCE[name], `${name} retained path`);
    exact(entry.activePath, FIN016_ACTIVE_EVIDENCE[name], `${name} active path`);
  }
  exactObject(
    receipt.runtime,
    [
      "releaseRoot",
      "node",
      "environmentPath",
      "wrapperPath",
      "environmentNameCount",
      "legal",
      "providers"
    ],
    "Bundle runtime"
  );
  for (const [field, expected] of Object.entries({
    releaseRoot: FIN016_RELEASE_ROOT,
    node: FIN016_NODE,
    environmentPath: FIN016_ENVIRONMENT_PATH,
    wrapperPath: FIN016_WRAPPER_PATH,
    environmentNameCount: FIN015_EXPECTED_ENVIRONMENT_NAMES.length
  })) {
    exact(receipt.runtime[field], expected, `Bundle runtime ${field}`);
  }
  exactMap(
    receipt.runtime.legal,
    {
      privacyVersion: "SS-HOSTED-PRIVACY-2026-08-31-V7",
      websiteTermsVersion: "SS-HOSTED-WEBSITE-TERMS-2026-08-31-V7",
      authorityDigest:
        "b03340aa7c62ea111a8aaefcb70222645500fcdea574f6cb7e3c942b38750b9b"
    },
    "Bundle Legal V7 authority"
  );
  exactMap(
    receipt.runtime.providers,
    {
      registrationMail: "production_existing_approved",
      recoveryMail: "production_existing_approved",
      resendWebhook: "held",
      stripe: "approved_live_download_only_existing_authority",
      twilio: "held_no_registry_or_secret_loaded",
      domains: "held",
      alakazam: "held",
      publication: "held",
      workers: "retained_disabled_held"
    },
    "Bundle provider boundary"
  );
  exactMap(
    receipt.authority,
    {
      bundlePreparationAuthorized: true,
      releaseInstallationAuthorized: false,
      databaseMutationAuthorized: false,
      serviceSwitchAuthorized: false,
      publicRuntimeCutoverAuthorized: false,
      providerEffectsAuthorized: false,
      paymentEffectsAuthorized: false,
      dnsEffectsAuthorized: false,
      legalAcceptanceAuthorized: false,
      customerEffectsAuthorized: false,
      publicationEffectsAuthorized: false,
      workerActivationAuthorized: false,
      retirementAuthorized: false
    },
    "Bundle held authority"
  );
  exact(receipt.digest, fin016BundleReceiptDigest(receipt), "Bundle digest");
  return freeze(structuredClone(receipt));
}

async function writeExclusive(filePath, bytes, mode) {
  const handle = await open(filePath, "wx", mode);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(filePath, mode);
}

export async function prepareFin016ProductionBundle({
  controlRoot = DEFAULT_CONTROL_ROOT,
  candidateRoot,
  predecessorEnvironmentPath,
  outputPath,
  observedAt,
  productionControlCommitSha,
  productionControlTreeSha,
  candidateGitRunner,
  controlGitRunner
}) {
  for (const [name, selected] of Object.entries({
    controlRoot,
    candidateRoot,
    predecessorEnvironmentPath,
    outputPath
  })) {
    if (typeof selected !== "string" || !path.isAbsolute(selected)) {
      fail("FIN016_ARGUMENTS_INVALID", `${name} must be absolute.`);
    }
  }
  const parent = path.dirname(path.resolve(outputPath));
  const parentMetadata = await lstat(parent);
  if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink()) {
    fail("FIN016_OUTPUT_INVALID", "FIN-016 output parent must be a real directory.");
  }
  const bundle = await createFin016ProductionBundle({
    controlRoot: path.resolve(controlRoot),
    candidateRoot: path.resolve(candidateRoot),
    predecessorEnvironmentText: await readFile(
      path.resolve(predecessorEnvironmentPath),
      "utf8"
    ),
    observedAt,
    productionControlCommitSha,
    productionControlTreeSha,
    ...(candidateGitRunner ? { candidateGitRunner } : {}),
    ...(controlGitRunner ? { controlGitRunner } : {})
  });
  const selectedOutput = path.resolve(outputPath);
  await mkdir(selectedOutput, { mode: 0o700 });
  try {
    const files = [
      ["final-release-epoch-v2.json", Buffer.from(bundle.evidence.epoch.text), 0o400],
      ["origin-seal.json", Buffer.from(bundle.evidence.originSeal.text), 0o400],
      [
        "origin-installed-readback.json",
        Buffer.from(bundle.evidence.installedReadback.text),
        0o400
      ],
      ["hosted.env", Buffer.from(bundle.environment.text), 0o600],
      ["api-and-tenant.sh", Buffer.from(bundle.wrapper), 0o500],
      [
        "sitesourcery-production.service",
        Buffer.from(bundle.units["sitesourcery-production.service"]),
        0o400
      ],
      [
        "sitesourcery-production-static.service",
        Buffer.from(bundle.units["sitesourcery-production-static.service"]),
        0o400
      ],
      ["bundle-receipt.json", jsonBytes(bundle.receipt), 0o400]
    ];
    for (const [name, bytes, mode] of files) {
      await writeExclusive(path.join(selectedOutput, name), bytes, mode);
    }
  } catch (error) {
    await rm(selectedOutput, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  return freeze({
    schema: FIN016_RUNTIME_SCHEMA,
    ok: true,
    state: bundle.receipt.state,
    outputPath: selectedOutput,
    receiptDigest: bundle.receipt.digest,
    candidateCommitSha: FIN016_CANDIDATE_COMMIT,
    candidateTreeSha: FIN016_CANDIDATE_TREE,
    productionControlCommitSha,
    productionControlTreeSha,
    secretValuesDisclosed: false,
    secretDerivedDigestsRecorded: false,
    databaseEffects: false,
    installEffects: false,
    providerEffects: false,
    paymentEffects: false,
    publicEffects: false,
    filesWritten: 8
  });
}

function validateStagedFiles(files, receipt) {
  if (!Array.isArray(files) || files.length !== FIN016_STAGED_FILE_POLICY.length) {
    fail("FIN016_CONTROL_INVALID", "The staged bundle must contain exactly eight files.");
  }
  const evidenceDigests = new Map([
    ["final-release-epoch-v2.json", receipt.evidence.epoch.sha256],
    ["origin-seal.json", receipt.evidence.originSeal.sha256],
    ["origin-installed-readback.json", receipt.evidence.installedReadback.sha256],
    ["bundle-receipt.json", fin016BundleReceiptFileSha256(receipt)]
  ]);
  for (let index = 0; index < FIN016_STAGED_FILE_POLICY.length; index += 1) {
    const expected = FIN016_STAGED_FILE_POLICY[index];
    const entry = exactObject(
      files[index],
      ["name", "mode", "digestPolicy", "sha256"],
      `Staged file ${index + 1}`
    );
    exactMap(
      { name: entry.name, mode: entry.mode, digestPolicy: entry.digestPolicy },
      expected,
      `Staged file ${index + 1} policy`
    );
    if (entry.digestPolicy === "byte_compare_only_secret_no_digest") {
      exact(entry.sha256, null, "Secret environment digest absence");
    } else {
      digest(entry.sha256, `Staged file ${entry.name}`);
    }
    if (evidenceDigests.has(entry.name)) {
      exact(entry.sha256, evidenceDigests.get(entry.name), `Staged ${entry.name}`);
    }
  }
}

export function validateFin016CutoverControl(
  control,
  { now = Date.now(), bundleReceipt } = {}
) {
  const bundle = validateFin016BundleReceipt(bundleReceipt);
  exactObject(
    control,
    [
      "schema",
      "state",
      "createdAt",
      "expiresAt",
      "source",
      "owner",
      "predecessor",
      "backup",
      "bundle",
      "successor",
      "authority"
    ],
    "FIN-016 cutover control"
  );
  exact(control.schema, FIN016_CONTROL_SCHEMA, "Control schema");
  exact(control.state, "authorized_exact_fin016_copy_release", "Control state");
  const createdAt = instant(control.createdAt, "Control createdAt");
  const expiresAt = instant(control.expiresAt, "Control expiresAt");
  if (
    createdAt > now + 60_000 ||
    expiresAt <= now ||
    expiresAt - createdAt > CONTROL_WINDOW_MS
  ) {
    fail("FIN016_CONTROL_EXPIRED", "The FIN-016 control is outside its 30-minute window.");
  }
  const bundleObservedAt = instant(bundle.observedAt, "Bundle observedAt");
  if (
    bundleObservedAt > createdAt ||
    createdAt - bundleObservedAt > BUNDLE_MAXIMUM_AGE_MS
  ) {
    fail("FIN016_BUNDLE_STALE", "The prepared FIN-016 bundle is not fresh.");
  }

  exactObject(
    control.source,
    [
      "installedCommitSha",
      "installedTreeSha",
      "installedEpoch",
      "candidateCommitSha",
      "candidateTreeSha",
      "heldControlCommitSha",
      "heldControlTreeSha",
      "productionControlCommitSha",
      "productionControlTreeSha",
      "originSealSha256"
    ],
    "Control source"
  );
  exactMap(
    control.source,
    {
      installedCommitSha: FIN016_INSTALLED_COMMIT,
      installedTreeSha: FIN016_INSTALLED_TREE,
      installedEpoch: FIN016_INSTALLED_EPOCH,
      candidateCommitSha: FIN016_CANDIDATE_COMMIT,
      candidateTreeSha: FIN016_CANDIDATE_TREE,
      heldControlCommitSha: FIN016_HELD_CONTROL_COMMIT,
      heldControlTreeSha: FIN016_HELD_CONTROL_TREE,
      productionControlCommitSha: bundle.source.productionControlCommitSha,
      productionControlTreeSha: bundle.source.productionControlTreeSha,
      originSealSha256: FIN016_ORIGIN_SEAL_SHA256
    },
    "Control source"
  );
  exactMap(
    control.owner,
    {
      instruction: "owner_approved_all_safe_fin016_copy_release",
      reviewedPlainLanguageChange: true,
      reviewedNoDatabaseChange: true,
      reviewedRollbackRetention: true
    },
    "Owner action-time instruction"
  );

  exactObject(
    control.predecessor,
    [
      "publicLive",
      "publicReady",
      "commitSha",
      "treeSha",
      "epoch",
      "migrationCount",
      "latestMigration",
      "migrationManifestSha256",
      "tableCount",
      "schemaSha256",
      "matrixSchema",
      "capabilityCount",
      "processCount",
      "externalEffects",
      "services",
      "timers",
      "installedArtifactManifestSha256",
      "environmentPath",
      "rollbackRetained"
    ],
    "Control predecessor"
  );
  for (const [field, expected] of Object.entries({
    publicLive: true,
    publicReady: true,
    commitSha: FIN016_INSTALLED_COMMIT,
    treeSha: FIN016_INSTALLED_TREE,
    epoch: FIN016_INSTALLED_EPOCH,
    migrationCount: FIN016_MIGRATION_COUNT,
    latestMigration: FIN016_LATEST_MIGRATION,
    migrationManifestSha256: FIN015_SUCCESSOR_MIGRATION_MANIFEST_SHA256,
    tableCount: FIN015_SUCCESSOR_TABLE_COUNT,
    schemaSha256: FIN015_SUCCESSOR_SCHEMA_SHA256,
    matrixSchema: "sitesourcery.capability-process-matrix/v2",
    capabilityCount: 20,
    processCount: 6,
    externalEffects: false,
    installedArtifactManifestSha256: FIN016_INSTALLED_ARTIFACT_MANIFEST_SHA256,
    environmentPath: FIN016_PREDECESSOR_ENVIRONMENT_PATH,
    rollbackRetained: true
  })) {
    exact(control.predecessor[field], expected, `Predecessor ${field}`);
  }
  exactMap(
    control.predecessor.services,
    {
      runtime: "active",
      static: "active",
      origin: "active",
      tunnel: "active",
      databaseTunnel: "active",
      worker: "disabled"
    },
    "Predecessor services"
  );
  exactMap(
    control.predecessor.timers,
    { monitor: "active", backup: "active" },
    "Predecessor timers"
  );

  exactObject(
    control.backup,
    [
      "state",
      "completedAt",
      "manifestSha256",
      "databaseCiphertextSha256",
      "appStateCiphertextSha256",
      "destinationFailureDomainId",
      "plaintextRetained",
      "cleanRecoveryVerified",
      "rollbackPairReady",
      "dellZenHashesMatch",
      "providerEgressHeld"
    ],
    "Control backup"
  );
  exact(control.backup.state, "success", "Backup state");
  const completedAt = instant(control.backup.completedAt, "Backup completedAt");
  if (completedAt > createdAt || createdAt - completedAt > BACKUP_MAXIMUM_AGE_MS) {
    fail("FIN016_BACKUP_STALE", "The paired encrypted backup is not fresh.");
  }
  for (const field of [
    "manifestSha256",
    "databaseCiphertextSha256",
    "appStateCiphertextSha256"
  ]) {
    digest(control.backup[field], `Backup ${field}`);
  }
  exact(
    control.backup.destinationFailureDomainId,
    "zen-sitesourcery-backup-01",
    "Backup destination"
  );
  exact(control.backup.plaintextRetained, false, "Backup plaintext retention");
  for (const field of [
    "cleanRecoveryVerified",
    "rollbackPairReady",
    "dellZenHashesMatch",
    "providerEgressHeld"
  ]) {
    exact(control.backup[field], true, `Backup ${field}`);
  }

  exactObject(
    control.bundle,
    [
      "receiptDigest",
      "receiptFileSha256",
      "stagingPath",
      "fileCount",
      "files",
      "secretValuesDisclosed",
      "secretDerivedDigestsRecorded",
      "activeSelectionChanged"
    ],
    "Control bundle"
  );
  exact(control.bundle.receiptDigest, bundle.digest, "Bundle receipt digest");
  exact(
    control.bundle.receiptFileSha256,
    fin016BundleReceiptFileSha256(bundle),
    "Bundle receipt file digest"
  );
  exact(control.bundle.stagingPath, FIN016_STAGING_PATH, "Bundle staging path");
  exact(control.bundle.fileCount, 8, "Bundle file count");
  validateStagedFiles(control.bundle.files, bundle);
  exact(control.bundle.secretValuesDisclosed, false, "Bundle secret disclosure");
  exact(
    control.bundle.secretDerivedDigestsRecorded,
    false,
    "Bundle secret-derived digests"
  );
  exact(control.bundle.activeSelectionChanged, false, "Bundle active selection");

  exactObject(
    control.successor,
    [
      "databaseName",
      "migrationCount",
      "latestMigration",
      "migrationManifestSha256",
      "migrationDelta",
      "tableCount",
      "schemaSha256",
      "releaseRoot",
      "environmentPath",
      "wrapperPath",
      "legalVersion",
      "workerEnabled"
    ],
    "Control successor"
  );
  for (const [field, expected] of Object.entries({
    databaseName: "sitesourcery_production",
    migrationCount: FIN016_MIGRATION_COUNT,
    latestMigration: FIN016_LATEST_MIGRATION,
    migrationManifestSha256: FIN015_SUCCESSOR_MIGRATION_MANIFEST_SHA256,
    tableCount: FIN015_SUCCESSOR_TABLE_COUNT,
    schemaSha256: FIN015_SUCCESSOR_SCHEMA_SHA256,
    releaseRoot: FIN016_RELEASE_ROOT,
    environmentPath: FIN016_ENVIRONMENT_PATH,
    wrapperPath: FIN016_WRAPPER_PATH,
    legalVersion: "SS-HOSTED-WEBSITE-TERMS-2026-08-31-V7",
    workerEnabled: false
  })) {
    exact(control.successor[field], expected, `Successor ${field}`);
  }
  exactMap(control.successor.migrationDelta, [], "Successor migration delta");
  exactMap(
    control.authority,
    {
      stageInstallAuthorized: true,
      serviceSwitchAuthorized: true,
      publicRuntimeCutoverAuthorized: true,
      databaseMutationAuthorized: false,
      providerMutationAuthorized: false,
      paymentOrCheckoutAuthorized: false,
      customerMutationAuthorized: false,
      dnsMutationAuthorized: false,
      legalAcceptanceAuthorized: false,
      publicationEffectAuthorized: false,
      workerActivationAuthorized: false,
      retirementAuthorized: false
    },
    "Control authority"
  );
  return freeze({
    control: structuredClone(control),
    bundleReceipt: structuredClone(bundle)
  });
}

function planPayload(plan) {
  return {
    schema: plan.schema,
    state: plan.state,
    createdAt: plan.createdAt,
    expiresAt: plan.expiresAt,
    source: plan.source,
    controlDigest: plan.controlDigest,
    bundleReceiptDigest: plan.bundleReceiptDigest,
    phases: plan.phases,
    rollback: plan.rollback,
    authority: plan.authority,
    implementation: plan.implementation
  };
}

export function fin016CutoverPlanDigest(plan) {
  return sha256Bytes(`${canonicalJson(planPayload(plan))}\n`);
}

export function createFin016CutoverPlan({
  control,
  bundleReceipt,
  now = Date.now()
}) {
  const validated = validateFin016CutoverControl(control, {
    now,
    bundleReceipt
  });
  const payload = {
    schema: FIN016_PLAN_SCHEMA,
    state: "authorized_exact_copy_only_plan_no_effect_adapter",
    createdAt: validated.control.createdAt,
    expiresAt: validated.control.expiresAt,
    source: structuredClone(validated.control.source),
    controlDigest: sha256Bytes(`${canonicalJson(validated.control)}\n`),
    bundleReceiptDigest: validated.bundleReceipt.digest,
    phases: structuredClone(FIN016_CUTOVER_PHASES),
    rollback: {
      onAnyCandidateFailure:
        "restore_predecessor_active_evidence_environment_wrapper_units_and_services",
      databaseRestoreRequired: false,
      predecessorRetained: true,
      pairedEncryptedRestoreRetained: true,
      retirementAuthorized: false
    },
    authority: structuredClone(validated.control.authority),
    implementation: {
      effectAdapterPresent: false,
      commandsExecuted: false,
      filesystemEffects: false,
      databaseEffects: false,
      serviceEffects: false,
      publicEffects: false,
      providerEffects: false,
      secretValuesDisclosed: false,
      secretDerivedDigestsRecorded: false
    }
  };
  return freeze({ ...payload, digest: fin016CutoverPlanDigest(payload) });
}

function parseFlags(argv, expected) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (
      !/^--[a-z][a-z-]*$/u.test(flag ?? "") ||
      typeof value !== "string" ||
      values.has(flag)
    ) {
      fail("FIN016_ARGUMENTS_INVALID", "FIN-016 arguments are invalid or duplicated.");
    }
    values.set(flag, value);
  }
  if (canonicalJson([...values.keys()].sort()) !== canonicalJson([...expected].sort())) {
    fail("FIN016_ARGUMENTS_INVALID", "FIN-016 arguments are incomplete or unexpected.");
  }
  return values;
}

async function main(argv = process.argv.slice(2)) {
  const command = argv.shift();
  if (command === "bundle") {
    const values = parseFlags(argv, [
      "--candidate-root",
      "--control-root",
      "--observed-at",
      "--output",
      "--predecessor-environment",
      "--production-control-commit",
      "--production-control-tree"
    ]);
    process.stdout.write(
      `${canonicalJson(
        await prepareFin016ProductionBundle({
          controlRoot: values.get("--control-root"),
          candidateRoot: values.get("--candidate-root"),
          predecessorEnvironmentPath: values.get("--predecessor-environment"),
          outputPath: values.get("--output"),
          observedAt: values.get("--observed-at"),
          productionControlCommitSha: values.get("--production-control-commit"),
          productionControlTreeSha: values.get("--production-control-tree")
        })
      )}\n`
    );
    return;
  }
  if (command === "plan") {
    const values = parseFlags(argv, [
      "--bundle-receipt",
      "--control",
      "--observed-at"
    ]);
    const observedAt = values.get("--observed-at");
    instant(observedAt, "Plan observedAt");
    const control = parseJsonObject(
      await readFile(values.get("--control"), "utf8"),
      "FIN-016 action control"
    );
    const bundleReceipt = parseJsonObject(
      await readFile(values.get("--bundle-receipt"), "utf8"),
      "FIN-016 bundle receipt"
    );
    process.stdout.write(
      `${canonicalJson(
        createFin016CutoverPlan({
          control,
          bundleReceipt,
          now: Date.parse(observedAt)
        })
      )}\n`
    );
    return;
  }
  fail("FIN016_ARGUMENTS_INVALID", "FIN-016 command must be bundle or plan.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(
      `${canonicalJson({
        schema: FIN016_RUNTIME_SCHEMA,
        ok: false,
        code: error?.code ?? "FIN016_COPY_RELEASE_FAILED"
      })}\n`
    );
    process.exitCode = 1;
  });
}
