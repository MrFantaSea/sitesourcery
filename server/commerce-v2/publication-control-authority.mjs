import {
  deepFreeze,
  digest,
  invariant,
  requiredDigest,
  requiredIso,
  requiredText
} from "./canonical.mjs";

export const PUBLICATION_CONTROL_AUTHORITY_SCHEMA =
  "sitesourcery.publication-control-authority/v1";
export const PUBLICATION_CONTROL_COMMAND_SCHEMA =
  "sitesourcery.publication-control-command/v1";
export const PUBLICATION_CONTROL_CAPABILITY =
  "publish_accepted_project_version";
export const PUBLICATION_CONTROL_HOLD_REASON =
  "privacy_v4_and_commercial_cutover_not_authorized";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ACTIONS = new Set(["publish", "rollback", "unpublish"]);
const PROJECTION_STATES = new Set(["live", "dark", "failed"]);
const ENTITLEMENT_STATES = new Set(["active", "grace"]);

function exactKeys(value, expected, field) {
  invariant(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...expected].sort()),
    "publication_authority_invalid",
    `${field} is invalid`,
    { status: 409 }
  );
  return value;
}

function uuid(value, field) {
  const selected = requiredText(value, field, 36);
  invariant(
    UUID.test(selected),
    "publication_authority_invalid",
    `${field} is invalid`,
    { status: 409 }
  );
  return selected;
}

function nullableUuid(value, field) {
  return value === null ? null : uuid(value, field);
}

function nonnegativeInteger(value, field) {
  invariant(
    Number.isSafeInteger(value) && value >= 0,
    "publication_authority_invalid",
    `${field} is invalid`,
    { status: 409 }
  );
  return value;
}

function positiveInteger(value, field) {
  invariant(
    Number.isSafeInteger(value) && value > 0,
    "publication_authority_invalid",
    `${field} is invalid`,
    { status: 409 }
  );
  return value;
}

function exactScope(value) {
  exactKeys(
    value,
    ["actorId", "customerId", "projectId", "tenantId"],
    "scope"
  );
  const actorId = uuid(value.actorId, "scope.actorId");
  const customerId = uuid(value.customerId, "scope.customerId");
  invariant(
    actorId === customerId,
    "publication_authority_invalid",
    "the publication actor must be the entitled customer",
    { status: 409 }
  );
  return Object.freeze({
    tenantId: uuid(value.tenantId, "scope.tenantId"),
    customerId,
    actorId,
    projectId: uuid(value.projectId, "scope.projectId")
  });
}

function exactEntitlement(value, scope, requestedAt) {
  exactKeys(
    value,
    [
      "currentPeriodEndsAt",
      "graceEndsAt",
      "kind",
      "revision",
      "status",
      "subscriptionId",
      "tierId"
    ],
    "authority.entitlement"
  );
  invariant(
    value.kind === "alakazam_subscription" &&
      ENTITLEMENT_STATES.has(value.status),
    "publication_entitlement_unavailable",
    "the exact Alakazam entitlement is unavailable",
    { status: 409 }
  );
  const currentPeriodEndsAt = requiredIso(
    value.currentPeriodEndsAt,
    "authority.entitlement.currentPeriodEndsAt"
  );
  const graceEndsAt = value.graceEndsAt === null
    ? null
    : requiredIso(
        value.graceEndsAt,
        "authority.entitlement.graceEndsAt"
      );
  invariant(
    Date.parse(currentPeriodEndsAt) > Date.parse(requestedAt) &&
      (value.status !== "grace" ||
        (graceEndsAt !== null &&
          Date.parse(graceEndsAt) > Date.parse(requestedAt))),
    "publication_entitlement_unavailable",
    "the exact Alakazam paid period is unavailable",
    { status: 409 }
  );
  return Object.freeze({
    kind: "alakazam_subscription",
    subscriptionId: uuid(
      value.subscriptionId,
      "authority.entitlement.subscriptionId"
    ),
    revision: positiveInteger(
      value.revision,
      "authority.entitlement.revision"
    ),
    tierId: requiredText(
      value.tierId,
      "authority.entitlement.tierId",
      100
    ),
    status: value.status,
    currentPeriodEndsAt,
    graceEndsAt
  });
}

function exactCapabilityGrant(
  value,
  { entitlement, scope, requestedAt }
) {
  exactKeys(
    value,
    [
      "authorizedAt",
      "capability",
      "projectId",
      "schema",
      "subscriptionId",
      "tierId"
    ],
    "authority.capabilityGrant"
  );
  invariant(
    value.schema ===
      "sitesourcery.alakazam-project-entitlement.v1" &&
      value.capability === PUBLICATION_CONTROL_CAPABILITY &&
      value.subscriptionId === entitlement.subscriptionId &&
      value.projectId === scope.projectId &&
      value.tierId === entitlement.tierId &&
      value.authorizedAt === requestedAt,
    "publication_capability_unavailable",
    "the exact tier publication capability is unavailable",
    { status: 409 }
  );
  return Object.freeze({
    schema: value.schema,
    capability: value.capability,
    subscriptionId: uuid(
      value.subscriptionId,
      "authority.capabilityGrant.subscriptionId"
    ),
    projectId: uuid(
      value.projectId,
      "authority.capabilityGrant.projectId"
    ),
    tierId: requiredText(
      value.tierId,
      "authority.capabilityGrant.tierId",
      100
    ),
    authorizedAt: requiredIso(
      value.authorizedAt,
      "authority.capabilityGrant.authorizedAt"
    )
  });
}

function exactAcceptance(value) {
  exactKeys(
    value,
    [
      "acceptedAt",
      "artifactDigest",
      "artifactId",
      "eventId",
      "state",
      "versionId"
    ],
    "authority.acceptance"
  );
  invariant(
    value.state === "accepted_release",
    "publication_acceptance_unavailable",
    "the exact accepted release is unavailable",
    { status: 409 }
  );
  return Object.freeze({
    eventId: uuid(value.eventId, "authority.acceptance.eventId"),
    versionId: uuid(value.versionId, "authority.acceptance.versionId"),
    artifactId: uuid(value.artifactId, "authority.acceptance.artifactId"),
    artifactDigest: requiredDigest(
      value.artifactDigest,
      "authority.acceptance.artifactDigest"
    ),
    state: "accepted_release",
    acceptedAt: requiredIso(
      value.acceptedAt,
      "authority.acceptance.acceptedAt"
    )
  });
}

function exactScreening(value, acceptance) {
  exactKeys(
    value,
    [
      "artifactDigest",
      "checkedAt",
      "checkerRevision",
      "id",
      "method",
      "passed",
      "stage",
      "versionId"
    ],
    "authority.screening"
  );
  invariant(
    value.stage === "pre_publication" &&
      value.passed === true &&
      value.versionId === acceptance.versionId,
    "publication_screening_unavailable",
    "the exact successful pre-publication screening is unavailable",
    { status: 409 }
  );
  return Object.freeze({
    id: uuid(value.id, "authority.screening.id"),
    versionId: uuid(value.versionId, "authority.screening.versionId"),
    stage: "pre_publication",
    method: requiredText(
      value.method,
      "authority.screening.method",
      200
    ),
    passed: true,
    artifactDigest: requiredDigest(
      value.artifactDigest,
      "authority.screening.artifactDigest"
    ),
    checkerRevision: requiredText(
      value.checkerRevision,
      "authority.screening.checkerRevision",
      500
    ),
    checkedAt: requiredIso(
      value.checkedAt,
      "authority.screening.checkedAt"
    )
  });
}

function exactAddress(value) {
  exactKeys(
    value,
    ["hostname", "id", "kind", "ownership", "state"],
    "authority.address"
  );
  invariant(
    value.kind === "licensed" &&
      value.ownership === "licensed" &&
      value.state === "configured",
    "publication_address_unavailable",
    "the exact licensed platform address is unavailable",
    { status: 409 }
  );
  return Object.freeze({
    id: uuid(value.id, "authority.address.id"),
    kind: "licensed",
    ownership: "licensed",
    state: "configured",
    hostname: requiredText(
      value.hostname,
      "authority.address.hostname",
      253
    )
  });
}

function exactOperation(value, field) {
  exactKeys(
    value,
    [
      "capability",
      "decisionDigest",
      "effectiveTierId",
      "id",
      "intentId",
      "operationKind",
      "policyDigest",
      "resultReleaseId",
      "servingRevision",
      "state",
      "subscriptionId",
      "subscriptionRevision"
    ],
    field
  );
  invariant(
    value.state === "published" &&
      value.capability === PUBLICATION_CONTROL_CAPABILITY,
    "publication_fulfillment_unavailable",
    "the exact fulfilled publication authority is unavailable",
    { status: 409 }
  );
  return Object.freeze({
    id: uuid(value.id, `${field}.id`),
    intentId: uuid(value.intentId, `${field}.intentId`),
    subscriptionId: uuid(
      value.subscriptionId,
      `${field}.subscriptionId`
    ),
    subscriptionRevision: positiveInteger(
      value.subscriptionRevision,
      `${field}.subscriptionRevision`
    ),
    operationKind: requiredText(
      value.operationKind,
      `${field}.operationKind`,
      100
    ),
    capability: value.capability,
    effectiveTierId: requiredText(
      value.effectiveTierId,
      `${field}.effectiveTierId`,
      100
    ),
    policyDigest: requiredDigest(
      value.policyDigest,
      `${field}.policyDigest`
    ),
    state: "published",
    servingRevision: nonnegativeInteger(
      value.servingRevision,
      `${field}.servingRevision`
    ),
    resultReleaseId: uuid(
      value.resultReleaseId,
      `${field}.resultReleaseId`
    ),
    decisionDigest: requiredDigest(
      value.decisionDigest,
      `${field}.decisionDigest`
    )
  });
}

function exactProjection(value) {
  exactKeys(
    value,
    ["currentReleaseId", "currentVersionId", "state"],
    "authority.projection"
  );
  invariant(
    PROJECTION_STATES.has(value.state),
    "publication_authority_invalid",
    "the publication projection is invalid",
    { status: 409 }
  );
  const currentReleaseId = nullableUuid(
    value.currentReleaseId,
    "authority.projection.currentReleaseId"
  );
  const currentVersionId = nullableUuid(
    value.currentVersionId,
    "authority.projection.currentVersionId"
  );
  invariant(
    (currentReleaseId === null) === (currentVersionId === null) &&
      (value.state !== "live" || currentReleaseId !== null),
    "publication_authority_invalid",
    "the current publication projection is incomplete",
    { status: 409 }
  );
  return Object.freeze({
    state: value.state,
    currentReleaseId,
    currentVersionId
  });
}

function exactAuthority(value, scope, requestedAt) {
  exactKeys(
    value,
    [
      "acceptance",
      "address",
      "authorityKind",
      "authorityOperation",
      "capabilityGrant",
      "entitlement",
      "projection",
      "screening",
      "targetOperation"
    ],
    "authority"
  );
  invariant(
    value.authorityKind === "alakazam",
    "publication_authority_invalid",
    "the publication authority kind is unavailable",
    { status: 409 }
  );
  const entitlement = exactEntitlement(
    value.entitlement,
    scope,
    requestedAt
  );
  const capabilityGrant = exactCapabilityGrant(
    value.capabilityGrant,
    { entitlement, scope, requestedAt }
  );
  const acceptance = exactAcceptance(value.acceptance);
  const screening = exactScreening(value.screening, acceptance);
  const address = exactAddress(value.address);
  const authorityOperation = exactOperation(
    value.authorityOperation,
    "authority.authorityOperation"
  );
  const targetOperation = exactOperation(
    value.targetOperation,
    "authority.targetOperation"
  );
  const projection = exactProjection(value.projection);
  invariant(
    authorityOperation.subscriptionId === entitlement.subscriptionId &&
      authorityOperation.subscriptionRevision === entitlement.revision &&
      authorityOperation.effectiveTierId === entitlement.tierId &&
      authorityOperation.capability === capabilityGrant.capability &&
      targetOperation.subscriptionId === entitlement.subscriptionId &&
      targetOperation.capability === capabilityGrant.capability,
    "publication_authority_invalid",
    "the exact entitlement and fulfillment authority do not match",
    { status: 409 }
  );
  return Object.freeze({
    authorityKind: "alakazam",
    entitlement,
    capabilityGrant,
    acceptance,
    screening,
    address,
    authorityOperation,
    targetOperation,
    projection
  });
}

export function createHeldPublicationControlCommand({
  scope: scopeInput,
  commandId,
  action: actionInput,
  snapshotDigest,
  targetReleaseId: targetReleaseIdInput,
  authority: authorityInput,
  requestedAt: requestedAtInput
}) {
  const scope = exactScope(scopeInput);
  const requestedAt = requiredIso(requestedAtInput, "requestedAt");
  const action = requiredText(actionInput, "action", 20);
  invariant(
    ACTIONS.has(action),
    "publication_action_unavailable",
    "the publication action is unavailable",
    { status: 409 }
  );
  const selectedCommandId = uuid(commandId, "commandId");
  const selectedSnapshotDigest = requiredDigest(
    snapshotDigest,
    "snapshotDigest"
  );
  const targetReleaseId = nullableUuid(
    targetReleaseIdInput,
    "targetReleaseId"
  );
  const authority = exactAuthority(
    authorityInput,
    scope,
    requestedAt
  );
  const expectedTargetReleaseId = action === "rollback"
    ? authority.targetOperation.resultReleaseId
    : null;
  invariant(
    targetReleaseId === expectedTargetReleaseId &&
      ((action === "publish" &&
        ["dark", "failed"].includes(authority.projection.state) &&
        authority.targetOperation.id ===
          authority.authorityOperation.id) ||
        (action === "rollback" &&
          authority.projection.state === "live" &&
          targetReleaseId !== authority.projection.currentReleaseId) ||
        (action === "unpublish" &&
          authority.projection.state === "live" &&
          authority.targetOperation.id ===
            authority.authorityOperation.id &&
          authority.authorityOperation.resultReleaseId ===
            authority.projection.currentReleaseId)),
    "publication_action_unavailable",
    "the publication action lacks exact target authority",
    { status: 409 }
  );
  const facts = {
    schema: PUBLICATION_CONTROL_COMMAND_SCHEMA,
    commandId: selectedCommandId,
    tenantId: scope.tenantId,
    projectId: scope.projectId,
    customerId: scope.customerId,
    actorId: scope.actorId,
    action,
    snapshotDigest: selectedSnapshotDigest,
    targetReleaseId,
    authority: {
      schema: PUBLICATION_CONTROL_AUTHORITY_SCHEMA,
      ...authority
    },
    state: "held",
    holdReason: PUBLICATION_CONTROL_HOLD_REASON,
    requestedAt
  };
  return deepFreeze({
    ...facts,
    authorityDigest: digest(facts.authority),
    commandDigest: digest(facts)
  });
}
