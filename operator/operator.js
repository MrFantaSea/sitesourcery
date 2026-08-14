(function (root, factory) {
  "use strict";

  var desk = factory();
  if (typeof module === "object" && module && module.exports) {
    module.exports = desk;
  } else {
    root.SiteSourceryOperatorDesk = desk;
    if (root.document) {
      desk.mount(
        root.document,
        root.SiteSourceryAbracadabraAPI,
        root.SiteSourceryCareSurfaces,
        root.SiteSourceryResponderSurfaces,
        root.crypto
      );
    }
  }
}(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  var UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
  var SHA256 = /^[a-f0-9]{64}$/u;
  var SAFE_SOURCE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
  var QUEUE_KINDS = new Set([
    "payment_reconciliation", "reversal_reconciliation", "assessment_job",
    "custom_job", "support_case", "privacy_case", "publication_hold",
    "domain_failure", "care_hold", "mail_exception",
    "invoice_finalization_failure", "provider_reconciliation_case",
    "responder_delivery_manual_review", "responder_followup_manual_review",
    "responder_cleanup_manual_review", "project_lifecycle_manual_review",
    "domain_lifecycle_manual_review", "care_lifecycle_manual_review",
    "adjacent_identity_review"
  ]);
  var MANUAL_REVIEW_KINDS = new Set([
    "responder_delivery_manual_review", "responder_followup_manual_review",
    "responder_cleanup_manual_review", "project_lifecycle_manual_review",
    "domain_lifecycle_manual_review", "care_lifecycle_manual_review",
    "adjacent_identity_review"
  ]);
  var ADJACENT_SYSTEM_KEYS = new Set([
    "private_messenger", "command_deck", "phone_bridge",
    "client_profile_hub", "marketing_desk", "dell_commercial_engine"
  ]);
  var ADJACENT_CROSSWALK_STATES = new Set([
    "manual_review", "conflict", "linked", "superseded"
  ]);
  var ADJACENT_RESOLUTIONS = Object.freeze({
    manual_review: Object.freeze([
      Object.freeze(["operator_confirm_link", "linked"]),
      Object.freeze(["operator_reject_link", "superseded"])
    ]),
    conflict: Object.freeze([
      Object.freeze(["operator_confirm_link", "linked"]),
      Object.freeze(["operator_reject_link", "superseded"]),
      Object.freeze(["operator_supersede_link", "superseded"])
    ])
  });
  var ADJACENT_IDENTITY_PAIRS = Object.freeze({
    "private_messenger|organization|encrypted_session_digest|digest_only":
      Object.freeze({
        systemKey: "private_messenger", localEntityKind: "organization",
        remoteEntityKind: "encrypted_session_digest",
        referencePolicy: "digest_only"
      }),
    "client_profile_hub|organization|client|hub_client_id": Object.freeze({
      systemKey: "client_profile_hub", localEntityKind: "organization",
      remoteEntityKind: "client", referencePolicy: "hub_client_id"
    }),
    "client_profile_hub|project|project|hub_project_id": Object.freeze({
      systemKey: "client_profile_hub", localEntityKind: "project",
      remoteEntityKind: "project", referencePolicy: "hub_project_id"
    }),
    "marketing_desk|engagement|qualified_promotion|digest_only":
      Object.freeze({
        systemKey: "marketing_desk", localEntityKind: "engagement",
        remoteEntityKind: "qualified_promotion", referencePolicy: "digest_only"
      }),
    "marketing_desk|direct_opportunity|qualified_promotion|digest_only":
      Object.freeze({
        systemKey: "marketing_desk", localEntityKind: "direct_opportunity",
        remoteEntityKind: "qualified_promotion", referencePolicy: "digest_only"
      }),
    "dell_commercial_engine|project|scope|digest_only": Object.freeze({
      systemKey: "dell_commercial_engine", localEntityKind: "project",
      remoteEntityKind: "scope", referencePolicy: "digest_only"
    }),
    "dell_commercial_engine|project|quote|digest_only": Object.freeze({
      systemKey: "dell_commercial_engine", localEntityKind: "project",
      remoteEntityKind: "quote", referencePolicy: "digest_only"
    }),
    "dell_commercial_engine|project|work_receipt|digest_only": Object.freeze({
      systemKey: "dell_commercial_engine", localEntityKind: "project",
      remoteEntityKind: "work_receipt", referencePolicy: "digest_only"
    })
  });
  var RECONCILIATION_CASE_KINDS = new Set([
    "abandoned_claim", "stale_delivery_status", "unmatched_provider_event",
    "suppression_conflict", "unbound_inbound_event",
    "ambiguous_number_binding", "ambiguous_message_create"
  ]);
  var RECONCILIATION_READBACK_STATES = new Set([
    "none", "matched", "single_candidate", "not_found", "multiple_matches"
  ]);
  var RECONCILIATION_RESOLUTIONS = new Set([
    "operator_confirmed_effect", "operator_confirmed_no_effect",
    "operator_late_binding_applied", "operator_binding_retired",
    "operator_closed"
  ]);
  var RECORDED_RECONCILIATION_RESOLUTIONS = new Set([
    "self_healed"
  ].concat(Array.from(RECONCILIATION_RESOLUTIONS)));
  var QUEUE_SEVERITIES = new Set(["low", "normal", "high", "critical"]);
  var QUEUE_STATES = new Set(["open", "in_progress", "blocked"]);
  var CASE_KINDS = new Set([
    "support", "access", "correction", "export", "deletion", "appeal"
  ]);
  var CASE_STATES = new Set([
    "open", "assigned", "in_review", "responded", "denied",
    "appeal_pending", "closed"
  ]);
  var NUMBER_BINDING_STATES = new Set(["active", "retired"]);
  var NUMBER_BINDING_RETIRE_REASONS = new Set([
    "reprovisioned", "customer_cancelled", "number_released",
    "operator_correction"
  ]);

  function responseError() {
    var error = new Error("The operations service returned an invalid response.");
    error.code = "OPERATOR_RESPONSE_INVALID";
    return error;
  }

  function check(condition) {
    if (!condition) throw responseError();
  }

  function isObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function exact(value, keys) {
    check(
      isObject(value) &&
      JSON.stringify(Object.keys(value).sort()) === JSON.stringify(keys.slice().sort())
    );
    return value;
  }

  function text(value, maximum) {
    check(typeof value === "string" && value.length > 0 && value.length <= maximum);
    return value;
  }

  function uuid(value, nullable) {
    if (nullable && value === null) return null;
    check(typeof value === "string" && UUID.test(value));
    return value;
  }

  function digest(value, nullable) {
    if (nullable && value === null) return null;
    check(typeof value === "string" && SHA256.test(value));
    return value;
  }

  function instant(value, nullable) {
    if (nullable && value === null) return null;
    check(
      typeof value === "string" &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value
    );
    return value;
  }

  function integer(value, minimum) {
    check(Number.isSafeInteger(value) && value >= minimum);
    return value;
  }

  function nullableInteger(value, minimum) {
    return value === null ? null : integer(value, minimum);
  }

  function optionalText(value, maximum) {
    return value === null ? null : text(value, maximum);
  }

  function validateOrganizationPayload(value) {
    exact(value, ["organizations"]);
    check(Array.isArray(value.organizations) && value.organizations.length <= 100);
    return Object.freeze(value.organizations.map(function (entry) {
      exact(entry, ["createdAt", "id", "name", "role", "state"]);
      return Object.freeze({
        id: uuid(entry.id),
        name: text(entry.name, 120),
        role: text(entry.role, 64),
        state: text(entry.state, 64),
        createdAt: instant(entry.createdAt)
      });
    }));
  }

  function validateQueueSource(value) {
    exact(value, ["digest", "id", "revision", "state", "table"]);
    return Object.freeze({
      table: text(value.table, 100),
      id: (check(SAFE_SOURCE.test(value.id)), value.id),
      revision: integer(value.revision, 0),
      digest: digest(value.digest),
      state: text(value.state, 64)
    });
  }

  function validateQueueItem(value) {
    exact(value, [
      "deadlineAt", "digest", "id", "kind", "openedAt", "organizationId",
      "projectId", "repair", "revision", "schema", "severity", "source",
      "status", "updatedAt"
    ]);
    check(
      value.schema === "sitesourcery.operator-work-queue-item/v1" &&
      QUEUE_KINDS.has(value.kind) &&
      QUEUE_SEVERITIES.has(value.severity) &&
      QUEUE_STATES.has(value.status)
    );
    var repair = null;
    if (value.repair !== null) {
      exact(value.repair, ["kind"]);
      check([
        "professional_reversal_reconcile",
        "adjacent_crosswalk_resolution"
      ].includes(value.repair.kind));
      check(
        (value.repair.kind === "professional_reversal_reconcile" &&
          value.kind === "reversal_reconciliation") ||
        (value.repair.kind === "adjacent_crosswalk_resolution" &&
          value.kind === "adjacent_identity_review")
      );
      repair = Object.freeze({ kind: value.repair.kind });
    }
    check(
      value.kind !== "adjacent_identity_review" ||
      (repair && repair.kind === "adjacent_crosswalk_resolution")
    );
    return Object.freeze({
      schema: value.schema,
      id: uuid(value.id),
      source: validateQueueSource(value.source),
      organizationId: uuid(value.organizationId, true),
      projectId: uuid(value.projectId, true),
      kind: value.kind,
      severity: value.severity,
      status: value.status,
      deadlineAt: instant(value.deadlineAt, true),
      repair: repair,
      openedAt: instant(value.openedAt),
      revision: integer(value.revision, 1),
      digest: digest(value.digest),
      updatedAt: instant(value.updatedAt)
    });
  }

  function validateQueue(value) {
    exact(value, ["genericRepair", "items", "schema", "sourceAuthoritative"]);
    check(
      value.schema === "sitesourcery.operator-work-queue/v1" &&
      value.sourceAuthoritative === true &&
      value.genericRepair === false &&
      Array.isArray(value.items) && value.items.length <= 200
    );
    var items = value.items.map(validateQueueItem);
    check(new Set(items.map(function (item) { return item.id; })).size === items.length);
    return Object.freeze({
      schema: value.schema,
      sourceAuthoritative: true,
      genericRepair: false,
      items: Object.freeze(items)
    });
  }

  function validateScope(value) {
    exact(value, ["kind", "organizationId", "projectId"]);
    check(["general", "account", "project"].includes(value.kind));
    return Object.freeze({
      kind: value.kind,
      organizationId: uuid(value.organizationId, true),
      projectId: uuid(value.projectId, true)
    });
  }

  function validateDeadline(value) {
    exact(value, ["dueAt", "status"]);
    check(["unassigned", "active", "met", "overdue"].includes(value.status));
    return Object.freeze({ dueAt: instant(value.dueAt, true), status: value.status });
  }

  function validateDecision(value) {
    if (value === null) return null;
    check(isObject(value) && ["response", "denial"].includes(value.kind));
    if (value.kind === "response") {
      exact(value, ["digest", "kind", "recordedAt"]);
      return Object.freeze({
        kind: value.kind,
        digest: digest(value.digest),
        recordedAt: instant(value.recordedAt)
      });
    }
    exact(value, ["explanationDigest", "kind", "reasonCode", "recordedAt"]);
    return Object.freeze({
      kind: value.kind,
      reasonCode: text(value.reasonCode, 64),
      explanationDigest: digest(value.explanationDigest),
      recordedAt: instant(value.recordedAt)
    });
  }

  function validateAppeal(value) {
    exact(value, ["available", "caseId", "dueAt", "state"]);
    check(typeof value.available === "boolean");
    return Object.freeze({
      available: value.available,
      dueAt: instant(value.dueAt, true),
      caseId: uuid(value.caseId, true),
      state: optionalText(value.state, 64)
    });
  }

  function validateNotification(value) {
    exact(value, ["kind", "reservedAt", "state"]);
    check(value.state === "reserved");
    return Object.freeze({
      kind: text(value.kind, 64),
      state: value.state,
      reservedAt: instant(value.reservedAt)
    });
  }

  function validateAudit(value) {
    exact(value, [
      "actorKind", "eventDigest", "evidenceDigest", "kind", "occurredAt",
      "sequence"
    ]);
    check(["customer", "operator", "system"].includes(value.actorKind));
    return Object.freeze({
      sequence: integer(value.sequence, 1),
      kind: text(value.kind, 64),
      actorKind: value.actorKind,
      evidenceDigest: digest(value.evidenceDigest),
      occurredAt: instant(value.occurredAt),
      eventDigest: digest(value.eventDigest)
    });
  }

  function validateEvidence(value) {
    exact(value, ["digest", "kind", "recordedAt", "sourceKind"]);
    return Object.freeze({
      kind: text(value.kind, 64),
      sourceKind: text(value.sourceKind, 64),
      digest: digest(value.digest),
      recordedAt: instant(value.recordedAt)
    });
  }

  function validateOperatorCase(value) {
    exact(value, [
      "appeal", "appealBasisDigest", "assigned", "assignedOperatorId", "audit",
      "closedAt", "closureReasonCode", "deadline", "deadlineBasisDigest",
      "decision", "evidence", "id", "identityEvidenceDigest", "identityState",
      "intakeChannel", "openedAt", "parentCaseId", "requestKind",
      "requesterReferenceDigest", "requesterUserId", "revision", "schema", "scope",
      "state", "notifications"
    ]);
    check(
      value.schema === "sitesourcery.support-case-operator-read/v1" &&
      CASE_KINDS.has(value.requestKind) &&
      CASE_STATES.has(value.state) &&
      typeof value.assigned === "boolean" &&
      Array.isArray(value.notifications) && value.notifications.length <= 200 &&
      Array.isArray(value.audit) && value.audit.length <= 1000 &&
      Array.isArray(value.evidence) && value.evidence.length <= 1000
    );
    var audit = value.audit.map(validateAudit);
    check(audit.every(function (event, index) { return event.sequence === index + 1; }));
    return Object.freeze({
      schema: value.schema,
      id: uuid(value.id),
      requestKind: value.requestKind,
      scope: validateScope(value.scope),
      state: value.state,
      identityState: text(value.identityState, 64),
      assigned: value.assigned,
      deadline: validateDeadline(value.deadline),
      decision: validateDecision(value.decision),
      appeal: validateAppeal(value.appeal),
      notifications: Object.freeze(value.notifications.map(validateNotification)),
      audit: Object.freeze(audit),
      openedAt: instant(value.openedAt),
      closedAt: instant(value.closedAt, true),
      revision: integer(value.revision, 1),
      intakeChannel: text(value.intakeChannel, 64),
      requesterUserId: uuid(value.requesterUserId, true),
      requesterReferenceDigest: digest(value.requesterReferenceDigest),
      parentCaseId: uuid(value.parentCaseId, true),
      assignedOperatorId: uuid(value.assignedOperatorId, true),
      identityEvidenceDigest: digest(value.identityEvidenceDigest, true),
      deadlineBasisDigest: digest(value.deadlineBasisDigest, true),
      appealBasisDigest: digest(value.appealBasisDigest, true),
      closureReasonCode: optionalText(value.closureReasonCode, 64),
      evidence: Object.freeze(value.evidence.map(validateEvidence))
    });
  }

  function validateCaseList(value) {
    exact(value, ["cases", "schema"]);
    check(
      value.schema === "sitesourcery.support-case-operator-list/v1" &&
      Array.isArray(value.cases) && value.cases.length <= 200
    );
    var cases = value.cases.map(validateOperatorCase);
    check(new Set(cases.map(function (entry) { return entry.id; })).size === cases.length);
    return Object.freeze({ schema: value.schema, cases: Object.freeze(cases) });
  }

  function validateReconciliationCase(value) {
    exact(value, [
      "allowedResolutions", "caseDigest", "caseKind", "evidenceDigest",
      "genericRepair", "id", "matchedProviderMessageIdDigest",
      "openedAt", "organizationId", "projectId", "provider",
      "providerEffects", "readbackAt", "readbackEvidenceDigest",
      "readbackMatchCount", "readbackState", "resolutionEvidenceDigest",
      "resolutionKind", "resolvedAt", "revision", "schema", "state"
    ]);
    check(
      value.schema ===
        "sitesourcery.operator-provider-reconciliation-case/v1" &&
      RECONCILIATION_CASE_KINDS.has(value.caseKind) &&
      RECONCILIATION_READBACK_STATES.has(value.readbackState) &&
      ["open", "resolved"].includes(value.state) &&
      value.providerEffects === false && value.genericRepair === false &&
      Array.isArray(value.allowedResolutions) &&
      value.allowedResolutions.length <= RECONCILIATION_RESOLUTIONS.size &&
      value.allowedResolutions.every(function (kind) {
        return RECONCILIATION_RESOLUTIONS.has(kind);
      }) &&
      new Set(value.allowedResolutions).size === value.allowedResolutions.length
    );
    return Object.freeze({
      schema: value.schema,
      id: uuid(value.id),
      provider: text(value.provider, 64),
      caseKind: value.caseKind,
      caseDigest: digest(value.caseDigest),
      state: value.state,
      organizationId: uuid(value.organizationId, true),
      projectId: uuid(value.projectId, true),
      evidenceDigest: digest(value.evidenceDigest),
      readbackState: value.readbackState,
      readbackEvidenceDigest: digest(value.readbackEvidenceDigest, true),
      matchedProviderMessageIdDigest:
        digest(value.matchedProviderMessageIdDigest, true),
      readbackMatchCount: nullableInteger(value.readbackMatchCount, 0),
      readbackAt: instant(value.readbackAt, true),
      resolutionKind: value.resolutionKind === null
        ? null
        : (check(RECORDED_RECONCILIATION_RESOLUTIONS.has(
          value.resolutionKind
        )),
          value.resolutionKind),
      resolutionEvidenceDigest: digest(value.resolutionEvidenceDigest, true),
      resolvedAt: instant(value.resolvedAt, true),
      openedAt: instant(value.openedAt),
      revision: integer(value.revision, 1),
      allowedResolutions: Object.freeze(value.allowedResolutions.slice()),
      providerEffects: false,
      genericRepair: false
    });
  }

  function validateResolutionReceipt(value) {
    exact(value, [
      "case", "commandId", "genericRepair", "providerEffects",
      "replayed", "requestDigest", "schema"
    ]);
    exact(value.case, [
      "caseDigest", "caseKind", "id", "resolutionEvidenceDigest",
      "resolutionKind", "resolvedAt", "revision", "state"
    ]);
    check(
      value.schema ===
        "sitesourcery.operator-provider-reconciliation-resolution/v1" &&
      value.providerEffects === false && value.genericRepair === false &&
      typeof value.replayed === "boolean" && value.case.state === "resolved" &&
      RECONCILIATION_CASE_KINDS.has(value.case.caseKind) &&
      RECONCILIATION_RESOLUTIONS.has(value.case.resolutionKind)
    );
    return Object.freeze({
      schema: value.schema,
      commandId: text(value.commandId, 200),
      requestDigest: digest(value.requestDigest),
      case: Object.freeze({
        id: uuid(value.case.id),
        caseKind: value.case.caseKind,
        caseDigest: digest(value.case.caseDigest),
        state: value.case.state,
        revision: integer(value.case.revision, 1),
        resolutionKind: value.case.resolutionKind,
        resolutionEvidenceDigest: digest(value.case.resolutionEvidenceDigest),
        resolvedAt: instant(value.case.resolvedAt)
      }),
      replayed: value.replayed,
      providerEffects: false,
      genericRepair: false
    });
  }

  function validateNumberBinding(value) {
    exact(value, [
      "accountSidDigest", "id", "lookupKeyVersion",
      "messagingServiceSidDigest", "numberLookupDigest", "organizationId",
      "phoneNumberSidDigest", "projectId", "provider",
      "providerEffects", "providerReadbackDigest", "provisionedAt",
      "replayed", "retiredAt", "retiredReason", "revision", "schema",
      "state"
    ]);
    check(
      value.schema === "sitesourcery.responder-number-binding-receipt/v1" &&
      value.provider === "twilio" && value.providerEffects === false &&
      typeof value.replayed === "boolean" &&
      NUMBER_BINDING_STATES.has(value.state) &&
      ((value.state === "active" && value.retiredAt === null &&
        value.retiredReason === null) ||
       (value.state === "retired" && value.retiredAt !== null &&
        NUMBER_BINDING_RETIRE_REASONS.has(value.retiredReason)))
    );
    return Object.freeze({
      schema: value.schema,
      id: uuid(value.id),
      organizationId: uuid(value.organizationId),
      projectId: uuid(value.projectId),
      provider: value.provider,
      numberLookupDigest: digest(value.numberLookupDigest),
      lookupKeyVersion: text(value.lookupKeyVersion, 40),
      phoneNumberSidDigest: digest(value.phoneNumberSidDigest),
      providerReadbackDigest: digest(value.providerReadbackDigest),
      accountSidDigest: digest(value.accountSidDigest),
      messagingServiceSidDigest: digest(value.messagingServiceSidDigest, true),
      state: value.state,
      provisionedAt: instant(value.provisionedAt),
      retiredAt: instant(value.retiredAt, true),
      retiredReason: value.retiredReason,
      revision: integer(value.revision, 1),
      replayed: value.replayed,
      providerEffects: false
    });
  }

  function validateNumberBindingList(value) {
    exact(value, ["bindings", "organizationId", "providerEffects", "schema"]);
    check(
      value.schema === "sitesourcery.responder-number-binding-list/v1" &&
      value.providerEffects === false && Array.isArray(value.bindings) &&
      value.bindings.length <= 200
    );
    var organizationId = uuid(value.organizationId);
    var bindings = value.bindings.map(validateNumberBinding);
    check(
      bindings.every(function (binding) {
        return binding.organizationId === organizationId;
      }) &&
      new Set(bindings.map(function (binding) { return binding.id; })).size ===
        bindings.length
    );
    return Object.freeze({
      schema: value.schema,
      organizationId: organizationId,
      providerEffects: false,
      bindings: Object.freeze(bindings)
    });
  }

  function validateAdjacentContract(value) {
    exact(value, [
      "adapterMode", "auditPolicy", "authenticationBoundary",
      "authorityOwner", "automaticCommands", "conflictOwner",
      "contractRevision", "failureBehavior", "heldBehavior",
      "identityScopePolicy", "providerEffects", "readEventDirection",
      "reconciliationPolicy", "remoteWrites", "retryPolicy",
      "semanticIdempotencyPolicy", "systemKey", "writeEffectDirection"
    ]);
    check(
      ADJACENT_SYSTEM_KEYS.has(value.systemKey) &&
      value.adapterMode === "manual_read_only" &&
      value.writeEffectDirection === "none_held" &&
      value.automaticCommands === false && value.remoteWrites === false &&
      value.providerEffects === false
    );
    return Object.freeze({
      systemKey: value.systemKey,
      authorityOwner: text(value.authorityOwner, 1000),
      readEventDirection: text(value.readEventDirection, 200),
      writeEffectDirection: value.writeEffectDirection,
      authenticationBoundary: text(value.authenticationBoundary, 1000),
      identityScopePolicy: text(value.identityScopePolicy, 200),
      semanticIdempotencyPolicy: text(value.semanticIdempotencyPolicy, 300),
      conflictOwner: text(value.conflictOwner, 200),
      retryPolicy: text(value.retryPolicy, 200),
      reconciliationPolicy: text(value.reconciliationPolicy, 300),
      auditPolicy: text(value.auditPolicy, 300),
      failureBehavior: text(value.failureBehavior, 200),
      heldBehavior: text(value.heldBehavior, 300),
      adapterMode: value.adapterMode,
      automaticCommands: false,
      remoteWrites: false,
      providerEffects: false,
      contractRevision: integer(value.contractRevision, 1)
    });
  }

  function validateAdjacentContracts(value) {
    exact(value, [
      "automaticCommands", "mode", "providerEffects", "remoteWrites",
      "schema", "systems"
    ]);
    check(
      value.schema === "sitesourcery.adjacent-contracts/v1" &&
      value.mode === "manual-read-only" &&
      value.automaticCommands === false && value.remoteWrites === false &&
      value.providerEffects === false && Array.isArray(value.systems) &&
      value.systems.length === ADJACENT_SYSTEM_KEYS.size
    );
    var systems = value.systems.map(validateAdjacentContract);
    check(
      new Set(systems.map(function (system) { return system.systemKey; })).size ===
        ADJACENT_SYSTEM_KEYS.size &&
      systems.every(function (system) {
        return ADJACENT_SYSTEM_KEYS.has(system.systemKey);
      })
    );
    return Object.freeze({
      schema: value.schema,
      systems: Object.freeze(systems),
      mode: value.mode,
      remoteWrites: false,
      providerEffects: false,
      automaticCommands: false
    });
  }

  function validateAdjacentCrosswalk(value) {
    exact(value, [
      "id", "localEntityId", "localEntityKind", "organizationId",
      "projectId", "provenanceDigest", "recordedAt",
      "remoteEntityKind", "remoteReferenceDigest", "requestDigest",
      "revision", "safeRemoteReference", "sourceRevisionDigest",
      "sourceSnapshotId", "state", "supersedesCrosswalkId", "systemKey",
      "updatedAt"
    ]);
    check(
      ADJACENT_SYSTEM_KEYS.has(value.systemKey) &&
      ADJACENT_CROSSWALK_STATES.has(value.state) &&
      (value.safeRemoteReference === null || (
        value.systemKey === "client_profile_hub" &&
        (/^SSC-[0-9]{4}-[0-9]{3,}$/u.test(value.safeRemoteReference) ||
          /^SS-[0-9]{4}-[0-9]{3,}$/u.test(value.safeRemoteReference))
      ))
    );
    return Object.freeze({
      id: uuid(value.id),
      organizationId: uuid(value.organizationId),
      projectId: uuid(value.projectId, true),
      systemKey: value.systemKey,
      sourceSnapshotId: uuid(value.sourceSnapshotId),
      localEntityKind: text(value.localEntityKind, 100),
      localEntityId: uuid(value.localEntityId),
      remoteEntityKind: text(value.remoteEntityKind, 100),
      safeRemoteReference: optionalText(value.safeRemoteReference, 100),
      remoteReferenceDigest: digest(value.remoteReferenceDigest),
      sourceRevisionDigest: digest(value.sourceRevisionDigest),
      provenanceDigest: digest(value.provenanceDigest),
      state: value.state,
      supersedesCrosswalkId: uuid(value.supersedesCrosswalkId, true),
      revision: integer(value.revision, 1),
      requestDigest: digest(value.requestDigest),
      recordedAt: instant(value.recordedAt),
      updatedAt: instant(value.updatedAt)
    });
  }

  function validateAdjacentObservation(value) {
    exact(value, [
      "crosswalkId", "id", "observationKind", "observationState",
      "organizationId", "payloadDigest", "projectId", "provenanceDigest",
      "recordedAt", "sourceObservedAt", "sourceSnapshotId", "systemKey"
    ]);
    check(ADJACENT_SYSTEM_KEYS.has(value.systemKey));
    return Object.freeze({
      id: uuid(value.id),
      crosswalkId: uuid(value.crosswalkId),
      sourceSnapshotId: uuid(value.sourceSnapshotId),
      organizationId: uuid(value.organizationId),
      projectId: uuid(value.projectId, true),
      systemKey: value.systemKey,
      observationKind: text(value.observationKind, 100),
      observationState: text(value.observationState, 100),
      payloadDigest: digest(value.payloadDigest),
      provenanceDigest: digest(value.provenanceDigest),
      sourceObservedAt: instant(value.sourceObservedAt),
      recordedAt: instant(value.recordedAt)
    });
  }

  function validateAdjacentSnapshot(value) {
    exact(value, [
      "id", "observationKind", "observationState", "payloadDigest",
      "provenanceDigest", "recordedAt", "remoteEntityKind",
      "remoteReferenceDigest", "sourceObservedAt", "systemKey"
    ]);
    check(ADJACENT_SYSTEM_KEYS.has(value.systemKey));
    return Object.freeze({
      id: uuid(value.id),
      systemKey: value.systemKey,
      remoteEntityKind: text(value.remoteEntityKind, 100),
      remoteReferenceDigest: digest(value.remoteReferenceDigest),
      observationKind: text(value.observationKind, 100),
      observationState: text(value.observationState, 100),
      payloadDigest: digest(value.payloadDigest),
      provenanceDigest: digest(value.provenanceDigest),
      sourceObservedAt: instant(value.sourceObservedAt),
      recordedAt: instant(value.recordedAt)
    });
  }

  function validateAdjacentTrace(value) {
    exact(value, [
      "automaticCommands", "crosswalks", "observations", "organizationId",
      "projectId", "providerEffects", "remoteWrites", "schema",
      "sourceSnapshots", "systemKey"
    ]);
    check(
      value.schema === "sitesourcery.adjacent-trace/v1" &&
      value.automaticCommands === false && value.remoteWrites === false &&
      value.providerEffects === false && Array.isArray(value.crosswalks) &&
      value.crosswalks.length <= 200 && Array.isArray(value.observations) &&
      value.observations.length <= 500 && Array.isArray(value.sourceSnapshots) &&
      value.sourceSnapshots.length <= 100 &&
      (value.systemKey === null || ADJACENT_SYSTEM_KEYS.has(value.systemKey))
    );
    var organizationId = uuid(value.organizationId);
    var projectId = uuid(value.projectId, true);
    var crosswalks = value.crosswalks.map(validateAdjacentCrosswalk);
    var observations = value.observations.map(validateAdjacentObservation);
    var snapshots = value.sourceSnapshots.map(validateAdjacentSnapshot);
    check(
      crosswalks.every(function (entry) {
        return entry.organizationId === organizationId &&
          (projectId === null || entry.projectId === null ||
            entry.projectId === projectId);
      }) && observations.every(function (entry) {
        return entry.organizationId === organizationId &&
          (projectId === null || entry.projectId === null ||
            entry.projectId === projectId);
      })
    );
    return Object.freeze({
      schema: value.schema,
      organizationId: organizationId,
      projectId: projectId,
      systemKey: value.systemKey,
      crosswalks: Object.freeze(crosswalks),
      observations: Object.freeze(observations),
      sourceSnapshots: Object.freeze(snapshots),
      remoteWrites: false,
      providerEffects: false,
      automaticCommands: false
    });
  }

  function validateAdjacentResolutionReceipt(value) {
    exact(value, [
      "automaticCommands", "commandId", "crosswalkRevision",
      "crosswalkState", "crosswalkUpdatedAt", "id", "organizationId",
      "projectId", "providerEffects", "recordedAt", "remoteWrites",
      "replay", "requestDigest", "revision", "schema",
      "semanticEvidenceDigest", "state", "systemKey"
    ]);
    check(
      value.schema === "sitesourcery.adjacent-resolution-receipt/v1" &&
      ADJACENT_SYSTEM_KEYS.has(value.systemKey) &&
      ADJACENT_CROSSWALK_STATES.has(value.crosswalkState) &&
      typeof value.replay === "boolean" && value.automaticCommands === false &&
      value.remoteWrites === false && value.providerEffects === false
    );
    return Object.freeze({
      schema: value.schema,
      id: uuid(value.id),
      commandId: text(value.commandId, 200),
      requestDigest: digest(value.requestDigest),
      semanticEvidenceDigest: digest(value.semanticEvidenceDigest),
      systemKey: value.systemKey,
      organizationId: uuid(value.organizationId),
      projectId: uuid(value.projectId, true),
      state: text(value.state, 64),
      revision: nullableInteger(value.revision, 1),
      recordedAt: instant(value.recordedAt),
      replay: value.replay,
      remoteWrites: false,
      providerEffects: false,
      automaticCommands: false,
      crosswalkState: value.crosswalkState,
      crosswalkRevision: integer(value.crosswalkRevision, 1),
      crosswalkUpdatedAt: instant(value.crosswalkUpdatedAt)
    });
  }

  function validateAdjacentCrosswalkReceipt(value) {
    exact(value, [
      "automaticCommands", "commandId", "id", "organizationId",
      "projectId", "providerEffects", "recordedAt", "remoteWrites",
      "replay", "requestDigest", "revision", "schema",
      "semanticEvidenceDigest", "state", "systemKey"
    ]);
    check(
      value.schema === "sitesourcery.adjacent-crosswalk-receipt/v1" &&
      ADJACENT_SYSTEM_KEYS.has(value.systemKey) &&
      ["manual_review", "conflict"].includes(value.state) &&
      typeof value.replay === "boolean" && value.automaticCommands === false &&
      value.remoteWrites === false && value.providerEffects === false
    );
    return Object.freeze({
      schema: value.schema,
      id: uuid(value.id),
      commandId: text(value.commandId, 200),
      requestDigest: digest(value.requestDigest),
      semanticEvidenceDigest: digest(value.semanticEvidenceDigest),
      systemKey: value.systemKey,
      organizationId: uuid(value.organizationId),
      projectId: uuid(value.projectId, true),
      state: value.state,
      revision: integer(value.revision, 1),
      recordedAt: instant(value.recordedAt),
      replay: value.replay,
      remoteWrites: false,
      providerEffects: false,
      automaticCommands: false
    });
  }

  function human(value) {
    var words = String(value == null ? "" : value).replaceAll("_", " ");
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Not recorded";
  }

  function formatDate(value) {
    if (!value) return "Not assigned";
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(value));
  }

  function shortDigest(value) {
    return value ? value.slice(0, 12) + "…" : "Not recorded";
  }

  function localInstant(value) {
    check(typeof value === "string" && value.length > 0);
    var parsed = new Date(value);
    check(Number.isFinite(parsed.getTime()));
    return parsed.toISOString();
  }

  function formValue(form, name) {
    var control = form.elements.namedItem(name);
    return String(control && control.value || "").trim();
  }

  function createElement(documentRef, name, className, copy) {
    var element = documentRef.createElement(name);
    if (className) element.className = className;
    if (copy !== undefined) element.textContent = copy;
    return element;
  }

  function mount(
    documentRef,
    publicApi,
    careModule,
    responderModule,
    cryptoRef
  ) {
    var board = documentRef.getElementById("operator-board");
    if (!board) return null;
    var sessionStatus = documentRef.getElementById("operator-session-status");
    var organizationSelect = documentRef.getElementById("operator-organization");
    var refreshButton = documentRef.getElementById("operator-refresh");
    var queueRoot = documentRef.getElementById("operator-queue");
    var casesRoot = documentRef.getElementById("operator-cases");
    var queueCount = documentRef.getElementById("queue-count");
    var caseCount = documentRef.getElementById("case-count");
    var errorRoot = documentRef.getElementById("operator-error");
    var noticeRoot = documentRef.getElementById("operator-notice");
    var detailRoot = documentRef.getElementById("operator-case-detail");
    var detailTitle = documentRef.getElementById("case-detail-title");
    var factsRoot = documentRef.getElementById("case-facts");
    var auditRoot = documentRef.getElementById("case-audit");
    var actionsRoot = documentRef.getElementById("case-actions");
    var careRoot = documentRef.getElementById("operator-care-surface");
    var responderRoot = documentRef.getElementById(
      "operator-responder-surface"
    );
    var numberBindingsRoot = documentRef.getElementById(
      "operator-number-bindings"
    );
    var numberBindingCount = documentRef.getElementById(
      "operator-number-binding-count"
    );
    var numberBindingProvision = documentRef.getElementById(
      "operator-number-binding-provision"
    );
    var adjacentContractsRoot = documentRef.getElementById(
      "operator-adjacent-contracts"
    );
    var adjacentContractCount = documentRef.getElementById(
      "operator-adjacent-contract-count"
    );
    var adjacentTraceRoot = documentRef.getElementById(
      "operator-adjacent-trace"
    );
    var adjacentTraceCount = documentRef.getElementById(
      "operator-adjacent-trace-count"
    );
    var adjacentDetailRoot = documentRef.getElementById(
      "operator-adjacent-detail"
    );
    var adjacentDetailTitle = documentRef.getElementById(
      "operator-adjacent-detail-title"
    );
    var adjacentFactsRoot = documentRef.getElementById(
      "operator-adjacent-facts"
    );
    var adjacentResolutionForm = documentRef.getElementById(
      "operator-adjacent-resolution-form"
    );
    var adjacentResolutionKind = documentRef.getElementById(
      "operator-adjacent-resolution-kind"
    );
    var adjacentCrosswalkOpen = documentRef.getElementById(
      "operator-adjacent-crosswalk-open"
    );
    var adjacentCrosswalkEntry = documentRef.getElementById(
      "operator-adjacent-crosswalk-entry"
    );
    var adjacentCrosswalkForm = documentRef.getElementById(
      "operator-adjacent-crosswalk-form"
    );
    var serviceCommandRoot = documentRef.getElementById(
      "operator-service-command"
    );
    var serviceCommandTitle = documentRef.getElementById(
      "operator-service-command-title"
    );
    var serviceCommandFormRoot = documentRef.getElementById(
      "operator-service-command-form"
    );
    var reconciliationDetailRoot = documentRef.getElementById(
      "operator-reconciliation-detail"
    );
    var reconciliationTitle = documentRef.getElementById(
      "reconciliation-detail-title"
    );
    var reconciliationFactsRoot = documentRef.getElementById(
      "reconciliation-facts"
    );
    var reconciliationForm = documentRef.getElementById(
      "reconciliation-resolution-form"
    );
    var reconciliationResolution = documentRef.getElementById(
      "reconciliation-resolution-kind"
    );
    var state = {
      client: null,
      actorId: null,
      organizations: [],
      organizationId: null,
      queue: [],
      cases: [],
      selectedCase: null,
      selectedReconciliation: null,
      careSnapshot: null,
      responderSnapshot: null,
      numberBindings: [],
      adjacentContracts: [],
      adjacentTrace: null,
      selectedAdjacent: null,
      serviceCommand: null,
      busy: false
    };

    function showError(error) {
      var message = error && error.message
        ? error.message
        : "The operations desk could not complete that request.";
      errorRoot.textContent = message;
      errorRoot.hidden = false;
      noticeRoot.hidden = true;
      errorRoot.focus();
    }

    function showNotice(message) {
      noticeRoot.textContent = message;
      noticeRoot.hidden = false;
      errorRoot.hidden = true;
    }

    function clearMessages() {
      errorRoot.hidden = true;
      noticeRoot.hidden = true;
    }

    function setBusy(value) {
      state.busy = value;
      board.setAttribute("aria-busy", value ? "true" : "false");
      refreshButton.disabled = value || !state.organizationId;
      organizationSelect.disabled = value || state.organizations.length === 0;
      numberBindingProvision.disabled = value || !state.organizationId;
      adjacentCrosswalkOpen.disabled = value || !state.organizationId ||
        !state.adjacentTrace || state.adjacentTrace.sourceSnapshots.length === 0;
      Array.from(numberBindingsRoot.querySelectorAll("button")).forEach(
        function (control) { control.disabled = value; }
      );
      Array.from(actionsRoot.querySelectorAll("button, input, select")).forEach(
        function (control) { control.disabled = value; }
      );
      Array.from(
        reconciliationDetailRoot.querySelectorAll("button, input, select")
      ).forEach(function (control) { control.disabled = value; });
      Array.from(
        serviceCommandRoot.querySelectorAll("button, input, select")
      ).forEach(function (control) { control.disabled = value; });
      Array.from(
        adjacentDetailRoot.querySelectorAll("button, input, select")
      ).forEach(function (control) { control.disabled = value; });
      Array.from(
        adjacentCrosswalkEntry.querySelectorAll("button, input, select")
      ).forEach(function (control) { control.disabled = value; });
    }

    function empty(root, message) {
      root.replaceChildren(createElement(documentRef, "p", "operator-empty", message));
    }

    function meta(values) {
      var row = createElement(documentRef, "div", "operator-meta");
      values.forEach(function (value) {
        row.appendChild(createElement(documentRef, "span", "", value));
      });
      return row;
    }

    function renderRepair(item, card) {
      if (!item.repair ||
        item.repair.kind !== "professional_reversal_reconcile") return;
      var template = documentRef.getElementById("operator-repair-template");
      check(template && template.content);
      var details = template.content.firstElementChild.cloneNode(true);
      var form = details.querySelector("form");
      form.dataset.queueRepair = item.id;
      card.appendChild(details);
    }

    function renderQueueAction(item, card) {
      if (item.kind === "provider_reconciliation_case") {
        var button = createElement(
          documentRef,
          "button",
          "operator-button operator-queue-action",
          "Review typed reconciliation"
        );
        button.type = "button";
        button.dataset.reconciliationId = item.source.id;
        card.appendChild(button);
      } else if (
        item.kind === "adjacent_identity_review" && item.repair &&
        item.repair.kind === "adjacent_crosswalk_resolution"
      ) {
        var adjacentButton = createElement(
          documentRef,
          "button",
          "operator-button operator-queue-action",
          "Review identity crosswalk"
        );
        adjacentButton.type = "button";
        adjacentButton.dataset.adjacentCrosswalkId = item.source.id;
        card.appendChild(adjacentButton);
      } else if (MANUAL_REVIEW_KINDS.has(item.kind)) {
        card.appendChild(createElement(
          documentRef,
          "p",
          "operator-held-note",
          "Retained manual review; no generic repair or provider action is available."
        ));
      }
    }

    function renderQueue() {
      queueCount.textContent = String(state.queue.length);
      if (state.queue.length === 0) {
        empty(queueRoot, "No canonical source records currently require operator work.");
        return;
      }
      var fragment = documentRef.createDocumentFragment();
      state.queue.forEach(function (item) {
        var card = createElement(documentRef, "article", "operator-card");
        var top = createElement(documentRef, "div", "operator-card-top");
        top.append(
          createElement(documentRef, "span", "operator-card-title", human(item.kind)),
          createElement(documentRef, "span", "operator-badge", item.severity)
        );
        top.lastChild.dataset.severity = item.severity;
        card.append(
          top,
          meta([
            "State: " + human(item.source.state),
            "Deadline: " + formatDate(item.deadlineAt),
            "Revision " + item.revision
          ]),
          meta([
            "Source: " + item.source.table,
            "Digest: " + shortDigest(item.digest)
          ])
        );
        renderRepair(item, card);
        renderQueueAction(item, card);
        fragment.appendChild(card);
      });
      queueRoot.replaceChildren(fragment);
    }

    function renderNumberBindings() {
      numberBindingCount.textContent = String(state.numberBindings.length);
      if (state.numberBindings.length === 0) {
        empty(
          numberBindingsRoot,
          "No canonical Twilio number bindings exist in this operator scope."
        );
        return;
      }
      var fragment = documentRef.createDocumentFragment();
      state.numberBindings.forEach(function (binding) {
        var card = createElement(documentRef, "article", "operator-card");
        var top = createElement(documentRef, "div", "operator-card-top");
        var stateBadge = createElement(
          documentRef, "span", "operator-badge", binding.state
        );
        top.append(
          createElement(
            documentRef,
            "span",
            "operator-card-title",
            "Twilio binding · " + shortDigest(binding.numberLookupDigest)
          ),
          stateBadge
        );
        card.append(
          top,
          meta([
            "Project: " + binding.projectId,
            "Key: " + binding.lookupKeyVersion,
            "Revision " + binding.revision
          ]),
          meta([
            "Readback: " + shortDigest(binding.providerReadbackDigest),
            binding.state === "active"
              ? "Provisioned: " + formatDate(binding.provisionedAt)
              : "Retired: " + formatDate(binding.retiredAt) + " · " +
                human(binding.retiredReason)
          ])
        );
        if (binding.state === "active") {
          var retire = createElement(
            documentRef,
            "button",
            "operator-button operator-button-danger operator-queue-action",
            "Retire this binding"
          );
          retire.type = "button";
          retire.addEventListener("click", function () {
            if (state.busy) return;
            openServiceCommand(Object.freeze({
              product: "number-binding",
              action: "retire",
              bindingId: binding.id
            }));
          });
          card.append(retire);
        }
        fragment.append(card);
      });
      numberBindingsRoot.replaceChildren(fragment);
    }

    function renderAdjacentContracts() {
      adjacentContractCount.textContent = String(state.adjacentContracts.length);
      if (state.adjacentContracts.length === 0) {
        empty(adjacentContractsRoot, "The exact adjacent contract set is unavailable.");
        return;
      }
      adjacentContractsRoot.replaceChildren.apply(
        adjacentContractsRoot,
        state.adjacentContracts.map(function (contract) {
          var card = createElement(documentRef, "article", "operator-card");
          var top = createElement(documentRef, "div", "operator-card-top");
          top.append(
            createElement(
              documentRef, "span", "operator-card-title",
              human(contract.systemKey)
            ),
            createElement(
              documentRef, "span", "operator-badge", "effects held"
            )
          );
          card.append(
            top,
            meta([
              "Authority: " + human(contract.authorityOwner),
              "Read/events: " + human(contract.readEventDirection),
              "Writes: " + human(contract.writeEffectDirection)
            ]),
            meta([
              "Authentication: " + human(contract.authenticationBoundary),
              "Conflicts: " + human(contract.conflictOwner)
            ]),
            meta([
              "Reconciliation: " + human(contract.reconciliationPolicy),
              "Failure: " + human(contract.failureBehavior),
              "Revision " + contract.contractRevision
            ])
          );
          return card;
        })
      );
    }

    function adjacentTraceCard(kind, entry) {
      var pending = kind === "crosswalk" &&
        ADJACENT_RESOLUTIONS[entry.state] !== undefined;
      var card = createElement(
        documentRef,
        pending ? "button" : "article",
        "operator-card"
      );
      if (pending) {
        card.type = "button";
        card.dataset.adjacentCrosswalkId = entry.id;
      }
      var top = createElement(documentRef, "div", "operator-card-top");
      top.append(
        createElement(
          documentRef, "span", "operator-card-title",
          human(entry.systemKey) + " · " + human(kind)
        ),
        createElement(
          documentRef, "span", "operator-badge",
          human(entry.state || entry.observationState)
        )
      );
      var identity = kind === "crosswalk"
        ? entry.safeRemoteReference || shortDigest(entry.remoteReferenceDigest)
        : shortDigest(entry.payloadDigest);
      card.append(
        top,
        meta([
          kind === "crosswalk"
            ? human(entry.localEntityKind) + " → " + human(entry.remoteEntityKind)
            : human(entry.remoteEntityKind || entry.observationKind),
          "Identity/evidence: " + identity
        ]),
        meta([
          "Recorded: " + formatDate(entry.recordedAt),
          pending ? "Operator resolution required" : "Read-only evidence"
        ])
      );
      return card;
    }

    function renderAdjacentTrace() {
      var trace = state.adjacentTrace;
      var count = trace ? trace.crosswalks.length + trace.observations.length +
        trace.sourceSnapshots.length : 0;
      adjacentTraceCount.textContent = String(count);
      if (!trace || count === 0) {
        empty(
          adjacentTraceRoot,
          "No adjacent source snapshots, crosswalks, or observations are recorded in this operator scope."
        );
        return;
      }
      var cards = [];
      trace.crosswalks.forEach(function (entry) {
        cards.push(adjacentTraceCard("crosswalk", entry));
      });
      trace.observations.forEach(function (entry) {
        cards.push(adjacentTraceCard("observation", entry));
      });
      trace.sourceSnapshots.forEach(function (entry) {
        cards.push(adjacentTraceCard("source snapshot", entry));
      });
      adjacentTraceRoot.replaceChildren.apply(adjacentTraceRoot, cards);
    }

    function renderAdjacentDetail() {
      var entry = state.selectedAdjacent;
      if (!entry) {
        adjacentDetailRoot.hidden = true;
        return;
      }
      adjacentDetailTitle.textContent =
        human(entry.systemKey) + " identity · " + entry.id;
      adjacentFactsRoot.replaceChildren(
        fact("State", human(entry.state)),
        fact("Revision", String(entry.revision)),
        fact("Local identity", human(entry.localEntityKind) + " · " + entry.localEntityId),
        fact("Remote identity kind", human(entry.remoteEntityKind)),
        fact("Safe reference", entry.safeRemoteReference || "Digest only"),
        fact("Remote reference digest", shortDigest(entry.remoteReferenceDigest)),
        fact("Request digest", shortDigest(entry.requestDigest)),
        fact("Source revision digest", shortDigest(entry.sourceRevisionDigest)),
        fact("Provenance digest", shortDigest(entry.provenanceDigest))
      );
      adjacentResolutionKind.replaceChildren.apply(
        adjacentResolutionKind,
        (ADJACENT_RESOLUTIONS[entry.state] || []).map(function (resolution) {
          var option = createElement(
            documentRef, "option", "",
            human(resolution[0]) + " → " + human(resolution[1])
          );
          option.value = resolution.join(":");
          return option;
        })
      );
      adjacentResolutionForm.hidden =
        !ADJACENT_RESOLUTIONS[entry.state] ||
        ADJACENT_RESOLUTIONS[entry.state].length === 0;
      adjacentDetailRoot.hidden = false;
      adjacentDetailRoot.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    async function openAdjacentCrosswalk(crosswalkId) {
      clearMessages();
      setBusy(true);
      try {
        var result = validateAdjacentTrace(await state.client.request(
          "GET",
          "/operator/adjacent-integrations/trace?operatorOrganizationId=" +
            encodeURIComponent(state.organizationId) + "&crosswalkId=" +
            encodeURIComponent(uuid(crosswalkId))
        ));
        check(result.crosswalks.length === 1 &&
          result.crosswalks[0].id === crosswalkId);
        state.selectedAdjacent = result.crosswalks[0];
        state.selectedCase = null;
        state.selectedReconciliation = null;
        renderDetail();
        renderReconciliationDetail();
        renderAdjacentDetail();
      } catch (error) {
        showError(error);
      } finally {
        setBusy(false);
      }
    }

    function selectedAdjacentPair() {
      var key = formValue(adjacentCrosswalkForm, "identityPair");
      var pair = ADJACENT_IDENTITY_PAIRS[key];
      check(pair !== undefined);
      return pair;
    }

    function syncAdjacentCrosswalkForm() {
      var pair = selectedAdjacentPair();
      var localEntity = adjacentCrosswalkForm.elements.namedItem(
        "localEntityId"
      );
      var project = adjacentCrosswalkForm.elements.namedItem("projectId");
      var remoteReference = adjacentCrosswalkForm.elements.namedItem(
        "remoteReference"
      );
      var sourceSnapshot = adjacentCrosswalkForm.elements.namedItem(
        "sourceSnapshotId"
      );
      localEntity.readOnly = ["organization", "project"].includes(
        pair.localEntityKind
      );
      if (pair.localEntityKind === "organization") {
        localEntity.value = state.organizationId;
      } else if (pair.localEntityKind === "project") {
        localEntity.value = project.value;
      }
      project.required = pair.localEntityKind !== "organization";
      if (!project.required) project.value = "";
      remoteReference.pattern = pair.referencePolicy === "digest_only"
        ? "sha256:[a-f0-9]{64}"
        : pair.referencePolicy === "hub_client_id"
          ? "SSC-[0-9]{4}-[0-9]{3,}"
          : "SS-[0-9]{4}-[0-9]{3,}";
      var snapshots = state.adjacentTrace
        ? state.adjacentTrace.sourceSnapshots.filter(function (entry) {
          return entry.systemKey === pair.systemKey;
        })
        : [];
      sourceSnapshot.replaceChildren.apply(
        sourceSnapshot,
        snapshots.map(function (entry) {
          var option = createElement(
            documentRef,
            "option",
            "",
            human(entry.systemKey) + " · " + human(entry.observationKind) +
              " · " + shortDigest(entry.provenanceDigest)
          );
          option.value = entry.id;
          return option;
        })
      );
      sourceSnapshot.disabled = snapshots.length === 0;
      adjacentCrosswalkForm.querySelector("button[type=submit]").disabled =
        snapshots.length === 0;
    }

    function openAdjacentCrosswalkEntry() {
      state.selectedAdjacent = null;
      renderAdjacentDetail();
      adjacentCrosswalkForm.reset();
      syncAdjacentCrosswalkForm();
      adjacentCrosswalkEntry.hidden = false;
      adjacentCrosswalkEntry.scrollIntoView({
        behavior: "smooth", block: "start"
      });
    }

    function closeAdjacentCrosswalkEntry() {
      adjacentCrosswalkEntry.hidden = true;
      adjacentCrosswalkForm.reset();
    }

    function renderCases() {
      caseCount.textContent = String(state.cases.length);
      if (state.cases.length === 0) {
        empty(casesRoot, "No support or privacy cases are open in this operator scope.");
        return;
      }
      var fragment = documentRef.createDocumentFragment();
      state.cases.forEach(function (entry) {
        var button = createElement(documentRef, "button", "operator-card");
        button.type = "button";
        button.dataset.caseId = entry.id;
        var top = createElement(documentRef, "span", "operator-card-top");
        top.append(
          createElement(documentRef, "span", "operator-card-title", human(entry.requestKind) + " case"),
          createElement(documentRef, "span", "operator-badge", human(entry.state))
        );
        button.append(
          top,
          meta([
            "Identity: " + human(entry.identityState),
            "Deadline: " + human(entry.deadline.status),
            "Revision " + entry.revision
          ]),
          meta(["Opened " + formatDate(entry.openedAt), "Case " + entry.id])
        );
        fragment.appendChild(button);
      });
      casesRoot.replaceChildren(fragment);
    }

    function fact(label, value) {
      var row = createElement(documentRef, "dl", "operator-fact");
      row.append(
        createElement(documentRef, "dt", "", label),
        createElement(documentRef, "dd", "", value)
      );
      return row;
    }

    function renderDetail() {
      var entry = state.selectedCase;
      if (!entry) {
        detailRoot.hidden = true;
        return;
      }
      detailTitle.textContent = human(entry.requestKind) + " case · " + entry.id;
      factsRoot.replaceChildren(
        fact("State", human(entry.state)),
        fact("Identity", human(entry.identityState)),
        fact("Assigned operator", entry.assignedOperatorId || "Unassigned"),
        fact("Scope", human(entry.scope.kind)),
        fact("Deadline", formatDate(entry.deadline.dueAt) + " · " + human(entry.deadline.status)),
        fact("Revision", String(entry.revision)),
        fact("Requester reference", shortDigest(entry.requesterReferenceDigest)),
        fact("Opening", formatDate(entry.openedAt)),
        fact("Decision", entry.decision ? human(entry.decision.kind) : "Not recorded")
      );
      if (entry.audit.length === 0) {
        auditRoot.replaceChildren(createElement(documentRef, "li", "", "No audit events."));
      } else {
        auditRoot.replaceChildren.apply(auditRoot, entry.audit.map(function (event) {
          return createElement(
            documentRef,
            "li",
            "",
            event.sequence + ". " + human(event.kind) + " · " + human(event.actorKind) +
              " · " + formatDate(event.occurredAt) + " · " + shortDigest(event.eventDigest)
          );
        }));
      }
      actionsRoot.hidden = entry.state === "closed";
      detailRoot.hidden = false;
      detailRoot.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function renderReconciliationDetail() {
      var entry = state.selectedReconciliation;
      if (!entry) {
        reconciliationDetailRoot.hidden = true;
        return;
      }
      reconciliationTitle.textContent =
        human(entry.caseKind) + " · " + entry.id;
      reconciliationFactsRoot.replaceChildren(
        fact("State", human(entry.state)),
        fact("Provider", human(entry.provider)),
        fact("Revision", String(entry.revision)),
        fact("Opened", formatDate(entry.openedAt)),
        fact("Case digest", shortDigest(entry.caseDigest)),
        fact("Evidence digest", shortDigest(entry.evidenceDigest)),
        fact("Readback", human(entry.readbackState)),
        fact("Readback evidence", shortDigest(entry.readbackEvidenceDigest)),
        fact("Matched provider ID digest",
          shortDigest(entry.matchedProviderMessageIdDigest)),
        fact("Readback match count", entry.readbackMatchCount === null
          ? "Not recorded" : String(entry.readbackMatchCount))
      );
      reconciliationResolution.replaceChildren.apply(
        reconciliationResolution,
        entry.allowedResolutions.map(function (resolution) {
          var option = createElement(
            documentRef, "option", "", human(resolution)
          );
          option.value = resolution;
          return option;
        })
      );
      reconciliationForm.hidden =
        entry.state !== "open" || entry.allowedResolutions.length === 0;
      documentRef.getElementById("reconciliation-no-action").hidden =
        !reconciliationForm.hidden;
      reconciliationDetailRoot.hidden = false;
      reconciliationDetailRoot.scrollIntoView({
        behavior: "smooth", block: "start"
      });
    }

    async function openReconciliation(caseId) {
      clearMessages();
      setBusy(true);
      try {
        var result = await state.client.request(
          "GET",
          "/operator/provider-reconciliation/cases/" +
            encodeURIComponent(uuid(caseId)) +
            "?operatorOrganizationId=" + encodeURIComponent(state.organizationId)
        );
        state.selectedReconciliation = validateReconciliationCase(result);
        renderReconciliationDetail();
      } catch (error) {
        showError(error);
      } finally {
        setBusy(false);
      }
    }

    function serviceInput(name, type, options) {
      var control = createElement(documentRef, "input");
      control.name = name;
      control.type = type;
      control.required = !(options && options.optional);
      control.autocomplete = "off";
      if (options && options.pattern) control.pattern = options.pattern;
      if (options && options.maxLength) control.maxLength = options.maxLength;
      if (options && options.minimum !== undefined) control.min = options.minimum;
      if (options && options.value !== undefined) control.value = options.value;
      return control;
    }

    function serviceSelect(name, values) {
      var control = createElement(documentRef, "select");
      control.name = name;
      control.required = true;
      values.forEach(function (entry) {
        var option = createElement(documentRef, "option", "", entry[1]);
        option.value = entry[0];
        control.append(option);
      });
      return control;
    }

    function serviceField(label, control) {
      var wrapper = createElement(documentRef, "label", "operator-field");
      wrapper.append(createElement(documentRef, "span", "", label), control);
      return wrapper;
    }

    function serviceDigest(name) {
      return serviceInput(name, "text", {
        pattern: "[a-f0-9]{64}", maxLength: 64
      });
    }

    function serviceInstant(name) {
      return serviceInput(name, "datetime-local", {
        value: new Date().toISOString().slice(0, 16)
      });
    }

    function serviceFutureInstant(name, hours) {
      return serviceInput(name, "datetime-local", {
        value: new Date(Date.now() + (hours * 60 * 60 * 1000))
          .toISOString().slice(0, 16)
      });
    }

    function randomId() {
      check(cryptoRef && typeof cryptoRef.randomUUID === "function");
      return uuid(cryptoRef.randomUUID());
    }

    function renderCareCommand(form, action) {
      if (action.action === "close-period") {
        form.append(createElement(
          documentRef,
          "p",
          "operator-held-note",
          "Close the selected held period at its current revision."
        ));
        return;
      }
      if (action.action === "transition-ticket") {
        form.append(createElement(
          documentRef,
          "p",
          "operator-held-note",
          "Record the " + human(action.transition) +
            " transition against the selected ticket revision."
        ));
        return;
      }
      if (action.action === "allocate-capacity") {
        form.append(
          serviceField("Capacity source", serviceSelect("capacitySource", [
            ["included", "Included capacity"],
            ["carried", "Carried capacity"]
          ])),
          serviceField("Units", serviceInput(
            "units", "number", { minimum: "1", value: "1" }
          ))
        );
        return;
      }
      if (action.action === "reserve-mail") {
        form.append(
          serviceField("Template", serviceSelect("templateVersion", [
            ["care-ticket-update.v1", "Care ticket update v1"]
          ])),
          serviceField("Recipient SHA-256", serviceDigest("recipientDigest")),
          serviceField(
            "Subject reference SHA-256",
            serviceDigest("subjectReferenceDigest")
          ),
          serviceField("Content SHA-256", serviceDigest("contentDigest")),
          serviceField(
            "Reservation expires at",
            serviceFutureInstant("expiresAt", 24)
          )
        );
        return;
      }
      var kind = serviceSelect("careCommandKind", [
        ["open_period", "Open a held Care period"],
        ["open_ticket", "Open a held Care ticket"]
      ]);
      var period = createElement(documentRef, "fieldset", "operator-action-card");
      period.dataset.careFields = "open_period";
      period.append(
        createElement(documentRef, "legend", "", "Held Care period"),
        serviceField("Starts on", serviceInput("startsOn", "date")),
        serviceField("Ends on", serviceInput("endsOn", "date")),
        serviceField("Included units", serviceInput(
          "includedUnits", "number", { minimum: "0", value: "0" }
        )),
        serviceField("Carried units", serviceInput(
          "carriedUnits", "number", { minimum: "0", value: "0" }
        )),
        serviceField("Carried-from period ID (optional)", serviceInput(
          "carriedFromPeriodId", "text", { optional: true, maxLength: 36 }
        )),
        serviceField("Provider period key", serviceInput(
          "providerPeriodKey", "text", { maxLength: 200 }
        )),
        serviceField("Provider scope SHA-256", serviceDigest(
          "providerScopeDigest"
        ))
      );
      var ticket = createElement(documentRef, "fieldset", "operator-action-card");
      ticket.dataset.careFields = "open_ticket";
      ticket.hidden = true;
      ticket.append(
        createElement(documentRef, "legend", "", "Held Care ticket"),
        serviceField("Period ID", serviceInput(
          "periodId", "text", { maxLength: 36 }
        )),
        serviceField("Basis", serviceSelect("basisKind", [
          ["assessment_finding", "Assessment finding"],
          ["customer_request", "Customer request"],
          ["monitoring_incident", "Monitoring incident"],
          ["rescue_scope", "Rescue scope"]
        ])),
        serviceField("Basis SHA-256", serviceDigest("basisDigest")),
        serviceField("Work scope SHA-256", serviceDigest("workScopeDigest")),
        serviceField("Support ticket ID (optional)", serviceInput(
          "supportTicketId", "text", { optional: true, maxLength: 36 }
        ))
      );
      form.append(serviceField("Care command", kind), period, ticket);
      kind.addEventListener("change", function () {
        period.hidden = kind.value !== "open_period";
        ticket.hidden = kind.value !== "open_ticket";
        Array.from(period.querySelectorAll("input, select")).forEach(
          function (control) { control.disabled = period.hidden; }
        );
        Array.from(ticket.querySelectorAll("input, select")).forEach(
          function (control) { control.disabled = ticket.hidden; }
        );
      });
      Array.from(ticket.querySelectorAll("input, select")).forEach(
        function (control) { control.disabled = true; }
      );
    }

    function renderResponderCommand(form, action) {
      if (action.action === "global-kill") {
        form.append(serviceField("Kill evidence SHA-256", serviceDigest(
          "evidenceDigest"
        )));
      } else if (action.action === "operator-consent") {
        form.append(
          serviceField("Project ID", serviceInput(
            "projectId", "text", { maxLength: 36 }
          )),
          serviceField("Customer user ID", serviceInput(
            "customerUserId", "text", { maxLength: 36 }
          )),
          serviceField("Route SHA-256", serviceDigest("routeDigest")),
          serviceField("Consent basis", serviceSelect("consentBasis", [
            ["explicit_service_request", "Explicit service request"],
            ["inbound_call", "Inbound call"],
            ["inbound_message", "Inbound message"]
          ])),
          serviceField(
            "Consent evidence SHA-256",
            serviceDigest("consentEvidenceDigest")
          ),
          serviceField("Consented at", serviceInstant("consentedAt"))
        );
      } else if (action.action === "stop") {
        form.append(
          serviceField("Provider event ID SHA-256", serviceDigest(
            "providerEventIdDigest"
          )),
          serviceField("STOP payload SHA-256", serviceDigest("payloadDigest")),
          serviceField("Occurred at", serviceInstant("occurredAt"))
        );
      } else if (action.action === "handoff") {
        form.append(
          serviceField("Reason", serviceSelect("reason", [
            ["customer_request", "Customer request"],
            ["uncertain_intent", "Uncertain intent"],
            ["urgent", "Urgent"],
            ["operator_review", "Operator review"]
          ])),
          serviceField("Evidence SHA-256", serviceDigest("evidenceDigest"))
        );
      } else if (action.action === "held-message") {
        form.append(
          serviceField("Message kind", serviceSelect("messageKind", [
            ["missed_call_ack", "Missed-call acknowledgment"],
            ["human_handoff_ack", "Human-handoff acknowledgment"]
          ])),
          serviceField("Content SHA-256", serviceDigest("contentDigest"))
        );
      }
    }

    function renderNumberBindingCommand(form, action) {
      if (action.action === "retire") {
        form.append(
          serviceField("Retirement reason", serviceSelect("reason", [
            ["number_released", "Number released"],
            ["reprovisioned", "Reprovisioned"],
            ["customer_cancelled", "Customer cancelled"],
            ["operator_correction", "Operator correction"]
          ])),
          serviceField("Retirement evidence SHA-256", serviceDigest(
            "evidenceDigest"
          ))
        );
        return;
      }
      form.append(
        createElement(
          documentRef,
          "p",
          "operator-held-note",
          "Verify these values in Twilio immediately before recording. Raw values are submitted once and the server returns digests only."
        ),
        serviceField("Project ID", serviceInput(
          "projectId", "text", { maxLength: 36 }
        )),
        serviceField("Business number (E.164)", serviceInput(
          "phoneNumber", "tel", {
            pattern: "\\+[1-9][0-9]{1,14}", maxLength: 16
          }
        )),
        serviceField("Twilio Phone Number SID", serviceInput(
          "phoneNumberSid", "password", {
            pattern: "PN[0-9A-Fa-f]{32}", maxLength: 34
          }
        )),
        serviceField("Twilio Account SID", serviceInput(
          "accountSid", "password", {
            pattern: "AC[0-9A-Fa-f]{32}", maxLength: 34
          }
        )),
        serviceField("Messaging Service SID (optional)", serviceInput(
          "messagingServiceSid", "password", {
            optional: true, pattern: "MG[0-9A-Fa-f]{32}", maxLength: 34
          }
        )),
        serviceField("Provider readback observed at", serviceInstant(
          "readbackAttestedAt"
        )),
        serviceField("Attestation evidence SHA-256", serviceDigest(
          "evidenceDigest"
        ))
      );
    }

    function openServiceCommand(action) {
      state.serviceCommand = action;
      serviceCommandTitle.textContent = action.product === "care"
        ? "Record held Care evidence"
        : action.product === "responder"
          ? "Record held Responder evidence"
          : action.action === "retire"
            ? "Retire Responder number binding"
            : "Provision Responder number binding";
      var form = createElement(documentRef, "form", "operator-action-card");
      form.dataset.operatorServiceCommand = "true";
      if (action.product === "care") renderCareCommand(form, action);
      else if (action.product === "responder") {
        renderResponderCommand(form, action);
      } else {
        renderNumberBindingCommand(form, action);
      }
      var submit = createElement(
        documentRef,
        "button",
        "operator-button operator-button-danger",
        "Record bounded command"
      );
      submit.type = "submit";
      form.append(submit);
      serviceCommandFormRoot.replaceChildren(form);
      serviceCommandRoot.hidden = false;
      serviceCommandRoot.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function closeServiceCommand() {
      state.serviceCommand = null;
      serviceCommandFormRoot.replaceChildren();
      serviceCommandRoot.hidden = true;
    }

    function exactOptionalUuid(form, name) {
      var selected = formValue(form, name);
      return selected === "" ? null : uuid(selected);
    }

    function exactFormDigest(form, name) {
      return digest(formValue(form, name));
    }

    function careCommandRequest(form, action) {
      var base = "/operator/care/organizations/" +
        encodeURIComponent(state.organizationId);
      if (action.action === "close-period") {
        return state.client.request(
          "POST",
          base + "/periods/" + encodeURIComponent(action.periodId) +
            "/closure",
          { body: {
            expectedRevision: action.expectedRevision,
            projectId: action.projectId
          } }
        );
      }
      if (action.action === "transition-ticket") {
        return state.client.request(
          "POST",
          base + "/tickets/" + encodeURIComponent(action.ticketId) +
            "/transitions",
          { body: {
            expectedRevision: action.expectedRevision,
            projectId: action.projectId,
            transition: action.transition
          } }
        );
      }
      if (action.action === "allocate-capacity") {
        return state.client.request(
          "POST",
          base + "/periods/" + encodeURIComponent(action.periodId) +
            "/capacity",
          { body: {
            capacitySource: formValue(form, "capacitySource"),
            entryId: randomId(),
            projectId: action.projectId,
            ticketId: action.ticketId,
            units: Number(formValue(form, "units"))
          } }
        );
      }
      if (action.action === "reserve-mail") {
        return state.client.request(
          "POST",
          base + "/tickets/" + encodeURIComponent(action.ticketId) +
            "/mail-reservations",
          { body: {
            contentDigest: exactFormDigest(form, "contentDigest"),
            expiresAt: localInstant(formValue(form, "expiresAt")),
            recipientDigest: exactFormDigest(form, "recipientDigest"),
            subjectReferenceDigest: exactFormDigest(
              form, "subjectReferenceDigest"
            ),
            templateVersion: formValue(form, "templateVersion")
          } }
        );
      }
      if (formValue(form, "careCommandKind") === "open_period") {
        return state.client.request("POST", base + "/periods", {
          body: {
            carriedFromPeriodId: exactOptionalUuid(form, "carriedFromPeriodId"),
            carriedUnits: Number(formValue(form, "carriedUnits")),
            contractId: action.contractId,
            endsOn: formValue(form, "endsOn"),
            includedUnits: Number(formValue(form, "includedUnits")),
            periodId: randomId(),
            projectId: action.projectId,
            providerPeriodKey: formValue(form, "providerPeriodKey"),
            providerScopeDigest: exactFormDigest(form, "providerScopeDigest"),
            startsOn: formValue(form, "startsOn")
          }
        });
      }
      return state.client.request("POST", base + "/tickets", {
        body: {
          basisDigest: exactFormDigest(form, "basisDigest"),
          basisKind: formValue(form, "basisKind"),
          contractId: action.contractId,
          periodId: uuid(formValue(form, "periodId")),
          projectId: action.projectId,
          supportTicketId: exactOptionalUuid(form, "supportTicketId"),
          ticketId: randomId(),
          workScopeDigest: exactFormDigest(form, "workScopeDigest")
        }
      });
    }

    function responderCommandRequest(form, action) {
      var base = "/operator/responder/organizations/" +
        encodeURIComponent(state.organizationId);
      if (action.action === "operator-consent") {
        return state.client.request("POST", base + "/contacts", {
          body: {
            consentBasis: formValue(form, "consentBasis"),
            consentEvidenceDigest: exactFormDigest(
              form, "consentEvidenceDigest"
            ),
            consentedAt: localInstant(formValue(form, "consentedAt")),
            customerUserId: uuid(formValue(form, "customerUserId")),
            projectId: uuid(formValue(form, "projectId")),
            routeDigest: exactFormDigest(form, "routeDigest")
          }
        });
      }
      if (action.action === "global-kill") {
        return state.client.request("POST", base + "/global-kill", {
          body: { evidenceDigest: exactFormDigest(form, "evidenceDigest") }
        });
      }
      if (action.action === "stop") {
        return state.client.request(
          "POST",
          base + "/contacts/" + encodeURIComponent(action.contactAuthorityId) +
            "/stop",
          { body: {
            occurredAt: localInstant(formValue(form, "occurredAt")),
            payloadDigest: exactFormDigest(form, "payloadDigest"),
            projectId: action.projectId,
            providerEventIdDigest: exactFormDigest(
              form, "providerEventIdDigest"
            ),
            routeDigest: action.routeDigest
          } }
        );
      }
      if (action.action === "handoff") {
        return state.client.request(
          "POST",
          base + "/interactions/" + encodeURIComponent(action.interactionId) +
            "/handoff",
          { body: {
            evidenceDigest: exactFormDigest(form, "evidenceDigest"),
            expectedRevision: action.expectedRevision,
            projectId: action.projectId,
            reason: formValue(form, "reason")
          } }
        );
      }
      return state.client.request(
        "POST",
        base + "/interactions/" + encodeURIComponent(action.interactionId) +
          "/held-messages",
        { body: {
          contactAuthorityId: action.contactAuthorityId,
          contentDigest: exactFormDigest(form, "contentDigest"),
          messageKind: formValue(form, "messageKind"),
          projectId: action.projectId
        } }
      );
    }

    function numberBindingCommandRequest(form, action) {
      var base = "/operator/responder/organizations/" +
        encodeURIComponent(state.organizationId) + "/number-bindings";
      if (action.action === "retire") {
        return state.client.request(
          "POST",
          base + "/" + encodeURIComponent(action.bindingId) + "/retire",
          { body: {
            evidenceDigest: exactFormDigest(form, "evidenceDigest"),
            reason: formValue(form, "reason")
          } }
        );
      }
      var messagingServiceSid = formValue(form, "messagingServiceSid");
      return state.client.request("POST", base, {
        body: {
          accountSid: formValue(form, "accountSid"),
          evidenceDigest: exactFormDigest(form, "evidenceDigest"),
          messagingServiceSid: messagingServiceSid || null,
          phoneNumber: formValue(form, "phoneNumber"),
          phoneNumberSid: formValue(form, "phoneNumberSid"),
          projectId: uuid(formValue(form, "projectId")),
          readbackAttestedAt: localInstant(formValue(
            form, "readbackAttestedAt"
          ))
        }
      });
    }

    function renderServiceSurfaces() {
      check(
        careModule && typeof careModule.mount === "function" &&
        responderModule && typeof responderModule.mount === "function"
      );
      careRoot.replaceChildren();
      responderRoot.replaceChildren();
      careModule.mount({
        audience: "operator",
        container: careRoot,
        documentRef: documentRef,
        snapshot: state.careSnapshot,
        onCommand: function (action) {
          openServiceCommand(Object.freeze({ product: "care", ...action }));
        }
      });
      responderModule.mount({
        audience: "operator",
        container: responderRoot,
        documentRef: documentRef,
        snapshot: state.responderSnapshot,
        onCommand: function (action) {
          openServiceCommand(Object.freeze({ product: "responder", ...action }));
        }
      });
    }

    async function refreshAll(options) {
      if (!state.organizationId) return;
      clearMessages();
      setBusy(true);
      try {
        var organization = encodeURIComponent(state.organizationId);
        var values = await Promise.all([
          state.client.request(
            "GET",
            "/operator/work-queue?operatorOrganizationId=" + organization
          ),
          state.client.request(
            "GET",
            "/operator/support-cases?operatorOrganizationId=" + organization
          ),
          state.client.request(
            "GET",
            "/operator/care/organizations/" + organization
          ),
          state.client.request(
            "GET",
            "/operator/responder/organizations/" + organization
          ),
          state.client.request(
            "GET",
            "/operator/responder/organizations/" + organization +
              "/number-bindings"
          ),
          state.client.request(
            "GET",
            "/operator/adjacent-integrations/contracts?operatorOrganizationId=" +
              organization
          ),
          state.client.request(
            "GET",
            "/operator/adjacent-integrations/trace?operatorOrganizationId=" +
              organization
          )
        ]);
        state.queue = validateQueue(values[0]).items;
        state.cases = validateCaseList(values[1]).cases;
        state.careSnapshot = values[2];
        state.responderSnapshot = values[3];
        state.numberBindings = validateNumberBindingList(values[4]).bindings;
        state.adjacentContracts = validateAdjacentContracts(values[5]).systems;
        state.adjacentTrace = validateAdjacentTrace(values[6]);
        if (state.selectedCase) {
          state.selectedCase = state.cases.find(function (entry) {
            return entry.id === state.selectedCase.id;
          }) || null;
        }
        if (state.selectedReconciliation && !state.queue.some(function (item) {
          return item.kind === "provider_reconciliation_case" &&
            item.source.id === state.selectedReconciliation.id;
        })) state.selectedReconciliation = null;
        renderQueue();
        renderCases();
        renderDetail();
        renderReconciliationDetail();
        renderServiceSurfaces();
        renderNumberBindings();
        renderAdjacentContracts();
        renderAdjacentTrace();
        if (options && options.notice) showNotice(options.notice);
      } catch (error) {
        showError(error);
      } finally {
        setBusy(false);
      }
    }

    async function refreshSources() {
      if (!state.organizationId) return;
      clearMessages();
      setBusy(true);
      try {
        var refreshed = await state.client.request(
          "POST",
          "/operator/work-queue/refresh",
          { body: { operatorOrganizationId: state.organizationId } }
        );
        state.queue = validateQueue(refreshed).items;
        renderQueue();
        await refreshAll({ notice: "Canonical sources and case state refreshed." });
      } catch (error) {
        showError(error);
      } finally {
        setBusy(false);
      }
    }

    async function mutateCase(suffix, body, notice) {
      var selected = state.selectedCase;
      if (!selected) return;
      clearMessages();
      setBusy(true);
      try {
        var result = await state.client.request(
          "POST",
          "/operator/support-cases/" + encodeURIComponent(selected.id) + suffix,
          {
            body: Object.assign({
              expectedRevision: selected.revision,
              operatorOrganizationId: state.organizationId
            }, body)
          }
        );
        state.selectedCase = validateOperatorCase(result);
        state.cases = state.cases.map(function (entry) {
          return entry.id === state.selectedCase.id ? state.selectedCase : entry;
        });
        renderCases();
        renderDetail();
        showNotice(notice);
      } catch (error) {
        showError(error);
      } finally {
        setBusy(false);
      }
    }

    casesRoot.addEventListener("click", function (event) {
      var button = event.target.closest("[data-case-id]");
      if (!button) return;
      state.selectedCase = state.cases.find(function (entry) {
        return entry.id === button.dataset.caseId;
      }) || null;
      state.selectedReconciliation = null;
      renderDetail();
      renderReconciliationDetail();
    });

    queueRoot.addEventListener("click", function (event) {
      var adjacent = event.target.closest("[data-adjacent-crosswalk-id]");
      if (adjacent && !state.busy) {
        openAdjacentCrosswalk(adjacent.dataset.adjacentCrosswalkId);
        return;
      }
      var button = event.target.closest("[data-reconciliation-id]");
      if (!button || state.busy) return;
      state.selectedCase = null;
      renderDetail();
      openReconciliation(button.dataset.reconciliationId);
    });

    adjacentTraceRoot.addEventListener("click", function (event) {
      var button = event.target.closest("[data-adjacent-crosswalk-id]");
      if (!button || state.busy) return;
      openAdjacentCrosswalk(button.dataset.adjacentCrosswalkId);
    });

    queueRoot.addEventListener("submit", async function (event) {
      var form = event.target.closest("[data-queue-repair]");
      if (!form) return;
      event.preventDefault();
      var item = state.queue.find(function (entry) {
        return entry.id === form.dataset.queueRepair;
      });
      if (!item || !item.repair) return;
      try {
        var facts = JSON.parse(formValue(form, "verifiedFacts"));
        check(isObject(facts));
        var resolution = formValue(form, "resolution");
        setBusy(true);
        var result = await state.client.request(
          "POST",
          "/operator/work-queue/" + encodeURIComponent(item.id) +
            "/repairs/professional-reversal",
          {
            body: {
              operatorOrganizationId: state.organizationId,
              expectedQueueRevision: item.revision,
              resolution: resolution,
              confirmedOutcome: resolution === "confirmed"
                ? formValue(form, "confirmedOutcome")
                : null,
              verifiedFacts: facts,
              verifiedFactsDigest: formValue(form, "verifiedFactsDigest"),
              verifiedObservedAt: localInstant(formValue(form, "verifiedObservedAt"))
            }
          }
        );
        exact(result, ["kind", "queue", "queueItemId", "result", "schema"]);
        check(
          result.schema === "sitesourcery.operator-work-queue-repair-result/v1" &&
          result.kind === "professional_reversal_reconcile" &&
          result.queueItemId === item.id
        );
        state.queue = validateQueue(result.queue).items;
        renderQueue();
        showNotice("Bounded reversal evidence was reconciled and the queue was rebuilt.");
      } catch (error) {
        showError(error);
      } finally {
        setBusy(false);
      }
    });

    actionsRoot.addEventListener("click", function (event) {
      var button = event.target.closest("[data-case-action]");
      if (!button || state.busy) return;
      if (button.dataset.caseAction === "assign") {
        mutateCase("/assignment", { assignedOperatorId: state.actorId }, "Case assigned.");
      } else if (button.dataset.caseAction === "review") {
        mutateCase("/review", {}, "Formal review started.");
      }
    });

    actionsRoot.addEventListener("change", function (event) {
      if (event.target.name !== "appealAvailable") return;
      var form = event.target.closest("[data-case-form=\"denial\"]");
      var fields = form.querySelector("[data-appeal-fields]");
      fields.hidden = !event.target.checked;
      Array.from(fields.querySelectorAll("input")).forEach(function (input) {
        input.required = event.target.checked;
      });
    });

    actionsRoot.addEventListener("submit", function (event) {
      var form = event.target.closest("[data-case-form]");
      if (!form) return;
      event.preventDefault();
      var kind = form.dataset.caseForm;
      try {
        if (kind === "identity") {
          mutateCase("/identity", {
            identityState: formValue(form, "identityState"),
            evidenceDigest: formValue(form, "evidenceDigest")
          }, "Identity evidence recorded.");
        } else if (kind === "deadline") {
          mutateCase("/deadline", {
            responseDueAt: localInstant(formValue(form, "responseDueAt")),
            basisDigest: formValue(form, "basisDigest")
          }, "Response deadline recorded.");
        } else if (kind === "evidence") {
          mutateCase("/evidence", {
            evidenceKind: formValue(form, "evidenceKind"),
            evidenceDigest: formValue(form, "evidenceDigest")
          }, "Case evidence digest recorded.");
        } else if (kind === "response") {
          mutateCase("/response", {
            responseDigest: formValue(form, "responseDigest")
          }, "Response digest recorded; no customer message was sent.");
        } else if (kind === "denial") {
          var appeal = form.elements.namedItem("appealAvailable").checked;
          mutateCase("/denial", {
            denialReasonCode: formValue(form, "denialReasonCode"),
            denialExplanationDigest: formValue(form, "denialExplanationDigest"),
            appealAvailable: appeal,
            appealDueAt: appeal ? localInstant(formValue(form, "appealDueAt")) : null,
            appealBasisDigest: appeal ? formValue(form, "appealBasisDigest") : null
          }, "Denial evidence recorded; no customer message was sent.");
        } else if (kind === "closure") {
          mutateCase("/closure", {
            closureReasonCode: formValue(form, "closureReasonCode"),
            closureEvidenceDigest: formValue(form, "closureEvidenceDigest")
          }, "Case closure recorded.");
        }
      } catch (error) {
        showError(error);
      }
    });

    reconciliationForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      var selected = state.selectedReconciliation;
      if (!selected || state.busy) return;
      try {
        var selectedResolution = formValue(
          reconciliationForm, "resolutionKind"
        );
        check(selected.allowedResolutions.includes(selectedResolution));
        clearMessages();
        setBusy(true);
        var result = validateResolutionReceipt(await state.client.request(
          "POST",
          "/operator/provider-reconciliation/cases/" +
            encodeURIComponent(selected.id) + "/resolution",
          {
            body: {
              operatorOrganizationId: state.organizationId,
              expectedRevision: selected.revision,
              resolutionKind: selectedResolution,
              evidenceDigest: digest(formValue(
                reconciliationForm, "evidenceDigest"
              ))
            }
          }
        ));
        state.selectedReconciliation = null;
        renderReconciliationDetail();
        await refreshAll({
          notice: result.replayed
            ? "The exact reconciliation resolution was already recorded."
            : "Evidence-bound reconciliation resolution recorded. No provider action was executed."
        });
      } catch (error) {
        showError(error);
      } finally {
        setBusy(false);
      }
    });

    adjacentResolutionForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      var selected = state.selectedAdjacent;
      if (!selected || state.busy) return;
      try {
        var resolution = formValue(
          adjacentResolutionForm, "resolutionKind"
        ).split(":");
        check(
          resolution.length === 2 &&
          (ADJACENT_RESOLUTIONS[selected.state] || []).some(function (entry) {
            return entry[0] === resolution[0] && entry[1] === resolution[1];
          })
        );
        clearMessages();
        setBusy(true);
        var result = validateAdjacentResolutionReceipt(
          await state.client.request(
            "POST",
            "/operator/adjacent-integrations/resolutions",
            {
              body: {
                crosswalkId: selected.id,
                expectedCrosswalkRequestDigest: selected.requestDigest,
                expectedCrosswalkRevision: selected.revision,
                operatorOrganizationId: state.organizationId,
                priorState: selected.state,
                resolutionEvidenceDigest: digest(formValue(
                  adjacentResolutionForm, "evidenceDigest"
                )),
                resolutionKind: resolution[0],
                resultingState: resolution[1],
                systemKey: selected.systemKey
              }
            }
          )
        );
        state.selectedAdjacent = null;
        renderAdjacentDetail();
        adjacentResolutionForm.reset();
        await refreshAll({
          notice: result.replay
            ? "The exact adjacent identity resolution was already recorded."
            : "Local adjacent identity resolution recorded. No remote or provider effect was executed."
        });
      } catch (error) {
        showError(error);
      } finally {
        setBusy(false);
      }
    });

    adjacentCrosswalkForm.addEventListener("change", function (event) {
      if (event.target.name === "identityPair") syncAdjacentCrosswalkForm();
      if (event.target.name === "projectId" &&
        selectedAdjacentPair().localEntityKind === "project") {
        adjacentCrosswalkForm.elements.namedItem("localEntityId").value =
          event.target.value;
      }
    });

    adjacentCrosswalkForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      if (state.busy) return;
      try {
        var pair = selectedAdjacentPair();
        var projectValue = formValue(adjacentCrosswalkForm, "projectId");
        var remoteReference = formValue(
          adjacentCrosswalkForm, "remoteReference"
        );
        var sourceRevision = formValue(
          adjacentCrosswalkForm, "sourceRevision"
        );
        check(
          (pair.referencePolicy === "digest_only" &&
            /^sha256:[a-f0-9]{64}$/u.test(remoteReference)) ||
          (pair.referencePolicy === "hub_client_id" &&
            /^SSC-[0-9]{4}-[0-9]{3,}$/u.test(remoteReference)) ||
          (pair.referencePolicy === "hub_project_id" &&
            /^SS-[0-9]{4}-[0-9]{3,}$/u.test(remoteReference))
        );
        check(/^(git:[a-f0-9]{40}|sha256:[a-f0-9]{64})$/u.test(
          sourceRevision
        ));
        var stateValue = formValue(adjacentCrosswalkForm, "state");
        check(["manual_review", "conflict"].includes(stateValue));
        var supersedesValue = formValue(
          adjacentCrosswalkForm, "supersedesCrosswalkId"
        );
        if (supersedesValue) uuid(supersedesValue);
        clearMessages();
        setBusy(true);
        var result = validateAdjacentCrosswalkReceipt(
          await state.client.request(
            "POST",
            "/operator/adjacent-integrations/crosswalks",
            {
              body: {
                localEntityId: pair.localEntityKind === "organization"
                  ? state.organizationId
                  : pair.localEntityKind === "project"
                    ? uuid(projectValue)
                    : uuid(formValue(adjacentCrosswalkForm, "localEntityId")),
                localEntityKind: pair.localEntityKind,
                operatorOrganizationId: state.organizationId,
                projectId: pair.localEntityKind === "organization"
                  ? null
                  : uuid(projectValue),
                referencePolicy: pair.referencePolicy,
                remoteEntityKind: pair.remoteEntityKind,
                remoteReference: remoteReference,
                sourceEvidenceDigest: digest(formValue(
                  adjacentCrosswalkForm, "sourceEvidenceDigest"
                )),
                sourceRevision: sourceRevision,
                sourceSnapshotId: uuid(formValue(
                  adjacentCrosswalkForm, "sourceSnapshotId"
                )),
                state: stateValue,
                supersedesCrosswalkId: supersedesValue || null,
                systemKey: pair.systemKey
              }
            }
          )
        );
        closeAdjacentCrosswalkEntry();
        await refreshAll({
          notice: result.replay
            ? "The exact adjacent crosswalk evidence was already recorded."
            : "Local crosswalk evidence recorded for operator review. No adjacent system was changed."
        });
      } catch (error) {
        showError(error);
      } finally {
        setBusy(false);
      }
    });

    serviceCommandFormRoot.addEventListener("submit", async function (event) {
      var form = event.target.closest("[data-operator-service-command]");
      if (!form || !state.serviceCommand || state.busy) return;
      event.preventDefault();
      try {
        clearMessages();
        setBusy(true);
        var commandProduct = state.serviceCommand.product;
        if (state.serviceCommand.product === "care") {
          await careCommandRequest(form, state.serviceCommand);
        } else if (state.serviceCommand.product === "responder") {
          await responderCommandRequest(form, state.serviceCommand);
        } else {
          var bindingResult;
          try {
            bindingResult = await numberBindingCommandRequest(
              form, state.serviceCommand
            );
          } finally {
            Array.from(form.querySelectorAll("input")).forEach(
              function (control) { control.value = ""; }
            );
          }
          validateNumberBinding(bindingResult);
        }
        closeServiceCommand();
        await refreshAll({
          notice: commandProduct === "number-binding"
            ? "Digest-only number binding evidence recorded. No provider action was executed."
            : "Canonical held service evidence recorded. No provider or billing effect was opened."
        });
      } catch (error) {
        showError(error);
      } finally {
        setBusy(false);
      }
    });

    documentRef.getElementById("case-detail-close").addEventListener("click", function () {
      state.selectedCase = null;
      renderDetail();
    });
    documentRef.getElementById("reconciliation-detail-close")
      .addEventListener("click", function () {
        state.selectedReconciliation = null;
        renderReconciliationDetail();
      });
    documentRef.getElementById("operator-service-command-close")
      .addEventListener("click", closeServiceCommand);
    documentRef.getElementById("operator-adjacent-detail-close")
      .addEventListener("click", function () {
        state.selectedAdjacent = null;
        renderAdjacentDetail();
      });
    documentRef.getElementById("operator-adjacent-crosswalk-close")
      .addEventListener("click", closeAdjacentCrosswalkEntry);
    adjacentCrosswalkOpen.addEventListener("click", function () {
      if (state.busy || !state.organizationId) return;
      openAdjacentCrosswalkEntry();
    });
    numberBindingProvision.addEventListener("click", function () {
      if (state.busy || !state.organizationId) return;
      openServiceCommand(Object.freeze({
        product: "number-binding", action: "provision"
      }));
    });
    refreshButton.addEventListener("click", refreshSources);
    organizationSelect.addEventListener("change", function () {
      state.organizationId = organizationSelect.value;
      state.selectedCase = null;
      state.selectedReconciliation = null;
      state.selectedAdjacent = null;
      renderAdjacentDetail();
      closeAdjacentCrosswalkEntry();
      closeServiceCommand();
      refreshAll();
    });

    async function boot() {
      if (!publicApi || typeof publicApi.createClient !== "function") {
        showError(new Error("The secure Site Sourcery client is unavailable."));
        return;
      }
      state.client = publicApi.createClient();
      setBusy(true);
      try {
        var account = await state.client.me();
        if (!account || !account.user) {
          sessionStatus.textContent = "Sign in through the Assessment and Custom tools to continue.";
          board.setAttribute("aria-busy", "false");
          return;
        }
        state.actorId = uuid(account.user.id);
        state.organizations = validateOrganizationPayload(
          await state.client.listOrganizations()
        );
        if (state.organizations.length === 0) {
          throw new Error("This account does not have an active operator organization.");
        }
        organizationSelect.replaceChildren.apply(
          organizationSelect,
          state.organizations.map(function (organization) {
            var option = createElement(
              documentRef,
              "option",
              "",
              organization.name + " · " + human(organization.role)
            );
            option.value = organization.id;
            return option;
          })
        );
        state.organizationId = state.organizations[0].id;
        organizationSelect.value = state.organizationId;
        sessionStatus.textContent = "Authenticated. Database capability checks remain authoritative for every request.";
        await refreshAll();
      } catch (error) {
        if (error && error.status === 401) {
          sessionStatus.textContent = "Sign in through the Assessment and Custom tools to continue.";
        } else {
          showError(error);
        }
      } finally {
        setBusy(false);
      }
    }

    boot();
    return Object.freeze({ refresh: refreshAll });
  }

  return Object.freeze({
    mount: mount,
    validateCaseList: validateCaseList,
    validateOperatorCase: validateOperatorCase,
    validateOrganizationPayload: validateOrganizationPayload,
    validateNumberBinding: validateNumberBinding,
    validateNumberBindingList: validateNumberBindingList,
    validateAdjacentContracts: validateAdjacentContracts,
    validateAdjacentCrosswalkReceipt: validateAdjacentCrosswalkReceipt,
    validateAdjacentResolutionReceipt: validateAdjacentResolutionReceipt,
    validateAdjacentTrace: validateAdjacentTrace,
    validateQueue: validateQueue,
    validateReconciliationCase: validateReconciliationCase,
    validateResolutionReceipt: validateResolutionReceipt
  });
}));
