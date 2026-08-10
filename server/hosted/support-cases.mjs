import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { HostedError, invariant } from "./errors.mjs";
import { canonicalJson, digest } from "./security.mjs";

export const SUPPORT_CASE_SCHEMA = "sitesourcery.support-case/v1";
export const SUPPORT_CASE_CUSTOMER_READ_SCHEMA =
  "sitesourcery.support-case-customer-read/v1";
export const SUPPORT_CASE_OPERATOR_READ_SCHEMA =
  "sitesourcery.support-case-operator-read/v1";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u;
const REQUEST_KINDS = new Set([
  "support", "access", "correction", "export", "deletion", "appeal"
]);
const EXTERNAL_CHANNELS = new Set(["phone", "email", "manual"]);
const IDENTITY_STATES = new Set([
  "verification_pending", "verified", "not_required", "unable_to_verify"
]);
const EVIDENCE_KINDS = new Set([
  "request_scope", "identity_verification", "correspondence",
  "deadline_basis", "response", "denial", "appeal", "closure"
]);
const DENIAL_REASONS = new Set([
  "identity_not_verified", "request_not_supported", "legal_exception",
  "records_not_found", "duplicate_request", "other_reviewed"
]);
const CLOSURE_REASONS = new Set([
  "completed", "appeal_window_elapsed", "withdrawn", "duplicate",
  "superseded", "no_further_action"
]);
const NOTIFICATION_KINDS = new Set([
  "acknowledgment", "response", "denial", "appeal_acknowledgment", "closure"
]);

function exactObject(value, keys, field) {
  invariant(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort()),
    "SUPPORT_CASE_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function uuid(value, field, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  invariant(
    typeof value === "string" && UUID.test(value),
    "SUPPORT_CASE_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function sha256(value, field) {
  invariant(
    typeof value === "string" && SHA256.test(value),
    "SUPPORT_CASE_INVALID",
    `${field} must be an opaque lowercase SHA-256 or HMAC digest.`,
    { status: 400 }
  );
  return value;
}

function commandId(value) {
  invariant(
    typeof value === "string" && SAFE_ID.test(value),
    "SUPPORT_CASE_INVALID",
    "Support case command ID is invalid.",
    { status: 400 }
  );
  return value;
}

function instant(value, field) {
  invariant(
    typeof value === "string" &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
    "SUPPORT_CASE_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function currentTime(clock) {
  const selected = typeof clock === "function" ? clock() : clock?.now?.();
  invariant(
    typeof selected === "string" &&
      Number.isFinite(Date.parse(selected)) &&
      new Date(selected).toISOString() === selected,
    "SUPPORT_CASE_CONFIGURATION_REQUIRED",
    "The support case clock is invalid.",
    { status: 500 }
  );
  return selected;
}

function digestList(value, field) {
  invariant(
    Array.isArray(value) &&
      value.length <= 8 &&
      value.every((entry) => SHA256.test(entry)) &&
      new Set(value).size === value.length &&
      JSON.stringify([...value].sort()) === JSON.stringify(value),
    "SUPPORT_CASE_INVALID",
    `${field} must contain at most eight unique sorted digests.`,
    { status: 400 }
  );
  return [...value];
}

function requestScope(input) {
  invariant(
    ["general", "account", "project"].includes(input.scopeKind),
    "SUPPORT_CASE_INVALID",
    "Support case scope is invalid.",
    { status: 400 }
  );
  const selected = {
    scopeKind: input.scopeKind,
    organizationId: uuid(input.organizationId, "Organization ID", { nullable: true }),
    projectId: uuid(input.projectId, "Project ID", { nullable: true }),
    requesterUserId: uuid(input.requesterUserId, "Requester user ID", {
      nullable: true
    })
  };
  const valid =
    (selected.scopeKind === "general" &&
      selected.organizationId === null && selected.projectId === null &&
      selected.requesterUserId === null) ||
    (selected.scopeKind === "account" &&
      selected.organizationId !== null && selected.projectId === null &&
      selected.requesterUserId !== null) ||
    (selected.scopeKind === "project" &&
      selected.organizationId !== null && selected.projectId !== null &&
      selected.requesterUserId !== null);
  invariant(valid, "SUPPORT_CASE_INVALID", "Support case scope is invalid.", {
    status: 400
  });
  return selected;
}

function opening(value, { authenticated, recordedAt }) {
  const keys = authenticated
    ? [
        "actorId", "commandId", "evidenceDigests", "organizationId",
        "parentCaseId", "projectId", "requestKind",
        "requesterReferenceDigest", "requesterUserId", "scopeKind"
      ]
    : [
        "actorId", "commandId", "evidenceDigests", "intakeChannel",
        "organizationId", "operatorOrganizationId", "parentCaseId",
        "projectId", "requestKind", "requesterReferenceDigest",
        "requesterUserId", "scopeKind"
      ];
  exactObject(value, keys, authenticated ? "Authenticated case" : "Manual case");
  invariant(
    REQUEST_KINDS.has(value.requestKind),
    "SUPPORT_CASE_INVALID",
    "Support request kind is invalid.",
    { status: 400 }
  );
  const parentCaseId = uuid(value.parentCaseId, "Parent case ID", { nullable: true });
  invariant(
    (value.requestKind === "appeal") === (parentCaseId !== null),
    "SUPPORT_CASE_INVALID",
    "An appeal must identify exactly one denied parent case.",
    { status: 400 }
  );
  const scope = requestScope(value);
  const actorId = uuid(value.actorId, "Actor ID");
  if (authenticated) {
    invariant(
      scope.scopeKind !== "general" && actorId === scope.requesterUserId,
      "SUPPORT_CASE_UNAVAILABLE",
      "The support case scope is unavailable.",
      { status: 404 }
    );
  } else {
    invariant(
      EXTERNAL_CHANNELS.has(value.intakeChannel),
      "SUPPORT_CASE_INVALID",
      "Manual intake channel is invalid.",
      { status: 400 }
    );
  }
  const selected = {
    schema: SUPPORT_CASE_SCHEMA,
    actorId,
    operatorOrganizationId: authenticated
      ? scope.organizationId
      : uuid(value.operatorOrganizationId, "Operator organization ID"),
    commandId: commandId(value.commandId),
    intakeChannel: authenticated ? "authenticated" : value.intakeChannel,
    requestKind: value.requestKind,
    ...scope,
    requesterReferenceDigest: sha256(
      value.requesterReferenceDigest,
      "Requester reference digest"
    ),
    parentCaseId,
    evidenceDigests: digestList(value.evidenceDigests, "Opening evidence"),
    recordedAt
  };
  const commandFact = { ...selected };
  delete commandFact.recordedAt;
  return deepFreeze({ ...selected, requestDigest: digest(commandFact) });
}

function operatorBase(value, extraKeys, field, recordedAt) {
  exactObject(
    value,
    ["actorId", "caseId", "commandId", "expectedRevision", "operatorOrganizationId", ...extraKeys],
    field
  );
  invariant(
    Number.isSafeInteger(value.expectedRevision) && value.expectedRevision > 0,
    "SUPPORT_CASE_INVALID",
    "Expected case revision is invalid.",
    { status: 400 }
  );
  return {
    schema: `sitesourcery.support-case-${field.toLowerCase().replaceAll(" ", "-")}/v1`,
    actorId: uuid(value.actorId, "Operator actor ID"),
    operatorOrganizationId: uuid(
      value.operatorOrganizationId,
      "Operator organization ID"
    ),
    caseId: uuid(value.caseId, "Case ID"),
    commandId: commandId(value.commandId),
    expectedRevision: value.expectedRevision,
    recordedAt
  };
}

function command(value, extraKeys, field, recordedAt, extend) {
  const base = operatorBase(value, extraKeys, field, recordedAt);
  const selected = { ...base, ...extend(value) };
  const commandFact = { ...selected };
  delete commandFact.recordedAt;
  return deepFreeze({ ...selected, requestDigest: digest(commandFact) });
}

function heldError() {
  return new HostedError(
    "SUPPORT_CASES_HELD",
    "The auditable support and privacy case interface is not open yet.",
    {
      status: 503,
      details: {
        providerEffects: false,
        deletionExecution: false,
        exportExecution: false
      }
    }
  );
}

const METHODS = Object.freeze([
  "openAuthenticated", "recordManual", "assign", "updateIdentity",
  "setDeadline", "startReview", "respond", "deny", "close",
  "addEvidence", "reserveNotification", "readCustomerCase",
  "listCustomerCases", "readOperatorCase", "listOperatorCases"
]);

export function createHeldSupportCaseService() {
  const held = {
    kind: "support-case-lifecycle",
    mode: "held",
    providerEffects: false,
    async readiness() {
      return deepFreeze({
        ready: false,
        verified: false,
        kind: "support-case-lifecycle",
        mode: "held",
        code: "SUPPORT_CASES_HELD",
        providerEffects: false,
        deletionExecution: false,
        exportExecution: false
      });
    }
  };
  for (const method of METHODS) held[method] = async () => { throw heldError(); };
  return Object.freeze(held);
}

export function createSupportCaseService({ repository, mailLifecycle, clock } = {}) {
  invariant(
    repository && ["readiness", ...METHODS.filter((name) => name !== "reserveNotification")]
      .every((name) => typeof repository[name] === "function") &&
      typeof repository.linkMailReservation === "function",
    "SUPPORT_CASE_CONFIGURATION_REQUIRED",
    "A complete support case repository is required.",
    { status: 500 }
  );
  invariant(
    mailLifecycle && mailLifecycle.kind === "durable-mail-lifecycle" &&
      mailLifecycle.providerEffects === false &&
      typeof mailLifecycle.reserve === "function",
    "SUPPORT_CASE_CONFIGURATION_REQUIRED",
    "A no-provider-effect MAIL-01 reservation port is required.",
    { status: 500 }
  );
  const at = () => currentTime(clock);
  return Object.freeze({
    kind: "support-case-lifecycle",
    mode: "repository",
    providerEffects: false,
    readiness: () => repository.readiness(),
    openAuthenticated: (input) => repository.openAuthenticated(
      opening(input, { authenticated: true, recordedAt: at() })
    ),
    recordManual: (input) => repository.recordManual(
      opening(input, { authenticated: false, recordedAt: at() })
    ),
    assign(input) {
      return repository.assign(command(input, ["assignedOperatorId"], "assign", at(),
        (value) => ({ assignedOperatorId: uuid(value.assignedOperatorId, "Assigned operator ID") })));
    },
    updateIdentity(input) {
      return repository.updateIdentity(command(
        input, ["evidenceDigest", "identityState"], "identity update", at(),
        (value) => {
          invariant(IDENTITY_STATES.has(value.identityState), "SUPPORT_CASE_INVALID",
            "Identity verification state is invalid.", { status: 400 });
          return {
            identityState: value.identityState,
            evidenceDigest: sha256(value.evidenceDigest, "Identity evidence digest")
          };
        }
      ));
    },
    setDeadline(input) {
      return repository.setDeadline(command(
        input, ["basisDigest", "responseDueAt"], "deadline set", at(),
        (value) => ({
          responseDueAt: instant(value.responseDueAt, "Response deadline"),
          basisDigest: sha256(value.basisDigest, "Deadline basis digest")
        })
      ));
    },
    startReview(input) {
      return repository.startReview(command(input, [], "review start", at(), () => ({})));
    },
    respond(input) {
      return repository.respond(command(
        input, ["responseDigest"], "respond", at(),
        (value) => ({ responseDigest: sha256(value.responseDigest, "Response digest") })
      ));
    },
    deny(input) {
      return repository.deny(command(
        input,
        ["appealAvailable", "appealBasisDigest", "appealDueAt", "denialExplanationDigest", "denialReasonCode"],
        "deny",
        at(),
        (value) => {
          invariant(DENIAL_REASONS.has(value.denialReasonCode), "SUPPORT_CASE_INVALID",
            "Denial reason is invalid.", { status: 400 });
          invariant(typeof value.appealAvailable === "boolean", "SUPPORT_CASE_INVALID",
            "Appeal availability is invalid.", { status: 400 });
          const appealDueAt = value.appealDueAt === null
            ? null : instant(value.appealDueAt, "Appeal deadline");
          const appealBasisDigest = value.appealBasisDigest === null
            ? null : sha256(value.appealBasisDigest, "Appeal basis digest");
          invariant(
            value.appealAvailable === (appealDueAt !== null) &&
              value.appealAvailable === (appealBasisDigest !== null),
            "SUPPORT_CASE_INVALID",
            "Appeal authority is incomplete.",
            { status: 400 }
          );
          return {
            denialReasonCode: value.denialReasonCode,
            denialExplanationDigest: sha256(
              value.denialExplanationDigest,
              "Denial explanation digest"
            ),
            appealAvailable: value.appealAvailable,
            appealDueAt,
            appealBasisDigest
          };
        }
      ));
    },
    close(input) {
      return repository.close(command(
        input, ["closureEvidenceDigest", "closureReasonCode"], "close", at(),
        (value) => {
          invariant(CLOSURE_REASONS.has(value.closureReasonCode), "SUPPORT_CASE_INVALID",
            "Closure reason is invalid.", { status: 400 });
          return {
            closureReasonCode: value.closureReasonCode,
            closureEvidenceDigest: sha256(
              value.closureEvidenceDigest,
              "Closure evidence digest"
            )
          };
        }
      ));
    },
    addEvidence(input) {
      return repository.addEvidence(command(
        input, ["evidenceDigest", "evidenceKind"], "evidence add", at(),
        (value) => {
          invariant(EVIDENCE_KINDS.has(value.evidenceKind), "SUPPORT_CASE_INVALID",
            "Evidence kind is invalid.", { status: 400 });
          return {
            evidenceKind: value.evidenceKind,
            evidenceDigest: sha256(value.evidenceDigest, "Case evidence digest")
          };
        }
      ));
    },
    async reserveNotification(input) {
      const base = command(
        input,
        [
          "contentDigest", "customerUserId", "expiresAt", "mailCommandId",
          "notificationKind", "projectId", "recipientDigest", "subjectReferenceDigest",
          "templateVersion"
        ],
        "notification reserve",
        at(),
        (value) => {
          invariant(NOTIFICATION_KINDS.has(value.notificationKind),
            "SUPPORT_CASE_INVALID", "Notification kind is invalid.", { status: 400 });
          return {
            notificationKind: value.notificationKind,
            mailCommandId: commandId(value.mailCommandId),
            customerUserId: uuid(value.customerUserId, "Notification customer user ID"),
            recipientDigest: sha256(value.recipientDigest, "Recipient digest"),
            subjectReferenceDigest: sha256(
              value.subjectReferenceDigest,
              "Subject reference digest"
            ),
            contentDigest: sha256(value.contentDigest, "Content digest"),
            templateVersion: value.templateVersion,
            expiresAt: instant(value.expiresAt, "Notification expiry")
          };
        }
      );
      const mail = await mailLifecycle.reserve({
        commandId: base.mailCommandId,
        messageType: "support_notification",
        organizationId: base.operatorOrganizationId,
        projectId: input.projectId,
        customerUserId: base.customerUserId,
        recipientDigest: base.recipientDigest,
        subjectReferenceDigest: base.subjectReferenceDigest,
        contentDigest: base.contentDigest,
        templateVersion: base.templateVersion,
        expiresAt: base.expiresAt
      });
      invariant(
        mail?.state === "pending",
        "SUPPORT_NOTIFICATION_NOT_PENDING",
        "The MAIL-01 notification is not a pending reservation.",
        { status: 409 }
      );
      return repository.linkMailReservation({
        ...base,
        projectId: uuid(input.projectId, "Notification project ID"),
        mailMessageId: uuid(mail.messageId, "MAIL-01 message ID")
      });
    },
    readCustomerCase(input) {
      exactObject(input, ["actorId", "caseId", "organizationId"], "Customer case read");
      return repository.readCustomerCase({
        actorId: uuid(input.actorId, "Customer actor ID"),
        organizationId: uuid(input.organizationId, "Organization ID"),
        caseId: uuid(input.caseId, "Case ID")
      });
    },
    listCustomerCases(input) {
      exactObject(input, ["actorId", "organizationId"], "Customer case list");
      return repository.listCustomerCases({
        actorId: uuid(input.actorId, "Customer actor ID"),
        organizationId: uuid(input.organizationId, "Organization ID")
      });
    },
    readOperatorCase(input) {
      exactObject(input, ["actorId", "caseId", "operatorOrganizationId"], "Operator case read");
      return repository.readOperatorCase({
        actorId: uuid(input.actorId, "Operator actor ID"),
        operatorOrganizationId: uuid(input.operatorOrganizationId, "Operator organization ID"),
        caseId: uuid(input.caseId, "Case ID")
      });
    },
    listOperatorCases(input) {
      exactObject(input, ["actorId", "operatorOrganizationId"], "Operator case list");
      return repository.listOperatorCases({
        actorId: uuid(input.actorId, "Operator actor ID"),
        operatorOrganizationId: uuid(input.operatorOrganizationId, "Operator organization ID")
      });
    }
  });
}
