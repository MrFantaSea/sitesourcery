import {
  canonicalJson,
  safeIdentifier,
  sha256Bytes
} from "./immutable-evidence.mjs";
import {
  evaluateIndependentDeadMan,
  validateIndependentMonitorHeartbeat,
  validateIndependentReleaseIdentity
} from "./independent-monitor-runtime.mjs";

export const INDEPENDENT_HEARTBEAT_EVIDENCE_SCHEMA =
  "sitesourcery.independent-heartbeat-evidence/v1";
export const INDEPENDENT_DEAD_MAN_STATE_SCHEMA =
  "sitesourcery.independent-dead-man-state/v1";
export const INDEPENDENT_DEAD_MAN_TRANSITION_SCHEMA =
  "sitesourcery.independent-dead-man-transition/v1";
export const INDEPENDENT_DEAD_MAN_ALERT_ENVELOPE_SCHEMA =
  "sitesourcery.independent-dead-man-alert-envelope/v1";
export const INDEPENDENT_DEAD_MAN_ALERT_PORT_RECEIPT_SCHEMA =
  "sitesourcery.independent-dead-man-alert-port-receipt/v1";
export const INDEPENDENT_DEAD_MAN_ALERT_RECEIPT_SCHEMA =
  "sitesourcery.independent-dead-man-alert-receipt/v1";

export const INDEPENDENT_DEAD_MAN_ALERT_CONTROL_HELD = freeze({
  state: "held",
  killSwitch: "engaged",
  allowsExternalEffects: false
});

export const INDEPENDENT_DEAD_MAN_ALERT_CONTROL_LOCAL_FIXTURE = freeze({
  state: "local_fixture",
  killSwitch: "disengaged",
  allowsExternalEffects: false
});

const SHA256 = /^[a-f0-9]{64}$/u;
const DEAD_MAN_CODES = new Set([
  "DEAD_MAN_HEARTBEAT_INVALID",
  "DEAD_MAN_HEARTBEAT_STALE",
  "DEAD_MAN_RELEASE_IDENTITY_DRIFT",
  "DEAD_MAN_HEARTBEAT_OUT_OF_ORDER",
  "DEAD_MAN_HEARTBEAT_SEQUENCE_CONFLICT"
]);
const HEARTBEAT_DISPOSITIONS = new Set([
  "accepted",
  "duplicate",
  "missing",
  "out_of_order",
  "sequence_conflict"
]);
const TRANSITION_KINDS = new Set([
  "baseline",
  "none",
  "incident",
  "changed",
  "recovery"
]);

function fail(message) {
  throw new Error(message);
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const entry of Object.values(value)) freeze(entry);
    Object.freeze(value);
  }
  return value;
}

function exactObject(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    canonicalJson(Object.keys(value).sort()) !==
      canonicalJson([...keys].sort())
  ) {
    fail(`${label} must contain only its exact fields.`);
  }
  return value;
}

function instant(value, label) {
  const selected = new Date(value);
  if (
    typeof value !== "string" ||
    Number.isNaN(selected.valueOf()) ||
    selected.toISOString() !== value
  ) {
    fail(`${label} is invalid.`);
  }
  return selected;
}

function selectedClock(now, label) {
  const selected = now();
  if (!(selected instanceof Date) || Number.isNaN(selected.valueOf())) {
    fail(`${label} is invalid.`);
  }
  return selected;
}

function digest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    fail(`${label} must be an exact lowercase SHA-256 digest.`);
  }
  return value;
}

function nullableDigest(value, label) {
  if (value !== null) digest(value, label);
  return value;
}

function fixedCode(value, label) {
  if (value !== null && !DEAD_MAN_CODES.has(value)) {
    fail(`${label} is invalid.`);
  }
  return value;
}

function exactRelease(actual, expected, label) {
  const selected = validateIndependentReleaseIdentity(actual);
  if (canonicalJson(selected) !== canonicalJson(expected)) {
    fail(`${label} drifted from the exact release identity.`);
  }
  return selected;
}

function heartbeatSha256(heartbeat) {
  return sha256Bytes(
    Buffer.from(`${canonicalJson(heartbeat)}\n`, "utf8")
  );
}

function heartbeatEvidencePayload(value) {
  return {
    schema: value.schema,
    sourceFailureDomainId: value.sourceFailureDomainId,
    observerFailureDomainId: value.observerFailureDomainId,
    receivedAt: value.receivedAt,
    heartbeat: value.heartbeat,
    heartbeatSha256: value.heartbeatSha256
  };
}

export function independentHeartbeatEvidenceDigest(value) {
  return sha256Bytes(
    Buffer.from(`${canonicalJson(heartbeatEvidencePayload(value))}\n`, "utf8")
  );
}

export function createIndependentHeartbeatEvidence({
  heartbeat,
  sourceFailureDomainId,
  observerFailureDomainId,
  receivedAt
}) {
  const selectedHeartbeat = validateIndependentMonitorHeartbeat(heartbeat);
  const value = {
    schema: INDEPENDENT_HEARTBEAT_EVIDENCE_SCHEMA,
    sourceFailureDomainId,
    observerFailureDomainId,
    receivedAt,
    heartbeat: structuredClone(selectedHeartbeat),
    heartbeatSha256: heartbeatSha256(selectedHeartbeat)
  };
  return validateIndependentHeartbeatEvidence({
    ...value,
    digest: independentHeartbeatEvidenceDigest(value)
  });
}

export function validateIndependentHeartbeatEvidence(value) {
  exactObject(
    value,
    [
      "schema",
      "sourceFailureDomainId",
      "observerFailureDomainId",
      "receivedAt",
      "heartbeat",
      "heartbeatSha256",
      "digest"
    ],
    "Independent heartbeat evidence"
  );
  const sourceFailureDomainId = safeIdentifier(
    value.sourceFailureDomainId,
    "Independent heartbeat source failure domain"
  );
  const observerFailureDomainId = safeIdentifier(
    value.observerFailureDomainId,
    "Independent heartbeat observer failure domain"
  );
  if (
    value.schema !== INDEPENDENT_HEARTBEAT_EVIDENCE_SCHEMA ||
    sourceFailureDomainId === observerFailureDomainId
  ) {
    fail("Independent heartbeat evidence identity is invalid.");
  }
  const heartbeat = validateIndependentMonitorHeartbeat(value.heartbeat);
  const receivedAt = instant(
    value.receivedAt,
    "Independent heartbeat receipt time"
  );
  if (receivedAt < instant(heartbeat.observedAt, "Independent heartbeat time")) {
    fail("Independent heartbeat receipt predates its observation.");
  }
  if (value.heartbeatSha256 !== heartbeatSha256(heartbeat)) {
    fail("Independent heartbeat evidence digest is invalid.");
  }
  digest(value.digest, "Independent heartbeat evidence");
  if (value.digest !== independentHeartbeatEvidenceDigest(value)) {
    fail("Independent heartbeat evidence receipt is invalid.");
  }
  return freeze({
    ...structuredClone(value),
    sourceFailureDomainId,
    observerFailureDomainId,
    heartbeat
  });
}

function statePayload(value) {
  return {
    schema: value.schema,
    release: value.release,
    sourceFailureDomainId: value.sourceFailureDomainId,
    observerFailureDomainId: value.observerFailureDomainId,
    revision: value.revision,
    status: value.status,
    activeCode: value.activeCode,
    lastHeartbeatEvidence: value.lastHeartbeatEvidence,
    lastTransitionId: value.lastTransitionId
  };
}

export function independentDeadManStateDigest(value) {
  return sha256Bytes(
    Buffer.from(`${canonicalJson(statePayload(value))}\n`, "utf8")
  );
}

export function createInitialIndependentDeadManState({
  releaseIdentity,
  sourceFailureDomainId,
  observerFailureDomainId
}) {
  const value = {
    schema: INDEPENDENT_DEAD_MAN_STATE_SCHEMA,
    release: structuredClone(
      validateIndependentReleaseIdentity(releaseIdentity)
    ),
    sourceFailureDomainId,
    observerFailureDomainId,
    revision: 0,
    status: "unknown",
    activeCode: null,
    lastHeartbeatEvidence: null,
    lastTransitionId: null
  };
  return validateIndependentDeadManState({
    ...value,
    digest: independentDeadManStateDigest(value)
  });
}

export function validateIndependentDeadManState(value) {
  exactObject(
    value,
    [
      "schema",
      "release",
      "sourceFailureDomainId",
      "observerFailureDomainId",
      "revision",
      "status",
      "activeCode",
      "lastHeartbeatEvidence",
      "lastTransitionId",
      "digest"
    ],
    "Independent dead-man state"
  );
  const release = validateIndependentReleaseIdentity(value.release);
  const sourceFailureDomainId = safeIdentifier(
    value.sourceFailureDomainId,
    "Independent dead-man source failure domain"
  );
  const observerFailureDomainId = safeIdentifier(
    value.observerFailureDomainId,
    "Independent dead-man observer failure domain"
  );
  if (
    value.schema !== INDEPENDENT_DEAD_MAN_STATE_SCHEMA ||
    sourceFailureDomainId === observerFailureDomainId ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    !["unknown", "healthy", "alerting"].includes(value.status)
  ) {
    fail("Independent dead-man state identity is invalid.");
  }
  fixedCode(value.activeCode, "Independent dead-man active code");
  nullableDigest(value.lastTransitionId, "Independent dead-man transition");
  const lastHeartbeatEvidence = value.lastHeartbeatEvidence === null
    ? null
    : validateIndependentHeartbeatEvidence(value.lastHeartbeatEvidence);
  if (lastHeartbeatEvidence) {
    exactRelease(
      lastHeartbeatEvidence.heartbeat.release,
      release,
      "Independent dead-man heartbeat"
    );
    if (
      lastHeartbeatEvidence.sourceFailureDomainId !== sourceFailureDomainId ||
      lastHeartbeatEvidence.observerFailureDomainId !== observerFailureDomainId
    ) {
      fail("Independent dead-man heartbeat failure domain drifted.");
    }
  }
  const validShape =
    (value.status === "unknown" &&
      value.revision === 0 &&
      value.activeCode === null &&
      lastHeartbeatEvidence === null &&
      value.lastTransitionId === null) ||
    (value.status === "healthy" &&
      value.revision > 0 &&
      value.activeCode === null &&
      lastHeartbeatEvidence !== null) ||
    (value.status === "alerting" &&
      value.revision > 0 &&
      value.activeCode !== null &&
      value.lastTransitionId !== null);
  if (!validShape) {
    fail("Independent dead-man state shape is invalid.");
  }
  digest(value.digest, "Independent dead-man state");
  if (value.digest !== independentDeadManStateDigest(value)) {
    fail("Independent dead-man state digest is invalid.");
  }
  return freeze({
    ...structuredClone(value),
    release,
    sourceFailureDomainId,
    observerFailureDomainId,
    lastHeartbeatEvidence
  });
}

function transitionId({
  state,
  kind,
  code,
  previousCode,
  heartbeatDisposition,
  heartbeatEvidenceDigest
}) {
  return sha256Bytes(
    Buffer.from(
      `${canonicalJson({
        schema: "sitesourcery.independent-dead-man-transition-id/v1",
        stateDigest: state.digest,
        kind,
        code,
        previousCode,
        heartbeatDisposition,
        heartbeatEvidenceDigest
      })}\n`,
      "utf8"
    )
  );
}

function transitionPayload(value) {
  return {
    schema: value.schema,
    transitionId: value.transitionId,
    kind: value.kind,
    createdAt: value.createdAt,
    release: value.release,
    sourceFailureDomainId: value.sourceFailureDomainId,
    observerFailureDomainId: value.observerFailureDomainId,
    heartbeatDisposition: value.heartbeatDisposition,
    heartbeatEvidenceDigest: value.heartbeatEvidenceDigest,
    code: value.code,
    previousCode: value.previousCode,
    deadManTelemetrySha256: value.deadManTelemetrySha256
  };
}

export function independentDeadManTransitionDigest(value) {
  return sha256Bytes(
    Buffer.from(`${canonicalJson(transitionPayload(value))}\n`, "utf8")
  );
}

export function validateIndependentDeadManTransition(value) {
  exactObject(
    value,
    [
      "schema",
      "transitionId",
      "kind",
      "createdAt",
      "release",
      "sourceFailureDomainId",
      "observerFailureDomainId",
      "heartbeatDisposition",
      "heartbeatEvidenceDigest",
      "code",
      "previousCode",
      "deadManTelemetrySha256",
      "digest"
    ],
    "Independent dead-man transition"
  );
  if (
    value.schema !== INDEPENDENT_DEAD_MAN_TRANSITION_SCHEMA ||
    !TRANSITION_KINDS.has(value.kind) ||
    !HEARTBEAT_DISPOSITIONS.has(value.heartbeatDisposition)
  ) {
    fail("Independent dead-man transition identity is invalid.");
  }
  digest(value.transitionId, "Independent dead-man transition ID");
  instant(value.createdAt, "Independent dead-man transition time");
  const release = validateIndependentReleaseIdentity(value.release);
  const sourceFailureDomainId = safeIdentifier(
    value.sourceFailureDomainId,
    "Independent dead-man transition source failure domain"
  );
  const observerFailureDomainId = safeIdentifier(
    value.observerFailureDomainId,
    "Independent dead-man transition observer failure domain"
  );
  if (sourceFailureDomainId === observerFailureDomainId) {
    fail("Independent dead-man transition failure domains are invalid.");
  }
  nullableDigest(
    value.heartbeatEvidenceDigest,
    "Independent dead-man heartbeat evidence"
  );
  fixedCode(value.code, "Independent dead-man transition code");
  fixedCode(value.previousCode, "Independent dead-man previous code");
  digest(value.deadManTelemetrySha256, "Independent dead-man telemetry");
  const shapeIsValid =
    (value.kind === "baseline" &&
      value.previousCode === null &&
      value.code === null) ||
    (value.kind === "none" && value.previousCode === value.code) ||
    (value.kind === "incident" &&
      value.previousCode === null &&
      value.code !== null) ||
    (value.kind === "changed" &&
      value.previousCode !== null &&
      value.code !== null &&
      value.previousCode !== value.code) ||
    (value.kind === "recovery" &&
      value.previousCode !== null &&
      value.code === null);
  if (!shapeIsValid) {
    fail("Independent dead-man transition shape is invalid.");
  }
  digest(value.digest, "Independent dead-man transition");
  if (value.digest !== independentDeadManTransitionDigest(value)) {
    fail("Independent dead-man transition digest is invalid.");
  }
  return freeze({
    ...structuredClone(value),
    release,
    sourceFailureDomainId,
    observerFailureDomainId
  });
}

function dispositionFor(state, evidence) {
  if (evidence === null) {
    return { disposition: "missing", accepted: null, observed: null };
  }
  const selected = validateIndependentHeartbeatEvidence(evidence);
  exactRelease(
    selected.heartbeat.release,
    state.release,
    "Independent heartbeat evidence"
  );
  if (
    selected.sourceFailureDomainId !== state.sourceFailureDomainId ||
    selected.observerFailureDomainId !== state.observerFailureDomainId
  ) {
    fail("Independent heartbeat evidence failure domain drifted.");
  }
  const previous = state.lastHeartbeatEvidence;
  if (previous === null) {
    return { disposition: "accepted", accepted: selected, observed: selected };
  }
  const currentHeartbeat = selected.heartbeat;
  const previousHeartbeat = previous.heartbeat;
  if (currentHeartbeat.sequence < previousHeartbeat.sequence) {
    return { disposition: "out_of_order", accepted: null, observed: selected };
  }
  if (currentHeartbeat.sequence === previousHeartbeat.sequence) {
    return {
      disposition:
        selected.heartbeatSha256 === previous.heartbeatSha256
          ? "duplicate"
          : "sequence_conflict",
      accepted: null,
      observed: selected
    };
  }
  if (
    instant(currentHeartbeat.observedAt, "Independent heartbeat time") <=
      instant(previousHeartbeat.observedAt, "Previous independent heartbeat time")
  ) {
    return { disposition: "out_of_order", accepted: null, observed: selected };
  }
  return { disposition: "accepted", accepted: selected, observed: selected };
}

function transitionKind(state, code) {
  if (state.status === "unknown") {
    return code === null ? "baseline" : "incident";
  }
  if (state.activeCode === code) return "none";
  if (state.activeCode === null) return "incident";
  if (code === null) return "recovery";
  return "changed";
}

function nextState({ state, acceptedEvidence, code, transition }) {
  const status = code === null ? "healthy" : "alerting";
  const evidence = acceptedEvidence ?? state.lastHeartbeatEvidence;
  const changed =
    acceptedEvidence !== null ||
    status !== state.status ||
    code !== state.activeCode;
  if (!changed) return state;
  const payload = {
    schema: INDEPENDENT_DEAD_MAN_STATE_SCHEMA,
    release: structuredClone(state.release),
    sourceFailureDomainId: state.sourceFailureDomainId,
    observerFailureDomainId: state.observerFailureDomainId,
    revision: state.revision + 1,
    status,
    activeCode: code,
    lastHeartbeatEvidence: evidence ? structuredClone(evidence) : null,
    lastTransitionId: ["incident", "changed", "recovery"].includes(
      transition.kind
    )
      ? transition.transitionId
      : state.lastTransitionId
  };
  return validateIndependentDeadManState({
    ...payload,
    digest: independentDeadManStateDigest(payload)
  });
}

export function reconcileIndependentDeadMan({
  state,
  heartbeatEvidence = null,
  maximumAgeMs,
  now = () => new Date()
}) {
  const selectedState = validateIndependentDeadManState(state);
  const observedAt = selectedClock(now, "Independent dead-man clock");
  const selectedDisposition = dispositionFor(
    selectedState,
    heartbeatEvidence
  );
  const candidateEvidence =
    selectedDisposition.accepted ?? selectedState.lastHeartbeatEvidence;
  const deadManReport = evaluateIndependentDeadMan({
    heartbeat: candidateEvidence?.heartbeat ?? null,
    releaseIdentity: selectedState.release,
    maximumAgeMs,
    now: () => observedAt
  });
  let code = deadManReport.code;
  if (selectedDisposition.disposition === "out_of_order") {
    code = "DEAD_MAN_HEARTBEAT_OUT_OF_ORDER";
  } else if (selectedDisposition.disposition === "sequence_conflict") {
    code = "DEAD_MAN_HEARTBEAT_SEQUENCE_CONFLICT";
  }
  const kind = transitionKind(selectedState, code);
  const evidenceDigest =
    selectedDisposition.observed?.digest ??
    selectedState.lastHeartbeatEvidence?.digest ??
    null;
  const base = {
    schema: INDEPENDENT_DEAD_MAN_TRANSITION_SCHEMA,
    transitionId: transitionId({
      state: selectedState,
      kind,
      code,
      previousCode: selectedState.activeCode,
      heartbeatDisposition: selectedDisposition.disposition,
      heartbeatEvidenceDigest: evidenceDigest
    }),
    kind,
    createdAt: observedAt.toISOString(),
    release: structuredClone(selectedState.release),
    sourceFailureDomainId: selectedState.sourceFailureDomainId,
    observerFailureDomainId: selectedState.observerFailureDomainId,
    heartbeatDisposition: selectedDisposition.disposition,
    heartbeatEvidenceDigest: evidenceDigest,
    code,
    previousCode: selectedState.activeCode,
    deadManTelemetrySha256: deadManReport.telemetrySha256
  };
  const transition = validateIndependentDeadManTransition({
    ...base,
    digest: independentDeadManTransitionDigest(base)
  });
  return freeze({
    transition,
    deadManReport,
    nextState: nextState({
      state: selectedState,
      acceptedEvidence: selectedDisposition.accepted,
      code,
      transition
    })
  });
}

function alertEnvelopePayload(value) {
  return {
    schema: value.schema,
    transitionId: value.transitionId,
    deadManTransitionDigest: value.deadManTransitionDigest,
    kind: value.kind,
    createdAt: value.createdAt,
    releaseBindingSha256: value.releaseBindingSha256,
    sourceFailureDomainId: value.sourceFailureDomainId,
    observerFailureDomainId: value.observerFailureDomainId,
    code: value.code,
    previousCode: value.previousCode,
    deadManTransitionDigest: value.deadManTransitionDigest
  };
}

function createAlertEnvelope(transition) {
  const selected = validateIndependentDeadManTransition(transition);
  const value = {
    schema: INDEPENDENT_DEAD_MAN_ALERT_ENVELOPE_SCHEMA,
    transitionId: selected.transitionId,
    kind: selected.kind,
    createdAt: selected.createdAt,
    releaseBindingSha256: selected.release.bindingSha256,
    sourceFailureDomainId: selected.sourceFailureDomainId,
    observerFailureDomainId: selected.observerFailureDomainId,
    code: selected.code,
    previousCode: selected.previousCode,
    deadManTransitionDigest: selected.digest
  };
  return freeze({
    ...value,
    digest: sha256Bytes(
      Buffer.from(`${canonicalJson(alertEnvelopePayload(value))}\n`, "utf8")
    )
  });
}

function portReceiptPayload(value) {
  return {
    schema: value.schema,
    transitionId: value.transitionId,
    acceptedAt: value.acceptedAt,
    deliveryRefSha256: value.deliveryRefSha256
  };
}

export function createIndependentDeadManAlertPortReceipt({
  transitionId: selectedTransitionId,
  acceptedAt,
  deliveryRefSha256
}) {
  const value = {
    schema: INDEPENDENT_DEAD_MAN_ALERT_PORT_RECEIPT_SCHEMA,
    transitionId: selectedTransitionId,
    acceptedAt,
    deliveryRefSha256
  };
  return validateIndependentDeadManAlertPortReceipt({
    ...value,
    digest: sha256Bytes(
      Buffer.from(`${canonicalJson(portReceiptPayload(value))}\n`, "utf8")
    )
  });
}

export function validateIndependentDeadManAlertPortReceipt(value) {
  exactObject(
    value,
    ["schema", "transitionId", "acceptedAt", "deliveryRefSha256", "digest"],
    "Independent dead-man alert port receipt"
  );
  if (value.schema !== INDEPENDENT_DEAD_MAN_ALERT_PORT_RECEIPT_SCHEMA) {
    fail("Independent dead-man alert port receipt identity is invalid.");
  }
  digest(value.transitionId, "Independent dead-man port transition");
  instant(value.acceptedAt, "Independent dead-man port acceptance");
  digest(value.deliveryRefSha256, "Independent dead-man delivery reference");
  digest(value.digest, "Independent dead-man port receipt");
  const expected = sha256Bytes(
    Buffer.from(`${canonicalJson(portReceiptPayload(value))}\n`, "utf8")
  );
  if (value.digest !== expected) {
    fail("Independent dead-man alert port receipt digest is invalid.");
  }
  return freeze(structuredClone(value));
}

function alertReceiptPayload(value) {
  return {
    schema: value.schema,
    transitionId: value.transitionId,
    deadManTransitionDigest: value.deadManTransitionDigest,
    kind: value.kind,
    createdAt: value.createdAt,
    controlState: value.controlState,
    killSwitch: value.killSwitch,
    mode: value.mode,
    attempted: value.attempted,
    delivered: value.delivered,
    code: value.code,
    portKind: value.portKind,
    portReceiptSha256: value.portReceiptSha256
  };
}

function createAlertReceipt(value) {
  return validateIndependentDeadManAlertReceipt({
    ...value,
    digest: sha256Bytes(
      Buffer.from(`${canonicalJson(alertReceiptPayload(value))}\n`, "utf8")
    )
  });
}

export function validateIndependentDeadManAlertReceipt(value) {
  exactObject(
    value,
    [
      "schema",
      "transitionId",
      "deadManTransitionDigest",
      "kind",
      "createdAt",
      "controlState",
      "killSwitch",
      "mode",
      "attempted",
      "delivered",
      "code",
      "portKind",
      "portReceiptSha256",
      "digest"
    ],
    "Independent dead-man alert receipt"
  );
  if (
    value.schema !== INDEPENDENT_DEAD_MAN_ALERT_RECEIPT_SCHEMA ||
    !TRANSITION_KINDS.has(value.kind) ||
    !["held", "local_fixture"].includes(value.controlState) ||
    !["engaged", "disengaged"].includes(value.killSwitch) ||
    !["none", "held", "local_fixture"].includes(value.mode) ||
    typeof value.attempted !== "boolean" ||
    typeof value.delivered !== "boolean"
  ) {
    fail("Independent dead-man alert receipt identity is invalid.");
  }
  digest(value.transitionId, "Independent dead-man alert transition");
  digest(
    value.deadManTransitionDigest,
    "Independent dead-man alert transition receipt"
  );
  instant(value.createdAt, "Independent dead-man alert receipt time");
  if (value.code !== null && value.code !== "INDEPENDENT_ALERTS_HELD") {
    fail("Independent dead-man alert receipt code is invalid.");
  }
  if (value.portKind !== null) {
    safeIdentifier(value.portKind, "Independent dead-man alert port");
  }
  nullableDigest(
    value.portReceiptSha256,
    "Independent dead-man alert port receipt"
  );
  const validShape =
    (value.mode === "none" &&
      !value.attempted &&
      !value.delivered &&
      value.code === null &&
      value.portKind === null &&
      value.portReceiptSha256 === null) ||
    (value.mode === "held" &&
      !value.attempted &&
      !value.delivered &&
      value.code === "INDEPENDENT_ALERTS_HELD" &&
      value.portKind === null &&
      value.portReceiptSha256 === null) ||
    (value.mode === "local_fixture" &&
      value.controlState === "local_fixture" &&
      value.killSwitch === "disengaged" &&
      value.attempted &&
      value.delivered &&
      value.code === null &&
      value.portKind !== null &&
      value.portReceiptSha256 !== null);
  if (!validShape) {
    fail("Independent dead-man alert receipt shape is invalid.");
  }
  digest(value.digest, "Independent dead-man alert receipt");
  const expected = sha256Bytes(
    Buffer.from(`${canonicalJson(alertReceiptPayload(value))}\n`, "utf8")
  );
  if (value.digest !== expected) {
    fail("Independent dead-man alert receipt digest is invalid.");
  }
  return freeze(structuredClone(value));
}

function validateControl(value) {
  exactObject(
    value,
    ["state", "killSwitch", "allowsExternalEffects"],
    "Independent dead-man alert control"
  );
  const selected = canonicalJson(value);
  if (
    selected !== canonicalJson(INDEPENDENT_DEAD_MAN_ALERT_CONTROL_HELD) &&
    selected !==
      canonicalJson(INDEPENDENT_DEAD_MAN_ALERT_CONTROL_LOCAL_FIXTURE)
  ) {
    fail("Independent dead-man alert control is invalid.");
  }
  return freeze(structuredClone(value));
}

function validateFixturePort(port) {
  if (
    !port ||
    typeof port !== "object" ||
    typeof port.kind !== "string" ||
    safeIdentifier(port.kind, "Independent dead-man alert port") !== port.kind ||
    port.externalEffects !== false ||
    typeof port.deliver !== "function"
  ) {
    fail("Independent dead-man local fixture port is invalid.");
  }
  return port;
}

export function createIndependentDeadManAlertAdapter({
  control = INDEPENDENT_DEAD_MAN_ALERT_CONTROL_HELD,
  port = null
} = {}) {
  const selectedControl = validateControl(control);
  const selectedPort = selectedControl.state === "local_fixture"
    ? validateFixturePort(port)
    : null;
  return freeze({
    kind: "independent-dead-man-alert-adapter",
    externalEffects: false,
    async dispatch(transition) {
      const selected = validateIndependentDeadManTransition(transition);
      const requiresAlert = ["incident", "changed", "recovery"].includes(
        selected.kind
      );
      if (!requiresAlert) {
        return createAlertReceipt({
          schema: INDEPENDENT_DEAD_MAN_ALERT_RECEIPT_SCHEMA,
          transitionId: selected.transitionId,
          deadManTransitionDigest: selected.digest,
          kind: selected.kind,
          createdAt: selected.createdAt,
          controlState: selectedControl.state,
          killSwitch: selectedControl.killSwitch,
          mode: "none",
          attempted: false,
          delivered: false,
          code: null,
          portKind: null,
          portReceiptSha256: null
        });
      }
      if (
        selectedControl.state === "held" ||
        selectedControl.killSwitch === "engaged"
      ) {
        return createAlertReceipt({
          schema: INDEPENDENT_DEAD_MAN_ALERT_RECEIPT_SCHEMA,
          transitionId: selected.transitionId,
          deadManTransitionDigest: selected.digest,
          kind: selected.kind,
          createdAt: selected.createdAt,
          controlState: selectedControl.state,
          killSwitch: selectedControl.killSwitch,
          mode: "held",
          attempted: false,
          delivered: false,
          code: "INDEPENDENT_ALERTS_HELD",
          portKind: null,
          portReceiptSha256: null
        });
      }
      const envelope = createAlertEnvelope(selected);
      const portReceipt = validateIndependentDeadManAlertPortReceipt(
        await selectedPort.deliver(envelope)
      );
      if (portReceipt.transitionId !== selected.transitionId) {
        fail("Independent dead-man alert port receipt drifted.");
      }
      if (
        instant(portReceipt.acceptedAt, "Independent dead-man port acceptance") <
          instant(selected.createdAt, "Independent dead-man transition time")
      ) {
        fail("Independent dead-man alert port receipt predates its transition.");
      }
      return createAlertReceipt({
        schema: INDEPENDENT_DEAD_MAN_ALERT_RECEIPT_SCHEMA,
        transitionId: selected.transitionId,
        deadManTransitionDigest: selected.digest,
        kind: selected.kind,
        createdAt: selected.createdAt,
        controlState: selectedControl.state,
        killSwitch: selectedControl.killSwitch,
        mode: "local_fixture",
        attempted: true,
        delivered: true,
        code: null,
        portKind: selectedPort.kind,
        portReceiptSha256: portReceipt.digest
      });
    }
  });
}

function validateStatePort(port) {
  if (
    !port ||
    typeof port !== "object" ||
    typeof port.kind !== "string" ||
    safeIdentifier(port.kind, "Independent dead-man state port") !== port.kind ||
    port.externalEffects !== false ||
    typeof port.load !== "function" ||
    typeof port.compareAndSwap !== "function"
  ) {
    fail("Independent dead-man state port is invalid.");
  }
  return port;
}

export async function runIndependentDeadManAlertCycle({
  statePort,
  alertAdapter = createIndependentDeadManAlertAdapter(),
  releaseIdentity,
  sourceFailureDomainId,
  observerFailureDomainId,
  heartbeatEvidence = null,
  maximumAgeMs,
  now = () => new Date()
}) {
  const selectedPort = validateStatePort(statePort);
  if (
    !alertAdapter ||
    alertAdapter.externalEffects !== false ||
    typeof alertAdapter.dispatch !== "function"
  ) {
    fail("Independent dead-man alert adapter is invalid.");
  }
  const initial = createInitialIndependentDeadManState({
    releaseIdentity,
    sourceFailureDomainId,
    observerFailureDomainId
  });
  const loaded = await selectedPort.load();
  const state = loaded === null
    ? initial
    : validateIndependentDeadManState(loaded);
  exactRelease(state.release, initial.release, "Independent dead-man state");
  if (
    state.sourceFailureDomainId !== initial.sourceFailureDomainId ||
    state.observerFailureDomainId !== initial.observerFailureDomainId
  ) {
    fail("Independent dead-man state failure domain drifted.");
  }
  const selectedNow = selectedClock(now, "Independent dead-man cycle clock");
  const reconciled = reconcileIndependentDeadMan({
    state,
    heartbeatEvidence,
    maximumAgeMs,
    now: () => selectedNow
  });
  const alertReceipt = await alertAdapter.dispatch(reconciled.transition);
  const requiresAlert = ["incident", "changed", "recovery"].includes(
    reconciled.transition.kind
  );
  let committed = false;
  let currentState = state;
  if (!requiresAlert || alertReceipt.delivered) {
    if (reconciled.nextState.digest !== state.digest) {
      const swapped = await selectedPort.compareAndSwap({
        expectedDigest: loaded === null ? null : state.digest,
        nextState: reconciled.nextState
      });
      if (swapped !== true) {
        fail("Independent dead-man state compare-and-swap failed.");
      }
      currentState = reconciled.nextState;
      committed = true;
    }
  }
  return freeze({
    transition: reconciled.transition,
    deadManReport: reconciled.deadManReport,
    alertReceipt,
    state: currentState,
    proposedState: reconciled.nextState,
    stateCommitted: committed
  });
}
