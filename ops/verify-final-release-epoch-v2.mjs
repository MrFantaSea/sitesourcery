#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  readInstalledFinalReleaseEpochV2
} from "./final-release-epoch-v2.mjs";

function argumentsFrom(argv) {
  const names = new Map([
    ["--epoch", "epochPath"],
    ["--epoch-sha256", "expectedEpochFileSha256"],
    ["--origin-seal", "originSealPath"],
    ["--origin-seal-sha256", "expectedOriginSealFileSha256"],
    ["--installed-readback", "installedReadbackPath"],
    [
      "--installed-readback-sha256",
      "expectedInstalledReadbackFileSha256"
    ]
  ]);
  if (argv.length !== names.size * 2) {
    throw new Error(
      "Final release epoch verifier arguments are incomplete."
    );
  }
  const selected = {};
  for (let index = 0; index < argv.length; index += 2) {
    const field = names.get(argv[index]);
    if (!field || Object.hasOwn(selected, field)) {
      throw new Error("Final release epoch verifier arguments are invalid.");
    }
    selected[field] = argv[index + 1];
  }
  for (const field of [
    "epochPath",
    "originSealPath",
    "installedReadbackPath"
  ]) {
    if (!path.isAbsolute(selected[field])) {
      throw new Error("Final release evidence paths must be absolute.");
    }
    selected[field] = path.resolve(selected[field]);
  }
  return selected;
}

export async function verifyFinalReleaseEpochV2File(options) {
  const epoch = await readInstalledFinalReleaseEpochV2(options);
  return Object.freeze({
    valid: true,
    schema: epoch.schema,
    state: epoch.state,
    epochId: epoch.epochId,
    bindingSha256: epoch.bindingSha256,
    candidateCommitSha: epoch.identity.sourceCommitSha,
    candidateTreeSha: epoch.identity.sourceTreeSha,
    migrationCount: epoch.identity.migrationCount,
    latestMigration: epoch.identity.latestMigration,
    providerEffectsAllowed: false,
    customerEffectsAllowed: false,
    deploymentAllowed: false,
    dnsMutationAllowed: false
  });
}

async function main() {
  const result = await verifyFinalReleaseEpochV2File(
    argumentsFrom(process.argv.slice(2))
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(() => {
    process.stderr.write(
      '{"schema":"sitesourcery.final-release-epoch-failure/v2","ok":false,"code":"FINAL_RELEASE_EPOCH_INVALID"}\n'
    );
    process.exitCode = 1;
  });
}
