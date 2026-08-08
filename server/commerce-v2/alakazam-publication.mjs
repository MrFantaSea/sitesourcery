import {
  clone,
  deepFreeze,
  digest,
  invariant,
  requiredDigest,
  requiredIso,
  requiredText
} from "./canonical.mjs";

export const ALAKAZAM_PUBLICATION_SCHEMA =
  "sitesourcery.alakazam-publication/v1";
export const ALAKAZAM_PUBLICATION_COMMAND_SCHEMA =
  "sitesourcery.alakazam-publication-command/v1";
export const ALAKAZAM_PUBLICATION_HOLD_REASON =
  "commercial_cutover_not_authorized";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ACTIONS = new Set([
  "publish",
  "rollback",
  "unpublish"
]);
const SITE_STATES = new Set([
  "live",
  "dark",
  "failed"
]);
const SUBSCRIPTION_STATES = new Set([
  "active",
  "grace"
]);

function exactKeys(value, expected, field, options = {}) {
  invariant(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...expected].sort()),
    options.code ?? "invalid_input",
    `${field} is invalid`,
    { status: options.status ?? 400 }
  );
  return value;
}

function uuid(value, field, options = {}) {
  const selected = requiredText(value, field, 36);
  invariant(
    UUID.test(selected),
    options.code ?? "invalid_input",
    `${field} is invalid`,
    { status: options.status ?? 400 }
  );
  return selected;
}

function nullableUuid(value, field, options = {}) {
  return value === null ? null : uuid(value, field, options);
}

function positiveInteger(value, field, options = {}) {
  invariant(
    Number.isSafeInteger(value) && value > 0,
    options.code ?? "invalid_input",
    `${field} is invalid`,
    { status: options.status ?? 400 }
  );
  return value;
}

function repositoryOptions() {
  return {
    code: "repository_conflict",
    status: 500
  };
}

function exactScope(value) {
  exactKeys(
    value,
    ["actorId", "customerId", "projectId", "tenantId"],
    "scope"
  );
  const actorId = uuid(value.actorId, "scope.actorId");
  const customerId = uuid(
    value.customerId,
    "scope.customerId"
  );
  invariant(
    actorId === customerId,
    "project_unavailable",
    "the customer publication project is unavailable",
    { status: 404 }
  );
  return Object.freeze({
    tenantId: uuid(value.tenantId, "scope.tenantId"),
    customerId,
    actorId,
    projectId: uuid(value.projectId, "scope.projectId")
  });
}

function exactSubscription(value) {
  const options = repositoryOptions();
  exactKeys(
    value,
    ["revision", "status", "subscriptionId", "tierId"],
    "publication.subscription",
    options
  );
  const status = requiredText(
    value.status,
    "publication.subscription.status",
    20
  );
  invariant(
    SUBSCRIPTION_STATES.has(status),
    options.code,
    "publication.subscription.status is invalid",
    { status: options.status }
  );
  return Object.freeze({
    subscriptionId: uuid(
      value.subscriptionId,
      "publication.subscription.subscriptionId",
      options
    ),
    revision: positiveInteger(
      value.revision,
      "publication.subscription.revision",
      options
    ),
    tierId: requiredText(
      value.tierId,
      "publication.subscription.tierId",
      100
    ),
    status
  });
}

function exactSite(value) {
  const options = repositoryOptions();
  exactKeys(
    value,
    [
      "acceptedArtifactDigest",
      "acceptedVersionId",
      "currentReleaseId",
      "currentVersionId",
      "hostname",
      "state",
      "updatedAt"
    ],
    "publication.site",
    options
  );
  const state = requiredText(
    value.state,
    "publication.site.state",
    20
  );
  invariant(
    SITE_STATES.has(state),
    options.code,
    "publication.site.state is invalid",
    { status: options.status }
  );
  const currentReleaseId = nullableUuid(
    value.currentReleaseId,
    "publication.site.currentReleaseId",
    options
  );
  const currentVersionId = nullableUuid(
    value.currentVersionId,
    "publication.site.currentVersionId",
    options
  );
  invariant(
    (currentReleaseId === null) ===
      (currentVersionId === null) &&
      (state !== "live" || currentReleaseId !== null),
    options.code,
    "publication.site current release evidence is invalid",
    { status: options.status }
  );
  return Object.freeze({
    hostname: requiredText(
      value.hostname,
      "publication.site.hostname",
      253
    ),
    state,
    acceptedVersionId: uuid(
      value.acceptedVersionId,
      "publication.site.acceptedVersionId",
      options
    ),
    acceptedArtifactDigest: requiredDigest(
      value.acceptedArtifactDigest,
      "publication.site.acceptedArtifactDigest"
    ),
    currentReleaseId,
    currentVersionId,
    updatedAt: requiredIso(
      value.updatedAt,
      "publication.site.updatedAt"
    )
  });
}

function exactHistory(value, currentReleaseId) {
  const options = repositoryOptions();
  invariant(
    Array.isArray(value) && value.length <= 3,
    options.code,
    "publication.history is invalid",
    { status: options.status }
  );
  const releaseIds = new Set();
  const history = value.map((entry, index) => {
    exactKeys(
      entry,
      [
        "artifactDigest",
        "isCurrent",
        "releaseId",
        "releasedAt",
        "versionId"
      ],
      `publication.history[${index}]`,
      options
    );
    const releaseId = uuid(
      entry.releaseId,
      `publication.history[${index}].releaseId`,
      options
    );
    invariant(
      !releaseIds.has(releaseId) &&
        typeof entry.isCurrent === "boolean" &&
        entry.isCurrent ===
          (releaseId === currentReleaseId),
      options.code,
      `publication.history[${index}] is invalid`,
      { status: options.status }
    );
    releaseIds.add(releaseId);
    return Object.freeze({
      releaseId,
      versionId: uuid(
        entry.versionId,
        `publication.history[${index}].versionId`,
        options
      ),
      artifactDigest: requiredDigest(
        entry.artifactDigest,
        `publication.history[${index}].artifactDigest`
      ),
      releasedAt: requiredIso(
        entry.releasedAt,
        `publication.history[${index}].releasedAt`
      ),
      isCurrent: entry.isCurrent
    });
  });
  invariant(
    currentReleaseId === null ||
      history.some((entry) => entry.isCurrent),
    options.code,
    "publication.history does not contain the current release",
    { status: options.status }
  );
  return Object.freeze(history);
}

function exactStoredCommand(value) {
  if (value === null) return null;
  const options = repositoryOptions();
  exactKeys(
    value,
    [
      "action",
      "commandDigest",
      "commandId",
      "holdReason",
      "requestedAt",
      "snapshotDigest",
      "state",
      "targetReleaseId",
      "targetVersionId"
    ],
    "publication.command",
    options
  );
  const action = requiredText(
    value.action,
    "publication.command.action",
    20
  );
  invariant(
    ACTIONS.has(action) &&
      value.state === "held" &&
      value.holdReason ===
        ALAKAZAM_PUBLICATION_HOLD_REASON,
    options.code,
    "publication.command authority is invalid",
    { status: options.status }
  );
  const targetReleaseId = nullableUuid(
    value.targetReleaseId,
    "publication.command.targetReleaseId",
    options
  );
  const targetVersionId = nullableUuid(
    value.targetVersionId,
    "publication.command.targetVersionId",
    options
  );
  invariant(
    (action === "rollback") ===
      (targetReleaseId !== null) &&
      (action === "unpublish") ===
        (targetVersionId === null),
    options.code,
    "publication.command target is invalid",
    { status: options.status }
  );
  return Object.freeze({
    commandId: uuid(
      value.commandId,
      "publication.command.commandId",
      options
    ),
    action,
    state: "held",
    holdReason: ALAKAZAM_PUBLICATION_HOLD_REASON,
    snapshotDigest: requiredDigest(
      value.snapshotDigest,
      "publication.command.snapshotDigest"
    ),
    commandDigest: requiredDigest(
      value.commandDigest,
      "publication.command.commandDigest"
    ),
    targetReleaseId,
    targetVersionId,
    requestedAt: requiredIso(
      value.requestedAt,
      "publication.command.requestedAt"
    )
  });
}

export function projectAlakazamPublication(value) {
  const options = repositoryOptions();
  exactKeys(
    value,
    [
      "history",
      "lastCommand",
      "projectId",
      "site",
      "subscription"
    ],
    "publication",
    options
  );
  const projectId = uuid(
    value.projectId,
    "publication.projectId",
    options
  );
  const subscription = exactSubscription(value.subscription);
  const site = exactSite(value.site);
  const history = exactHistory(
    value.history,
    site.currentReleaseId
  );
  const rollbackTarget = history.find(
    (entry) => !entry.isCurrent
  ) ?? null;
  const actions = Object.freeze({
    publish:
      ["dark", "failed"].includes(site.state) ||
      site.currentVersionId !== site.acceptedVersionId,
    rollback:
      site.state === "live" && rollbackTarget !== null,
    unpublish:
      site.state === "live" &&
      site.currentReleaseId !== null,
    rollbackTargetReleaseId:
      site.state === "live"
        ? rollbackTarget?.releaseId ?? null
        : null
  });
  const snapshotFacts = {
    schema: ALAKAZAM_PUBLICATION_SCHEMA,
    projectId,
    state: "held",
    holdReason: ALAKAZAM_PUBLICATION_HOLD_REASON,
    subscription,
    site,
    history,
    actions
  };
  const snapshot = {
    ...snapshotFacts,
    snapshotDigest: digest(snapshotFacts)
  };
  const storedCommand = exactStoredCommand(value.lastCommand);
  const command = storedCommand?.snapshotDigest ===
    snapshot.snapshotDigest
    ? storedCommand
    : null;
  return deepFreeze({
    ...snapshot,
    command
  });
}

function exactRequest(value) {
  exactKeys(
    value,
    [
      "action",
      "commandId",
      "snapshotDigest",
      "targetReleaseId"
    ],
    "publicationCommand"
  );
  const action = requiredText(
    value.action,
    "publicationCommand.action",
    20
  );
  invariant(
    ACTIONS.has(action),
    "invalid_input",
    "publicationCommand.action is invalid"
  );
  const targetReleaseId = nullableUuid(
    value.targetReleaseId,
    "publicationCommand.targetReleaseId"
  );
  invariant(
    (action === "rollback") ===
      (targetReleaseId !== null),
    "invalid_input",
    "publicationCommand.targetReleaseId is invalid"
  );
  return Object.freeze({
    commandId: uuid(
      value.commandId,
      "publicationCommand.commandId"
    ),
    action,
    snapshotDigest: requiredDigest(
      value.snapshotDigest,
      "publicationCommand.snapshotDigest"
    ),
    targetReleaseId
  });
}

export function createAlakazamPublicationCommand({
  scope: scopeInput,
  publication: publicationInput,
  request: requestInput,
  requestedAt
}) {
  const scope = exactScope(scopeInput);
  const publication = projectAlakazamPublication(
    publicationInput
  );
  const request = exactRequest(requestInput);
  invariant(
    publication.projectId === scope.projectId &&
      publication.snapshotDigest ===
        request.snapshotDigest,
    "publication_authority_changed",
    "the Alakazam publication authority changed; refresh before trying again",
    { status: 409 }
  );
  invariant(
    publication.actions[request.action] === true,
    "publication_action_unavailable",
    "that Alakazam publication action is unavailable",
    { status: 409 }
  );
  if (request.action === "rollback") {
    invariant(
      publication.actions.rollbackTargetReleaseId ===
        request.targetReleaseId,
      "publication_authority_changed",
      "the Alakazam rollback target changed; refresh before trying again",
      { status: 409 }
    );
  }
  const target = request.action === "rollback"
    ? publication.history.find(
        (entry) =>
          entry.releaseId === request.targetReleaseId
      )
    : request.action === "publish"
      ? {
          releaseId: null,
          versionId: publication.site.acceptedVersionId
        }
      : {
          releaseId: null,
          versionId: null
        };
  invariant(
    target,
    "publication_authority_changed",
    "the Alakazam publication target changed; refresh before trying again",
    { status: 409 }
  );
  const facts = {
    schema: ALAKAZAM_PUBLICATION_COMMAND_SCHEMA,
    commandId: request.commandId,
    tenantId: scope.tenantId,
    customerId: scope.customerId,
    projectId: scope.projectId,
    subscriptionId:
      publication.subscription.subscriptionId,
    subscriptionRevision:
      publication.subscription.revision,
    action: request.action,
    snapshotDigest: publication.snapshotDigest,
    currentReleaseId:
      publication.site.currentReleaseId,
    targetReleaseId: target.releaseId,
    targetVersionId: target.versionId,
    requestedAt: requiredIso(
      requestedAt,
      "publicationCommand.requestedAt"
    ),
    state: "held",
    holdReason: ALAKAZAM_PUBLICATION_HOLD_REASON
  };
  return deepFreeze({
    ...facts,
    commandDigest: digest(facts)
  });
}

export function createAlakazamPublicationService({
  repository,
  clock = { now: () => new Date() }
} = {}) {
  invariant(
    repository &&
      typeof repository.readCustomerPublication ===
        "function" &&
      typeof repository.recordCustomerPublicationCommand ===
        "function",
    "invalid_configuration",
    "the Alakazam publication repository is incomplete",
    { status: 500 }
  );
  invariant(
    clock && typeof clock.now === "function",
    "invalid_configuration",
    "the Alakazam publication clock is required",
    { status: 500 }
  );
  return Object.freeze({
    async readiness() {
      invariant(
        typeof repository.readiness === "function",
        "invalid_configuration",
        "the Alakazam publication repository readiness is incomplete",
        { status: 500 }
      );
      return repository.readiness();
    },
    async read(scopeInput) {
      const scope = exactScope(scopeInput);
      const publication = projectAlakazamPublication(
        await repository.readCustomerPublication(scope)
      );
      invariant(
        publication.projectId === scope.projectId,
        "repository_conflict",
        "the Alakazam publication project changed",
        { status: 500 }
      );
      return publication;
    },
    async request(scopeInput, requestInput) {
      const scope = exactScope(scopeInput);
      const request = exactRequest(requestInput);
      const requestedAt = clock.now().toISOString();
      const result = await repository
        .recordCustomerPublicationCommand({
          ...scope,
          ...request,
          requestedAt
        });
      const publication = projectAlakazamPublication(
        result.publication
      );
      invariant(
        publication.snapshotDigest ===
          request.snapshotDigest,
        "publication_authority_changed",
        "the Alakazam publication authority changed; refresh before trying again",
        { status: 409 }
      );
      const command = exactStoredCommand(result.command);
      invariant(
        publication.projectId === scope.projectId &&
          command &&
          command.commandId === request.commandId &&
          command.action === request.action &&
          command.snapshotDigest ===
            request.snapshotDigest &&
          command.targetReleaseId ===
            request.targetReleaseId,
        "repository_conflict",
        "the Alakazam publication command changed",
        { status: 500 }
      );
      return deepFreeze({
        ...clone(publication),
        command
      });
    }
  });
}
