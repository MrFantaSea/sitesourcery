#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  OPERATIONS_REPORT_SCHEMA,
  dispatchOperationsAlerts
} from "./alert-adapter.mjs";
import {
  alertAdapterFromEnvironment
} from "./monitor-held.mjs";
import {
  assertOperationsProviderEgressHeld,
  operationsStateFromEnvironment,
  readOperationsStateApprovalFile,
  resolveOperationsStateEvidence
} from "./operations-state.mjs";

export const ALERT_DELIVERY_PROOF_SCHEMA =
  "sitesourcery.alert-delivery-proof/v1";
export const ALERT_DELIVERY_PROOF_CODE =
  "ALERT_DELIVERY_PROOF";

const ACTIONS = new Set(["incident", "recovery"]);

function required(environment, field) {
  const value = environment?.[field];
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
  const resolved = path.resolve(value);
  if (resolved === path.parse(resolved).root) {
    throw new Error(`${field} is unsafe.`);
  }
  return resolved;
}

function selectedInstant(now) {
  const value = now();
  if (
    !(value instanceof Date) ||
    Number.isNaN(value.valueOf())
  ) {
    throw new Error(
      "Alert delivery proof clock is invalid."
    );
  }
  return value;
}

function proofReport({
  action,
  observedAt,
  sourceOperations,
  providerEgress
}) {
  const incident = action === "incident";
  return Object.freeze({
    schema: OPERATIONS_REPORT_SCHEMA,
    observedAt: observedAt.toISOString(),
    providerEgress,
    sourceOperations,
    ok: !incident,
    checks: Object.freeze([
      Object.freeze({
        name: "alert_delivery_proof",
        ok: !incident,
        code: incident
          ? ALERT_DELIVERY_PROOF_CODE
          : null
      })
    ]),
    alerts: Object.freeze(
      incident
        ? [
            Object.freeze({
              code: ALERT_DELIVERY_PROOF_CODE,
              severity: "warning",
              summary:
                "TEST ONLY - Site Sourcery alert delivery proof. Production remained healthy."
            })
          ]
        : []
    )
  });
}

export async function runAlertDeliveryProof({
  action,
  environment = process.env,
  now = () => new Date(),
  createAlertAdapter =
    alertAdapterFromEnvironment
} = {}) {
  if (!ACTIONS.has(action)) {
    throw new Error(
      "Alert delivery proof action must be incident or recovery."
    );
  }
  if (
    required(
      environment,
      "SITESOURCERY_ALERT_PROOF_MODE"
    ) !== "approved" ||
    required(
      environment,
      "SITESOURCERY_ALERT_MODE"
    ) !== "reviewed_resend"
  ) {
    throw new Error(
      "Alert delivery proof is not explicitly approved."
    );
  }
  const stateFile = absolute(
    environment,
    "SITESOURCERY_ALERT_STATE_FILE"
  );
  const proofStateFile = absolute(
    environment,
    "SITESOURCERY_ALERT_PROOF_STATE_FILE"
  );
  if (proofStateFile === stateFile) {
    throw new Error(
      "Alert delivery proof state must be isolated from monitor state."
    );
  }
  const sourceFailureDomainId = required(
    environment,
    "SITESOURCERY_SOURCE_FAILURE_DOMAIN"
  );
  const operationsState =
    operationsStateFromEnvironment(environment);
  const operationsStateApproval =
    await readOperationsStateApprovalFile(
      environment
        .SITESOURCERY_OPERATIONS_STATE_APPROVAL_FILE
    );
  const observedAt = selectedInstant(now);
  const sourceOperations =
    resolveOperationsStateEvidence({
      actualOperationsState: operationsState,
      approval: operationsStateApproval,
      sourceFailureDomainId,
      consumer: "monitor",
      now: observedAt
    });
  const providerEgress =
    assertOperationsProviderEgressHeld(
      environment
        .SITESOURCERY_OPERATIONS_PROVIDER_EGRESS
    );
  const proofEnvironment = Object.freeze({
    ...environment,
    SITESOURCERY_ALERT_STATE_FILE:
      proofStateFile
  });
  const adapter = await createAlertAdapter(
    proofEnvironment
  );
  const report = proofReport({
    action,
    observedAt,
    sourceOperations,
    providerEgress
  });
  const delivery = await dispatchOperationsAlerts({
    report,
    adapter
  });
  if (
    delivery?.delivered !== true ||
    delivery.transition !== action
  ) {
    throw new Error(
      "Alert delivery proof did not complete its expected transition."
    );
  }
  return Object.freeze({
    schema: ALERT_DELIVERY_PROOF_SCHEMA,
    testOnly: true,
    action,
    observedAt: report.observedAt,
    delivery: Object.freeze({
      attempted: delivery.attempted,
      delivered: delivery.delivered,
      transition: delivery.transition,
      transitionId:
        delivery.transitionId ?? null,
      provider: delivery.provider ?? null,
      providerMessageId:
        delivery.providerMessageId ?? null
    })
  });
}

async function main() {
  const result = await runAlertDeliveryProof({
    action: process.argv[2]
  });
  process.stdout.write(
    `${JSON.stringify(result)}\n`
  );
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
        testOnly: true,
        code: "ALERT_DELIVERY_PROOF_FAILED"
      })}\n`
    );
    process.exitCode = 1;
  });
}
