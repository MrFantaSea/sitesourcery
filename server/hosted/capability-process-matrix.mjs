export const CAPABILITY_PROCESS_MATRIX_SCHEMA =
  "sitesourcery.capability-process-matrix/v2";

export const CAPABILITY_PROCESS_KEYS = Object.freeze([
  "public_successor",
  "hosted_browser",
  "accounts_recovery",
  "organizations_tenancy",
  "projects_downloads",
  "publication",
  "assessment_custom",
  "alakazam",
  "domains",
  "care",
  "responder",
  "operator_support",
  "transactional_mail",
  "provider_reconciliation",
  "backup_restore",
  "monitoring_deadman",
  "client_profile_hub",
  "dell_commercial_engine",
  "marketing_desk",
  "messenger_command_phone"
]);

export const CAPABILITY_PROCESS_KEYS_COUNT = 20;

export const CAPABILITY_PROCESS_PROCESS_KEYS = Object.freeze([
  "public_static",
  "hosted_api",
  "tenant_runtime",
  "postgresql",
  "worker",
  "monitoring_deadman"
]);

export const CAPABILITY_PROCESS_PROCESS_COUNT = 6;

const ENGINEERING_STATES = new Set([
  "ready",
  "candidate",
  "not_ready"
]);
const EFFECT_STATES = new Set([
  "held",
  "internal",
  "static"
]);
const INSTALLATION_STATES = new Set([
  "not_installed",
  "installed"
]);
const SAFE_CODE = /^[a-z][a-z0-9_]{1,79}$/u;

const ROW_DEFINITIONS = Object.freeze({
  public_successor: rowDefinition(false, "static", ["public_static"]),
  hosted_browser: rowDefinition(false, "static", ["public_static", "hosted_api"]),
  accounts_recovery: rowDefinition(true, "held", ["hosted_api", "postgresql", "worker"]),
  organizations_tenancy: rowDefinition(true, "held", ["hosted_api", "postgresql"]),
  projects_downloads: rowDefinition(true, "held", ["hosted_api", "tenant_runtime", "postgresql", "worker"]),
  publication: rowDefinition(true, "held", ["hosted_api", "tenant_runtime", "worker"]),
  assessment_custom: rowDefinition(true, "held", ["hosted_api", "postgresql", "worker"]),
  alakazam: rowDefinition(true, "held", ["hosted_api", "postgresql", "worker"]),
  domains: rowDefinition(true, "held", ["hosted_api", "postgresql", "worker"]),
  care: rowDefinition(true, "held", ["hosted_api", "postgresql", "worker"]),
  responder: rowDefinition(true, "held", ["hosted_api", "postgresql", "worker"]),
  operator_support: rowDefinition(true, "held", ["hosted_api", "postgresql"]),
  transactional_mail: rowDefinition(true, "held", ["hosted_api", "postgresql", "worker"]),
  provider_reconciliation: rowDefinition(true, "held", ["hosted_api", "postgresql", "worker"]),
  backup_restore: rowDefinition(false, "held", ["hosted_api", "postgresql", "tenant_runtime", "monitoring_deadman"]),
  monitoring_deadman: rowDefinition(false, "held", ["monitoring_deadman"]),
  client_profile_hub: rowDefinition(true, "held", ["hosted_api", "postgresql"]),
  dell_commercial_engine: rowDefinition(true, "held", ["hosted_api", "postgresql"]),
  marketing_desk: rowDefinition(true, "held", ["hosted_api", "postgresql"]),
  messenger_command_phone: rowDefinition(true, "held", ["hosted_api", "postgresql"])
});

const PROCESS_DEFINITIONS = Object.freeze({
  public_static: processDefinition("public_static_artifact", null, "static"),
  hosted_api: processDefinition("hosted_api_and_publication_writer", "127.0.0.1:8788", "held"),
  tenant_runtime: processDefinition("read_only_tenant_runtime", "127.0.0.1:8080", "held"),
  postgresql: processDefinition("durable_authority", "private_database", "internal"),
  worker: processDefinition("listener_free_worker", null, "held"),
  monitoring_deadman: processDefinition("independent_monitor", null, "held")
});

const INSTALLED_PROCESS_RUNTIME_STATES = Object.freeze({
  public_static: "external_not_asserted",
  hosted_api: "active",
  tenant_runtime: "external_not_asserted",
  postgresql: "ready",
  worker: "held_not_asserted",
  monitoring_deadman: "external_not_asserted"
});

function rowDefinition(startupRequired, effectState, processes) {
  return Object.freeze({
    startupRequired,
    effectState,
    processes: Object.freeze([...processes])
  });
}

function processDefinition(role, listener, effectState) {
  return Object.freeze({ role, listener, effectState });
}

function exactObject(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify([...keys].sort())
  ) {
    throw new TypeError(`${label} must contain only its exact reviewed fields.`);
  }
  return value;
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const entry of Object.values(value)) freeze(entry);
    Object.freeze(value);
  }
  return value;
}

function validateStatus(
  value,
  label,
  { effectState = null, engineeringState = null } = {}
) {
  exactObject(
    value,
    ["engineeringState", "effectState", "code"],
    label
  );
  if (
    !ENGINEERING_STATES.has(value.engineeringState) ||
    !EFFECT_STATES.has(value.effectState) ||
    (effectState !== null && value.effectState !== effectState) ||
    (engineeringState !== null && value.engineeringState !== engineeringState) ||
    typeof value.code !== "string" ||
    !SAFE_CODE.test(value.code)
  ) {
    throw new TypeError(`${label} has an invalid reviewed status.`);
  }
  return value;
}

function releaseStateForInstallation(installationState) {
  if (!INSTALLATION_STATES.has(installationState)) {
    throw new TypeError("Capability process installation state is invalid.");
  }
  return installationState === "installed" ? "installed" : "candidate";
}

function runtimeStateForProcess(key, installationState) {
  return installationState === "installed"
    ? INSTALLED_PROCESS_RUNTIME_STATES[key]
    : "not_asserted";
}

function validateProcesses(value, installationState = "not_installed") {
  releaseStateForInstallation(installationState);
  exactObject(
    value,
    CAPABILITY_PROCESS_PROCESS_KEYS,
    "Capability process states"
  );
  return CAPABILITY_PROCESS_PROCESS_KEYS.map((key) => {
    const status = validateStatus(
      value[key],
      `Capability process ${key}`,
      {
        effectState: PROCESS_DEFINITIONS[key].effectState,
        engineeringState:
          installationState === "installed" ? "ready" : "candidate"
      }
    );
    const definition = PROCESS_DEFINITIONS[key];
    return Object.freeze({
      key,
      role: definition.role,
      listener: definition.listener,
      engineeringState: status.engineeringState,
      effectState: status.effectState,
      installationState,
      runtimeState: runtimeStateForProcess(key, installationState),
      code: status.code
    });
  });
}

function validateRows(value, installationState = "not_installed") {
  releaseStateForInstallation(installationState);
  exactObject(value, CAPABILITY_PROCESS_KEYS, "Capability process rows");
  return CAPABILITY_PROCESS_KEYS.map((key) => {
    const status = validateStatus(
      value[key],
      `Capability row ${key}`,
      {
        effectState: ROW_DEFINITIONS[key].effectState,
        engineeringState:
          installationState === "installed" ? "ready" : null
      }
    );
    const definition = ROW_DEFINITIONS[key];
    return Object.freeze({
      key,
      engineeringState: status.engineeringState,
      effectState: status.effectState,
      installationState,
      startupRequired: definition.startupRequired,
      processes: definition.processes,
      code: status.code
    });
  });
}

export function validateCapabilityProcessMatrixSnapshot(value) {
  exactObject(
    value,
    [
      "schema",
      "releaseState",
      "effectState",
      "installationState",
      "rows",
      "processes",
      "startupReady",
      "externalEffects"
    ],
    "Capability process matrix snapshot"
  );
  const expectedReleaseState = releaseStateForInstallation(
    value.installationState
  );
  if (
    value.schema !== CAPABILITY_PROCESS_MATRIX_SCHEMA ||
    value.releaseState !== expectedReleaseState ||
    value.effectState !== "all_held" ||
    !Array.isArray(value.rows) ||
    value.rows.length !== CAPABILITY_PROCESS_KEYS_COUNT ||
    !Array.isArray(value.processes) ||
    value.processes.length !== CAPABILITY_PROCESS_PROCESS_COUNT ||
    typeof value.startupReady !== "boolean" ||
    value.externalEffects !== false
  ) {
    throw new TypeError("Capability process matrix snapshot is invalid.");
  }
  const rowMap = Object.fromEntries(value.rows.map((row) => [row?.key, row]));
  const processMap = Object.fromEntries(
    value.processes.map((process) => [process?.key, process])
  );
  const rows = validateRows(
    Object.fromEntries(CAPABILITY_PROCESS_KEYS.map((key) => {
      const row = exactObject(
        rowMap[key],
        [
          "key",
          "engineeringState",
          "effectState",
          "installationState",
          "startupRequired",
          "processes",
          "code"
        ],
        `Capability snapshot row ${key}`
      );
      const definition = ROW_DEFINITIONS[key];
      if (
        row.key !== key ||
        row.installationState !== value.installationState ||
        row.startupRequired !== definition.startupRequired ||
        JSON.stringify(row.processes) !== JSON.stringify(definition.processes)
      ) {
        throw new TypeError(`Capability snapshot row ${key} drifted.`);
      }
      return [key, {
        engineeringState: row.engineeringState,
        effectState: row.effectState,
        code: row.code
      }];
    })),
    value.installationState
  );
  const processes = validateProcesses(
    Object.fromEntries(CAPABILITY_PROCESS_PROCESS_KEYS.map((key) => {
      const process = exactObject(
        processMap[key],
        [
          "key",
          "role",
          "listener",
          "engineeringState",
          "effectState",
          "installationState",
          "runtimeState",
          "code"
        ],
        `Capability snapshot process ${key}`
      );
      const definition = PROCESS_DEFINITIONS[key];
      if (
        process.key !== key ||
        process.role !== definition.role ||
        process.listener !== definition.listener ||
        process.installationState !== value.installationState ||
        process.runtimeState !== runtimeStateForProcess(
          key,
          value.installationState
        )
      ) {
        throw new TypeError(`Capability snapshot process ${key} drifted.`);
      }
      return [key, {
        engineeringState: process.engineeringState,
        effectState: process.effectState,
        code: process.code
      }];
    })),
    value.installationState
  );
  const startupReady = rows.every((row) =>
    row.startupRequired !== true || row.engineeringState === "ready"
  );
  if (startupReady !== value.startupReady) {
    throw new TypeError("Capability process startup result drifted from its rows.");
  }
  return freeze({
    schema: CAPABILITY_PROCESS_MATRIX_SCHEMA,
    releaseState: expectedReleaseState,
    effectState: "all_held",
    installationState: value.installationState,
    rows,
    processes,
    startupReady,
    externalEffects: false
  });
}

export function createCapabilityProcessMatrix({
  loadRows,
  processes,
  installationState = "not_installed"
}) {
  if (typeof loadRows !== "function") {
    throw new TypeError("Capability process row loader is required.");
  }
  const releaseState = releaseStateForInstallation(installationState);
  const processSnapshot = validateProcesses(processes, installationState);
  let active = null;

  async function snapshot() {
    if (active) return active;
    active = (async () => {
      const rows = validateRows(await loadRows(), installationState);
      return validateCapabilityProcessMatrixSnapshot({
        schema: CAPABILITY_PROCESS_MATRIX_SCHEMA,
        releaseState,
        effectState: "all_held",
        installationState,
        rows,
        processes: processSnapshot,
        startupReady: rows.every((row) =>
          row.startupRequired !== true || row.engineeringState === "ready"
        ),
        externalEffects: false
      });
    })();
    try {
      return await active;
    } finally {
      active = null;
    }
  }

  async function assertStartup(value = null) {
    const selected = value === null
      ? await snapshot()
      : validateCapabilityProcessMatrixSnapshot(value);
    if (selected.startupReady !== true) {
      const error = new Error(
        "Hosted capability-process matrix has an unfinished required row."
      );
      error.code = "CAPABILITY_PROCESS_STARTUP_NOT_READY";
      throw error;
    }
    return selected;
  }

  return Object.freeze({ snapshot, assertStartup });
}
