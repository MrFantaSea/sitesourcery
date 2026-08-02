import { constants as fsConstants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  rename,
  unlink
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import {
  OPERATIONS_ALERT_TRANSITION_SCHEMA,
  OPERATIONS_REPORT_SCHEMA,
  validateOperationsAlertTransition
} from "./alert-adapter.mjs";
import {
  canonicalJson,
  parseJsonObject,
  sha256Bytes
} from "./immutable-evidence.mjs";

export const OPERATIONS_ALERT_STATE_SCHEMA =
  "sitesourcery.operations-alert-state/v1";

const DEFAULT_REPEAT_INTERVAL_MS =
  6 * 60 * 60 * 1000;
const MAXIMUM_STATE_BYTES = 256 * 1024;
const SHA256 = /^[a-f0-9]{64}$/u;
const ALERT_CODE = /^[A-Z][A-Z0-9_]{2,127}$/u;
const STATE_KEYS = Object.freeze([
  "alertCodes",
  "incidentFingerprint",
  "incidentStartedAt",
  "lastDeliveredAt",
  "pending",
  "schema",
  "status"
]);
const COMMITTED_KEYS = Object.freeze([
  "alertCodes",
  "incidentFingerprint",
  "incidentStartedAt",
  "lastDeliveredAt",
  "status"
]);
const PENDING_KEYS = Object.freeze([
  "next",
  "report",
  "transition"
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
      `${label} must contain only its exact fields.`
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

function validatedCodes(value, label) {
  if (
    !Array.isArray(value) ||
    value.length > 64 ||
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

function validateReport(report) {
  if (
    !report ||
    typeof report !== "object" ||
    Array.isArray(report) ||
    report.schema !== OPERATIONS_REPORT_SCHEMA ||
    typeof report.ok !== "boolean" ||
    !Array.isArray(report.alerts) ||
    report.alerts.length > 64
  ) {
    throw new Error(
      "Persistent operations alert report is invalid."
    );
  }
  exactInstant(
    report.observedAt,
    "Persistent operations alert observation time"
  );
  const seen = new Set();
  for (const item of report.alerts) {
    exactKeys(
      item,
      ["code", "severity", "summary"],
      "Persistent operations alert"
    );
    if (
      !ALERT_CODE.test(item.code) ||
      seen.has(item.code) ||
      !["critical", "warning"].includes(
        item.severity
      ) ||
      typeof item.summary !== "string" ||
      item.summary.length < 1 ||
      item.summary.length > 500 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(
        item.summary
      )
    ) {
      throw new Error(
        "Persistent operations alert content is invalid."
      );
    }
    seen.add(item.code);
  }
  const codes = [...seen].sort((left, right) =>
    left.localeCompare(right)
  );
  if (
    canonicalJson(report.alerts.map(({ code }) => code)) !==
      canonicalJson(codes) ||
    report.ok !== (report.alerts.length === 0)
  ) {
    throw new Error(
      "Persistent operations alert ordering or status is invalid."
    );
  }
  return report;
}

function fingerprint(report) {
  validateReport(report);
  if (report.alerts.length === 0) return null;
  return sha256Bytes(
    Buffer.from(
      `${canonicalJson(
        report.alerts.map(
          ({ code, severity, summary }) => ({
            code,
            severity,
            summary
          })
        )
      )}\n`,
      "utf8"
    )
  );
}

function validateCommitted(value, label) {
  exactKeys(value, COMMITTED_KEYS, label);
  const codes = validatedCodes(
    value.alertCodes,
    `${label} alert codes`
  );
  const lastDeliveredAt =
    value.lastDeliveredAt === null
      ? null
      : exactInstant(
          value.lastDeliveredAt,
          `${label} last delivery time`
        ).toISOString();
  if (value.status === "healthy") {
    if (
      value.incidentFingerprint !== null ||
      value.incidentStartedAt !== null ||
      codes.length !== 0
    ) {
      throw new Error(
        `${label} healthy state is invalid.`
      );
    }
  } else if (value.status === "alerting") {
    if (
      typeof value.incidentFingerprint !==
        "string" ||
      !SHA256.test(value.incidentFingerprint) ||
      codes.length === 0 ||
      value.incidentStartedAt === null
    ) {
      throw new Error(
        `${label} alerting state is invalid.`
      );
    }
    exactInstant(
      value.incidentStartedAt,
      `${label} incident start time`
    );
    if (lastDeliveredAt === null) {
      throw new Error(
        `${label} delivery state is invalid.`
      );
    }
  } else {
    throw new Error(`${label} status is invalid.`);
  }
  return Object.freeze({
    status: value.status,
    incidentFingerprint:
      value.incidentFingerprint,
    alertCodes: codes,
    incidentStartedAt:
      value.incidentStartedAt,
    lastDeliveredAt
  });
}

function validatePending(value) {
  exactKeys(
    value,
    PENDING_KEYS,
    "Pending operations alert"
  );
  const transition =
    validateOperationsAlertTransition(
      value.transition
    );
  const report = validateReport(value.report);
  const next = validateCommitted(
    value.next,
    "Pending operations alert next state"
  );
  const reportFingerprint = fingerprint(report);
  if (
    transition.incidentFingerprint !==
      reportFingerprint ||
    transition.alertCodes.length !==
      report.alerts.length ||
    transition.alertCodes.some(
      (code, index) =>
        code !== report.alerts[index].code
    ) ||
    transition.createdAt !==
      next.lastDeliveredAt ||
    (transition.kind === "recovery"
      ? next.status !== "healthy"
      : next.status !== "alerting" ||
        next.incidentFingerprint !==
          transition.incidentFingerprint)
  ) {
    throw new Error(
      "Pending operations alert transition drifted."
    );
  }
  return Object.freeze({
    transition,
    report,
    next
  });
}

function validateState(value) {
  exactKeys(
    value,
    STATE_KEYS,
    "Operations alert state"
  );
  if (value.schema !== OPERATIONS_ALERT_STATE_SCHEMA) {
    throw new Error(
      "Operations alert state schema is invalid."
    );
  }
  const committed = validateCommitted(
    {
      status: value.status,
      incidentFingerprint:
        value.incidentFingerprint,
      alertCodes: value.alertCodes,
      incidentStartedAt: value.incidentStartedAt,
      lastDeliveredAt: value.lastDeliveredAt
    },
    "Operations alert state"
  );
  return Object.freeze({
    schema: OPERATIONS_ALERT_STATE_SCHEMA,
    ...committed,
    pending:
      value.pending === null
        ? null
        : validatePending(value.pending)
  });
}

function initialState() {
  return Object.freeze({
    schema: OPERATIONS_ALERT_STATE_SCHEMA,
    status: "healthy",
    incidentFingerprint: null,
    alertCodes: Object.freeze([]),
    incidentStartedAt: null,
    lastDeliveredAt: null,
    pending: null
  });
}

async function ensurePrivateParent(stateFile) {
  const directory = path.dirname(stateFile);
  await mkdir(directory, {
    recursive: true,
    mode: 0o700
  });
  const metadata = await lstat(directory);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink()
  ) {
    throw new Error(
      "Operations alert state directory is unsafe."
    );
  }
  await chmod(directory, 0o700);
  return directory;
}

async function readState(stateFile) {
  let handle;
  try {
    handle = await open(
      stateFile,
      fsConstants.O_RDONLY |
        (fsConstants.O_NOFOLLOW ?? 0)
    );
  } catch (error) {
    if (error?.code === "ENOENT") {
      return initialState();
    }
    throw error;
  }
  try {
    const metadata = await handle.stat();
    if (
      !metadata.isFile() ||
      (metadata.mode & 0o077) !== 0 ||
      metadata.size < 1 ||
      metadata.size > MAXIMUM_STATE_BYTES
    ) {
      throw new Error(
        "Operations alert state file is unsafe."
      );
    }
    return validateState(
      parseJsonObject(
        (await handle.readFile()).toString("utf8"),
        "Operations alert state"
      )
    );
  } finally {
    await handle.close();
  }
}

async function writeState(
  stateFile,
  value,
  tokenFactory
) {
  const selected = validateState(value);
  const bytes = Buffer.from(
    `${canonicalJson(selected)}\n`,
    "utf8"
  );
  if (bytes.length > MAXIMUM_STATE_BYTES) {
    throw new Error(
      "Operations alert state exceeds its bound."
    );
  }
  const directory = await ensurePrivateParent(
    stateFile
  );
  const token = String(tokenFactory());
  if (!/^[a-zA-Z0-9-]{8,128}$/u.test(token)) {
    throw new Error(
      "Operations alert state token is invalid."
    );
  }
  const temporary = path.join(
    directory,
    `.${path.basename(stateFile)}.${token}.tmp`
  );
  let handle;
  try {
    handle = await open(
      temporary,
      fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        fsConstants.O_WRONLY,
      0o600
    );
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, stateFile);
    await chmod(stateFile, 0o600);
    const directoryHandle = await open(
      directory,
      fsConstants.O_RDONLY
    );
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  } finally {
    if (handle) await handle.close().catch(() => {});
    await unlink(temporary).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

function committedState({
  status,
  incidentFingerprint,
  alertCodes,
  incidentStartedAt,
  lastDeliveredAt
}) {
  return Object.freeze({
    status,
    incidentFingerprint,
    alertCodes: Object.freeze([...alertCodes]),
    incidentStartedAt,
    lastDeliveredAt
  });
}

function transitionFor({
  kind,
  report,
  previous,
  createdAt
}) {
  const currentFingerprint = fingerprint(report);
  const currentCodes = report.alerts.map(
    ({ code }) => code
  );
  const payload = {
    schema: OPERATIONS_ALERT_TRANSITION_SCHEMA,
    kind,
    createdAt,
    incidentFingerprint: currentFingerprint,
    previousIncidentFingerprint:
      previous.incidentFingerprint,
    alertCodes: currentCodes,
    previousAlertCodes: previous.alertCodes
  };
  return validateOperationsAlertTransition({
    ...payload,
    transitionId: sha256Bytes(
      Buffer.from(
        `${canonicalJson(payload)}\n`,
        "utf8"
      )
    )
  });
}

function pendingFor({
  state,
  report,
  kind,
  createdAt
}) {
  const transition = transitionFor({
    kind,
    report,
    previous: state,
    createdAt
  });
  let next;
  if (kind === "recovery") {
    next = committedState({
      status: "healthy",
      incidentFingerprint: null,
      alertCodes: [],
      incidentStartedAt: null,
      lastDeliveredAt: createdAt
    });
  } else {
    next = committedState({
      status: "alerting",
      incidentFingerprint:
        transition.incidentFingerprint,
      alertCodes: transition.alertCodes,
      incidentStartedAt:
        kind === "reminder"
          ? state.incidentStartedAt
          : createdAt,
      lastDeliveredAt: createdAt
    });
  }
  return Object.freeze({
    transition,
    report,
    next
  });
}

function stateWithPending(state, pending) {
  return Object.freeze({
    ...state,
    pending
  });
}

function stateFromCommitted(committed) {
  return Object.freeze({
    schema: OPERATIONS_ALERT_STATE_SCHEMA,
    ...committed,
    pending: null
  });
}

function selectedClock(now) {
  const value = now();
  if (
    !(value instanceof Date) ||
    Number.isNaN(value.valueOf())
  ) {
    throw new Error(
      "Persistent operations alert clock is invalid."
    );
  }
  return value;
}

export function operationsAlertFingerprint(report) {
  return fingerprint(report);
}

export function createPersistentOperationsAlertAdapter({
  adapter,
  stateFile,
  repeatIntervalMs = DEFAULT_REPEAT_INTERVAL_MS,
  now = () => new Date(),
  tokenFactory = randomUUID
}) {
  const selectedRepeatInterval = Number(
    repeatIntervalMs
  );
  const resolvedStateFile = path.resolve(
    String(stateFile ?? "")
  );
  if (
    !adapter ||
    typeof adapter.readiness !== "function" ||
    typeof adapter.deliver !== "function" ||
    typeof stateFile !== "string" ||
    !path.isAbsolute(stateFile) ||
    resolvedStateFile ===
      path.parse(resolvedStateFile).root ||
    !Number.isSafeInteger(
      selectedRepeatInterval
    ) ||
    selectedRepeatInterval < 60 * 1000 ||
    selectedRepeatInterval >
      30 * 24 * 60 * 60 * 1000 ||
    typeof now !== "function" ||
    typeof tokenFactory !== "function"
  ) {
    throw new Error(
      "Persistent operations alert configuration is invalid."
    );
  }

  async function deliverPending(state) {
    const { pending } = state;
    const readiness = await adapter.readiness();
    if (!readiness.ready) {
      return Object.freeze({
        attempted: false,
        delivered: false,
        required: true,
        mode: readiness.mode,
        code: readiness.code,
        transition: pending.transition.kind,
        transitionId:
          pending.transition.transitionId
      });
    }
    const receipt = await adapter.deliver(
      pending.report,
      pending.transition
    );
    await writeState(
      resolvedStateFile,
      stateFromCommitted(pending.next),
      tokenFactory
    );
    return Object.freeze({
      attempted: true,
      delivered: true,
      required: true,
      mode: readiness.mode,
      approvalDigest:
        readiness.approvalDigest ?? null,
      transition: pending.transition.kind,
      transitionId:
        pending.transition.transitionId,
      provider: receipt?.provider ?? null,
      providerMessageId:
        receipt?.providerMessageId ?? null
    });
  }

  return Object.freeze({
    kind: `persistent-${adapter.kind}`,
    externalEffects: true,
    readiness() {
      return adapter.readiness();
    },
    async reconcile(report) {
      const currentFingerprint = fingerprint(
        report
      );
      const state = await readState(
        resolvedStateFile
      );
      if (state.pending) {
        return deliverPending(state);
      }
      const current = selectedClock(now);
      const createdAt = current.toISOString();
      let kind = null;
      if (currentFingerprint === null) {
        if (state.status === "alerting") {
          kind = "recovery";
        }
      } else if (state.status === "healthy") {
        kind = "incident";
      } else if (
        currentFingerprint !==
        state.incidentFingerprint
      ) {
        kind = "changed";
      } else if (
        current -
          exactInstant(
            state.lastDeliveredAt,
            "Operations alert last delivery time"
          ) >=
        selectedRepeatInterval
      ) {
        kind = "reminder";
      }

      if (kind === null) {
        return Object.freeze({
          attempted: false,
          delivered: false,
          required: false,
          mode:
            currentFingerprint === null
              ? "none"
              : "suppressed",
          ...(currentFingerprint === null
            ? {}
            : {
                code:
                  "DUPLICATE_ALERT_SUPPRESSED",
                incidentFingerprint:
                  currentFingerprint
              })
        });
      }

      const pending = pendingFor({
        state,
        report,
        kind,
        createdAt
      });
      const pendingState = stateWithPending(
        state,
        pending
      );
      await writeState(
        resolvedStateFile,
        pendingState,
        tokenFactory
      );
      return deliverPending(pendingState);
    }
  });
}

export {
  DEFAULT_REPEAT_INTERVAL_MS
};
