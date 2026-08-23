#!/usr/bin/env node

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
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  validateCiReleaseFinalReceipt,
  validateCiReleaseSuccessorInput
} from "./ci-release-proof-runtime.mjs";
import { createHeldFinalReleaseEpochV2 } from "./final-release-epoch-v2.mjs";
import {
  parseFin010EnvironmentFile,
  readFin010EnvironmentValue
} from "./fin010-production-runtime.mjs";
import {
  FIN012_STRIPE_DOWNLOAD_CANDIDATE_COMMIT as FIN012_DOWNLOAD_CHECKOUT_PREDECESSOR_COMMIT,
  FIN012_STRIPE_DOWNLOAD_CANDIDATE_TREE as FIN012_DOWNLOAD_CHECKOUT_PREDECESSOR_TREE,
  FIN012_STRIPE_DOWNLOAD_RELEASE_ROOT as FIN012_DOWNLOAD_CHECKOUT_PREDECESSOR_RELEASE_ROOT,
  createFin012StripeDownloadUserUnitSet,
  createFin012StripeDownloadWrapper
} from "./fin012-stripe-download-production-runtime.mjs";
import {
  canonicalJson,
  parseJsonObject,
  sha256Bytes
} from "./immutable-evidence.mjs";
import {
  ORIGIN_HELD_AUTHORITY,
  ORIGIN_LOOPBACK_EXPECTATIONS,
  createOriginInstalledReadback,
  expectedOriginInstalledIdentity,
  expectedOriginInstalledWorker
} from "./origin-seal-runtime.mjs";
import { verifyOriginReleaseRepository } from "./origin-seal-repository.mjs";
import { verifyCiReleaseCandidate } from "./ci-release-proof-repository.mjs";

export {
  FIN012_DOWNLOAD_CHECKOUT_PREDECESSOR_COMMIT,
  FIN012_DOWNLOAD_CHECKOUT_PREDECESSOR_TREE
};

export const FIN012_DOWNLOAD_CHECKOUT_RUNTIME_SCHEMA =
  "sitesourcery.fin012-download-checkout-production-runtime/v1";
export const FIN012_DOWNLOAD_CHECKOUT_BUNDLE_SCHEMA =
  "sitesourcery.fin012-download-checkout-production-bundle/v1";
export const FIN012_DOWNLOAD_CHECKOUT_CANDIDATE_COMMIT =
  "469091e4e7432282758e74e484a5ab5087e977b8";
export const FIN012_DOWNLOAD_CHECKOUT_CANDIDATE_TREE =
  "a6a9239fc11be5c7f7de2a2f3401dbaa87a165cf";
export const FIN012_DOWNLOAD_CHECKOUT_HELD_CONTROL_COMMIT =
  "df8cb22705fd4adde7b55280a3f9340b67f9734d";
export const FIN012_DOWNLOAD_CHECKOUT_HELD_CONTROL_TREE =
  "50e5f7df3669d42c8707fb0d04baa52913ef7e39";
export const FIN012_DOWNLOAD_CHECKOUT_SUCCESSOR_INPUT_SHA256 =
  "fc799d840d1e795f9d9e88a4fd480bfbc9faf3aa8f0f87586d90773270f280d8";
export const FIN012_DOWNLOAD_CHECKOUT_SUCCESSOR_INPUT_DIGEST =
  "f087b9ce2fe7d498b7b881783743d2de6d03deb7a19fdafd3bdb59481b4fb269";
export const FIN012_DOWNLOAD_CHECKOUT_CI_FINAL_RECEIPT_DIGEST =
  "d5c81b4d3f6224690ba1aec1217f596364c3cb620aaff18aea2c988e88dfec58";
export const FIN012_DOWNLOAD_CHECKOUT_CI_FINAL_RECEIPT_FILE_SHA256 =
  "8c674b41c29f1eb3107779e21ced57c91145a368becf119a03a85d978d49fa0f";
export const FIN012_DOWNLOAD_CHECKOUT_ORIGIN_SEAL_SHA256 =
  "f2594ae0a55f2332cfba0e8553f2e3a644ba67b960c24a21bed1733c7574978a";
export const FIN012_DOWNLOAD_CHECKOUT_PRODUCTION_ROOT =
  "/home/simtech/sitesourcery-production";
export const FIN012_DOWNLOAD_CHECKOUT_RELEASE_ROOT =
  `${FIN012_DOWNLOAD_CHECKOUT_PRODUCTION_ROOT}/releases/${FIN012_DOWNLOAD_CHECKOUT_CANDIDATE_COMMIT}`;
export const FIN012_DOWNLOAD_CHECKOUT_NODE =
  `${FIN012_DOWNLOAD_CHECKOUT_PRODUCTION_ROOT}/toolchain/node-v24.18.0-linux-x64/bin/node`;
export const FIN012_DOWNLOAD_CHECKOUT_HOSTED_ENVIRONMENT_PATH =
  `/etc/sitesourcery/hosted.env.${FIN012_DOWNLOAD_CHECKOUT_CANDIDATE_COMMIT}`;
export const FIN012_DOWNLOAD_CHECKOUT_WRAPPER_PATH =
  `/etc/sitesourcery/api-and-tenant.${FIN012_DOWNLOAD_CHECKOUT_CANDIDATE_COMMIT}.sh`;
export const FIN012_DOWNLOAD_CHECKOUT_ACTIVE_EVIDENCE = Object.freeze({
  epoch: "/etc/sitesourcery/final-release-epoch-v2.json",
  originSeal: "/etc/sitesourcery/origin-seal.json",
  installedReadback: "/etc/sitesourcery/origin-installed-readback.json"
});
export const FIN012_DOWNLOAD_CHECKOUT_RETAINED_EVIDENCE = Object.freeze({
  epoch:
    `/etc/sitesourcery/fin012-${FIN012_DOWNLOAD_CHECKOUT_CANDIDATE_COMMIT}-final-release-epoch-v2.json`,
  originSeal:
    `/etc/sitesourcery/fin012-${FIN012_DOWNLOAD_CHECKOUT_CANDIDATE_COMMIT}-origin-seal.json`,
  installedReadback:
    `/etc/sitesourcery/fin012-${FIN012_DOWNLOAD_CHECKOUT_CANDIDATE_COMMIT}-origin-installed-readback.json`
});
export const FIN012_DOWNLOAD_CHECKOUT_SUCCESSOR_INPUT_RELATIVE_PATH =
  `ops/releases/ci-successor-inputs/${FIN012_DOWNLOAD_CHECKOUT_CANDIDATE_COMMIT}.json`;
export const FIN012_DOWNLOAD_CHECKOUT_CI_RECEIPT_RELATIVE_PATH =
  "ops/releases/fin012-download-checkout-production-control/ci-held-final-receipt.json";

export const FIN012_DOWNLOAD_CHECKOUT_EXPECTED_ENVIRONMENT_NAMES = Object.freeze([
  "SITESOURCERY_ALAKAZAM_LIFECYCLE_MODE",
  "SITESOURCERY_ALAKAZAM_MODE",
  "SITESOURCERY_COMPILE_ATTEMPTS",
  "SITESOURCERY_COMPILE_WINDOW_MS",
  "SITESOURCERY_CONTACT_VAULT_KEY",
  "SITESOURCERY_CONTACT_VAULT_KEY_VERSION",
  "SITESOURCERY_CREDENTIAL_TOPOLOGY_JSON",
  "SITESOURCERY_CUSTOM_BUILD_CHANGE_PAYMENT_MODE",
  "SITESOURCERY_CUSTOM_BUILD_FINAL_PAYMENT_MODE",
  "SITESOURCERY_CUSTOM_BUILD_PAYMENT_MODE",
  "SITESOURCERY_CUSTOM_SERVICES_ASSESSMENT_PAYMENT_MODE",
  "SITESOURCERY_DATABASE_SSL",
  "SITESOURCERY_DATABASE_URL",
  "SITESOURCERY_DATA_ROOT",
  "SITESOURCERY_DEPLOYMENT_ENVIRONMENT",
  "SITESOURCERY_DOWNLOAD_PAYMENT_MODE",
  "SITESOURCERY_ENGAGEMENT_TOKEN_SECRET",
  "SITESOURCERY_EXPORT_ROOT",
  "SITESOURCERY_HOSTED_HOST",
  "SITESOURCERY_HOSTED_LEGAL_V3_AUTHORITY_SHA256",
  "SITESOURCERY_HOSTED_LEGAL_V4_AUTHORITY_SHA256",
  "SITESOURCERY_HOSTED_LEGAL_V5_AUTHORITY_SHA256",
  "SITESOURCERY_HOSTED_PORT",
  "SITESOURCERY_HOSTED_PRIVACY_V3_ARTIFACT_URI",
  "SITESOURCERY_HOSTED_PRIVACY_V3_BYTE_COUNT",
  "SITESOURCERY_HOSTED_PRIVACY_V3_EFFECTIVE_AT",
  "SITESOURCERY_HOSTED_PRIVACY_V3_SHA256",
  "SITESOURCERY_HOSTED_PRIVACY_V3_URI",
  "SITESOURCERY_HOSTED_PRIVACY_V3_VERSION",
  "SITESOURCERY_HOSTED_PRIVACY_V4_ARTIFACT_URI",
  "SITESOURCERY_HOSTED_PRIVACY_V4_BYTE_COUNT",
  "SITESOURCERY_HOSTED_PRIVACY_V4_EFFECTIVE_AT",
  "SITESOURCERY_HOSTED_PRIVACY_V4_SHA256",
  "SITESOURCERY_HOSTED_PRIVACY_V4_URI",
  "SITESOURCERY_HOSTED_PRIVACY_V4_VERSION",
  "SITESOURCERY_HOSTED_PRIVACY_V5_ARTIFACT_URI",
  "SITESOURCERY_HOSTED_PRIVACY_V5_BYTE_COUNT",
  "SITESOURCERY_HOSTED_PRIVACY_V5_EFFECTIVE_AT",
  "SITESOURCERY_HOSTED_PRIVACY_V5_SHA256",
  "SITESOURCERY_HOSTED_PRIVACY_V5_URI",
  "SITESOURCERY_HOSTED_PRIVACY_V5_VERSION",
  "SITESOURCERY_HOSTED_WEBSITE_TERMS_V3_ARTIFACT_URI",
  "SITESOURCERY_HOSTED_WEBSITE_TERMS_V3_BYTE_COUNT",
  "SITESOURCERY_HOSTED_WEBSITE_TERMS_V3_EFFECTIVE_AT",
  "SITESOURCERY_HOSTED_WEBSITE_TERMS_V3_SHA256",
  "SITESOURCERY_HOSTED_WEBSITE_TERMS_V3_URI",
  "SITESOURCERY_HOSTED_WEBSITE_TERMS_V3_VERSION",
  "SITESOURCERY_HOSTED_WEBSITE_TERMS_V4_ARTIFACT_URI",
  "SITESOURCERY_HOSTED_WEBSITE_TERMS_V4_BYTE_COUNT",
  "SITESOURCERY_HOSTED_WEBSITE_TERMS_V4_EFFECTIVE_AT",
  "SITESOURCERY_HOSTED_WEBSITE_TERMS_V4_SHA256",
  "SITESOURCERY_HOSTED_WEBSITE_TERMS_V4_URI",
  "SITESOURCERY_HOSTED_WEBSITE_TERMS_V4_VERSION",
  "SITESOURCERY_HOSTED_WEBSITE_TERMS_V5_ARTIFACT_URI",
  "SITESOURCERY_HOSTED_WEBSITE_TERMS_V5_BYTE_COUNT",
  "SITESOURCERY_HOSTED_WEBSITE_TERMS_V5_EFFECTIVE_AT",
  "SITESOURCERY_HOSTED_WEBSITE_TERMS_V5_SHA256",
  "SITESOURCERY_HOSTED_WEBSITE_TERMS_V5_URI",
  "SITESOURCERY_HOSTED_WEBSITE_TERMS_V5_VERSION",
  "SITESOURCERY_IDENTITY_GLOBAL_ATTEMPTS",
  "SITESOURCERY_IDENTITY_GLOBAL_BLOCK_MS",
  "SITESOURCERY_IDENTITY_GLOBAL_WINDOW_MS",
  "SITESOURCERY_IDENTITY_IP_ATTEMPTS",
  "SITESOURCERY_IDENTITY_IP_BLOCK_MS",
  "SITESOURCERY_IDENTITY_IP_WINDOW_MS",
  "SITESOURCERY_IDENTITY_PEPPER",
  "SITESOURCERY_IDENTITY_PEPPER_CONFIG",
  "SITESOURCERY_IDENTITY_SUBJECT_ATTEMPTS",
  "SITESOURCERY_IDENTITY_SUBJECT_BLOCK_MS",
  "SITESOURCERY_IDENTITY_SUBJECT_WINDOW_MS",
  "SITESOURCERY_LICENSED_BASE_DOMAIN",
  "SITESOURCERY_MAX_CONCURRENT_REQUESTS",
  "SITESOURCERY_MAX_JSON_BODY_BYTES",
  "SITESOURCERY_MAX_WEBHOOK_BODY_BYTES",
  "SITESOURCERY_ORIGIN_INSTALLED_READBACK_FILE",
  "SITESOURCERY_ORIGIN_INSTALLED_READBACK_FILE_SHA256",
  "SITESOURCERY_ORIGIN_SEAL_FILE",
  "SITESOURCERY_ORIGIN_SEAL_FILE_SHA256",
  "SITESOURCERY_POSTGRES_BUDGET_CONFIG",
  "SITESOURCERY_PROJECT_WRITE_ATTEMPTS",
  "SITESOURCERY_PROJECT_WRITE_WINDOW_MS",
  "SITESOURCERY_PUBLICATION_APPROVAL_PATH",
  "SITESOURCERY_PUBLICATION_COMMAND_DEADLINE_MS",
  "SITESOURCERY_PUBLICATION_COMMAND_MAX_BODY_BYTES",
  "SITESOURCERY_PUBLICATION_COMMAND_SOCKET",
  "SITESOURCERY_PUBLICATION_COMMAND_TOKEN",
  "SITESOURCERY_RECOVERY_BASE_URL",
  "SITESOURCERY_RECOVERY_MAIL_MODE",
  "SITESOURCERY_RECOVERY_TRANSPORT_MODULE",
  "SITESOURCERY_REGISTRATION_BASE_URL",
  "SITESOURCERY_REGISTRATION_MAIL_MODE",
  "SITESOURCERY_REGISTRATION_TRANSPORT_MODULE",
  "SITESOURCERY_RELEASE_EPOCH_FILE",
  "SITESOURCERY_RELEASE_EPOCH_SHA256",
  "SITESOURCERY_REQUEST_DEADLINE_MS",
  "SITESOURCERY_RESEND_API_KEY",
  "SITESOURCERY_RESEND_DOMAIN_ID",
  "SITESOURCERY_RESEND_WEBHOOK_MODE",
  "SITESOURCERY_SPARK_COMPILER_SHA256",
  "SITESOURCERY_STRIPE_ALAKAZAM_CONFIGURATION_JSON",
  "SITESOURCERY_STRIPE_API_VERSION",
  "SITESOURCERY_STRIPE_APPROVAL_JSON",
  "SITESOURCERY_STRIPE_APPROVED_RETURN_ORIGINS_JSON",
  "SITESOURCERY_STRIPE_CHECKOUT_CANCEL_URL",
  "SITESOURCERY_STRIPE_CHECKOUT_SUCCESS_URL",
  "SITESOURCERY_STRIPE_LIVEMODE",
  "SITESOURCERY_STRIPE_MODE",
  "SITESOURCERY_STRIPE_PORTAL_PRIVACY_POLICY_URL",
  "SITESOURCERY_STRIPE_PORTAL_RETURN_URL",
  "SITESOURCERY_STRIPE_PORTAL_TERMS_OF_SERVICE_URL",
  "SITESOURCERY_STRIPE_PRICE_EXPECTATIONS_JSON",
  "SITESOURCERY_STRIPE_SECRET_KEY",
  "SITESOURCERY_STRIPE_TAX_CODES_JSON",
  "SITESOURCERY_STRIPE_TAX_PURPOSE_AUTHORITY_JSON",
  "SITESOURCERY_STRIPE_WEBHOOK_ENDPOINT_ID",
  "SITESOURCERY_STRIPE_WEBHOOK_ENDPOINT_URL",
  "SITESOURCERY_STRIPE_WEBHOOK_ROTATION_JSON",
  "SITESOURCERY_STRIPE_WEBHOOK_SECRET",
  "SITESOURCERY_TWILIO_INBOUND_EVENT_MODE",
  "SITESOURCERY_TWILIO_RESPONDER_EVENT_MODE",
  "SITESOURCERY_TWILIO_VOICE_ACCESS_MODE",
  "SITESOURCERY_TWILIO_VOICE_DIAL_MODE"
].sort());

const DEFAULT_CONTROL_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const SHA256 = /^[a-f0-9]{64}$/u;
const EXACT_MODES = Object.freeze({
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

export class Fin012DownloadCheckoutRuntimeFailure extends Error {
  constructor(code, message) {
    super(message);
    this.name = "Fin012DownloadCheckoutRuntimeFailure";
    this.code = code;
  }
}

function fail(code, message) {
  throw new Fin012DownloadCheckoutRuntimeFailure(code, message);
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
    fail(
      "FIN012_DOWNLOAD_CHECKOUT_AUTHORITY_INVALID",
      `${label} drifted from the exact FIN-012 Download Checkout authority.`
    );
  }
}

function exactInstant(value) {
  const selected = new Date(value);
  if (
    typeof value !== "string" ||
    Number.isNaN(selected.valueOf()) ||
    selected.toISOString() !== value
  ) {
    fail(
      "FIN012_DOWNLOAD_CHECKOUT_OBSERVATION_INVALID",
      "Observed time must be one exact ISO instant."
    );
  }
  return value;
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
      fail(
        "FIN012_DOWNLOAD_CHECKOUT_AUTHORITY_FILE_INVALID",
        `${label} changed during its no-follow read.`
      );
    }
    exact(sha256Bytes(bytes), expectedSha256, `${label} file digest`);
    return parseJsonObject(bytes.toString("utf8"), label);
  } catch (error) {
    if (error instanceof Fin012DownloadCheckoutRuntimeFailure) throw error;
    fail(
      "FIN012_DOWNLOAD_CHECKOUT_AUTHORITY_FILE_INVALID",
      `${label} is unavailable or unsafe.`
    );
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

function replaceExact(text, before, after, expectedCount, label) {
  const count = text.split(before).length - 1;
  exact(count, expectedCount, `${label} replacement count`);
  const result = text.replaceAll(before, after);
  if (result.includes(before) || !result.includes(after)) {
    fail(
      "FIN012_DOWNLOAD_CHECKOUT_TEMPLATE_INVALID",
      `${label} did not bind the exact successor.`
    );
  }
  return result;
}

function environmentText(values) {
  return [
    "# FIN-012 exact Download-only approved-live successor environment",
    "# Root-owned mode 0640. Values are never printed, committed, or hashed.",
    ...[...values.keys()].sort().map((name) => `${name}=${values.get(name)}`),
    ""
  ].join("\n");
}

function assertExactApprovedDownloadEnvironment(values) {
  exact(
    canonicalJson([...values.keys()].sort()),
    canonicalJson(FIN012_DOWNLOAD_CHECKOUT_EXPECTED_ENVIRONMENT_NAMES),
    "Production environment name inventory"
  );
  for (const [name, expected] of Object.entries(EXACT_MODES)) {
    exact(
      readFin010EnvironmentValue(
        values,
        name,
        "FIN-012 Download Checkout predecessor environment"
      ),
      expected,
      name
    );
  }
  for (const name of [
    "SITESOURCERY_CONTACT_VAULT_KEY",
    "SITESOURCERY_CREDENTIAL_TOPOLOGY_JSON",
    "SITESOURCERY_DATABASE_URL",
    "SITESOURCERY_IDENTITY_PEPPER",
    "SITESOURCERY_IDENTITY_PEPPER_CONFIG",
    "SITESOURCERY_POSTGRES_BUDGET_CONFIG",
    "SITESOURCERY_PUBLICATION_COMMAND_TOKEN",
    "SITESOURCERY_RESEND_API_KEY",
    "SITESOURCERY_STRIPE_APPROVAL_JSON",
    "SITESOURCERY_STRIPE_SECRET_KEY",
    "SITESOURCERY_STRIPE_WEBHOOK_SECRET"
  ]) {
    readFin010EnvironmentValue(
      values,
      name,
      "FIN-012 Download Checkout predecessor environment"
    );
  }
  for (const name of values.keys()) {
    if (
      name.startsWith("SITESOURCERY_TWILIO_") &&
      !Object.hasOwn(EXACT_MODES, name)
    ) {
      fail(
        "FIN012_DOWNLOAD_CHECKOUT_TWILIO_SECRET_PRESENT",
        `${name} cannot enter the Download-only successor environment.`
      );
    }
  }
  const compiler = readFin010EnvironmentValue(
    values,
    "SITESOURCERY_SPARK_COMPILER_SHA256",
    "FIN-012 Download Checkout predecessor environment"
  );
  if (!SHA256.test(compiler)) {
    fail(
      "FIN012_DOWNLOAD_CHECKOUT_COMPILER_AUTHORITY_INVALID",
      "The reviewed Spark compiler digest is invalid."
    );
  }
}

export function createFin012DownloadCheckoutHostedEnvironment({
  predecessorEnvironmentText,
  evidence
}) {
  const values = parseFin010EnvironmentFile(
    predecessorEnvironmentText,
    "FIN-012 Download Checkout predecessor production environment"
  );
  assertExactApprovedDownloadEnvironment(values);
  for (const [name, entry] of Object.entries({
    SITESOURCERY_RELEASE_EPOCH_FILE:
      FIN012_DOWNLOAD_CHECKOUT_ACTIVE_EVIDENCE.epoch,
    SITESOURCERY_RELEASE_EPOCH_SHA256: evidence.epoch.sha256,
    SITESOURCERY_ORIGIN_SEAL_FILE:
      FIN012_DOWNLOAD_CHECKOUT_ACTIVE_EVIDENCE.originSeal,
    SITESOURCERY_ORIGIN_SEAL_FILE_SHA256: evidence.originSeal.sha256,
    SITESOURCERY_ORIGIN_INSTALLED_READBACK_FILE:
      FIN012_DOWNLOAD_CHECKOUT_ACTIVE_EVIDENCE.installedReadback,
    SITESOURCERY_ORIGIN_INSTALLED_READBACK_FILE_SHA256:
      evidence.installedReadback.sha256,
    SITESOURCERY_REGISTRATION_TRANSPORT_MODULE:
      `${FIN012_DOWNLOAD_CHECKOUT_RELEASE_ROOT}/server/hosted/resend-mail-transport.mjs`,
    SITESOURCERY_RECOVERY_TRANSPORT_MODULE:
      `${FIN012_DOWNLOAD_CHECKOUT_RELEASE_ROOT}/server/hosted/resend-mail-transport.mjs`
  })) values.set(name, entry);
  assertExactApprovedDownloadEnvironment(values);
  const text = environmentText(values);
  exact(
    text.includes(FIN012_DOWNLOAD_CHECKOUT_PREDECESSOR_RELEASE_ROOT),
    false,
    "Predecessor release residue"
  );
  return freeze({
    text,
    nameCount: values.size,
    providers: {
      stripe: "approved_live_download_only_existing_authority",
      assessment: "held",
      customBuildStart: "held",
      customBuildChange: "held",
      customBuildFinal: "held",
      alakazam: "held",
      twilio: "held_no_secret_loaded",
      domains: "held",
      publication: "held",
      workers: "retained_disabled_held"
    },
    secretValuesDisclosed: false,
    secretDerivedDigestsRecorded: false
  });
}

export function createFin012DownloadCheckoutWrapper() {
  return replaceExact(
    createFin012StripeDownloadWrapper(),
    FIN012_DOWNLOAD_CHECKOUT_PREDECESSOR_RELEASE_ROOT,
    FIN012_DOWNLOAD_CHECKOUT_RELEASE_ROOT,
    1,
    "API and tenant wrapper"
  );
}

export function createFin012DownloadCheckoutUserUnitSet({ evidence }) {
  const predecessorUnits = createFin012StripeDownloadUserUnitSet({ evidence });
  return freeze({
    "sitesourcery-production.service": replaceExact(
      predecessorUnits["sitesourcery-production.service"],
      FIN012_DOWNLOAD_CHECKOUT_PREDECESSOR_COMMIT,
      FIN012_DOWNLOAD_CHECKOUT_CANDIDATE_COMMIT,
      6,
      "Production runtime unit"
    ),
    "sitesourcery-production-static.service": replaceExact(
      predecessorUnits["sitesourcery-production-static.service"],
      FIN012_DOWNLOAD_CHECKOUT_PREDECESSOR_COMMIT,
      FIN012_DOWNLOAD_CHECKOUT_CANDIDATE_COMMIT,
      3,
      "Production static unit"
    )
  });
}

export async function verifyFin012DownloadCheckoutAuthorities({
  controlRoot,
  candidateRoot,
  gitRunner
}) {
  const successorInput = validateCiReleaseSuccessorInput(
    await readExactJson(
      path.join(
        controlRoot,
        FIN012_DOWNLOAD_CHECKOUT_SUCCESSOR_INPUT_RELATIVE_PATH
      ),
      FIN012_DOWNLOAD_CHECKOUT_SUCCESSOR_INPUT_SHA256,
      "FIN-012 Download Checkout successor input"
    )
  );
  const ciFinalReceipt = validateCiReleaseFinalReceipt(
    await readExactJson(
      path.join(
        controlRoot,
        FIN012_DOWNLOAD_CHECKOUT_CI_RECEIPT_RELATIVE_PATH
      ),
      FIN012_DOWNLOAD_CHECKOUT_CI_FINAL_RECEIPT_FILE_SHA256,
      "FIN-012 Download Checkout held CI receipt"
    )
  );
  exact(
    successorInput.digest,
    FIN012_DOWNLOAD_CHECKOUT_SUCCESSOR_INPUT_DIGEST,
    "Successor input"
  );
  exact(
    ciFinalReceipt.digest,
    FIN012_DOWNLOAD_CHECKOUT_CI_FINAL_RECEIPT_DIGEST,
    "Held CI receipt"
  );
  exact(
    ciFinalReceipt.candidateSha,
    FIN012_DOWNLOAD_CHECKOUT_CANDIDATE_COMMIT,
    "Held CI candidate"
  );
  exact(
    ciFinalReceipt.workflowSha,
    FIN012_DOWNLOAD_CHECKOUT_HELD_CONTROL_COMMIT,
    "Held CI control"
  );
  exact(
    successorInput.originReleaseInput.epoch.source.treeSha,
    FIN012_DOWNLOAD_CHECKOUT_CANDIDATE_TREE,
    "Candidate tree"
  );
  exact(
    successorInput.originReleaseInput.epoch.rollback.predecessorCommitSha,
    FIN012_DOWNLOAD_CHECKOUT_PREDECESSOR_COMMIT,
    "Rollback predecessor"
  );
  exact(
    successorInput.originReleaseInput.epoch.rollback.predecessorTreeSha,
    FIN012_DOWNLOAD_CHECKOUT_PREDECESSOR_TREE,
    "Rollback predecessor tree"
  );
  await verifyCiReleaseCandidate({
    projectRoot: candidateRoot,
    successorInput,
    ...(gitRunner ? { gitRunner } : {})
  });
  const originSeal = await verifyOriginReleaseRepository({
    projectRoot: candidateRoot,
    releaseInput: successorInput.originReleaseInput,
    ...(gitRunner ? { gitRunner } : {})
  });
  exact(
    originSeal.sealSha256,
    FIN012_DOWNLOAD_CHECKOUT_ORIGIN_SEAL_SHA256,
    "Origin seal"
  );
  return freeze({ successorInput, ciFinalReceipt, originSeal });
}

export async function createFin012DownloadCheckoutProductionBundle({
  controlRoot,
  candidateRoot,
  predecessorEnvironmentText,
  observedAt,
  gitRunner
}) {
  exactInstant(observedAt);
  const authorities = await verifyFin012DownloadCheckoutAuthorities({
    controlRoot,
    candidateRoot,
    ...(gitRunner ? { gitRunner } : {})
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
  const environment = createFin012DownloadCheckoutHostedEnvironment({
    predecessorEnvironmentText,
    evidence
  });
  const wrapper = createFin012DownloadCheckoutWrapper();
  const units = createFin012DownloadCheckoutUserUnitSet({ evidence });
  const payload = {
    schema: FIN012_DOWNLOAD_CHECKOUT_BUNDLE_SCHEMA,
    state: "prepared_existing_download_authority_no_install",
    observedAt,
    source: {
      candidateCommitSha: FIN012_DOWNLOAD_CHECKOUT_CANDIDATE_COMMIT,
      candidateTreeSha: FIN012_DOWNLOAD_CHECKOUT_CANDIDATE_TREE,
      heldControlCommitSha: FIN012_DOWNLOAD_CHECKOUT_HELD_CONTROL_COMMIT,
      heldControlTreeSha: FIN012_DOWNLOAD_CHECKOUT_HELD_CONTROL_TREE,
      predecessorCommitSha: FIN012_DOWNLOAD_CHECKOUT_PREDECESSOR_COMMIT,
      predecessorTreeSha: FIN012_DOWNLOAD_CHECKOUT_PREDECESSOR_TREE
    },
    proof: {
      successorInputFileSha256:
        FIN012_DOWNLOAD_CHECKOUT_SUCCESSOR_INPUT_SHA256,
      successorInputDigest: FIN012_DOWNLOAD_CHECKOUT_SUCCESSOR_INPUT_DIGEST,
      ciFinalReceiptDigest:
        FIN012_DOWNLOAD_CHECKOUT_CI_FINAL_RECEIPT_DIGEST,
      ciRunId: authorities.ciFinalReceipt.runId,
      ciRunAttempt: authorities.ciFinalReceipt.runAttempt,
      originSealSha256: authorities.originSeal.sealSha256
    },
    evidence: Object.fromEntries(
      Object.entries(evidence).map(([name, entry]) => [name, {
        byteCount: entry.byteCount,
        sha256: entry.sha256,
        retainedPath: FIN012_DOWNLOAD_CHECKOUT_RETAINED_EVIDENCE[name],
        activePath: FIN012_DOWNLOAD_CHECKOUT_ACTIVE_EVIDENCE[name]
      }])
    ),
    database: {
      migrationCount: 96,
      migrationManifestSha256:
        "2589e3a259b24739b5c4b1c05a0cfb74d15f051d7ab58a9fcc5d580d429b9a62",
      migrationRequired: false,
      mutationAuthorized: false
    },
    runtime: {
      releaseRoot: FIN012_DOWNLOAD_CHECKOUT_RELEASE_ROOT,
      node: FIN012_DOWNLOAD_CHECKOUT_NODE,
      environmentPath: FIN012_DOWNLOAD_CHECKOUT_HOSTED_ENVIRONMENT_PATH,
      wrapperPath: FIN012_DOWNLOAD_CHECKOUT_WRAPPER_PATH,
      environmentNameCount: environment.nameCount,
      retainedLiveAuthority: "download_only",
      providers: environment.providers
    },
    authority: {
      existingDownloadAuthorityRetained: true,
      newProviderMutationAuthorized: false,
      newPaymentMutationAuthorized: false,
      databaseMutationAuthorized: false,
      dnsEffectsAuthorized: false,
      retirementAuthorized: false
    }
  };
  const receipt = freeze({
    ...payload,
    digest: sha256Bytes(jsonBytes(payload))
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

export async function prepareFin012DownloadCheckoutProductionBundle({
  controlRoot = DEFAULT_CONTROL_ROOT,
  candidateRoot,
  predecessorEnvironmentPath,
  outputPath,
  observedAt,
  gitRunner
}) {
  for (const [name, selected] of Object.entries({
    candidateRoot,
    predecessorEnvironmentPath,
    outputPath
  })) {
    if (typeof selected !== "string" || !path.isAbsolute(selected)) {
      fail(
        "FIN012_DOWNLOAD_CHECKOUT_ARGUMENTS_INVALID",
        `${name} must be an absolute path.`
      );
    }
  }
  const parentMetadata = await lstat(path.dirname(path.resolve(outputPath)));
  if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink()) {
    fail(
      "FIN012_DOWNLOAD_CHECKOUT_OUTPUT_INVALID",
      "Output parent must be a real directory."
    );
  }
  const bundle = await createFin012DownloadCheckoutProductionBundle({
    controlRoot: path.resolve(controlRoot),
    candidateRoot: path.resolve(candidateRoot),
    predecessorEnvironmentText: await readFile(
      path.resolve(predecessorEnvironmentPath),
      "utf8"
    ),
    observedAt,
    ...(gitRunner ? { gitRunner } : {})
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
    schema: FIN012_DOWNLOAD_CHECKOUT_RUNTIME_SCHEMA,
    ok: true,
    state: bundle.receipt.state,
    outputPath: selectedOutput,
    receiptDigest: bundle.receipt.digest,
    candidateCommitSha: FIN012_DOWNLOAD_CHECKOUT_CANDIDATE_COMMIT,
    candidateTreeSha: FIN012_DOWNLOAD_CHECKOUT_CANDIDATE_TREE,
    heldControlCommitSha: FIN012_DOWNLOAD_CHECKOUT_HELD_CONTROL_COMMIT,
    retainedLiveAuthority: "download_only",
    secretValuesDisclosed: false,
    secretDerivedDigestsRecorded: false,
    providerEffects: false,
    paymentEffects: false,
    publicEffects: false,
    databaseEffects: false,
    filesWritten: 8
  });
}

function cliArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    if (!/^--[a-z][a-z-]*$/u.test(flag) || values.has(flag)) {
      fail(
        "FIN012_DOWNLOAD_CHECKOUT_ARGUMENTS_INVALID",
        "Prepare arguments are invalid or duplicated."
      );
    }
    values.set(flag, argv[index + 1]);
  }
  const expected = [
    "--candidate-root",
    "--observed-at",
    "--output",
    "--predecessor-environment"
  ];
  if (canonicalJson([...values.keys()].sort()) !== canonicalJson(expected)) {
    fail(
      "FIN012_DOWNLOAD_CHECKOUT_ARGUMENTS_INVALID",
      "Prepare arguments are incomplete or unexpected."
    );
  }
  return {
    candidateRoot: values.get("--candidate-root"),
    predecessorEnvironmentPath: values.get("--predecessor-environment"),
    outputPath: values.get("--output"),
    observedAt: values.get("--observed-at")
  };
}

async function main(argv = process.argv.slice(2)) {
  process.stdout.write(`${canonicalJson(
    await prepareFin012DownloadCheckoutProductionBundle(cliArguments(argv))
  )}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    process.stderr.write(`${canonicalJson({
      schema: FIN012_DOWNLOAD_CHECKOUT_RUNTIME_SCHEMA,
      ok: false,
      code:
        error?.code ?? "FIN012_DOWNLOAD_CHECKOUT_PRODUCTION_PREPARE_FAILED"
    })}\n`);
    process.exitCode = 1;
  });
}
