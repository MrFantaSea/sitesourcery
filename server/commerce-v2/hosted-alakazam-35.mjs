import {
  CommerceV2Error,
  invariant,
  requiredText
} from "./canonical.mjs";
import { HostedError } from "../hosted/errors.mjs";

function requireActor(actor) {
  if (
    !actor ||
    typeof actor.userId !== "string" ||
    actor.userId.length === 0
  ) {
    throw new HostedError(
      "AUTHENTICATION_REQUIRED",
      "Sign in before managing Alakazam $35 controls.",
      { status: 401 }
    );
  }
  return actor;
}

function translate(error) {
  if (error instanceof HostedError) return error;
  if (error instanceof CommerceV2Error) {
    return new HostedError(
      `ALAKAZAM_${error.code.toUpperCase()}`,
      error.message,
      { status: error.status }
    );
  }
  return error;
}

async function translated(work) {
  try {
    return await work();
  } catch (error) {
    throw translate(error);
  }
}

function validateScope(value, actor, projectId) {
  invariant(
    value &&
      value.projectId === projectId &&
      value.actorId === actor.userId &&
      value.customerId === actor.userId,
    "project_unavailable",
    "the Alakazam configuration project is unavailable",
    { status: 404 }
  );
  return Object.freeze({
    tenantId: requiredText(value.tenantId, "scope.tenantId", 36),
    projectId,
    customerId: requiredText(value.customerId, "scope.customerId", 36),
    actorId: requiredText(value.actorId, "scope.actorId", 36)
  });
}

export function createHeldHostedAlakazam35() {
  async function held(actor) {
    requireActor(actor);
    throw new HostedError(
      "ALAKAZAM_35_HELD",
      "Alakazam $35 controls are held in this runtime.",
      { status: 503 }
    );
  }
  return Object.freeze({
    async readiness() {
      return Object.freeze({
        ready: false,
        authorization: false,
        providerEffects: false,
        state: "held"
      });
    },
    getSnapshot: held,
    uploadPhoto: held,
    saveConfiguration: held,
    requestCare: held
  });
}

export function createHostedAlakazam35({
  controls,
  resolveSession
} = {}) {
  invariant(
    controls &&
      [
        "configure",
        "read",
        "readiness",
        "requestCare",
        "uploadPhoto"
      ].every((method) => typeof controls[method] === "function"),
    "invalid_configuration",
    "the Alakazam $35 service is required",
    { status: 500 }
  );
  invariant(
    typeof resolveSession === "function",
    "invalid_configuration",
    "the Alakazam $35 scope resolver is required",
    { status: 500 }
  );
  async function scope(actorInput, projectIdInput) {
    const actor = requireActor(actorInput);
    const projectId = requiredText(projectIdInput, "projectId", 36);
    return validateScope(
      await resolveSession({ actor, projectId }),
      actor,
      projectId
    );
  }
  return Object.freeze({
    readiness() {
      return translated(() => controls.readiness());
    },
    async getSnapshot(actor, projectId) {
      return translated(async () =>
        controls.read(await scope(actor, projectId))
      );
    },
    async uploadPhoto(actor, projectId, input) {
      return translated(async () =>
        controls.uploadPhoto(await scope(actor, projectId), input)
      );
    },
    async saveConfiguration(actor, projectId, input) {
      return translated(async () =>
        controls.configure(await scope(actor, projectId), input)
      );
    },
    async requestCare(actor, projectId, input) {
      return translated(async () =>
        controls.requestCare(await scope(actor, projectId), input)
      );
    }
  });
}
