#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  canonicalJson,
  readJsonObject
} from "./immutable-evidence.mjs";
import {
  evaluateIndependentDeadMan,
  releaseIdentityFromEpoch
} from "./independent-monitor-runtime.mjs";
import {
  readIndependentMonitorHeartbeat
} from "./independent-monitor-state.mjs";

function required(environment, field) {
  const value = environment?.[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} is required.`);
  }
  return value;
}

function absolute(environment, field) {
  const value = required(environment, field);
  if (!path.isAbsolute(value)) {
    throw new Error(`${field} must be absolute.`);
  }
  return path.resolve(value);
}

function maximumAge(environment) {
  const raw = required(
    environment,
    "SITESOURCERY_DEAD_MAN_MAXIMUM_AGE_MS"
  );
  if (!/^[1-9][0-9]*$/u.test(raw)) {
    throw new Error("Dead-man maximum age is invalid.");
  }
  return Number(raw);
}

export async function deadManFromEnvironment(
  environment = process.env,
  {
    readEpoch = readJsonObject,
    readHeartbeat = readIndependentMonitorHeartbeat,
    now = () => new Date()
  } = {}
) {
  if (
    required(environment, "SITESOURCERY_DEAD_MAN_MODE") !==
      "approved_read_only" ||
    required(
      environment,
      "SITESOURCERY_OPERATIONS_PROVIDER_EGRESS"
    ) !== "held"
  ) {
    throw new Error("Independent dead-man remains held.");
  }
  const epoch = await readEpoch(
    absolute(environment, "SITESOURCERY_RELEASE_EPOCH_FILE"),
    "Release epoch"
  );
  let heartbeat = null;
  try {
    heartbeat = await readHeartbeat(
      absolute(
        environment,
        "SITESOURCERY_INDEPENDENT_HEARTBEAT_FILE"
      )
    );
  } catch {
    // A missing or malformed heartbeat is itself fixed-code dead-man evidence.
  }
  return evaluateIndependentDeadMan({
    heartbeat,
    releaseIdentity: releaseIdentityFromEpoch(epoch),
    maximumAgeMs: maximumAge(environment),
    now
  });
}

async function main() {
  const result = await deadManFromEnvironment();
  process.stdout.write(`${canonicalJson(result)}\n`);
  if (!result.ok) process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(() => {
    process.stderr.write(
      '{"schema":"sitesourcery.independent-dead-man-failure/v1","ok":false,"code":"INDEPENDENT_DEAD_MAN_FAILED"}\n'
    );
    process.exitCode = 1;
  });
}
