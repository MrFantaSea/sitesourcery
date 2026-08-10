#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  canonicalJson,
  readJsonObject
} from "./immutable-evidence.mjs";
import {
  createOriginRollbackPlan
} from "./origin-seal-runtime.mjs";

function sealPath(argv) {
  if (argv.length !== 2 || argv[0] !== "--seal" || !path.isAbsolute(argv[1])) {
    throw new Error("Usage: origin-rollback-plan.mjs --seal ABSOLUTE_PATH");
  }
  return path.resolve(argv[1]);
}

export async function originRollbackPlanFromFile(filePath) {
  return createOriginRollbackPlan(
    await readJsonObject(filePath, "Origin seal")
  );
}

async function main() {
  const plan = await originRollbackPlanFromFile(
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
      '{"schema":"sitesourcery.origin-rollback-plan-failure/v1","ok":false,"code":"ORIGIN_ROLLBACK_PLAN_FAILED"}\n'
    );
    process.exitCode = 1;
  });
}
