import {
  OPERATIONS_REPORT_SCHEMA,
  createHeldAlertAdapter,
  dispatchOperationsAlerts
} from "./alert-adapter.mjs";
import {
  canonicalJson
} from "./immutable-evidence.mjs";
import {
  assertOperationsProviderEgressHeld,
  validateOperationsStateEvidence
} from "./operations-state.mjs";

const DAY = 24 * 60 * 60 * 1000;
const DEFAULT_THRESHOLDS = Object.freeze({
  backupMaxAgeMs: 26 * 60 * 60 * 1000,
  diskMinimumFreeBytes: 5 * 1024 ** 3,
  diskMinimumFreeRatio: 0.2,
  certificateMinimumValidityMs: 21 * DAY,
  cancellationMaximumReady: 10,
  cancellationMaximumAgeMs: 15 * 60 * 1000,
  exportMaximumQueued: 10,
  exportMaximumQueueAgeMs: 30 * 60 * 1000,
  exportMaximumExpiredLeaseAgeMs:
    5 * 60 * 1000,
  reconciliationMaximumOpenAgeMs:
    6 * 60 * 60 * 1000
});

function validCount(value) {
  return (
    Number.isSafeInteger(value) && value >= 0
  );
}

function validateThresholds(input = {}) {
  const selected = {
    ...DEFAULT_THRESHOLDS,
    ...input
  };
  for (const field of [
    "backupMaxAgeMs",
    "diskMinimumFreeBytes",
    "certificateMinimumValidityMs",
    "cancellationMaximumReady",
    "cancellationMaximumAgeMs",
    "exportMaximumQueued",
    "exportMaximumQueueAgeMs",
    "exportMaximumExpiredLeaseAgeMs"
  ]) {
    if (!validCount(selected[field])) {
      throw new Error(
        `Monitoring threshold ${field} is invalid.`
      );
    }
  }
  if (
    typeof selected.diskMinimumFreeRatio !==
      "number" ||
    !Number.isFinite(
      selected.diskMinimumFreeRatio
    ) ||
    selected.diskMinimumFreeRatio <= 0 ||
    selected.diskMinimumFreeRatio >= 1
  ) {
    throw new Error(
      "Monitoring disk free ratio is invalid."
    );
  }
  return Object.freeze(selected);
}

function exactDate(value) {
  const selected = new Date(value);
  return !Number.isNaN(selected.valueOf()) &&
    selected.toISOString() === value
    ? selected
    : null;
}

function alert(code, severity, summary) {
  return Object.freeze({
    code,
    severity,
    summary
  });
}

async function safeProbe(name, probe) {
  try {
    return {
      name,
      ok: true,
      value: await probe()
    };
  } catch {
    return {
      name,
      ok: false,
      value: null
    };
  }
}

function ageFrom(now, value) {
  const date = exactDate(value);
  if (!date || date > now) {
    return null;
  }
  return now - date;
}

export async function runOperationsMonitor({
  probes,
  thresholds,
  operationsStateEvidence,
  providerEgress,
  alertAdapter = createHeldAlertAdapter(),
  now = () => new Date()
}) {
  const observedAt = now();
  if (
    !(observedAt instanceof Date) ||
    Number.isNaN(observedAt.valueOf())
  ) {
    throw new Error(
      "Monitoring clock must return a valid Date."
    );
  }
  const sourceOperations =
    validateOperationsStateEvidence(
      operationsStateEvidence,
      {
        sourceFailureDomainId:
          operationsStateEvidence
            ?.sourceFailureDomainId,
        consumer: "monitor"
      }
    );
  const expectedOperationsState =
    sourceOperations.operationsState;
  const providerEgressState =
    assertOperationsProviderEgressHeld(
      providerEgress
    );
  const limits = validateThresholds(thresholds);
  for (const name of [
    "runtime",
    "database",
    "backup",
    "disk",
    "certificate",
    "backlog"
  ]) {
    if (typeof probes?.[name] !== "function") {
      throw new Error(
        `Monitoring probe ${name} is required.`
      );
    }
  }
  const results = await Promise.all(
    Object.entries(probes)
      .filter(([name]) =>
        [
          "runtime",
          "database",
          "backup",
          "disk",
          "certificate",
          "backlog"
        ].includes(name)
      )
      .map(([name, probe]) =>
        safeProbe(name, probe)
      )
  );
  const byName = new Map(
    results.map((result) => [
      result.name,
      result
    ])
  );
  const alerts = [];
  const checks = [];

  function unavailable(name, code, summary) {
    const result = byName.get(name);
    if (!result?.ok) {
      alerts.push(alert(code, "critical", summary));
      checks.push({
        name,
        ok: false,
        code
      });
      return true;
    }
    return false;
  }

  if (
    !unavailable(
      "runtime",
      "RUNTIME_PROBE_UNAVAILABLE",
      "The runtime state probe could not complete."
    )
  ) {
    const runtime = byName.get("runtime").value;
    const ok =
      runtime?.ok === true &&
      canonicalJson(
        runtime.operationsState
      ) ===
        canonicalJson(
          expectedOperationsState
        );
    checks.push({
      name: "runtime",
      ok,
      code: ok
        ? null
        : "RUNTIME_READINESS_OR_STATE_DRIFT"
    });
    if (!ok) {
      alerts.push(
        alert(
          "RUNTIME_READINESS_OR_STATE_DRIFT",
          "critical",
          "Runtime readiness or approved operations state drifted."
        )
      );
    }
  }

  if (
    !unavailable(
      "database",
      "DATABASE_PROBE_UNAVAILABLE",
      "PostgreSQL readiness could not be checked."
    )
  ) {
    const database =
      byName.get("database").value;
    const expectedDomainHeld =
      expectedOperationsState.domainRuntime ===
      "held";
    const ok =
      database?.ready === true &&
      database.runtimeContractV13 === true &&
      database.runtimeContractV14 === true &&
      database.runtimeContractV15 === true &&
      database.shadowSchemaAbsent === true &&
      database.domainHeld ===
        expectedDomainHeld;
    checks.push({
      name: "database",
      ok,
      code: ok
        ? null
        : "DATABASE_READINESS_OR_DOMAIN_STATE_DRIFT"
    });
    if (!ok) {
      alerts.push(
        alert(
          "DATABASE_READINESS_OR_DOMAIN_STATE_DRIFT",
          "critical",
          "PostgreSQL migrations, invariants, or domain hold drifted."
        )
      );
    }
  }

  if (
    !unavailable(
      "backup",
      "BACKUP_PROBE_UNAVAILABLE",
      "The latest immutable backup could not be verified."
    )
  ) {
    const backup = byName.get("backup").value;
    const backupAge =
      backup?.verified === true
        ? ageFrom(
            observedAt,
            backup.completedAt
          )
        : null;
    const ok =
      backupAge !== null &&
      backupAge <= limits.backupMaxAgeMs;
    checks.push({
      name: "backup",
      ok,
      code: ok
        ? null
        : "BACKUP_STALE_OR_INVALID"
    });
    if (!ok) {
      alerts.push(
        alert(
          "BACKUP_STALE_OR_INVALID",
          "critical",
          "No recent verified off-machine backup is available."
        )
      );
    }
  }

  if (
    !unavailable(
      "disk",
      "DISK_PROBE_UNAVAILABLE",
      "Storage capacity could not be checked."
    )
  ) {
    const disk = byName.get("disk").value;
    const ratio =
      typeof disk?.freeBytes === "number" &&
      typeof disk?.totalBytes === "number" &&
      disk.totalBytes > 0
        ? disk.freeBytes / disk.totalBytes
        : -1;
    const ok =
      ratio >= limits.diskMinimumFreeRatio &&
      disk.freeBytes >=
        limits.diskMinimumFreeBytes;
    checks.push({
      name: "disk",
      ok,
      code: ok ? null : "DISK_CAPACITY_LOW"
    });
    if (!ok) {
      alerts.push(
        alert(
          "DISK_CAPACITY_LOW",
          "critical",
          "Site Sourcery storage is below its reviewed reserve."
        )
      );
    }
  }

  if (
    !unavailable(
      "certificate",
      "CERTIFICATE_PROBE_UNAVAILABLE",
      "The local certificate file could not be checked."
    )
  ) {
    const certificate =
      byName.get("certificate").value;
    const edgeIsExactlyHeld =
      expectedOperationsState.publication ===
        "held" &&
      expectedOperationsState.dns === "held";
    const notAfter = edgeIsExactlyHeld
      ? null
      : exactDate(certificate?.notAfter);
    const remaining = notAfter
      ? notAfter - observedAt
      : -1;
    const ok = edgeIsExactlyHeld
      ? canonicalJson(certificate) ===
        canonicalJson({ held: true })
      : certificate?.valid === true &&
        certificate?.held !== true &&
        remaining >=
          limits.certificateMinimumValidityMs;
    checks.push({
      name: "certificate",
      ok,
      code: ok
        ? null
        : edgeIsExactlyHeld
          ? "CERTIFICATE_HOLD_STATE_DRIFT"
          : "CERTIFICATE_EXPIRING_OR_INVALID"
    });
    if (!ok) {
      alerts.push(
        alert(
          edgeIsExactlyHeld
            ? "CERTIFICATE_HOLD_STATE_DRIFT"
            : "CERTIFICATE_EXPIRING_OR_INVALID",
          "critical",
          edgeIsExactlyHeld
            ? "Certificate monitoring drifted from the reviewed held edge state."
            : "The reviewed certificate is invalid or near expiry."
        )
      );
    }
  }

  if (
    !unavailable(
      "backlog",
      "BACKLOG_PROBE_UNAVAILABLE",
      "Cancellation and export backlogs could not be checked."
    )
  ) {
    const backlog = byName.get("backlog").value;
    const validCounts =
      [
        backlog?.cancellationReady,
        backlog?.cancellationAmbiguous,
        backlog?.exportQueued,
        backlog?.exportBuilding,
        backlog?.exportLeaseExpired,
        backlog?.exportManualReview,
        backlog?.reconciliationOpenCases,
        backlog?.reconciliationSuppressionConflicts
      ].every(validCount);
    const valid =
      validCounts &&
      backlog.exportLeaseExpired <=
        backlog.exportBuilding &&
      backlog.reconciliationSuppressionConflicts <=
        backlog.reconciliationOpenCases;
    const cancellationAge =
      backlog?.cancellationReady > 0
        ? ageFrom(
            observedAt,
            backlog.oldestCancellationReadyAt
          )
        : 0;
    const exportQueueAge =
      backlog?.exportQueued > 0
        ? ageFrom(
            observedAt,
            backlog.oldestExportQueuedAt
          )
        : 0;
    const exportLeaseAge =
      backlog?.exportLeaseExpired > 0
        ? ageFrom(
            observedAt,
            backlog.oldestExportLeaseExpiredAt
          )
        : 0;
    if (!valid) {
      alerts.push(
        alert(
          "BACKLOG_EVIDENCE_INVALID",
          "critical",
          "Backlog evidence is malformed."
        )
      );
    } else {
      if (
        backlog.cancellationAmbiguous > 0
      ) {
        alerts.push(
          alert(
            "CANCELLATION_RECONCILIATION_REQUIRED",
            "critical",
            "Ambiguous subscription cancellation effects require operator reconciliation and must not retry."
          )
        );
      }
      if (
        backlog.cancellationReady >
          limits.cancellationMaximumReady ||
        cancellationAge === null ||
        cancellationAge >
          limits.cancellationMaximumAgeMs
      ) {
        alerts.push(
          alert(
            "CANCELLATION_BACKLOG_HIGH",
            "warning",
            "Ready cancellation work exceeds its reviewed count or age."
          )
        );
      }
      if (
        backlog.exportQueued >
          limits.exportMaximumQueued ||
        exportQueueAge === null ||
        exportQueueAge >
          limits.exportMaximumQueueAgeMs
      ) {
        alerts.push(
          alert(
            "EXPORT_QUEUE_BACKLOG_HIGH",
            "warning",
            "Queued exports exceed their reviewed count or age."
          )
        );
      }
      if (
        backlog.exportManualReview > 0
      ) {
        alerts.push(
          alert(
            "EXPORT_RECONCILIATION_REQUIRED",
            "critical",
            "Ambiguous failed export facts require operator review and must not be retried automatically."
          )
        );
      }
      if (
        backlog.exportLeaseExpired > 0 &&
        (exportLeaseAge === null ||
          exportLeaseAge >
            limits
              .exportMaximumExpiredLeaseAgeMs)
      ) {
        alerts.push(
          alert(
            "EXPORT_LEASE_BACKLOG_HIGH",
            "warning",
            "Expired export leases are not being reclaimed within the reviewed window."
          )
        );
      }
      if (backlog.reconciliationSuppressionConflicts > 0) {
        alerts.push(
          alert(
            "PROVIDER_RECONCILIATION_SUPPRESSION_CONFLICT",
            "critical",
            "A provider effect landed after a durable STOP and requires operator reconciliation."
          )
        );
      }
      const reconciliationAge =
        backlog.reconciliationOpenCases > 0
          ? ageFrom(
              observedAt,
              backlog.oldestReconciliationOpenAt
            )
          : 0;
      if (
        backlog.reconciliationOpenCases > 0 &&
        (reconciliationAge === null ||
          reconciliationAge >
            limits.reconciliationMaximumOpenAgeMs)
      ) {
        alerts.push(
          alert(
            "PROVIDER_RECONCILIATION_BACKLOG_HIGH",
            "warning",
            "Open provider reconciliation cases are not being cleared within the reviewed window."
          )
        );
      }
    }
    const backlogAlerts = new Set([
      "BACKLOG_EVIDENCE_INVALID",
      "CANCELLATION_RECONCILIATION_REQUIRED",
      "CANCELLATION_BACKLOG_HIGH",
      "EXPORT_QUEUE_BACKLOG_HIGH",
      "EXPORT_LEASE_BACKLOG_HIGH",
      "EXPORT_RECONCILIATION_REQUIRED",
      "PROVIDER_RECONCILIATION_SUPPRESSION_CONFLICT",
      "PROVIDER_RECONCILIATION_BACKLOG_HIGH"
    ]);
    const backlogOk = !alerts.some((item) =>
      backlogAlerts.has(item.code)
    );
    checks.push({
      name: "backlog",
      ok: backlogOk,
      code: backlogOk
        ? null
        : "BACKLOG_REQUIRES_ATTENTION"
    });
  }

  alerts.sort((left, right) =>
    left.code.localeCompare(right.code)
  );
  checks.sort((left, right) =>
    left.name.localeCompare(right.name)
  );
  const report = Object.freeze({
    schema: OPERATIONS_REPORT_SCHEMA,
    observedAt: observedAt.toISOString(),
    providerEgress: providerEgressState,
    sourceOperations,
    ok: alerts.length === 0,
    checks,
    alerts
  });
  const delivery = await dispatchOperationsAlerts({
    report,
    adapter: alertAdapter
  });
  return Object.freeze({
    report,
    delivery
  });
}

export {
  DEFAULT_THRESHOLDS
};
