#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  canonicalJson,
  readJsonObject
} from "./immutable-evidence.mjs";
import {
  compareOriginInstalledReadback
} from "./origin-seal-runtime.mjs";

function files(argv) {
  if (
    argv.length !== 4 ||
    argv[0] !== "--seal" ||
    argv[2] !== "--readback" ||
    !path.isAbsolute(argv[1]) ||
    !path.isAbsolute(argv[3])
  ) {
    throw new Error(
      "Usage: origin-installed-readback.mjs --seal ABSOLUTE_PATH --readback ABSOLUTE_PATH"
    );
  }
  return {
    sealPath: path.resolve(argv[1]),
    readbackPath: path.resolve(argv[3])
  };
}

export async function originInstalledReadbackFromFiles({ sealPath, readbackPath }) {
  const [seal, readback] = await Promise.all([
    readJsonObject(sealPath, "Origin seal"),
    readJsonObject(readbackPath, "Origin installed readback")
  ]);
  return compareOriginInstalledReadback({ seal, readback });
}

async function main() {
  const receipt = await originInstalledReadbackFromFiles(
    files(process.argv.slice(2))
  );
  process.stdout.write(`${canonicalJson(receipt)}\n`);
  if (receipt.state !== "verified") process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(() => {
    process.stderr.write(
      '{"schema":"sitesourcery.origin-readback-failure/v1","ok":false,"code":"ORIGIN_READBACK_FAILED"}\n'
    );
    process.exitCode = 1;
  });
}
