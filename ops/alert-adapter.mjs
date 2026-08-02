import {
  lstat,
  readFile
} from "node:fs/promises";
import path from "node:path";

import {
  canonicalJson,
  parseJsonObject,
  safeIdentifier,
  sha256Bytes
} from "./immutable-evidence.mjs";

export const OPERATIONS_REPORT_SCHEMA =
  "sitesourcery.operations-report/v2";
export const ALERT_APPROVAL_SCHEMA =
  "sitesourcery.outbound-alert-approval/v1";
export const OPERATIONS_ALERT_TRANSITION_SCHEMA =
  "sitesourcery.operations-alert-transition/v1";

const MAXIMUM_APPROVAL_LIFETIME_MS =
  366 * 24 * 60 * 60 * 1000;
const SHA256 = /^[a-f0-9]{64}$/u;
const ALERT_CODE = /^[A-Z][A-Z0-9_]{2,127}$/u;
const TRANSITION_KINDS = new Set([
  "incident",
  "changed",
  "reminder",
  "recovery"
]);
const ALERT_APPROVAL_KEYS = Object.freeze([
  "adapterId",
  "approvedAt",
  "destinationRef",
  "digest",
  "expiresAt",
  "reportSchema",
  "schema",
  "state"
]);
const TRANSITION_KEYS = Object.freeze([
  "alertCodes",
  "createdAt",
  "incidentFingerprint",
  "kind",
  "previousAlertCodes",
  "previousIncidentFingerprint",
  "schema",
  "transitionId"
]);

function exactKeys(value, expected, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    canonicalJson(Object.keys(value).sort()) !==
      canonicalJson([...expected].sort())
  ) {
    throw new Error(
      `${label} must contain only its exact reviewed fields.`
    );
  }
}

function exactInstant(value, label) {
  const selected = new Date(value);
  if (
    typeof value !== "string" ||
    Number.isNaN(selected.valueOf()) ||
    selected.toISOString() !== value
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return selected;
}

function alertCodes(value, label) {
  if (
    !Array.isArray(value) ||
    value.some(
      (candidate) =>
        typeof candidate !== "string" ||
        !ALERT_CODE.test(candidate)
    ) ||
    new Set(value).size !== value.length ||
    canonicalJson(value) !==
      canonicalJson(
        [...value].sort((left, right) =>
          left.localeCompare(right)
        )
      )
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return Object.freeze([...value]);
}

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

function validateAlertApproval(approval) {
  exactKeys(
    approval,
    ALERT_APPROVAL_KEYS,
    "Reviewed outbound alert approval"
  );
  const adapterId = safeIdentifier(
    approval.adapterId,
    "Alert adapter ID"
  );
  const destinationRef = safeIdentifier(
    approval.destinationRef,
    "Alert destination reference"
  );
  const approvedAt = exactInstant(
    approval.approvedAt,
    "Reviewed outbound alert approval start"
  );
  const expiresAt = exactInstant(
    approval.expiresAt,
    "Reviewed outbound alert approval expiry"
  );
  if (
    approval.schema !== ALERT_APPROVAL_SCHEMA ||
    approval.state !== "approved" ||
    approval.reportSchema !==
      OPERATIONS_REPORT_SCHEMA ||
    expiresAt <= approvedAt ||
    expiresAt - approvedAt >
      MAXIMUM_APPROVAL_LIFETIME_MS ||
    approval.digest !==
      alertApprovalDigest({
        ...approval,
        adapterId,
        destinationRef
      })
  ) {
    throw new Error(
      "Reviewed outbound alert approval is invalid."
    );
  }
  return Object.freeze({
    schema: ALERT_APPROVAL_SCHEMA,
    adapterId,
    state: "approved",
    reportSchema: OPERATIONS_REPORT_SCHEMA,
    destinationRef,
    approvedAt: approval.approvedAt,
    expiresAt: approval.expiresAt,
    digest: approval.digest
  });
}

export async function readAlertApprovalFile(
  filePath
) {
  if (
    typeof filePath !== "string" ||
    !path.isAbsolute(filePath)
  ) {
    throw new Error(
      "Reviewed outbound alert approval path must be absolute."
    );
  }
  const [metadata, bytes] = await Promise.all([
    lstat(filePath),
    readFile(filePath)
  ]);
  if (
    !metadata.isFile() ||
    (metadata.mode & 0o077) !== 0 ||
    bytes.length === 0 ||
    bytes.length > 64 * 1024
  ) {
    throw new Error(
      "Reviewed outbound alert approval must be a bounded private regular file."
    );
  }
  return validateAlertApproval(
    parseJsonObject(
      bytes.toString("utf8"),
      "Reviewed outbound alert approval"
    )
  );
}

export function validateOperationsAlertTransition(
  value
) {
  exactKeys(
    value,
    TRANSITION_KEYS,
    "Operations alert transition"
  );
  if (
    value.schema !==
      OPERATIONS_ALERT_TRANSITION_SCHEMA ||
    !SHA256.test(value.transitionId) ||
    !TRANSITION_KINDS.has(value.kind)
  ) {
    throw new Error(
      "Operations alert transition is invalid."
    );
  }
  exactInstant(
    value.createdAt,
    "Operations alert transition time"
  );
  const currentCodes = alertCodes(
    value.alertCodes,
    "Operations alert codes"
  );
  const previousCodes = alertCodes(
    value.previousAlertCodes,
    "Previous operations alert codes"
  );
  const currentFingerprint =
    value.incidentFingerprint;
  const previousFingerprint =
    value.previousIncidentFingerprint;
  const currentIsDigest =
    typeof currentFingerprint === "string" &&
    SHA256.test(currentFingerprint);
  const previousIsDigest =
    typeof previousFingerprint === "string" &&
    SHA256.test(previousFingerprint);
  const shapeIsValid =
    (value.kind === "incident" &&
      currentIsDigest &&
      currentCodes.length > 0 &&
      previousFingerprint === null &&
      previousCodes.length === 0) ||
    (value.kind === "changed" &&
      currentIsDigest &&
      currentCodes.length > 0 &&
      previousIsDigest &&
      previousCodes.length > 0 &&
      currentFingerprint !==
        previousFingerprint) ||
    (value.kind === "reminder" &&
      currentIsDigest &&
      currentCodes.length > 0 &&
      previousFingerprint ===
        currentFingerprint &&
      canonicalJson(previousCodes) ===
        canonicalJson(currentCodes)) ||
    (value.kind === "recovery" &&
      currentFingerprint === null &&
      currentCodes.length === 0 &&
      previousIsDigest &&
      previousCodes.length > 0);
  if (!shapeIsValid) {
    throw new Error(
      "Operations alert transition shape is invalid."
    );
  }
  return Object.freeze({
    schema: OPERATIONS_ALERT_TRANSITION_SCHEMA,
    transitionId: value.transitionId,
    kind: value.kind,
    createdAt: value.createdAt,
    incidentFingerprint: currentFingerprint,
    previousIncidentFingerprint:
      previousFingerprint,
    alertCodes: currentCodes,
    previousAlertCodes: previousCodes
  });
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
  const reviewed = validateAlertApproval(approval);
  const adapterId = reviewed.adapterId;
  if (typeof deliver !== "function") {
    throw new Error(
      "Reviewed outbound alert approval is invalid."
    );
  }
  const approvedAt = new Date(reviewed.approvedAt);
  const expiresAt = new Date(reviewed.expiresAt);

  return Object.freeze({
    kind: adapterId,
    externalEffects: true,
    async readiness() {
      const current = now();
      if (
        !(current instanceof Date) ||
        Number.isNaN(current.valueOf())
      ) {
        throw new Error(
          "Reviewed outbound alert approval clock is invalid."
        );
      }
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
        approvalDigest: reviewed.digest
      });
    },
    async deliver(report, transition = null) {
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
      const selectedTransition =
        transition === null
          ? null
          : validateOperationsAlertTransition(
              transition
            );
      return deliver(
        Object.freeze({
          schema:
            "sitesourcery.outbound-alert-envelope/v1",
          adapterId,
          destinationRef:
            reviewed.destinationRef,
          approvalDigest: reviewed.digest,
          report,
          ...(selectedTransition
            ? { transition: selectedTransition }
            : {})
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
  if (typeof adapter.reconcile === "function") {
    return adapter.reconcile(report);
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
