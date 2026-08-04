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
      "Sign in before viewing Alakazam billing.",
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
    "the customer billing project is unavailable",
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

export function createHeldHostedAlakazamAccount() {
  return Object.freeze({
    async getSnapshot(actor) {
      requireActor(actor);
      throw new HostedError(
        "ALAKAZAM_ACCOUNT_HELD",
        "Alakazam account information is held in this runtime.",
        { status: 503 }
      );
    }
  });
}

export function createHostedAlakazamAccount({
  account,
  resolveSession
} = {}) {
  invariant(
    account && typeof account.read === "function",
    "invalid_configuration",
    "the Alakazam account service is required",
    { status: 500 }
  );
  invariant(
    typeof resolveSession === "function",
    "invalid_configuration",
    "the Alakazam project scope resolver is required",
    { status: 500 }
  );
  return Object.freeze({
    async getSnapshot(actorInput, projectIdInput) {
      return translated(async () => {
        const actor = requireActor(actorInput);
        const projectId = requiredText(
          projectIdInput,
          "projectId",
          36
        );
        const scope = validateScope(
          await resolveSession({ actor, projectId }),
          actor,
          projectId
        );
        return account.read(scope);
      });
    }
  });
}
