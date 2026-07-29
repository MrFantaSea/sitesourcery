#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  createHeldAlertAdapter
} from "./alert-adapter.mjs";
import {
  assertHeldOperationsState
} from "./backup-runtime.mjs";
import {
  createProductionMonitoringProbes
} from "./monitor-ports.mjs";
import {
  runHeldOperationsMonitor
} from "./monitor-runtime.mjs";

function required(environment, field) {
  const value = environment[field];
  if (
    typeof value !== "string" ||
    value.length === 0
  ) {
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

function integer(
  environment,
  field,
  fallback
) {
  const value = Number(
    environment[field] ?? fallback
  );
  if (
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new Error(`${field} must be an integer.`);
  }
  return value;
}

export async function monitorFromEnvironment(
  environment = process.env
) {
  assertHeldOperationsState({
    stripeMode:
      environment.SITESOURCERY_STRIPE_MODE,
    recoveryMailMode:
      environment
        .SITESOURCERY_RECOVERY_MAIL_MODE,
    publication:
      environment
        .SITESOURCERY_EXPECT_PUBLICATION,
    domainRuntime:
      environment
        .SITESOURCERY_EXPECT_DOMAIN_RUNTIME,
    dns:
      environment.SITESOURCERY_EXPECT_DNS
  });
  if (
    environment.SITESOURCERY_ALERT_MODE !==
    "held"
  ) {
    throw new Error(
      "This candidate wires only the held alert adapter."
    );
  }
  const production =
    createProductionMonitoringProbes({
      databaseUrl: required(
        environment,
        "SITESOURCERY_DATABASE_URL"
      ),
      dataRoot: absolute(
        environment,
        "SITESOURCERY_DATA_ROOT"
      ),
      backupDestinationRoot: absolute(
        environment,
        "SITESOURCERY_BACKUP_DESTINATION_ROOT"
      ),
      sourceFailureDomainId: required(
        environment,
        "SITESOURCERY_SOURCE_FAILURE_DOMAIN"
      ),
      certificateFile: absolute(
        environment,
        "SITESOURCERY_MONITOR_CERTIFICATE_FILE"
      ),
      certificateHostname: required(
        environment,
        "SITESOURCERY_MONITOR_CERTIFICATE_HOSTNAME"
      ),
      apiPort: integer(
        environment,
        "SITESOURCERY_HOSTED_PORT",
        8788
      ),
      tenantPort: integer(
        environment,
        "SITESOURCERY_TENANT_PORT",
        8080
      ),
      timeoutMs: integer(
        environment,
        "SITESOURCERY_MONITOR_TIMEOUT_MS",
        3000
      )
    });
  try {
    return await runHeldOperationsMonitor({
      probes: production.probes,
      thresholds: {
        backupMaxAgeMs: integer(
          environment,
          "SITESOURCERY_MONITOR_BACKUP_MAX_AGE_MS",
          26 * 60 * 60 * 1000
        ),
        diskMinimumFreeBytes: integer(
          environment,
          "SITESOURCERY_MONITOR_DISK_MIN_FREE_BYTES",
          5 * 1024 ** 3
        ),
        certificateMinimumValidityMs:
          integer(
            environment,
            "SITESOURCERY_MONITOR_CERT_MIN_VALIDITY_MS",
            21 * 24 * 60 * 60 * 1000
          )
      },
      alertAdapter: createHeldAlertAdapter()
    });
  } finally {
    await production.close();
  }
}

async function main() {
  const result = await monitorFromEnvironment();
  process.stdout.write(
    `${JSON.stringify({
      ...result.report,
      delivery: result.delivery
    })}\n`
  );
  if (!result.report.ok) {
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url ===
    pathToFileURL(process.argv[1]).href
) {
  main().catch(() => {
    process.stderr.write(
      `${JSON.stringify({
        ok: false,
        held: true,
        code: "OPERATIONS_MONITOR_FAILED"
      })}\n`
    );
    process.exitCode = 1;
  });
}
