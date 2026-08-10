import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  MAXIMUM_POSTGRES_POOL_CONNECTIONS,
  POSTGRES_BUDGET_CONFIG_ENVIRONMENT,
  POSTGRES_BUDGET_CONFIG_SCHEMA,
  createPostgresBudgetConfiguration,
  postgresBudgetConfigurationFromEnvironment
} from "../postgres-budget-config.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);

function manifest(overrides = {}) {
  return JSON.stringify({
    schema: POSTGRES_BUDGET_CONFIG_SCHEMA,
    timeouts: {
      statementMs: 15_000,
      lockMs: 3_000,
      idleInTransactionMs: 30_000,
      acquisitionMs: 5_000,
      ...overrides.timeouts
    },
    pool: {
      totalConnections: 10,
      apiConnections: 8,
      workerReservedConnections: 2,
      connectionIncrease: "none",
      ...overrides.pool
    },
    ...overrides.root
  });
}

test("versioned PostgreSQL budgets compose exact conservative production policy", () => {
  const configuration = postgresBudgetConfigurationFromEnvironment({
    [POSTGRES_BUDGET_CONFIG_ENVIRONMENT]: manifest()
  });
  assert.deepEqual(configuration.policy, {
    timeouts: {
      statementMs: 15_000,
      lockMs: 3_000,
      idleInTransactionMs: 30_000,
      acquisitionMs: 5_000
    },
    pool: {
      totalConnections: 10,
      apiConnections: 8,
      workerReservedConnections: 2,
      connectionIncrease: "none"
    }
  });
  assert.equal(configuration.readiness.ready, true);
  assert.equal(configuration.readiness.connection, "redacted");
  assert.equal(configuration.readiness.telemetry.pii, "none");
  assert.equal(
    configuration.readiness.pool.workerScope,
    "external-process"
  );
  assert.doesNotMatch(JSON.stringify(configuration.readiness), /postgres(?:ql)?:\/\//iu);
});

test("larger pools require an explicit held request and remain hard-capped", () => {
  const selected = createPostgresBudgetConfiguration({
    configurationJson: manifest({
      pool: {
        totalConnections: 12,
        apiConnections: 9,
        workerReservedConnections: 3,
        connectionIncrease: "held-request"
      }
    })
  });
  assert.equal(selected.policy.pool.totalConnections, 12);
  assert.throws(
    () => createPostgresBudgetConfiguration({
      configurationJson: manifest({
        pool: {
          totalConnections: 12,
          apiConnections: 9,
          workerReservedConnections: 3
        }
      })
    }),
    (error) => error?.code === "POSTGRES_BUDGET_CONFIGURATION_INVALID"
  );
  assert.throws(
    () => createPostgresBudgetConfiguration({
      configurationJson: manifest({
        pool: {
          totalConnections: MAXIMUM_POSTGRES_POOL_CONNECTIONS + 1,
          apiConnections: MAXIMUM_POSTGRES_POOL_CONNECTIONS,
          workerReservedConnections: 1,
          connectionIncrease: "held-request"
        }
      })
    }),
    (error) => error?.code === "POSTGRES_BUDGET_CONFIGURATION_INVALID"
  );
});

test("configuration rejects missing, malformed, incomplete, excessive, and drifting budgets", () => {
  const invalid = [
    undefined,
    "{}",
    "not-json",
    manifest({ root: { extra: true } }),
    manifest({ root: { schema: "sitesourcery.postgres-budget-config/v2" } }),
    manifest({ timeouts: { statementMs: 99 } }),
    manifest({ timeouts: { lockMs: 15_001 } }),
    manifest({ timeouts: { acquisitionMs: 15_001 } }),
    manifest({ pool: { apiConnections: 9 } }),
    manifest({ pool: { workerReservedConnections: 0, apiConnections: 10 } }),
    manifest({ pool: { connectionIncrease: "held-request" } }),
    manifest({ pool: { connectionIncrease: "approved" } })
  ];
  for (const configurationJson of invalid) {
    assert.throws(
      () => createPostgresBudgetConfiguration({ configurationJson }),
      (error) =>
        error?.code === "POSTGRES_BUDGET_CONFIGURATION_INVALID" &&
        error?.status === 500
    );
  }
});

test("held example and production composition contain only metadata wiring", async () => {
  const [example, serverSource] = await Promise.all([
    readFile(
      path.join(root, "ops/postgres-budget-config.held.example.json"),
      "utf8"
    ),
    readFile(
      path.join(root, "server/hosted/bin/server.mjs"),
      "utf8"
    )
  ]);
  const selected = createPostgresBudgetConfiguration({
    configurationJson: example
  });
  assert.equal(selected.policy.pool.totalConnections, 10);
  assert.match(
    serverSource,
    /postgresBudgetConfigurationFromEnvironment\(process\.env\)/u
  );
  assert.match(
    serverSource,
    /budgetPolicy: postgresBudgetConfiguration\.policy/u
  );
  for (const wiring of [
    "connectionTimeoutMillis",
    "statementTimeoutMillis",
    "lockTimeoutMillis",
    "idleInTransactionTimeoutMillis",
    "queryTimeoutMillis"
  ]) {
    assert.match(serverSource, new RegExp(`${wiring}:`, "u"));
  }
  assert.doesNotMatch(example, /password|credential|secret|postgresql:\/\//iu);
});
