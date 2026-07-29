#!/usr/bin/env node

import path from "node:path";
import { existsSync } from "node:fs";
import { canonicalJson, SelfHostRuntime } from "../src/index.mjs";

const dataRoot = path.resolve(
  process.env.SITESOURCERY_DATA_ROOT ?? "/var/lib/sitesourcery/tenant"
);
if (
  !existsSync(path.join(dataRoot, "control", "current.json")) ||
  !existsSync(path.join(dataRoot, "releases"))
) {
  throw new Error("Existing control state and release storage are required for export.");
}
const runtime = await SelfHostRuntime.open({
  root: dataRoot,
  publicationHeld: true
});
const manifest = await runtime.createBackupManifest();
process.stdout.write(`${canonicalJson(manifest)}\n`);
