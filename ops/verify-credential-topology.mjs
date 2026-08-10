#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  CREDENTIAL_TOPOLOGY_VERIFICATION_SCHEMA,
  verifyCredentialTopology
} from "./credential-topology.mjs";

function usageError() {
  const error = new Error(
    "Use --input with one absolute non-secret JSON evidence path."
  );
  error.code = "CREDENTIAL_TOPOLOGY_ARGUMENT_INVALID";
  return error;
}

function inputPath(argv) {
  if (
    argv.length !== 2 ||
    argv[0] !== "--input" ||
    typeof argv[1] !== "string" ||
    !path.isAbsolute(argv[1])
  ) {
    throw usageError();
  }
  return argv[1];
}

async function readInput(selectedPath) {
  let source;
  try {
    source = await readFile(selectedPath, "utf8");
  } catch {
    const error = new Error(
      "The explicit non-secret topology input is unavailable."
    );
    error.code = "CREDENTIAL_TOPOLOGY_INPUT_UNAVAILABLE";
    throw error;
  }
  if (Buffer.byteLength(source, "utf8") > 256 * 1024) {
    const error = new Error(
      "The explicit non-secret topology input is too large."
    );
    error.code = "CREDENTIAL_TOPOLOGY_INPUT_INVALID";
    throw error;
  }
  try {
    return JSON.parse(source);
  } catch {
    const error = new Error(
      "The explicit non-secret topology input is invalid JSON."
    );
    error.code = "CREDENTIAL_TOPOLOGY_INPUT_INVALID";
    throw error;
  }
}

async function main() {
  const selectedPath = inputPath(process.argv.slice(2));
  const input = await readInput(selectedPath);
  const result = verifyCredentialTopology(input);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.topologyEvidenceComplete) process.exitCode = 2;
}

main().catch((error) => {
  process.stdout.write(
    `${JSON.stringify(
      {
        schema: CREDENTIAL_TOPOLOGY_VERIFICATION_SCHEMA,
        mode: "held",
        effectsAllowed: false,
        topologyEvidenceComplete: false,
        code:
          typeof error?.code === "string"
            ? error.code
            : "CREDENTIAL_TOPOLOGY_VERIFICATION_FAILED"
      },
      null,
      2
    )}\n`
  );
  process.exitCode = 1;
});
