import {
  ALAKAZAM_CARE_LIFECYCLE_POLICY,
  ALAKAZAM_CARE_LIFECYCLE_POLICY_ID
} from "./alakazam-care-lifecycle-policy.mjs";
import {
  verifyAlakazam50Configuration
} from "./alakazam-50.mjs";
import {
  canonicalJson,
  clone,
  deepFreeze,
  digest,
  invariant,
  requiredDigest,
  requiredIso,
  requiredText
} from "./canonical.mjs";

export const ALAKAZAM_RETAINED_PREMIUM_SNAPSHOT_SCHEMA =
  "sitesourcery.alakazam-retained-premium-snapshot/v1";
export const ALAKAZAM_RETAINED_PREMIUM_EXPORT_SCHEMA =
  "sitesourcery.alakazam-retained-premium-export/v1";
export const ALAKAZAM_RETAINED_PREMIUM_RESTORATION_SCHEMA =
  "sitesourcery.alakazam-retained-premium-restoration/v1";
export const ALAKAZAM_RETAINED_PREMIUM_HOLD_REASON =
  "commercial_cutover_not_authorized";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const LIFECYCLE_STATES = new Set([
  "active",
  "scheduled_to_cancel_active",
  "payment_grace",
  "retained_exit",
  "purged"
]);
const TIERS = new Set([
  "alakazam_25",
  "alakazam_35",
  "alakazam_50"
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
    options.status ? { status: options.status } : undefined
  );
  return value;
}

function uuid(value, field) {
  const selected = requiredText(value, field, 36);
  invariant(UUID.test(selected), "invalid_input", `${field} is invalid`);
  return selected;
}

function positiveInteger(value, field) {
  invariant(
    Number.isSafeInteger(value) && value > 0,
    "invalid_input",
    `${field} is invalid`
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
    "project_unavailable",
    "the retained Alakazam premium project is unavailable",
    { status: 404 }
  );
  return Object.freeze({
    tenantId: uuid(value.tenantId, "scope.tenantId"),
    projectId: uuid(value.projectId, "scope.projectId"),
    customerId,
    actorId
  });
}

function optionalIso(value, field) {
  return value === null ? null : requiredIso(value, field);
}

export function exactAlakazamRetainedPremiumAuthority(value) {
  exactKeys(
    value,
    [
      "cancelAtPeriodEnd",
      "firstFailedAt",
      "graceEndsAt",
      "lifecycleState",
      "providerFactsDigest",
      "providerObservedAt",
      "retentionEndsAt",
      "revision",
      "status",
      "subscriptionId",
      "tierId"
    ],
    "authority",
    { code: "repository_conflict", status: 500 }
  );
  const lifecycleState = requiredText(
    value.lifecycleState,
    "authority.lifecycleState",
    40
  );
  const tierId = requiredText(value.tierId, "authority.tierId", 40);
  const status = requiredText(value.status, "authority.status", 20);
  invariant(
    LIFECYCLE_STATES.has(lifecycleState) &&
      TIERS.has(tierId) &&
      typeof value.cancelAtPeriodEnd === "boolean",
    "repository_conflict",
    "the retained Alakazam premium authority is invalid",
    { status: 500 }
  );
  const authority = {
    subscriptionId: uuid(
      value.subscriptionId,
      "authority.subscriptionId"
    ),
    revision: positiveInteger(value.revision, "authority.revision"),
    tierId,
    status,
    cancelAtPeriodEnd: value.cancelAtPeriodEnd,
    providerFactsDigest: requiredDigest(
      value.providerFactsDigest,
      "authority.providerFactsDigest"
    ),
    providerObservedAt: requiredIso(
      value.providerObservedAt,
      "authority.providerObservedAt"
    ),
    firstFailedAt: optionalIso(
      value.firstFailedAt,
      "authority.firstFailedAt"
    ),
    graceEndsAt: optionalIso(value.graceEndsAt, "authority.graceEndsAt"),
    retentionEndsAt: optionalIso(
      value.retentionEndsAt,
      "authority.retentionEndsAt"
    ),
    lifecycleState
  };
  const isActive = status === "active";
  invariant(
    (
      lifecycleState === "active" &&
      isActive &&
      value.cancelAtPeriodEnd === false
    ) || (
      lifecycleState === "scheduled_to_cancel_active" &&
      isActive &&
      value.cancelAtPeriodEnd === true
    ) || (
      lifecycleState === "payment_grace" &&
      status === "grace" &&
      authority.firstFailedAt !== null &&
      authority.graceEndsAt !== null &&
      authority.retentionEndsAt === authority.graceEndsAt
    ) || (
      lifecycleState === "retained_exit" &&
      ["suspended", "cancelled", "ended"].includes(status) &&
      authority.retentionEndsAt !== null
    ) || lifecycleState === "purged",
    "repository_conflict",
    "the retained Alakazam premium lifecycle state is inconsistent",
    { status: 500 }
  );
  return deepFreeze(authority);
}

function configurationProjection(value) {
  const configuration = verifyAlakazam50Configuration(value);
  return deepFreeze({
    configurationRevision: configuration.configurationRevision,
    configurationDigest: configuration.configurationDigest,
    cashAppHandle: configuration.cashAppHandle,
    venmoHandle: configuration.venmoHandle,
    fontChoiceId: configuration.fontChoiceId,
    borderChoiceId: configuration.borderChoiceId,
    menu: clone(configuration.menu),
    configuredAt: configuration.configuredAt
  });
}

function accessFor(authority) {
  const policy = ALAKAZAM_CARE_LIFECYCLE_POLICY.lifecycle;
  if (["active", "scheduled_to_cancel_active"].includes(
    authority.lifecycleState
  )) {
    return policy.activeAccess;
  }
  if (authority.lifecycleState === "payment_grace") {
    return policy.paymentGraceAccess;
  }
  if (authority.lifecycleState === "retained_exit") {
    return policy.retainedExitAccess;
  }
  return Object.freeze({
    privateRead: false,
    customerExport: false,
    edit: false,
    publish: false,
    care: false
  });
}

function exactRestorationReadiness(value) {
  exactKeys(
    value,
    ["downgradeEventId", "ready", "upgradeEventId"],
    "restorationReadiness",
    { code: "repository_conflict", status: 500 }
  );
  invariant(
    typeof value.ready === "boolean" &&
      (
        value.ready
          ? UUID.test(value.downgradeEventId) &&
            UUID.test(value.upgradeEventId)
          : value.downgradeEventId === null &&
            value.upgradeEventId === null
      ),
    "repository_conflict",
    "the retained Alakazam premium restoration readiness is invalid",
    { status: 500 }
  );
  return Object.freeze({
    ready: value.ready,
    downgradeEventId: value.downgradeEventId,
    upgradeEventId: value.upgradeEventId
  });
}

export function createAlakazamRetainedPremiumSnapshot({
  scope,
  authority,
  configuration,
  restorationReadiness
}) {
  const selectedScope = exactScope(scope);
  const selectedAuthority = exactAlakazamRetainedPremiumAuthority(authority);
  const selectedConfiguration = configuration === null
    ? null
    : verifyAlakazam50Configuration(configuration);
  const readiness = exactRestorationReadiness(restorationReadiness);
  invariant(
    selectedConfiguration === null ||
      (
        selectedConfiguration.projectId === selectedScope.projectId &&
        selectedConfiguration.subscriptionId ===
          selectedAuthority.subscriptionId
      ),
    "repository_conflict",
    "retained Alakazam premium configuration crossed subscription authority",
    { status: 500 }
  );
  const access = accessFor(selectedAuthority);
  const activeAuthority = [
    "active",
    "scheduled_to_cancel_active"
  ].includes(selectedAuthority.lifecycleState);
  const currentBinding = selectedConfiguration !== null &&
    selectedConfiguration.subscriptionId ===
      selectedAuthority.subscriptionId &&
    selectedConfiguration.subscriptionRevision ===
      selectedAuthority.revision;
  const lowerTier = selectedAuthority.tierId !== "alakazam_50";
  const entitledPrivateValues = selectedConfiguration !== null &&
    access.privateRead &&
    (!lowerTier || selectedAuthority.lifecycleState === "retained_exit");
  const restoreRequired = selectedConfiguration !== null &&
    activeAuthority &&
    selectedAuthority.tierId === "alakazam_50" &&
    !currentBinding;
  invariant(
    !readiness.ready || restoreRequired,
    "repository_conflict",
    "retained Alakazam premium restoration evidence is out of scope",
    { status: 500 }
  );
  return deepFreeze({
    schema: ALAKAZAM_RETAINED_PREMIUM_SNAPSHOT_SCHEMA,
    policyId: ALAKAZAM_CARE_LIFECYCLE_POLICY_ID,
    state: "held",
    providerEffects: false,
    holdReason: ALAKAZAM_RETAINED_PREMIUM_HOLD_REASON,
    projectId: selectedScope.projectId,
    lifecycle: {
      state: selectedAuthority.lifecycleState,
      retentionEndsAt: selectedAuthority.retentionEndsAt,
      privateRead: access.privateRead,
      customerExport: access.customerExport,
      edit: access.edit,
      publish: access.publish,
      care: access.care
    },
    subscription: {
      tierId: selectedAuthority.tierId,
      status: selectedAuthority.status,
      revision: selectedAuthority.revision,
      cancelAtPeriodEnd: selectedAuthority.cancelAtPeriodEnd
    },
    premium: {
      configured: selectedConfiguration !== null,
      configurationRevision:
        selectedConfiguration?.configurationRevision ?? null,
      configurationDigest:
        selectedConfiguration?.configurationDigest ?? null,
      effectiveOutput:
        currentBinding && activeAuthority && !lowerTier
          ? "available"
          : "masked",
      values: entitledPrivateValues
        ? configurationProjection(selectedConfiguration)
        : null
    },
    restoration: {
      required: restoreRequired,
      available: restoreRequired && readiness.ready,
      sourceConfigurationRevision:
        restoreRequired
          ? selectedConfiguration.configurationRevision
          : null,
      sourceConfigurationDigest:
        restoreRequired
          ? selectedConfiguration.configurationDigest
          : null
    },
    actions: {
      edit:
        activeAuthority &&
        selectedAuthority.tierId === "alakazam_50" &&
        currentBinding,
      restore: restoreRequired && readiness.ready,
      export:
        selectedConfiguration !== null && access.customerExport,
      publish: activeAuthority && access.publish,
      care: activeAuthority && access.care
    }
  });
}

export function createAlakazamRetainedPremiumExport({
  scope,
  authority,
  configuration,
  exportedAt
}) {
  const selectedScope = exactScope(scope);
  const selectedAuthority = exactAlakazamRetainedPremiumAuthority(authority);
  const access = accessFor(selectedAuthority);
  invariant(
    access.customerExport,
    "alakazam_premium_export_unavailable",
    "retained Alakazam premium export is unavailable",
    { status: 409 }
  );
  const selectedConfiguration = verifyAlakazam50Configuration(configuration);
  invariant(
    selectedConfiguration.projectId === selectedScope.projectId &&
      selectedConfiguration.subscriptionId ===
        selectedAuthority.subscriptionId,
    "repository_conflict",
    "retained Alakazam premium export crossed subscription authority",
    { status: 500 }
  );
  const payload = {
    schema: ALAKAZAM_RETAINED_PREMIUM_EXPORT_SCHEMA,
    policyId: ALAKAZAM_CARE_LIFECYCLE_POLICY_ID,
    projectId: selectedScope.projectId,
    exportedAt: requiredIso(exportedAt, "exportedAt"),
    configuration: clone(configurationProjection(selectedConfiguration)),
    state: "held",
    providerEffects: false
  };
  const exportDigest = digest(payload);
  const byteCount = Buffer.byteLength(canonicalJson(payload), "utf8");
  invariant(
    byteCount > 0 && byteCount <= 32768,
    "repository_conflict",
    "retained Alakazam premium export exceeded its bound",
    { status: 500 }
  );
  return deepFreeze({ ...payload, exportDigest, byteCount });
}

function exactTierEvent(value, field, eventKind) {
  exactKeys(
    value,
    [
      "eventId",
      "eventKind",
      "factsDigest",
      "priorTierId",
      "resultSubscriptionRevision",
      "resultTierId"
    ],
    field,
    { code: "repository_conflict", status: 500 }
  );
  invariant(
    value.eventKind === eventKind &&
      UUID.test(value.eventId) &&
      TIERS.has(value.priorTierId) &&
      TIERS.has(value.resultTierId),
    "repository_conflict",
    `${field} is invalid`,
    { status: 500 }
  );
  return Object.freeze({
    eventId: value.eventId,
    eventKind,
    priorTierId: value.priorTierId,
    resultTierId: value.resultTierId,
    resultSubscriptionRevision: positiveInteger(
      value.resultSubscriptionRevision,
      `${field}.resultSubscriptionRevision`
    ),
    factsDigest: requiredDigest(value.factsDigest, `${field}.factsDigest`)
  });
}

export function createAlakazamRetainedPremiumRestoration({
  scope,
  restorationId,
  authority,
  sourceConfiguration,
  restoredConfiguration,
  downgradeEvent,
  upgradeEvent,
  restoredAt
}) {
  const selectedScope = exactScope(scope);
  const selectedRestorationId = uuid(restorationId, "restorationId");
  const selectedAuthority = exactAlakazamRetainedPremiumAuthority(authority);
  const source = verifyAlakazam50Configuration(sourceConfiguration);
  const restored = verifyAlakazam50Configuration(restoredConfiguration);
  const downgrade = exactTierEvent(
    downgradeEvent,
    "downgradeEvent",
    "downgrade_applied"
  );
  const upgrade = exactTierEvent(
    upgradeEvent,
    "upgradeEvent",
    "upgrade_applied"
  );
  invariant(
    ["active", "scheduled_to_cancel_active"].includes(
      selectedAuthority.lifecycleState
    ) &&
      selectedAuthority.tierId === "alakazam_50" &&
      selectedRestorationId === restored.commandId &&
      source.projectId === selectedScope.projectId &&
      restored.projectId === selectedScope.projectId &&
      source.subscriptionId === selectedAuthority.subscriptionId &&
      restored.subscriptionId === selectedAuthority.subscriptionId &&
      source.subscriptionRevision < downgrade.resultSubscriptionRevision &&
      downgrade.resultSubscriptionRevision <
        upgrade.resultSubscriptionRevision &&
      upgrade.resultSubscriptionRevision === selectedAuthority.revision &&
      downgrade.priorTierId === "alakazam_50" &&
      downgrade.resultTierId !== "alakazam_50" &&
      upgrade.priorTierId === downgrade.resultTierId &&
      upgrade.resultTierId === "alakazam_50" &&
      restored.subscriptionRevision === selectedAuthority.revision &&
      restored.configurationRevision ===
        source.configurationRevision + 1 &&
      Date.parse(restoredAt) >=
        Date.parse(selectedAuthority.providerObservedAt) &&
      restored.cashAppHandle === source.cashAppHandle &&
      restored.venmoHandle === source.venmoHandle &&
      restored.fontChoiceId === source.fontChoiceId &&
      restored.borderChoiceId === source.borderChoiceId &&
      JSON.stringify(restored.menu) === JSON.stringify(source.menu),
    "alakazam_premium_restoration_invalid",
    "retained Alakazam premium restoration evidence is invalid",
    { status: 409 }
  );
  const evidence = {
    schema: ALAKAZAM_RETAINED_PREMIUM_RESTORATION_SCHEMA,
    policyId: ALAKAZAM_CARE_LIFECYCLE_POLICY_ID,
    restorationId: selectedRestorationId,
    projectId: selectedScope.projectId,
    subscriptionId: selectedAuthority.subscriptionId,
    subscriptionRevision: selectedAuthority.revision,
    sourceConfigurationId: source.commandId,
    sourceConfigurationRevision: source.configurationRevision,
    sourceConfigurationDigest: source.configurationDigest,
    restoredConfigurationId: restored.commandId,
    restoredConfigurationRevision: restored.configurationRevision,
    restoredConfigurationDigest: restored.configurationDigest,
    downgradeEventId: downgrade.eventId,
    downgradeEventRevision: downgrade.resultSubscriptionRevision,
    downgradeEventDigest: downgrade.factsDigest,
    upgradeEventId: upgrade.eventId,
    upgradeEventRevision: upgrade.resultSubscriptionRevision,
    upgradeEventDigest: upgrade.factsDigest,
    providerFactsDigest: selectedAuthority.providerFactsDigest,
    providerObservedAt: selectedAuthority.providerObservedAt,
    restoredAt: requiredIso(restoredAt, "restoredAt"),
    state: "held",
    holdReason: ALAKAZAM_RETAINED_PREMIUM_HOLD_REASON
  };
  return deepFreeze({ ...evidence, evidenceDigest: digest(evidence) });
}

function validatePorts(repository, clock) {
  invariant(
    repository &&
      ["exportConfiguration", "read", "readiness", "restore"].every(
        (method) => typeof repository[method] === "function"
      ),
    "invalid_configuration",
    "the retained Alakazam premium repository is required",
    { status: 500 }
  );
  invariant(
    clock && typeof clock.now === "function",
    "invalid_configuration",
    "the retained Alakazam premium clock is required",
    { status: 500 }
  );
  return { repository, clock };
}

export function createAlakazamRetainedPremiumService({
  repository,
  clock
} = {}) {
  const ports = validatePorts(repository, clock);
  function now() {
    const value = ports.clock.now();
    return requiredIso(
      value instanceof Date ? value.toISOString() : value,
      "clock.now"
    );
  }
  return Object.freeze({
    readiness() {
      return ports.repository.readiness();
    },
    read(scope) {
      return ports.repository.read(exactScope(scope), now());
    },
    exportConfiguration(scope) {
      return ports.repository.exportConfiguration(exactScope(scope), now());
    },
    async restore(scope, input) {
      const selectedScope = exactScope(scope);
      exactKeys(
        input,
        [
          "commandId",
          "expectedSourceConfigurationDigest",
          "expectedSubscriptionRevision"
        ],
        "restoreCommand"
      );
      await ports.repository.restore(selectedScope, {
        commandId: uuid(input.commandId, "restoreCommand.commandId"),
        expectedSourceConfigurationDigest: requiredDigest(
          input.expectedSourceConfigurationDigest,
          "restoreCommand.expectedSourceConfigurationDigest"
        ),
        expectedSubscriptionRevision: positiveInteger(
          input.expectedSubscriptionRevision,
          "restoreCommand.expectedSubscriptionRevision"
        ),
        restoredAt: now()
      });
      return ports.repository.read(selectedScope, now());
    }
  });
}
