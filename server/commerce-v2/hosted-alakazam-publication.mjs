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
      "Sign in before managing Alakazam publication.",
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
    "the customer publication project is unavailable",
    { status: 404 }
  );
  return Object.freeze({
    tenantId: requiredText(
      value.tenantId,
      "scope.tenantId",
      36
    ),
    customerId: requiredText(
      value.customerId,
      "scope.customerId",
      36
    ),
    actorId: requiredText(
      value.actorId,
      "scope.actorId",
      36
    ),
    projectId
  });
}

export function createHeldHostedAlakazamPublication() {
  return Object.freeze({
    async readiness() {
      return Object.freeze({
        ready: false,
        authorization: false,
        providerEffects: false,
        state: "held"
      });
    },
    async getSnapshot(actor) {
      requireActor(actor);
      throw new HostedError(
        "ALAKAZAM_PUBLICATION_HELD",
        "Alakazam publication controls are held in this runtime.",
        { status: 503 }
      );
    },
    async requestCommand(actor) {
      requireActor(actor);
      throw new HostedError(
        "ALAKAZAM_PUBLICATION_HELD",
        "Alakazam publication controls are held in this runtime.",
        { status: 503 }
      );
    }
  });
}

export function createHostedAlakazamPublication({
  publication,
  resolveSession
} = {}) {
  invariant(
    publication &&
      typeof publication.readiness === "function" &&
      typeof publication.read === "function" &&
      typeof publication.request === "function",
    "invalid_configuration",
    "the Alakazam publication service is required",
    { status: 500 }
  );
  invariant(
    typeof resolveSession === "function",
    "invalid_configuration",
    "the Alakazam publication scope resolver is required",
    { status: 500 }
  );
  async function scope(actorInput, projectIdInput) {
    const actor = requireActor(actorInput);
    const projectId = requiredText(
      projectIdInput,
      "projectId",
      36
    );
    return validateScope(
      await resolveSession({ actor, projectId }),
      actor,
      projectId
    );
  }
  return Object.freeze({
    async readiness() {
      return translated(() => publication.readiness());
    },
    async getSnapshot(actorInput, projectIdInput) {
      return translated(async () =>
        publication.read(
          await scope(actorInput, projectIdInput)
        )
      );
    },
    async requestCommand(
      actorInput,
      projectIdInput,
      command
    ) {
      return translated(async () =>
        publication.request(
          await scope(actorInput, projectIdInput),
          command
        )
      );
    }
  });
}
