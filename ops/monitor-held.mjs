#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  createHeldAlertAdapter,
  createReviewedOutboundAlertAdapter,
  readAlertApprovalFile
} from "./alert-adapter.mjs";
import {
  createPersistentOperationsAlertAdapter
} from "./alert-state.mjs";
import {
  createProductionMonitoringProbes
} from "./monitor-ports.mjs";
import {
  runOperationsMonitor
} from "./monitor-runtime.mjs";
import {
  createResendOperationsAlertTransport
} from "./resend-alert-transport.mjs";
import {
  assertOperationsProviderEgressHeld,
  operationsStateFromEnvironment,
  readOperationsStateApprovalFile,
  resolveOperationsStateEvidence
} from "./operations-state.mjs";

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

async function alertAdapterFromEnvironment(
  environment
) {
  const mode = required(
    environment,
    "SITESOURCERY_ALERT_MODE"
  );
  if (mode === "held") {
    return createHeldAlertAdapter();
  }
  if (mode !== "reviewed_resend") {
    throw new Error(
      "SITESOURCERY_ALERT_MODE is invalid."
    );
  }
  const approval = await readAlertApprovalFile(
    absolute(
      environment,
      "SITESOURCERY_ALERT_APPROVAL_FILE"
    )
  );
  const transport =
    createResendOperationsAlertTransport({
      environment,
      adapterId: approval.adapterId,
      destinationRef:
        approval.destinationRef
    });
  const reviewed =
    createReviewedOutboundAlertAdapter({
      approval,
      deliver: transport.deliver
    });
  return createPersistentOperationsAlertAdapter({
    adapter: reviewed,
    stateFile: absolute(
      environment,
      "SITESOURCERY_ALERT_STATE_FILE"
    ),
    repeatIntervalMs: integer(
      environment,
      "SITESOURCERY_ALERT_REPEAT_INTERVAL_MS",
      6 * 60 * 60 * 1000
    )
  });
}

export async function monitorFromEnvironment(
  environment = process.env
) {
  const sourceFailureDomainId = required(
    environment,
    "SITESOURCERY_SOURCE_FAILURE_DOMAIN"
  );
  const operationsState =
    operationsStateFromEnvironment(
      environment
    );
  const operationsStateApproval =
    await readOperationsStateApprovalFile(
      environment
        .SITESOURCERY_OPERATIONS_STATE_APPROVAL_FILE
    );
  const operationsStateEvidence =
    resolveOperationsStateEvidence({
      actualOperationsState: operationsState,
      approval: operationsStateApproval,
      sourceFailureDomainId,
      consumer: "monitor",
      now: new Date()
    });
  const providerEgress =
    assertOperationsProviderEgressHeld(
      environment
        .SITESOURCERY_OPERATIONS_PROVIDER_EGRESS
    );
  const edgeIsExactlyHeld =
    operationsState.publication === "held" &&
    operationsState.dns === "held";
  const alertAdapter =
    await alertAdapterFromEnvironment(
      environment
    );
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
      sourceFailureDomainId,
      certificateFile: edgeIsExactlyHeld
        ? null
        : absolute(
            environment,
            "SITESOURCERY_MONITOR_CERTIFICATE_FILE"
          ),
      certificateHostname: edgeIsExactlyHeld
        ? null
        : required(
            environment,
            "SITESOURCERY_MONITOR_CERTIFICATE_HOSTNAME"
          ),
      expectedOperationsState:
        operationsState,
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
    return await runOperationsMonitor({
      probes: production.probes,
      operationsStateEvidence,
      providerEgress,
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
      alertAdapter
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
  if (
    result.delivery.required === true &&
    result.delivery.delivered !== true
  ) {
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
        providerEgress: "held",
        code: "OPERATIONS_MONITOR_FAILED"
      })}\n`
    );
    process.exitCode = 1;
  });
}
