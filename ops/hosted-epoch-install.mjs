#!/usr/bin/env node

import {
  lstat
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  canonicalJson,
  readJsonObject,
  writeImmutableEvidence
} from "./immutable-evidence.mjs";
import {
  createHostedEpochInstallDryRunReceipt
} from "./hosted-epoch-install-runtime.mjs";
import {
  verifyOriginReleaseRepository
} from "./origin-seal-repository.mjs";
import {
  ORIGIN_HELD_AUTHORITY,
  ORIGIN_LOOPBACK_EXPECTATIONS,
  compareOriginInstalledReadback,
  createOriginInstallPlan,
  createOriginInstalledReadback,
  createOriginRollbackPlan,
  expectedOriginInstalledIdentity,
  expectedOriginInstalledWorker
} from "./origin-seal-runtime.mjs";

const DEFAULT_PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

function fail(message) {
  throw new Error(message);
}

function argumentsFrom(argv) {
  if (argv.length !== 8) {
    fail(
      "Usage: hosted-epoch-install.mjs --input ABSOLUTE_PATH --output ABSOLUTE_PATH --run-id SAFE_ID --observed-at ISO_INSTANT"
    );
  }
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    if (!/^--[a-z][a-z-]*$/u.test(flag) || values.has(flag)) {
      fail("Hosted epoch install arguments are invalid or duplicated.");
    }
    values.set(flag, argv[index + 1]);
  }
  const expected = ["--input", "--observed-at", "--output", "--run-id"];
  if (
    canonicalJson([...values.keys()].sort()) !==
      canonicalJson(expected)
  ) {
    fail("Hosted epoch install arguments are incomplete or unexpected.");
  }
  for (const flag of ["--input", "--output"]) {
    if (!path.isAbsolute(values.get(flag))) {
      fail(`${flag} must be an absolute path.`);
    }
  }
  return {
    inputPath: path.resolve(values.get("--input")),
    outputPath: path.resolve(values.get("--output")),
    runId: values.get("--run-id"),
    observedAt: values.get("--observed-at")
  };
}

async function requireRealOutputParent(outputPath) {
  const parent = path.dirname(outputPath);
  const metadata = await lstat(parent);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink()
  ) {
    fail("Hosted epoch install output parent must be a real directory.");
  }
}

export async function composeHostedEpochInstallDryRun({
  projectRoot,
  releaseInput,
  runId,
  observedAt,
  gitRunner
}) {
  const originSeal = await verifyOriginReleaseRepository({
    projectRoot,
    releaseInput,
    ...(gitRunner ? { gitRunner } : {})
  });
  const installPlan = createOriginInstallPlan(originSeal);
  const projectedInstalledReadback = createOriginInstalledReadback({
    seal: originSeal,
    observedAt,
    identity: expectedOriginInstalledIdentity(originSeal),
    worker: expectedOriginInstalledWorker(originSeal),
    listeners: structuredClone(ORIGIN_LOOPBACK_EXPECTATIONS),
    authority: structuredClone(ORIGIN_HELD_AUTHORITY)
  });
  const readbackReceipt = compareOriginInstalledReadback({
    seal: originSeal,
    readback: projectedInstalledReadback
  });
  const rollbackPlan = createOriginRollbackPlan(originSeal);
  const receipt = createHostedEpochInstallDryRunReceipt({
    runId,
    observedAt,
    releaseInput,
    originSeal,
    installPlan,
    projectedInstalledReadback,
    readbackReceipt,
    rollbackPlan
  });
  return Object.freeze({
    receipt,
    originSeal,
    installPlan,
    projectedInstalledReadback,
    readbackReceipt,
    rollbackPlan
  });
}

export async function hostedEpochInstallDryRunFromFile({
  inputPath,
  outputPath,
  runId,
  observedAt,
  projectRoot = DEFAULT_PROJECT_ROOT,
  gitRunner
}) {
  await requireRealOutputParent(outputPath);
  const composed = await composeHostedEpochInstallDryRun({
    projectRoot,
    releaseInput: await readJsonObject(
      inputPath,
      "Hosted epoch install origin release input"
    ),
    runId,
    observedAt,
    gitRunner
  });
  const written = await writeImmutableEvidence(outputPath, composed.receipt);
  return Object.freeze({ ...composed, written });
}

async function main() {
  const result = await hostedEpochInstallDryRunFromFile(
    argumentsFrom(process.argv.slice(2))
  );
  process.stdout.write(`${canonicalJson({
    receipt: result.receipt,
    written: result.written
  })}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(() => {
    process.stderr.write(
      '{"schema":"sitesourcery.hosted-epoch-install-dry-run-failure/v1","ok":false,"code":"HOSTED_EPOCH_INSTALL_DRY_RUN_FAILED"}\n'
    );
    process.exitCode = 1;
  });
}
