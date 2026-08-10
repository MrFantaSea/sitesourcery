import { invariant } from "./errors.mjs";

export const POSTGRES_BUDGET_CONFIG_ENVIRONMENT =
  "SITESOURCERY_POSTGRES_BUDGET_CONFIG";
export const POSTGRES_BUDGET_CONFIG_SCHEMA =
  "sitesourcery.postgres-budget-config/v1";
export const POSTGRES_BUDGET_READINESS_SCHEMA =
  "sitesourcery.postgres-budget-readiness/v1";
export const DEFAULT_POSTGRES_POOL_CONNECTIONS = 10;
export const MAXIMUM_POSTGRES_POOL_CONNECTIONS = 24;

const MAXIMUM_CONFIG_BYTES = 2_048;
const INCREASE_MODES = new Set(["none", "held-request"]);

export const DEFAULT_POSTGRES_BUDGET_POLICY = Object.freeze({
  timeouts: Object.freeze({
    statementMs: 15_000,
    lockMs: 3_000,
    idleInTransactionMs: 30_000,
    acquisitionMs: 5_000
  }),
  pool: Object.freeze({
    totalConnections: DEFAULT_POSTGRES_POOL_CONNECTIONS,
    apiConnections: 8,
    workerReservedConnections: 2,
    connectionIncrease: "none"
  })
});

function fail(message) {
  invariant(
    false,
    "POSTGRES_BUDGET_CONFIGURATION_INVALID",
    message,
    { status: 500 }
  );
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
    fail(`${label} must contain only the exact versioned fields.`);
  }
  return value;
}

function integer(value, label, minimum, maximum) {
  if (
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    fail(`${label} is outside its conservative bound.`);
  }
  return value;
}

export function validatePostgresBudgetPolicy(value) {
  exactObject(value, ["timeouts", "pool"], "PostgreSQL budget policy");
  exactObject(
    value.timeouts,
    ["statementMs", "lockMs", "idleInTransactionMs", "acquisitionMs"],
    "PostgreSQL timeout policy"
  );
  exactObject(
    value.pool,
    [
      "totalConnections",
      "apiConnections",
      "workerReservedConnections",
      "connectionIncrease"
    ],
    "PostgreSQL pool policy"
  );

  const statementMs = integer(
    value.timeouts.statementMs,
    "statement_timeout",
    100,
    60_000
  );
  const lockMs = integer(
    value.timeouts.lockMs,
    "lock_timeout",
    50,
    10_000
  );
  const idleInTransactionMs = integer(
    value.timeouts.idleInTransactionMs,
    "idle_in_transaction_session_timeout",
    1_000,
    120_000
  );
  const acquisitionMs = integer(
    value.timeouts.acquisitionMs,
    "PostgreSQL acquisition deadline",
    100,
    15_000
  );
  if (lockMs > statementMs) {
    fail("lock_timeout must not exceed statement_timeout.");
  }

  const totalConnections = integer(
    value.pool.totalConnections,
    "PostgreSQL total connection budget",
    2,
    MAXIMUM_POSTGRES_POOL_CONNECTIONS
  );
  const apiConnections = integer(
    value.pool.apiConnections,
    "PostgreSQL API connection budget",
    1,
    MAXIMUM_POSTGRES_POOL_CONNECTIONS - 1
  );
  const workerReservedConnections = integer(
    value.pool.workerReservedConnections,
    "PostgreSQL worker reserve",
    1,
    MAXIMUM_POSTGRES_POOL_CONNECTIONS - 1
  );
  if (apiConnections + workerReservedConnections !== totalConnections) {
    fail("API connections plus the worker reserve must equal the total pool budget.");
  }
  if (!INCREASE_MODES.has(value.pool.connectionIncrease)) {
    fail("PostgreSQL connection increase authority is invalid.");
  }
  if (
    totalConnections > DEFAULT_POSTGRES_POOL_CONNECTIONS &&
    value.pool.connectionIncrease !== "held-request"
  ) {
    fail("A larger PostgreSQL pool requires an explicit held request.");
  }
  if (
    totalConnections <= DEFAULT_POSTGRES_POOL_CONNECTIONS &&
    value.pool.connectionIncrease !== "none"
  ) {
    fail("A held PostgreSQL connection increase may only accompany a larger pool.");
  }

  return Object.freeze({
    timeouts: Object.freeze({
      statementMs,
      lockMs,
      idleInTransactionMs,
      acquisitionMs
    }),
    pool: Object.freeze({
      totalConnections,
      apiConnections,
      workerReservedConnections,
      connectionIncrease: value.pool.connectionIncrease
    })
  });
}

export function createPostgresBudgetConfiguration({ configurationJson } = {}) {
  if (
    typeof configurationJson !== "string" ||
    configurationJson.length === 0 ||
    Buffer.byteLength(configurationJson, "utf8") > MAXIMUM_CONFIG_BYTES
  ) {
    fail("Versioned PostgreSQL budget configuration is required.");
  }
  let parsed;
  try {
    parsed = JSON.parse(configurationJson);
  } catch {
    fail("Versioned PostgreSQL budget configuration is invalid JSON.");
  }
  exactObject(parsed, ["schema", "timeouts", "pool"], "PostgreSQL budget configuration");
  if (parsed.schema !== POSTGRES_BUDGET_CONFIG_SCHEMA) {
    fail("PostgreSQL budget configuration schema is unsupported.");
  }
  const policy = validatePostgresBudgetPolicy({
    timeouts: parsed.timeouts,
    pool: parsed.pool
  });
  const readiness = Object.freeze({
    schema: POSTGRES_BUDGET_READINESS_SCHEMA,
    ready: true,
    timeouts: Object.freeze({
      statement: "transaction-local",
      lock: "transaction-local",
      idleInTransaction: "transaction-local",
      acquisition: "bounded"
    }),
    pool: Object.freeze({
      totalConnections: policy.pool.totalConnections,
      apiConnections: policy.pool.apiConnections,
      workerReservedConnections: policy.pool.workerReservedConnections,
      connectionIncrease: policy.pool.connectionIncrease,
      workerScope: "held-for-workers-01"
    }),
    telemetry: Object.freeze({
      schema: "sitesourcery.postgres-pool-telemetry/v1",
      pii: "none"
    }),
    connection: "redacted"
  });
  return Object.freeze({ policy, readiness });
}

export function postgresBudgetConfigurationFromEnvironment(
  environment = process.env
) {
  return createPostgresBudgetConfiguration({
    configurationJson: environment?.[POSTGRES_BUDGET_CONFIG_ENVIRONMENT]
  });
}
