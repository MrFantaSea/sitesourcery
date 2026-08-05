import { HostedError, invariant } from "./errors.mjs";
import { projectCustomServicesAccount } from "./custom-services-account.mjs";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function requireActor(value) {
  if (!value || typeof value.userId !== "string" || !UUID.test(value.userId)) {
    throw new HostedError(
      "AUTHENTICATION_REQUIRED",
      "Sign in before viewing custom services.",
      { status: 401 }
    );
  }
  return value;
}

function requireProjectId(value) {
  invariant(
    typeof value === "string" && UUID.test(value),
    "INVALID_PROJECT_ID",
    "The selected project is invalid.",
    { status: 400 }
  );
  return value;
}

function exactScope(value, actor, projectId) {
  invariant(
    value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify(
          ["actorId", "customerId", "projectId", "tenantId"].sort()
        ) &&
      value.actorId === actor.userId &&
      value.customerId === actor.userId &&
      value.projectId === projectId &&
      typeof value.tenantId === "string" &&
      UUID.test(value.tenantId),
    "project_unavailable",
    "the customer service project is unavailable",
    { status: 404 }
  );
  return Object.freeze({
    actorId: actor.userId,
    customerId: actor.userId,
    organizationId: value.tenantId,
    projectId
  });
}

export function createHeldHostedCustomServicesAccount() {
  return Object.freeze({
    async getSnapshot(actor) {
      requireActor(actor);
      throw new HostedError(
        "CUSTOM_SERVICES_ACCOUNT_HELD",
        "Custom-services account information is held in this runtime.",
        { status: 503 }
      );
    }
  });
}

export function createHostedCustomServicesAccount({
  repository,
  resolveSession
} = {}) {
  invariant(
    repository &&
      typeof repository.readFoundationSnapshot === "function",
    "invalid_configuration",
    "the custom-services account repository is required",
    { status: 500 }
  );
  invariant(
    typeof resolveSession === "function",
    "invalid_configuration",
    "the custom-services project scope resolver is required",
    { status: 500 }
  );

  return Object.freeze({
    async getSnapshot(actorInput, projectIdInput) {
      const actor = requireActor(actorInput);
      const projectId = requireProjectId(projectIdInput);
      const scope = exactScope(
        await resolveSession({ actor, projectId }),
        actor,
        projectId
      );
      const snapshot = await repository.readFoundationSnapshot(scope);
      return projectCustomServicesAccount({ scope, snapshot });
    }
  });
}
