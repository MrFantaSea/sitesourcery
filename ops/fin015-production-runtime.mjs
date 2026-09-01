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
import { verifyCiReleaseCandidate } from "./ci-release-proof-repository.mjs";
import {
  FIN015_CANDIDATE_COMMIT,
  FIN015_CANDIDATE_TREE,
  FIN015_CI_FINAL_RECEIPT_DIGEST,
  FIN015_CI_FINAL_RECEIPT_FILE_SHA256,
  FIN015_HELD_CONTROL_COMMIT,
  FIN015_HELD_CONTROL_TREE,
  FIN015_INSTALLED_COMMIT,
  FIN015_INSTALLED_TREE,
  FIN015_SUCCESSOR_INPUT_DIGEST,
  FIN015_SUCCESSOR_INPUT_SHA256
} from "./fin015-protected-production-upgrade.mjs";
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
  FIN012_DOWNLOAD_CHECKOUT_EXPECTED_ENVIRONMENT_NAMES
} from "./fin012-download-checkout-production-runtime.mjs";
import {
  ORIGIN_HELD_AUTHORITY,
  ORIGIN_LOOPBACK_EXPECTATIONS,
  createOriginInstalledReadback,
  expectedOriginInstalledIdentity,
  expectedOriginInstalledWorker
} from "./origin-seal-runtime.mjs";
import { verifyOriginReleaseRepository } from "./origin-seal-repository.mjs";

export {
  FIN015_CANDIDATE_COMMIT,
  FIN015_CANDIDATE_TREE,
  FIN015_CI_FINAL_RECEIPT_DIGEST,
  FIN015_HELD_CONTROL_COMMIT,
  FIN015_HELD_CONTROL_TREE,
  FIN015_INSTALLED_COMMIT,
  FIN015_INSTALLED_TREE,
  FIN015_SUCCESSOR_INPUT_DIGEST
};

export const FIN015_RUNTIME_SCHEMA =
  "sitesourcery.fin015-production-runtime/v1";
export const FIN015_BUNDLE_SCHEMA =
  "sitesourcery.fin015-production-bundle/v1";
export const FIN015_PRODUCTION_CONTROL_COMMIT =
  "33964f972d6b2e75dedea6301796a16483a998d9";
export const FIN015_PRODUCTION_CONTROL_TREE =
  "891d12771cea52bafbc89c6dcbc9f81df5016735";
export const FIN015_ORIGIN_SEAL_SHA256 =
  "1628e2e538d39c653be2154c40deb1bccd7f8b0c38f17524dc82bcc99521630b";
export const FIN015_PRODUCTION_ROOT =
  "/home/simtech/sitesourcery-production";
export const FIN015_RELEASE_ROOT =
  `${FIN015_PRODUCTION_ROOT}/releases/${FIN015_CANDIDATE_COMMIT}`;
export const FIN015_NODE =
  `${FIN015_PRODUCTION_ROOT}/toolchain/node-v24.18.0-linux-x64/bin/node`;
export const FIN015_RUNTIME_DIRECTORY = "/run/sitesourcery";
export const FIN015_BACKUP_QUIESCE_PATH =
  `${FIN015_RUNTIME_DIRECTORY}/BACKUP_QUIESCE`;
export const FIN015_INSTALLED_HOSTED_ENVIRONMENT_PATH =
  `/etc/sitesourcery/hosted.env.${FIN015_CANDIDATE_COMMIT}`;
export const FIN015_INSTALLED_WRAPPER_PATH =
  `/etc/sitesourcery/api-and-tenant.${FIN015_CANDIDATE_COMMIT}.sh`;
export const FIN015_ACTIVE_EVIDENCE = Object.freeze({
  epoch: "/etc/sitesourcery/final-release-epoch-v2.json",
  originSeal: "/etc/sitesourcery/origin-seal.json",
  installedReadback: "/etc/sitesourcery/origin-installed-readback.json"
});
export const FIN015_RETAINED_EVIDENCE = Object.freeze({
  epoch:
    `/etc/sitesourcery/fin015-${FIN015_CANDIDATE_COMMIT}-final-release-epoch-v2.json`,
  originSeal:
    `/etc/sitesourcery/fin015-${FIN015_CANDIDATE_COMMIT}-origin-seal.json`,
  installedReadback:
    `/etc/sitesourcery/fin015-${FIN015_CANDIDATE_COMMIT}-origin-installed-readback.json`
});
export const FIN015_SUCCESSOR_INPUT_RELATIVE_PATH =
  `ops/releases/ci-successor-inputs/${FIN015_CANDIDATE_COMMIT}.json`;
export const FIN015_CI_RECEIPT_RELATIVE_PATH =
  "ops/releases/fin015-production-upgrade-control/ci-held-final-receipt.json";
export const FIN015_STRIPE_ACTIVATION_RECEIPT_ENVIRONMENT_NAME =
  "SITESOURCERY_STRIPE_CREDENTIAL_ACTIVATION_RECEIPT_JSON";

const DEFAULT_CONTROL_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const SHA256 = /^[a-f0-9]{64}$/u;
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
  SITESOURCERY_HOSTED_PRIVACY_V7_EFFECTIVE_AT:
    "2026-09-01T04:00:00.000Z",
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
export const FIN015_PREDECESSOR_ENVIRONMENT_NAMES = Object.freeze([
  ...FIN012_DOWNLOAD_CHECKOUT_EXPECTED_ENVIRONMENT_NAMES,
  FIN015_STRIPE_ACTIVATION_RECEIPT_ENVIRONMENT_NAME
].sort());
export const FIN015_EXPECTED_ENVIRONMENT_NAMES = Object.freeze([
  ...FIN015_PREDECESSOR_ENVIRONMENT_NAMES,
  ...Object.keys(LEGAL_V7_ENVIRONMENT)
].sort());

export class Fin015RuntimeFailure extends Error {
  constructor(code, message) {
    super(message);
    this.name = "Fin015RuntimeFailure";
    this.code = code;
  }
}

function fail(code, message) {
  throw new Fin015RuntimeFailure(code, message);
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
      "FIN015_RUNTIME_AUTHORITY_INVALID",
      `${label} drifted from the exact FIN-015 runtime authority.`
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
      "FIN015_RUNTIME_OBSERVATION_INVALID",
      "FIN-015 observedAt must be an exact ISO instant."
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
        "FIN015_RUNTIME_AUTHORITY_FILE_INVALID",
        `${label} changed during its no-follow read.`
      );
    }
    exact(sha256Bytes(bytes), expectedSha256, `${label} file digest`);
    return parseJsonObject(bytes.toString("utf8"), label);
  } catch (error) {
    if (error instanceof Fin015RuntimeFailure) throw error;
    fail(
      "FIN015_RUNTIME_AUTHORITY_FILE_INVALID",
      `${label} is unavailable or unsafe.`
    );
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

function environmentText(values) {
  return [
    "# FIN-015 exact production-held hosted environment",
    "# Root-owned mode 0600. Values are never printed or committed.",
    ...[...values.keys()].sort().map((name) => `${name}=${values.get(name)}`),
    ""
  ].join("\n");
}

function assertApprovedDownloadEnvironment(values, { withLegalV7 }) {
  const expectedNames = withLegalV7
    ? FIN015_EXPECTED_ENVIRONMENT_NAMES
    : FIN015_PREDECESSOR_ENVIRONMENT_NAMES;
  exact(
    canonicalJson([...values.keys()].sort()),
    canonicalJson(expectedNames),
    "Production environment name inventory"
  );
  for (const [name, expected] of Object.entries(EXACT_INHERITED_MODES)) {
    exact(
      readFin010EnvironmentValue(
        values,
        name,
        "FIN-015 predecessor environment"
      ),
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
        "FIN015_RUNTIME_HELD_PROVIDER_SECRET_PRESENT",
        `${name} cannot enter the runtime bundle while its purpose is held.`
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
    FIN015_STRIPE_ACTIVATION_RECEIPT_ENVIRONMENT_NAME,
    "SITESOURCERY_STRIPE_SECRET_KEY",
    "SITESOURCERY_STRIPE_WEBHOOK_SECRET",
    "SITESOURCERY_RELEASE_EPOCH_FILE",
    "SITESOURCERY_RELEASE_EPOCH_SHA256",
    "SITESOURCERY_ORIGIN_SEAL_FILE",
    "SITESOURCERY_ORIGIN_SEAL_FILE_SHA256",
    "SITESOURCERY_ORIGIN_INSTALLED_READBACK_FILE",
    "SITESOURCERY_ORIGIN_INSTALLED_READBACK_FILE_SHA256"
  ]) {
    readFin010EnvironmentValue(
      values,
      name,
      "FIN-015 predecessor environment"
    );
  }
  const compiler = readFin010EnvironmentValue(
    values,
    "SITESOURCERY_SPARK_COMPILER_SHA256",
    "FIN-015 predecessor environment"
  );
  if (!SHA256.test(compiler)) {
    fail(
      "FIN015_RUNTIME_COMPILER_AUTHORITY_INVALID",
      "The reviewed Spark compiler digest is invalid."
    );
  }
}

export function createFin015HostedEnvironment({
  predecessorEnvironmentText,
  evidence
}) {
  const values = parseFin010EnvironmentFile(
    predecessorEnvironmentText,
    "FIN-015 predecessor production environment"
  );
  assertApprovedDownloadEnvironment(values, { withLegalV7: false });
  for (const [name, entry] of Object.entries(LEGAL_V7_ENVIRONMENT)) {
    values.set(name, entry);
  }
  for (const [name, entry] of Object.entries({
    SITESOURCERY_RELEASE_EPOCH_FILE: FIN015_ACTIVE_EVIDENCE.epoch,
    SITESOURCERY_RELEASE_EPOCH_SHA256: evidence.epoch.sha256,
    SITESOURCERY_ORIGIN_SEAL_FILE: FIN015_ACTIVE_EVIDENCE.originSeal,
    SITESOURCERY_ORIGIN_SEAL_FILE_SHA256: evidence.originSeal.sha256,
    SITESOURCERY_ORIGIN_INSTALLED_READBACK_FILE:
      FIN015_ACTIVE_EVIDENCE.installedReadback,
    SITESOURCERY_ORIGIN_INSTALLED_READBACK_FILE_SHA256:
      evidence.installedReadback.sha256,
    SITESOURCERY_REGISTRATION_TRANSPORT_MODULE:
      `${FIN015_RELEASE_ROOT}/server/hosted/resend-mail-transport.mjs`,
    SITESOURCERY_RECOVERY_TRANSPORT_MODULE:
      `${FIN015_RELEASE_ROOT}/server/hosted/resend-mail-transport.mjs`
  })) {
    if (!SHA256.test(entry) && name.endsWith("_SHA256")) {
      fail(
        "FIN015_RUNTIME_EVIDENCE_INVALID",
        `${name} must bind exact evidence.`
      );
    }
    values.set(name, entry);
  }
  assertApprovedDownloadEnvironment(values, { withLegalV7: true });
  for (const [name, expected] of Object.entries(LEGAL_V7_ENVIRONMENT)) {
    exact(values.get(name), expected, name);
  }
  return freeze({
    text: environmentText(values),
    nameCount: values.size,
    legal: {
      privacyVersion:
        LEGAL_V7_ENVIRONMENT.SITESOURCERY_HOSTED_PRIVACY_V7_VERSION,
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

export async function verifyFin015RuntimeAuthorities({
  controlRoot,
  candidateRoot,
  gitRunner
}) {
  const successorInput = validateCiReleaseSuccessorInput(
    await readExactJson(
      path.join(controlRoot, FIN015_SUCCESSOR_INPUT_RELATIVE_PATH),
      FIN015_SUCCESSOR_INPUT_SHA256,
      "FIN-015 successor input"
    )
  );
  const ciFinalReceipt = validateCiReleaseFinalReceipt(
    await readExactJson(
      path.join(controlRoot, FIN015_CI_RECEIPT_RELATIVE_PATH),
      FIN015_CI_FINAL_RECEIPT_FILE_SHA256,
      "FIN-015 held CI final receipt"
    )
  );
  exact(successorInput.digest, FIN015_SUCCESSOR_INPUT_DIGEST, "Successor input");
  exact(ciFinalReceipt.digest, FIN015_CI_FINAL_RECEIPT_DIGEST, "Held CI receipt");
  exact(ciFinalReceipt.candidateSha, FIN015_CANDIDATE_COMMIT, "Held candidate");
  exact(ciFinalReceipt.workflowSha, FIN015_HELD_CONTROL_COMMIT, "Held control");
  exact(
    successorInput.originReleaseInput.epoch.source.treeSha,
    FIN015_CANDIDATE_TREE,
    "Candidate tree"
  );
  exact(
    successorInput.originReleaseInput.epoch.rollback.predecessorCommitSha,
    FIN015_INSTALLED_COMMIT,
    "Installed predecessor"
  );
  exact(
    successorInput.originReleaseInput.epoch.rollback.predecessorTreeSha,
    FIN015_INSTALLED_TREE,
    "Installed predecessor tree"
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
  exact(originSeal.sealSha256, FIN015_ORIGIN_SEAL_SHA256, "Origin seal");
  return freeze({ successorInput, ciFinalReceipt, originSeal });
}

export async function createFin015ProductionBundle({
  controlRoot,
  candidateRoot,
  predecessorEnvironmentText,
  observedAt,
  gitRunner
}) {
  exactInstant(observedAt);
  const authorities = await verifyFin015RuntimeAuthorities({
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
  const environment = createFin015HostedEnvironment({
    predecessorEnvironmentText,
    evidence
  });
  const wrapper = createFin015Wrapper();
  const units = createFin015UserUnitSet({ evidence });
  const payload = {
    schema: FIN015_BUNDLE_SCHEMA,
    state: "prepared_held_no_install",
    observedAt,
    source: {
      installedCommitSha: FIN015_INSTALLED_COMMIT,
      installedTreeSha: FIN015_INSTALLED_TREE,
      candidateCommitSha: FIN015_CANDIDATE_COMMIT,
      candidateTreeSha: FIN015_CANDIDATE_TREE,
      heldControlCommitSha: FIN015_HELD_CONTROL_COMMIT,
      heldControlTreeSha: FIN015_HELD_CONTROL_TREE,
      productionControlCommitSha: FIN015_PRODUCTION_CONTROL_COMMIT,
      productionControlTreeSha: FIN015_PRODUCTION_CONTROL_TREE
    },
    proof: {
      successorInputFileSha256: FIN015_SUCCESSOR_INPUT_SHA256,
      successorInputDigest: FIN015_SUCCESSOR_INPUT_DIGEST,
      ciFinalReceiptFileSha256: FIN015_CI_FINAL_RECEIPT_FILE_SHA256,
      ciFinalReceiptDigest: FIN015_CI_FINAL_RECEIPT_DIGEST,
      ciRunId: authorities.ciFinalReceipt.runId,
      ciRunAttempt: authorities.ciFinalReceipt.runAttempt,
      originSealSha256: authorities.originSeal.sealSha256
    },
    evidence: Object.fromEntries(
      Object.entries(evidence).map(([name, entry]) => [name, {
        byteCount: entry.byteCount,
        sha256: entry.sha256,
        retainedPath: FIN015_RETAINED_EVIDENCE[name],
        activePath: FIN015_ACTIVE_EVIDENCE[name]
      }])
    ),
    runtime: {
      releaseRoot: FIN015_RELEASE_ROOT,
      node: FIN015_NODE,
      environmentPath: FIN015_INSTALLED_HOSTED_ENVIRONMENT_PATH,
      wrapperPath: FIN015_INSTALLED_WRAPPER_PATH,
      environmentNameCount: environment.nameCount,
      legal: environment.legal,
      providers: environment.providers
    },
    authority: {
      bundlePreparationAuthorized: true,
      releaseInstallationAuthorized: false,
      databaseMigrationAuthorized: false,
      serviceSwitchAuthorized: false,
      publicRuntimeCutoverAuthorized: false,
      providerEffectsAuthorized: false,
      paymentEffectsAuthorized: false,
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

export function createFin015Wrapper() {
  return `#!/bin/bash
set -euo pipefail

root=${FIN015_PRODUCTION_ROOT}
release=${FIN015_RELEASE_ROOT}
node=${FIN015_NODE}
api_pid=
tenant_pid=

stop_children() {
  if test -n "\${api_pid:-}"; then kill -TERM "$api_pid" 2>/dev/null || true; fi
  if test -n "\${tenant_pid:-}"; then kill -TERM "$tenant_pid" 2>/dev/null || true; fi
  if test -n "\${api_pid:-}"; then wait "$api_pid" 2>/dev/null || true; fi
  if test -n "\${tenant_pid:-}"; then wait "$tenant_pid" 2>/dev/null || true; fi
}
trap stop_children EXIT INT TERM

test -d "${FIN015_RUNTIME_DIRECTORY}"
test ! -L "${FIN015_RUNTIME_DIRECTORY}"
test "$(stat -c '%U:%G:%a' "${FIN015_RUNTIME_DIRECTORY}")" = "root:simtech:770"
"$node" "$release/server/hosted/bin/server.mjs" &
api_pid=$!
for _attempt in $(seq 1 300); do
  if test -d "$root/state/tenant-runtime/releases"; then break; fi
  if ! kill -0 "$api_pid" 2>/dev/null; then wait "$api_pid"; exit $?; fi
  sleep 0.1
done
test -d "$root/state/tenant-runtime/releases"
env \\
  SITESOURCERY_DATA_ROOT="$root/state/tenant-runtime" \\
  SITESOURCERY_TENANT_HOST=127.0.0.1 \\
  SITESOURCERY_TENANT_PORT=8080 \\
  SITESOURCERY_CONTROL_HOST=127.0.0.1 \\
  "$node" "$release/server/selfhost/bin/server.mjs" &
tenant_pid=$!

wait -n "$api_pid" "$tenant_pid"
status=$?
exit "$status"
`;
}

export function createFin015UserUnitSet({ evidence }) {
  for (const name of ["epoch", "originSeal", "installedReadback"]) {
    if (!SHA256.test(evidence?.[name]?.sha256 ?? "")) {
      fail(
        "FIN015_RUNTIME_EVIDENCE_INVALID",
        `FIN-015 ${name} evidence is invalid.`
      );
    }
  }
  const verify =
    `${FIN015_NODE} ${FIN015_RELEASE_ROOT}/ops/verify-final-release-epoch-v2.mjs` +
    ` --epoch ${FIN015_ACTIVE_EVIDENCE.epoch}` +
    ` --epoch-sha256 ${evidence.epoch.sha256}` +
    ` --origin-seal ${FIN015_ACTIVE_EVIDENCE.originSeal}` +
    ` --origin-seal-sha256 ${evidence.originSeal.sha256}` +
    ` --installed-readback ${FIN015_ACTIVE_EVIDENCE.installedReadback}` +
    ` --installed-readback-sha256 ${evidence.installedReadback.sha256}`;
  const runtime = `[Unit]
Description=Site Sourcery FIN-015 exact production-held API and tenant runtime
After=network-online.target sitesourcery-production-db-tunnel.service
Wants=network-online.target
Requires=sitesourcery-production-db-tunnel.service
ConditionPathExists=${FIN015_PRODUCTION_ROOT}/run/RUNTIME_APPROVED
ConditionPathExists=!${FIN015_BACKUP_QUIESCE_PATH}
ConditionPathExists=!%t/sitesourcery-production/BACKUP_QUIESCE

[Service]
Type=simple
WorkingDirectory=${FIN015_RELEASE_ROOT}
Environment=NODE_ENV=production
EnvironmentFile=${FIN015_INSTALLED_HOSTED_ENVIRONMENT_PATH}
ExecStartPre=${FIN015_NODE} ${FIN015_RELEASE_ROOT}/server/hosted/assert-runtime.mjs
ExecStartPre=+${verify}
ExecStart=+${FIN015_INSTALLED_WRAPPER_PATH}
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
ReadOnlyPaths=${FIN015_RELEASE_ROOT} ${FIN015_NODE.replace(/\/bin\/node$/u, "")} /etc/sitesourcery
ReadWritePaths=${FIN015_PRODUCTION_ROOT}/state ${FIN015_PRODUCTION_ROOT}/run ${FIN015_RUNTIME_DIRECTORY}
LimitNOFILE=8192
TasksMax=256

[Install]
WantedBy=default.target
`;
  const staticUnit = `[Unit]
Description=Site Sourcery FIN-015 exact immutable production artifact
After=network-online.target sitesourcery-production.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${FIN015_RELEASE_ROOT}/_hosted
ExecStart=/usr/bin/python3 -m http.server 8899 --bind 127.0.0.1 --directory ${FIN015_RELEASE_ROOT}/_hosted
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
ReadOnlyPaths=${FIN015_RELEASE_ROOT}/_hosted

[Install]
WantedBy=default.target
`;
  return freeze({
    "sitesourcery-production.service": runtime,
    "sitesourcery-production-static.service": staticUnit
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

export async function prepareFin015ProductionBundle({
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
      fail("FIN015_RUNTIME_ARGUMENTS_INVALID", `${name} must be absolute.`);
    }
  }
  const parent = path.dirname(path.resolve(outputPath));
  const parentMetadata = await lstat(parent);
  if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink()) {
    fail(
      "FIN015_RUNTIME_OUTPUT_INVALID",
      "FIN-015 output parent must be a real directory."
    );
  }
  const bundle = await createFin015ProductionBundle({
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
      [
        "final-release-epoch-v2.json",
        Buffer.from(bundle.evidence.epoch.text, "utf8"),
        0o400
      ],
      [
        "origin-seal.json",
        Buffer.from(bundle.evidence.originSeal.text, "utf8"),
        0o400
      ],
      [
        "origin-installed-readback.json",
        Buffer.from(bundle.evidence.installedReadback.text, "utf8"),
        0o400
      ],
      ["hosted.env", Buffer.from(bundle.environment.text, "utf8"), 0o600],
      ["api-and-tenant.sh", Buffer.from(bundle.wrapper, "utf8"), 0o500],
      [
        "sitesourcery-production.service",
        Buffer.from(
          bundle.units["sitesourcery-production.service"],
          "utf8"
        ),
        0o400
      ],
      [
        "sitesourcery-production-static.service",
        Buffer.from(
          bundle.units["sitesourcery-production-static.service"],
          "utf8"
        ),
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
    schema: FIN015_RUNTIME_SCHEMA,
    ok: true,
    state: bundle.receipt.state,
    outputPath: selectedOutput,
    receiptDigest: bundle.receipt.digest,
    candidateCommitSha: FIN015_CANDIDATE_COMMIT,
    candidateTreeSha: FIN015_CANDIDATE_TREE,
    heldControlCommitSha: FIN015_HELD_CONTROL_COMMIT,
    productionControlCommitSha: FIN015_PRODUCTION_CONTROL_COMMIT,
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

function cliArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    if (!/^--[a-z][a-z-]*$/u.test(flag) || values.has(flag)) {
      fail(
        "FIN015_RUNTIME_ARGUMENTS_INVALID",
        "FIN-015 prepare arguments are invalid or duplicated."
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
      "FIN015_RUNTIME_ARGUMENTS_INVALID",
      "FIN-015 prepare arguments are incomplete or unexpected."
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
  process.stdout.write(
    `${canonicalJson(
      await prepareFin015ProductionBundle(cliArguments(argv))
    )}\n`
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    process.stderr.write(
      `${canonicalJson({
        schema: FIN015_RUNTIME_SCHEMA,
        ok: false,
        code: error?.code ?? "FIN015_PRODUCTION_PREPARE_FAILED"
      })}\n`
    );
    process.exitCode = 1;
  });
}
