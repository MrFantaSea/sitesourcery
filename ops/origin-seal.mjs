#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  canonicalJson,
  readJsonObject
} from "./immutable-evidence.mjs";
import {
  verifyOriginReleaseRepository
} from "./origin-seal-repository.mjs";

const DEFAULT_PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

function argumentsFrom(argv) {
  if (argv.length !== 2 || argv[0] !== "--input") {
    throw new Error("Usage: origin-seal.mjs --input ABSOLUTE_PATH");
  }
  if (!path.isAbsolute(argv[1])) {
    throw new Error("Origin release input path must be absolute.");
  }
  return { inputPath: path.resolve(argv[1]) };
}

export async function originSealFromFile({
  inputPath,
  projectRoot = DEFAULT_PROJECT_ROOT
}) {
  return verifyOriginReleaseRepository({
    projectRoot,
    releaseInput: await readJsonObject(
      inputPath,
      "Origin successor release input"
    )
  });
}

async function main() {
  const seal = await originSealFromFile(argumentsFrom(process.argv.slice(2)));
  process.stdout.write(`${canonicalJson(seal)}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(() => {
    process.stderr.write(
      '{"schema":"sitesourcery.origin-seal-failure/v1","ok":false,"code":"ORIGIN_SEAL_FAILED"}\n'
    );
    process.exitCode = 1;
  });
}
