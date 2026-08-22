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
import {
  createHeldFinalReleaseEpochV2
} from "./final-release-epoch-v2.mjs";
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
  ORIGIN_HELD_AUTHORITY,
  ORIGIN_LOOPBACK_EXPECTATIONS,
  createOriginInstalledReadback,
  expectedOriginInstalledIdentity,
  expectedOriginInstalledWorker
} from "./origin-seal-runtime.mjs";
import {
  verifyOriginReleaseRepository
} from "./origin-seal-repository.mjs";
import {
  verifyCiReleaseCandidate
} from "./ci-release-proof-repository.mjs";

export const FIN012_RUNTIME_SCHEMA =
  "sitesourcery.fin012-production-runtime/v1";
export const FIN012_BUNDLE_SCHEMA =
  "sitesourcery.fin012-production-bundle/v1";
export const FIN012_CANDIDATE_COMMIT =
  "14ca61bd0991c0d326699311e380c29c621931df";
export const FIN012_CANDIDATE_TREE =
  "b953a3fbfd5853b29f3e72f0f05c7f75e04eba4d";
export const FIN012_HELD_CONTROL_COMMIT =
  "0cd27a13b2e6ad74829c8700c6bc0dec577f3a73";
export const FIN012_HELD_CONTROL_TREE =
  "1f9a0945c86111100b8eac9b4e6bb422909f443d";
export const FIN012_PREDECESSOR_COMMIT =
  "e8862278eb66e87d3536b4e084dc9647c996d993";
export const FIN012_PREDECESSOR_TREE =
  "ac53f6a59feb9ab7b6e05cb8e03d9c8bcc810eb2";
export const FIN012_SUCCESSOR_INPUT_SHA256 =
  "498823fb09da83c4cfc628a3d34fd3c08bd1462b3d4f507a5919f520bf923329";
export const FIN012_SUCCESSOR_INPUT_DIGEST =
  "00c505c21f447d667b0fa23dffd10a30232a8bbc9e13d4df1d12cd489f70d67e";
export const FIN012_CI_FINAL_RECEIPT_DIGEST =
  "1c73c2bc46c4f69c6da606307abf1489fe12b80058d9a9488c40b7e4dd5ff89b";
export const FIN012_CI_FINAL_RECEIPT_FILE_SHA256 =
  "c249f6893eee9265c2c60cbbd14590e26f216565578a96b06902bb4806a1a037";
export const FIN012_ORIGIN_SEAL_SHA256 =
  "990acbec0547cf386a1c365f72bb3f328f9d667bce197f4c245b0e6f3b62ee9d";
export const FIN012_PRODUCTION_ROOT =
  "/home/simtech/sitesourcery-production";
export const FIN012_RELEASE_ROOT =
  `${FIN012_PRODUCTION_ROOT}/releases/${FIN012_CANDIDATE_COMMIT}`;
export const FIN012_NODE =
  `${FIN012_PRODUCTION_ROOT}/toolchain/node-v24.18.0-linux-x64/bin/node`;
export const FIN012_RUNTIME_DIRECTORY = "/run/sitesourcery";
export const FIN012_BACKUP_QUIESCE_PATH =
  `${FIN012_RUNTIME_DIRECTORY}/BACKUP_QUIESCE`;
export const FIN012_INSTALLED_HOSTED_ENVIRONMENT_PATH =
  `/etc/sitesourcery/hosted.env.${FIN012_CANDIDATE_COMMIT}`;
export const FIN012_INSTALLED_WRAPPER_PATH =
  `/etc/sitesourcery/api-and-tenant.${FIN012_CANDIDATE_COMMIT}.sh`;
export const FIN012_ACTIVE_EVIDENCE = Object.freeze({
  epoch: "/etc/sitesourcery/final-release-epoch-v2.json",
  originSeal: "/etc/sitesourcery/origin-seal.json",
  installedReadback: "/etc/sitesourcery/origin-installed-readback.json"
});
export const FIN012_RETAINED_EVIDENCE = Object.freeze({
  epoch:
    `/etc/sitesourcery/fin012-${FIN012_CANDIDATE_COMMIT}-final-release-epoch-v2.json`,
  originSeal:
    `/etc/sitesourcery/fin012-${FIN012_CANDIDATE_COMMIT}-origin-seal.json`,
  installedReadback:
    `/etc/sitesourcery/fin012-${FIN012_CANDIDATE_COMMIT}-origin-installed-readback.json`
});
export const FIN012_SUCCESSOR_INPUT_RELATIVE_PATH =
  `ops/releases/ci-successor-inputs/${FIN012_CANDIDATE_COMMIT}.json`;
export const FIN012_CI_RECEIPT_RELATIVE_PATH =
  "ops/releases/fin012-production-control/ci-held-final-receipt.json";
const DEFAULT_CONTROL_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

const SHA256 = /^[a-f0-9]{64}$/u;
const REQUIRED_HELD_MODES = Object.freeze([
  "SITESOURCERY_RESEND_WEBHOOK_MODE",
  "SITESOURCERY_STRIPE_MODE",
  "SITESOURCERY_TWILIO_INBOUND_EVENT_MODE",
  "SITESOURCERY_TWILIO_RESPONDER_EVENT_MODE",
  "SITESOURCERY_TWILIO_VOICE_ACCESS_MODE",
  "SITESOURCERY_TWILIO_VOICE_DIAL_MODE"
]);
const FORBIDDEN_HELD_NAMES = Object.freeze([
  "SITESOURCERY_OFFER_CATALOG_PATH",
  "SITESOURCERY_RESPONDER_MATERIAL_KEY_BASE64URL",
  "SITESOURCERY_RESEND_WEBHOOK_SIGNING_SECRET",
  "SITESOURCERY_STRIPE_SECRET_KEY",
  "SITESOURCERY_TWILIO_ACCOUNT_SID",
  "SITESOURCERY_TWILIO_VOICE_API_KEY_SECRET",
  "SITESOURCERY_TWILIO_VOICE_API_KEY_SID",
  "SITESOURCERY_TWILIO_WEBHOOK_AUTH_TOKEN"
]);

export class Fin012RuntimeFailure extends Error {
  constructor(code, message) {
    super(message);
    this.name = "Fin012RuntimeFailure";
    this.code = code;
  }
}

function fail(code, message) {
  throw new Fin012RuntimeFailure(code, message);
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
    fail("FIN012_AUTHORITY_INVALID", `${label} drifted from the exact FIN-012 authority.`);
  }
}

function exactInstant(value) {
  const selected = new Date(value);
  if (
    typeof value !== "string" ||
    Number.isNaN(selected.valueOf()) ||
    selected.toISOString() !== value
  ) {
    fail("FIN012_OBSERVATION_INVALID", "FIN-012 observedAt must be an exact ISO instant.");
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
      fail("FIN012_AUTHORITY_FILE_INVALID", `${label} changed during its no-follow read.`);
    }
    exact(sha256Bytes(bytes), expectedSha256, `${label} file digest`);
    return parseJsonObject(bytes.toString("utf8"), label);
  } catch (error) {
    if (error instanceof Fin012RuntimeFailure) throw error;
    fail("FIN012_AUTHORITY_FILE_INVALID", `${label} is unavailable or unsafe.`);
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

function environmentText(values) {
  return [
    "# FIN-012 exact production-held hosted environment",
    "# Root-owned mode 0640. Values are never printed or committed.",
    ...[...values.keys()].sort().map((name) => `${name}=${values.get(name)}`),
    ""
  ].join("\n");
}

function assertHeldEnvironment(values) {
  for (const name of REQUIRED_HELD_MODES) {
    exact(
      readFin010EnvironmentValue(values, name, "FIN-012 predecessor environment"),
      "held",
      name
    );
  }
  for (const name of FORBIDDEN_HELD_NAMES) {
    if (values.has(name)) {
      fail(
        "FIN012_HELD_PROVIDER_SECRET_PRESENT",
        `${name} cannot enter the production environment while its purpose is held.`
      );
    }
  }
  for (const name of values.keys()) {
    if (
      (name.startsWith("SITESOURCERY_STRIPE_") &&
        name !== "SITESOURCERY_STRIPE_MODE") ||
      (name.startsWith("SITESOURCERY_TWILIO_") &&
        !REQUIRED_HELD_MODES.includes(name))
    ) {
      fail(
        "FIN012_HELD_PROVIDER_SECRET_PRESENT",
        `${name} cannot enter the production environment while its purpose is held.`
      );
    }
  }
  for (const name of [
    "SITESOURCERY_DATABASE_URL",
    "SITESOURCERY_DATABASE_SSL",
    "SITESOURCERY_IDENTITY_PEPPER",
    "SITESOURCERY_IDENTITY_PEPPER_CONFIG",
    "SITESOURCERY_CONTACT_VAULT_KEY",
    "SITESOURCERY_RESEND_API_KEY",
    "SITESOURCERY_RELEASE_EPOCH_FILE",
    "SITESOURCERY_RELEASE_EPOCH_SHA256",
    "SITESOURCERY_ORIGIN_SEAL_FILE",
    "SITESOURCERY_ORIGIN_SEAL_FILE_SHA256",
    "SITESOURCERY_ORIGIN_INSTALLED_READBACK_FILE",
    "SITESOURCERY_ORIGIN_INSTALLED_READBACK_FILE_SHA256"
  ]) {
    readFin010EnvironmentValue(values, name, "FIN-012 predecessor environment");
  }
}

export function createFin012HostedEnvironment({
  predecessorEnvironmentText,
  evidence
}) {
  const values = parseFin010EnvironmentFile(
    predecessorEnvironmentText,
    "FIN-012 predecessor production environment"
  );
  assertHeldEnvironment(values);
  for (const [name, entry] of Object.entries({
    SITESOURCERY_RELEASE_EPOCH_FILE: FIN012_ACTIVE_EVIDENCE.epoch,
    SITESOURCERY_RELEASE_EPOCH_SHA256: evidence.epoch.sha256,
    SITESOURCERY_ORIGIN_SEAL_FILE: FIN012_ACTIVE_EVIDENCE.originSeal,
    SITESOURCERY_ORIGIN_SEAL_FILE_SHA256: evidence.originSeal.sha256,
    SITESOURCERY_ORIGIN_INSTALLED_READBACK_FILE:
      FIN012_ACTIVE_EVIDENCE.installedReadback,
    SITESOURCERY_ORIGIN_INSTALLED_READBACK_FILE_SHA256:
      evidence.installedReadback.sha256,
    SITESOURCERY_REGISTRATION_TRANSPORT_MODULE:
      `${FIN012_RELEASE_ROOT}/server/hosted/resend-mail-transport.mjs`,
    SITESOURCERY_RECOVERY_TRANSPORT_MODULE:
      `${FIN012_RELEASE_ROOT}/server/hosted/resend-mail-transport.mjs`
  })) values.set(name, entry);
  assertHeldEnvironment(values);
  return freeze({
    text: environmentText(values),
    nameCount: values.size,
    providers: {
      registrationMail: "production_existing_approved",
      recoveryMail: "production_existing_approved",
      resendWebhook: "held",
      stripe: "held_no_secret_loaded",
      twilio: "held_no_secret_loaded",
      domains: "held",
      publication: "held",
      workers: "retained_disabled_held"
    },
    secretValuesDisclosed: false,
    secretDerivedDigestsRecorded: false
  });
}

export async function verifyFin012ReleaseAuthorities({
  controlRoot,
  candidateRoot,
  gitRunner
}) {
  const inputPath = path.join(controlRoot, FIN012_SUCCESSOR_INPUT_RELATIVE_PATH);
  const receiptPath = path.join(controlRoot, FIN012_CI_RECEIPT_RELATIVE_PATH);
  const successorInput = validateCiReleaseSuccessorInput(
    await readExactJson(
      inputPath,
      FIN012_SUCCESSOR_INPUT_SHA256,
      "FIN-012 successor input"
    )
  );
  const ciFinalReceipt = validateCiReleaseFinalReceipt(
    await readExactJson(
      receiptPath,
      FIN012_CI_FINAL_RECEIPT_FILE_SHA256,
      "FIN-012 held CI final receipt"
    )
  );
  exact(successorInput.digest, FIN012_SUCCESSOR_INPUT_DIGEST, "Successor input");
  exact(ciFinalReceipt.digest, FIN012_CI_FINAL_RECEIPT_DIGEST, "Held CI receipt");
  exact(ciFinalReceipt.candidateSha, FIN012_CANDIDATE_COMMIT, "Held CI candidate");
  exact(ciFinalReceipt.workflowSha, FIN012_HELD_CONTROL_COMMIT, "Held CI control");
  exact(
    successorInput.originReleaseInput.epoch.source.treeSha,
    FIN012_CANDIDATE_TREE,
    "Candidate tree"
  );
  exact(
    successorInput.originReleaseInput.epoch.rollback.predecessorCommitSha,
    FIN012_PREDECESSOR_COMMIT,
    "Rollback predecessor"
  );
  exact(
    successorInput.originReleaseInput.epoch.rollback.predecessorTreeSha,
    FIN012_PREDECESSOR_TREE,
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
  exact(originSeal.sealSha256, FIN012_ORIGIN_SEAL_SHA256, "Origin seal");
  return freeze({ successorInput, ciFinalReceipt, originSeal });
}

export async function createFin012ProductionBundle({
  controlRoot,
  candidateRoot,
  predecessorEnvironmentText,
  observedAt,
  gitRunner
}) {
  exactInstant(observedAt);
  const authorities = await verifyFin012ReleaseAuthorities({
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
  const environment = createFin012HostedEnvironment({
    predecessorEnvironmentText,
    evidence
  });
  const wrapper = createFin012Wrapper();
  const units = createFin012UserUnitSet({ evidence });
  const payload = {
    schema: FIN012_BUNDLE_SCHEMA,
    state: "prepared_held_no_install",
    observedAt,
    source: {
      candidateCommitSha: FIN012_CANDIDATE_COMMIT,
      candidateTreeSha: FIN012_CANDIDATE_TREE,
      heldControlCommitSha: FIN012_HELD_CONTROL_COMMIT,
      heldControlTreeSha: FIN012_HELD_CONTROL_TREE,
      predecessorCommitSha: FIN012_PREDECESSOR_COMMIT,
      predecessorTreeSha: FIN012_PREDECESSOR_TREE
    },
    proof: {
      successorInputFileSha256: FIN012_SUCCESSOR_INPUT_SHA256,
      successorInputDigest: FIN012_SUCCESSOR_INPUT_DIGEST,
      ciFinalReceiptDigest: FIN012_CI_FINAL_RECEIPT_DIGEST,
      ciRunId: authorities.ciFinalReceipt.runId,
      ciRunAttempt: authorities.ciFinalReceipt.runAttempt,
      originSealSha256: authorities.originSeal.sealSha256
    },
    evidence: Object.fromEntries(
      Object.entries(evidence).map(([name, entry]) => [name, {
        byteCount: entry.byteCount,
        sha256: entry.sha256,
        retainedPath: FIN012_RETAINED_EVIDENCE[name],
        activePath: FIN012_ACTIVE_EVIDENCE[name]
      }])
    ),
    runtime: {
      releaseRoot: FIN012_RELEASE_ROOT,
      node: FIN012_NODE,
      environmentPath: FIN012_INSTALLED_HOSTED_ENVIRONMENT_PATH,
      wrapperPath: FIN012_INSTALLED_WRAPPER_PATH,
      environmentNameCount: environment.nameCount,
      providers: environment.providers
    },
    authority: {
      parallelInstallAuthorized: false,
      databaseMigrationAuthorized: false,
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

export function createFin012Wrapper() {
  return `#!/bin/bash
set -euo pipefail

root=${FIN012_PRODUCTION_ROOT}
release=${FIN012_RELEASE_ROOT}
node=${FIN012_NODE}
api_pid=
tenant_pid=

stop_children() {
  if test -n "\${api_pid:-}"; then kill -TERM "$api_pid" 2>/dev/null || true; fi
  if test -n "\${tenant_pid:-}"; then kill -TERM "$tenant_pid" 2>/dev/null || true; fi
  if test -n "\${api_pid:-}"; then wait "$api_pid" 2>/dev/null || true; fi
  if test -n "\${tenant_pid:-}"; then wait "$tenant_pid" 2>/dev/null || true; fi
}
trap stop_children EXIT INT TERM

test -d "${FIN012_RUNTIME_DIRECTORY}"
test ! -L "${FIN012_RUNTIME_DIRECTORY}"
test "$(stat -c '%U:%G:%a' "${FIN012_RUNTIME_DIRECTORY}")" = "root:simtech:770"
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

export function createFin012UserUnitSet({ evidence }) {
  for (const name of ["epoch", "originSeal", "installedReadback"]) {
    if (!SHA256.test(evidence?.[name]?.sha256 ?? "")) {
      fail("FIN012_EVIDENCE_INVALID", `FIN-012 ${name} evidence is invalid.`);
    }
  }
  const verify = `${FIN012_NODE} ${FIN012_RELEASE_ROOT}/ops/verify-final-release-epoch-v2.mjs --epoch ${FIN012_ACTIVE_EVIDENCE.epoch} --epoch-sha256 ${evidence.epoch.sha256} --origin-seal ${FIN012_ACTIVE_EVIDENCE.originSeal} --origin-seal-sha256 ${evidence.originSeal.sha256} --installed-readback ${FIN012_ACTIVE_EVIDENCE.installedReadback} --installed-readback-sha256 ${evidence.installedReadback.sha256}`;
  const runtime = `[Unit]
Description=Site Sourcery FIN-012 exact production-held API and tenant runtime
After=network-online.target sitesourcery-production-db-tunnel.service
Wants=network-online.target
Requires=sitesourcery-production-db-tunnel.service
ConditionPathExists=${FIN012_PRODUCTION_ROOT}/run/RUNTIME_APPROVED
ConditionPathExists=!${FIN012_BACKUP_QUIESCE_PATH}
ConditionPathExists=!%t/sitesourcery-production/BACKUP_QUIESCE

[Service]
Type=simple
WorkingDirectory=${FIN012_RELEASE_ROOT}
Environment=NODE_ENV=production
EnvironmentFile=${FIN012_INSTALLED_HOSTED_ENVIRONMENT_PATH}
ExecStartPre=${FIN012_NODE} ${FIN012_RELEASE_ROOT}/server/hosted/assert-runtime.mjs
ExecStartPre=+${verify}
ExecStart=+${FIN012_INSTALLED_WRAPPER_PATH}
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
ReadOnlyPaths=${FIN012_RELEASE_ROOT} ${FIN012_NODE.replace(/\/bin\/node$/u, "")} /etc/sitesourcery
ReadWritePaths=${FIN012_PRODUCTION_ROOT}/state ${FIN012_PRODUCTION_ROOT}/run ${FIN012_RUNTIME_DIRECTORY}
LimitNOFILE=8192
TasksMax=256

[Install]
WantedBy=default.target
`;
  const staticUnit = `[Unit]
Description=Site Sourcery FIN-012 exact immutable production artifact
After=network-online.target sitesourcery-production.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${FIN012_RELEASE_ROOT}/_hosted
ExecStart=/usr/bin/python3 -m http.server 8899 --bind 127.0.0.1 --directory ${FIN012_RELEASE_ROOT}/_hosted
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
ReadOnlyPaths=${FIN012_RELEASE_ROOT}/_hosted

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

export async function prepareFin012ProductionBundle({
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
      fail("FIN012_ARGUMENTS_INVALID", `${name} must be an absolute path.`);
    }
  }
  const parent = path.dirname(path.resolve(outputPath));
  const parentMetadata = await lstat(parent);
  if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink()) {
    fail("FIN012_OUTPUT_INVALID", "FIN-012 output parent must be a real directory.");
  }
  const bundle = await createFin012ProductionBundle({
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
      ["final-release-epoch-v2.json", Buffer.from(bundle.evidence.epoch.text, "utf8"), 0o400],
      ["origin-seal.json", Buffer.from(bundle.evidence.originSeal.text, "utf8"), 0o400],
      ["origin-installed-readback.json", Buffer.from(bundle.evidence.installedReadback.text, "utf8"), 0o400],
      ["hosted.env", Buffer.from(bundle.environment.text, "utf8"), 0o600],
      ["api-and-tenant.sh", Buffer.from(bundle.wrapper, "utf8"), 0o500],
      [
        "sitesourcery-production.service",
        Buffer.from(bundle.units["sitesourcery-production.service"], "utf8"),
        0o400
      ],
      [
        "sitesourcery-production-static.service",
        Buffer.from(bundle.units["sitesourcery-production-static.service"], "utf8"),
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
    schema: FIN012_RUNTIME_SCHEMA,
    ok: true,
    state: bundle.receipt.state,
    outputPath: selectedOutput,
    receiptDigest: bundle.receipt.digest,
    candidateCommitSha: FIN012_CANDIDATE_COMMIT,
    candidateTreeSha: FIN012_CANDIDATE_TREE,
    heldControlCommitSha: FIN012_HELD_CONTROL_COMMIT,
    secretValuesDisclosed: false,
    secretDerivedDigestsRecorded: false,
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
      fail("FIN012_ARGUMENTS_INVALID", "FIN-012 prepare arguments are invalid or duplicated.");
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
    fail("FIN012_ARGUMENTS_INVALID", "FIN-012 prepare arguments are incomplete or unexpected.");
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
    await prepareFin012ProductionBundle(cliArguments(argv))
  )}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    process.stderr.write(`${canonicalJson({
      schema: FIN012_RUNTIME_SCHEMA,
      ok: false,
      code: error?.code ?? "FIN012_PRODUCTION_PREPARE_FAILED"
    })}\n`);
    process.exitCode = 1;
  });
}
