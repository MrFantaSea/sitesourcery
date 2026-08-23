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
  createFin012HostedEnvironment,
  createFin012UserUnitSet,
  createFin012Wrapper,
  FIN012_CANDIDATE_COMMIT as FIN012_LIVE_PREDECESSOR_COMMIT,
  FIN012_RELEASE_ROOT as FIN012_LIVE_PREDECESSOR_RELEASE_ROOT
} from "./fin012-production-runtime.mjs";
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

export const FIN012_STRIPE_DOWNLOAD_RUNTIME_SCHEMA =
  "sitesourcery.fin012-stripe-download-production-runtime/v1";
export const FIN012_STRIPE_DOWNLOAD_BUNDLE_SCHEMA =
  "sitesourcery.fin012-stripe-download-production-bundle/v1";
export const FIN012_STRIPE_DOWNLOAD_CANDIDATE_COMMIT =
  "787bb678d73994a44b8e911080e0a9996160c184";
export const FIN012_STRIPE_DOWNLOAD_CANDIDATE_TREE =
  "e94a44d3750d341f84efa2d4e31bf7116fa8652d";
export const FIN012_STRIPE_DOWNLOAD_HELD_CONTROL_COMMIT =
  "a79182c6e624c2585525c524d7416fd57d7ce52d";
export const FIN012_STRIPE_DOWNLOAD_HELD_CONTROL_TREE =
  "fd66a88b43f55bdbe14d6b34f38a12b757369b69";
export const FIN012_STRIPE_DOWNLOAD_PREDECESSOR_COMMIT =
  "14ca61bd0991c0d326699311e380c29c621931df";
export const FIN012_STRIPE_DOWNLOAD_PREDECESSOR_TREE =
  "b953a3fbfd5853b29f3e72f0f05c7f75e04eba4d";
export const FIN012_STRIPE_DOWNLOAD_SUCCESSOR_INPUT_SHA256 =
  "5fe7070738908c1971643af6ef29e3c7c6437b53a9d6dd7c526373b4aa722da4";
export const FIN012_STRIPE_DOWNLOAD_SUCCESSOR_INPUT_DIGEST =
  "7bb0b82962fa2abe7aae50e0f1cae99a4ec7758735b262f7b9b05d0a83e09b49";
export const FIN012_STRIPE_DOWNLOAD_CI_FINAL_RECEIPT_DIGEST =
  "29c0cf2ceff8a424c7b2dff56b1f46214f00c9632c3639a84feda58d554e630f";
export const FIN012_STRIPE_DOWNLOAD_CI_FINAL_RECEIPT_FILE_SHA256 =
  "c59b793f086c45b6a3dd01c528c417a10e893a27e3afede45ab053cb3fbdbd2c";
export const FIN012_STRIPE_DOWNLOAD_ORIGIN_SEAL_SHA256 =
  "f9b387638485835a2dce19cc7af5c1cd6709a36ac1ec0ee3a58cc40e747f6baa";
export const FIN012_STRIPE_DOWNLOAD_PRODUCTION_ROOT =
  "/home/simtech/sitesourcery-production";
export const FIN012_STRIPE_DOWNLOAD_RELEASE_ROOT =
  `${FIN012_STRIPE_DOWNLOAD_PRODUCTION_ROOT}/releases/${FIN012_STRIPE_DOWNLOAD_CANDIDATE_COMMIT}`;
export const FIN012_STRIPE_DOWNLOAD_NODE =
  `${FIN012_STRIPE_DOWNLOAD_PRODUCTION_ROOT}/toolchain/node-v24.18.0-linux-x64/bin/node`;
export const FIN012_STRIPE_DOWNLOAD_RUNTIME_DIRECTORY = "/run/sitesourcery";
export const FIN012_STRIPE_DOWNLOAD_BACKUP_QUIESCE_PATH =
  `${FIN012_STRIPE_DOWNLOAD_RUNTIME_DIRECTORY}/BACKUP_QUIESCE`;
export const FIN012_STRIPE_DOWNLOAD_HOSTED_ENVIRONMENT_PATH =
  `/etc/sitesourcery/hosted.env.${FIN012_STRIPE_DOWNLOAD_CANDIDATE_COMMIT}`;
export const FIN012_STRIPE_DOWNLOAD_WRAPPER_PATH =
  `/etc/sitesourcery/api-and-tenant.${FIN012_STRIPE_DOWNLOAD_CANDIDATE_COMMIT}.sh`;
export const FIN012_STRIPE_DOWNLOAD_ACTIVE_EVIDENCE = Object.freeze({
  epoch: "/etc/sitesourcery/final-release-epoch-v2.json",
  originSeal: "/etc/sitesourcery/origin-seal.json",
  installedReadback: "/etc/sitesourcery/origin-installed-readback.json"
});
export const FIN012_STRIPE_DOWNLOAD_RETAINED_EVIDENCE = Object.freeze({
  epoch:
    `/etc/sitesourcery/fin012-${FIN012_STRIPE_DOWNLOAD_CANDIDATE_COMMIT}-final-release-epoch-v2.json`,
  originSeal:
    `/etc/sitesourcery/fin012-${FIN012_STRIPE_DOWNLOAD_CANDIDATE_COMMIT}-origin-seal.json`,
  installedReadback:
    `/etc/sitesourcery/fin012-${FIN012_STRIPE_DOWNLOAD_CANDIDATE_COMMIT}-origin-installed-readback.json`
});
export const FIN012_STRIPE_DOWNLOAD_SUCCESSOR_INPUT_RELATIVE_PATH =
  `ops/releases/ci-successor-inputs/${FIN012_STRIPE_DOWNLOAD_CANDIDATE_COMMIT}.json`;
export const FIN012_STRIPE_DOWNLOAD_CI_RECEIPT_RELATIVE_PATH =
  "ops/releases/fin012-stripe-download-production-control/ci-held-final-receipt.json";

const DEFAULT_CONTROL_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const SHA256 = /^[a-f0-9]{64}$/u;

export class Fin012StripeDownloadRuntimeFailure extends Error {
  constructor(code, message) {
    super(message);
    this.name = "Fin012StripeDownloadRuntimeFailure";
    this.code = code;
  }
}

function fail(code, message) {
  throw new Fin012StripeDownloadRuntimeFailure(code, message);
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
      "FIN012_STRIPE_DOWNLOAD_AUTHORITY_INVALID",
      `${label} drifted from the exact FIN-012 Stripe Download authority.`
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
      "FIN012_STRIPE_DOWNLOAD_OBSERVATION_INVALID",
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
        "FIN012_STRIPE_DOWNLOAD_AUTHORITY_FILE_INVALID",
        `${label} changed during its no-follow read.`
      );
    }
    exact(sha256Bytes(bytes), expectedSha256, `${label} file digest`);
    return parseJsonObject(bytes.toString("utf8"), label);
  } catch (error) {
    if (error instanceof Fin012StripeDownloadRuntimeFailure) throw error;
    fail(
      "FIN012_STRIPE_DOWNLOAD_AUTHORITY_FILE_INVALID",
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
      "FIN012_STRIPE_DOWNLOAD_TEMPLATE_INVALID",
      `${label} did not bind the exact successor.`
    );
  }
  return result;
}

export function createFin012StripeDownloadHostedEnvironment({
  predecessorEnvironmentText,
  evidence
}) {
  const inherited = createFin012HostedEnvironment({
    predecessorEnvironmentText,
    evidence
  });
  const text = replaceExact(
    inherited.text,
    FIN012_LIVE_PREDECESSOR_RELEASE_ROOT,
    FIN012_STRIPE_DOWNLOAD_RELEASE_ROOT,
    2,
    "Hosted environment"
  );
  exact(
    FIN012_LIVE_PREDECESSOR_COMMIT,
    FIN012_STRIPE_DOWNLOAD_PREDECESSOR_COMMIT,
    "Inherited held-environment predecessor"
  );
  return freeze({
    ...inherited,
    text,
    providers: {
      ...inherited.providers,
      stripe: "held_no_secret_loaded"
    }
  });
}

export function createFin012StripeDownloadWrapper() {
  return replaceExact(
    createFin012Wrapper(),
    FIN012_LIVE_PREDECESSOR_RELEASE_ROOT,
    FIN012_STRIPE_DOWNLOAD_RELEASE_ROOT,
    1,
    "API and tenant wrapper"
  );
}

export function createFin012StripeDownloadUserUnitSet({ evidence }) {
  const predecessorUnits = createFin012UserUnitSet({ evidence });
  return freeze({
    "sitesourcery-production.service": replaceExact(
      predecessorUnits["sitesourcery-production.service"],
      FIN012_STRIPE_DOWNLOAD_PREDECESSOR_COMMIT,
      FIN012_STRIPE_DOWNLOAD_CANDIDATE_COMMIT,
      6,
      "Production runtime unit"
    ),
    "sitesourcery-production-static.service": replaceExact(
      predecessorUnits["sitesourcery-production-static.service"],
      FIN012_STRIPE_DOWNLOAD_PREDECESSOR_COMMIT,
      FIN012_STRIPE_DOWNLOAD_CANDIDATE_COMMIT,
      3,
      "Production static unit"
    )
  });
}

export async function verifyFin012StripeDownloadAuthorities({
  controlRoot,
  candidateRoot,
  gitRunner
}) {
  const successorInput = validateCiReleaseSuccessorInput(
    await readExactJson(
      path.join(
        controlRoot,
        FIN012_STRIPE_DOWNLOAD_SUCCESSOR_INPUT_RELATIVE_PATH
      ),
      FIN012_STRIPE_DOWNLOAD_SUCCESSOR_INPUT_SHA256,
      "FIN-012 Stripe Download successor input"
    )
  );
  const ciFinalReceipt = validateCiReleaseFinalReceipt(
    await readExactJson(
      path.join(
        controlRoot,
        FIN012_STRIPE_DOWNLOAD_CI_RECEIPT_RELATIVE_PATH
      ),
      FIN012_STRIPE_DOWNLOAD_CI_FINAL_RECEIPT_FILE_SHA256,
      "FIN-012 Stripe Download held CI receipt"
    )
  );
  exact(
    successorInput.digest,
    FIN012_STRIPE_DOWNLOAD_SUCCESSOR_INPUT_DIGEST,
    "Successor input"
  );
  exact(
    ciFinalReceipt.digest,
    FIN012_STRIPE_DOWNLOAD_CI_FINAL_RECEIPT_DIGEST,
    "Held CI receipt"
  );
  exact(
    ciFinalReceipt.candidateSha,
    FIN012_STRIPE_DOWNLOAD_CANDIDATE_COMMIT,
    "Held CI candidate"
  );
  exact(
    ciFinalReceipt.workflowSha,
    FIN012_STRIPE_DOWNLOAD_HELD_CONTROL_COMMIT,
    "Held CI control"
  );
  exact(
    successorInput.originReleaseInput.epoch.source.treeSha,
    FIN012_STRIPE_DOWNLOAD_CANDIDATE_TREE,
    "Candidate tree"
  );
  exact(
    successorInput.originReleaseInput.epoch.rollback.predecessorCommitSha,
    FIN012_STRIPE_DOWNLOAD_PREDECESSOR_COMMIT,
    "Rollback predecessor"
  );
  exact(
    successorInput.originReleaseInput.epoch.rollback.predecessorTreeSha,
    FIN012_STRIPE_DOWNLOAD_PREDECESSOR_TREE,
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
    FIN012_STRIPE_DOWNLOAD_ORIGIN_SEAL_SHA256,
    "Origin seal"
  );
  return freeze({ successorInput, ciFinalReceipt, originSeal });
}

export async function createFin012StripeDownloadProductionBundle({
  controlRoot,
  candidateRoot,
  predecessorEnvironmentText,
  observedAt,
  gitRunner
}) {
  exactInstant(observedAt);
  const authorities = await verifyFin012StripeDownloadAuthorities({
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
  const environment = createFin012StripeDownloadHostedEnvironment({
    predecessorEnvironmentText,
    evidence
  });
  const wrapper = createFin012StripeDownloadWrapper();
  const units = createFin012StripeDownloadUserUnitSet({ evidence });
  const payload = {
    schema: FIN012_STRIPE_DOWNLOAD_BUNDLE_SCHEMA,
    state: "prepared_held_no_install",
    observedAt,
    source: {
      candidateCommitSha: FIN012_STRIPE_DOWNLOAD_CANDIDATE_COMMIT,
      candidateTreeSha: FIN012_STRIPE_DOWNLOAD_CANDIDATE_TREE,
      heldControlCommitSha: FIN012_STRIPE_DOWNLOAD_HELD_CONTROL_COMMIT,
      heldControlTreeSha: FIN012_STRIPE_DOWNLOAD_HELD_CONTROL_TREE,
      predecessorCommitSha: FIN012_STRIPE_DOWNLOAD_PREDECESSOR_COMMIT,
      predecessorTreeSha: FIN012_STRIPE_DOWNLOAD_PREDECESSOR_TREE
    },
    proof: {
      successorInputFileSha256:
        FIN012_STRIPE_DOWNLOAD_SUCCESSOR_INPUT_SHA256,
      successorInputDigest: FIN012_STRIPE_DOWNLOAD_SUCCESSOR_INPUT_DIGEST,
      ciFinalReceiptDigest:
        FIN012_STRIPE_DOWNLOAD_CI_FINAL_RECEIPT_DIGEST,
      ciRunId: authorities.ciFinalReceipt.runId,
      ciRunAttempt: authorities.ciFinalReceipt.runAttempt,
      originSealSha256: authorities.originSeal.sealSha256
    },
    evidence: Object.fromEntries(
      Object.entries(evidence).map(([name, entry]) => [name, {
        byteCount: entry.byteCount,
        sha256: entry.sha256,
        retainedPath: FIN012_STRIPE_DOWNLOAD_RETAINED_EVIDENCE[name],
        activePath: FIN012_STRIPE_DOWNLOAD_ACTIVE_EVIDENCE[name]
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
      releaseRoot: FIN012_STRIPE_DOWNLOAD_RELEASE_ROOT,
      node: FIN012_STRIPE_DOWNLOAD_NODE,
      environmentPath: FIN012_STRIPE_DOWNLOAD_HOSTED_ENVIRONMENT_PATH,
      wrapperPath: FIN012_STRIPE_DOWNLOAD_WRAPPER_PATH,
      environmentNameCount: environment.nameCount,
      providers: environment.providers
    },
    authority: {
      parallelInstallAuthorized: false,
      databaseMutationAuthorized: false,
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

export async function prepareFin012StripeDownloadProductionBundle({
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
        "FIN012_STRIPE_DOWNLOAD_ARGUMENTS_INVALID",
        `${name} must be an absolute path.`
      );
    }
  }
  const parentMetadata = await lstat(path.dirname(path.resolve(outputPath)));
  if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink()) {
    fail(
      "FIN012_STRIPE_DOWNLOAD_OUTPUT_INVALID",
      "Output parent must be a real directory."
    );
  }
  const bundle = await createFin012StripeDownloadProductionBundle({
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
    schema: FIN012_STRIPE_DOWNLOAD_RUNTIME_SCHEMA,
    ok: true,
    state: bundle.receipt.state,
    outputPath: selectedOutput,
    receiptDigest: bundle.receipt.digest,
    candidateCommitSha: FIN012_STRIPE_DOWNLOAD_CANDIDATE_COMMIT,
    candidateTreeSha: FIN012_STRIPE_DOWNLOAD_CANDIDATE_TREE,
    heldControlCommitSha: FIN012_STRIPE_DOWNLOAD_HELD_CONTROL_COMMIT,
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
        "FIN012_STRIPE_DOWNLOAD_ARGUMENTS_INVALID",
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
      "FIN012_STRIPE_DOWNLOAD_ARGUMENTS_INVALID",
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
    await prepareFin012StripeDownloadProductionBundle(cliArguments(argv))
  )}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    process.stderr.write(`${canonicalJson({
      schema: FIN012_STRIPE_DOWNLOAD_RUNTIME_SCHEMA,
      ok: false,
      code:
        error?.code ?? "FIN012_STRIPE_DOWNLOAD_PRODUCTION_PREPARE_FAILED"
    })}\n`);
    process.exitCode = 1;
  });
}
