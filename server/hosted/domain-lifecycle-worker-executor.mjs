import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { invariant } from "./errors.mjs";

const PURPOSE = "domain-lifecycle";
const SHA256 = /^[0-9a-f]{64}$/u;
const MODULE_PATH = /^\/etc\/sitesourcery\/domain\/[A-Za-z0-9._-]{1,120}\.mjs$/u;

function heldExecutor() {
  return Object.freeze({
    kind: `${PURPOSE}-executor`,
    providerEffects: false,
    readOnly: true,
    async readiness() {
      return Object.freeze({
        ready: false,
        verified: false,
        mode: "held",
        code: "DOMAIN_LIFECYCLE_READBACK_HELD",
        providerEffects: false,
        readOnly: true
      });
    },
    async execute() {
      const error = new Error("Domain lifecycle provider readback remains held.");
      error.code = "DOMAIN_LIFECYCLE_READBACK_HELD";
      throw error;
    }
  });
}

export async function createConfiguredDomainLifecycleExecutor({
  authority,
  environment = process.env,
  clock = { now: () => new Date().toISOString() },
  read = readFile,
  load = (url) => import(url)
} = {}) {
  const mode = environment?.SITESOURCERY_DOMAIN_LIFECYCLE_READBACK_MODE ?? "held";
  invariant(
    mode === "held" || mode === "reviewed",
    "DOMAIN_LIFECYCLE_WORKER_CONFIGURATION_REQUIRED",
    "Domain lifecycle readback mode must be held or reviewed.",
    { status: 500 }
  );
  if (mode === "held") return heldExecutor();
  const modulePath = environment.SITESOURCERY_DOMAIN_LIFECYCLE_READBACK_MODULE;
  const expectedDigest = environment.SITESOURCERY_DOMAIN_LIFECYCLE_READBACK_SHA256;
  invariant(
    MODULE_PATH.test(modulePath ?? "") && SHA256.test(expectedDigest ?? "") &&
      authority?.kind === "canonical-postgres" && typeof clock?.now === "function",
    "DOMAIN_LIFECYCLE_WORKER_CONFIGURATION_REQUIRED",
    "A digest-pinned reviewed Domain lifecycle readback module is required.",
    { status: 500 }
  );
  const bytes = await read(modulePath);
  const actualDigest = createHash("sha256").update(bytes).digest("hex");
  invariant(
    actualDigest === expectedDigest,
    "DOMAIN_LIFECYCLE_WORKER_CONFIGURATION_REQUIRED",
    "The reviewed Domain lifecycle readback module digest changed.",
    { status: 500 }
  );
  const loaded = await load(pathToFileURL(modulePath).href);
  invariant(
    typeof loaded?.createSiteSourceryDomainLifecycleExecutor === "function",
    "DOMAIN_LIFECYCLE_WORKER_CONFIGURATION_REQUIRED",
    "The reviewed Domain lifecycle module has no exact factory.",
    { status: 500 }
  );
  const executor = await loaded.createSiteSourceryDomainLifecycleExecutor({
    authority,
    clock,
    environment
  });
  invariant(
    executor?.kind === `${PURPOSE}-executor` &&
      executor.providerEffects === false && executor.readOnly === true &&
      typeof executor.readiness === "function" &&
      typeof executor.execute === "function",
    "DOMAIN_LIFECYCLE_WORKER_CONFIGURATION_REQUIRED",
    "The reviewed Domain lifecycle executor violates its read-only contract.",
    { status: 500 }
  );
  return executor;
}

export function createDomainLifecycleExecutorForTest({ execute } = {}) {
  invariant(
    typeof execute === "function",
    "DOMAIN_LIFECYCLE_WORKER_CONFIGURATION_REQUIRED",
    "A test-only Domain lifecycle executor is required.",
    { status: 500 }
  );
  return Object.freeze({
    kind: `${PURPOSE}-executor`,
    providerEffects: false,
    readOnly: true,
    async readiness() {
      return Object.freeze({
        ready: true,
        verified: true,
        mode: "contract_test",
        providerEffects: false,
        readOnly: true
      });
    },
    execute
  });
}
