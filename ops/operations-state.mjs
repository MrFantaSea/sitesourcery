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

export const OPERATIONS_STATE_APPROVAL_SCHEMA =
  "sitesourcery.operations-state-approval/v1";
export const OPERATIONS_STATE_EVIDENCE_SCHEMA =
  "sitesourcery.operations-state-evidence/v1";
export const PROVIDER_EGRESS_STATE_SCHEMA =
  "sitesourcery.provider-egress-state/v1";

const OPERATIONS_STATE_FIELDS = Object.freeze([
  "stripeMode",
  "registrationMailMode",
  "recoveryMailMode",
  "publication",
  "domainRuntime",
  "dns"
]);
const OPERATIONS_STATE_VALUES = Object.freeze({
  stripeMode: new Set(["held", "approved_live"]),
  registrationMailMode: new Set([
    "held",
    "production"
  ]),
  recoveryMailMode: new Set([
    "held",
    "production"
  ]),
  publication: new Set(["held", "approved"]),
  domainRuntime: new Set([
    "held",
    "approved_live"
  ]),
  dns: new Set(["held", "approved_live"])
});
const APPROVAL_CONSUMERS = new Set([
  "backup",
  "monitor"
]);
const APPROVAL_KEYS = Object.freeze([
  "approvalId",
  "approvedAt",
  "consumers",
  "digest",
  "expectedOperationsState",
  "expiresAt",
  "schema",
  "sourceFailureDomainId",
  "state"
]);
const EVIDENCE_KEYS = Object.freeze([
  "approval",
  "mode",
  "operationsState",
  "schema",
  "sourceFailureDomainId"
]);
const PROVIDER_EGRESS_FIELDS = Object.freeze([
  "dns",
  "outboundAlerts",
  "payments",
  "publication",
  "recoveryEmail",
  "registrationEmail",
  "registrar"
]);
const MAX_APPROVAL_LIFETIME_MS =
  366 * 24 * 60 * 60 * 1000;

export const DEFAULT_HELD_OPERATIONS_STATE =
  Object.freeze({
    stripeMode: "held",
    registrationMailMode: "held",
    recoveryMailMode: "held",
    publication: "held",
    domainRuntime: "held",
    dns: "held"
  });

export const HELD_PROVIDER_EGRESS_STATE =
  Object.freeze({
    schema: PROVIDER_EGRESS_STATE_SCHEMA,
    payments: "held",
    registrationEmail: "held",
    recoveryEmail: "held",
    publication: "held",
    registrar: "held",
    dns: "held",
    outboundAlerts: "held"
  });

export class OperationsStateFailure extends Error {
  constructor(code, message) {
    super(message);
    this.name = "OperationsStateFailure";
    this.code = code;
  }
}

function fail(code, message) {
  throw new OperationsStateFailure(code, message);
}

function exactKeys(value, expected, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    canonicalJson(Object.keys(value).sort()) !==
      canonicalJson([...expected].sort())
  ) {
    fail(
      "OPERATIONS_STATE_INVALID",
      `${label} must contain only its exact reviewed fields.`
    );
  }
}

function exactIso(value, label) {
  const selected = new Date(value);
  if (
    typeof value !== "string" ||
    Number.isNaN(selected.valueOf()) ||
    selected.toISOString() !== value
  ) {
    fail(
      "OPERATIONS_STATE_APPROVAL_INVALID",
      `${label} must be an exact ISO timestamp.`
    );
  }
  return selected;
}

export function validateOperationsState(state) {
  exactKeys(
    state,
    OPERATIONS_STATE_FIELDS,
    "Operations state"
  );
  const selected = {};
  for (const field of OPERATIONS_STATE_FIELDS) {
    if (
      !OPERATIONS_STATE_VALUES[field].has(
        state[field]
      )
    ) {
      fail(
        "OPERATIONS_STATE_INVALID",
        `Operations state ${field} is invalid.`
      );
    }
    selected[field] = state[field];
  }
  return Object.freeze(selected);
}

export function operationsStateFromEnvironment(
  environment
) {
  return validateOperationsState({
    stripeMode:
      environment.SITESOURCERY_STRIPE_MODE,
    registrationMailMode:
      environment
        .SITESOURCERY_REGISTRATION_MAIL_MODE,
    recoveryMailMode:
      environment
        .SITESOURCERY_RECOVERY_MAIL_MODE,
    publication:
      environment
        .SITESOURCERY_EXPECT_PUBLICATION,
    domainRuntime:
      environment
        .SITESOURCERY_EXPECT_DOMAIN_RUNTIME,
    dns: environment.SITESOURCERY_EXPECT_DNS
  });
}

function approvalPayload(value) {
  return {
    schema: OPERATIONS_STATE_APPROVAL_SCHEMA,
    approvalId: value.approvalId,
    state: value.state,
    sourceFailureDomainId:
      value.sourceFailureDomainId,
    consumers: value.consumers,
    expectedOperationsState:
      value.expectedOperationsState,
    approvedAt: value.approvedAt,
    expiresAt: value.expiresAt
  };
}

export function operationsStateApprovalDigest(value) {
  return sha256Bytes(
    Buffer.from(
      `${canonicalJson(approvalPayload(value))}\n`,
      "utf8"
    )
  );
}

function validateApproval(
  value,
  {
    sourceFailureDomainId,
    consumer = null,
    now = null
  }
) {
  exactKeys(
    value,
    APPROVAL_KEYS,
    "Operations-state approval"
  );
  const source = safeIdentifier(
    sourceFailureDomainId,
    "Source failure-domain ID"
  );
  const approvalId = safeIdentifier(
    value.approvalId,
    "Operations-state approval ID"
  );
  if (
    value.schema !==
      OPERATIONS_STATE_APPROVAL_SCHEMA ||
    value.state !== "approved" ||
    value.sourceFailureDomainId !== source ||
    !Array.isArray(value.consumers) ||
    value.consumers.length === 0 ||
    value.consumers.some(
      (candidate) =>
        !APPROVAL_CONSUMERS.has(candidate)
    ) ||
    new Set(value.consumers).size !==
      value.consumers.length ||
    canonicalJson(value.consumers) !==
      canonicalJson(
        [...value.consumers].sort((left, right) =>
          left.localeCompare(right)
        )
      ) ||
    (consumer !== null &&
      !value.consumers.includes(consumer))
  ) {
    fail(
      "OPERATIONS_STATE_APPROVAL_INVALID",
      "Operations-state approval identity, scope, or source is invalid."
    );
  }
  const expectedOperationsState =
    validateOperationsState(
      value.expectedOperationsState
    );
  const approvedAt = exactIso(
    value.approvedAt,
    "Operations-state approval start"
  );
  const expiresAt = exactIso(
    value.expiresAt,
    "Operations-state approval expiry"
  );
  if (
    expiresAt <= approvedAt ||
    expiresAt - approvedAt >
      MAX_APPROVAL_LIFETIME_MS ||
    value.digest !==
      operationsStateApprovalDigest({
        ...value,
        approvalId,
        expectedOperationsState
      })
  ) {
    fail(
      "OPERATIONS_STATE_APPROVAL_INVALID",
      "Operations-state approval dates or digest are invalid."
    );
  }
  if (now !== null) {
    if (
      !(now instanceof Date) ||
      Number.isNaN(now.valueOf())
    ) {
      fail(
        "OPERATIONS_STATE_APPROVAL_INVALID",
        "Operations-state approval clock is invalid."
      );
    }
    if (now < approvedAt || now >= expiresAt) {
      fail(
        "OPERATIONS_STATE_APPROVAL_EXPIRED",
        "Operations-state approval is not currently active."
      );
    }
  }
  return Object.freeze({
    schema: OPERATIONS_STATE_APPROVAL_SCHEMA,
    approvalId,
    state: "approved",
    sourceFailureDomainId: source,
    consumers: Object.freeze([
      ...value.consumers
    ]),
    expectedOperationsState,
    approvedAt: value.approvedAt,
    expiresAt: value.expiresAt,
    digest: value.digest
  });
}

export function resolveOperationsStateEvidence({
  actualOperationsState,
  approval = null,
  sourceFailureDomainId,
  consumer,
  now = new Date()
}) {
  if (!APPROVAL_CONSUMERS.has(consumer)) {
    fail(
      "OPERATIONS_STATE_APPROVAL_INVALID",
      "Operations-state approval consumer is invalid."
    );
  }
  const source = safeIdentifier(
    sourceFailureDomainId,
    "Source failure-domain ID"
  );
  const actual = validateOperationsState(
    actualOperationsState
  );
  if (approval === null) {
    if (
      canonicalJson(actual) !==
      canonicalJson(
        DEFAULT_HELD_OPERATIONS_STATE
      )
    ) {
      fail(
        "OPERATIONS_STATE_APPROVAL_REQUIRED",
        "A reviewed approval is required for any non-held source operations state."
      );
    }
    return Object.freeze({
      schema: OPERATIONS_STATE_EVIDENCE_SCHEMA,
      sourceFailureDomainId: source,
      mode: "default_held",
      operationsState: actual,
      approval: null
    });
  }
  const reviewed = validateApproval(approval, {
    sourceFailureDomainId: source,
    consumer,
    now
  });
  if (
    canonicalJson(actual) !==
    canonicalJson(
      reviewed.expectedOperationsState
    )
  ) {
    fail(
      "OPERATIONS_STATE_DRIFT",
      "The actual source operations state differs from its reviewed expectation."
    );
  }
  return Object.freeze({
    schema: OPERATIONS_STATE_EVIDENCE_SCHEMA,
    sourceFailureDomainId: source,
    mode: "reviewed",
    operationsState: actual,
    approval: reviewed
  });
}

export function validateOperationsStateEvidence(
  evidence,
  {
    sourceFailureDomainId,
    consumer = "backup"
  }
) {
  exactKeys(
    evidence,
    EVIDENCE_KEYS,
    "Operations-state evidence"
  );
  const source = safeIdentifier(
    sourceFailureDomainId,
    "Source failure-domain ID"
  );
  if (
    evidence.schema !==
      OPERATIONS_STATE_EVIDENCE_SCHEMA ||
    evidence.sourceFailureDomainId !== source
  ) {
    fail(
      "OPERATIONS_STATE_EVIDENCE_INVALID",
      "Operations-state evidence belongs to another schema or source."
    );
  }
  const operationsState = validateOperationsState(
    evidence.operationsState
  );
  if (evidence.mode === "default_held") {
    if (
      evidence.approval !== null ||
      canonicalJson(operationsState) !==
        canonicalJson(
          DEFAULT_HELD_OPERATIONS_STATE
        )
    ) {
      fail(
        "OPERATIONS_STATE_EVIDENCE_INVALID",
        "Default operations-state evidence must remain exactly held."
      );
    }
    return Object.freeze({
      schema: OPERATIONS_STATE_EVIDENCE_SCHEMA,
      sourceFailureDomainId: source,
      mode: "default_held",
      operationsState,
      approval: null
    });
  }
  if (evidence.mode !== "reviewed") {
    fail(
      "OPERATIONS_STATE_EVIDENCE_INVALID",
      "Operations-state evidence mode is invalid."
    );
  }
  const approval = validateApproval(
    evidence.approval,
    {
      sourceFailureDomainId: source,
      consumer,
      now: null
    }
  );
  if (
    canonicalJson(operationsState) !==
    canonicalJson(
      approval.expectedOperationsState
    )
  ) {
    fail(
      "OPERATIONS_STATE_EVIDENCE_INVALID",
      "Reviewed operations-state evidence drifted from its approval."
    );
  }
  return Object.freeze({
    schema: OPERATIONS_STATE_EVIDENCE_SCHEMA,
    sourceFailureDomainId: source,
    mode: "reviewed",
    operationsState,
    approval
  });
}

export async function readOperationsStateApprovalFile(
  filePath
) {
  if (filePath === undefined || filePath === null) {
    return null;
  }
  if (
    typeof filePath !== "string" ||
    filePath.length === 0 ||
    !path.isAbsolute(filePath)
  ) {
    fail(
      "OPERATIONS_STATE_APPROVAL_INVALID",
      "Operations-state approval path must be absolute when configured."
    );
  }
  const [metadata, bytes] = await Promise.all([
    lstat(filePath),
    readFile(filePath)
  ]);
  if (
    !metadata.isFile() ||
    (metadata.mode & 0o022) !== 0 ||
    bytes.length === 0 ||
    bytes.length > 64 * 1024
  ) {
    fail(
      "OPERATIONS_STATE_APPROVAL_INVALID",
      "Operations-state approval must be a bounded, non-group-writable regular file."
    );
  }
  return parseJsonObject(
    bytes.toString("utf8"),
    "Operations-state approval"
  );
}

export function assertOperationsProviderEgressHeld(
  value
) {
  if (value !== "held") {
    fail(
      "OPERATIONS_PROVIDER_EGRESS_NOT_HELD",
      "Backup and monitoring provider egress must remain independently held."
    );
  }
  return "held";
}

export function assertHeldProviderEgressState(
  state
) {
  exactKeys(
    state,
    ["schema", ...PROVIDER_EGRESS_FIELDS],
    "Provider-egress state"
  );
  if (
    state.schema !== PROVIDER_EGRESS_STATE_SCHEMA ||
    PROVIDER_EGRESS_FIELDS.some(
      (field) => state[field] !== "held"
    )
  ) {
    fail(
      "RESTORE_PROVIDER_EGRESS_NOT_HELD",
      "Every clean-room provider egress must remain held."
    );
  }
  return HELD_PROVIDER_EGRESS_STATE;
}

export function providerEgressStateFromEnvironment(
  environment
) {
  return assertHeldProviderEgressState({
    schema: PROVIDER_EGRESS_STATE_SCHEMA,
    payments:
      environment.SITESOURCERY_STRIPE_MODE,
    registrationEmail:
      environment
        .SITESOURCERY_REGISTRATION_MAIL_MODE,
    recoveryEmail:
      environment
        .SITESOURCERY_RECOVERY_MAIL_MODE,
    publication:
      environment
        .SITESOURCERY_EXPECT_PUBLICATION,
    registrar:
      environment
        .SITESOURCERY_EXPECT_DOMAIN_RUNTIME,
    dns: environment.SITESOURCERY_EXPECT_DNS,
    outboundAlerts:
      environment.SITESOURCERY_ALERT_MODE
  });
}
