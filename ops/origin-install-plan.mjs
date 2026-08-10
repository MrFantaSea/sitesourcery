#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  canonicalJson,
  readJsonObject
} from "./immutable-evidence.mjs";
import {
  createOriginInstallPlan
} from "./origin-seal-runtime.mjs";

function sealPath(argv) {
  if (argv.length !== 2 || argv[0] !== "--seal" || !path.isAbsolute(argv[1])) {
    throw new Error("Usage: origin-install-plan.mjs --seal ABSOLUTE_PATH");
  }
  return path.resolve(argv[1]);
}

export async function originInstallPlanFromFile(filePath) {
  return createOriginInstallPlan(
    await readJsonObject(filePath, "Origin seal")
  );
}

async function main() {
  const plan = await originInstallPlanFromFile(
    sealPath(process.argv.slice(2))
  );
  process.stdout.write(`${canonicalJson(plan)}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(() => {
    process.stderr.write(
      '{"schema":"sitesourcery.origin-install-plan-failure/v1","ok":false,"code":"ORIGIN_INSTALL_PLAN_FAILED"}\n'
    );
    process.exitCode = 1;
  });
}
