import {
  clone,
  deepFreeze,
  digest,
  invariant,
  requiredDigest,
  requiredIso,
  requiredText
} from "./canonical.mjs";

export const ALAKAZAM_50_SNAPSHOT_SCHEMA =
  "sitesourcery.alakazam-50-snapshot/v1";
export const ALAKAZAM_50_CONFIGURATION_SCHEMA =
  "sitesourcery.alakazam-50-configuration/v1";
export const ALAKAZAM_50_CARE_SCHEMA =
  "sitesourcery.alakazam-50-care-request/v1";
export const ALAKAZAM_50_HOLD_REASON =
  "commercial_cutover_not_authorized";
export const ALAKAZAM_50_MENU_TARGETS = Object.freeze([
  "about",
  "offerings",
  "practical",
  "contact"
]);
export const ALAKAZAM_50_FONT_CHOICES = deepFreeze([
  { fontChoiceId: "inherit", label: "Use $35 font" },
  { fontChoiceId: "editorial", label: "Editorial" },
  { fontChoiceId: "studio", label: "Studio" }
]);
export const ALAKAZAM_50_BORDER_CHOICES = deepFreeze([
  { borderChoiceId: "soft", label: "Soft" },
  { borderChoiceId: "sharp", label: "Sharp" },
  { borderChoiceId: "ornate", label: "Ornate" }
]);

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HANDLE = /^[A-Za-z0-9_.-]{1,30}$/u;

function exactKeys(value, expected, field) {
  invariant(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...expected].sort()),
    "invalid_input",
    `${field} is invalid`
  );
  return value;
}

function exactUuid(value, field) {
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

function nonnegativeInteger(value, field) {
  invariant(
    Number.isSafeInteger(value) && value >= 0,
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
  const actorId = exactUuid(value.actorId, "scope.actorId");
  const customerId = exactUuid(value.customerId, "scope.customerId");
  invariant(
    actorId === customerId,
    "project_unavailable",
    "the Alakazam $50 project is unavailable",
    { status: 404 }
  );
  return Object.freeze({
    tenantId: exactUuid(value.tenantId, "scope.tenantId"),
    projectId: exactUuid(value.projectId, "scope.projectId"),
    customerId,
    actorId
  });
}

function exactSubscription(value) {
  exactKeys(
    value,
    ["revision", "status", "subscriptionId", "tierId"],
    "subscription"
  );
  invariant(
    value.tierId === "alakazam_50" &&
      ["active", "grace"].includes(value.status),
    "alakazam_50_authority_required",
    "an exact current Alakazam $50 subscription is required",
    { status: 409 }
  );
  return Object.freeze({
    subscriptionId: exactUuid(
      value.subscriptionId,
      "subscription.subscriptionId"
    ),
    tierId: "alakazam_50",
    status: value.status,
    revision: positiveInteger(value.revision, "subscription.revision")
  });
}

function optionalHandle(value, field) {
  if (value === null) return null;
  const selected = requiredText(value, field, 30);
  invariant(
    HANDLE.test(selected),
    "alakazam_50_handle_invalid",
    `${field} is invalid`,
    { status: 400 }
  );
  return selected;
}

function exactChoice(value, choices, id, field, code) {
  const selected = requiredText(value, field, 40);
  invariant(
    choices.some((entry) => entry[id] === selected),
    code,
    `the selected ${field} is unavailable`,
    { status: 409 }
  );
  return selected;
}

function exactMenu(value) {
  invariant(
    Array.isArray(value) &&
      value.length >= 1 &&
      value.length <= ALAKAZAM_50_MENU_TARGETS.length,
    "alakazam_50_menu_invalid",
    "the Alakazam $50 menu is invalid",
    { status: 400 }
  );
  const targets = new Set();
  const selected = value.map((entry, index) => {
    exactKeys(entry, ["label", "target"], `menu[${index}]`);
    const target = requiredText(entry.target, `menu[${index}].target`, 20);
    invariant(
      ALAKAZAM_50_MENU_TARGETS.includes(target) && !targets.has(target),
      "alakazam_50_menu_invalid",
      "the Alakazam $50 menu targets must be unique supported sections",
      { status: 400 }
    );
    targets.add(target);
    return Object.freeze({
      target,
      label: requiredText(entry.label, `menu[${index}].label`, 32)
    });
  });
  return deepFreeze(selected);
}

function configurationWithoutDigest(value) {
  const { configurationDigest, ...selected } = value;
  return selected;
}

export function createAlakazam50Configuration({
  scope,
  commandId,
  subscription,
  expectedCurrentRevision,
  cashAppHandle,
  venmoHandle,
  fontChoiceId,
  borderChoiceId,
  menu,
  configuredAt
}) {
  const selectedScope = exactScope(scope);
  const selectedSubscription = exactSubscription(subscription);
  const currentRevision = nonnegativeInteger(
    expectedCurrentRevision,
    "expectedCurrentRevision"
  );
  const configuration = {
    schema: ALAKAZAM_50_CONFIGURATION_SCHEMA,
    commandId: exactUuid(commandId, "commandId"),
    projectId: selectedScope.projectId,
    subscriptionId: selectedSubscription.subscriptionId,
    subscriptionRevision: selectedSubscription.revision,
    configurationRevision: currentRevision + 1,
    cashAppHandle: optionalHandle(cashAppHandle, "cashAppHandle"),
    venmoHandle: optionalHandle(venmoHandle, "venmoHandle"),
    fontChoiceId: exactChoice(
      fontChoiceId,
      ALAKAZAM_50_FONT_CHOICES,
      "fontChoiceId",
      "fontChoiceId",
      "alakazam_50_font_unavailable"
    ),
    borderChoiceId: exactChoice(
      borderChoiceId,
      ALAKAZAM_50_BORDER_CHOICES,
      "borderChoiceId",
      "borderChoiceId",
      "alakazam_50_border_unavailable"
    ),
    menu: clone(exactMenu(menu)),
    state: "held",
    holdReason: ALAKAZAM_50_HOLD_REASON,
    configuredAt: requiredIso(configuredAt, "configuredAt")
  };
  return deepFreeze({
    ...configuration,
    configurationDigest: digest(configuration)
  });
}

export function verifyAlakazam50Configuration(value) {
  exactKeys(
    value,
    [
      "borderChoiceId",
      "cashAppHandle",
      "commandId",
      "configurationDigest",
      "configurationRevision",
      "configuredAt",
      "fontChoiceId",
      "holdReason",
      "menu",
      "projectId",
      "schema",
      "state",
      "subscriptionId",
      "subscriptionRevision",
      "venmoHandle"
    ],
    "configuration"
  );
  invariant(
    value.schema === ALAKAZAM_50_CONFIGURATION_SCHEMA &&
      value.state === "held" &&
      value.holdReason === ALAKAZAM_50_HOLD_REASON &&
      requiredDigest(
        value.configurationDigest,
        "configuration.configurationDigest"
      ) === digest(configurationWithoutDigest(value)),
    "alakazam_50_configuration_invalid",
    "the Alakazam $50 configuration changed",
    { status: 409 }
  );
  exactUuid(value.commandId, "configuration.commandId");
  exactUuid(value.projectId, "configuration.projectId");
  exactUuid(value.subscriptionId, "configuration.subscriptionId");
  positiveInteger(
    value.subscriptionRevision,
    "configuration.subscriptionRevision"
  );
  positiveInteger(
    value.configurationRevision,
    "configuration.configurationRevision"
  );
  optionalHandle(value.cashAppHandle, "configuration.cashAppHandle");
  optionalHandle(value.venmoHandle, "configuration.venmoHandle");
  exactChoice(
    value.fontChoiceId,
    ALAKAZAM_50_FONT_CHOICES,
    "fontChoiceId",
    "configuration.fontChoiceId",
    "alakazam_50_font_unavailable"
  );
  exactChoice(
    value.borderChoiceId,
    ALAKAZAM_50_BORDER_CHOICES,
    "borderChoiceId",
    "configuration.borderChoiceId",
    "alakazam_50_border_unavailable"
  );
  exactMenu(value.menu);
  requiredIso(value.configuredAt, "configuration.configuredAt");
  return deepFreeze(clone(value));
}

export function createAlakazam50CareRequest({
  scope,
  commandId,
  subscription,
  message,
  requestedAt
}) {
  const selectedScope = exactScope(scope);
  const selectedSubscription = exactSubscription(subscription);
  const request = {
    schema: ALAKAZAM_50_CARE_SCHEMA,
    commandId: exactUuid(commandId, "commandId"),
    projectId: selectedScope.projectId,
    subscriptionId: selectedSubscription.subscriptionId,
    subscriptionRevision: selectedSubscription.revision,
    careClass: "more",
    message: requiredText(message, "message", 1000),
    state: "held",
    holdReason: ALAKAZAM_50_HOLD_REASON,
    requestedAt: requiredIso(requestedAt, "requestedAt")
  };
  return deepFreeze({ ...request, requestDigest: digest(request) });
}

export function createAlakazam50Snapshot({
  scope,
  subscription,
  configuration,
  care
}) {
  const selectedScope = exactScope(scope);
  const selectedSubscription = exactSubscription(subscription);
  const selectedConfiguration = configuration === null
    ? null
    : verifyAlakazam50Configuration(configuration);
  invariant(
    selectedConfiguration === null ||
      (
        selectedConfiguration.projectId === selectedScope.projectId &&
        selectedConfiguration.subscriptionId ===
          selectedSubscription.subscriptionId &&
        selectedConfiguration.subscriptionRevision ===
          selectedSubscription.revision
      ),
    "alakazam_50_configuration_invalid",
    "the Alakazam $50 configuration authority changed",
    { status: 409 }
  );
  exactKeys(care, ["lastRequestedAt", "requestCount"], "care");
  return deepFreeze({
    schema: ALAKAZAM_50_SNAPSHOT_SCHEMA,
    state: "held",
    providerEffects: false,
    holdReason: ALAKAZAM_50_HOLD_REASON,
    projectId: selectedScope.projectId,
    subscription: clone(selectedSubscription),
    controls: {
      cashApp: true,
      venmo: true,
      menuTargets: clone(ALAKAZAM_50_MENU_TARGETS),
      fonts: clone(ALAKAZAM_50_FONT_CHOICES),
      borders: clone(ALAKAZAM_50_BORDER_CHOICES),
      careClass: "more"
    },
    configuration: selectedConfiguration,
    care: {
      state: "held",
      requestCount: nonnegativeInteger(care.requestCount, "care.requestCount"),
      lastRequestedAt: care.lastRequestedAt === null
        ? null
        : requiredIso(care.lastRequestedAt, "care.lastRequestedAt")
    }
  });
}

function validatePorts(repository, clock) {
  invariant(
    repository &&
      ["read", "readiness", "recordCare", "saveConfiguration"].every(
        (method) => typeof repository[method] === "function"
      ),
    "invalid_configuration",
    "the Alakazam $50 repository is required",
    { status: 500 }
  );
  invariant(
    clock && typeof clock.now === "function",
    "invalid_configuration",
    "the Alakazam $50 clock is required",
    { status: 500 }
  );
  return { repository, clock };
}

export function createAlakazam50Service({ repository, clock } = {}) {
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
      return ports.repository.read(exactScope(scope));
    },
    async configure(scope, input) {
      const selectedScope = exactScope(scope);
      exactKeys(
        input,
        [
          "borderChoiceId",
          "cashAppHandle",
          "commandId",
          "expectedCurrentRevision",
          "fontChoiceId",
          "menu",
          "venmoHandle"
        ],
        "configurationCommand"
      );
      await ports.repository.saveConfiguration(selectedScope, {
        ...input,
        configuredAt: now()
      });
      return ports.repository.read(selectedScope);
    },
    async requestCare(scope, input) {
      const selectedScope = exactScope(scope);
      exactKeys(input, ["commandId", "message"], "careCommand");
      await ports.repository.recordCare(selectedScope, {
        ...input,
        requestedAt: now()
      });
      return ports.repository.read(selectedScope);
    }
  });
}
