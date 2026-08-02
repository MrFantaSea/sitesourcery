import {
  canonicalJson,
  safeIdentifier,
  sha256Bytes
} from "./immutable-evidence.mjs";

export const OPERATIONS_REPORT_SCHEMA =
  "sitesourcery.operations-report/v2";
export const ALERT_APPROVAL_SCHEMA =
  "sitesourcery.outbound-alert-approval/v1";

function approvalPayload(value) {
  return {
    schema: ALERT_APPROVAL_SCHEMA,
    adapterId: value.adapterId,
    state: value.state,
    reportSchema: value.reportSchema,
    destinationRef: value.destinationRef,
    approvedAt: value.approvedAt,
    expiresAt: value.expiresAt
  };
}

export function alertApprovalDigest(value) {
  return sha256Bytes(
    Buffer.from(
      `${canonicalJson(approvalPayload(value))}\n`
    )
  );
}

export function createHeldAlertAdapter() {
  return Object.freeze({
    kind: "held-alert-adapter",
    externalEffects: false,
    async readiness() {
      return Object.freeze({
        ready: false,
        mode: "held",
        code: "OUTBOUND_ALERTS_HELD"
      });
    },
    async deliver() {
      throw new Error(
        "Outbound alert delivery is held."
      );
    }
  });
}

export function createReviewedOutboundAlertAdapter({
  approval,
  deliver,
  now = () => new Date()
}) {
  const adapterId = safeIdentifier(
    approval?.adapterId,
    "Alert adapter ID"
  );
  safeIdentifier(
    approval?.destinationRef,
    "Alert destination reference"
  );
  if (
    approval.schema !== ALERT_APPROVAL_SCHEMA ||
    approval.state !== "approved" ||
    approval.reportSchema !==
      OPERATIONS_REPORT_SCHEMA ||
    approval.digest !==
      alertApprovalDigest(approval) ||
    typeof deliver !== "function"
  ) {
    throw new Error(
      "Reviewed outbound alert approval is invalid."
    );
  }
  const approvedAt = new Date(approval.approvedAt);
  const expiresAt = new Date(approval.expiresAt);
  if (
    Number.isNaN(approvedAt.valueOf()) ||
    Number.isNaN(expiresAt.valueOf()) ||
    approvedAt.toISOString() !==
      approval.approvedAt ||
    expiresAt.toISOString() !==
      approval.expiresAt ||
    expiresAt <= approvedAt
  ) {
    throw new Error(
      "Reviewed outbound alert approval dates are invalid."
    );
  }

  return Object.freeze({
    kind: adapterId,
    externalEffects: true,
    async readiness() {
      const current = now();
      return Object.freeze({
        ready:
          current >= approvedAt &&
          current < expiresAt,
        mode: "reviewed",
        code:
          current >= approvedAt &&
          current < expiresAt
            ? null
            : "OUTBOUND_ALERT_APPROVAL_EXPIRED",
        approvalDigest: approval.digest
      });
    },
    async deliver(report) {
      if (
        report?.schema !==
        OPERATIONS_REPORT_SCHEMA
      ) {
        throw new Error(
          "Outbound alert report schema is invalid."
        );
      }
      const readiness = await this.readiness();
      if (!readiness.ready) {
        throw new Error(
          "Outbound alert approval is not active."
        );
      }
      return deliver(
        Object.freeze({
          schema:
            "sitesourcery.outbound-alert-envelope/v1",
          adapterId,
          destinationRef:
            approval.destinationRef,
          approvalDigest: approval.digest,
          report
        })
      );
    }
  });
}

export async function dispatchOperationsAlerts({
  report,
  adapter = createHeldAlertAdapter()
}) {
  if (
    report?.schema !== OPERATIONS_REPORT_SCHEMA ||
    !Array.isArray(report.alerts)
  ) {
    throw new Error(
      "Operations report is invalid."
    );
  }
  if (report.alerts.length === 0) {
    return Object.freeze({
      attempted: false,
      delivered: false,
      mode: "none"
    });
  }
  const readiness = await adapter.readiness();
  if (!readiness.ready) {
    return Object.freeze({
      attempted: false,
      delivered: false,
      mode: readiness.mode,
      code: readiness.code
    });
  }
  await adapter.deliver(report);
  return Object.freeze({
    attempted: true,
    delivered: true,
    mode: readiness.mode,
    approvalDigest:
      readiness.approvalDigest ?? null
  });
}
