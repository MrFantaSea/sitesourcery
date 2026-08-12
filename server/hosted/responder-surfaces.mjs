import { deepFreeze } from "../commerce-v2/canonical.mjs";
import { invariant } from "./errors.mjs";
import { canonicalJson } from "./security.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u;

function exactObject(value, keys, field) {
  invariant(
    value !== null && typeof value === "object" && !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      canonicalJson(Object.keys(value).sort()) ===
        canonicalJson([...keys].sort()),
    "RESPONDER_SURFACE_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function uuid(value, field) {
  invariant(
    typeof value === "string" && UUID.test(value),
    "RESPONDER_SURFACE_INVALID",
    `${field} is invalid.`,
    { status: 400 }
  );
  return value;
}

function sha256(value, field) {
  invariant(
    typeof value === "string" && SHA256.test(value),
    "RESPONDER_SURFACE_INVALID",
    `${field} must be an opaque lowercase digest.`,
    { status: 400 }
  );
  return value;
}

function commandId(value) {
  invariant(
    typeof value === "string" && SAFE_ID.test(value),
    "RESPONDER_SURFACE_INVALID",
    "The Responder idempotency key is invalid.",
    { status: 400 }
  );
  return value;
}

function actor(value, kind, organizationId = null) {
  invariant(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "AUTHENTICATION_REQUIRED",
    "Sign in to continue.",
    { status: 401 }
  );
  return deepFreeze({
    kind,
    userId: uuid(value.userId, "Authenticated user ID"),
    organizationId: uuid(
      organizationId ?? value.organizationId,
      "Authenticated organization ID"
    )
  });
}

function context(value, field) {
  exactObject(value, ["body", "commandId", "organizationId"], field);
  return {
    body: exactObject(
      value.body,
      Object.keys(value.body ?? {}),
      `${field} body`
    ),
    commandId: commandId(value.commandId),
    organizationId: uuid(value.organizationId, "Responder organization ID")
  };
}

function validate(core, repository) {
  invariant(
    core && [
      "engageGlobalKill", "readiness", "recordConsent", "recordStop",
      "requestHandoff", "reserveHeldMessage"
    ].every((method) => typeof core[method] === "function") &&
      core.providerEffects === false && core.sellable === false &&
      repository && ["readCustomer", "readOperator", "readiness"]
        .every((method) => typeof repository[method] === "function"),
    "RESPONDER_SURFACE_CONFIGURATION_REQUIRED",
    "The held Responder core and projection repository are required.",
    { status: 500 }
  );
}

export function createResponderSurfacesService({ core, repository } = {}) {
  validate(core, repository);

  function selected(value, authenticated, kind) {
    const command = context(value, "Responder command");
    return {
      ...command,
      actor: actor(authenticated, kind, command.organizationId)
    };
  }

  return Object.freeze({
    kind: "responder-surfaces",
    mode: "held",
    providerEffects: false,
    billingEffects: false,
    sellable: false,
    async readiness() {
      const [coreState, projectionState] = await Promise.all([
        core.readiness(),
        repository.readiness()
      ]);
      const ready = coreState?.ready === true &&
        coreState?.verified === true &&
        projectionState?.ready === true &&
        projectionState?.verified === true;
      return deepFreeze({
        schema: "sitesourcery.responder-surface-readiness/v1",
        ready,
        verified: ready,
        mode: "held",
        providerEffects: false,
        billingEffects: false,
        sellable: false
      });
    },
    readCustomer(authenticated) {
      const selectedActor = actor(authenticated, "customer");
      return repository.readCustomer({
        userId: selectedActor.userId,
        organizationId: selectedActor.organizationId
      });
    },
    readOperator(authenticated, organizationId) {
      const selectedActor = actor(authenticated, "operator", organizationId);
      return repository.readOperator({
        userId: selectedActor.userId,
        organizationId: selectedActor.organizationId
      });
    },
    recordCustomerConsent(authenticated, value) {
      const command = selected(value, authenticated, "customer");
      exactObject(command.body, [
        "consentBasis", "consentEvidenceDigest", "consentedAt",
        "projectId", "routeDigest"
      ], "Responder customer consent");
      return core.recordConsent(command.actor, {
        commandId: command.commandId,
        organizationId: command.organizationId,
        customerUserId: command.actor.userId,
        projectId: uuid(command.body.projectId, "Responder project ID"),
        routeDigest: sha256(command.body.routeDigest, "Contact route digest"),
        consentBasis: command.body.consentBasis,
        consentEvidenceDigest: sha256(
          command.body.consentEvidenceDigest,
          "Consent evidence digest"
        ),
        consentedAt: command.body.consentedAt
      });
    },
    recordOperatorConsent(authenticated, value) {
      const command = selected(value, authenticated, "operator");
      exactObject(command.body, [
        "consentBasis", "consentEvidenceDigest", "consentedAt",
        "customerUserId", "projectId", "routeDigest"
      ], "Responder operator consent");
      return core.recordConsent(command.actor, {
        commandId: command.commandId,
        organizationId: command.organizationId,
        customerUserId: uuid(
          command.body.customerUserId,
          "Responder customer ID"
        ),
        projectId: uuid(command.body.projectId, "Responder project ID"),
        routeDigest: sha256(command.body.routeDigest, "Contact route digest"),
        consentBasis: command.body.consentBasis,
        consentEvidenceDigest: sha256(
          command.body.consentEvidenceDigest,
          "Consent evidence digest"
        ),
        consentedAt: command.body.consentedAt
      });
    },
    stop(authenticated, kind, contactAuthorityId, value) {
      const command = selected(value, authenticated, kind);
      exactObject(command.body, [
        "occurredAt", "payloadDigest", "projectId",
        "providerEventIdDigest", "routeDigest"
      ], "Responder STOP command");
      return core.recordStop(command.actor, {
        commandId: command.commandId,
        organizationId: command.organizationId,
        projectId: uuid(command.body.projectId, "Responder project ID"),
        contactAuthorityId: uuid(
          contactAuthorityId,
          "Contact authority ID"
        ),
        providerEventIdDigest: sha256(
          command.body.providerEventIdDigest,
          "STOP event ID digest"
        ),
        routeDigest: sha256(command.body.routeDigest, "Contact route digest"),
        payloadDigest: sha256(command.body.payloadDigest, "STOP payload digest"),
        occurredAt: command.body.occurredAt
      });
    },
    requestHandoff(authenticated, kind, interactionId, value) {
      const command = selected(value, authenticated, kind);
      exactObject(command.body, [
        "evidenceDigest", "expectedRevision", "projectId", "reason"
      ], "Responder handoff command");
      return core.requestHandoff(command.actor, {
        commandId: command.commandId,
        organizationId: command.organizationId,
        projectId: uuid(command.body.projectId, "Responder project ID"),
        interactionId: uuid(interactionId, "Responder interaction ID"),
        expectedRevision: command.body.expectedRevision,
        reason: command.body.reason,
        evidenceDigest: sha256(
          command.body.evidenceDigest,
          "Handoff evidence digest"
        )
      });
    },
    reserveHeldMessage(authenticated, kind, interactionId, value) {
      const command = selected(value, authenticated, kind);
      exactObject(command.body, [
        "contactAuthorityId", "contentDigest", "messageKind", "projectId"
      ], "Responder held message");
      return core.reserveHeldMessage(command.actor, {
        commandId: command.commandId,
        organizationId: command.organizationId,
        projectId: uuid(command.body.projectId, "Responder project ID"),
        interactionId: uuid(interactionId, "Responder interaction ID"),
        contactAuthorityId: uuid(
          command.body.contactAuthorityId,
          "Contact authority ID"
        ),
        messageKind: command.body.messageKind,
        contentDigest: sha256(command.body.contentDigest, "Content digest")
      });
    },
    engageGlobalKill(authenticated, value) {
      const command = selected(value, authenticated, "operator");
      exactObject(command.body, ["evidenceDigest"], "Responder kill command");
      return core.engageGlobalKill(command.actor, {
        commandId: command.commandId,
        organizationId: command.organizationId,
        evidenceDigest: sha256(
          command.body.evidenceDigest,
          "Kill evidence digest"
        )
      });
    }
  });
}
